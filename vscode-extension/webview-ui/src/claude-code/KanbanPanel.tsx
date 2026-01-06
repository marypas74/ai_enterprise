import React, { useState } from 'react';

interface Card {
  id: number;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status?: string;
  column_id: string | number;
  assignee_name?: string;
  due_date?: string;
  tags?: string[];
}

interface Column {
  id: string | number;
  name: string;
  color: string;
  cards: Card[];
}

interface Project {
  id: number;
  name: string;
  description?: string;
  color: string;
}

interface KanbanAccessDenied {
  message: string;
  groups?: { name: string; kanbanEnabled: boolean }[];
}

interface KanbanPanelProps {
  projects: Project[];
  columns: Column[];
  selectedProject?: number;
  accessDenied?: KanbanAccessDenied | null;
  onSelectProject: (projectId: number) => void;
  onUpdateCard: (cardId: number, columnId: string | number, notes?: string) => void;
  onAddNote: (cardId: number, note: string) => void;
  onCompleteWithFeedback?: (cardId: number, feedback: string) => void;
  onDeleteCard?: (cardId: number) => void;
  onEditCard?: (card: Card) => void;
  onExecuteTask?: (card: Card) => void;
  isCompact?: boolean; // For split view mode
}

const KanbanPanel: React.FC<KanbanPanelProps> = ({
  projects,
  columns,
  selectedProject,
  accessDenied,
  onSelectProject,
  onUpdateCard,
  onAddNote,
  onCompleteWithFeedback,
  onDeleteCard,
  onEditCard,
  onExecuteTask,
  isCompact = false,
}) => {
  const [expandedCard, setExpandedCard] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');
  const [draggedCard, setDraggedCard] = useState<Card | null>(null);
  const [feedbackModal, setFeedbackModal] = useState<{ card: Card; columnName: string } | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [editModal, setEditModal] = useState<Card | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', priority: 'medium' as Card['priority'] });
  const [deleteConfirm, setDeleteConfirm] = useState<Card | null>(null);

  const priorityColors: Record<string, string> = {
    low: '#22c55e',
    medium: '#3b82f6',
    high: '#f97316',
    urgent: '#ef4444',
  };

  const priorityLabels: Record<string, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    urgent: 'Urgent',
  };

  const handleDragStart = (card: Card) => {
    setDraggedCard(card);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (columnId: string | number, columnName: string) => {
    if (draggedCard && draggedCard.column_id !== columnId) {
      // If dropping to Done column, show feedback modal
      if (columnName === 'Done' || columnName === 'Completato') {
        setFeedbackModal({ card: draggedCard, columnName });
      } else {
        onUpdateCard(draggedCard.id, columnId);
      }
      setDraggedCard(null);
    }
  };

  const handleCompleteTask = () => {
    if (feedbackModal) {
      if (onCompleteWithFeedback && feedbackText.trim()) {
        onCompleteWithFeedback(feedbackModal.card.id, feedbackText);
      } else {
        onUpdateCard(feedbackModal.card.id, feedbackModal.columnName);
      }
      setFeedbackModal(null);
      setFeedbackText('');
    }
  };

  const handleAddNote = (cardId: number) => {
    if (noteText.trim()) {
      onAddNote(cardId, noteText);
      setNoteText('');
      setExpandedCard(null);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  };

  const totalCards = columns.reduce((sum, col) => sum + col.cards.length, 0);

  return (
    <div className={`kanban-panel ${isCompact ? 'kanban-compact' : ''}`}>
      {/* Project Selector */}
      <div className="kanban-header">
        <h3 className="kanban-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
          Kanban Board
        </h3>
        <select
          className="project-selector"
          value={selectedProject || ''}
          onChange={(e) => onSelectProject(Number(e.target.value))}
        >
          <option value="">Select Project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Stats Bar */}
      {selectedProject && columns.length > 0 && (
        <div className="kanban-stats">
          <span className="stat-item">
            <strong>{totalCards}</strong> tasks
          </span>
          {columns.map(col => (
            <span key={String(col.id)} className="stat-item" style={{ color: col.color }}>
              {col.name}: {col.cards.length}
            </span>
          ))}
        </div>
      )}

      {/* Kanban Board */}
      {selectedProject && columns.length > 0 ? (
        <div className="kanban-board">
          {columns.map((column) => (
            <div
              key={String(column.id)}
              className="kanban-column"
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(column.id, column.name)}
            >
              <div
                className="kanban-column-header"
                style={{ borderTopColor: column.color }}
              >
                <span className="column-name">{column.name}</span>
                <span className="column-count">{column.cards.length}</span>
              </div>

              <div className="kanban-cards">
                {column.cards.map((card) => (
                  <div
                    key={card.id}
                    className={`kanban-card ${expandedCard === card.id ? 'expanded' : ''} ${draggedCard?.id === card.id ? 'dragging' : ''}`}
                    draggable
                    onDragStart={() => handleDragStart(card)}
                  >
                    <div className="card-header">
                      <span
                        className="card-priority"
                        style={{ backgroundColor: priorityColors[card.priority] }}
                        title={priorityLabels[card.priority]}
                      />
                      <span className="card-title">{card.title}</span>
                    </div>

                    {card.description && (
                      <p className="card-description">{card.description}</p>
                    )}

                    {/* Tags */}
                    {card.tags && card.tags.length > 0 && (
                      <div className="card-tags">
                        {card.tags.map((tag, i) => (
                          <span key={i} className="card-tag">{tag}</span>
                        ))}
                      </div>
                    )}

                    <div className="card-meta">
                      {card.assignee_name && (
                        <span className="card-assignee">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                          {card.assignee_name}
                        </span>
                      )}
                      {card.due_date && (
                        <span className="card-due">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                          {formatDate(card.due_date)}
                        </span>
                      )}
                    </div>

                    {/* Quick Actions */}
                    <div className="card-actions">
                      {/* Execute with AI button - Primary action */}
                      {onExecuteTask && (
                        <button
                          className="card-action-btn execute"
                          onClick={() => onExecuteTask(card)}
                          title="Execute with AI"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                        </button>
                      )}

                      {/* Edit button */}
                      <button
                        className="card-action-btn edit"
                        onClick={() => {
                          setEditForm({
                            title: card.title,
                            description: card.description || '',
                            priority: card.priority
                          });
                          setEditModal(card);
                        }}
                        title="Edit card"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>

                      <button
                        className="card-action-btn"
                        onClick={() => setExpandedCard(expandedCard === card.id ? null : card.id)}
                        title="Add development note"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>

                      {/* Complete with feedback button */}
                      {column.name !== 'Done' && column.name !== 'Completato' && (
                        <button
                          className="card-action-btn complete"
                          onClick={() => setFeedbackModal({ card, columnName: 'Done' })}
                          title="Complete with feedback"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                      )}

                      {/* Move to next column */}
                      {columns.findIndex((c) => String(c.id) === String(column.id)) < columns.length - 1 && (
                        <button
                          className="card-action-btn move"
                          onClick={() => {
                            const nextCol = columns[columns.findIndex((c) => String(c.id) === String(column.id)) + 1];
                            if (nextCol.name === 'Done' || nextCol.name === 'Completato') {
                              setFeedbackModal({ card, columnName: nextCol.name });
                            } else {
                              onUpdateCard(card.id, nextCol.id);
                            }
                          }}
                          title="Move to next column"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="5" y1="12" x2="19" y2="12" />
                            <polyline points="12 5 19 12 12 19" />
                          </svg>
                        </button>
                      )}

                      {/* Delete button */}
                      <button
                        className="card-action-btn delete"
                        onClick={() => setDeleteConfirm(card)}
                        title="Delete card"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>

                    {/* Expanded Note Input */}
                    {expandedCard === card.id && (
                      <div className="card-note-input">
                        <textarea
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="Add development progress note..."
                          rows={3}
                        />
                        <div className="note-actions">
                          <button
                            className="note-btn cancel"
                            onClick={() => {
                              setExpandedCard(null);
                              setNoteText('');
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            className="note-btn submit"
                            onClick={() => handleAddNote(card.id)}
                            disabled={!noteText.trim()}
                          >
                            Add Note
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : accessDenied ? (
        <div className="kanban-empty kanban-access-denied">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          <h3 style={{ color: '#ef4444', margin: '16px 0 8px 0' }}>Kanban Access Denied</h3>
          <p>{accessDenied.message}</p>
          {accessDenied.groups && accessDenied.groups.length > 0 && (
            <div style={{ marginTop: '16px', fontSize: '12px', color: '#888' }}>
              <p>Your groups:</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
                {accessDenied.groups.map((g, i) => (
                  <li key={i} style={{ padding: '4px 0' }}>
                    <span style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: g.kanbanEnabled ? '#22c55e' : '#ef4444',
                      marginRight: '8px'
                    }} />
                    {g.name} - {g.kanbanEnabled ? 'Kanban Enabled' : 'No Kanban Access'}
                  </li>
                ))}
              </ul>
              <p style={{ marginTop: '12px' }}>Contact your administrator to request Kanban access.</p>
            </div>
          )}
        </div>
      ) : selectedProject ? (
        <div className="kanban-empty">
          <p>No tasks found. Create tasks in the admin console.</p>
        </div>
      ) : (
        <div className="kanban-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
          <p>Select a project to view the Kanban board</p>
        </div>
      )}

      {/* Feedback Modal */}
      {feedbackModal && (
        <div className="feedback-modal-overlay">
          <div className="feedback-modal">
            <h3>Complete Task</h3>
            <p className="modal-task-title">{feedbackModal.card.title}</p>
            <div className="feedback-input-group">
              <label>Feedback / Completion Notes (optional)</label>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Add notes about the completion, issues resolved, or next steps..."
                rows={4}
              />
            </div>
            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => {
                  setFeedbackModal(null);
                  setFeedbackText('');
                }}
              >
                Cancel
              </button>
              <button
                className="modal-btn complete"
                onClick={handleCompleteTask}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Complete Task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editModal && (
        <div className="feedback-modal-overlay">
          <div className="feedback-modal edit-modal">
            <h3>Edit Task</h3>
            <div className="feedback-input-group">
              <label>Title</label>
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                placeholder="Task title..."
                className="edit-input"
              />
            </div>
            <div className="feedback-input-group">
              <label>Description</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="Task description..."
                rows={3}
              />
            </div>
            <div className="feedback-input-group">
              <label>Priority</label>
              <select
                value={editForm.priority}
                onChange={(e) => setEditForm({ ...editForm, priority: e.target.value as Card['priority'] })}
                className="edit-select"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => {
                  setEditModal(null);
                  setEditForm({ title: '', description: '', priority: 'medium' });
                }}
              >
                Cancel
              </button>
              <button
                className="modal-btn complete"
                onClick={() => {
                  if (onEditCard && editForm.title.trim()) {
                    onEditCard({
                      ...editModal,
                      title: editForm.title,
                      description: editForm.description,
                      priority: editForm.priority
                    });
                  }
                  setEditModal(null);
                  setEditForm({ title: '', description: '', priority: 'medium' });
                }}
                disabled={!editForm.title.trim()}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="feedback-modal-overlay">
          <div className="feedback-modal delete-modal">
            <h3>Delete Task</h3>
            <p className="modal-task-title">{deleteConfirm.title}</p>
            <p className="delete-warning">Are you sure you want to delete this task? This action cannot be undone.</p>
            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="modal-btn delete"
                onClick={() => {
                  if (onDeleteCard) {
                    onDeleteCard(deleteConfirm.id);
                  }
                  setDeleteConfirm(null);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Delete Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KanbanPanel;
