import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { Wifi, WifiOff, MapPin, Globe, RefreshCw, Monitor } from 'lucide-react';

interface ActiveSession {
  userId: number;
  email: string;
  name: string;
  role: string;
  ip: string;
  country: string;
  countryCode: string;
  city: string;
  region: string;
  isp: string;
  userAgent: string;
  loginAt: string;
}

export default function ActiveSessionsPage() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<number | null>(null);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/active-sessions');
      setSessions(res.data.sessions);
    } catch (err) {
      console.error('Failed to load active sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSessions(); }, []);

  const disconnectUser = async (userId: number) => {
    if (!confirm('Disconnettere forzatamente questo utente?')) return;
    setDisconnecting(userId);
    try {
      await api.delete(`/admin/active-sessions/${userId}`);
      setSessions(sessions.filter(s => s.userId !== userId));
    } catch (err) {
      console.error('Failed to disconnect user:', err);
    } finally {
      setDisconnecting(null);
    }
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const parseUserAgent = (ua: string) => {
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Edg/')) return 'Edge';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Safari')) return 'Safari';
    return 'Browser';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Sessioni Attive</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {sessions.length} utenti connessi
          </p>
        </div>
        <button
          onClick={loadSessions}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Aggiorna
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Caricamento...</div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12">
          <WifiOff className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">Nessuna sessione attiva</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => (
            <div key={session.userId} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border border-gray-200 dark:border-gray-700">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <Wifi className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">{session.name}</p>
                    <p className="text-xs text-gray-500">{session.email}</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs ${
                  session.role === 'admin'
                    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                }`}>
                  {session.role}
                </span>
              </div>

              {/* Geo info */}
              <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400 mb-4">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-red-500" />
                  <span>{session.city}, {session.region} - {session.country}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-500" />
                  <span>{session.ip} ({session.isp})</span>
                </div>
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-gray-400" />
                  <span>{parseUserAgent(session.userAgent)}</span>
                </div>
              </div>

              {/* Login time */}
              <p className="text-xs text-gray-400 mb-4">
                Connesso dal: {formatDate(session.loginAt)}
              </p>

              {/* Disconnect button */}
              <button
                onClick={() => disconnectUser(session.userId)}
                disabled={disconnecting === session.userId}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm disabled:opacity-50"
              >
                <WifiOff className="w-4 h-4" />
                {disconnecting === session.userId ? 'Disconnessione...' : 'Disconnetti'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
