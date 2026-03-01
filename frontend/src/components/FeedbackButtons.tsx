/**
 * FeedbackButtons — GAP-9: Feedback AI (AI Act)
 *
 * Bottoni thumbs up/down su ogni messaggio assistant per raccogliere
 * feedback dell'utente sulla qualità della risposta AI.
 * Include selezione categoria per feedback negativo.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { api } from '../services/api';

interface FeedbackButtonsProps {
  messageId: number | string | undefined;
}

const NEGATIVE_CATEGORIES = [
  { value: 'inaccurate', label: 'Impreciso' },
  { value: 'harmful', label: 'Dannoso' },
  { value: 'biased', label: 'Parziale' },
  { value: 'other', label: 'Altro' },
] as const;

export default function FeedbackButtons({ messageId }: FeedbackButtonsProps) {
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const categoryRef = useRef<HTMLDivElement>(null);

  const numericId = typeof messageId === 'string' ? parseInt(messageId, 10) : messageId;
  const isValid = typeof numericId === 'number' && !isNaN(numericId) && numericId > 0;

  // Cleanup error timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // Close category dropdown on outside click
  useEffect(() => {
    if (!showCategories) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (categoryRef.current && !categoryRef.current.contains(e.target as Node)) {
        setShowCategories(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCategories]);

  const submitFeedback = useCallback(async (rating: 1 | -1, category?: string) => {
    if (!isValid || submitting) return;

    setSubmitting(true);
    setSubmitError(false);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);

    try {
      await api.post('/compliance/feedback', {
        message_id: numericId,
        rating,
        ...(category ? { category } : {}),
      });
      setFeedback(rating === 1 ? 'positive' : 'negative');
      setShowCategories(false);
    } catch {
      setSubmitError(true);
      errorTimerRef.current = setTimeout(() => setSubmitError(false), 3000);
    } finally {
      setSubmitting(false);
    }
  }, [isValid, submitting, numericId]);

  const handleFeedback = useCallback((rating: 1 | -1) => {
    if (rating === 1) {
      if (feedback === 'positive') return;
      submitFeedback(1);
    } else {
      if (feedback === 'negative') return;
      setShowCategories(true);
    }
  }, [feedback, submitFeedback]);

  // Don't render if no valid messageId (after all hooks)
  if (!isValid) return null;

  return (
    <div className="inline-flex items-center gap-1 ml-2 relative" ref={categoryRef}>
      <button
        onClick={() => handleFeedback(1)}
        disabled={submitting}
        aria-pressed={feedback === 'positive'}
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
        aria-pressed={feedback === 'negative'}
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
      {showCategories && (
        <div className="absolute bottom-full left-0 mb-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg p-2 z-10 min-w-[140px]" role="menu">
          <p className="text-xs text-surface-500 mb-1 px-1">Motivo:</p>
          {NEGATIVE_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              role="menuitem"
              onClick={() => submitFeedback(-1, cat.value)}
              disabled={submitting}
              className="block w-full text-left text-xs px-2 py-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-300"
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
