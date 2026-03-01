/**
 * AIDisclosureBanner — GAP-1: AI Disclosure (Art. 50.1 AI Act)
 *
 * Banner persistente sopra l'area chat che informa l'utente che sta
 * interagendo con un sistema di intelligenza artificiale.
 */

import { useState, useEffect } from 'react';
import { Info, X } from 'lucide-react';
import { api } from '../services/api';

interface AIDisclosureBannerProps {
  modelName?: string;
  conversationId?: number | null;
}

export default function AIDisclosureBanner({ modelName, conversationId }: AIDisclosureBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [bannerText, setBannerText] = useState(
    'Stai interagendo con un sistema di intelligenza artificiale. Le risposte sono generate da modelli AI e potrebbero non essere sempre accurate.'
  );
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    api.get('/compliance/disclosure')
      .then(res => {
        if (res.data?.banner_text) setBannerText(res.data.banner_text);
        if (res.data?.banner_enabled === false) setEnabled(false);
      })
      .catch(() => { /* use default text */ });
  }, []);

  // Re-show on new conversation
  useEffect(() => {
    setDismissed(false);
  }, [conversationId]);

  if (!enabled || dismissed) return null;

  return (
    <div className="mx-2 sm:mx-4 mt-2 mb-1 p-2 sm:p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
      <div className="flex items-start gap-2">
        <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm text-blue-800 dark:text-blue-300">
            {bannerText}
          </p>
          {modelName && (
            <p className="text-[10px] sm:text-xs text-blue-600 dark:text-blue-500 mt-0.5 sm:mt-1">
              Modello attivo: {modelName}
            </p>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 rounded transition-colors flex-shrink-0"
          title="Chiudi"
          aria-label="Chiudi banner informativa AI"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
