/**
 * ComplianceDashboardPage — Dashboard admin per conformità AI Act
 *
 * Mostra scorecard conformità, metriche consensi, log decisioni AI,
 * report bias, richieste export/cancellazione, statistiche feedback.
 */

import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import {
  Shield, CheckCircle, AlertTriangle, Users, Brain,
  ThumbsUp, ThumbsDown, Download, Trash2, RefreshCw
} from 'lucide-react';

interface DashboardData {
  users: { total: number; with_all_consents: number };
  ai_decisions: { total: number };
  feedback: { total: number; positive: number; negative: number };
  pending_exports: number;
  pending_deletions: number;
  latest_bias_reports: { flagged_content_count?: number }[];
  gaps?: { id: number; name: string; status: 'compliant' | 'partial' | 'non_compliant' }[];
}

interface DecisionLog {
  id: number;
  user_id: number;
  ai_model: string;
  ai_provider: string;
  tokens_input: number;
  tokens_output: number;
  latency_ms: number;
  created_at: string;
}

const defaultGaps = [
  { id: 1, name: 'AI Disclosure (Art. 50.1)', status: 'compliant' as const },
  { id: 2, name: 'Content Marking (Art. 50.2)', status: 'compliant' as const },
  { id: 3, name: 'Privacy Policy + DPIA', status: 'compliant' as const },
  { id: 4, name: 'Consenso utente', status: 'compliant' as const },
  { id: 5, name: 'AI Decision Logging', status: 'compliant' as const },
  { id: 6, name: 'Data Export (GDPR Art. 20)', status: 'compliant' as const },
  { id: 7, name: 'Account Deletion', status: 'compliant' as const },
  { id: 8, name: 'Model Documentation', status: 'compliant' as const },
  { id: 9, name: 'Feedback AI', status: 'compliant' as const },
  { id: 10, name: 'Human Oversight', status: 'compliant' as const },
  { id: 11, name: 'Bias Monitoring', status: 'compliant' as const },
];

export default function ComplianceDashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [decisionLogs, setDecisionLogs] = useState<DecisionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionLogsError, setDecisionLogsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'decisions' | 'feedback' | 'exports'>('overview');

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/admin/compliance/dashboard');
      setDashboard(res.data);
    } catch {
      setError('Errore nel caricamento della dashboard di conformità.');
    } finally {
      setLoading(false);
    }
  };

  const loadDecisionLogs = async () => {
    setDecisionLogsError(null);
    try {
      const res = await api.get('/admin/compliance/decision-log?limit=50');
      setDecisionLogs(res.data.logs || []);
    } catch {
      setDecisionLogs([]);
      setDecisionLogsError('Errore nel caricamento dei log decisioni AI.');
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (activeTab === 'decisions') loadDecisionLogs();
  }, [activeTab]);

  const gapStatusIcon = (status: string) => {
    switch (status) {
      case 'compliant': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'partial': return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      default: return <AlertTriangle className="w-4 h-4 text-red-500" />;
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-surface-500">Caricamento dashboard conformità...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={loadDashboard}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          Riprova
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold">AI Act Compliance</h1>
            <p className="text-sm text-surface-500">Reg. UE 2024/1689 — Dashboard di conformità</p>
          </div>
        </div>
        <button
          onClick={loadDashboard}
          className="flex items-center gap-2 px-4 py-2 bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Aggiorna
        </button>
      </div>

      {/* Info Card */}
      <div className="card p-6 text-center">
        <p className="text-sm text-surface-500 mb-2">AI Act Compliance Status</p>
        <p className="text-lg font-bold text-primary-600">Reg. UE 2024/1689</p>
        <p className="text-sm text-surface-500 mt-2">Scadenza: 2 Agosto 2026</p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <Users className="w-5 h-5 text-blue-500 mx-auto mb-1" />
          <p className="text-xl font-bold">{dashboard?.users?.with_all_consents || 0}/{dashboard?.users?.total || 0}</p>
          <p className="text-xs text-surface-500">Utenti con consenso</p>
        </div>
        <div className="card p-4 text-center">
          <Brain className="w-5 h-5 text-violet-500 mx-auto mb-1" />
          <p className="text-xl font-bold">{dashboard?.ai_decisions?.total || 0}</p>
          <p className="text-xs text-surface-500">Decisioni AI loggate</p>
        </div>
        <div className="card p-4 text-center">
          <ThumbsUp className="w-5 h-5 text-green-500 mx-auto mb-1" />
          <p className="text-xl font-bold">
            {dashboard?.feedback?.total ? Math.round((dashboard.feedback.positive / dashboard.feedback.total) * 100) : 0}%
          </p>
          <p className="text-xs text-surface-500">Feedback positivo</p>
        </div>
        <div className="card p-4 text-center">
          <AlertTriangle className="w-5 h-5 text-amber-500 mx-auto mb-1" />
          <p className="text-xl font-bold">
            {dashboard?.latest_bias_reports?.reduce((sum, r) => sum + (r.flagged_content_count || 0), 0) || 0}
          </p>
          <p className="text-xs text-surface-500">Alert bias</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-200 dark:border-surface-700" role="tablist" aria-label="Sezioni conformità">
        {(['overview', 'decisions', 'feedback', 'exports'] as const).map(tab => (
          <button
            key={tab}
            id={`tab-${tab}`}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`tabpanel-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-surface-500 hover:text-surface-700'
            }`}
          >
            {tab === 'overview' ? 'GAP Analysis' : tab === 'decisions' ? 'Log Decisioni' : tab === 'feedback' ? 'Feedback' : 'Export & Cancellazioni'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="card overflow-hidden" role="tabpanel" id="tabpanel-overview" aria-labelledby="tab-overview">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-50 dark:bg-surface-800 text-left">
                <th className="px-4 py-3 text-xs font-medium text-surface-500 uppercase">GAP</th>
                <th className="px-4 py-3 text-xs font-medium text-surface-500 uppercase">Descrizione</th>
                <th className="px-4 py-3 text-xs font-medium text-surface-500 uppercase">Stato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {(dashboard?.gaps ?? defaultGaps).map(gap => (
                <tr key={gap.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                  <td className="px-4 py-3 text-sm font-mono">GAP-{gap.id}</td>
                  <td className="px-4 py-3 text-sm">{gap.name}</td>
                  <td className="px-4 py-3">{gapStatusIcon(gap.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'decisions' && (
        <div className="card overflow-hidden" role="tabpanel" id="tabpanel-decisions" aria-labelledby="tab-decisions">
          {decisionLogsError && (
            <div className="p-4 text-center">
              <p className="text-red-500 mb-2">{decisionLogsError}</p>
              <button onClick={loadDecisionLogs} className="text-sm text-primary-600 hover:underline">Riprova</button>
            </div>
          )}
          <table className="w-full">
            <thead>
              <tr className="bg-surface-50 dark:bg-surface-800 text-left">
                <th className="px-4 py-3 text-xs font-medium text-surface-500 uppercase">ID</th>
                <th className="px-4 py-3 text-xs font-medium text-surface-500 uppercase">Modello</th>
                <th className="px-4 py-3 text-xs font-medium text-surface-500 uppercase">Provider</th>
                <th className="px-4 py-3 text-xs font-medium text-surface-500 uppercase">Token</th>
                <th className="px-4 py-3 text-xs font-medium text-surface-500 uppercase">Latenza</th>
                <th className="px-4 py-3 text-xs font-medium text-surface-500 uppercase">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {decisionLogs.map(log => (
                <tr key={log.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/50 text-sm">
                  <td className="px-4 py-3 font-mono">{log.id}</td>
                  <td className="px-4 py-3">{log.ai_model}</td>
                  <td className="px-4 py-3">{log.ai_provider}</td>
                  <td className="px-4 py-3">{log.tokens_input + log.tokens_output}</td>
                  <td className="px-4 py-3">{log.latency_ms}ms</td>
                  <td className="px-4 py-3 text-surface-500">{new Date(log.created_at).toLocaleString('it-IT')}</td>
                </tr>
              ))}
              {decisionLogs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-surface-500">Nessun log disponibile</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'feedback' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" role="tabpanel" id="tabpanel-feedback" aria-labelledby="tab-feedback">
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <ThumbsUp className="w-6 h-6 text-green-500" />
              <h3 className="font-bold">Feedback Positivo</h3>
            </div>
            <p className="text-4xl font-bold text-green-600">{dashboard?.feedback?.positive || 0}</p>
          </div>
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <ThumbsDown className="w-6 h-6 text-red-500" />
              <h3 className="font-bold">Feedback Negativo</h3>
            </div>
            <p className="text-4xl font-bold text-red-600">{dashboard?.feedback?.negative || 0}</p>
          </div>
        </div>
      )}

      {activeTab === 'exports' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" role="tabpanel" id="tabpanel-exports" aria-labelledby="tab-exports">
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <Download className="w-6 h-6 text-blue-500" />
              <h3 className="font-bold">Richieste Export Dati</h3>
            </div>
            <p className="text-4xl font-bold">{dashboard?.pending_exports || 0}</p>
            <p className="text-sm text-surface-500 mt-1">In attesa di elaborazione</p>
          </div>
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <Trash2 className="w-6 h-6 text-red-500" />
              <h3 className="font-bold">Richieste Cancellazione</h3>
            </div>
            <p className="text-4xl font-bold">{dashboard?.pending_deletions || 0}</p>
            <p className="text-sm text-surface-500 mt-1">In periodo di grazia</p>
          </div>
        </div>
      )}
    </div>
  );
}
