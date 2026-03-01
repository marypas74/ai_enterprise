/**
 * FeedbackButtons — GAP-9: Feedback AI (AI Act)
 *
 * Bottoni thumbs up/down su ogni messaggio assistant per raccogliere
 * feedback dell'utente sulla qualità della risposta AI.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { api } from '../services/api';

interface FeedbackButtonsProps {
  messageId: number | string | undefined;
}

export default function FeedbackButtons({ messageId }: FeedbackButtonsProps) {
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const numericId = typeof messageId === 'string' ? parseInt(messageId, 10) : messageId;
  const isValid = typeof numericId === 'number' && !isNaN(numericId) && numericId > 0;

  // Cleanup error timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const handleFeedback = useCallback(async (rating: 1 | -1) => {
    if (!isValid || submitting) return;

    const newFeedback = rating === 1 ? 'positive' : 'negative';
    if (feedback === newFeedback) return; // already submitted same

    setSubmitting(true);
    setSubmitError(false);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);

    try {
      await api.post('/compliance/feedback', {
        message_id: numericId,
        rating,
      });
      setFeedback(newFeedback);
    } catch {
      setSubmitError(true);
      errorTimerRef.current = setTimeout(() => setSubmitError(false), 3000);
    } finally {
      setSubmitting(false);
    }
  }, [isValid, submitting, feedback, numericId]);

  // Don't render if no valid messageId (after all hooks)
  if (!isValid) return null;

  return (
    <div className="inline-flex items-center gap-1 ml-2">
      <button
        onClick={() => handleFeedback(1)}
        disabled={submitting}
        className={`p-1 rounded transition-colors ${
          feedback === 'positive'
            ? 'text-green-600 dark:text-green-400'
            : submitError
              ? 'text-red-400'
              : 'text-surface-400 hover:text-green-600 dark:hover:text-green-400'
        }`}
        title={submitError ? 'Errore invio feedback' : 'Risposta utile'}
        aria-label="Risposta utile"
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => handleFeedback(-1)}
        disabled={submitting}
        className={`p-1 rounded transition-colors ${
          feedback === 'negative'
            ? 'text-red-600 dark:text-red-400'
            : submitError
              ? 'text-red-400'
              : 'text-surface-400 hover:text-red-600 dark:hover:text-red-400'
        }`}
        title={submitError ? 'Errore invio feedback' : 'Risposta non utile'}
        aria-label="Risposta non utile"
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
      {submitError && (
        <span className="text-xs text-red-500 ml-1" role="alert">Errore</span>
      )}
    </div>
  );
}
