/**
 * AIDisclosureBanner — Unit tests for the AI disclosure banner component.
 *
 * Tests cover:
 * - Rendering default disclosure text
 * - Displaying model name when provided
 * - Dismiss button hides the banner
 * - Fetching custom banner text from API
 * - Re-showing banner when conversationId changes
 * - Not rendering when banner_enabled is false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AIDisclosureBanner from './AIDisclosureBanner';
import { api } from '../services/api';

const mockApi = vi.mocked(api);

describe('AIDisclosureBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: API returns empty/default config
    mockApi.get.mockResolvedValue({ data: {} } as any);
  });

  it('should render default disclosure text', async () => {
    render(<AIDisclosureBanner />);

    expect(
      screen.getByText(/Stai interagendo con un sistema di intelligenza artificiale/)
    ).toBeInTheDocument();
  });

  it('should display model name when provided', async () => {
    render(<AIDisclosureBanner modelName="GPT-4o" />);

    await waitFor(() => {
      expect(screen.getByText(/Modello attivo: GPT-4o/)).toBeInTheDocument();
    });
  });

  it('should not display model line when modelName is not provided', () => {
    render(<AIDisclosureBanner />);

    expect(screen.queryByText(/Modello attivo:/)).not.toBeInTheDocument();
  });

  it('should hide the banner when dismiss button is clicked', async () => {
    render(<AIDisclosureBanner />);

    const dismissButton = screen.getByLabelText('Chiudi banner informativa AI');
    fireEvent.click(dismissButton);

    expect(
      screen.queryByText(/Stai interagendo con un sistema di intelligenza artificiale/)
    ).not.toBeInTheDocument();
  });

  it('should fetch custom banner text from API', async () => {
    mockApi.get.mockResolvedValueOnce({
      data: { banner_text: 'Custom AI disclosure text' },
    } as any);

    render(<AIDisclosureBanner />);

    await waitFor(() => {
      expect(screen.getByText('Custom AI disclosure text')).toBeInTheDocument();
    });
  });

  it('should not render when banner_enabled is false from API', async () => {
    mockApi.get.mockResolvedValueOnce({
      data: { banner_enabled: false },
    } as any);

    const { container } = render(<AIDisclosureBanner />);

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('should call compliance/disclosure endpoint on mount', () => {
    render(<AIDisclosureBanner />);

    expect(mockApi.get).toHaveBeenCalledWith('/compliance/disclosure');
  });

  it('should re-show banner when conversationId changes', async () => {
    const { rerender } = render(<AIDisclosureBanner conversationId={1} />);

    // Dismiss the banner
    const dismissButton = screen.getByLabelText('Chiudi banner informativa AI');
    fireEvent.click(dismissButton);

    // Banner should be hidden
    expect(
      screen.queryByText(/Stai interagendo con un sistema di intelligenza artificiale/)
    ).not.toBeInTheDocument();

    // Change conversationId
    rerender(<AIDisclosureBanner conversationId={2} />);

    // Banner should be visible again
    expect(
      screen.getByText(/Stai interagendo con un sistema di intelligenza artificiale/)
    ).toBeInTheDocument();
  });

  it('should use default text when API call fails', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('Network error'));

    render(<AIDisclosureBanner />);

    // Should still show default text
    expect(
      screen.getByText(/Stai interagendo con un sistema di intelligenza artificiale/)
    ).toBeInTheDocument();
  });

  it('should have an accessible dismiss button with title', () => {
    render(<AIDisclosureBanner />);

    const button = screen.getByLabelText('Chiudi banner informativa AI');
    expect(button).toHaveAttribute('title', 'Chiudi');
  });
});
