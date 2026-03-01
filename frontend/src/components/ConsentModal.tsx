/**
 * ConsentModal — GAP-4: Consenso utente (AI Act + GDPR)
 *
 * Modal di consenso mostrato al primo accesso dell'utente per raccogliere
 * il consenso all'utilizzo di sistemi AI e al trattamento dei dati.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Shield } from 'lucide-react';
import { api } from '../services/api';

interface ConsentModalProps {
  onConsented: () => void;
}

export default function ConsentModal({ onConsented }: ConsentModalProps) {
  const [aiConsent, setAiConsent] = useState(false);
  const [dataConsent, setDataConsent] = useState(false);
  const [tosConsent, setTosConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const allChecked = aiConsent && dataConsent && tosConsent;

  // Focus trap: keep focus inside the modal, restore on unmount
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableSelector = 'input, button, a[href], select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableElements = dialog.querySelectorAll<HTMLElement>(focusableSelector);
    const firstEl = focusableElements[0];
    const lastEl = focusableElements[focusableElements.length - 1];

    firstEl?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      // Refresh focusable elements (button may become enabled/disabled)
      const currentFocusable = dialog.querySelectorAll<HTMLElement>(focusableSelector);
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  const handleAccept = useCallback(async () => {
    if (!allChecked || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      await Promise.all([
        api.post('/compliance/consent', { consent_type: 'ai_disclosure', granted: true }),
        api.post('/compliance/consent', { consent_type: 'data_processing', granted: true }),
        api.post('/compliance/consent', { consent_type: 'terms_of_service', granted: true }),
      ]);

      onConsented();
    } catch {
      setError('Errore durante il salvataggio dei consensi. Riprova.');
    } finally {
      setSubmitting(false);
    }
  }, [allChecked, submitting, onConsented]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-modal-title"
        className="w-full max-w-lg mx-4 bg-white dark:bg-surface-900 rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-primary-600 text-white flex items-center gap-3">
          <Shield className="w-6 h-6" />
          <div>
            <h2 id="consent-modal-title" className="text-lg font-semibold">Consensi richiesti</h2>
            <p className="text-sm text-primary-100">AI Act (UE 2024/1689) e GDPR</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-surface-600 dark:text-surface-400">
            Prima di utilizzare il servizio, ti chiediamo di leggere e accettare i seguenti consensi:
          </p>

          {/* AI Disclosure consent */}
          <label className="flex items-start gap-3 p-3 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={aiConsent}
              onChange={e => setAiConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
            />
            <div>
              <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                Consenso all'interazione con sistemi AI
              </p>
              <p className="text-xs text-surface-500 mt-1">
                Sono consapevole che le risposte sono generate da modelli di intelligenza artificiale
                e potrebbero non essere sempre accurate o aggiornate.
              </p>
            </div>
          </label>

          {/* Data processing consent */}
          <label className="flex items-start gap-3 p-3 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={dataConsent}
              onChange={e => setDataConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
            />
            <div>
              <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                Trattamento dei dati personali
              </p>
              <p className="text-xs text-surface-500 mt-1">
                Acconsento al trattamento dei miei dati personali come descritto nella{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">Privacy Policy</a>.
              </p>
            </div>
          </label>

          {/* Terms of Service consent */}
          <label className="flex items-start gap-3 p-3 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={tosConsent}
              onChange={e => setTosConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
            />
            <div>
              <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                Termini di Servizio
              </p>
              <p className="text-xs text-surface-500 mt-1">
                Ho letto e accetto i{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">Termini di Servizio</a>.
              </p>
            </div>
          </label>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-50 dark:bg-surface-800/50 flex justify-end">
          <button
            onClick={handleAccept}
            disabled={!allChecked || submitting}
            className="px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-surface-300 disabled:dark:bg-surface-700 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
          >
            {submitting ? 'Salvataggio...' : 'Accetta e continua'}
          </button>
        </div>
      </div>
    </div>
  );
}
