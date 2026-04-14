import axios from 'axios';
import { useAuthStore } from '../hooks/useAuthStore';
import { isNativePlatform } from '../utils/platform';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  }
});

// Flag to prevent multiple simultaneous refresh attempts
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

// Subscribe to token refresh
const subscribeTokenRefresh = (cb: (token: string) => void) => {
  refreshSubscribers.push(cb);
};

// Notify all subscribers when token is refreshed
const onTokenRefreshed = (token: string) => {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
};

// Force logout - uses Zustand store's getState() to access outside components
// Best practice: https://docs.pmnd.rs/zustand/guides/using-zustand-without-react
const forceLogout = () => {
  console.warn('[API] Session expired - forcing logout');

  // Clear the Zustand store state directly (don't call logout() to avoid API call)
  // This prevents circular dependency issues and works when token is already invalid
  useAuthStore.setState({
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isLoading: false,
    error: 'Session expired. Please login again.'
  });

  // Navigate to login page
  window.location.href = '/login';
};

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  // Get token directly from Zustand store for consistency
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Skip interceptor for auth endpoints to prevent loops
    if (originalRequest.url?.includes('/auth/')) {
      return Promise.reject(error);
    }

    // Handle 401 Unauthorized
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // If already refreshing, queue this request
      if (isRefreshing) {
        return new Promise((resolve) => {
          subscribeTokenRefresh((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
        });
      }

      isRefreshing = true;

      try {
        const response = await api.post('/auth/refresh');
        const { accessToken } = response.data;

        // Update Zustand store directly
        useAuthStore.setState({ accessToken });

        // Notify queued requests
        onTokenRefreshed(accessToken);

        isRefreshing = false;

        // Retry original request with new token
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        refreshSubscribers = [];

        // Refresh failed - force logout
        forceLogout();

        // Important: return rejected promise to stop promise chain
        return Promise.reject(refreshError);
      }
    }

    // Handle 403 Forbidden (might also indicate session issues)
    if (error.response?.status === 403) {
      console.warn('[API] Access forbidden - checking session validity');
    }

    return Promise.reject(error);
  }
);

// Helper function to make streaming request
async function makeStreamRequest(
  token: string,
  model: string,
  message: string,
  conversationId?: number,
  systemPrompt?: string,
  attachmentIds?: number[],
  useRag?: boolean,
  documentIds?: number[],
  chatMode?: string,
  forceWebSearch?: boolean,
): Promise<Response> {
  return fetch(`${API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    credentials: 'include',
    body: JSON.stringify({
      model,
      message,
      conversationId,
      systemPrompt,
      attachmentIds,
      use_rag: useRag,
      document_ids: documentIds,
      chat_mode: chatMode,
      force_web_search: forceWebSearch || undefined,
    })
  });
}

// Helper to process a single SSE line and dispatch to callbacks
function processSSELine(
  line: string,
  onChunk: (content: string) => void,
  onDone: (conversationId: number) => void,
  onError: (error: string) => void,
  convId: number,
  onThinking?: (content: string, done: boolean) => void,
  onVectorMemories?: (memories: { episodic: any[]; declarative: any[]; procedural: any[] }) => void,
  onRouting?: (routing: { tier: string; model: string; reason: string; confidence: number; effort: string }) => void,
): boolean {
  if (!line.startsWith('data: ')) return false;
  try {
    const data = JSON.parse(line.slice(6));
    if (data.error) { onError(data.error); return true; }
    if (data.routing && onRouting) onRouting(data.routing);
    if (data.type === 'vector_memories' && data.memories && onVectorMemories) onVectorMemories(data.memories);
    if (data.thinking && onThinking) onThinking(data.thinking, false);
    if (data.thinkingDone && onThinking) onThinking('', true);
    if (data.content) onChunk(data.content);
    if (data.job) {
      window.dispatchEvent(new CustomEvent('async-job-queued', {
        detail: { jobId: data.job.id, eta: data.job.eta, conversationId: data.conversationId, estimatedTokens: data.job.estimatedTokens }
      }));
    }
    if (data.done) { onDone(data.conversationId || convId); return true; }
  } catch { /* Ignore parse errors for incomplete chunks */ }
  return false;
}

// Native streaming using capacitor-stream-http plugin (bypasses WebView fetch entirely)
async function streamChatNative(
  model: string,
  message: string,
  onChunk: (content: string) => void,
  onDone: (conversationId: number) => void,
  onError: (error: string) => void,
  conversationId?: number,
  systemPrompt?: string,
  attachmentIds?: number[],
  onThinking?: (content: string, done: boolean) => void,
  onVectorMemories?: (memories: { episodic: any[]; declarative: any[]; procedural: any[] }) => void,
  onRouting?: (routing: { tier: string; model: string; reason: string; confidence: number; effort: string }) => void,
  useRag?: boolean,
  documentIds?: number[],
  chatMode?: string,
  forceWebSearch?: boolean,
): Promise<void> {
  const token = useAuthStore.getState().accessToken || '';
  const { StreamHttp } = await import('capacitor-stream-http');

  return new Promise<void>(async (resolve) => {
    let buffer = '';
    let resolved = false;
    const listeners: Array<{ remove: () => void }> = [];
    const done = () => {
      if (!resolved) {
        resolved = true;
        listeners.forEach(l => l.remove());
        resolve();
      }
    };

    // Listen for chunks (plugin sends { id, chunk })
    listeners.push(await StreamHttp.addListener('chunk', (event: any) => {
      buffer += event.chunk || '';
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (processSSELine(line, onChunk, onDone, onError, 0, onThinking, onVectorMemories, onRouting)) {
          done();
          return;
        }
      }
    }));

    listeners.push(await StreamHttp.addListener('end', () => done()));
    listeners.push(await StreamHttp.addListener('error', (event: any) => {
      onError(event.error || 'Stream error');
      done();
    }));

    StreamHttp.startStream({
      url: `${API_BASE_URL}/chat/completions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ model, message, conversationId, systemPrompt, attachmentIds, use_rag: useRag, document_ids: documentIds, chat_mode: chatMode, force_web_search: forceWebSearch || undefined }),
    }).catch((err: any) => {
      onError(err?.message || 'Failed to start stream');
      done();
    });
  });
}

// Chat API with SSE streaming
export async function streamChat(
  model: string,
  message: string,
  onChunk: (content: string) => void,
  onDone: (conversationId: number) => void,
  onError: (error: string) => void,
  conversationId?: number,
  systemPrompt?: string,
  attachmentIds?: number[],
  onThinking?: (content: string, done: boolean) => void,
  onVectorMemories?: (memories: { episodic: any[]; declarative: any[]; procedural: any[] }) => void,
  onRouting?: (routing: { tier: string; model: string; reason: string; confidence: number; effort: string }) => void,
  useRag?: boolean,
  documentIds?: number[],
  chatMode?: string,
  forceWebSearch?: boolean,
): Promise<void> {
  // On native platforms, use capacitor-stream-http for real native streaming
  if (isNativePlatform()) {
    return streamChatNative(model, message, onChunk, onDone, onError, conversationId, systemPrompt, attachmentIds, onThinking, onVectorMemories, onRouting, useRag, documentIds, chatMode, forceWebSearch);
  }

  // Desktop: standard fetch + ReadableStream
  let token = useAuthStore.getState().accessToken || '';
  let response = await makeStreamRequest(token, model, message, conversationId, systemPrompt, attachmentIds, useRag, documentIds, chatMode, forceWebSearch);

  // Handle 401 - try to refresh token first before logging out
  if (response.status === 401) {
    try {
      const refreshResponse = await api.post('/auth/refresh');
      const { accessToken } = refreshResponse.data;
      useAuthStore.setState({ accessToken });
      token = accessToken;
      response = await makeStreamRequest(token, model, message, conversationId, systemPrompt, attachmentIds, useRag, documentIds, chatMode, forceWebSearch);
      if (response.status === 401) { forceLogout(); onError('Session expired. Please login again.'); return; }
    } catch {
      forceLogout(); onError('Session expired. Please login again.'); return;
    }
  }

  if (!response.ok) {
    try { const d = await response.json(); onError(d.error || 'Failed to send message'); }
    catch { onError(`Request failed with status ${response.status}`); }
    return;
  }

  const convId = parseInt(response.headers.get('X-Conversation-Id') || '0');
  const reader = response.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (processSSELine(line, onChunk, onDone, onError, convId, onThinking, onVectorMemories, onRouting)) return;
      }
    }
  } else {
    const text = await response.text();
    for (const line of text.split('\n')) {
      if (processSSELine(line, onChunk, onDone, onError, convId, onThinking, onVectorMemories, onRouting)) return;
    }
  }
}

/**
 * Generate a document from a chat conversation's assistant response
 */
export async function generateDocument(
  conversationId: number,
  format: 'docx' | 'xlsx' | 'pptx' | 'pdf',
  content?: string,
  title?: string
): Promise<{ success: boolean; url: string; filename: string; attachmentId?: number }> {
  const response = await api.post('/tools/generate-from-chat', {
    conversationId,
    format,
    content,
    title: title || 'Documento_Chat'
  });
  return response.data;
}

// ─── Document Management API ─────────────────────────────────────────────────

export async function listDocuments() {
  const response = await api.get('/documents');
  return response.data.documents as any[];
}

export async function uploadDocumentApi(file: File) {
  const form = new FormData();
  form.append('file', file);
  const response = await api.post('/documents/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data.document;
}

export async function deleteDocumentApi(id: number) {
  await api.delete(`/documents/${id}`);
}

export async function getDocumentStatus(id: number) {
  const response = await api.get(`/documents/${id}`);
  return response.data.document;
}
