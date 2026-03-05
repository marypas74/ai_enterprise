/**
 * AITransparencyPage — GAP-2/8: Trasparenza AI (Art. 50 AI Act)
 *
 * Pagina protetta che mostra i modelli AI utilizzati, statistiche
 * di utilizzo personali e documentazione sulla trasparenza.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Brain, Info, BarChart3 } from 'lucide-react';
import { api } from '../services/api';

interface ModelInfo {
  id: number;
  model_id: string;
  display_name: string;
  provider: string;
  knowledge_cutoff: string | null;
  limitations: string | null;
  bias_notes: string | null;
  safety_rating: string | null;
  documentation_url: string | null;
}

interface UsageByProvider {
  provider: string;
  total_tokens_input: number;
  total_tokens_output: number;
  request_count: number;
}

interface ModelUsed {
  ai_model: string;
  ai_provider: string;
  cnt: number;
}

interface FeedbackStats {
  total: number;
  positive: number;
  negative: number;
}

interface TransparencyData {
  usage_by_provider: UsageByProvider[];
  models_used: ModelUsed[];
  feedback: FeedbackStats;
  models: ModelInfo[];
}

export default function AITransparencyPage() {
  const [data, setData] = useState<TransparencyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [transparency, models] = await Promise.all([
        api.get('/compliance/transparency'),
        api.get('/compliance/models'),
      ]);
      setData({
        ...transparency.data,
        models: models.data.models || [],
      });
    } catch {
      setError('Errore nel caricamento dei dati di trasparenza. Riprova.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const isSafeUrl = (url: string | null): boolean => {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const safetyRatingColor = (rating: string | null) => {
    switch (rating) {
      case 'very_high': return 'text-green-600 bg-green-100 dark:bg-green-900/30';
      case 'high': return 'text-blue-600 bg-blue-100 dark:bg-blue-900/30';
      case 'medium': return 'text-amber-600 bg-amber-100 dark:bg-amber-900/30';
      case 'low': return 'text-red-600 bg-red-100 dark:bg-red-900/30';
      default: return 'text-surface-500 bg-surface-100 dark:bg-surface-800';
    }
  };

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link to="/" className="p-2 hover:bg-surface-200 dark:hover:bg-surface-800 rounded-full transition-colors">
            <ChevronLeft className="w-6 h-6" />
          </Link>
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-primary-600" />
            <h1 className="text-3xl font-bold">Trasparenza AI</h1>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-surface-500">Caricamento...</div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-500 mb-4">{error}</p>
            <button
              onClick={loadData}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              Riprova
            </button>
          </div>
        ) : (
          <>
            {/* Personal Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="card p-6 text-center">
                <BarChart3 className="w-6 h-6 text-primary-500 mx-auto mb-2" />
                <p className="text-2xl font-bold">
                  {(data?.usage_by_provider || []).reduce((sum, u) => sum + (u.request_count || 0), 0)}
                </p>
                <p className="text-sm text-surface-500">Richieste AI totali</p>
              </div>
              <div className="card p-6 text-center">
                <Brain className="w-6 h-6 text-violet-500 mx-auto mb-2" />
                <p className="text-2xl font-bold">{(data?.models_used || []).length}</p>
                <p className="text-sm text-surface-500">Modelli utilizzati</p>
              </div>
              <div className="card p-6 text-center">
                <Info className="w-6 h-6 text-blue-500 mx-auto mb-2" />
                <p className="text-2xl font-bold">
                  {(data?.models_used || []).reduce((sum, m) => sum + (m.cnt || 0), 0)}
                </p>
                <p className="text-sm text-surface-500">Decisioni AI registrate</p>
              </div>
            </div>

            {/* AI Disclosure */}
            <div className="card p-6 mb-6 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <h3 className="font-bold text-blue-800 dark:text-blue-300">Informativa AI Act (UE 2024/1689)</h3>
                  <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                    Questa piattaforma è classificata come sistema AI a <strong>rischio limitato</strong> (Art. 50).
                    In qualità di deployer, garantiamo trasparenza sull'utilizzo dell'intelligenza artificiale,
                    inclusa la marcatura dei contenuti generati e la documentazione dei modelli utilizzati.
                  </p>
                </div>
              </div>
            </div>

            {/* Models Documentation */}
            <h2 className="text-xl font-bold mb-4">Modelli AI Disponibili</h2>
            <div className="space-y-4">
              {(data?.models || []).map(model => (
                <div key={model.id} className="card p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-bold">{model.display_name}</h3>
                      <p className="text-sm text-surface-500">{model.provider} · {model.model_id}</p>
                    </div>
                    {model.safety_rating && (
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${safetyRatingColor(model.safety_rating)}`}>
                        Sicurezza: {model.safety_rating}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    {model.knowledge_cutoff && (
                      <div>
                        <p className="text-surface-500 text-xs uppercase tracking-wider mb-1">Knowledge Cutoff</p>
                        <p className="font-medium">{model.knowledge_cutoff}</p>
                      </div>
                    )}
                    {model.limitations && (
                      <div>
                        <p className="text-surface-500 text-xs uppercase tracking-wider mb-1">Limitazioni note</p>
                        <p>{model.limitations}</p>
                      </div>
                    )}
                    {model.bias_notes && (
                      <div className="md:col-span-2">
                        <p className="text-surface-500 text-xs uppercase tracking-wider mb-1">Note su bias</p>
                        <p>{model.bias_notes}</p>
                      </div>
                    )}
                  </div>

                  {isSafeUrl(model.documentation_url) && (
                    <a
                      href={model.documentation_url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-block text-sm text-primary-600 hover:underline"
                    >
                      Documentazione provider &rarr;
                    </a>
                  )}
                </div>
              ))}
            </div>

            {/* Link to Privacy */}
            <div className="mt-8 text-center">
              <Link to="/privacy" className="text-sm text-primary-600 hover:underline">
                Leggi la Privacy Policy completa &rarr;
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
