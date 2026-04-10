import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { Save, Eye, Edit3, RefreshCw, BookOpen, FileText } from 'lucide-react';
import clsx from 'clsx';

interface GuideMeta {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  updated_by_name: string | null;
  updated_at: string;
}

interface GuideDetail extends GuideMeta {
  content: string;
}

type Tab = 'editor' | 'preview';

export default function GuidesPage() {
  const [guides, setGuides] = useState<GuideMeta[]>([]);
  const [selected, setSelected] = useState<GuideDetail | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [tab, setTab] = useState<Tab>('editor');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadGuides();
  }, []);

  const loadGuides = async () => {
    try {
      const res = await api.get('/admin/guides');
      setGuides(res.data);
    } catch (err) {
      console.error('Failed to load guides:', err);
    }
  };

  const selectGuide = async (slug: string) => {
    if (dirty && !confirm('Hai modifiche non salvate. Continuare?')) return;
    setLoading(true);
    try {
      const res = await api.get(`/admin/guides/${slug}`);
      setSelected(res.data);
      setEditContent(res.data.content);
      setEditTitle(res.data.title);
      setEditDescription(res.data.description || '');
      setDirty(false);
      setTab('editor');
    } catch (err) {
      console.error('Failed to load guide:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleContentChange = (val: string) => {
    setEditContent(val);
    setDirty(true);
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveMsg('');
    try {
      await api.put(`/admin/guides/${selected.slug}`, {
        content: editContent,
        title: editTitle || undefined,
        description: editDescription || undefined,
      });
      setDirty(false);
      setSaveMsg('Salvato con successo');
      await loadGuides();
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err: any) {
      setSaveMsg('Errore nel salvataggio: ' + (err?.response?.data?.error || String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    // Tab key inserts spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newVal = editContent.substring(0, start) + '  ' + editContent.substring(end);
      setEditContent(newVal);
      setDirty(true);
      requestAnimationFrame(() => {
        el.selectionStart = start + 2;
        el.selectionEnd = start + 2;
      });
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900">
        <BookOpen size={20} className="text-primary-500" />
        <h1 className="text-lg font-semibold text-surface-900 dark:text-surface-100">
          Gestione Guide
        </h1>
        <span className="text-sm text-surface-500">
          Modifica le guide disponibili agli utenti del portale
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — guide list */}
        <aside className="w-56 border-r border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 flex flex-col">
          <div className="p-3 text-xs font-semibold text-surface-500 uppercase tracking-wide">
            Guide disponibili
          </div>
          {guides.map(g => (
            <button
              key={g.slug}
              onClick={() => selectGuide(g.slug)}
              className={clsx(
                'flex items-start gap-2 px-3 py-3 text-left border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors',
                selected?.slug === g.slug && 'bg-primary-50 dark:bg-primary-900/20 border-l-2 border-l-primary-500'
              )}
            >
              <FileText size={14} className="mt-0.5 shrink-0 text-surface-400" />
              <div>
                <div className="text-sm font-medium text-surface-900 dark:text-surface-100">{g.title}</div>
                <div className="text-xs text-surface-400 mt-0.5">
                  {g.updated_by_name ? `Mod. da ${g.updated_by_name}` : 'Non modificata'}
                </div>
                <div className="text-xs text-surface-400">{formatDate(g.updated_at)}</div>
              </div>
            </button>
          ))}
        </aside>

        {/* Editor area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selected && !loading && (
            <div className="flex-1 flex items-center justify-center text-surface-400">
              <div className="text-center">
                <BookOpen size={40} className="mx-auto mb-2 opacity-30" />
                <p>Seleziona una guida da modificare</p>
              </div>
            </div>
          )}

          {loading && (
            <div className="flex-1 flex items-center justify-center text-surface-400">
              <RefreshCw size={24} className="animate-spin" />
            </div>
          )}

          {selected && !loading && (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900">
                <div className="flex gap-1">
                  <button
                    onClick={() => setTab('editor')}
                    className={clsx(
                      'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors',
                      tab === 'editor'
                        ? 'bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100'
                        : 'text-surface-500 hover:text-surface-700'
                    )}
                  >
                    <Edit3 size={13} /> Editor
                  </button>
                  <button
                    onClick={() => setTab('preview')}
                    className={clsx(
                      'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors',
                      tab === 'preview'
                        ? 'bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100'
                        : 'text-surface-500 hover:text-surface-700'
                    )}
                  >
                    <Eye size={13} /> Anteprima
                  </button>
                </div>

                <div className="flex-1" />

                {dirty && (
                  <span className="text-xs text-amber-500">Modifiche non salvate</span>
                )}
                {saveMsg && (
                  <span className={clsx(
                    'text-xs',
                    saveMsg.startsWith('Errore') ? 'text-red-500' : 'text-green-500'
                  )}>
                    {saveMsg}
                  </span>
                )}

                <button
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors',
                    saving || !dirty
                      ? 'bg-surface-100 dark:bg-surface-800 text-surface-400 cursor-not-allowed'
                      : 'bg-primary-500 hover:bg-primary-600 text-white'
                  )}
                >
                  {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                  Salva
                </button>
              </div>

              {/* Meta fields */}
              <div className="flex gap-3 px-4 py-2 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950">
                <div className="flex flex-col gap-0.5">
                  <label className="text-xs text-surface-500">Titolo</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={e => { setEditTitle(e.target.value); setDirty(true); }}
                    className="text-sm px-2 py-1 border border-surface-200 dark:border-surface-700 rounded bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 w-56"
                  />
                </div>
                <div className="flex flex-col gap-0.5 flex-1">
                  <label className="text-xs text-surface-500">Descrizione</label>
                  <input
                    type="text"
                    value={editDescription}
                    onChange={e => { setEditDescription(e.target.value); setDirty(true); }}
                    className="text-sm px-2 py-1 border border-surface-200 dark:border-surface-700 rounded bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 w-full"
                    maxLength={500}
                  />
                </div>
              </div>

              {/* Editor / Preview */}
              <div className="flex-1 overflow-hidden">
                {tab === 'editor' && (
                  <textarea
                    ref={textareaRef}
                    value={editContent}
                    onChange={e => handleContentChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    spellCheck={false}
                    className="w-full h-full resize-none p-4 font-mono text-xs bg-surface-950 text-surface-100 focus:outline-none leading-relaxed"
                    placeholder="Inserisci il contenuto HTML della guida..."
                  />
                )}
                {tab === 'preview' && (
                  <iframe
                    srcDoc={editContent}
                    className="w-full h-full border-0"
                    title="Anteprima guida"
                    sandbox="allow-same-origin"
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
