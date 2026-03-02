import { useState, useCallback, useRef } from 'react';
import { api } from '../services/api';

export interface Attachment {
  id?: number;
  file: File;
  preview?: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'processing' | 'completed' | 'failed';
  contentType?: string;
  uploadedId?: number;
}

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
    const uploadedIds: number[] = [];

    try {
      const formData = new FormData();
      if (conversationId) {
        formData.append('conversationId', conversationId.toString());
      }

      attachments.forEach(att => {
        formData.append('files', att.file);
      });

      const response = await api.post('/attachments/upload', formData, {
        headers: { 'Content-Type': undefined },
      });

      if (response.data.attachments) {
        uploadedIds.push(...response.data.attachments.map((a: any) => a.id));
      }

      // Clear attachments after upload
      attachments.forEach(att => {
        if (att.preview) URL.revokeObjectURL(att.preview);
      });
      setAttachments([]);
    } catch (err: any) {
      console.error('Failed to upload attachments:', err);
      console.error('[Upload] Error details:', err?.response?.data || err?.message || err);
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
