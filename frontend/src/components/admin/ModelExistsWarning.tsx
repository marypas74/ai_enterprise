import { AlertTriangle } from 'lucide-react';

/**
 * Payload returned by backend when an admin tries to save a model id that
 * does not exist on the upstream provider.
 *
 * Mirrors `mapModelExistsErrorBody` in
 * `backend/src/modules/admin/modelExistsCheck.ts`.
 */
export interface ModelNotFoundOnProvider {
    code: 'MODEL_NOT_FOUND_ON_PROVIDER';
    model_id: string;
    provider: string;
    suggestion: string;
    reason?: string;
}

interface Props {
    payload: ModelNotFoundOnProvider;
    forceSave: boolean;
    onForceSaveChange: (next: boolean) => void;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Inline warning surfaced when the backend returns 422 with
 * MODEL_NOT_FOUND_ON_PROVIDER. Lets the admin opt-in to a forced save.
 */
export function ModelExistsWarning({ payload, forceSave, onForceSaveChange, onConfirm, onCancel }: Props) {
    return (
        <div
            role="alert"
            data-testid="model-exists-warning"
            className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100"
        >
            <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                    <div>
                        <strong>Modello non trovato su {payload.provider}</strong>
                    </div>
                    <p className="text-amber-800 dark:text-amber-200">{payload.suggestion}</p>
                    <label className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
                        <input
                            type="checkbox"
                            checked={forceSave}
                            onChange={(e) => onForceSaveChange(e.target.checked)}
                            className="h-4 w-4 rounded border-amber-500 text-amber-600 focus:ring-amber-500"
                        />
                        Salva comunque (force=true)
                    </label>
                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="rounded border border-amber-400 px-3 py-1 text-amber-900 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-100 dark:hover:bg-amber-900/40"
                        >
                            Annulla
                        </button>
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={!forceSave}
                            className="rounded bg-amber-600 px-3 py-1 text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Conferma salvataggio
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Type guard for the 422 envelope.
 */
export function isModelNotFoundOnProvider(value: unknown): value is ModelNotFoundOnProvider {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        v.code === 'MODEL_NOT_FOUND_ON_PROVIDER' &&
        typeof v.model_id === 'string' &&
        typeof v.provider === 'string' &&
        typeof v.suggestion === 'string'
    );
}
