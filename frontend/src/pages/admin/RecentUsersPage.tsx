import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { Users, RefreshCw, Globe, Monitor, MapPin, Clock, Calendar, ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

interface RecentUser {
  user_id: number;
  email: string;
  name: string;
  role: string;
  last_login_at: string | null;
  session_count: number;
  last_ip: string | null;
  last_country: string | null;
  last_user_agent: string | null;
  last_activity_at: string | null;
  first_access_in_period: string | null;
}

interface LoginEvent {
  user_id: number;
  email: string;
  name: string;
  ip_address: string;
  country: string | null;
  user_agent: string;
  created_at: string;
  last_activity_at: string | null;
}

const COUNTRY_NAMES: Record<string, string> = {
  IT: 'Italia',
  US: 'USA',
  GB: 'UK',
  DE: 'Germania',
  FR: 'Francia',
  ES: 'Spagna',
  XX: 'Sconosciuto'
};

const COUNTRY_FLAGS: Record<string, string> = {
  IT: '\u{1F1EE}\u{1F1F9}',
  US: '\u{1F1FA}\u{1F1F8}',
  GB: '\u{1F1EC}\u{1F1E7}',
  DE: '\u{1F1E9}\u{1F1EA}',
  FR: '\u{1F1EB}\u{1F1F7}',
  ES: '\u{1F1EA}\u{1F1F8}',
};

function parseUserAgent(ua: string): string {
  if (!ua) return 'N/D';
  if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
  if (ua.includes('Edg')) return 'Edge';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('curl')) return 'curl';
  if (ua.includes('VSCode') || ua.includes('vscode')) return 'VS Code';
  return 'Altro';
}

function formatCountry(code: string | null): string {
  if (!code) return 'N/D';
  const flag = COUNTRY_FLAGS[code] || '\u{1F310}';
  const name = COUNTRY_NAMES[code] || code;
  return `${flag} ${name}`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'N/D';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'adesso';
  if (diffMin < 60) return `${diffMin} min fa`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h fa`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}g fa`;
}

export default function RecentUsersPage() {
  const [users, setUsers] = useState<RecentUser[]>([]);
  const [loginEvents, setLoginEvents] = useState<LoginEvent[]>([]);
  const [days, setDays] = useState(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const response = await api.get(`/admin/recent-users?days=${days}`);
      setUsers(response.data.users || []);
      setLoginEvents(response.data.loginEvents || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Errore caricamento dati');
      console.error('Failed to load recent users:', err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  const getUserEvents = (userId: number): LoginEvent[] =>
    loginEvents.filter(e => e.user_id === userId);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-500" />
            Report Accessi Recenti
          </h1>
          <p className="text-sm text-surface-500 mt-1">
            {users.length} {users.length === 1 ? 'utente' : 'utenti'} {users.length === 1 ? 'connesso' : 'connessi'} negli ultimi {days} giorni
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="input px-3 py-2 text-sm"
          >
            <option value={1}>Ultimo giorno</option>
            <option value={2}>Ultimi 2 giorni</option>
            <option value={3}>Ultimi 3 giorni</option>
            <option value={7}>Ultima settimana</option>
            <option value={14}>Ultime 2 settimane</option>
            <option value={30}>Ultimo mese</option>
          </select>
          <button
            onClick={() => { setLoading(true); loadData(); }}
            className="flex items-center gap-2 px-4 py-2 bg-surface-100 dark:bg-surface-800 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Aggiorna
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
              <Users className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs text-surface-500">Utenti Unici</p>
              <p className="text-2xl font-bold">{users.length}</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
              <Clock className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-surface-500">Sessioni Totali</p>
              <p className="text-2xl font-bold">{loginEvents.length}</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Calendar className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-surface-500">Periodo</p>
              <p className="text-2xl font-bold">{days}g</p>
            </div>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-surface-500 bg-surface-50 dark:bg-surface-900">
              <th className="px-6 py-3 font-medium w-8"></th>
              <th className="px-6 py-3 font-medium">Utente</th>
              <th className="px-6 py-3 font-medium">Ruolo</th>
              <th className="px-6 py-3 font-medium">
                <div className="flex items-center gap-1"><MapPin className="w-4 h-4" /> Posizione</div>
              </th>
              <th className="px-6 py-3 font-medium">
                <div className="flex items-center gap-1"><Globe className="w-4 h-4" /> Ultimo IP</div>
              </th>
              <th className="px-6 py-3 font-medium">
                <div className="flex items-center gap-1"><Monitor className="w-4 h-4" /> Browser</div>
              </th>
              <th className="px-6 py-3 font-medium">Sessioni</th>
              <th className="px-6 py-3 font-medium">Ultima Attività</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center">
                  <div className="flex items-center justify-center gap-3 text-surface-500">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Caricamento...
                  </div>
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center">
                  <Users className="w-10 h-10 text-surface-300 mx-auto mb-3" />
                  <p className="text-surface-500">Nessun accesso nel periodo selezionato</p>
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isExpanded = expandedUser === user.user_id;
                const events = getUserEvents(user.user_id);
                return (
                  <>
                    <tr
                      key={user.user_id}
                      className={clsx(
                        'border-t border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-900/50 cursor-pointer',
                        isExpanded && 'bg-surface-50 dark:bg-surface-900/50'
                      )}
                      onClick={() => setExpandedUser(isExpanded ? null : user.user_id)}
                    >
                      <td className="px-6 py-4">
                        {events.length > 0 && (
                          isExpanded
                            ? <ChevronDown className="w-4 h-4 text-surface-400" />
                            : <ChevronRight className="w-4 h-4 text-surface-400" />
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-medium">{user.name}</p>
                        <p className="text-sm text-surface-500">{user.email}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          user.role === 'admin'
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                            : 'bg-surface-100 text-surface-800 dark:bg-surface-800 dark:text-surface-300'
                        )}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                          {formatCountry(user.last_country)}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm text-surface-500">
                        {user.last_ip || 'N/D'}
                      </td>
                      <td className="px-6 py-4 text-sm text-surface-500">
                        {parseUserAgent(user.last_user_agent || '')}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                          {user.session_count}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-surface-500">
                        <span title={user.last_activity_at ? format(new Date(user.last_activity_at), 'dd/MM/yyyy HH:mm:ss', { locale: it }) : ''}>
                          {timeAgo(user.last_activity_at)}
                        </span>
                      </td>
                    </tr>
                    {/* Expanded: login events detail */}
                    {isExpanded && events.length > 0 && (
                      <tr key={`${user.user_id}-detail`}>
                        <td colSpan={8} className="px-0 py-0">
                          <div className="bg-surface-50 dark:bg-surface-900/30 border-y border-surface-200 dark:border-surface-700">
                            <table className="w-full">
                              <thead>
                                <tr className="text-left text-xs text-surface-400">
                                  <th className="px-12 py-2 font-medium">Data Accesso</th>
                                  <th className="px-4 py-2 font-medium">IP</th>
                                  <th className="px-4 py-2 font-medium">Paese</th>
                                  <th className="px-4 py-2 font-medium">Browser</th>
                                  <th className="px-4 py-2 font-medium">Ultima Attività</th>
                                </tr>
                              </thead>
                              <tbody>
                                {events.map((event, idx) => (
                                  <tr key={idx} className="border-t border-surface-100 dark:border-surface-800">
                                    <td className="px-12 py-2 text-sm">
                                      {format(new Date(event.created_at), 'dd/MM/yyyy HH:mm', { locale: it })}
                                    </td>
                                    <td className="px-4 py-2 text-sm font-mono text-surface-500">
                                      {event.ip_address}
                                    </td>
                                    <td className="px-4 py-2 text-sm">
                                      {formatCountry(event.country)}
                                    </td>
                                    <td className="px-4 py-2 text-sm text-surface-500">
                                      {parseUserAgent(event.user_agent)}
                                    </td>
                                    <td className="px-4 py-2 text-sm text-surface-500">
                                      {event.last_activity_at
                                        ? format(new Date(event.last_activity_at), 'dd/MM/yyyy HH:mm', { locale: it })
                                        : 'N/D'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
