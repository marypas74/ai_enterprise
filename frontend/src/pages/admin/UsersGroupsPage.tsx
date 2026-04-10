import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import {
  Users,
  Search,
  Edit2,
  Trash2,
  Shield,
  X,
  Check,
  Plus,
  FolderKanban,
  Lock,
  Unlock,
} from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';
import UserForm from '../../components/admin/UserForm';
import GroupForm from '../../components/admin/GroupForm';
import type { User } from '../../components/admin/UserForm';
import type { Group } from '../../components/admin/GroupForm';

type ActiveTab = 'users' | 'groups';

// Modal Component
function Modal({ isOpen, onClose, title, children, size = 'md' }: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  if (!isOpen) return null;

  const sizeClasses = {
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={clsx(
        'relative bg-white dark:bg-surface-900 rounded-xl shadow-xl w-full mx-4 max-h-[90vh] overflow-auto',
        sizeClasses[size]
      )}>
        <div className="flex items-center justify-between p-4 border-b border-surface-200 dark:border-surface-700 sticky top-0 bg-white dark:bg-surface-900">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-800 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function UsersGroupsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showUserModal, setShowUserModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | undefined>();
  const [editingGroup, setEditingGroup] = useState<Group | undefined>();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ type: 'user' | 'group'; id: number; name: string } | null>(null);
  const [mfaEnforced, setMfaEnforced] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);

  useEffect(() => {
    loadData();
    loadMfaSetting();
  }, []);

  const loadMfaSetting = async () => {
    try {
      const res = await api.get('/admin/settings');
      const mfa = res.data?.mfa_enforced;
      if (mfa) {
        setMfaEnforced(mfa.value === true || mfa.value === 'true');
      }
    } catch {
      // Setting may not exist yet
    }
  };

  const toggleMfaEnforced = async () => {
    setMfaLoading(true);
    try {
      const newValue = !mfaEnforced;
      await api.put('/admin/settings/mfa_enforced', {
        setting_value: String(newValue),
      });
      setMfaEnforced(newValue);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Errore nel salvataggio impostazione MFA');
    } finally {
      setMfaLoading(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersRes, groupsRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/groups'),
      ]);
      setUsers(usersRes.data || []);
      setGroups(groupsRes.data || []);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  // User CRUD
  const handleSaveUser = async (data: any) => {
    try {
      if (editingUser) {
        await api.patch(`/admin/users/${editingUser.id}`, {
          name: data.name,
          role: data.role,
          is_active: data.is_active,
          password: data.password || undefined,
          phone: data.phone || null,
          company: data.company || null,
          department: data.department || null,
          job_title: data.job_title || null,
          notes: data.notes || null,
        });

        // Update group assignments
        const userDetails = await api.get(`/admin/users/${editingUser.id}`);
        let groupsArray: { id: number; name: string }[] = [];
        if (userDetails.data.groups) {
          if (typeof userDetails.data.groups === 'string') {
            try {
              groupsArray = JSON.parse(userDetails.data.groups);
              groupsArray = groupsArray.filter((g: any) => g && g.id != null);
            } catch { groupsArray = []; }
          } else if (Array.isArray(userDetails.data.groups)) {
            groupsArray = userDetails.data.groups.filter((g: any) => g && g.id != null);
          }
        }
        const currentGroups = groupsArray.map((g) => g.id);

        for (const gid of currentGroups) {
          if (!data.group_ids.includes(gid)) {
            await api.delete(`/admin/groups/${gid}/users/${editingUser.id}`);
          }
        }
        for (const gid of data.group_ids) {
          if (!currentGroups.includes(gid)) {
            await api.post(`/admin/groups/${gid}/users/${editingUser.id}`);
          }
        }
      } else {
        await api.post('/admin/users', {
          email: data.email,
          password: data.password,
          name: data.name,
          role: data.role,
          groupIds: data.group_ids,
          phone: data.phone || null,
          company: data.company || null,
          department: data.department || null,
          job_title: data.job_title || null,
          notes: data.notes || null,
        });
      }
      setShowUserModal(false);
      setEditingUser(undefined);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Errore nel salvataggio');
    }
  };

  const handleDeleteUser = async (id: number) => {
    try {
      await api.delete(`/admin/users/${id}`);
      setShowDeleteConfirm(null);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Errore nella cancellazione');
    }
  };

  // Group CRUD
  const handleSaveGroup = async (data: any) => {
    try {
      if (editingGroup) {
        await api.patch(`/admin/groups/${editingGroup.id}`, data);
      } else {
        await api.post('/admin/groups', data);
      }
      setShowGroupModal(false);
      setEditingGroup(undefined);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Errore nel salvataggio');
    }
  };

  const handleDeleteGroup = async (id: number) => {
    try {
      await api.delete(`/admin/groups/${id}`);
      setShowDeleteConfirm(null);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Errore nella cancellazione');
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.name.toLowerCase().includes(search.toLowerCase())
  );

  const filteredGroups = groups.filter(
    (g) =>
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      (g.description?.toLowerCase().includes(search.toLowerCase()) ?? false)
  );

  return (
    <div className="p-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <h1 className="text-2xl font-bold flex-shrink-0">Gestione Utenti e Gruppi</h1>
        <button
          onClick={() => {
            if (activeTab === 'users') {
              setEditingUser(undefined);
              setShowUserModal(true);
            } else {
              setEditingGroup(undefined);
              setShowGroupModal(true);
            }
          }}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {activeTab === 'users' ? 'Nuovo Utente' : 'Nuovo Gruppo'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-shrink-0">
        <button
          onClick={() => setActiveTab('users')}
          className={clsx(
            'px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors',
            activeTab === 'users'
              ? 'bg-primary-500 text-white'
              : 'bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700'
          )}
        >
          <Users className="w-4 h-4" />
          Utenti ({users.length})
        </button>
        <button
          onClick={() => setActiveTab('groups')}
          className={clsx(
            'px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors',
            activeTab === 'groups'
              ? 'bg-primary-500 text-white'
              : 'bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700'
          )}
        >
          <Shield className="w-4 h-4" />
          Gruppi ({groups.length})
        </button>
      </div>

      {/* Search + MFA Toggle */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={activeTab === 'users' ? 'Cerca utenti...' : 'Cerca gruppi...'}
            className="input pl-11 w-full"
          />
        </div>
        {activeTab === 'users' && (
          <div className="flex items-center gap-3 bg-surface-50 dark:bg-surface-800 rounded-lg px-4 py-2.5">
            <Shield className="w-4 h-4 text-surface-500" />
            <span className="text-sm font-medium whitespace-nowrap">MFA Obbligatorio</span>
            <button
              onClick={toggleMfaEnforced}
              disabled={mfaLoading}
              className={clsx(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
                mfaEnforced ? 'bg-green-500' : 'bg-surface-300 dark:bg-surface-600'
              )}
            >
              <span
                className={clsx(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  mfaEnforced ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
            <span className={clsx(
              'text-xs font-medium',
              mfaEnforced ? 'text-green-600 dark:text-green-400' : 'text-surface-400'
            )}>
              {mfaEnforced ? 'Attivo' : 'Disattivo'}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full"></div>
        </div>
      ) : activeTab === 'users' ? (
        /* Users Table */
        <div className="card overflow-auto flex-1 min-h-0">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-sm text-surface-500 bg-surface-50 dark:bg-surface-900">
                <th className="px-6 py-3 font-medium">Utente</th>
                <th className="px-6 py-3 font-medium">Ruolo</th>
                <th className="px-6 py-3 font-medium">Gruppi</th>
                <th className="px-6 py-3 font-medium">Stato</th>
                <th className="px-6 py-3 font-medium text-center">MFA</th>
                <th className="px-6 py-3 font-medium">Token</th>
                <th className="px-6 py-3 font-medium">Creato</th>
                <th className="px-6 py-3 font-medium text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-surface-500">
                    Nessun utente trovato
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="border-t border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50">
                    <td className="px-6 py-4">
                      <p className="font-medium">{user.name}</p>
                      <p className="text-sm text-surface-500">{user.email}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          user.role === 'admin'
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                            : 'bg-surface-100 text-surface-800 dark:bg-surface-800 dark:text-surface-300'
                        )}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {user.groups ? (
                          user.groups.split(',').map((groupName, idx) => (
                            <span key={idx} className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded">
                              {groupName.trim()}
                            </span>
                          ))
                        ) : (
                          <span className="text-surface-400 text-sm">-</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          user.is_active
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                        )}
                      >
                        {user.is_active ? 'Attivo' : 'Disattivo'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {user.mfa_enabled ? (
                        <span className="inline-flex items-center text-green-600 dark:text-green-400" title="Protetto">
                          <Lock className="w-4 h-4" />
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-surface-300 dark:text-surface-700" title="Non protetto">
                          <Unlock className="w-4 h-4" />
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-surface-500">
                      {user.total_tokens?.toLocaleString() || 0}
                    </td>
                    <td className="px-6 py-4 text-surface-500 text-sm">
                      {format(new Date(user.created_at), 'dd/MM/yyyy')}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setEditingUser(user);
                            setShowUserModal(true);
                          }}
                          className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg"
                          title="Modifica"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm({ type: 'user', id: user.id, name: user.name })}
                          className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 rounded-lg"
                          title="Elimina"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        {user.mfa_enabled && (
                          <button
                            onClick={async () => {
                              if (confirm(`Sei sicuro di voler resettare l'MFA per ${user.name}?`)) {
                                try {
                                  await api.post(`/admin/users/${user.id}/mfa-reset`);
                                  alert('MFA resettato con successo');
                                  loadData();
                                } catch (err: any) {
                                  alert(err.response?.data?.error || 'Errore durante il reset');
                                }
                              }
                            }}
                            className="p-2 hover:bg-orange-100 dark:hover:bg-orange-900/30 text-orange-600 rounded-lg"
                            title="Reset MFA"
                          >
                            <Shield className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Groups Table */
        <div className="card overflow-auto flex-1 min-h-0">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-sm text-surface-500 bg-surface-50 dark:bg-surface-900">
                <th className="px-6 py-3 font-medium">Gruppo</th>
                <th className="px-6 py-3 font-medium">Descrizione</th>
                <th className="px-6 py-3 font-medium">Token/Mese</th>
                <th className="px-6 py-3 font-medium">Kanban</th>
                <th className="px-6 py-3 font-medium">Stato</th>
                <th className="px-6 py-3 font-medium">Utenti</th>
                <th className="px-6 py-3 font-medium text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-surface-500">
                    Nessun gruppo trovato
                  </td>
                </tr>
              ) : (
                filteredGroups.map((group) => (
                  <tr key={group.id} className="border-t border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Shield className="w-5 h-5 text-primary-500" />
                        <span className="font-medium">{group.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-surface-500 text-sm max-w-xs truncate">
                      {group.description || '-'}
                    </td>
                    <td className="px-6 py-4 text-surface-500">
                      {group.max_tokens_per_month?.toLocaleString() || '\u221E'}
                    </td>
                    <td className="px-6 py-4">
                      {group.kanban_enabled ? (
                        <span className="flex items-center gap-1 text-green-600">
                          <FolderKanban className="w-4 h-4" />
                          <Check className="w-4 h-4" />
                        </span>
                      ) : (
                        <span className="text-surface-400">
                          <X className="w-4 h-4" />
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          group.is_active
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                        )}
                      >
                        {group.is_active ? 'Attivo' : 'Disattivo'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-surface-500">
                      {group.user_count || 0}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setEditingGroup(group);
                            setShowGroupModal(true);
                          }}
                          className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg"
                          title="Modifica"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm({ type: 'group', id: group.id, name: group.name })}
                          className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 rounded-lg"
                          title="Elimina"
                        >
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
      )}

      {/* User Modal */}
      <Modal
        isOpen={showUserModal}
        onClose={() => {
          setShowUserModal(false);
          setEditingUser(undefined);
        }}
        title={editingUser ? 'Modifica Utente' : 'Nuovo Utente'}
        size="lg"
      >
        <UserForm
          user={editingUser}
          groups={groups}
          onSave={handleSaveUser}
          onCancel={() => {
            setShowUserModal(false);
            setEditingUser(undefined);
          }}
        />
      </Modal>

      {/* Group Modal */}
      <Modal
        isOpen={showGroupModal}
        onClose={() => {
          setShowGroupModal(false);
          setEditingGroup(undefined);
        }}
        title={editingGroup ? 'Modifica Gruppo' : 'Nuovo Gruppo'}
      >
        <GroupForm
          group={editingGroup}
          onSave={handleSaveGroup}
          onCancel={() => {
            setShowGroupModal(false);
            setEditingGroup(undefined);
          }}
        />
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        title="Conferma Eliminazione"
      >
        <div className="text-center">
          <Trash2 className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="mb-4">
            Sei sicuro di voler eliminare {showDeleteConfirm?.type === 'user' ? "l'utente" : 'il gruppo'}{' '}
            <strong>{showDeleteConfirm?.name}</strong>?
          </p>
          <p className="text-sm text-surface-500 mb-6">
            Questa azione non pu\u00F2 essere annullata.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowDeleteConfirm(null)}
              className="btn btn-secondary flex-1"
            >
              Annulla
            </button>
            <button
              onClick={() => {
                if (showDeleteConfirm?.type === 'user') {
                  handleDeleteUser(showDeleteConfirm.id);
                } else if (showDeleteConfirm?.type === 'group') {
                  handleDeleteGroup(showDeleteConfirm.id);
                }
              }}
              className="btn bg-red-500 hover:bg-red-600 text-white flex-1"
            >
              Elimina
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
