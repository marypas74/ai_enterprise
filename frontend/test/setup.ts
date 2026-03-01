/**
 * Global test setup for the frontend.
 *
 * Provides:
 * - @testing-library/jest-dom matchers
 * - Mock for window.matchMedia (not available in jsdom)
 * - Mock for IntersectionObserver (not available in jsdom)
 * - Mock for the API client (src/services/api.ts)
 * - Mock for react-router-dom navigation
 */

import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────
// jsdom polyfills: matchMedia, IntersectionObserver, ResizeObserver
// ────────────────────────────────────────────────────────────

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
}
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
});

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
});

// ────────────────────────────────────────────────────────────
// Mock: src/services/api.ts
// ────────────────────────────────────────────────────────────

vi.mock('../src/services/api', () => {
  const mockApi = {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
    defaults: {
      headers: { common: {} },
    },
  };
  return {
    api: mockApi,
    streamChat: vi.fn(),
    generateDocument: vi.fn(),
  };
});

// ────────────────────────────────────────────────────────────
// Mock: react-router-dom
// ────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'default' }),
    useParams: () => ({}),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

// ────────────────────────────────────────────────────────────
// Reset mocks between tests
// ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockNavigate.mockReset();
});

// ────────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────────

export { mockNavigate };
