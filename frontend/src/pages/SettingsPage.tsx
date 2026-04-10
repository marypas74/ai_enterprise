import { useState, useEffect } from 'react';
import { useAuthStore } from '../hooks/useAuthStore';
import { api } from '../services/api';
import { downloadBlob } from '../utils/fileDownload';
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
    Unlock,
    Download,
    Trash2,
    FileText,
    Eye,
    XCircle,
    RefreshCw,
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
    const [exportsList, setExportsList] = useState<any[]>([]);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [deletionPending, setDeletionPending] = useState(false);
    const [showMfaDisableModal, setShowMfaDisableModal] = useState(false);
    const [mfaDisableCode, setMfaDisableCode] = useState('');
    const [mfaGloballyEnforced, setMfaGloballyEnforced] = useState(false);

    // Load latest user status + deletion status + MFA global setting
    useEffect(() => {
        const loadStatus = async () => {
            try {
                const [meRes, consentRes, settingsRes] = await Promise.all([
                    api.get('/auth/me'),
                    api.get('/compliance/consent/status').catch(() => null),
                    api.get('/admin/settings').catch(() => null),
                ]);
                setMfaEnabled(!!meRes.data.mfa_enabled);
                if (consentRes?.data?.deletion_pending) {
                    setDeletionPending(true);
                }
                const mfaSetting = settingsRes?.data?.mfa_enforced;
                if (mfaSetting) {
                    setMfaGloballyEnforced(mfaSetting.value === true || mfaSetting.value === 'true');
                }
            } catch (err) {
                console.error('Failed to load user status:', err);
            }
        };
        loadStatus();
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
        if (!mfaDisableCode || mfaDisableCode.length < 6) return;

        setLoading(true);
        setError('');
        try {
            await api.post('/auth/mfa/disable', { totp_code: mfaDisableCode });
            setMfaEnabled(false);
            setShowMfaDisableModal(false);
            setMfaDisableCode('');
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
                                <div className="flex items-center gap-2">
                                    <span className={clsx(
                                        "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                                        mfaGloballyEnforced
                                            ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                                            : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                    )}>
                                        {mfaGloballyEnforced ? 'Obbligatoria' : 'Opzionale'}
                                    </span>
                                    <div className={clsx(
                                        "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                                        mfaEnabled
                                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                            : "bg-surface-100 text-surface-500 dark:bg-surface-800"
                                    )}>
                                        {mfaEnabled ? 'Attivata' : 'Disattivata'}
                                    </div>
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
                                            onClick={() => setShowMfaDisableModal(true)}
                                            disabled={loading}
                                            className="btn bg-white dark:bg-surface-800 border-red-200 dark:border-red-900/30 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 px-8"
                                        >
                                            Disattiva MFA
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

                        {/* Privacy & Data Section (AI Act / GDPR) */}
                        <div className="card p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600">
                                    <Shield className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold">Privacy & Dati</h3>
                                    <p className="text-sm text-surface-500">Gestisci i tuoi dati e la tua privacy (AI Act / GDPR)</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {/* Data Export */}
                                <div className="p-4 bg-surface-50 dark:bg-surface-800/50 rounded-lg space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Download className="w-5 h-5 text-blue-500" />
                                            <div>
                                                <p className="font-medium">Esporta i tuoi dati</p>
                                                <p className="text-xs text-surface-500">Scarica una copia di tutti i tuoi dati (Art. 20 GDPR)</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        setSuccess('');
                                                        const res = await api.post('/compliance/data-export');
                                                        setSuccess(`Richiesta export creata (ID: ${res.data.export_id}).`);
                                                        // Refresh exports list
                                                        const listRes = await api.get('/compliance/data-exports');
                                                        setExportsList(listRes.data.exports || []);
                                                    } catch { setError('Errore nella richiesta di export.'); }
                                                }}
                                                className="btn bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm"
                                            >
                                                Richiedi Export
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const res = await api.get('/compliance/data-exports');
                                                        setExportsList(res.data.exports || []);
                                                    } catch { /* ignore */ }
                                                }}
                                                className="btn bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300 px-2 py-2 text-sm"
                                                aria-label="Aggiorna lista export"
                                            >
                                                <RefreshCw className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                    {exportsList.length > 0 && (
                                        <div className="space-y-1">
                                            {exportsList.map((exp: any) => (
                                                <div key={exp.id} className="flex items-center justify-between text-xs p-2 bg-white dark:bg-surface-900 rounded">
                                                    <span className="text-surface-600 dark:text-surface-400">
                                                        Export #{exp.id} — {exp.status === 'completed' ? 'Completato' : exp.status === 'pending' ? 'In attesa' : exp.status === 'processing' ? 'In elaborazione' : exp.status}
                                                    </span>
                                                    {exp.status === 'completed' && (
                                                        <button
                                                            onClick={async () => {
                                                                try {
                                                                    const res = await api.get(`/compliance/data-export/${exp.id}`, { responseType: 'blob' });
                                                                    await downloadBlob(new Blob([res.data]), `data-export-${exp.id}.json`);
                                                                } catch { setError('Errore nel download del file export.'); }
                                                            }}
                                                            className="text-blue-600 hover:text-blue-700 font-medium"
                                                        >
                                                            Scarica
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Transparency Link */}
                                <div className="flex items-center justify-between p-4 bg-surface-50 dark:bg-surface-800/50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <Eye className="w-5 h-5 text-purple-500" />
                                        <div>
                                            <p className="font-medium">Trasparenza AI</p>
                                            <p className="text-xs text-surface-500">Modelli utilizzati, limitazioni, statistiche di utilizzo</p>
                                        </div>
                                    </div>
                                    <Link to="/transparency" className="btn bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 text-sm">
                                        Visualizza
                                    </Link>
                                </div>

                                {/* Privacy Policy Link */}
                                <div className="flex items-center justify-between p-4 bg-surface-50 dark:bg-surface-800/50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <FileText className="w-5 h-5 text-surface-500" />
                                        <div>
                                            <p className="font-medium">Privacy Policy & Termini</p>
                                            <p className="text-xs text-surface-500">Informativa sul trattamento dei dati personali</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Link to="/privacy" className="btn bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-300 dark:hover:bg-surface-600 px-3 py-2 text-sm">
                                            Privacy
                                        </Link>
                                        <Link to="/terms" className="btn bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-300 dark:hover:bg-surface-600 px-3 py-2 text-sm">
                                            Termini
                                        </Link>
                                    </div>
                                </div>

                                {/* Account Deletion */}
                                <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/30 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Trash2 className="w-5 h-5 text-red-500" />
                                            <div>
                                                <p className="font-medium text-red-700 dark:text-red-400">Elimina account</p>
                                                <p className="text-xs text-red-600/70 dark:text-red-400/70">Cancellazione definitiva con periodo di grazia di 30 giorni</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            {deletionPending ? (
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            await api.post('/compliance/delete-account/cancel');
                                                            setDeletionPending(false);
                                                            setSuccess('Richiesta di cancellazione annullata.');
                                                        } catch { setError('Errore nell\'annullamento della cancellazione.'); }
                                                    }}
                                                    className="btn bg-surface-600 hover:bg-surface-700 text-white px-4 py-2 text-sm"
                                                >
                                                    Annulla Cancellazione
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => setShowDeleteConfirm(true)}
                                                    className="btn bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm"
                                                >
                                                    Richiedi Cancellazione
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {deletionPending && (
                                        <p className="text-xs text-red-600 dark:text-red-400">
                                            Cancellazione in corso. Hai 30 giorni per annullarla.
                                        </p>
                                    )}
                                </div>

                                {/* Delete Confirmation Modal */}
                                {showDeleteConfirm && (
                                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
                                        <div className="bg-white dark:bg-surface-900 rounded-xl max-w-md w-full p-6 space-y-4">
                                            <h3 id="delete-confirm-title" className="text-lg font-semibold text-red-700 dark:text-red-400">Conferma cancellazione account</h3>
                                            <p className="text-sm text-surface-600 dark:text-surface-400">
                                                Stai per richiedere la cancellazione del tuo account. Questa azione è irreversibile dopo il periodo di grazia di 30 giorni.
                                            </p>
                                            <p className="text-sm text-surface-600 dark:text-surface-400">
                                                Digita <strong>ELIMINA</strong> per confermare:
                                            </p>
                                            <input
                                                type="text"
                                                value={deleteConfirmText}
                                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                                className="w-full px-3 py-2 border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-sm"
                                                placeholder="ELIMINA"
                                                autoFocus
                                            />
                                            <div className="flex justify-end gap-3">
                                                <button
                                                    onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}
                                                    className="btn bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300 px-4 py-2 text-sm"
                                                >
                                                    Annulla
                                                </button>
                                                <button
                                                    disabled={deleteConfirmText !== 'ELIMINA'}
                                                    onClick={async () => {
                                                        try {
                                                            await api.post('/compliance/delete-account');
                                                            setDeletionPending(true);
                                                            setShowDeleteConfirm(false);
                                                            setDeleteConfirmText('');
                                                            setSuccess('Richiesta di cancellazione inviata. Hai 30 giorni per annullarla.');
                                                        } catch { setError('Errore nella richiesta di cancellazione.'); }
                                                    }}
                                                    className="btn bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    Conferma Cancellazione
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            {/* MFA Disable Modal */}
            {showMfaDisableModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="mfa-disable-title">
                    <div className="bg-white dark:bg-surface-900 rounded-xl max-w-md w-full p-6 space-y-4">
                        <h3 id="mfa-disable-title" className="text-lg font-semibold text-surface-900 dark:text-surface-100">Disattiva MFA</h3>
                        <p className="text-sm text-surface-600 dark:text-surface-400">
                            Inserisci il codice TOTP attuale dalla tua app di autenticazione per disabilitare la verifica a due fattori.
                        </p>
                        <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={6}
                            value={mfaDisableCode}
                            onChange={(e) => setMfaDisableCode(e.target.value.replace(/\D/g, ''))}
                            className="w-full px-3 py-2 border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-sm text-center text-2xl tracking-widest"
                            placeholder="000000"
                            autoFocus
                        />
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => { setShowMfaDisableModal(false); setMfaDisableCode(''); }}
                                className="btn bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300 px-4 py-2 text-sm"
                            >
                                Annulla
                            </button>
                            <button
                                disabled={mfaDisableCode.length < 6 || loading}
                                onClick={handleDisableMfa}
                                className="btn bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Disattivazione...' : 'Conferma Disattivazione'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
