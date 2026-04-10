import { useState } from 'react';
import {
  Users,
  UserCog,
  Shield,
  Eye,
  EyeOff,
} from 'lucide-react';

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: string;
  total_tokens: number;
  mfa_enabled?: boolean;
  groups?: string;
  groupsList?: { id: number; name: string }[];
  phone?: string;
  company?: string;
  department?: string;
  job_title?: string;
  notes?: string;
}

export interface Group {
  id: number;
  name: string;
  description?: string;
  max_tokens_per_month: number;
  kanban_enabled: boolean;
  is_active: boolean;
  created_at: string;
  user_count?: number;
}

interface UserFormProps {
  user?: User;
  groups: Group[];
  onSave: (data: any) => void;
  onCancel: () => void;
}

export default function UserForm({ user, groups, onSave, onCancel }: UserFormProps) {
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
    notes: user?.notes || '',
  });

  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password && formData.password !== confirmPassword) {
      setPasswordError('Le password non coincidono');
      return;
    }
    setPasswordError('');
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
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">
              Password {user ? '(lascia vuoto per non modificare)' : '*'}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => {
                    setFormData({ ...formData, password: e.target.value });
                    if (passwordError) setPasswordError('');
                  }}
                  className="input w-full pr-10"
                  placeholder={user ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Minimo 8 caratteri'}
                  required={!user}
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {(formData.password || !user) && (
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (passwordError) setPasswordError('');
                    }}
                    className={`input w-full pr-10 ${passwordError ? 'border-red-500 focus:ring-red-500' : ''}`}
                    placeholder="Conferma password"
                    required={!user || !!formData.password}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              )}
            </div>
            {passwordError && (
              <p className="mt-1 text-sm text-red-500">{passwordError}</p>
            )}
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
          {formData.is_active ? 'L\'utente pu\u00F2 accedere al sistema' : 'L\'utente non pu\u00F2 effettuare il login'}
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
