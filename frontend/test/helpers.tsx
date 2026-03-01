/**
 * Test helper utilities for the frontend test suite.
 *
 * Provides:
 * - renderWithProviders()  — renders a component wrapped in MemoryRouter
 * - mockAuthStore()        — creates a mock auth store state with overrides
 * - createMockUser()       — creates a mock user object
 */

import React, { type ReactElement } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';

// ────────────────────────────────────────────────────────────
// renderWithProviders — wraps component in MemoryRouter + providers
// ────────────────────────────────────────────────────────────

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial route entries for MemoryRouter */
  initialEntries?: MemoryRouterProps['initialEntries'];
  /** Initial index in the history stack */
  initialIndex?: number;
}

interface RenderWithProvidersResult extends RenderResult {
  /** user-event instance for simulating interactions */
  user: ReturnType<typeof userEvent.setup>;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {}
): RenderWithProvidersResult {
  const {
    initialEntries = ['/'],
    initialIndex,
    ...renderOptions
  } = options;

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        {children}
      </MemoryRouter>
    );
  }

  const user = userEvent.setup();
  const result = render(ui, { wrapper: Wrapper, ...renderOptions });

  return { ...result, user };
}

// ────────────────────────────────────────────────────────────
// mockAuthStore — create mock auth store state
// ────────────────────────────────────────────────────────────

interface MockUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
  mfa_enabled?: boolean;
}

interface MockAuthState {
  user: MockUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
    mfa_enabled: false,
    ...overrides,
  };
}

export function mockAuthStore(overrides: Partial<MockAuthState> = {}): MockAuthState {
  return {
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    ...overrides,
  };
}

/**
 * Creates an authenticated mock auth state with a user and token.
 */
export function mockAuthenticatedState(
  userOverrides: Partial<MockUser> = {}
): MockAuthState {
  return {
    user: createMockUser(userOverrides),
    accessToken: 'mock-jwt-token',
    isAuthenticated: true,
    isLoading: false,
    error: null,
  };
}
