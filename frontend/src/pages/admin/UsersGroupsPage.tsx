import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import {
  Users,
  UserPlus,
  Search,
  MoreVertical,
  Edit2,
  Trash2,
  Shield,
  X,
  Check,
  UserCog,
  Plus,
  FolderKanban
} from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';

interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: string;
  total_tokens: number;
  groups?: string; // Comma-separated group names from backend
  groupsList?: { id: number; name: string }[]; // Parsed array for UI
  // Profile fields
  phone?: string;
  company?: string;
  department?: string;
  job_title?: string;
  notes?: string;
}

interface Group {
  id: number;
  name: string;
  description?: string;
  max_tokens_per_month: number;
  kanban_enabled: boolean;
  is_active: boolean;
  created_at: string;
  user_count?: number;
}

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
    xl: 'max-w-4xl'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={clsx(
        "relative bg-white dark:bg-surface-900 rounded-xl shadow-xl w-full mx-4 max-h-[90vh] overflow-auto",
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

// User Form - Complete with profile fields
function UserForm({ user, groups, onSave, onCancel }: {
  user?: User;
  groups: Group[];
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  // Parse comma-separated group names string to get group IDs
  const getInitialGroupIds = (): number[] => {
    if (!user?.groups) return [];
    const groupNames = user.groups.split(',').map(n => n.trim()).filter(Boolean);
    return groups
      .filter(g => groupNames.includes(g.name))
      .map(g => g.id);
  };

  const [formData, setFormData] = useState({
    // Account
    name: user?.name || '',
    email: user?.email || '',
    password: '',
    role: user?.role || 'user',
    is_active: user?.is_active ?? true,
    group_ids: getInitialGroupIds(),
    // Profile
    phone: user?.phone || '',
    company: user?.company || '',
    department: user?.department || '',
    job_title: user?.job_title || '',
    notes: user?.notes || ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Account Section */}
      <div>
        <h3 className="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <UserCog className="w-4 h-4" />
          Dati Account
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nome Completo *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="input w-full"
              placeholder="Mario Rossi"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email *</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="input w-full"
              placeholder="mario.rossi@azienda.it"
              required
              disabled={!!user}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Password {user ? '(lascia vuoto per non modificare)' : '*'}
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="input w-full"
              placeholder={user ? '••••••••' : 'Minimo 8 caratteri'}
              required={!user}
              minLength={8}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Ruolo *</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'user' })}
              className="input w-full"
            >
              <option value="user">Utente Standard</option>
              <option value="admin">Amministratore</option>
            </select>
          </div>
        </div>
      </div>

      {/* Profile Section */}
      <div>
        <h3 className="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Users className="w-4 h-4" />
          Anagrafica
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Telefono</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="input w-full"
              placeholder="+39 123 456 7890"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Azienda</label>
            <input
              type="text"
              value={formData.company}
              onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              className="input w-full"
              placeholder="Nome Azienda S.r.l."
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reparto/Ufficio</label>
            <input
              type="text"
              value={formData.department}
              onChange={(e) => setFormData({ ...formData, department: e.target.value })}
              className="input w-full"
              placeholder="IT, Marketing, HR..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Mansione</label>
            <input
              type="text"
              value={formData.job_title}
              onChange={(e) => setFormData({ ...formData, job_title: e.target.value })}
              className="input w-full"
              placeholder="Developer, Manager..."
            />
          </div>
        </div>
      </div>

      {/* Groups Section */}
      <div>
        <h3 className="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4" />
          Gruppi e Permessi
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-50 dark:bg-surface-800/50">
          {groups.length === 0 ? (
            <p className="text-sm text-surface-500 col-span-full">Nessun gruppo disponibile</p>
          ) : (
            groups.map((group) => (
              <label key={group.id} className="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-surface-100 dark:hover:bg-surface-700">
                <input
                  type="checkbox"
                  checked={formData.group_ids.includes(group.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setFormData({ ...formData, group_ids: [...formData.group_ids, group.id] });
                    } else {
                      setFormData({ ...formData, group_ids: formData.group_ids.filter(id => id !== group.id) });
                    }
                  }}
                  className="rounded text-primary-500"
                />
                <span className="text-sm">{group.name}</span>
              </label>
            ))
          )}
        </div>
      </div>

      {/* Notes Section */}
      <div>
        <label className="block text-sm font-medium mb-1">Note Interne</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="input w-full"
          rows={3}
          placeholder="Note visibili solo agli amministratori..."
        />
      </div>

      {/* Status */}
      <div className="flex items-center gap-4 p-3 bg-surface-50 dark:bg-surface-800 rounded-lg">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.is_active}
            onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
            className="rounded text-green-500"
          />
          <span className="text-sm font-medium">Utente Attivo</span>
        </label>
        <span className="text-xs text-surface-500">
          {formData.is_active ? 'L\'utente può accedere al sistema' : 'L\'utente non può effettuare il login'}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4 border-t border-surface-200 dark:border-surface-700">
        <button type="button" onClick={onCancel} className="btn btn-secondary flex-1">
          Annulla
        </button>
        <button type="submit" className="btn btn-primary flex-1">
          {user ? 'Salva Modifiche' : 'Crea Utente'}
        </button>
      </div>
    </form>
  );
}

// Group Form
function GroupForm({ group, onSave, onCancel }: {
  group?: Group;
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    name: group?.name || '',
    description: group?.description || '',
    max_tokens_per_month: group?.max_tokens_per_month || 1000000,
    kanban_enabled: group?.kanban_enabled ?? true,
    is_active: group?.is_active ?? true
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Nome Gruppo</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="input w-full"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Descrizione</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="input w-full"
          rows={3}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Token Mensili Max</label>
        <input
          type="number"
          value={formData.max_tokens_per_month}
          onChange={(e) => setFormData({ ...formData, max_tokens_per_month: parseInt(e.target.value) })}
          className="input w-full"
        />
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.kanban_enabled}
            onChange={(e) => setFormData({ ...formData, kanban_enabled: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm">Accesso Kanban</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.is_active}
            onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm">Gruppo attivo</span>
        </label>
      </div>
      <div className="flex gap-2 pt-4">
        <button type="button" onClick={onCancel} className="btn btn-secondary flex-1">
          Annulla
        </button>
        <button type="submit" className="btn btn-primary flex-1">
          {group ? 'Aggiorna' : 'Crea'}
        </button>
      </div>
    </form>
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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersRes, groupsRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/groups')
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
        // Update user with profile fields
        await api.patch(`/admin/users/${editingUser.id}`, {
          name: data.name,
          role: data.role,
          is_active: data.is_active,
          password: data.password || undefined,
          phone: data.phone || null,
          company: data.company || null,
          department: data.department || null,
          job_title: data.job_title || null,
          notes: data.notes || null
        });

        // Update group assignments
        // First get current groups
        const userDetails = await api.get(`/admin/users/${editingUser.id}`);
        // Backend returns groups as JSON string from JSON_ARRAYAGG, parse it
        let groupsArray: { id: number; name: string }[] = [];
        if (userDetails.data.groups) {
          if (typeof userDetails.data.groups === 'string') {
            try {
              groupsArray = JSON.parse(userDetails.data.groups);
              // Filter out null entries (from LEFT JOIN when no groups)
              groupsArray = groupsArray.filter((g: any) => g && g.id != null);
            } catch { groupsArray = []; }
          } else if (Array.isArray(userDetails.data.groups)) {
            groupsArray = userDetails.data.groups.filter((g: any) => g && g.id != null);
          }
        }
        const currentGroups = groupsArray.map((g) => g.id);

        // Remove from groups no longer selected
        for (const gid of currentGroups) {
          if (!data.group_ids.includes(gid)) {
            await api.delete(`/admin/groups/${gid}/users/${editingUser.id}`);
          }
        }
        // Add to new groups
        for (const gid of data.group_ids) {
          if (!currentGroups.includes(gid)) {
            await api.post(`/admin/groups/${gid}/users/${editingUser.id}`);
          }
        }
      } else {
        // Create new user with profile fields
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
          notes: data.notes || null
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
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Gestione Utenti e Gruppi</h1>
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
      <div className="flex gap-2 mb-6">
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

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={activeTab === 'users' ? 'Cerca utenti...' : 'Cerca gruppi...'}
          className="input pl-11 w-full max-w-md"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full"></div>
        </div>
      ) : activeTab === 'users' ? (
        /* Users Table */
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-surface-500 bg-surface-50 dark:bg-surface-900">
                <th className="px-6 py-3 font-medium">Utente</th>
                <th className="px-6 py-3 font-medium">Ruolo</th>
                <th className="px-6 py-3 font-medium">Gruppi</th>
                <th className="px-6 py-3 font-medium">Stato</th>
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
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
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
                      {group.max_tokens_per_month?.toLocaleString() || '∞'}
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
            Questa azione non può essere annullata.
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
