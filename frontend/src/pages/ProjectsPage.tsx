import { useState, useEffect } from 'react';
import { api } from '../services/api';
import {
  Plus,
  FolderKanban,
  MoreVertical,
  Calendar,
  Users,
  CheckSquare,
  X,
  ChevronLeft,
  Edit2,
  Trash2
} from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';

interface Project {
  id: number;
  name: string;
  description: string;
  color: string;
  icon: string;
  is_archived: boolean;
  board_count: number;
  card_count: number;
  role: string;
}

interface Column {
  id: number;
  name: string;
  color: string;
  wip_limit: number;
  cards: Card[];
}

interface Card {
  id: number;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date: string | null;
  assignee_name: string | null;
  labels: number[];
  sort_order: number;
}

interface Label {
  id: number;
  name: string;
  color: string;
}

interface Board {
  id: number;
  name: string;
  columns: Column[];
}

const PRIORITY_COLORS = {
  low: 'bg-surface-100 text-surface-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-amber-100 text-amber-700',
  urgent: 'bg-red-100 text-red-700'
};

function ProjectsList({ onSelectProject }: { onSelectProject: (id: number) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState('#3B82F6');

  // Edit state
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editProjectName, setEditProjectName] = useState('');
  const [editProjectDescription, setEditProjectDescription] = useState('');
  const [editProjectColor, setEditProjectColor] = useState('#3B82F6');

  // Delete state
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  // Menu state
  const [menuOpen, setMenuOpen] = useState<number | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const response = await api.get('/projects');
      setProjects(response.data);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  };

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      await api.post('/projects', {
        name: newProjectName,
        color: newProjectColor
      });
      setNewProjectName('');
      setShowNewProject(false);
      loadProjects();
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  };

  const startEditProject = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProject(project);
    setEditProjectName(project.name);
    setEditProjectDescription(project.description || '');
    setEditProjectColor(project.color);
    setMenuOpen(null);
  };

  const updateProject = async () => {
    if (!editingProject || !editProjectName.trim()) return;
    try {
      await api.patch(`/projects/${editingProject.id}`, {
        name: editProjectName,
        description: editProjectDescription,
        color: editProjectColor
      });
      setEditingProject(null);
      loadProjects();
    } catch (err) {
      console.error('Failed to update project:', err);
    }
  };

  const confirmDeleteProject = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingProject(project);
    setMenuOpen(null);
  };

  const deleteProject = async () => {
    if (!deletingProject) return;
    try {
      await api.delete(`/projects/${deletingProject.id}`);
      setDeletingProject(null);
      loadProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-surface-500 mt-1">Manage your projects and tasks</p>
        </div>
        <button
          onClick={() => setShowNewProject(true)}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      {/* New Project Form */}
      {showNewProject && (
        <div className="card p-4 mb-6">
          <div className="flex gap-4">
            <input
              type="color"
              value={newProjectColor}
              onChange={(e) => setNewProjectColor(e.target.value)}
              className="w-12 h-10 rounded cursor-pointer"
            />
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name..."
              className="input flex-1"
              autoFocus
            />
            <button onClick={createProject} className="btn btn-primary">Create</button>
            <button onClick={() => setShowNewProject(false)} className="btn btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map(project => (
          <div
            key={project.id}
            onClick={() => onSelectProject(project.id)}
            className="card p-4 cursor-pointer hover:shadow-md transition-shadow relative"
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-lg"
                style={{ backgroundColor: project.color }}
              >
                <FolderKanban className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">{project.name}</h3>
                {project.description && (
                  <p className="text-sm text-surface-500 line-clamp-1">{project.description}</p>
                )}
              </div>

              {/* Menu Button */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(menuOpen === project.id ? null : project.id);
                  }}
                  className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg"
                >
                  <MoreVertical className="w-4 h-4 text-surface-500" />
                </button>

                {/* Dropdown Menu */}
                {menuOpen === project.id && (
                  <div className="absolute right-0 top-8 z-10 bg-white dark:bg-surface-800 rounded-lg shadow-lg border border-surface-200 dark:border-surface-700 py-1 min-w-[120px]">
                    <button
                      onClick={(e) => startEditProject(project, e)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-100 dark:hover:bg-surface-700 text-left"
                    >
                      <Edit2 className="w-4 h-4" />
                      Edit
                    </button>
                    <button
                      onClick={(e) => confirmDeleteProject(project, e)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-100 dark:hover:bg-surface-700 text-left text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 mt-4 text-xs text-surface-500">
              <span className="flex items-center gap-1">
                <FolderKanban className="w-3.5 h-3.5" />
                {project.board_count} boards
              </span>
              <span className="flex items-center gap-1">
                <CheckSquare className="w-3.5 h-3.5" />
                {project.card_count} tasks
              </span>
            </div>
          </div>
        ))}
      </div>

      {projects.length === 0 && !showNewProject && (
        <div className="card p-12 text-center">
          <FolderKanban className="w-12 h-12 mx-auto text-surface-300 mb-4" />
          <h3 className="text-lg font-medium">No projects yet</h3>
          <p className="text-surface-500 mt-1">Create your first project to get started</p>
        </div>
      )}

      {/* Edit Project Modal */}
      {editingProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditingProject(null)}>
          <div className="bg-white dark:bg-surface-800 rounded-xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Edit Project</h2>
              <button onClick={() => setEditingProject(null)} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Color</label>
                  <input
                    type="color"
                    value={editProjectColor}
                    onChange={(e) => setEditProjectColor(e.target.value)}
                    className="w-12 h-10 rounded cursor-pointer"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">Name</label>
                  <input
                    type="text"
                    value={editProjectName}
                    onChange={(e) => setEditProjectName(e.target.value)}
                    className="input w-full"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={editProjectDescription}
                  onChange={(e) => setEditProjectDescription(e.target.value)}
                  className="input w-full resize-none"
                  rows={3}
                  placeholder="Project description..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setEditingProject(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={updateProject} className="btn btn-primary">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeletingProject(null)}>
          <div className="bg-white dark:bg-surface-800 rounded-xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Delete Project</h2>
                <p className="text-sm text-surface-500">This action cannot be undone</p>
              </div>
            </div>

            <p className="text-surface-600 dark:text-surface-400 mb-6">
              Are you sure you want to delete <span className="font-semibold">{deletingProject.name}</span>?
              All boards, cards, and associated data will be permanently deleted.
            </p>

            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingProject(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={deleteProject} className="btn bg-red-600 text-white hover:bg-red-700">Delete Project</button>
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-0" onClick={() => setMenuOpen(null)} />
      )}
    </div>
  );
}

function KanbanBoard({ projectId, onBack }: { projectId: number; onBack: () => void }) {
  const [project, setProject] = useState<any>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCardColumn, setNewCardColumn] = useState<number | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [draggedCard, setDraggedCard] = useState<{ cardId: number; columnId: number } | null>(null);

  useEffect(() => {
    loadProject();
  }, [projectId]);

  const loadProject = async () => {
    try {
      const response = await api.get(`/projects/${projectId}`);
      setProject(response.data);
      setLabels(response.data.labels || []);

      if (response.data.boards?.length > 0) {
        const boardId = response.data.boards[0].id;
        const boardResponse = await api.get(`/projects/${projectId}/boards/${boardId}`);
        setBoard(boardResponse.data);
      }
    } catch (err) {
      console.error('Failed to load project:', err);
    } finally {
      setLoading(false);
    }
  };

  const createCard = async (columnId: number) => {
    if (!newCardTitle.trim()) return;
    try {
      await api.post(`/projects/${projectId}/columns/${columnId}/cards`, {
        title: newCardTitle
      });
      setNewCardTitle('');
      setNewCardColumn(null);
      loadProject();
    } catch (err) {
      console.error('Failed to create card:', err);
    }
  };

  const moveCard = async (cardId: number, newColumnId: number, sortOrder: number) => {
    try {
      await api.post(`/projects/${projectId}/cards/${cardId}/move`, {
        column_id: newColumnId,
        sort_order: sortOrder
      });
      loadProject();
    } catch (err) {
      console.error('Failed to move card:', err);
    }
  };

  const handleDragStart = (cardId: number, columnId: number) => {
    setDraggedCard({ cardId, columnId });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (columnId: number, sortOrder: number) => {
    if (draggedCard) {
      moveCard(draggedCard.cardId, columnId, sortOrder);
      setDraggedCard(null);
    }
  };

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!board) {
    return (
      <div className="p-6">
        <button onClick={onBack} className="flex items-center gap-2 text-surface-600 hover:text-surface-900 mb-6">
          <ChevronLeft className="w-5 h-5" />
          Back to Projects
        </button>
        <p>No board found</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
            style={{ backgroundColor: project?.color }}
          >
            <FolderKanban className="w-4 h-4" />
          </div>
          <div>
            <h1 className="font-semibold">{project?.name}</h1>
            <p className="text-sm text-surface-500">{board.name}</p>
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 h-full min-w-max">
          {board.columns.map((column) => (
            <div
              key={column.id}
              className="w-80 flex-shrink-0 flex flex-col"
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(column.id, column.cards.length)}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: column.color }}
                  />
                  <h3 className="font-medium">{column.name}</h3>
                  <span className="text-xs text-surface-500 bg-surface-100 dark:bg-surface-800 px-2 py-0.5 rounded-full">
                    {column.cards.length}
                  </span>
                </div>
                <button
                  onClick={() => setNewCardColumn(column.id)}
                  className="p-1 hover:bg-surface-100 dark:hover:bg-surface-800 rounded"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Cards Container */}
              <div className="flex-1 space-y-2 min-h-[200px] bg-surface-50 dark:bg-surface-900/50 rounded-lg p-2">
                {/* New Card Form */}
                {newCardColumn === column.id && (
                  <div className="card p-3">
                    <textarea
                      value={newCardTitle}
                      onChange={(e) => setNewCardTitle(e.target.value)}
                      placeholder="Enter card title..."
                      className="w-full resize-none border-0 bg-transparent p-0 focus:ring-0"
                      rows={2}
                      autoFocus
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => createCard(column.id)}
                        className="btn btn-primary btn-sm"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setNewCardColumn(null); setNewCardTitle(''); }}
                        className="btn btn-secondary btn-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Cards */}
                {column.cards.map((card) => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={() => handleDragStart(card.id, column.id)}
                    className="card p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
                  >
                    {/* Labels */}
                    {card.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {card.labels.map(labelId => {
                          const label = labels.find(l => l.id === labelId);
                          return label ? (
                            <span
                              key={labelId}
                              className="w-8 h-1.5 rounded-full"
                              style={{ backgroundColor: label.color }}
                            />
                          ) : null;
                        })}
                      </div>
                    )}

                    {/* Title */}
                    <p className="text-sm font-medium">{card.title}</p>

                    {/* Meta */}
                    <div className="flex items-center gap-3 mt-2 text-xs text-surface-500">
                      {card.due_date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(card.due_date), 'MMM d')}
                        </span>
                      )}
                      <span className={clsx(
                        'px-1.5 py-0.5 rounded text-[10px] font-medium',
                        PRIORITY_COLORS[card.priority]
                      )}>
                        {card.priority}
                      </span>
                    </div>

                    {card.assignee_name && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-surface-500">
                        <Users className="w-3 h-3" />
                        {card.assignee_name}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  if (selectedProject) {
    return (
      <KanbanBoard
        projectId={selectedProject}
        onBack={() => setSelectedProject(null)}
      />
    );
  }

  return <ProjectsList onSelectProject={setSelectedProject} />;
}
