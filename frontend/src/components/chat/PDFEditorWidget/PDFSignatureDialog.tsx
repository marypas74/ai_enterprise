import React, { useState, useCallback, useEffect } from 'react';
import { api } from '../../../services/api';
import { useAuthStore } from '../../../hooks/useAuthStore';
import { SignatureCanvas } from './SignatureCanvas';
import { Loader2, X, Shield, Pen, Image, Type } from 'lucide-react';

type SignatureMethod = 'draw' | 'image' | 'text';

interface Certificate {
  id: number;
  name: string;
  subject_cn: string;
  valid_to: string;
  is_self_signed: boolean;
}

interface PDFSignatureDialogProps {
  attachmentId: number;
  currentPage: number;
  onClose: () => void;
  onSigned: () => void;
}

/**
 * PDFSignatureDialog — modal dialog for signing a PDF.
 * Supports simple (draw/image/text) and certified (X.509) signatures.
 * All operations are server-side via API calls.
 */
export const PDFSignatureDialog: React.FC<PDFSignatureDialogProps> = ({
  attachmentId,
  currentPage,
  onClose,
  onSigned,
}) => {
  const [tab, setTab] = useState<'simple' | 'certified'>('simple');
  const [method, setMethod] = useState<SignatureMethod>('draw');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [textName, setTextName] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  // Certified tab state
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [selectedCertId, setSelectedCertId] = useState<number | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signature placement
  const [x] = useState(100);
  const [y] = useState(100);
  const [width] = useState(200);
  const [height] = useState(60);

  // Fetch certificates on mount
  useEffect(() => {
    async function fetchCerts() {
      try {
        const token = useAuthStore.getState().accessToken;
        const res = await api.post(
          '/tools/execute',
          { tool: 'manage_certificates', input: { action: 'list' } },
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        // Parse certificate list from response
        const output = res.data?.output || res.data?.data?.output || '';
        if (typeof output === 'string' && output.includes('ID ')) {
          const parsed: Certificate[] = [];
          const lines = output.split('\n');
          for (const line of lines) {
            const match = line.match(/ID (\d+): (.+?) \(CN: (.+?), valid .+? to (.+?),/);
            if (match) {
              parsed.push({
                id: parseInt(match[1]),
                name: match[2],
                subject_cn: match[3],
                valid_to: match[4],
                is_self_signed: line.includes('self-signed: yes'),
              });
            }
          }
          setCertificates(parsed);
          if (parsed.length > 0) setSelectedCertId(parsed[0].id);
        }
      } catch {
        // Certificates not available — certified tab will show empty
      }
    }
    fetchCerts();
  }, []);

  // Handle image file selection
  const handleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Extract base64 part after data:image/...;base64,
      const base64 = result.split(',')[1];
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleSignSimple = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let base64Image: string | null = null;

      if (method === 'draw') {
        if (!signatureDataUrl) {
          setError('Disegna la tua firma prima di procedere');
          setIsLoading(false);
          return;
        }
        base64Image = signatureDataUrl.split(',')[1];
      } else if (method === 'image') {
        if (!imageBase64) {
          setError('Seleziona un\'immagine della firma');
          setIsLoading(false);
          return;
        }
        base64Image = imageBase64;
      } else if (method === 'text') {
        if (!textName.trim()) {
          setError('Inserisci il tuo nome');
          setIsLoading(false);
          return;
        }
        // Create text signature as a canvas image
        const canvas = document.createElement('canvas');
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#000066';
          ctx.font = 'italic 32px Georgia, "Times New Roman", serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(textName, canvas.width / 2, canvas.height / 2);
          base64Image = canvas.toDataURL('image/png').split(',')[1];
        }
      }

      if (!base64Image) {
        setError('Impossibile generare la firma');
        setIsLoading(false);
        return;
      }

      const token = useAuthStore.getState().accessToken;
      await api.post(
        '/tools/execute',
        {
          tool: 'pdf_sign',
          input: {
            action: 'sign_simple',
            attachment_id: attachmentId,
            page: currentPage - 1,
            x, y, width, height,
            signature_image_base64: base64Image,
          },
        },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );

      onSigned();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Firma fallita');
    } finally {
      setIsLoading(false);
    }
  }, [method, signatureDataUrl, imageBase64, textName, attachmentId, currentPage, x, y, width, height, onSigned]);

  const handleSignCertified = useCallback(async () => {
    if (!selectedCertId) {
      setError('Seleziona un certificato');
      return;
    }
    if (!passphrase) {
      setError('Inserisci la passphrase del certificato');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const token = useAuthStore.getState().accessToken;
      await api.post(
        '/tools/execute',
        {
          tool: 'pdf_sign',
          input: {
            action: 'sign_certified',
            attachment_id: attachmentId,
            page: currentPage - 1,
            x, y, width, height,
            certificate_id: selectedCertId,
            passphrase,
            reason: reason || 'Digital Approval',
            location: location || undefined,
          },
        },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );

      onSigned();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Firma certificata fallita');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCertId, passphrase, attachmentId, currentPage, x, y, width, height, reason, location, onSigned]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Firma PDF</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            className={`flex-1 px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 ${
              tab === 'simple'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setTab('simple')}
          >
            <Pen className="w-4 h-4" />
            Firma Semplice
          </button>
          <button
            className={`flex-1 px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 ${
              tab === 'certified'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setTab('certified')}
          >
            <Shield className="w-4 h-4" />
            Firma Certificata
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {tab === 'simple' && (
            <>
              {/* Method selection */}
              <div className="flex gap-2">
                {([
                  { value: 'draw' as const, icon: Pen, label: 'Disegno' },
                  { value: 'image' as const, icon: Image, label: 'Immagine' },
                  { value: 'text' as const, icon: Type, label: 'Testo' },
                ] as const).map(({ value, icon: Icon, label }) => (
                  <button
                    key={value}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg border ${
                      method === value
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                    onClick={() => setMethod(value)}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Method-specific UI */}
              {method === 'draw' && (
                <SignatureCanvas onSignatureChange={setSignatureDataUrl} />
              )}

              {method === 'image' && (
                <div>
                  <label className="text-sm font-medium text-gray-600 dark:text-gray-300">
                    Carica immagine firma (PNG/JPG):
                  </label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={handleImageChange}
                    className="mt-1 w-full text-sm"
                  />
                  {imageFile && (
                    <p className="text-xs text-gray-500 mt-1">{imageFile.name}</p>
                  )}
                </div>
              )}

              {method === 'text' && (
                <div>
                  <label className="text-sm font-medium text-gray-600 dark:text-gray-300">
                    Nome (firma con font corsivo):
                  </label>
                  <input
                    type="text"
                    className="mt-1 w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                    value={textName}
                    onChange={(e) => setTextName(e.target.value)}
                    placeholder="Mario Rossi"
                  />
                  {textName && (
                    <div className="mt-2 p-3 border rounded bg-gray-50 dark:bg-gray-900 text-center">
                      <span style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontSize: '24px', color: '#000066' }}>
                        {textName}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <button
                className="w-full py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2"
                disabled={isLoading}
                onClick={handleSignSimple}
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pen className="w-4 h-4" />}
                Firma Documento
              </button>
            </>
          )}

          {tab === 'certified' && (
            <>
              {certificates.length === 0 ? (
                <div className="text-center py-6 text-gray-500 dark:text-gray-400">
                  <Shield className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Nessun certificato trovato.</p>
                  <p className="text-xs mt-1">Usa il comando &quot;genera certificato&quot; nella chat per crearne uno.</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-sm font-medium text-gray-600 dark:text-gray-300">Certificato:</label>
                    <select
                      className="mt-1 w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                      value={selectedCertId ?? ''}
                      onChange={(e) => setSelectedCertId(Number(e.target.value))}
                    >
                      {certificates.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} (CN: {c.subject_cn}{c.is_self_signed ? ', self-signed' : ''})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-600 dark:text-gray-300">Passphrase:</label>
                    <input
                      type="password"
                      className="mt-1 w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Passphrase chiave privata"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-600 dark:text-gray-300">Motivo (opzionale):</label>
                    <input
                      type="text"
                      className="mt-1 w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Approvazione"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-600 dark:text-gray-300">Luogo (opzionale):</label>
                    <input
                      type="text"
                      className="mt-1 w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Milano, IT"
                    />
                  </div>

                  <button
                    className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    disabled={isLoading}
                    onClick={handleSignCertified}
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                    Firma con Certificato
                  </button>
                </>
              )}
            </>
          )}

          {error && (
            <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
