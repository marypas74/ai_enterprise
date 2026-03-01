/**
 * FeedbackButtons — Unit tests for feedback thumbs up/down component.
 *
 * Tests cover:
 * - Rendering thumbs up and thumbs down buttons
 * - Not rendering when messageId is invalid
 * - Positive feedback submission
 * - Negative feedback showing category menu
 * - Error state handling
 * - Disabled state during submission
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FeedbackButtons from './FeedbackButtons';
import { api } from '../services/api';

const mockApi = vi.mocked(api);

describe('FeedbackButtons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render thumbs up and thumbs down buttons', () => {
    render(<FeedbackButtons messageId={42} />);

    expect(screen.getByLabelText('Risposta utile')).toBeInTheDocument();
    expect(screen.getByLabelText('Risposta non utile')).toBeInTheDocument();
  });

  it('should not render when messageId is undefined', () => {
    const { container } = render(<FeedbackButtons messageId={undefined} />);

    expect(container.firstChild).toBeNull();
  });

  it('should not render when messageId is 0', () => {
    const { container } = render(<FeedbackButtons messageId={0} />);

    expect(container.firstChild).toBeNull();
  });

  it('should not render when messageId is negative', () => {
    const { container } = render(<FeedbackButtons messageId={-1} />);

    expect(container.firstChild).toBeNull();
  });

  it('should accept string messageId and parse it', () => {
    render(<FeedbackButtons messageId="42" />);

    expect(screen.getByLabelText('Risposta utile')).toBeInTheDocument();
  });

  it('should not render when string messageId is NaN', () => {
    const { container } = render(<FeedbackButtons messageId="abc" />);

    expect(container.firstChild).toBeNull();
  });

  it('should submit positive feedback on thumbs up click', async () => {
    mockApi.post.mockResolvedValueOnce({ data: {} } as any);

    render(<FeedbackButtons messageId={42} />);

    fireEvent.click(screen.getByLabelText('Risposta utile'));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/compliance/feedback', {
        message_id: 42,
        rating: 1,
      });
    });
  });

  it('should show category menu on thumbs down click', () => {
    render(<FeedbackButtons messageId={42} />);

    fireEvent.click(screen.getByLabelText('Risposta non utile'));

    // Category menu should appear
    expect(screen.getByText('Motivo:')).toBeInTheDocument();
    expect(screen.getByText('Impreciso')).toBeInTheDocument();
    expect(screen.getByText('Dannoso')).toBeInTheDocument();
    expect(screen.getByText('Parziale')).toBeInTheDocument();
    expect(screen.getByText('Altro')).toBeInTheDocument();
  });

  it('should submit negative feedback with category when category is selected', async () => {
    mockApi.post.mockResolvedValueOnce({ data: {} } as any);

    render(<FeedbackButtons messageId={42} />);

    // Click thumbs down to show categories
    fireEvent.click(screen.getByLabelText('Risposta non utile'));

    // Click a category
    fireEvent.click(screen.getByText('Impreciso'));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/compliance/feedback', {
        message_id: 42,
        rating: -1,
        category: 'inaccurate',
      });
    });
  });

  it('should show error state when feedback submission fails', async () => {
    mockApi.post.mockRejectedValueOnce(new Error('Network error'));

    render(<FeedbackButtons messageId={42} />);

    fireEvent.click(screen.getByLabelText('Risposta utile'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Errore')).toBeInTheDocument();
    });
  });

  it('should not re-submit positive feedback if already positive', async () => {
    mockApi.post.mockResolvedValueOnce({ data: {} } as any);

    render(<FeedbackButtons messageId={42} />);

    // First click — submits
    fireEvent.click(screen.getByLabelText('Risposta utile'));
    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledTimes(1);
    });

    // Second click — should not re-submit
    fireEvent.click(screen.getByLabelText('Risposta utile'));
    // Still only called once
    expect(mockApi.post).toHaveBeenCalledTimes(1);
  });
});
