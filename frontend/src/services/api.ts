import axios from 'axios';
import { useAuthStore } from '../hooks/useAuthStore';

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
  attachmentIds?: number[]
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
      attachmentIds
    })
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
  onVectorMemories?: (memories: { episodic: any[]; declarative: any[]; procedural: any[] }) => void
): Promise<void> {
  // Get token from Zustand store for consistency
  let token = useAuthStore.getState().accessToken || '';

  let response = await makeStreamRequest(token, model, message, conversationId, systemPrompt, attachmentIds);

  // Handle 401 - try to refresh token first before logging out
  if (response.status === 401) {
    console.warn('[StreamChat] Token expired - attempting refresh');
    try {
      // Try to refresh the token
      const refreshResponse = await api.post('/auth/refresh');
      const { accessToken } = refreshResponse.data;

      // Update store with new token
      useAuthStore.setState({ accessToken });
      token = accessToken;

      // Retry the request with new token
      response = await makeStreamRequest(token, model, message, conversationId, systemPrompt, attachmentIds);

      // If still 401 after refresh, then logout
      if (response.status === 401) {
        console.warn('[StreamChat] Still unauthorized after refresh - forcing logout');
        forceLogout();
        onError('Session expired. Please login again.');
        return;
      }
    } catch (refreshError) {
      console.warn('[StreamChat] Token refresh failed - forcing logout');
      forceLogout();
      onError('Session expired. Please login again.');
      return;
    }
  }

  if (!response.ok) {
    try {
      const errorData = await response.json();
      onError(errorData.error || 'Failed to send message');
    } catch {
      onError(`Request failed with status ${response.status}`);
    }
    return;
  }

  const convId = parseInt(response.headers.get('X-Conversation-Id') || '0');
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    onError('No response stream');
    return;
  }

  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // Keep the last potentially incomplete line in the buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.error) {
            onError(data.error);
            return;
          }
          if (data.type === 'vector_memories' && data.memories && onVectorMemories) {
            onVectorMemories(data.memories);
          }
          if (data.thinking && onThinking) {
            onThinking(data.thinking, false);
          }
          if (data.thinkingDone && onThinking) {
            onThinking('', true);
          }
          if (data.content) {
            onChunk(data.content);
          }
          if (data.done) {
            onDone(data.conversationId || convId);
            return;
          }
        } catch {
          // Ignore parse errors for incomplete chunks
        }
      }
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
): Promise<{ success: boolean; url: string; filename: string }> {
  const response = await api.post('/tools/generate-from-chat', {
    conversationId,
    format,
    content,
    title: title || 'Documento_Chat'
  });
  return response.data;
}
