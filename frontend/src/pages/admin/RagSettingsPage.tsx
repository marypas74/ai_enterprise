/**
 * RagSettingsPage.tsx
 * Admin page for RAG + Web Fallback configuration.
 * Allows admins to configure:
 *   - rag_web_fallback_enabled (toggle)
 *   - rag_score_threshold (slider 0.0-1.0)
 *   - rag_web_max_results (number 1-10)
 *
 * v2.1.85 — T6 Admin Settings UI
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { Settings, Globe, FileSearch, Save, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';

interface RagSettings {
  rag_web_fallback_enabled: boolean;
  rag_score_threshold: number;
  rag_web_max_results: number;
  /** DEBT-87-A: Layer 2 — no-info detection + web retry */
  rag_layer2_enabled: boolean;
}

interface SaveStatus {
  key: string;
  status: 'saving' | 'saved' | 'error';
  message?: string;
}

const DEFAULT_SETTINGS: RagSettings = {
  rag_web_fallback_enabled: true,
  rag_score_threshold: 0.35,
  rag_web_max_results: 5,
  rag_layer2_enabled: true,
};

export default function RagSettingsPage() {
  const [settings, setSettings] = useState<RagSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await api.get('/admin/settings');
      const data = response.data as Record<string, { value: unknown }>;
      setSettings({
        rag_web_fallback_enabled: Boolean(data.rag_web_fallback_enabled?.value ?? true),
        rag_score_threshold: Number(data.rag_score_threshold?.value ?? 0.35),
        rag_web_max_results: Number(data.rag_web_max_results?.value ?? 5),
        rag_layer2_enabled: (data.rag_layer2_enabled?.value ?? 'true') === 'true' || Boolean(data.rag_layer2_enabled?.value),
      });
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Errore caricamento impostazioni');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveSetting = useCallback(async (key: string, value: unknown) => {
    setSaveStatuses(prev => ({ ...prev, [key]: { key, status: 'saving' } }));
    try {
      await api.put(`/admin/settings/${key}`, { value: String(value) });
      setSaveStatuses(prev => ({ ...prev, [key]: { key, status: 'saved' } }));
      // Clear saved status after 3 seconds
      setTimeout(() => {
        setSaveStatuses(prev => {
          const { [key]: _, ...rest } = prev;
          return rest;
        });
      }, 3000);
    } catch (err: unknown) {
      setSaveStatuses(prev => ({
        ...prev,
        [key]: {
          key,
          status: 'error',
          message: err instanceof Error ? err.message : 'Errore salvataggio',
        },
      }));
    }
  }, []);

  const handleToggle = useCallback((key: keyof RagSettings, value: boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    saveSetting(key, value);
  }, [saveSetting]);

  const handleSlider = useCallback((key: keyof RagSettings, value: number) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSliderCommit = useCallback((key: keyof RagSettings, value: number) => {
    saveSetting(key, value);
  }, [saveSetting]);

  const handleNumber = useCallback((key: keyof RagSettings, value: number) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    saveSetting(key, value);
  }, [saveSetting]);

  const StatusIcon = ({ keyName }: { keyName: string }) => {
    const status = saveStatuses[keyName];
    if (!status) return null;
    if (status.status === 'saving') return <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />;
    if (status.status === 'saved') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    return <span title={status.message}><AlertCircle className="w-4 h-4 text-red-400" /></span>;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center gap-2 p-4 rounded-lg bg-red-900/20 border border-red-700/40 text-red-300 text-sm">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        {loadError}
        <button onClick={loadSettings} className="ml-auto text-xs underline hover:no-underline">Riprova</button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-indigo-900/30 border border-indigo-700/40">
          <FileSearch className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-surface-100">Impostazioni RAG</h2>
          <p className="text-sm text-surface-400">
            Configura il comportamento del motore di ricerca documentale e il fallback web.
          </p>
        </div>
      </div>

      {/* Card: Web Fallback */}
      <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2 text-sm font-medium text-surface-200">
          <Globe className="w-4 h-4 text-blue-400" />
          Ricerca Web Fallback
        </div>

        {/* Enable Web Fallback Toggle */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-surface-200">Abilita fallback web</p>
            <p className="text-xs text-surface-500 mt-0.5">
              Quando il contesto RAG non e sufficiente, integra automaticamente i risultati di ricerca web.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusIcon keyName="rag_web_fallback_enabled" />
            <button
              onClick={() => handleToggle('rag_web_fallback_enabled', !settings.rag_web_fallback_enabled)}
              className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                settings.rag_web_fallback_enabled ? 'bg-indigo-600' : 'bg-surface-600'
              }`}
              role="switch"
              aria-checked={settings.rag_web_fallback_enabled}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  settings.rag_web_fallback_enabled ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {/* Enable Layer 2 Web Retry Toggle — DEBT-87-A */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-surface-200">Abilita Layer 2 web retry</p>
            <p className="text-xs text-surface-500 mt-0.5">
              Quando il modello risponde con &quot;non so&quot;, rilancia automaticamente una ricerca web per integrare la risposta.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusIcon keyName="rag_layer2_enabled" />
            <button
              onClick={() => handleToggle('rag_layer2_enabled', !settings.rag_layer2_enabled)}
              className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                settings.rag_layer2_enabled ? 'bg-indigo-600' : 'bg-surface-600'
              }`}
              role="switch"
              aria-checked={settings.rag_layer2_enabled}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  settings.rag_layer2_enabled ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {/* Max Web Results */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-surface-200">Risultati web massimi</p>
            <p className="text-xs text-surface-500 mt-0.5">
              Numero massimo di risultati di ricerca web da includere nel contesto (1-10).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusIcon keyName="rag_web_max_results" />
            <input
              type="number"
              min={1}
              max={10}
              value={settings.rag_web_max_results}
              onChange={e => {
                const v = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
                handleNumber('rag_web_max_results', v);
              }}
              className="w-20 px-2 py-1.5 rounded-lg bg-surface-700 border border-surface-600 text-sm text-surface-100 text-center focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* Card: Score Threshold */}
      <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2 text-sm font-medium text-surface-200">
          <Settings className="w-4 h-4 text-amber-400" />
          Soglia di Rilevanza
        </div>

        {/* Score Threshold Slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-surface-200">Soglia score RAG</p>
              <p className="text-xs text-surface-500 mt-0.5">
                Punteggio minimo sotto cui il fallback web si attiva. Valori piu bassi = piu fallback web.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon keyName="rag_score_threshold" />
              <span className="text-sm font-mono text-indigo-300 w-12 text-right">
                {settings.rag_score_threshold.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-surface-500">0.0</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.rag_score_threshold}
              onChange={e => handleSlider('rag_score_threshold', parseFloat(e.target.value))}
              onMouseUp={e => handleSliderCommit('rag_score_threshold', parseFloat((e.target as HTMLInputElement).value))}
              onTouchEnd={e => handleSliderCommit('rag_score_threshold', parseFloat((e.target as HTMLInputElement).value))}
              className="flex-1 accent-indigo-500"
            />
            <span className="text-xs text-surface-500">1.0</span>
          </div>
          <div className="flex justify-between text-[10px] text-surface-600">
            <span>Piu fallback web</span>
            <span>Piu documenti</span>
          </div>
        </div>
      </div>

      {/* Info box */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-950/20 border border-blue-800/30 text-xs text-blue-300">
        <Globe className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <div>
          <strong>Come funziona il fallback:</strong> quando la query dell utente non trova documenti con score
          superiore alla soglia configurata, il sistema esegue automaticamente una ricerca web (DuckDuckGo) e
          presenta la risposta con attribuzione esplicita delle fonti (badge documenti + web).
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-surface-500">
        <Save className="w-3.5 h-3.5" />
        Le impostazioni vengono salvate automaticamente ad ogni modifica.
      </div>
    </div>
  );
}
