import { useState, useCallback, useRef, useEffect } from 'react';
import { api, streamChat, generateDocument } from '../services/api';
import { downloadFile } from '../utils/fileDownload';

export interface Message {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  ai_model?: string;
  ai_provider?: string;
  safety_disclaimer?: string;
  safety_topics?: string[];
  thinking?: string;
  thinkingDone?: boolean;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  description?: string;
}

interface RecommendedModel {
  id: string;
  name: string;
  provider: string;
  load: { activeUsers: number; tier: string; tierLabel: string };
}

interface VectorMemories {
  episodic: any[];
  declarative: any[];
  procedural: any[];
}

interface ActiveFormSession {
  id: number;
  formName: string;
  state: 'incomplete' | 'complete' | 'wait_confirm' | 'closed';
  collectedFields: string[];
  missingFields: string[];
  lastQuestion: string | null;
}

interface UseChatMessagesReturn {
  messages: Message[];
  input: string;
  isStreaming: boolean;
  models: Model[];
  selectedModel: string;
  showModelSelect: boolean;
  modelsLoading: boolean;
  recommendedModel: RecommendedModel | null;
  generatingDoc: number | null;
  expandedThinking: Record<number, boolean>;
  vectorMemories: VectorMemories | null;
  showVectorMemory: boolean;
  showMemoryPanel: boolean;
  memoryObservations: Array<{ id: number; observation_type: string; content: string; importance: number; created_at: string }>;
  memoryContextActive: boolean;
  activeFormSession: ActiveFormSession | null;
  showConsentModal: boolean;
  routingInfo: { tier: string; model: string; reason: string; confidence: number; effort: string } | null;
  currentModel: Model;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  setInput: (input: string) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setSelectedModel: (model: string) => void;
  setShowModelSelect: (show: boolean) => void;
  setExpandedThinking: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  setShowVectorMemory: (show: boolean) => void;
  setShowMemoryPanel: (show: boolean) => void;
  setShowConsentModal: (show: boolean) => void;
  sendMessage: (currentConversationId: number | null, showArchived: boolean, onConversationCreated: () => void, attachments: any[], uploadAttachments: (conversationId?: number) => Promise<number[]>) => Promise<void>;
  undoLastMessage: (currentConversationId: number | null) => Promise<void>;
  handleGenerateDocument: (msgIndex: number, format: 'docx' | 'pdf', currentConversationId: number | null) => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent, sendFn: () => void) => void;
  loadMemoryObservations: () => Promise<void>;
  handleFormCancel: () => Promise<void>;
  handleFormConfirm: (confirmed: boolean) => Promise<void>;
}

export function useChatMessages(currentConversationId: number | null): UseChatMessagesReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [recommendedModel, setRecommendedModel] = useState<RecommendedModel | null>(null);
  const [generatingDoc, setGeneratingDoc] = useState<number | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Record<number, boolean>>({});
  const [vectorMemories, setVectorMemories] = useState<VectorMemories | null>(null);
  const [showVectorMemory, setShowVectorMemory] = useState(false);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [memoryObservations, setMemoryObservations] = useState<Array<{ id: number; observation_type: string; content: string; importance: number; created_at: string }>>([]);
  const [memoryContextActive, setMemoryContextActive] = useState(false);
  const [activeFormSession, setActiveFormSession] = useState<ActiveFormSession | null>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [routingInfo, setRoutingInfo] = useState<{ tier: string; model: string; reason: string; confidence: number; effort: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userHasScrolledUp = useRef(false);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  // Track user scroll position to avoid fighting with manual scrolling
  useEffect(() => {
    const findScrollContainer = () => {
      const endEl = messagesEndRef.current;
      if (!endEl) return null;
      let parent = endEl.parentElement;
      while (parent) {
        const style = window.getComputedStyle(parent);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') return parent;
        parent = parent.parentElement;
      }
      return null;
    };

    const container = findScrollContainer();
    if (!container) return;
    scrollContainerRef.current = container;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      userHasScrolledUp.current = distanceFromBottom > 150;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [messages.length > 0]);

  // Load available models from configured providers
  useEffect(() => {
    const loadModels = async () => {
      try {
        const [modelsRes, recRes] = await Promise.all([
          api.get('/chat/models'),
          api.get('/chat/models/recommended').catch(() => null),
        ]);
        const availableModels = modelsRes.data as Model[];
        setModels(availableModels);

        // Auto (Smart Routing) is always default when available
        const autoModel = availableModels.find(m => m.id === 'auto');
        if (autoModel && !selectedModel) {
          setSelectedModel('auto');
        } else if (recRes?.data?.recommended && availableModels.some(m => m.id === recRes.data.recommended.id)) {
          setRecommendedModel({ ...recRes.data.recommended, load: recRes.data.load });
          if (!selectedModel) {
            setSelectedModel(recRes.data.recommended.id);
          }
        } else if (availableModels.length > 0 && !selectedModel) {
          setSelectedModel(availableModels[0].id);
        }
      } catch (err) {
        console.error('Failed to load models:', err);
      } finally {
        setModelsLoading(false);
      }
    };
    loadModels();
  }, []);

  // Scroll to bottom on new messages — only if user hasn't scrolled up
  useEffect(() => {
    if (!userHasScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Reset scroll flag when user sends a new message (last message is from user)
  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
      userHasScrolledUp.current = false;
    }
  }, [messages.length]);

  // AI Act: Check consent status on mount
  useEffect(() => {
    api.get('/compliance/consent/status')
      .then(res => {
        const consents = res.data?.consents || [];
        const hasAiConsent = consents.some((c: any) => c.consent_type === 'ai_disclosure' && c.granted);
        if (!hasAiConsent) setShowConsentModal(true);
      })
      .catch(() => { /* consent endpoint may not be ready */ });
  }, []);

  // Load memory context status
  useEffect(() => {
    const loadMemoryStatus = async () => {
      try {
        const res = await api.get('/memory/context');
        setMemoryContextActive(res.data.has_context);
      } catch { /* memory module may not be ready */ }
    };
    loadMemoryStatus();
  }, [currentConversationId]);

  // Load active form session when conversation changes
  useEffect(() => {
    if (!currentConversationId) {
      setActiveFormSession(null);
      return;
    }
    const loadFormSession = async () => {
      try {
        const res = await api.get(`/forms/sessions/active?conversation_id=${currentConversationId}`);
        const s = res.data.session;
        if (s) {
          const form = res.data.form;
          const schema = typeof form?.json_schema === 'string' ? JSON.parse(form.json_schema) : form?.json_schema;
          const allFields = Object.keys(schema?.properties || {});
          const collected = Object.keys(typeof s.collected_data === 'string' ? JSON.parse(s.collected_data) : (s.collected_data || {}));
          const missing = typeof s.missing_fields === 'string' ? JSON.parse(s.missing_fields) : (s.missing_fields || allFields.filter((f: string) => !collected.includes(f)));
          setActiveFormSession({
            id: s.id,
            formName: form?.display_name || 'Form',
            state: s.state,
            collectedFields: collected,
            missingFields: missing,
            lastQuestion: null,
          });
        } else {
          setActiveFormSession(null);
        }
      } catch {
        setActiveFormSession(null);
      }
    };
    loadFormSession();
  }, [currentConversationId]);

  const handleFormCancel = useCallback(async () => {
    if (!activeFormSession) return;
    try {
      await api.post(`/forms/sessions/${activeFormSession.id}/cancel`);
      setActiveFormSession(null);
    } catch (err) {
      console.error('Failed to cancel form:', err);
    }
  }, [activeFormSession]);

  const handleFormConfirm = useCallback(async (confirmed: boolean) => {
    if (!activeFormSession) return;
    try {
      await api.post(`/forms/sessions/${activeFormSession.id}/confirm`, { confirmed });
      if (confirmed) {
        setActiveFormSession(null);
      } else {
        setActiveFormSession(prev => prev ? { ...prev, state: 'incomplete' } : null);
      }
    } catch (err) {
      console.error('Failed to confirm form:', err);
    }
  }, [activeFormSession]);

  const loadMemoryObservations = useCallback(async () => {
    try {
      const res = await api.get('/memory/observations?limit=15&archived=false');
      setMemoryObservations(res.data.observations || []);
    } catch (err) {
      console.error('Failed to load memory observations:', err);
    }
  }, []);

  const currentModel = models.find(m => m.id === selectedModel) || models[0] || { id: '', name: 'Loading...', provider: '' };

  const sendMessage = useCallback(async (
    convId: number | null,
    showArchived: boolean,
    onConversationCreated: () => void,
    attachments: any[],
    uploadAttachments: (conversationId?: number) => Promise<number[]>,
  ) => {
    if ((!input.trim() && attachments.length === 0) || isStreaming) return;

    const userMessage = input.trim();
    const hasAttachments = attachments.length > 0;
    const attachmentNames = attachments.map((a: any) => a.file.name);

    setInput('');

    const displayMessage = hasAttachments
      ? `${userMessage}\n\n\u{1F4CE} Allegati: ${attachmentNames.join(', ')}`
      : userMessage;

    setMessages(prev => [...prev, {
      role: 'user',
      content: displayMessage,
      timestamp: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }]);
    setIsStreaming(true);

    const model = models.find(m => m.id === selectedModel);
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: '',
      ai_model: selectedModel,
      ai_provider: model?.provider,
      timestamp: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }]);

    try {
      let attachmentIds: number[] = [];
      if (hasAttachments) {
        attachmentIds = await uploadAttachments(convId || undefined);
      }

      let messageToSend = userMessage;
      if (hasAttachments) {
        if (!messageToSend) {
          messageToSend = `Analizza i file allegati: ${attachmentNames.join(', ')}`;
        } else {
          messageToSend = `[Allegati: ${attachmentNames.join(', ')}]\n\n${userMessage}`;
        }
      }

      await streamChat(
        selectedModel,
        messageToSend,
        (content) => {
          setMessages(prev => {
            const newMessages = [...prev];
            const last = newMessages[newMessages.length - 1];
            if (last.role === 'assistant') {
              newMessages[newMessages.length - 1] = {
                ...last,
                content: last.content + content,
                timestamp: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              };
            }
            return newMessages;
          });
        },
        (conversationId) => {
          setIsStreaming(false);
          if (!convId) {
            onConversationCreated();
          }
        },
        (error) => {
          setIsStreaming(false);
          setMessages(prev => {
            const newMessages = [...prev];
            const last = newMessages[newMessages.length - 1];
            if (last.role === 'assistant') {
              newMessages[newMessages.length - 1] = { ...last, content: `Errore: ${error}` };
            }
            return newMessages;
          });
        },
        convId || undefined,
        undefined,
        attachmentIds.length > 0 ? attachmentIds : undefined,
        (thinkingContent, done) => {
          setMessages(prev => {
            const newMessages = [...prev];
            const last = newMessages[newMessages.length - 1];
            if (last.role === 'assistant') {
              newMessages[newMessages.length - 1] = done
                ? { ...last, thinkingDone: true }
                : { ...last, thinking: (last.thinking || '') + thinkingContent };
            }
            return newMessages;
          });
        },
        (memories) => {
          setVectorMemories(memories);
        },
        (routing) => {
          setRoutingInfo(routing);
          setMessages(prev => {
            const newMessages = [...prev];
            const last = newMessages[newMessages.length - 1];
            if (last.role === 'assistant') {
              newMessages[newMessages.length - 1] = { ...last, ai_model: routing.model };
            }
            return newMessages;
          });
        },
      );
    } catch (err) {
      setIsStreaming(false);
      console.error('Send message error:', err);
    }
  }, [input, isStreaming, models, selectedModel]);

  const undoLastMessage = useCallback(async (convId: number | null) => {
    if (!convId || isStreaming || messages.length === 0) return;

    try {
      await api.delete(`/chat/conversations/${convId}/undo`);

      setMessages(prev => {
        const newMessages = [...prev];
        if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
          newMessages.pop();
        }
        if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'user') {
          const userContent = newMessages[newMessages.length - 1].content;
          const cleanedContent = userContent.split('\n\n\u{1F4CE} Allegati:')[0];
          setInput(cleanedContent);
          newMessages.pop();
        }
        return newMessages;
      });
    } catch (err) {
      console.error('Undo error:', err);
      alert('Failed to undo last message');
    }
  }, [isStreaming, messages.length]);

  const handleGenerateDocument = useCallback(async (msgIndex: number, format: 'docx' | 'pdf', convId: number | null) => {
    if (!convId || generatingDoc !== null) return;
    setGeneratingDoc(msgIndex);
    try {
      const result = await generateDocument(
        convId,
        format,
        messages[msgIndex]?.content,
        `Chat_${format.toUpperCase()}`,
      );
      if (result.success && result.url) {
        await downloadFile(result.url, result.filename);
      }
    } catch (err) {
      console.error('Failed to generate document:', err);
    } finally {
      setGeneratingDoc(null);
    }
  }, [generatingDoc, messages]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, sendFn: () => void) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendFn();
    }
  }, []);

  return {
    messages,
    input,
    isStreaming,
    models,
    selectedModel,
    showModelSelect,
    modelsLoading,
    recommendedModel,
    generatingDoc,
    expandedThinking,
    vectorMemories,
    showVectorMemory,
    showMemoryPanel,
    memoryObservations,
    memoryContextActive,
    activeFormSession,
    showConsentModal,
    routingInfo,
    currentModel,
    messagesEndRef,
    inputRef,
    setInput,
    setMessages,
    setSelectedModel,
    setShowModelSelect,
    setExpandedThinking,
    setShowVectorMemory,
    setShowMemoryPanel,
    setShowConsentModal,
    sendMessage,
    undoLastMessage,
    handleGenerateDocument,
    handleKeyDown,
    loadMemoryObservations,
    handleFormCancel,
    handleFormConfirm,
  };
}
