import React, { useCallback } from 'react';
import {
  Send,
  Paperclip,
  X,
  Image,
  FileText,
  Code,
  File,
  Loader2,
  Camera,
} from 'lucide-react';
import type { Attachment } from '../../hooks/useFileAttachments';
import { isNativePlatform } from '../../utils/platform';

// Helper to get icon for attachment type
function getAttachmentIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text/plain')) return FileText;
  if (mimeType.includes('javascript') || mimeType.includes('typescript') || mimeType.includes('json') ||
    mimeType.includes('python') || mimeType.includes('java') || mimeType.includes('html') || mimeType.includes('css')) return Code;
  return File;
}

interface ChatInputAreaProps {
  input: string;
  isStreaming: boolean;
  isUploading: boolean;
  attachments: Attachment[];
  currentModelName: string;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (index: number) => void;
  onOpenFilePicker: () => void;
  onAddFile?: (file: File) => void;
}

export default function ChatInputArea({
  input,
  isStreaming,
  isUploading,
  attachments,
  currentModelName,
  inputRef,
  fileInputRef,
  onInputChange,
  onKeyDown,
  onSend,
  onFileSelect,
  onRemoveAttachment,
  onOpenFilePicker,
  onAddFile,
}: ChatInputAreaProps) {
  const handleCameraCapture = useCallback(async () => {
    if (!isNativePlatform() || !onAddFile) return;
    try {
      const { Camera: CapCamera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const photo = await CapCamera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
      });
      if (photo.webPath) {
        const response = await fetch(photo.webPath);
        const blob = await response.blob();
        const file = new File([blob], `photo_${Date.now()}.${photo.format}`, {
          type: `image/${photo.format}`,
        });
        onAddFile(file);
      }
    } catch (err) {
      console.error('Camera capture failed:', err);
    }
  }, [onAddFile]);

  return (
    <div className="border-t border-surface-200 dark:border-surface-800 p-4 chat-input-area">
      <div className="max-w-3xl mx-auto">
        {/* Attachments Preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3 p-2 bg-surface-50 dark:bg-surface-900 rounded-lg">
            {attachments.map((att, index) => {
              const IconComponent = getAttachmentIcon(att.file.type);
              return (
                <div
                  key={index}
                  className="relative flex items-center gap-2 px-3 py-2 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700 group"
                >
                  {att.preview ? (
                    <img src={att.preview} alt="" className="w-8 h-8 object-cover rounded" />
                  ) : (
                    <IconComponent className="w-5 h-5 text-surface-500" />
                  )}
                  <span className="text-sm truncate max-w-[120px]">{att.file.name}</span>
                  <button
                    onClick={() => onRemoveAttachment(index)}
                    className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded transition-colors"
                  >
                    <X className="w-4 h-4 text-surface-400" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="relative flex items-end gap-2">
          {/* Hidden file input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileSelect}
            multiple
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.xml,.yaml,.yml,.js,.ts,.jsx,.tsx,.py,.java,.c,.cpp,.h,.html,.css,.jpg,.jpeg,.png,.gif,.webp,.svg,.mp3,.wav,.ogg,.zip,.tar,.gz"
          />

          {/* Attach button */}
          <button
            onClick={onOpenFilePicker}
            disabled={isStreaming || isUploading}
            className="p-3 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-50"
            title="Allega file"
          >
            {isUploading ? (
              <Loader2 className="w-5 h-5 text-surface-500 animate-spin" />
            ) : (
              <Paperclip className="w-5 h-5 text-surface-500" />
            )}
          </button>

          {/* Camera button (mobile only) */}
          {isNativePlatform() && (
            <button
              onClick={handleCameraCapture}
              disabled={isStreaming || isUploading}
              className="p-3 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-50"
              title="Scatta foto"
            >
              <Camera className="w-5 h-5 text-surface-500" />
            </button>
          )}

          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={attachments.length > 0 ? 'Aggiungi un messaggio per gli allegati...' : 'Messaggio...'}
              rows={1}
              className="input resize-none min-h-[48px] max-h-[200px] py-3 pr-12"
              style={{
                height: 'auto',
                minHeight: '48px',
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
              }}
            />
            <button
              onClick={onSend}
              disabled={(!input.trim() && attachments.length === 0) || isStreaming || isUploading}
              className="absolute right-2 bottom-2 p-2 rounded-lg bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-700 transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-center text-surface-400">
          {currentModelName} pu\u00F2 produrre informazioni imprecise
          {attachments.length > 0 && ` \u2022 ${attachments.length} allegat${attachments.length === 1 ? 'o' : 'i'} pront${attachments.length === 1 ? 'o' : 'i'}`}
        </p>
      </div>
    </div>
  );
}
