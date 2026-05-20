import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../hooks/useAuthStore';
import { MessageSquare, Mail, Lock, AlertCircle, Smartphone, Download, PlayCircle } from 'lucide-react';
import { APP_VERSION } from '../version';
import { isNativePlatform } from '../utils/platform';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);
  const [backendVersion, setBackendVersion] = useState<string | null>(null);

  const { login, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    // Fetch backend version dynamically
    fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/version`)
      .then(res => res.json())
      .then(data => setBackendVersion(data.version))
      .catch(() => setBackendVersion(APP_VERSION));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      const result: any = await login(email, password, totpCode);

      if (result?.mfa_required) {
        setShowMfa(true);
        return;
      }

      if (result?.mfa_setup_required) {
        setMfaSetupRequired(true);
        // We still log them in (they have a token) but force setup
        navigate('/settings');
        return;
      }

      navigate('/');
    } catch {
      // Error is already in store
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-surface-100 to-surface-200 dark:from-surface-900 dark:to-surface-950 p-4">
      <div className="w-full max-w-md">
        <div className="card p-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="p-3 rounded-xl bg-primary-100 dark:bg-primary-900/30">
              <MessageSquare className="w-8 h-8 text-primary-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
                Enterprise AI
              </h1>
              <p className="text-sm text-surface-500">Chat Platform</p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {!showMfa ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input pl-11"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input pl-11"
                      placeholder="Your password"
                      required
                    />
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                  Codice di Verifica (MFA)
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
                  <input
                    type="text"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    className="input pl-11"
                    placeholder="000000"
                    maxLength={6}
                    autoFocus
                    required
                  />
                </div>
                <p className="mt-2 text-xs text-surface-500">
                  Inserisci il codice a 6 cifre dalla tua app di autenticazione.
                </p>
                <button
                  type="button"
                  onClick={() => setShowMfa(false)}
                  className="mt-4 text-sm text-primary-600 dark:text-primary-400 hover:underline"
                >
                  Torna al login
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full py-3"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {showMfa ? 'Verifica...' : 'Signing in...'}
                </span>
              ) : (
                <>{showMfa ? 'Verifica Codice' : 'Sign In'}</>
              )}
            </button>
          </form>

          {/* AI Act Disclosure + Privacy links */}
          <p className="mt-4 text-xs text-surface-500 text-center leading-relaxed">
            Effettuando il login, dichiari di aver letto la{' '}
            <a href="/privacy" className="text-primary-600 dark:text-primary-400 hover:underline">Privacy Policy</a>{' '}
            e i{' '}
            <a href="/terms" className="text-primary-600 dark:text-primary-400 hover:underline">Termini di Servizio</a>.
            Questo servizio utilizza intelligenza artificiale.
          </p>

          {/* Info */}
          <div className="mt-4 text-center">
            <p className="text-sm text-surface-500">
              Contatta l'amministratore per richiedere un account
            </p>
          </div>

          {/* Android App Download (hidden in native app) */}
          {!isNativePlatform() && (
            <div className="mt-4">
              <a
                href={`${import.meta.env.VITE_API_URL || '/api'}/public/downloads/apk`}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors text-sm text-surface-600 dark:text-surface-400"
              >
                <Smartphone className="w-4 h-4" />
                <span>Scarica App Android</span>
                <Download className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {/* DEBT-88-C: Internal CA download for browser trust import (LAN aia2.lan) */}
          {!isNativePlatform() && (
            <div className="mt-2">
              <a
                href={`${import.meta.env.VITE_API_URL || '/api'}/public/internal-ca.crt`}
                download="enterprise-ai-ca.crt"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors text-sm text-surface-600 dark:text-surface-400"
                title="Importa nel browser per evitare warning certificato su aia2.lan"
              >
                <span>🔐</span>
                <span>Scarica Certificato CA (fidati del sito)</span>
                <Download className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>

        {/* Login guide video — public endpoint, streams from backend with Range support */}
        <div className="mt-6 rounded-xl overflow-hidden shadow-lg bg-black">
          <div className="flex items-center gap-2 px-4 py-2 bg-surface-800 text-surface-100 text-sm">
            <PlayCircle className="w-4 h-4 text-primary-400" />
            <span>Guida introduttiva</span>
          </div>
          <video
            controls
            preload="metadata"
            playsInline
            className="w-full h-auto block"
            src={`${import.meta.env.VITE_API_URL || '/api'}/public/login-guide.mp4`}
          >
            Il tuo browser non supporta la riproduzione video HTML5.
          </video>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center space-y-2">
          <p className="text-sm text-surface-500">
            Multi-provider AI Chat Platform
          </p>
          <p className="text-xs text-surface-400 font-mono">
            v{backendVersion || APP_VERSION}
          </p>
        </div>
      </div>
    </div>
  );
}
