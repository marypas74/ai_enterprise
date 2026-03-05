import React, { useCallback } from 'react';
import {
  Send,
  Paperclip,
  X,
  Image,
  FileText,
  Code,
  File as FileIcon,
  Loader2,
  Camera,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';
import type { Attachment } from '../../hooks/useFileAttachments';
import { isNativePlatform } from '../../utils/platform';
import VoiceButton from './VoiceButton';
import { RagModeToggle } from './RagModeToggle';
import { useDocumentStore, ChatMode } from '../../hooks/useDocumentStore';

// Helper to get icon for attachment type
function getAttachmentIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text/plain')) return FileText;
  if (mimeType.includes('javascript') || mimeType.includes('typescript') || mimeType.includes('json') ||
    mimeType.includes('python') || mimeType.includes('java') || mimeType.includes('html') || mimeType.includes('css')) return Code;
  return FileIcon;
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
  onVoiceTranscription?: (text: string) => void;
  onModeChange?: (mode: ChatMode) => void;
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
  onVoiceTranscription,
  onModeChange,
}: ChatInputAreaProps) {
  const { chatMode, selectedDocumentIds } = useDocumentStore();
  const isRagMode = chatMode === 'rag';
  const hasNoDocs = selectedDocumentIds.length === 0;

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
              const isUploading = att.status === 'uploading';
              const isUploaded = att.status === 'uploaded';
              const isFailed = att.status === 'failed';
              return (
                <div
                  key={index}
                  className={`relative flex items-center gap-2 px-3 py-2 bg-white dark:bg-surface-800 rounded-lg border group ${isUploaded ? 'border-primary-400 dark:border-primary-600' :
                    isFailed ? 'border-red-400 dark:border-red-600' :
                      'border-surface-200 dark:border-surface-700'
                    }`}
                >
                  {att.preview ? (
                    <img src={att.preview} alt="" className="w-8 h-8 object-cover rounded" />
                  ) : (
                    <IconComponent className="w-5 h-5 text-surface-500" />
                  )}
                  <span className="text-sm truncate max-w-[120px]">{att.file.name}</span>
                  {/* Upload status indicator */}
                  {isUploading && <Loader2 className="w-4 h-4 text-primary-500 animate-spin flex-shrink-0" />}
                  {isUploaded && <CheckCircle className="w-4 h-4 text-primary-500 flex-shrink-0" />}
                  {isFailed && <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                  {!isUploading && !isUploaded && (
                    <button
                      onClick={() => onRemoveAttachment(index)}
                      className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded transition-colors"
                    >
                      <X className="w-4 h-4 text-surface-400" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Hidden file input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={onFileSelect}
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.xml,.yaml,.yml,.js,.ts,.jsx,.tsx,.py,.java,.c,.cpp,.h,.html,.css,.jpg,.jpeg,.png,.gif,.webp,.svg,.mp3,.wav,.ogg,.zip,.tar,.gz"
        />

        {/* RAG Mode Toggle + Input row */}
        <div className="flex items-center justify-between mb-4">
          <RagModeToggle onModeChange={onModeChange} />

          {isRagMode && hasNoDocs && (
            <button
              onClick={onOpenFilePicker}
              className="px-3 py-1.5 rounded-full bg-indigo-600/10 text-indigo-600 text-xs font-semibold border border-indigo-600/20 hover:bg-indigo-600/20 transition-all flex items-center gap-1.5 animate-pulse"
            >
              <Paperclip className="w-3.5 h-3.5" />
              Carica documenti ora
            </button>
          )}
        </div>

        {/* Input row: attach + textarea + send */}
        <div className="relative flex items-end gap-2">
          {/* Attach & Camera buttons (left of textarea) */}
          {!isRagMode && (
            <div className="flex items-center gap-0.5 pb-1.5">
              <button
                onClick={onOpenFilePicker}
                disabled={isStreaming || isUploading}
                className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-50"
                title="Allega file"
              >
                {isUploading ? (
                  <Loader2 className="w-5 h-5 text-surface-500 animate-spin" />
                ) : (
                  <Paperclip className="w-5 h-5 text-surface-500" />
                )}
              </button>

              {isNativePlatform() && (
                <button
                  onClick={handleCameraCapture}
                  disabled={isStreaming || isUploading}
                  className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-50"
                  title="Scatta foto"
                >
                  <Camera className="w-5 h-5 text-surface-500" />
                </button>
              )}
            </div>
          )}

          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={isRagMode ? (hasNoDocs ? 'Carica documenti per iniziare...' : 'Fai una domanda sui tuoi documenti...') : (attachments.length > 0 ? 'Aggiungi un messaggio...' : 'Messaggio...')}
              rows={1}
              className={clsx(
                "input resize-none min-h-[48px] max-h-[200px] py-3 pr-12 transition-all",
                isRagMode && "border-indigo-600/30 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600/20"
              )}
              style={{ height: 'auto', minHeight: '48px' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
              }}
            />
            {(input.trim() || attachments.length > 0) ? (
              <button
                onClick={onSend}
                disabled={isStreaming || isUploading}
                className="absolute right-2 bottom-2 p-2 rounded-lg bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-700 transition-colors"
              >
                <Send className="w-5 h-5" />
              </button>
            ) : (onVoiceTranscription && !isRagMode) ? (
              <div className="absolute right-2 bottom-2">
                <VoiceButton
                  onTranscription={onVoiceTranscription}
                  disabled={isStreaming || isUploading}
                />
              </div>
            ) : (
              <button
                disabled
                className="absolute right-2 bottom-2 p-2 rounded-lg bg-primary-600 text-white opacity-50 cursor-not-allowed"
              >
                <Send className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Model name indicator */}
        <div className="flex items-center mt-1">
          <span className="flex-1 text-xs text-surface-400 text-right truncate">
            {currentModelName}
          </span>
        </div>
      </div>
    </div>
  );
}
