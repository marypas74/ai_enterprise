import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { format } from 'date-fns';
import { Wifi, WifiOff, Trash2, RefreshCw, Globe, Monitor, MapPin } from 'lucide-react';

interface Session {
    id: number;
    user_id: number;
    email: string;
    name: string;
    ip_address: string;
    country: string;
    user_agent: string;
    created_at: string;
    last_activity_at: string;
    expires_at: string;
}

const COUNTRY_NAMES: Record<string, string> = {
    IT: '🇮🇹 Italia',
    US: '🇺🇸 USA',
    GB: '🇬🇧 UK',
    DE: '🇩🇪 Germania',
    FR: '🇫🇷 Francia',
    ES: '🇪🇸 Spagna',
    XX: '🏳️ Sconosciuto'
};

function parseUserAgent(ua: string): string {
    if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
    if (ua.includes('Edg')) return 'Edge';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
    if (ua.includes('curl')) return 'curl';
    return 'Altro';
}

export default function SessionsPage() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadSessions = useCallback(async () => {
        try {
            setError(null);
            const response = await api.get('/auth/sessions');
            setSessions(response.data.sessions || []);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Errore caricamento sessioni');
            console.error('Failed to load sessions:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSessions();
        const interval = setInterval(loadSessions, 30000); // Auto-refresh every 30s
        return () => clearInterval(interval);
    }, [loadSessions]);

    const terminateSession = async (sessionId: number) => {
        if (!confirm('Vuoi terminare questa sessione? L\'utente verrà disconnesso.')) return;
        try {
            await api.delete(`/auth/sessions/${sessionId}`);
            setSessions(prev => prev.filter(s => s.id !== sessionId));
        } catch (err: any) {
            alert(err.response?.data?.error || 'Errore terminazione sessione');
        }
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Wifi className="w-6 h-6 text-green-500" />
                        Sessioni Attive
                    </h1>
                    <p className="text-sm text-surface-500 mt-1">
                        {sessions.length} {sessions.length === 1 ? 'utente connesso' : 'utenti connessi'}
                    </p>
                </div>
                <button
                    onClick={() => { setLoading(true); loadSessions(); }}
                    className="flex items-center gap-2 px-4 py-2 bg-surface-100 dark:bg-surface-800 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Aggiorna
                </button>
            </div>

            {error && (
                <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            <div className="card overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="text-left text-sm text-surface-500 bg-surface-50 dark:bg-surface-900">
                            <th className="px-6 py-3 font-medium">Utente</th>
                            <th className="px-6 py-3 font-medium">
                                <div className="flex items-center gap-1"><MapPin className="w-4 h-4" /> Posizione</div>
                            </th>
                            <th className="px-6 py-3 font-medium">
                                <div className="flex items-center gap-1"><Globe className="w-4 h-4" /> IP</div>
                            </th>
                            <th className="px-6 py-3 font-medium">
                                <div className="flex items-center gap-1"><Monitor className="w-4 h-4" /> Browser</div>
                            </th>
                            <th className="px-6 py-3 font-medium">Accesso</th>
                            <th className="px-6 py-3 font-medium">Ultima Attività</th>
                            <th className="px-6 py-3 font-medium"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-12 text-center">
                                    <div className="flex items-center justify-center gap-3 text-surface-500">
                                        <RefreshCw className="w-5 h-5 animate-spin" />
                                        Caricamento sessioni...
                                    </div>
                                </td>
                            </tr>
                        ) : sessions.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-12 text-center">
                                    <WifiOff className="w-10 h-10 text-surface-300 mx-auto mb-3" />
                                    <p className="text-surface-500">Nessuna sessione attiva</p>
                                </td>
                            </tr>
                        ) : (
                            sessions.map((session) => (
                                <tr key={session.id} className="border-t border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-900/50">
                                    <td className="px-6 py-4">
                                        <p className="font-medium">{session.name}</p>
                                        <p className="text-sm text-surface-500">{session.email}</p>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                                            {COUNTRY_NAMES[session.country] || `🌐 ${session.country}`}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 font-mono text-sm text-surface-500">
                                        {session.ip_address}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-surface-500">
                                        {parseUserAgent(session.user_agent)}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-surface-500">
                                        {format(new Date(session.created_at), 'dd/MM/yyyy HH:mm')}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-surface-500">
                                        {format(new Date(session.last_activity_at), 'dd/MM/yyyy HH:mm')}
                                    </td>
                                    <td className="px-6 py-4">
                                        <button
                                            onClick={() => terminateSession(session.id)}
                                            className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                            title="Termina sessione"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Legend */}
            <div className="mt-4 text-xs text-surface-500 flex items-center gap-4">
                <span>⟳ Auto-aggiornamento ogni 30 secondi</span>
                <span>• Single-session: un solo accesso per utente</span>
            </div>
        </div>
    );
}
