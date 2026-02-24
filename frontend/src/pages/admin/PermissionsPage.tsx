import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { Shield, RefreshCw, RotateCcw, Save, ChevronDown, ChevronRight } from 'lucide-react';

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
}

interface ResourcePermission {
  resource: string;
  can_read: boolean;
  can_write: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_list: boolean;
}

const RESOURCE_LABELS: Record<string, string> = {
  memory: 'Memoria',
  conversation: 'Conversazioni',
  settings: 'Impostazioni',
  plugins: 'Plugin & MCP',
  hooks: 'Hooks',
  tools: 'Strumenti',
  forms: 'Form',
  models: 'Modelli',
  providers: 'Provider AI',
  users: 'Utenti',
  scheduler: 'Scheduler',
};

const PERMISSION_LABELS: Record<string, string> = {
  read: 'Lettura',
  write: 'Scrittura',
  edit: 'Modifica',
  delete: 'Cancellazione',
  list: 'Lista',
};

export default function PermissionsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<ResourcePermission[]>([]);
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/users');
      const nonAdmins = (res.data || []).filter((u: User) => u.role !== 'admin');
      setUsers(nonAdmins);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadUserPermissions = async (user: User) => {
    try {
      const res = await api.get(`/permissions/users/${user.id}`);
      setPermissions(res.data.permissions || []);
      setSelectedUser(user);
      setExpandedUser(user.id);
    } catch (err) {
      console.error('Failed to load permissions:', err);
    }
  };

  const togglePermission = (resource: string, perm: string) => {
    setPermissions(prev =>
      prev.map(p => {
        if (p.resource !== resource) return p;
        return { ...p, [`can_${perm}`]: !(p as any)[`can_${perm}`] };
      })
    );
  };

  const savePermissions = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      for (const perm of permissions) {
        await api.put(`/permissions/users/${selectedUser.id}/${perm.resource}`, {
          read: perm.can_read,
          write: perm.can_write,
          edit: perm.can_edit,
          delete: perm.can_delete,
          list: perm.can_list,
        });
      }
      // Reload to confirm
      await loadUserPermissions(selectedUser);
    } catch (err) {
      console.error('Failed to save permissions:', err);
    } finally {
      setSaving(false);
    }
  };

  const resetPermissions = async () => {
    if (!selectedUser) return;
    if (!confirm(`Resettare tutti i permessi di ${selectedUser.name} ai valori predefiniti?`)) return;
    try {
      await api.delete(`/permissions/users/${selectedUser.id}`);
      await loadUserPermissions(selectedUser);
    } catch (err) {
      console.error('Failed to reset permissions:', err);
    }
  };

  if (loading) {
    return <div className="p-6 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full"></div></div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-primary-500" />
          <h1 className="text-2xl font-bold">Permessi Risorse</h1>
        </div>
        <button onClick={loadUsers} className="btn btn-secondary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> Aggiorna
        </button>
      </div>

      <p className="text-sm text-surface-500 mb-6">
        Configura i permessi per risorsa per ogni utente. Gli amministratori hanno automaticamente accesso completo a tutte le risorse.
        I permessi mostrati qui si applicano solo agli utenti con ruolo "user".
      </p>

      <div className="space-y-2">
        {users.map(user => (
          <div key={user.id} className="card overflow-hidden">
            <button
              onClick={() => {
                if (expandedUser === user.id) {
                  setExpandedUser(null);
                  setSelectedUser(null);
                } else {
                  loadUserPermissions(user);
                }
              }}
              className="w-full p-4 flex items-center justify-between hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                {expandedUser === user.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <div className="text-left">
                  <p className="font-medium">{user.name}</p>
                  <p className="text-sm text-surface-500">{user.email}</p>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400">
                {user.role}
              </span>
            </button>

            {expandedUser === user.id && selectedUser?.id === user.id && (
              <div className="border-t border-surface-200 dark:border-surface-700 p-4">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-sm text-surface-500 border-b border-surface-200 dark:border-surface-700">
                        <th className="pb-2 font-medium">Risorsa</th>
                        {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                          <th key={key} className="pb-2 font-medium text-center">{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {permissions.map(perm => (
                        <tr key={perm.resource} className="border-b border-surface-100 dark:border-surface-800">
                          <td className="py-2.5 font-medium text-sm">
                            {RESOURCE_LABELS[perm.resource] || perm.resource}
                          </td>
                          {['read', 'write', 'edit', 'delete', 'list'].map(p => (
                            <td key={p} className="py-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={(perm as any)[`can_${p}`]}
                                onChange={() => togglePermission(perm.resource, p)}
                                className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-surface-200 dark:border-surface-700">
                  <button
                    onClick={savePermissions}
                    disabled={saving}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? 'Salvataggio...' : 'Salva Permessi'}
                  </button>
                  <button
                    onClick={resetPermissions}
                    className="btn btn-secondary flex items-center gap-2"
                  >
                    <RotateCcw className="w-4 h-4" /> Reset ai Default
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {users.length === 0 && (
          <div className="card p-8 text-center text-surface-500">
            Nessun utente non-admin trovato.
          </div>
        )}
      </div>
    </div>
  );
}
