import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  FileText, Plus, Save, Trash2, Eye, ToggleLeft, ToggleRight,
  RefreshCw, AlertCircle, CheckCircle, ChevronDown, ChevronRight, X,
} from 'lucide-react';

interface PromptTemplate {
  id: number;
  name: string;
  display_name: string;
  template_type: 'prefix' | 'suffix' | 'instructions' | 'tool_prompt' | 'custom';
  content: string;
  is_default: boolean;
  is_active: boolean;
  description: string | null;
  variables: string[] | null;
}

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  prefix: 'Prefix (Personalità)',
  suffix: 'Suffix (Contesto)',
  instructions: 'Istruzioni',
  tool_prompt: 'Tool Selection',
  custom: 'Custom',
};

const TEMPLATE_TYPE_COLORS: Record<string, string> = {
  prefix: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  suffix: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  instructions: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  tool_prompt: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  custom: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

export default function PromptTemplatesPage() {
  const { token } = useAuth();
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(['prefix', 'suffix', 'instructions', 'tool_prompt']));

  // New template form
  const [newName, setNewName] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newType, setNewType] = useState<string>('custom');
  const [newContent, setNewContent] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/prompt-templates', { headers });
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (err) {
      showNotification('error', 'Errore nel caricamento dei template');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchTemplates(); }, []);

  const toggleType = (type: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const startEdit = (t: PromptTemplate) => {
    setEditingId(t.id);
    setEditContent(t.content);
    setEditDisplayName(t.display_name);
    setEditDescription(t.description || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
    setEditDisplayName('');
    setEditDescription('');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const res = await fetch(`/api/admin/prompt-templates/${editingId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          content: editContent,
          display_name: editDisplayName,
          description: editDescription || null,
        }),
      });
      if (res.ok) {
        showNotification('success', 'Template salvato');
        cancelEdit();
        fetchTemplates();
      } else {
        showNotification('error', 'Errore nel salvataggio');
      }
    } catch {
      showNotification('error', 'Errore di rete');
    }
  };

  const toggleActive = async (id: number, isActive: boolean) => {
    try {
      const res = await fetch(`/api/admin/prompt-templates/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ is_active: !isActive }),
      });
      if (res.ok) {
        showNotification('success', isActive ? 'Template disattivato' : 'Template attivato');
        fetchTemplates();
      }
    } catch {
      showNotification('error', 'Errore di rete');
    }
  };

  const deleteTemplate = async (id: number) => {
    if (!confirm('Eliminare questo template?')) return;
    try {
      const res = await fetch(`/api/admin/prompt-templates/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        showNotification('success', 'Template eliminato');
        fetchTemplates();
      } else {
        const data = await res.json();
        showNotification('error', data.error || 'Errore nella eliminazione');
      }
    } catch {
      showNotification('error', 'Errore di rete');
    }
  };

  const previewTemplate = async (content: string) => {
    try {
      const res = await fetch('/api/admin/prompt-templates/preview', {
        method: 'POST',
        headers,
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      setPreviewContent(data.rendered);
    } catch {
      showNotification('error', 'Errore nel preview');
    }
  };

  const createTemplate = async () => {
    if (!newName || !newDisplayName || !newContent) {
      showNotification('error', 'Compilare tutti i campi obbligatori');
      return;
    }
    try {
      const res = await fetch('/api/admin/prompt-templates', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: newName,
          display_name: newDisplayName,
          template_type: newType,
          content: newContent,
          description: newDescription || null,
          is_default: false,
          is_active: true,
          variables: extractVariables(newContent),
        }),
      });
      if (res.ok) {
        showNotification('success', 'Template creato');
        setShowCreate(false);
        setNewName('');
        setNewDisplayName('');
        setNewContent('');
        setNewDescription('');
        fetchTemplates();
      } else {
        const data = await res.json();
        showNotification('error', data.error || 'Errore nella creazione');
      }
    } catch {
      showNotification('error', 'Errore di rete');
    }
  };

  // Extract {{variable}} names from template content
  const extractVariables = (content: string): string[] => {
    const matches = content.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
  };

  // Group templates by type
  const grouped = templates.reduce((acc, t) => {
    if (!acc[t.template_type]) acc[t.template_type] = [];
    acc[t.template_type].push(t);
    return acc;
  }, {} as Record<string, PromptTemplate[]>);

  const typeOrder = ['prefix', 'suffix', 'instructions', 'tool_prompt', 'custom'];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Notification */}
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
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white flex items-center gap-2">
            <FileText className="w-6 h-6" />
            Prompt Templates
          </h1>
          <p className="text-surface-500 dark:text-surface-400 mt-1">
            Gestisci i template del sistema prompt. I template sono hookabili e definiscono personalità, contesto e istruzioni dell'AI.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetchTemplates()}
            className="px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nuovo Template
          </button>
        </div>
      </div>

      {/* Pipeline visualization */}
      <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-2">Pipeline Prompt</h3>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 rounded font-mono">Prefix</span>
          <span className="text-surface-400">→</span>
          <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded font-mono">Suffix</span>
          <span className="text-surface-400">→</span>
          <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-400 rounded font-mono">Instructions</span>
          <span className="text-surface-400">|</span>
          <span className="px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-400 rounded font-mono">Tool Prompt</span>
          <span className="text-surface-400 ml-2">
            (ogni sezione è editabile via hook: <code className="font-mono">agent_prompt_prefix</code>, <code className="font-mono">agent_prompt_suffix</code>, <code className="font-mono">agent_prompt_instructions</code>)
          </span>
        </div>
      </div>

      {/* Create form modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-surface-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Nuovo Prompt Template</h2>
                <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Nome (ID)</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="my_custom_prefix"
                    className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nome Visualizzato</label>
                  <input value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} placeholder="My Custom Prefix"
                    className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Tipo</label>
                <select value={newType} onChange={e => setNewType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm">
                  {Object.entries(TEMPLATE_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Descrizione</label>
                <input value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Descrizione opzionale..."
                  className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Contenuto Template</label>
                <p className="text-xs text-surface-500 mb-1">Usa <code className="font-mono bg-surface-100 dark:bg-surface-700 px-1 rounded">{'{{variabile}}'}</code> per i placeholder</p>
                <textarea value={newContent} onChange={e => setNewContent(e.target.value)} rows={10} placeholder="You are a helpful assistant..."
                  className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-mono" />
              </div>
              {newContent && (
                <div className="text-xs text-surface-500">
                  Variabili trovate: {extractVariables(newContent).map(v => (
                    <code key={v} className="font-mono bg-surface-100 dark:bg-surface-700 px-1 rounded mx-1">{v}</code>
                  ))}
                  {extractVariables(newContent).length === 0 && <span className="italic">nessuna</span>}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-surface-300 dark:border-surface-600 hover:bg-surface-100 dark:hover:bg-surface-700">
                  Annulla
                </button>
                <button onClick={createTemplate} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                  Crea Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview modal */}
      {previewContent !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-surface-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">Preview Renderizzato</h2>
                <button onClick={() => setPreviewContent(null)} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-sm font-mono bg-surface-50 dark:bg-surface-900 p-4 rounded-lg border border-surface-200 dark:border-surface-700">
                {previewContent}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Templates grouped by type */}
      {typeOrder.map(type => {
        const items = grouped[type];
        if (!items || items.length === 0) return null;
        const isExpanded = expandedTypes.has(type);

        return (
          <div key={type} className="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
            <button
              onClick={() => toggleType(type)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${TEMPLATE_TYPE_COLORS[type]}`}>
                  {TEMPLATE_TYPE_LABELS[type]}
                </span>
                <span className="text-sm text-surface-500">{items.length} template{items.length > 1 ? 's' : ''}</span>
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-700">
                {items.map(t => (
                  <div key={t.id} className="px-5 py-4">
                    {editingId === t.id ? (
                      /* Edit mode */
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium mb-1">Nome Visualizzato</label>
                            <input value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)}
                              className="w-full px-3 py-1.5 rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1">Descrizione</label>
                            <input value={editDescription} onChange={e => setEditDescription(e.target.value)}
                              className="w-full px-3 py-1.5 rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm" />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Contenuto</label>
                          <textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={8}
                            className="w-full px-3 py-2 rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-mono" />
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={saveEdit} className="flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white rounded text-sm hover:bg-primary-700">
                            <Save className="w-3.5 h-3.5" /> Salva
                          </button>
                          <button onClick={() => previewTemplate(editContent)} className="flex items-center gap-1 px-3 py-1.5 border border-surface-300 dark:border-surface-600 rounded text-sm hover:bg-surface-100 dark:hover:bg-surface-700">
                            <Eye className="w-3.5 h-3.5" /> Preview
                          </button>
                          <button onClick={cancelEdit} className="px-3 py-1.5 text-surface-500 text-sm hover:text-surface-700">
                            Annulla
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* View mode */
                      <div>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium text-surface-900 dark:text-white">{t.display_name}</h3>
                              {t.is_default && (
                                <span className="text-xs px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 rounded">Default</span>
                              )}
                              {!t.is_active && (
                                <span className="text-xs px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 rounded">Disattivato</span>
                              )}
                            </div>
                            {t.description && (
                              <p className="text-sm text-surface-500 mt-0.5">{t.description}</p>
                            )}
                            <code className="text-xs text-surface-400 font-mono">{t.name}</code>
                          </div>
                          <div className="flex items-center gap-1 ml-4">
                            <button onClick={() => previewTemplate(t.content)} title="Preview"
                              className="p-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 hover:text-surface-700">
                              <Eye className="w-4 h-4" />
                            </button>
                            <button onClick={() => startEdit(t)} title="Modifica"
                              className="p-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 hover:text-surface-700">
                              <FileText className="w-4 h-4" />
                            </button>
                            <button onClick={() => toggleActive(t.id, t.is_active)} title={t.is_active ? 'Disattiva' : 'Attiva'}
                              className="p-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700">
                              {t.is_active
                                ? <ToggleRight className="w-4 h-4 text-green-500" />
                                : <ToggleLeft className="w-4 h-4 text-surface-400" />
                              }
                            </button>
                            {!t.is_default && (
                              <button onClick={() => deleteTemplate(t.id)} title="Elimina"
                                className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-surface-400 hover:text-red-600">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                        <pre className="mt-2 text-xs font-mono text-surface-600 dark:text-surface-400 bg-surface-50 dark:bg-surface-900 p-3 rounded-lg max-h-32 overflow-y-auto whitespace-pre-wrap">
                          {t.content}
                        </pre>
                        {t.variables && t.variables.length > 0 && (
                          <div className="mt-2 flex items-center gap-1 flex-wrap">
                            <span className="text-xs text-surface-400">Variabili:</span>
                            {t.variables.map(v => (
                              <code key={v} className="text-xs font-mono bg-surface-100 dark:bg-surface-700 px-1.5 py-0.5 rounded text-surface-600 dark:text-surface-300">{`{{${v}}}`}</code>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {templates.length === 0 && (
        <div className="text-center py-12 text-surface-500">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Nessun template trovato. I template predefiniti verranno creati al prossimo avvio del server.</p>
        </div>
      )}
    </div>
  );
}
