import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { Clock, Play, Pause, Trash2, Plus, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface ScheduledJob {
  id: number;
  name: string;
  description?: string;
  job_type: 'one_shot' | 'interval' | 'cron';
  action_type: string;
  action_config: any;
  schedule_config: any;
  status: string;
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
  max_runs?: number;
  created_at: string;
}

interface JobExecution {
  id: number;
  job_id: number;
  started_at: string;
  completed_at: string | null;
  status: 'success' | 'failed';
  error?: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  paused: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  completed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400',
};

export default function SchedulerPage() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedJob, setSelectedJob] = useState<number | null>(null);
  const [executions, setExecutions] = useState<JobExecution[]>([]);

  // Create form state
  const [newJob, setNewJob] = useState({
    name: '',
    description: '',
    job_type: 'one_shot' as 'one_shot' | 'interval' | 'cron',
    action_type: 'webhook' as string,
    delay_ms: 60000,
    interval_ms: 300000,
    cron_expression: '0 9 * * *',
    webhook_url: '',
    hook_name: '',
    message: '',
    conversation_id: '',
  });

  const loadJobs = async () => {
    try {
      const res = await api.get('/scheduler/jobs');
      setJobs(res.data.jobs || []);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadExecutions = async (jobId: number) => {
    try {
      const res = await api.get(`/scheduler/jobs/${jobId}/executions`);
      setExecutions(res.data.executions || []);
      setSelectedJob(jobId);
    } catch (err) {
      console.error('Failed to load executions:', err);
    }
  };

  useEffect(() => { loadJobs(); }, []);

  const createJob = async () => {
    const scheduleConfig: any = {};
    if (newJob.job_type === 'one_shot') scheduleConfig.delay_ms = newJob.delay_ms;
    if (newJob.job_type === 'interval') scheduleConfig.interval_ms = newJob.interval_ms;
    if (newJob.job_type === 'cron') scheduleConfig.cron_expression = newJob.cron_expression;

    const actionConfig: any = {};
    if (newJob.action_type === 'webhook') actionConfig.url = newJob.webhook_url;
    if (newJob.action_type === 'hook') actionConfig.hook_name = newJob.hook_name;
    if (newJob.action_type === 'scheduled_message') {
      actionConfig.message = newJob.message;
      actionConfig.conversation_id = parseInt(newJob.conversation_id) || 0;
    }

    await api.post('/scheduler/jobs', {
      name: newJob.name,
      description: newJob.description,
      job_type: newJob.job_type,
      action_type: newJob.action_type,
      action_config: actionConfig,
      schedule_config: scheduleConfig,
    });

    setShowCreate(false);
    loadJobs();
  };

  const pauseJob = async (id: number) => {
    await api.patch(`/scheduler/jobs/${id}/pause`);
    loadJobs();
  };

  const resumeJob = async (id: number) => {
    await api.patch(`/scheduler/jobs/${id}/resume`);
    loadJobs();
  };

  const cancelJob = async (id: number) => {
    if (!confirm('Sei sicuro di voler cancellare questo job?')) return;
    await api.delete(`/scheduler/jobs/${id}`);
    loadJobs();
  };

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleString('it-IT') : '-';
  const formatMs = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(0)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  };

  return (
    <div className="p-6 flex flex-col h-full gap-6">
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Clock className="w-6 h-6 text-primary-500" />
          <h1 className="text-2xl font-bold flex-shrink-0">Scheduler (White Rabbit)</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={loadJobs} className="btn btn-secondary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Aggiorna
          </button>
          <button onClick={() => setShowCreate(true)} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Nuovo Job
          </button>
        </div>
      </div>

      {/* Create Job Modal */}
      {showCreate && (
        <div className="card p-6 border-2 border-primary-300 dark:border-primary-700 flex-shrink-0">
          <h2 className="text-lg font-semibold mb-4">Crea Nuovo Job</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Nome</label>
              <input className="input" value={newJob.name} onChange={e => setNewJob({ ...newJob, name: e.target.value })} placeholder="Es: Daily Report" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Descrizione</label>
              <input className="input" value={newJob.description} onChange={e => setNewJob({ ...newJob, description: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipo Job</label>
              <select className="input" value={newJob.job_type} onChange={e => setNewJob({ ...newJob, job_type: e.target.value as any })}>
                <option value="one_shot">One Shot (una volta)</option>
                <option value="interval">Intervallo (ripetuto)</option>
                <option value="cron">Cron (programmato)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipo Azione</label>
              <select className="input" value={newJob.action_type} onChange={e => setNewJob({ ...newJob, action_type: e.target.value })}>
                <option value="webhook">Webhook</option>
                <option value="hook">Hook EventBus</option>
                <option value="scheduled_message">Messaggio Programmato</option>
                <option value="plugin_action">Azione Plugin</option>
              </select>
            </div>

            {/* Schedule Config */}
            {newJob.job_type === 'one_shot' && (
              <div>
                <label className="block text-sm font-medium mb-1">Ritardo (ms)</label>
                <input type="number" className="input" value={newJob.delay_ms} onChange={e => setNewJob({ ...newJob, delay_ms: parseInt(e.target.value) })} />
                <span className="text-xs text-surface-500">= {formatMs(newJob.delay_ms)}</span>
              </div>
            )}
            {newJob.job_type === 'interval' && (
              <div>
                <label className="block text-sm font-medium mb-1">Intervallo (ms)</label>
                <input type="number" className="input" value={newJob.interval_ms} onChange={e => setNewJob({ ...newJob, interval_ms: parseInt(e.target.value) })} />
                <span className="text-xs text-surface-500">= ogni {formatMs(newJob.interval_ms)}</span>
              </div>
            )}
            {newJob.job_type === 'cron' && (
              <div>
                <label className="block text-sm font-medium mb-1">Espressione Cron</label>
                <input className="input" value={newJob.cron_expression} onChange={e => setNewJob({ ...newJob, cron_expression: e.target.value })} placeholder="0 9 * * *" />
              </div>
            )}

            {/* Action Config */}
            {newJob.action_type === 'webhook' && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Webhook URL</label>
                <input className="input" value={newJob.webhook_url} onChange={e => setNewJob({ ...newJob, webhook_url: e.target.value })} placeholder="https://example.com/webhook" />
              </div>
            )}
            {newJob.action_type === 'hook' && (
              <div>
                <label className="block text-sm font-medium mb-1">Nome Hook</label>
                <input className="input" value={newJob.hook_name} onChange={e => setNewJob({ ...newJob, hook_name: e.target.value })} placeholder="on_scheduled_action" />
              </div>
            )}
            {newJob.action_type === 'scheduled_message' && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">ID Conversazione</label>
                  <input className="input" value={newJob.conversation_id} onChange={e => setNewJob({ ...newJob, conversation_id: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">Messaggio</label>
                  <textarea className="input" rows={3} value={newJob.message} onChange={e => setNewJob({ ...newJob, message: e.target.value })} />
                </div>
              </>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <button onClick={createJob} className="btn btn-primary" disabled={!newJob.name}>Crea</button>
            <button onClick={() => setShowCreate(false)} className="btn btn-secondary">Annulla</button>
          </div>
        </div>
      )}

      {/* Jobs Table */}
      <div className="card overflow-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr className="text-left text-sm text-surface-500 bg-surface-50 dark:bg-surface-900">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Azione</th>
              <th className="px-4 py-3">Stato</th>
              <th className="px-4 py-3">Esecuzioni</th>
              <th className="px-4 py-3">Prossima</th>
              <th className="px-4 py-3">Ultima</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-surface-500">Caricamento...</td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-surface-500">Nessun job programmato</td></tr>
            ) : (
              jobs.map(job => (
                <tr key={job.id} className="border-t border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-900/50">
                  <td className="px-4 py-3 font-mono text-sm">#{job.id}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => loadExecutions(job.id)} className="font-medium text-primary-600 hover:underline">
                      {job.name}
                    </button>
                    {job.description && <p className="text-xs text-surface-500">{job.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-sm">{job.job_type}</td>
                  <td className="px-4 py-3 text-sm">{job.action_type}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[job.status] || ''}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">{job.run_count}{job.max_runs ? `/${job.max_runs}` : ''}</td>
                  <td className="px-4 py-3 text-xs">{formatDate(job.next_run_at)}</td>
                  <td className="px-4 py-3 text-xs">{formatDate(job.last_run_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {job.status === 'active' && (
                        <button onClick={() => pauseJob(job.id)} className="p-1.5 hover:bg-surface-200 dark:hover:bg-surface-700 rounded" title="Pausa">
                          <Pause className="w-4 h-4" />
                        </button>
                      )}
                      {job.status === 'paused' && (
                        <button onClick={() => resumeJob(job.id)} className="p-1.5 hover:bg-surface-200 dark:hover:bg-surface-700 rounded" title="Riprendi">
                          <Play className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => cancelJob(job.id)} className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-500" title="Cancella">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Execution History */}
      {selectedJob && (
        <div className="card p-6 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Cronologia Esecuzioni - Job #{selectedJob}</h2>
            <button onClick={() => setSelectedJob(null)} className="text-sm text-surface-500 hover:text-surface-700">&times; Chiudi</button>
          </div>
          <div className="space-y-2">
            {executions.length === 0 ? (
              <p className="text-surface-500 text-sm">Nessuna esecuzione registrata</p>
            ) : (
              executions.map(exec => (
                <div key={exec.id} className="flex items-center gap-3 p-2 bg-surface-50 dark:bg-surface-800 rounded">
                  {exec.status === 'success' ? (
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  )}
                  <span className="text-sm">{formatDate(exec.started_at)}</span>
                  {exec.completed_at && (
                    <span className="text-xs text-surface-500">
                      durata: {((new Date(exec.completed_at).getTime() - new Date(exec.started_at).getTime()) / 1000).toFixed(1)}s
                    </span>
                  )}
                  {exec.error && <span className="text-xs text-red-500 truncate">{exec.error}</span>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
