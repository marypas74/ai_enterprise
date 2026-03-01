/**
 * LoginPage — Unit tests for the login page component.
 *
 * Tests cover:
 * - Rendering email and password fields
 * - Rendering sign in button
 * - Form submission calls login
 * - Error display
 * - MFA flow (showing TOTP input)
 * - Loading state disables button
 * - Version display
 * - Privacy/terms links
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// We must mock useAuthStore before importing LoginPage
const mockLogin = vi.fn();
const mockClearError = vi.fn();
let mockStoreState = {
  login: mockLogin,
  isLoading: false,
  error: null as string | null,
  clearError: mockClearError,
};

vi.mock('../hooks/useAuthStore', () => ({
  useAuthStore: (selector?: any) => {
    if (typeof selector === 'function') {
      return selector(mockStoreState);
    }
    return mockStoreState;
  },
}));

// Mock version
vi.mock('../version', () => ({
  APP_VERSION: '1.0.0-test',
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Now import LoginPage after mocks are set up
import LoginPage from './LoginPage';

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState = {
      login: mockLogin,
      isLoading: false,
      error: null,
      clearError: mockClearError,
    };

    // Mock fetch for version endpoint
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ version: '1.0.0-test' }),
    });
  });

  const renderLoginPage = () => {
    return render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
  };

  it('should render the email input field', () => {
    renderLoginPage();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
  });

  it('should render the password input field', () => {
    renderLoginPage();
    expect(screen.getByPlaceholderText('Your password')).toBeInTheDocument();
  });

  it('should render the Sign In button', () => {
    renderLoginPage();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('should render the Enterprise AI heading', () => {
    renderLoginPage();
    expect(screen.getByText('Enterprise AI')).toBeInTheDocument();
    expect(screen.getByText('Chat Platform')).toBeInTheDocument();
  });

  it('should call login on form submission', async () => {
    mockLogin.mockResolvedValueOnce({});
    const user = userEvent.setup();

    renderLoginPage();

    await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com');
    await user.type(screen.getByPlaceholderText('Your password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(mockClearError).toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123', '');
  });

  it('should navigate to / on successful login', async () => {
    mockLogin.mockResolvedValueOnce({});
    const user = userEvent.setup();

    renderLoginPage();

    await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com');
    await user.type(screen.getByPlaceholderText('Your password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('should display error message when error is set', () => {
    mockStoreState.error = 'Invalid credentials';
    renderLoginPage();
    expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
  });

  it('should show MFA input when login returns mfa_required', async () => {
    mockLogin.mockResolvedValueOnce({ mfa_required: true });
    const user = userEvent.setup();

    renderLoginPage();

    await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com');
    await user.type(screen.getByPlaceholderText('Your password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('000000')).toBeInTheDocument();
    });
  });

  it('should navigate to /settings when mfa_setup_required', async () => {
    mockLogin.mockResolvedValueOnce({ mfa_setup_required: true });
    const user = userEvent.setup();

    renderLoginPage();

    await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com');
    await user.type(screen.getByPlaceholderText('Your password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/settings');
    });
  });

  it('should disable the button when isLoading is true', () => {
    mockStoreState.isLoading = true;
    renderLoginPage();

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(screen.getByText('Signing in...')).toBeInTheDocument();
  });

  it('should show privacy policy and terms links', () => {
    renderLoginPage();
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
    expect(screen.getByText('Termini di Servizio')).toBeInTheDocument();
  });

  it('should have back-to-login link from MFA view', async () => {
    mockLogin.mockResolvedValueOnce({ mfa_required: true });
    const user = userEvent.setup();

    renderLoginPage();

    await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com');
    await user.type(screen.getByPlaceholderText('Your password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Torna al login')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Torna al login'));
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
  });
});
