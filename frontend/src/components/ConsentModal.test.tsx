/**
 * ConsentModal — Unit tests for the consent modal component.
 *
 * Tests cover:
 * - Rendering the modal with all consent checkboxes
 * - Accept button is disabled until all checkboxes checked
 * - Successful consent submission
 * - Error handling on submission failure
 * - Logout button (Rifiuta e disconnettiti)
 * - Dialog role and aria attributes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../services/api';

const mockApi = vi.mocked(api);

// Mock useAuthStore before importing ConsentModal
const mockLogout = vi.fn();
vi.mock('../hooks/useAuthStore', () => ({
  useAuthStore: (selector?: any) => {
    const state = { logout: mockLogout };
    if (typeof selector === 'function') return selector(state);
    return state;
  },
}));

import ConsentModal from './ConsentModal';

describe('ConsentModal', () => {
  const mockOnConsented = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderModal = () => {
    return render(
      <MemoryRouter>
        <ConsentModal onConsented={mockOnConsented} />
      </MemoryRouter>
    );
  };

  it('should render the modal with title', () => {
    renderModal();
    expect(screen.getByText('Consensi richiesti')).toBeInTheDocument();
    expect(screen.getByText('AI Act (UE 2024/1689) e GDPR')).toBeInTheDocument();
  });

  it('should have a dialog role with aria-modal', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('should render all three consent checkboxes', () => {
    renderModal();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
  });

  it('should render consent descriptions', () => {
    renderModal();
    expect(screen.getByText(/Consenso all'interazione con sistemi AI/)).toBeInTheDocument();
    expect(screen.getByText(/Trattamento dei dati personali/)).toBeInTheDocument();
    // Third consent - "Termini di Servizio" appears as bold label
    const tosLabels = screen.getAllByText(/Termini di Servizio/);
    expect(tosLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('should have accept button disabled by default', () => {
    renderModal();
    const acceptButton = screen.getByRole('button', { name: /Accetta e continua/ });
    expect(acceptButton).toBeDisabled();
  });

  it('should enable accept button when all checkboxes are checked', async () => {
    const user = userEvent.setup();
    renderModal();

    const checkboxes = screen.getAllByRole('checkbox');
    for (const checkbox of checkboxes) {
      await user.click(checkbox);
    }

    const acceptButton = screen.getByRole('button', { name: /Accetta e continua/ });
    expect(acceptButton).not.toBeDisabled();
  });

  it('should keep accept button disabled if only some checkboxes are checked', async () => {
    const user = userEvent.setup();
    renderModal();

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);

    const acceptButton = screen.getByRole('button', { name: /Accetta e continua/ });
    expect(acceptButton).toBeDisabled();
  });

  it('should submit all three consents and call onConsented on accept', async () => {
    mockApi.post.mockResolvedValue({ data: {} } as any);
    const user = userEvent.setup();
    renderModal();

    const checkboxes = screen.getAllByRole('checkbox');
    for (const checkbox of checkboxes) {
      await user.click(checkbox);
    }

    await user.click(screen.getByRole('button', { name: /Accetta e continua/ }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledTimes(3);
      expect(mockApi.post).toHaveBeenCalledWith('/compliance/consent', {
        consent_type: 'ai_disclosure',
        granted: true,
      });
      expect(mockApi.post).toHaveBeenCalledWith('/compliance/consent', {
        consent_type: 'data_processing',
        granted: true,
      });
      expect(mockApi.post).toHaveBeenCalledWith('/compliance/consent', {
        consent_type: 'terms_of_service',
        granted: true,
      });
      expect(mockOnConsented).toHaveBeenCalled();
    });
  });

  it('should show error message when consent submission fails', async () => {
    mockApi.post.mockRejectedValueOnce(new Error('Network error'));
    const user = userEvent.setup();
    renderModal();

    const checkboxes = screen.getAllByRole('checkbox');
    for (const checkbox of checkboxes) {
      await user.click(checkbox);
    }

    await user.click(screen.getByRole('button', { name: /Accetta e continua/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Errore durante il salvataggio dei consensi/)).toBeInTheDocument();
    });
  });

  it('should call logout when decline button is clicked', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: /Rifiuta e disconnettiti/ }));
    expect(mockLogout).toHaveBeenCalled();
  });

  it('should have privacy policy link', () => {
    renderModal();
    const privacyLink = screen.getByRole('link', { name: 'Privacy Policy' });
    expect(privacyLink).toHaveAttribute('href', '/privacy');
  });

  it('should have terms of service link', () => {
    renderModal();
    const tosLink = screen.getByRole('link', { name: 'Termini di Servizio' });
    expect(tosLink).toHaveAttribute('href', '/terms');
  });
});
