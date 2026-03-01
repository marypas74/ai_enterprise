/**
 * useAuthStore — sample tests to verify frontend test infrastructure.
 *
 * Tests:
 * 1. Initial state is not authenticated
 * 2. Login sets user and token
 * 3. Logout clears state
 * 4. clearError resets the error field
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from './useAuthStore';
import { api } from '../services/api';

// Get a reference to the mocked api
const mockApi = vi.mocked(api);

describe('useAuthStore', () => {
  beforeEach(() => {
    // Reset the store to initial state between tests
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should start with user as null', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
    });

    it('should start with accessToken as null', () => {
      const state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
    });

    it('should start as not authenticated', () => {
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
    });

    it('should start with no loading', () => {
      const state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
    });

    it('should start with no error', () => {
      const state = useAuthStore.getState();
      expect(state.error).toBeNull();
    });
  });

  describe('login', () => {
    it('should set user and token on successful login', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        name: 'Test User',
        role: 'user' as const,
        mfa_enabled: false,
      };

      mockApi.post.mockResolvedValueOnce({
        data: {
          accessToken: 'mock-jwt-token',
          user: mockUser,
        },
      } as any);

      await useAuthStore.getState().login('test@example.com', 'password123');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.accessToken).toBe('mock-jwt-token');
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should call api.post with correct payload', async () => {
      mockApi.post.mockResolvedValueOnce({
        data: { accessToken: 'token', user: { id: 1 } },
      } as any);

      await useAuthStore.getState().login('user@test.com', 'pass123', '123456');

      expect(mockApi.post).toHaveBeenCalledWith('/auth/login', {
        email: 'user@test.com',
        password: 'pass123',
        totp_code: '123456',
      });
    });

    it('should set error on failed login', async () => {
      mockApi.post.mockRejectedValueOnce({
        response: { data: { error: 'Invalid credentials' } },
      });

      await expect(
        useAuthStore.getState().login('bad@test.com', 'wrong')
      ).rejects.toBeDefined();

      const state = useAuthStore.getState();
      expect(state.error).toBe('Invalid credentials');
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it('should return mfa_required response without setting auth', async () => {
      mockApi.post.mockResolvedValueOnce({
        data: { mfa_required: true, message: 'TOTP code required' },
      } as any);

      const result = await useAuthStore.getState().login('user@test.com', 'pass');

      expect(result.mfa_required).toBe(true);
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
    });
  });

  describe('logout', () => {
    it('should clear user, token, and authentication state', async () => {
      // First, set an authenticated state
      useAuthStore.setState({
        user: { id: 1, email: 'test@test.com', name: 'Test', role: 'user' },
        accessToken: 'some-token',
        isAuthenticated: true,
      });

      // Mock the logout API call
      mockApi.post.mockResolvedValueOnce({ data: {} } as any);

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });

    it('should clear state even if API call fails', async () => {
      useAuthStore.setState({
        user: { id: 1, email: 'test@test.com', name: 'Test', role: 'user' },
        accessToken: 'some-token',
        isAuthenticated: true,
      });

      // Mock API failure
      mockApi.post.mockRejectedValueOnce(new Error('Network error'));

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('clearError', () => {
    it('should reset error to null', () => {
      useAuthStore.setState({ error: 'Some error message' });

      useAuthStore.getState().clearError();

      expect(useAuthStore.getState().error).toBeNull();
    });
  });
});
