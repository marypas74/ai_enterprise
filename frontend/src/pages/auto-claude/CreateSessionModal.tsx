import { useState, useEffect } from 'react';
import { useAgentStore, AgentSession } from '../../hooks/useAgentStore';
import { api } from '../../services/api';
import { X, Loader2 } from 'lucide-react';

interface CreateSessionModalProps {
  onClose: () => void;
  onCreated: (session: AgentSession) => void;
}

export default function CreateSessionModal({ onClose, onCreated }: CreateSessionModalProps) {
  const { templates, fetchTemplates, createSession, isLoading } = useAgentStore();
  const [formData, setFormData] = useState({
    name: '',
    taskSpecification: '',
    modelId: 1,
    systemPrompt: '',
    templateId: undefined as number | undefined,
    config: {
      maxIterations: 50,
      timeoutSeconds: 3600,
      autoCommit: true,
      runTests: true,
      createWorktree: true,
      baseBranch: 'main',
    },
  });
  const [models, setModels] = useState<any[]>([]);

  useEffect(() => {
    fetchTemplates();
    api.get('/chat/models').then(res => setModels(res.data)).catch(() => {});
  }, []);

  const handleTemplateSelect = (templateId: number) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setFormData(prev => ({
        ...prev,
        templateId,
        modelId: template.modelId,
        systemPrompt: template.systemPrompt,
        config: {
          ...prev.config,
          maxIterations: template.maxIterations,
          timeoutSeconds: template.timeoutSeconds,
          ...template.defaultConfig,
        },
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const session = await createSession(formData);
      onCreated(session);
      onClose();
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between p-4 border-b border-surface-200">
          <h3 className="font-semibold text-lg">Create Agent Session</h3>
          <button onClick={onClose} className="p-2 hover:bg-surface-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Template selector */}
          {templates.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Template (optional)</label>
              <select
                value={formData.templateId || ''}
                onChange={(e) => e.target.value && handleTemplateSelect(Number(e.target.value))}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg"
              >
                <option value="">No template</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Session Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg"
              placeholder="e.g., Implement authentication feature"
              required
            />
          </div>

          {/* Task specification */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Task Specification *</label>
            <textarea
              value={formData.taskSpecification}
              onChange={(e) => setFormData(prev => ({ ...prev, taskSpecification: e.target.value }))}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg h-32 resize-none"
              placeholder="Describe the task in detail..."
              required
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">AI Model</label>
            <select
              value={formData.modelId}
              onChange={(e) => setFormData(prev => ({ ...prev, modelId: Number(e.target.value) }))}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg"
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Configuration */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Max Iterations</label>
              <input
                type="number"
                value={formData.config.maxIterations}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  config: { ...prev.config, maxIterations: Number(e.target.value) },
                }))}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg"
                min={1}
                max={100}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Timeout (seconds)</label>
              <input
                type="number"
                value={formData.config.timeoutSeconds}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  config: { ...prev.config, timeoutSeconds: Number(e.target.value) },
                }))}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg"
                min={60}
                max={7200}
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.config.createWorktree}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  config: { ...prev.config, createWorktree: e.target.checked },
                }))}
                className="w-4 h-4 rounded border-surface-300"
              />
              <span className="text-sm text-surface-700">Create Git worktree</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.config.autoCommit}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  config: { ...prev.config, autoCommit: e.target.checked },
                }))}
                className="w-4 h-4 rounded border-surface-300"
              />
              <span className="text-sm text-surface-700">Auto commit</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.config.runTests}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  config: { ...prev.config, runTests: e.target.checked },
                }))}
                className="w-4 h-4 rounded border-surface-300"
              />
              <span className="text-sm text-surface-700">Run tests</span>
            </label>
          </div>

          {/* Base branch */}
          {formData.config.createWorktree && (
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Base Branch</label>
              <input
                type="text"
                value={formData.config.baseBranch}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  config: { ...prev.config, baseBranch: e.target.value },
                }))}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg"
              />
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-4 border-t border-surface-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-surface-700 hover:bg-surface-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 flex items-center gap-2"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Session
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
