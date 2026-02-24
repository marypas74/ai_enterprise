/**
 * ConversationalFormIndicator — Shows active form session status in the chat UI
 * Displays progress bar and current field being collected.
 */

import { ClipboardList, X, Check } from 'lucide-react';

interface FormSession {
  id: number;
  formName: string;
  state: 'incomplete' | 'complete' | 'wait_confirm' | 'closed';
  collectedFields: string[];
  missingFields: string[];
  lastQuestion: string | null;
}

interface ConversationalFormIndicatorProps {
  session: FormSession | null;
  onCancel: () => void;
  onConfirm?: (confirmed: boolean) => void;
}

export default function ConversationalFormIndicator({ session, onCancel, onConfirm }: ConversationalFormIndicatorProps) {
  if (!session || session.state === 'closed') return null;

  const totalFields = session.collectedFields.length + session.missingFields.length;
  const progress = totalFields > 0 ? (session.collectedFields.length / totalFields) * 100 : 0;

  return (
    <div className="mx-4 mb-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            {session.formName}
          </span>
          <span className="text-xs text-emerald-600 dark:text-emerald-500">
            {session.collectedFields.length}/{totalFields} fields
          </span>
        </div>
        <button
          onClick={onCancel}
          className="p-1 text-emerald-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
          title="Cancel form"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-emerald-100 dark:bg-emerald-900/40 rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* State-specific UI */}
      {session.state === 'wait_confirm' && onConfirm && (
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => onConfirm(true)}
            className="flex items-center gap-1 px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded"
          >
            <Check className="w-3 h-3" /> Confirm
          </button>
          <button
            onClick={() => onConfirm(false)}
            className="flex items-center gap-1 px-3 py-1 text-xs text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
