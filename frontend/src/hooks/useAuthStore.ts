import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../services/api';

// Proactive refresh: fire ~1 minute before the JWT expires to avoid 401 bursts
// from the response interceptor when many parallel requests hit an expired token.
const REFRESH_MARGIN_MS = 60_000;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function decodeJwtExpMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const payload = JSON.parse(atob(b64));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function clearProactiveRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleProactiveRefresh(token: string, refresh: () => Promise<void>) {
  clearProactiveRefresh();
  const expMs = decodeJwtExpMs(token);
  if (expMs === null) return;
  const delay = Math.max(expMs - REFRESH_MARGIN_MS - Date.now(), 0);
  refreshTimer = setTimeout(() => {
    refresh().catch(() => { /* refresh handles its own failure */ });
  }, delay);
}

// DEBT-88-B: visibilitychange handler — fix browser throttling on inactive tabs.
// When the user returns to the tab, if the token is about to expire (< MARGIN),
// force an immediate refresh. setTimeout in background tabs can be heavily
// throttled by browsers and miss the scheduled refresh slot.
function isTokenAboutToExpire(token: string): boolean {
  const expMs = decodeJwtExpMs(token);
  if (expMs === null) return false;
  return expMs - REFRESH_MARGIN_MS - Date.now() <= 0;
}

let visibilityListenerInstalled = false;
function installVisibilityListener(getToken: () => string | null, refresh: () => Promise<void>) {
  if (visibilityListenerInstalled || typeof document === 'undefined') return;
  visibilityListenerInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const token = getToken();
    if (token && isTokenAboutToExpire(token)) {
      refresh().catch(() => { /* refresh handles its own failure */ });
    }
  });
}

interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
  mfa_enabled?: boolean;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string, totpCode?: string) => Promise<any>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email, password, totpCode) => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.post('/auth/login', { email, password, totp_code: totpCode });
          const { accessToken, user, mfa_required, mfa_setup_required } = response.data;

          if (mfa_required) {
            set({ isLoading: false });
            return response.data;
          }

          if (mfa_setup_required) {
            set({
              user,
              accessToken,
              isAuthenticated: true, // Allow access to Settings page
              isLoading: false
            });
            scheduleProactiveRefresh(accessToken, () => get().refreshToken());
            installVisibilityListener(() => get().accessToken, () => get().refreshToken());
            return response.data;
          }

          set({
            user,
            accessToken,
            isAuthenticated: true,
            isLoading: false
          });
          scheduleProactiveRefresh(accessToken, () => get().refreshToken());
          installVisibilityListener(() => get().accessToken, () => get().refreshToken());
          return response.data;
        } catch (err: any) {
          set({
            error: err.response?.data?.error || 'Login failed',
            isLoading: false
          });
          throw err;
        }
      },

      register: async (email, password, name) => {
        set({ isLoading: true, error: null });
        try {
          await api.post('/auth/register', { email, password, name });
          // Auto-login after registration
          await get().login(email, password);
        } catch (err: any) {
          set({
            error: err.response?.data?.error || 'Registration failed',
            isLoading: false
          });
          throw err;
        }
      },

      logout: async () => {
        clearProactiveRefresh();
        try {
          await api.post('/auth/logout');
        } catch {
          // Ignore logout errors
        }
        set({
          user: null,
          accessToken: null,
          isAuthenticated: false
        });
      },

      refreshToken: async () => {
        try {
          const response = await api.post('/auth/refresh');
          const { accessToken } = response.data;
          set({ accessToken });
          scheduleProactiveRefresh(accessToken, () => get().refreshToken());
          // DEBT-88-B: install visibilitychange listener (idempotent, once per session)
          installVisibilityListener(() => get().accessToken, () => get().refreshToken());
        } catch {
          clearProactiveRefresh();
          set({
            user: null,
            accessToken: null,
            isAuthenticated: false
          });
        }
      },

      clearError: () => set({ error: null })
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated
      })
    }
  )
);
