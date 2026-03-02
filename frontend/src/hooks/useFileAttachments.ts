import { useState, useCallback, useRef } from 'react';
import { api } from '../services/api';
import { isNativePlatform } from '../utils/platform';
import { useAuthStore } from './useAuthStore';

export interface Attachment {
  id?: number;
  file: File;
  preview?: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'processing' | 'completed' | 'failed';
  contentType?: string;
  uploadedId?: number;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

interface UseFileAttachmentsReturn {
  attachments: Attachment[];
  isUploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  addFile: (file: File) => void;
  removeAttachment: (index: number) => void;
  uploadAttachments: (conversationId?: number) => Promise<number[]>;
  clearAttachments: () => void;
}

export function useFileAttachments(): UseFileAttachmentsReturn {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: Attachment[] = Array.from(files).map(file => ({
      file,
      status: 'pending' as const,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));

    setAttachments(prev => [...prev, ...newAttachments]);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const addFile = useCallback((file: File) => {
    const attachment: Attachment = {
      file,
      status: 'pending',
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    };
    setAttachments(prev => [...prev, attachment]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => {
      const newAttachments = [...prev];
      if (newAttachments[index].preview) {
        URL.revokeObjectURL(newAttachments[index].preview!);
      }
      newAttachments.splice(index, 1);
      return newAttachments;
    });
  }, []);

  const uploadAttachments = useCallback(async (conversationId?: number): Promise<number[]> => {
    if (attachments.length === 0) return [];

    setIsUploading(true);
    // Mark all attachments as uploading
    setAttachments(prev => prev.map(att => ({ ...att, status: 'uploading' as const })));
    const uploadedIds: number[] = [];

    try {
      const formData = new FormData();
      if (conversationId) {
        formData.append('conversationId', conversationId.toString());
      }

      attachments.forEach(att => {
        formData.append('files', att.file);
      });

      // On native platforms, use XMLHttpRequest instead of fetch/axios
      // (fetch response.json() hangs in Capacitor WebView - known bug)
      if (isNativePlatform()) {
        const doXhrUpload = (authToken: string): Promise<{ ids: number[]; status: number }> => {
          return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${API_BASE_URL}/attachments/upload`);
            xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
            xhr.timeout = 30000;
            xhr.onload = () => {
              if (xhr.status === 401) {
                resolve({ ids: [], status: 401 });
                return;
              }
              try {
                const data = JSON.parse(xhr.responseText);
                resolve({ ids: data.attachments?.map((a: any) => a.id) || [], status: xhr.status });
              } catch { resolve({ ids: [], status: xhr.status }); }
            };
            xhr.onerror = () => reject(new Error('Upload failed'));
            xhr.ontimeout = () => reject(new Error('Upload timeout'));
            xhr.send(formData);
          });
        };

        try {
          let token = useAuthStore.getState().accessToken || '';
          let result = await doXhrUpload(token);

          // Token expired - try refresh and retry
          if (result.status === 401) {
            try {
              const refreshRes = await api.post('/auth/refresh');
              const newToken = refreshRes.data.accessToken;
              useAuthStore.setState({ accessToken: newToken });
              result = await doXhrUpload(newToken);
            } catch {
              console.error('[Upload Native] Token refresh failed');
            }
          }

          uploadedIds.push(...result.ids);
        } catch (xhrErr: any) {
          console.error('[Upload Native XHR] Error:', xhrErr?.message || xhrErr);
        }
      } else {
        const response = await api.post('/attachments/upload', formData, {
          headers: { 'Content-Type': undefined },
        });

        if (response.data.attachments) {
          uploadedIds.push(...response.data.attachments.map((a: any) => a.id));
        }
      }

      // Mark as uploaded and clear after brief delay to show checkmark
      setAttachments(prev => prev.map(att => ({ ...att, status: 'uploaded' as const })));
      setTimeout(() => {
        attachments.forEach(att => {
          if (att.preview) URL.revokeObjectURL(att.preview);
        });
        setAttachments([]);
      }, 800);
    } catch (err: any) {
      console.error('Failed to upload attachments:', err);
      setAttachments(prev => prev.map(att => ({ ...att, status: 'failed' as const })));
    } finally {
      setIsUploading(false);
    }

    return uploadedIds;
  }, [attachments]);

  const clearAttachments = useCallback(() => {
    attachments.forEach(att => {
      if (att.preview) URL.revokeObjectURL(att.preview);
    });
    setAttachments([]);
  }, [attachments]);

  return {
    attachments,
    isUploading,
    fileInputRef,
    setAttachments,
    handleFileSelect,
    addFile,
    removeAttachment,
    uploadAttachments,
    clearAttachments,
  };
}
