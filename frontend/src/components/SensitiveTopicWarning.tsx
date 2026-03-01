/**
 * SensitiveTopicWarning — GAP-10: Human Oversight (AI Act)
 *
 * Banner di avviso per topic sensibili (medical, legal, financial, hiring).
 * Mostrato quando il backend rileva contenuti su argomenti che richiedono
 * supervisione umana.
 */

import { AlertTriangle } from 'lucide-react';

interface SensitiveTopicWarningProps {
  disclaimer: string;
  topics: string[];
}

export default function SensitiveTopicWarning({ disclaimer, topics }: SensitiveTopicWarningProps) {
  if (!disclaimer?.trim()) return null;

  return (
    <div role="alert" className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-amber-800 dark:text-amber-300 whitespace-pre-line">
            {disclaimer}
          </p>
          {topics.length > 0 && (
            <div className="flex gap-1 mt-2">
              {topics.map(topic => (
                <span
                  key={topic}
                  className="px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 rounded-full"
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
