import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import {
  Plus,
  MoreVertical,
  Calendar,
  Tag,
  MessageSquare,
  Clock,
  User,
  Trash2,
  Edit3,
  GripVertical,
  ChevronDown,
  Filter,
  Search,
  CheckCircle,
  Send
} from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';

interface Task {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  project_id: number;
  assigned_to?: number;
  assigned_name?: string;
  due_date?: string;
  tags: string[];
  ai_context?: string;
  created_at: string;
  updated_at: string;
  position: number;
}

interface Project {
  id: number;
  name: string;
  description: string;
  color: string;
  columns: string[];
  created_at: string;
}

const PRIORITY_COLORS = {
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
};

const DEFAULT_COLUMNS = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'];

export default function KanbanPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newTaskColumn, setNewTaskColumn] = useState<string>('');
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [completingTask, setCompletingTask] = useState<Task | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadTasks(selectedProject.id);
    }
  }, [selectedProject]);

  const loadProjects = async () => {
    setProjectsError(null);
    try {
      console.log('[Kanban] Loading projects from /projects...');
      const response = await api.get('/projects');
      console.log('[Kanban] Projects response:', response.data);
      setProjects(response.data || []);
      if (response.data?.length > 0) {
        setSelectedProject(response.data[0]);
      }
    } catch (err: any) {
      const errorMsg = `[Projects API Error] ${err.response?.status || 'Network'}: ${err.response?.data?.error || err.message || 'Unknown error'}`;
      console.error('[Kanban] Failed to load projects:', errorMsg, err);
      setProjectsError(errorMsg);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  const loadTasks = async (projectId: number) => {
    setTasksError(null);
    try {
      console.log(`[Kanban] Loading tasks from /projects/${projectId}/tasks...`);
      const response = await api.get(`/projects/${projectId}/tasks`);
      console.log('[Kanban] Tasks response:', response.data);
      setTasks(response.data || []);
    } catch (err: any) {
      const errorMsg = `[Tasks API Error] ${err.response?.status || 'Network'}: ${err.response?.data?.error || err.message || 'Unknown error'}`;
      console.error('[Kanban] Failed to load tasks:', errorMsg, err);
      setTasksError(errorMsg);
      setTasks([]);
    }
  };

  const handleDragStart = (task: Task) => {
    setDraggedTask(task);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (column: string) => {
    if (!draggedTask || draggedTask.status === column) {
      setDraggedTask(null);
      return;
    }

    try {
      await api.patch(`/tasks/${draggedTask.id}`, { status: column });
      setTasks(tasks.map(t => t.id === draggedTask.id ? { ...t, status: column } : t));
    } catch (err) {
      console.error('Failed to update task:', err);
    }
    setDraggedTask(null);
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!confirm('Eliminare questo task?')) return;
    try {
      await api.delete(`/tasks/${taskId}`);
      setTasks(tasks.filter(t => t.id !== taskId));
    } catch (err) {
      console.error('Failed to delete task:', err);
      setTasks(tasks.filter(t => t.id !== taskId));
    }
  };

  const openFeedbackModal = (task: Task) => {
    setCompletingTask(task);
    setFeedbackText('');
    setShowFeedbackModal(true);
  };

  const handleCompleteWithFeedback = async () => {
    if (!completingTask || !selectedProject) return;
    setSubmittingFeedback(true);
    try {
      // Update task to "Completato" status
      await api.patch(`/tasks/${completingTask.id}`, {
        status: 'Completato',
        feedback: feedbackText || null,
        completed_at: new Date().toISOString()
      });

      // Send notification if feedback provided
      if (feedbackText.trim()) {
        try {
          await api.post('/notifications', {
            type: 'task_completed',
            message: `Task "${completingTask.title}" completato: ${feedbackText}`,
            card_id: completingTask.id,
            project_id: selectedProject.id
          });
        } catch (notifErr) {
          console.log('Notification endpoint not available:', notifErr);
        }
      }

      // Update local state
      setTasks(tasks.map(t =>
        t.id === completingTask.id
          ? { ...t, status: 'Completato' }
          : t
      ));

      setShowFeedbackModal(false);
      setCompletingTask(null);
      setFeedbackText('');
    } catch (err) {
      console.error('Failed to complete task:', err);
      alert('Errore nel completamento del task');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(search.toLowerCase()) ||
      task.description.toLowerCase().includes(search.toLowerCase());
    const matchesPriority = filterPriority === 'all' || task.priority === filterPriority;
    return matchesSearch && matchesPriority;
  });

  const columns = selectedProject?.columns || DEFAULT_COLUMNS;

  const getColumnTasks = (column: string) => {
    return filteredTasks
      .filter(t => t.status === column)
      .sort((a, b) => a.position - b.position);
  };

  if (loading) {
    return <div className="p-6">Caricamento...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Error Banners */}
      {projectsError && (
        <div className="mx-6 mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="text-red-600 dark:text-red-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-red-800 dark:text-red-300">Errore caricamento progetti</h4>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1 font-mono">{projectsError}</p>
              <button
                onClick={loadProjects}
                className="mt-2 text-sm text-red-700 dark:text-red-300 underline hover:no-underline"
              >
                Riprova
              </button>
            </div>
          </div>
        </div>
      )}
      {tasksError && (
        <div className="mx-6 mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="text-amber-600 dark:text-amber-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-amber-800 dark:text-amber-300">Errore caricamento tasks</h4>
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-1 font-mono">{tasksError}</p>
              <button
                onClick={() => selectedProject && loadTasks(selectedProject.id)}
                className="mt-2 text-sm text-amber-700 dark:text-amber-300 underline hover:no-underline"
              >
                Riprova
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="p-6 border-b border-surface-200 dark:border-surface-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">Kanban</h1>
            <select
              value={selectedProject?.id || ''}
              onChange={(e) => {
                const proj = projects.find(p => p.id === parseInt(e.target.value));
                setSelectedProject(proj || null);
              }}
              className="input"
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowProjectModal(true)}
              className="btn-secondary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Nuovo Progetto
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca task..."
              className="input pl-10 w-full"
            />
          </div>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="input w-40"
          >
            <option value="all">Tutte le priorità</option>
            <option value="urgent">Urgente</option>
            <option value="high">Alta</option>
            <option value="medium">Media</option>
            <option value="low">Bassa</option>
          </select>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto p-6">
        {projects.length === 0 && !projectsError && (
          <div className="text-center py-12 text-surface-500">
            <p className="text-lg mb-2">Nessun progetto trovato</p>
            <p className="text-sm font-mono">API endpoint: /projects - Risposta vuota o non valida</p>
            <p className="text-sm mt-4">Crea un nuovo progetto per iniziare.</p>
          </div>
        )}
        <div className="flex gap-4 h-full min-w-max">
          {columns.map((column) => (
            <div
              key={column}
              className="w-80 flex flex-col bg-surface-100 dark:bg-surface-900 rounded-xl"
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(column)}
            >
              {/* Column Header */}
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{column}</h3>
                  <span className="px-2 py-0.5 text-xs rounded-full bg-surface-200 dark:bg-surface-800">
                    {getColumnTasks(column).length}
                  </span>
                </div>
                <button
                  onClick={() => { setNewTaskColumn(column); setEditingTask(null); setShowTaskModal(true); }}
                  className="p-1 hover:bg-surface-200 dark:hover:bg-surface-800 rounded"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Tasks */}
              <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
                {getColumnTasks(column).map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => handleDragStart(task)}
                    className={clsx(
                      'bg-white dark:bg-surface-800 rounded-lg p-4 shadow-sm cursor-move',
                      'hover:shadow-md transition-shadow',
                      draggedTask?.id === task.id && 'opacity-50'
                    )}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-medium text-sm">{task.title}</h4>
                      <div className="flex items-center gap-1">
                        {task.status !== 'Completato' && (
                          <button
                            onClick={() => openFeedbackModal(task)}
                            className="p-1 hover:bg-green-50 dark:hover:bg-green-900/20 rounded text-green-600"
                            title="Completa con feedback"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => { setEditingTask(task); setShowTaskModal(true); }}
                          className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteTask(task.id)}
                          className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {task.description && (
                      <p className="text-xs text-surface-500 mb-3 line-clamp-2">
                        {task.description}
                      </p>
                    )}

                    {/* Tags */}
                    {task.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {task.tags.map((tag, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 text-xs rounded-full bg-surface-100 dark:bg-surface-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-3 border-t border-surface-100 dark:border-surface-700">
                      <span className={clsx(
                        'px-2 py-0.5 text-xs rounded-full font-medium',
                        PRIORITY_COLORS[task.priority]
                      )}>
                        {task.priority}
                      </span>
                      <div className="flex items-center gap-2">
                        {task.due_date && (
                          <span className="flex items-center gap-1 text-xs text-surface-500">
                            <Calendar className="w-3 h-3" />
                            {format(new Date(task.due_date), 'dd/MM')}
                          </span>
                        )}
                        {task.assigned_name && (
                          <span className="flex items-center gap-1 text-xs text-surface-500">
                            <User className="w-3 h-3" />
                            {task.assigned_name.split(' ')[0]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Task Modal */}
      {showTaskModal && (
        <TaskModal
          task={editingTask}
          column={newTaskColumn}
          projectId={selectedProject?.id || 0}
          onClose={() => { setShowTaskModal(false); setEditingTask(null); }}
          onSave={() => { loadTasks(selectedProject?.id || 0); setShowTaskModal(false); setEditingTask(null); }}
        />
      )}

      {/* Project Modal */}
      {showProjectModal && (
        <ProjectModal
          onClose={() => setShowProjectModal(false)}
          onSave={() => { loadProjects(); setShowProjectModal(false); }}
        />
      )}

      {/* Feedback Modal */}
      {showFeedbackModal && completingTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-surface-800 rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-4">Completa Task con Feedback</h3>
            <div className="mb-4">
              <p className="text-sm text-surface-500 mb-2">Task: <strong>{completingTask.title}</strong></p>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Feedback / Note di completamento</label>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Inserisci eventuali note sul completamento del task..."
                className="input w-full h-32 resize-none"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowFeedbackModal(false); setCompletingTask(null); }}
                className="btn-secondary"
                disabled={submittingFeedback}
              >
                Annulla
              </button>
              <button
                onClick={handleCompleteWithFeedback}
                disabled={submittingFeedback}
                className="btn-primary flex items-center gap-2"
              >
                {submittingFeedback ? 'Completamento...' : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Completa
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskModal({ task, column, projectId, onClose, onSave }: {
  task: Task | null;
  column: string;
  projectId: number;
  onClose: () => void;
  onSave: () => void;
}) {
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    priority: task?.priority || 'medium',
    status: task?.status || column,
    due_date: task?.due_date?.split('T')[0] || '',
    tags: task?.tags.join(', ') || ''
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = {
        ...form,
        project_id: projectId,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean)
      };
      if (task) {
        await api.patch(`/tasks/${task.id}`, data);
      } else {
        await api.post('/tasks', data);
      }
      onSave();
    } catch (err) {
      console.error('Failed to save task:', err);
      onSave(); // Close for demo
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-surface-900 rounded-xl shadow-xl w-full max-w-lg">
        <div className="p-6 border-b border-surface-200 dark:border-surface-800">
          <h2 className="text-xl font-bold">{task ? 'Modifica Task' : 'Nuovo Task'}</h2>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Titolo</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="input w-full"
              placeholder="Titolo del task..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Descrizione</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input w-full h-24"
              placeholder="Descrizione dettagliata..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Priorità</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as any })}
                className="input w-full"
              >
                <option value="low">Bassa</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Scadenza</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="input w-full"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Tags (separati da virgola)</label>
            <input
              type="text"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              className="input w-full"
              placeholder="frontend, bug, feature..."
            />
          </div>
        </div>

        <div className="p-6 border-t border-surface-200 dark:border-surface-800 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Annulla</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Salvataggio...' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectModal({ onClose, onSave }: {
  onClose: () => void;
  onSave: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    color: '#3b82f6'
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post('/projects', {
        ...form,
        columns: DEFAULT_COLUMNS
      });
      onSave();
    } catch (err) {
      console.error('Failed to save project:', err);
      onSave(); // Close for demo
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-surface-900 rounded-xl shadow-xl w-full max-w-md">
        <div className="p-6 border-b border-surface-200 dark:border-surface-800">
          <h2 className="text-xl font-bold">Nuovo Progetto</h2>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nome</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input w-full"
              placeholder="Nome del progetto..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Descrizione</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input w-full h-20"
              placeholder="Descrizione..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Colore</label>
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              className="input w-20 h-10 p-1"
            />
          </div>
        </div>

        <div className="p-6 border-t border-surface-200 dark:border-surface-800 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Annulla</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Salvataggio...' : 'Crea'}
          </button>
        </div>
      </div>
    </div>
  );
}
