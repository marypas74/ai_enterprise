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

      // On native platforms, use fetch with timeout instead of axios (which may hang in WebView)
      if (isNativePlatform()) {
        const token = useAuthStore.getState().accessToken || '';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
          const response = await fetch(`${API_BASE_URL}/attachments/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const data = await response.json();
            if (data.attachments) {
              uploadedIds.push(...data.attachments.map((a: any) => a.id));
            }
          }
        } catch (fetchErr: any) {
          clearTimeout(timeoutId);
          console.error('[Upload Native] Error:', fetchErr?.message || fetchErr);
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
