import React from 'react';
import {
  Brain,
  Paperclip,
  Database,
  ExternalLink,
  User,
  ChevronDown,
  Download,
  FileText,
  Loader2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import clsx from 'clsx';
import { BotIcon, BotIconType } from '../BotIcon';
import AIGeneratedLabel from '../AIGeneratedLabel';
import FeedbackButtons from '../FeedbackButtons';
import SensitiveTopicWarning from '../SensitiveTopicWarning';
import { downloadFile } from '../../utils/fileDownload';
import { isNativePlatform } from '../../utils/platform';
import type { Message } from '../../hooks/useChatMessages';
import { useDocumentStore } from '../../hooks/useDocumentStore';

// Stable markdown components defined OUTSIDE the render function
// to prevent React from re-creating DOM elements on each re-render
// (fixes image flickering/reload on scroll — see remarkjs/react-markdown#881)
const MarkdownCode = ({ className, children, ...props }: any) => {
  const match = /language-(\w+)/.exec(className || '');
  const inline = !match;
  return inline ? (
    <code className={className} {...props}>{children}</code>
  ) : (
    <SyntaxHighlighter style={oneDark as any} language={match[1]} PreTag="div">
      {String(children).replace(/\n$/, '')}
    </SyntaxHighlighter>
  );
};

const MarkdownImg = ({ src, alt, ...props }: any) => {
  const isGenerated = typeof src === 'string' && src.startsWith('/api/tools/download/');
  // Only render images from our API or standard https URLs (block javascript:, data: etc.)
  const isSafeSrc = typeof src === 'string' && (src.startsWith('/api/') || src.startsWith('https://'));
  const safeFilename = ((alt || 'image') as string).replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100) + '.png';

  if (!isSafeSrc) return null;

  return (
    <div className="my-3">
      <img
        src={src}
        alt={alt || 'Generated image'}
        className="rounded-lg max-w-full max-h-[512px] object-contain border border-surface-200 dark:border-surface-700"
        loading="lazy"
      />
      {isGenerated && (
        <div className="mt-2 flex items-center gap-2">
          <a
            href={src}
            download
            onClick={async (e: React.MouseEvent) => { e.preventDefault(); await downloadFile(src!, safeFilename); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white no-underline transition-colors text-xs font-medium cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Scarica
          </a>
        </div>
      )}
    </div>
  );
};

const MarkdownLink = ({ href, children, ...props }: any) => {
  if (href && href.includes('/api/tools/download/')) {
    const handleDownload = async (e: React.MouseEvent) => {
      e.preventDefault();
      await downloadFile(href, String(children));
    };
    return (
      <a href={href} onClick={handleDownload}
        className="inline-flex items-center gap-2 px-4 py-2 my-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white no-underline transition-colors text-sm font-medium cursor-pointer"
        {...props}>
        <Download className="w-4 h-4" />{children}
      </a>
    );
  }
  const handleExternalClick = async (e: React.MouseEvent) => {
    if (isNativePlatform() && href) {
      e.preventDefault();
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: href });
    }
  };
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={handleExternalClick} {...props}>{children}</a>;
};

const markdownComponents = { code: MarkdownCode, img: MarkdownImg, a: MarkdownLink };

interface ChatMessageListProps {
  messages: Message[];
  isStreaming: boolean;
  selectedBotIcon: BotIconType;
  currentModelName: string;
  currentConversationId: number | null;
  generatingDoc: number | null;
  expandedThinking: Record<number, boolean>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onToggleThinking: (index: number) => void;
  onGenerateDocument: (msgIndex: number, format: 'docx' | 'pdf') => void;
}

export default function ChatMessageList({
  messages,
  isStreaming,
  selectedBotIcon,
  currentModelName,
  currentConversationId,
  generatingDoc,
  expandedThinking,
  messagesEndRef,
  onToggleThinking,
  onGenerateDocument,
}: ChatMessageListProps) {
  const { chatMode } = useDocumentStore();
  const isRagMode = chatMode === 'rag';

  if (messages.length === 0) {
    if (isRagMode) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-4 animate-in fade-in duration-700">
          <div className="w-20 h-20 rounded-3xl bg-indigo-600/10 flex items-center justify-center mb-8 border border-indigo-600/20 text-indigo-600">
            <Brain className="w-10 h-10" />
          </div>
          <h2 className="text-3xl font-bold mb-3 tracking-tight">Modalità Analisi Documenti</h2>
          <p className="text-surface-500 max-w-md text-lg leading-relaxed">
            Seleziona i documenti caricati o caricali ora per iniziare un'analisi professionale basata sui tuoi dati.
          </p>
        </div>
      );
    }
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-6 text-white">
          <BotIcon type={selectedBotIcon} size={32} />
        </div>
        <h2 className="text-2xl font-bold mb-2">Enterprise AI Chat</h2>
        <p className="text-surface-500 max-w-md">
          Start a conversation with {currentModelName}. Your messages are private and secure.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6">
      {messages.map((message, index) => (
        <div
          key={index}
          className={clsx(
            'px-4 py-6',
            message.role === 'assistant' && 'bg-surface-50 dark:bg-surface-900/50'
          )}
        >
          <div className="flex gap-4 max-w-3xl mx-auto">
            {!isRagMode && (
              <div
                className={clsx(
                  'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                  message.role === 'user'
                    ? 'bg-primary-600'
                    : 'bg-gradient-to-br from-violet-500 to-purple-600'
                )}
              >
                {message.role === 'user' ? (
                  <User className="w-5 h-5 text-white" />
                ) : (
                  <BotIcon type={selectedBotIcon} size={20} className="text-white" />
                )}
              </div>
            )}
            <div className="flex-1 min-w-0">
              {/* Thinking block */}
              {message.role === 'assistant' && message.thinking && (
                <div className="mb-3">
                  <button
                    onClick={() => onToggleThinking(index)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors"
                  >
                    <Brain className="w-3.5 h-3.5" />
                    <span>Ragionamento</span>
                    {!message.thinkingDone && (
                      <span className="thinking-pulse inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                    )}
                    <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform duration-200', expandedThinking[index] && 'rotate-180')} />
                  </button>
                  {(expandedThinking[index] ?? (!message.thinkingDone && isStreaming)) && (
                    <div className="mt-2 pl-3 border-l-2 border-amber-500/30 max-h-64 overflow-y-auto">
                      <pre className="text-xs text-surface-400 dark:text-surface-500 font-mono whitespace-pre-wrap leading-relaxed">{message.thinking}</pre>
                    </div>
                  )}
                </div>
              )}
              {/* Thinking-only indicator (thinking in progress, no content yet) */}
              {message.role === 'assistant' && message.thinking && !message.thinkingDone && !message.content && (
                <div className="flex items-center gap-2 text-xs text-amber-500/70 mb-2">
                  <Brain className="w-3.5 h-3.5 animate-pulse" />
                  <span>Sta ragionando...</span>
                </div>
              )}

              <div className="prose dark:prose-invert prose-sm max-w-none">
                {message.role === 'assistant' && message.content === '' && !message.thinking ? (
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                ) : (
                  <ReactMarkdown components={markdownComponents}>
                    {message.content}
                  </ReactMarkdown>
                )}
              </div>

              {/* Vector Memory / Sources display (GAP-RAG) */}
              {message.role === 'assistant' && message.vectorMemories && (message.vectorMemories.declarative.length > 0 || message.vectorMemories.episodic.length > 0) && (
                <div className="mt-6 pt-4 border-t border-surface-200 dark:border-surface-800 animate-in fade-in slide-in-from-top-2 duration-700">
                  <div className="flex items-center gap-2 mb-4 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-[0.2em]">
                    <Database className="w-3.5 h-3.5" />
                    <span>Fonti ed Estratti ({(message.vectorMemories.declarative.length || 0) + (message.vectorMemories.episodic.length || 0)})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[...message.vectorMemories.declarative, ...message.vectorMemories.episodic].slice(0, 4).map((source, sIdx) => (
                      <div key={sIdx} className="group relative p-3 rounded-xl bg-surface-50/50 dark:bg-surface-800/20 border border-surface-200/60 dark:border-surface-700/40 hover:border-indigo-500/30 hover:bg-white dark:hover:bg-surface-800/40 shadow-sm transition-all duration-300">
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-[9px] font-bold text-surface-400 dark:text-surface-500 uppercase">Riferimento #{sIdx + 1}</span>
                          <div className="flex items-center gap-1.5">
                            <div className="w-12 h-1 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-500" style={{ width: `${Math.min(source.score * 100, 100)}%` }} />
                            </div>
                            <span className="text-[9px] text-surface-500 font-medium">{(source.score * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                        <p className="text-[11px] text-surface-600 dark:text-surface-300 line-clamp-2 leading-relaxed italic">
                          "{source.content}"
                        </p>
                        {source.metadata?.originalName && (
                          <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-indigo-600/70 dark:text-indigo-400/70 font-semibold group-hover:text-indigo-600 transition-colors">
                            <Paperclip className="w-3 h-3" />
                            <span className="truncate">{source.metadata.originalName}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {message.timestamp && (
                <div className="mt-4 text-[10px] text-surface-400 flex items-center gap-3">
                  <span>{message.timestamp}</span>
                  {message.role === 'assistant' && message.content.length > 50 && !isStreaming && currentConversationId && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onGenerateDocument(index, 'docx')}
                        disabled={generatingDoc !== null}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-surface-100 dark:bg-surface-800 hover:bg-primary-100 dark:hover:bg-primary-900/30 text-surface-600 dark:text-surface-400 hover:text-primary-700 dark:hover:text-primary-400 transition-colors disabled:opacity-50"
                        title="Scarica come Word"
                      >
                        {generatingDoc === index ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <FileText className="w-2.5 h-2.5" />}
                        Word
                      </button>
                      <button
                        onClick={() => onGenerateDocument(index, 'pdf')}
                        disabled={generatingDoc !== null}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-surface-100 dark:bg-surface-800 hover:bg-red-100 dark:hover:bg-red-900/30 text-surface-600 dark:text-surface-400 hover:text-red-700 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                        title="Scarica come PDF"
                      >
                        {generatingDoc === index ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <FileText className="w-2.5 h-2.5" />}
                        PDF
                      </button>
                    </div>
                  )}
                  {/* AI Act: Feedback buttons (GAP-9) */}
                  {message.role === 'assistant' && message.id && (index < messages.length - 1 || !isStreaming) && (
                    <FeedbackButtons messageId={message.id} />
                  )}
                </div>
              )}

              {/* AI Act: AI Generated Label (GAP-2) */}
              {message.role === 'assistant' && message.content && (index < messages.length - 1 || !isStreaming) && (
                <div className="mt-1">
                  <AIGeneratedLabel model={message.ai_model} provider={message.ai_provider} />
                </div>
              )}
              {/* AI Act: Sensitive Topic Warning (GAP-10) */}
              {message.role === 'assistant' && message.safety_disclaimer && (
                <SensitiveTopicWarning disclaimer={message.safety_disclaimer} topics={message.safety_topics || []} />
              )}
            </div>
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}
