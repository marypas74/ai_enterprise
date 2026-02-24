import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  FileText,
  RefreshCw,
  Plus,
  Trash2,
  Edit3,
  AlertCircle,
  CheckCircle,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronRight,
  ClipboardList
} from 'lucide-react';

interface FormDefinition {
  id: number;
  name: string;
  display_name: string;
  description: string | null;
  json_schema: Record<string, any>;
  start_examples: string[] | null;
  stop_examples: string[] | null;
  ask_confirm: boolean;
  on_complete_action: string;
  on_complete_config: Record<string, any> | null;
  is_enabled: boolean;
}

export default function FormsPage() {
  const { token } = useAuth();
  const [forms, setForms] = useState<FormDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [expandedForm, setExpandedForm] = useState<number | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create form state
  const [newForm, setNewForm] = useState({
    name: '',
    display_name: '',
    description: '',
    json_schema: '{\n  "type": "object",\n  "properties": {\n    "field1": {\n      "type": "string",\n      "description": "Description of field1"\n    }\n  },\n  "required": ["field1"]\n}',
    ask_confirm: true,
    on_complete_action: 'log',
  });

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchForms = useCallback(async () => {
    try {
      const res = await fetch('/api/forms/definitions', { headers });
      const data = await res.json();
      setForms(Array.isArray(data.forms) ? data.forms : []);
    } catch { /* empty */ } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchForms(); }, []);

  const handleCreate = async () => {
    try {
      const schema = JSON.parse(newForm.json_schema);
      const res = await fetch('/api/forms/definitions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...newForm,
          json_schema: schema,
        }),
      });
      if (res.ok) {
        showNotification('success', 'Form created');
        setShowCreateForm(false);
        setNewForm({ name: '', display_name: '', description: '', json_schema: newForm.json_schema, ask_confirm: true, on_complete_action: 'log' });
        fetchForms();
      } else {
        const err = await res.json();
        showNotification('error', err.error || 'Failed to create form');
      }
    } catch (e: any) {
      showNotification('error', e.message || 'Invalid JSON schema');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this form definition?')) return;
    try {
      const res = await fetch(`/api/forms/definitions/${id}`, { method: 'DELETE', headers });
      if (res.ok) {
        showNotification('success', 'Form deleted');
        fetchForms();
      }
    } catch {
      showNotification('error', 'Failed to delete');
    }
  };

  const handleToggle = async (id: number, enabled: boolean) => {
    try {
      const res = await fetch(`/api/forms/definitions/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ is_enabled: enabled }),
      });
      if (res.ok) {
        showNotification('success', enabled ? 'Form enabled' : 'Form disabled');
        fetchForms();
      }
    } catch {
      showNotification('error', 'Failed to update');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
          notification.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {notification.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {notification.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-8 h-8 text-emerald-400" />
          <div>
            <h1 className="text-2xl font-bold">Conversational Forms</h1>
            <p className="text-sm text-surface-500">LLM-driven structured data collection via chat</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchForms} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm"
          >
            <Plus className="w-4 h-4" /> New Form
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="card p-6 space-y-4">
          <h3 className="font-medium">Create New Form Definition</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-surface-500">Name (slug)</label>
              <input
                type="text"
                placeholder="my_form"
                value={newForm.name}
                onChange={e => setNewForm({ ...newForm, name: e.target.value })}
                className="input mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-surface-500">Display Name</label>
              <input
                type="text"
                placeholder="My Form"
                value={newForm.display_name}
                onChange={e => setNewForm({ ...newForm, display_name: e.target.value })}
                className="input mt-1"
              />
            </div>
          </div>
          <div>
            <label className="text-sm text-surface-500">Description</label>
            <input
              type="text"
              placeholder="What this form collects..."
              value={newForm.description}
              onChange={e => setNewForm({ ...newForm, description: e.target.value })}
              className="input mt-1"
            />
          </div>
          <div>
            <label className="text-sm text-surface-500">JSON Schema</label>
            <textarea
              value={newForm.json_schema}
              onChange={e => setNewForm({ ...newForm, json_schema: e.target.value })}
              className="input mt-1 font-mono text-xs min-h-[150px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-surface-500">On Complete Action</label>
              <select
                value={newForm.on_complete_action}
                onChange={e => setNewForm({ ...newForm, on_complete_action: e.target.value })}
                className="input mt-1"
              >
                <option value="log">Log Only</option>
                <option value="webhook">Webhook</option>
                <option value="email">Email</option>
                <option value="api">API Call</option>
              </select>
            </div>
            <div className="flex items-center gap-3 mt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newForm.ask_confirm}
                  onChange={e => setNewForm({ ...newForm, ask_confirm: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm">Ask for confirmation before completing</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!newForm.name || !newForm.display_name}
              className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg"
            >
              Create Form
            </button>
          </div>
        </div>
      )}

      {/* Form List */}
      {forms.length === 0 ? (
        <div className="text-center py-12 text-surface-500">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No conversational forms defined</p>
          <p className="text-sm mt-1">Create a form to start collecting structured data via chat.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {forms.map(form => {
            const isExpanded = expandedForm === form.id;
            const schema = typeof form.json_schema === 'string' ? JSON.parse(form.json_schema) : form.json_schema;
            const fields = Object.keys(schema.properties || {});

            return (
              <div key={form.id} className="card">
                <div
                  className="flex items-center justify-between p-4 cursor-pointer"
                  onClick={() => setExpandedForm(isExpanded ? null : form.id)}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-surface-400" /> : <ChevronRight className="w-4 h-4 text-surface-400" />}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{form.display_name}</span>
                        <span className="font-mono text-xs text-surface-500">({form.name})</span>
                      </div>
                      <p className="text-sm text-surface-500">{form.description || 'No description'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-surface-500">{fields.length} fields</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      form.is_enabled
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-surface-100 text-surface-500 dark:bg-surface-800'
                    }`}>
                      {form.is_enabled ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-surface-200 dark:border-surface-700 p-4 space-y-4">
                    {/* Fields */}
                    <div>
                      <h4 className="text-sm font-medium mb-2">Schema Fields</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {fields.map(field => {
                          const prop = schema.properties[field];
                          const isRequired = (schema.required || []).includes(field);
                          return (
                            <div key={field} className="flex items-center gap-2 p-2 bg-surface-50 dark:bg-surface-800 rounded">
                              <span className="font-mono text-sm">{field}</span>
                              <span className="text-xs text-surface-500">({prop.type || 'string'})</span>
                              {isRequired && <span className="text-xs text-red-500">*</span>}
                              {prop.description && (
                                <span className="text-xs text-surface-400 ml-auto truncate max-w-[200px]">{prop.description}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Config */}
                    <div className="flex items-center gap-4 text-sm text-surface-500">
                      <span>Action: <strong>{form.on_complete_action}</strong></span>
                      <span>Confirm: <strong>{form.ask_confirm ? 'Yes' : 'No'}</strong></span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggle(form.id, !form.is_enabled); }}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800"
                      >
                        {form.is_enabled
                          ? <><ToggleRight className="w-4 h-4 text-green-500" /> Disable</>
                          : <><ToggleLeft className="w-4 h-4" /> Enable</>
                        }
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(form.id); }}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
