import React, { useState, useCallback } from 'react';
import { api } from '../../../services/api';
import { useAuthStore } from '../../../hooks/useAuthStore';
import { Loader2 } from 'lucide-react';

type FormFieldType = 'text' | 'checkbox' | 'dropdown';

interface PDFFormLayerProps {
  attachmentId: number;
  currentPage: number;
  zoom: number;
  active: boolean;
  onDirty: () => void;
}

interface PendingField {
  x: number;
  y: number;
}

/**
 * PDFFormLayer — overlay for placing and interacting with form fields on the PDF canvas.
 * All operations are server-side via API calls to the pdf_form tool.
 */
export const PDFFormLayer: React.FC<PDFFormLayerProps> = ({
  attachmentId,
  currentPage,
  zoom,
  active,
  onDirty,
}) => {
  const [pending, setPending] = useState<PendingField | null>(null);
  const [fieldType, setFieldType] = useState<FormFieldType>('text');
  const [fieldName, setFieldName] = useState('');
  const [fieldWidth, setFieldWidth] = useState(150);
  const [fieldHeight, setFieldHeight] = useState(24);
  const [dropdownOptions, setDropdownOptions] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!active) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoom;
      const y = (e.clientY - rect.top) / zoom;
      setPending({ x, y });
      setFieldName(`field_${Date.now()}`);
      setError(null);
    },
    [active, zoom],
  );

  const addField = useCallback(async () => {
    if (!pending || !fieldName.trim()) return;
    setIsProcessing(true);
    setError(null);

    try {
      const token = useAuthStore.getState().accessToken;
      const body: Record<string, unknown> = {
        action: 'add_field',
        attachment_id: attachmentId,
        page: currentPage - 1,
        type: fieldType,
        name: fieldName.trim(),
        x: pending.x,
        y: pending.y,
        width: fieldWidth,
        height: fieldHeight,
      };

      if (fieldType === 'dropdown' && dropdownOptions.trim()) {
        body.options = dropdownOptions.split(',').map(o => o.trim()).filter(Boolean);
      }

      await api.post('/tools/pdf-form', body, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      onDirty();
      setPending(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Failed to add field');
    } finally {
      setIsProcessing(false);
    }
  }, [pending, attachmentId, currentPage, fieldType, fieldName, fieldWidth, fieldHeight, dropdownOptions, onDirty]);

  if (!active) return null;

  return (
    <div className="absolute inset-0" style={{ pointerEvents: 'auto' }}>
      {/* Click capture layer */}
      <div
        className="absolute inset-0 cursor-crosshair"
        onClick={handleCanvasClick}
      />

      {/* Pending field dialog */}
      {pending && (
        <div
          className="absolute z-50 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 p-3 min-w-[240px]"
          style={{ left: pending.x * zoom, top: pending.y * zoom }}
          onClick={(e) => e.stopPropagation()}
        >
          {isProcessing ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Aggiunta campo...</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Tipo campo:</label>
                <select
                  className="mt-0.5 w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value as FormFieldType)}
                >
                  <option value="text">Testo</option>
                  <option value="checkbox">Checkbox</option>
                  <option value="dropdown">Dropdown</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Nome campo:</label>
                <input
                  type="text"
                  className="mt-0.5 w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                  value={fieldName}
                  onChange={(e) => setFieldName(e.target.value)}
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Larghezza:</label>
                  <input
                    type="number"
                    className="mt-0.5 w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    value={fieldWidth}
                    onChange={(e) => setFieldWidth(Number(e.target.value))}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Altezza:</label>
                  <input
                    type="number"
                    className="mt-0.5 w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    value={fieldHeight}
                    onChange={(e) => setFieldHeight(Number(e.target.value))}
                  />
                </div>
              </div>

              {fieldType === 'dropdown' && (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Opzioni (separate da virgola):</label>
                  <input
                    type="text"
                    className="mt-0.5 w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    value={dropdownOptions}
                    onChange={(e) => setDropdownOptions(e.target.value)}
                    placeholder="Opzione1, Opzione2, ..."
                  />
                </div>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                  onClick={addField}
                >
                  Aggiungi Campo
                </button>
                <button
                  className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300"
                  onClick={() => setPending(null)}
                >
                  Annulla
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 mt-1">{error}</p>
          )}
        </div>
      )}
    </div>
  );
};
