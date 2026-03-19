import { create } from 'zustand';

interface PDFEditorState {
  isOpen: boolean;
  attachmentId: number | null;
  filename: string;
  openEditor: (attachmentId: number, filename: string) => void;
  closeEditor: () => void;
}

export const usePDFEditorStore = create<PDFEditorState>((set) => ({
  isOpen: false,
  attachmentId: null,
  filename: '',
  openEditor: (attachmentId, filename) => set({ isOpen: true, attachmentId, filename }),
  closeEditor: () => set({ isOpen: false, attachmentId: null, filename: '' }),
}));
