import { AlertTriangle, Clock } from 'lucide-react';
import { useJobStore } from '../stores/useJobStore';

/**
 * Badge nel header che mostra quanti documenti sono in elaborazione asincrona.
 * Se un job è passato a provider esterno (fallback), mostra un warning arancione.
 */
export function AsyncJobBadge() {
  const { pendingJobs, getEtaRemaining } = useJobStore();

  if (pendingJobs.length === 0) return null;

  const hasWarning = pendingJobs.some((j) => j.warningMessage);

  return (
    <div className="relative group">
      <button
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full
                   border text-xs font-medium transition-colors
                   ${hasWarning
                     ? 'bg-orange-50 dark:bg-orange-900/30 border-orange-300 dark:border-orange-600 text-orange-700 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/50'
                     : 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50'
                   }`}
        title={`${pendingJobs.length} documento${pendingJobs.length > 1 ? 'i' : ''} in elaborazione`}
      >
        {hasWarning
          ? <AlertTriangle className="w-3 h-3 animate-pulse" />
          : <Clock className="w-3 h-3 animate-pulse" />
        }
        <span>{pendingJobs.length} in elaborazione</span>
      </button>

      {/* Dropdown tooltip con dettagli per ogni job */}
      <div
        className="absolute right-0 top-full mt-2 w-72 z-50
                   bg-white dark:bg-surface-800
                   border border-surface-200 dark:border-surface-700
                   rounded-lg shadow-lg p-3
                   hidden group-hover:block"
      >
        <p className="text-xs font-semibold text-surface-500 dark:text-surface-400 mb-2 uppercase tracking-wide">
          Documenti in elaborazione
        </p>
        {pendingJobs.map((job) => {
          const remaining = getEtaRemaining(job.jobId);
          const label = remaining <= 0
            ? 'Quasi pronto...'
            : remaining < 60
            ? `~${remaining}s`
            : `~${Math.ceil(remaining / 60)} min`;
          return (
            <div key={job.jobId} className="py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-surface-600 dark:text-surface-300 truncate max-w-[180px]">
                  Conversazione #{job.conversationId}
                </span>
                <span className={`text-xs ml-2 shrink-0 ${job.warningMessage ? 'text-orange-600 dark:text-orange-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {label}
                </span>
              </div>
              {job.warningMessage && (
                <p className="mt-0.5 text-[11px] text-orange-600 dark:text-orange-400 leading-tight">
                  ⚠️ vLLM saturo — API {job.fallbackProvider?.toUpperCase() ?? 'esterne'} in uso
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
