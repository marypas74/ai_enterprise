import { create } from 'zustand';

type SaveMode = 'draft' | 'download';

interface PDFEditorState {
  isOpen: boolean;
  attachmentId: number | null;
  filename: string;
  saveMode: SaveMode;
  openEditor: (attachmentId: number, filename: string, saveMode?: SaveMode) => void;
  closeEditor: () => void;
}

export const usePDFEditorStore = create<PDFEditorState>((set) => ({
  isOpen: false,
  attachmentId: null,
  filename: '',
  saveMode: 'draft',
  openEditor: (attachmentId, filename, saveMode = 'draft') => set({ isOpen: true, attachmentId, filename, saveMode }),
  closeEditor: () => set({ isOpen: false, attachmentId: null, filename: '', saveMode: 'draft' }),
}));
