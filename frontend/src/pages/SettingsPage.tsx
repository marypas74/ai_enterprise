import { useState, useEffect } from 'react';
import { useAuthStore } from '../hooks/useAuthStore';
import { api } from '../services/api';
import {
    Shield,
    Key,
    QrCode,
    User,
    Copy,
    CheckCircle,
    AlertCircle,
    Clock,
    LogOut,
    ChevronLeft,
    X,
    Lock,
    Unlock
} from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

interface MfaSetupResponse {
    secret: string;
    otpauth_url: string;
    qr_code: string;
    message: string;
}

export default function SettingsPage() {
    const { user, logout } = useAuthStore();
    const [loading, setLoading] = useState(false);
    const [mfaSetup, setMfaSetup] = useState<MfaSetupResponse | null>(null);
    const [totpCode, setTotpCode] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [mfaEnabled, setMfaEnabled] = useState(user?.mfa_enabled || false);
    const [copied, setCopied] = useState(false);

    // Load latest user status
    useEffect(() => {
        const checkMfaStatus = async () => {
            try {
                const response = await api.get('/auth/me');
                setMfaEnabled(!!response.data.mfa_enabled);
            } catch (err) {
                console.error('Failed to update user status:', err);
            }
        };
        checkMfaStatus();
    }, []);

    const handleStartMfaSetup = async () => {
        setLoading(true);
        setError('');
        try {
            const response = await api.post('/auth/mfa/setup', {});
            setMfaSetup(response.data);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Errore nella generazione del QR code');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifySetup = async () => {
        if (!totpCode || totpCode.length !== 6) {
            setError('Inserisci un codice di 6 cifre');
            return;
        }
        setLoading(true);
        setError('');
        try {
            await api.post('/auth/mfa/verify-setup', { totp_code: totpCode });
            setMfaEnabled(true);
            setMfaSetup(null);
            setTotpCode('');
            setSuccess('MFA attivata con successo!');
            setTimeout(() => setSuccess(''), 5000);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Codice invalido. Riprova.');
        } finally {
            setLoading(false);
        }
    };

    const handleDisableMfa = async () => {
        const code = prompt('Inserisci il codice TOTP attuale per disabilitare l\'MFA:');
        if (!code) return;

        setLoading(true);
        setError('');
        try {
            await api.post('/auth/mfa/disable', { totp_code: code });
            setMfaEnabled(false);
            setSuccess('MFA disattivata correttamente.');
            setTimeout(() => setSuccess(''), 5000);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Errore nella disattivazione. Verifica il codice.');
        } finally {
            setLoading(false);
        }
    };

    const copySecret = () => {
        if (mfaSetup?.secret) {
            navigator.clipboard.writeText(mfaSetup.secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="min-h-screen bg-surface-50 dark:bg-surface-950 p-6">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <Link
                        to="/"
                        className="p-2 hover:bg-surface-200 dark:hover:bg-surface-800 rounded-full transition-colors"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </Link>
                    <h1 className="text-3xl font-bold">Impostazioni Account</h1>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Navigation/Profile Summary */}
                    <div className="space-y-6">
                        <div className="card p-6 flex flex-col items-center text-center">
                            <div className="w-20 h-20 rounded-full bg-primary-600 flex items-center justify-center text-white text-3xl font-bold mb-4">
                                {user?.name?.charAt(0).toUpperCase()}
                            </div>
                            <h2 className="text-xl font-bold">{user?.name}</h2>
                            <p className="text-surface-500 mb-4">{user?.email}</p>
                            <span className="px-3 py-1 rounded-full bg-surface-100 dark:bg-surface-800 text-xs font-medium uppercase tracking-wider">
                                {user?.role}
                            </span>
                        </div>

                        <div className="card overflow-hidden">
                            <nav className="flex flex-col">
                                <button className="flex items-center gap-3 px-4 py-3 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400 font-medium border-l-4 border-primary-500 text-left">
                                    <Shield className="w-5 h-5" />
                                    Sicurezza & MFA
                                </button>
                                <button onClick={logout} className="flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 text-left transition-colors">
                                    <LogOut className="w-5 h-5" />
                                    Logout
                                </button>
                            </nav>
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="md:col-span-2 space-y-6">
                        {/* Status Messages */}
                        {success && (
                            <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl border border-green-100 dark:border-green-900/30 animate-in fade-in slide-in-from-top-4">
                                <CheckCircle className="w-5 h-5 flex-shrink-0" />
                                <p className="text-sm font-medium">{success}</p>
                            </div>
                        )}

                        {error && (
                            <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-xl border border-red-100 dark:border-red-900/30 animate-in fade-in slide-in-from-top-4">
                                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                                <p className="text-sm font-medium">{error}</p>
                            </div>
                        )}

                        {/* Security Section */}
                        <div className="card p-6">
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30 text-primary-600">
                                        <Lock className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold">Autenticazione a due fattori</h3>
                                        <p className="text-sm text-surface-500">Aggiungi un livello di sicurezza extra al tuo account</p>
                                    </div>
                                </div>
                                <div className={clsx(
                                    "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                                    mfaEnabled
                                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                        : "bg-surface-100 text-surface-500 dark:bg-surface-800"
                                )}>
                                    {mfaEnabled ? 'Attivata' : 'Disattivata'}
                                </div>
                            </div>

                            {!mfaEnabled ? (
                                <div className="space-y-6">
                                    {!mfaSetup ? (
                                        <div className="bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-xl p-6 text-center">
                                            <QrCode className="w-16 h-16 text-surface-300 mx-auto mb-4" />
                                            <h4 className="font-bold mb-2">Non hai ancora configurato l'MFA</h4>
                                            <p className="text-sm text-surface-500 mb-6 max-w-sm mx-auto">
                                                Usa un'app come Microsoft Authenticator o Google Authenticator per proteggere il tuo account.
                                            </p>
                                            <button
                                                onClick={handleStartMfaSetup}
                                                disabled={loading}
                                                className="btn btn-primary w-full sm:w-auto px-8"
                                            >
                                                {loading ? 'Generazione...' : 'Inizia Configurazione'}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
                                            <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
                                                {/* QR Code */}
                                                <div className="bg-white p-4 rounded-2xl border-4 border-primary-500/20 shadow-xl overflow-hidden flex-shrink-0">
                                                    <img
                                                        src={mfaSetup.qr_code}
                                                        alt="MFA QR Code"
                                                        className="w-48 h-48 block"
                                                    />
                                                </div>

                                                {/* Instructions */}
                                                <div className="flex-1 space-y-4">
                                                    <div className="flex items-start gap-3">
                                                        <div className="w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">1</div>
                                                        <p className="text-sm">Scansiona il QR Code con la tua app di autenticazione preferita (Microsoft Authenticator raccomandato).</p>
                                                    </div>

                                                    <div className="flex items-start gap-3">
                                                        <div className="w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">2</div>
                                                        <div className="space-y-2">
                                                            <p className="text-sm">Se non riesci a scansionare, inserisci manualmente questo segreto:</p>
                                                            <div className="flex items-center gap-2 p-2 bg-surface-100 dark:bg-surface-800 rounded-lg font-mono text-sm break-all">
                                                                <span>{mfaSetup.secret}</span>
                                                                <button
                                                                    onClick={copySecret}
                                                                    className="p-1 hover:bg-surface-200 dark:hover:bg-surface-700 rounded transition-colors ml-auto"
                                                                >
                                                                    {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-start gap-3 pt-4">
                                                        <div className="w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">3</div>
                                                        <div className="flex-1 space-y-3">
                                                            <p className="text-sm font-bold">Inserisci il codice di 6 cifre per confermare:</p>
                                                            <div className="flex gap-2">
                                                                <input
                                                                    type="text"
                                                                    value={totpCode}
                                                                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').substring(0, 6))}
                                                                    placeholder="000000"
                                                                    className="input text-center text-xl font-bold tracking-[0.5em] w-full"
                                                                    disabled={loading}
                                                                />
                                                                <button
                                                                    onClick={handleVerifySetup}
                                                                    disabled={loading || totpCode.length !== 6}
                                                                    className="btn btn-primary"
                                                                >
                                                                    Verifica
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex justify-end">
                                                <button
                                                    onClick={() => setMfaSetup(null)}
                                                    className="text-sm text-surface-500 hover:text-surface-700 underline"
                                                >
                                                    Annulla e chiudi
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/20 rounded-xl p-6">
                                    <div className="flex items-start gap-4 mb-6">
                                        <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600">
                                            <Unlock className="w-8 h-8" />
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-green-800 dark:text-green-300">Il tuo account è protetto</h4>
                                            <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                                                L'autenticazione a due fattori è attiva. Ogni volta che effettuerai l'accesso da un nuovo dispositivo o browser, ti verrà richiesto un codice di sicurezza.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row gap-4">
                                        <div className="flex-1 p-4 bg-white dark:bg-surface-800 rounded-lg border border-green-100 dark:border-green-900/20">
                                            <div className="flex items-center gap-2 text-sm font-medium text-surface-500 mb-2">
                                                <Clock className="w-4 h-4" />
                                                Ultima attività sessione
                                            </div>
                                            <p className="text-lg font-bold">Attiva</p>
                                        </div>

                                        <button
                                            onClick={handleDisableMfa}
                                            disabled={loading}
                                            className="btn bg-white dark:bg-surface-800 border-red-200 dark:border-red-900/30 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 px-8"
                                        >
                                            {loading ? 'Disattivazione...' : 'Disattiva MFA'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Other Security Tips Card */}
                        <div className="card p-6 border-l-4 border-amber-500">
                            <div className="flex gap-4">
                                <AlertCircle className="w-6 h-6 text-amber-500 flex-shrink-0" />
                                <div>
                                    <h4 className="font-bold mb-1">Proteggi il tuo segreto</h4>
                                    <p className="text-sm text-surface-500">
                                        Non condividere mai il tuo codice TOTP o il segreto MFA con nessuno. Gli amministratori di sistema non ti chiederanno mai queste informazioni.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
