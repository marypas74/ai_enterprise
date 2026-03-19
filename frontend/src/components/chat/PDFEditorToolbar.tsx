import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Underline, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight,
  Image, Table,
  Undo2, Redo2,
} from 'lucide-react';
import clsx from 'clsx';

interface PDFEditorToolbarProps {
  editor: Editor | null;
}

export default function PDFEditorToolbar({ editor }: PDFEditorToolbarProps) {
  if (!editor) return null;

  const btnClass = (active: boolean) => clsx(
    'p-1.5 rounded transition-colors',
    active
      ? 'bg-primary-600 text-white'
      : 'bg-surface-700 text-surface-300 hover:bg-surface-600 hover:text-white'
  );

  const separator = <div className="w-px h-6 bg-surface-600 mx-1" />;

  const addImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          editor.chain().focus().setImage({ src: reader.result }).run();
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const addTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  return (
    <div className="flex items-center gap-1 p-2 border-b border-surface-700 flex-wrap">
      <button className={btnClass(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Grassetto">
        <Bold className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Corsivo">
        <Italic className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive('underline'))} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sottolineato">
        <Underline className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive('strike'))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Barrato">
        <Strikethrough className="w-4 h-4" />
      </button>

      {separator}

      <button className={btnClass(editor.isActive('heading', { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Titolo 1">
        <Heading1 className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Titolo 2">
        <Heading2 className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive('heading', { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Titolo 3">
        <Heading3 className="w-4 h-4" />
      </button>

      {separator}

      <button className={btnClass(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista puntata">
        <List className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerata">
        <ListOrdered className="w-4 h-4" />
      </button>

      {separator}

      <button className={btnClass(editor.isActive({ textAlign: 'left' }))} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Allinea a sinistra">
        <AlignLeft className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive({ textAlign: 'center' }))} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Centra">
        <AlignCenter className="w-4 h-4" />
      </button>
      <button className={btnClass(editor.isActive({ textAlign: 'right' }))} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Allinea a destra">
        <AlignRight className="w-4 h-4" />
      </button>

      {separator}

      <button className={btnClass(false)} onClick={addImage} title="Inserisci immagine">
        <Image className="w-4 h-4" />
      </button>
      <button className={btnClass(false)} onClick={addTable} title="Inserisci tabella">
        <Table className="w-4 h-4" />
      </button>

      {separator}

      <button className={btnClass(false)} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Annulla"
        style={{ opacity: editor.can().undo() ? 1 : 0.4 }}>
        <Undo2 className="w-4 h-4" />
      </button>
      <button className={btnClass(false)} onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Ripeti"
        style={{ opacity: editor.can().redo() ? 1 : 0.4 }}>
        <Redo2 className="w-4 h-4" />
      </button>
    </div>
  );
}
