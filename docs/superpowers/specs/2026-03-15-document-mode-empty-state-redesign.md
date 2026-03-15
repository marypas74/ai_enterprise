# Document Mode Empty State Redesign

## Problem

When users activate "Modalità Documenti" (Document Analysis Mode) without having uploaded documents, the current empty state screen is unclear. Users don't understand they need to navigate to the Documents page (`/documents`) to upload files before they can use the document analysis chat. The current screen shows a brain icon with generic text and a small "Carica documenti ora" button that doesn't clearly communicate the required action.

## Solution

Redesign the empty state to a single, clear call-to-action that guides users appropriately based on their document state. Remove redundant/confusing upload buttons.

## Design

### Empty State — Two Variants (ChatMessageList.tsx)

The empty state in RAG mode must distinguish between two scenarios:

#### Variant A: No documents uploaded at all (`documents.length === 0`)

- **Icon**: `FileText` from Lucide React, 64x64, indigo color (`text-indigo-500 dark:text-indigo-400`), with circular background (`bg-indigo-50 dark:bg-indigo-900/30`)
- **Title**: "Carica i tuoi documenti"
- **Subtitle**: "Carica documenti per analizzarli con l'AI"
- **Button**: "Vai ai Documenti" — indigo primary style (`bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600`), navigates to `/documents`

#### Variant B: Documents exist but none selected (`documents.length > 0 && selectedDocumentIds.length === 0`)

- **Icon**: `FileCheck` from Lucide React, 64x64, same indigo styling as Variant A
- **Title**: "Seleziona i documenti da analizzare"
- **Subtitle**: "Hai {n} documenti disponibili. Selezionali per iniziare l'analisi."
- **Button**: "Seleziona Tutti" — same indigo primary style, calls `selectAllDocuments()` from the document store

Both variants: vertically centered, stacked layout, `animate-in fade-in duration-700` entrance animation preserved. Button has `aria-label` matching button text.

### Upload Button Removal (ChatInputArea.tsx)

Remove the pulsing "Carica documenti ora" button that appears next to the input when in RAG mode with no documents selected. This button is redundant with the new prominent empty state CTA and causes confusion about where to click.

### Input Placeholder (ChatInputArea.tsx)

Keep the existing placeholder text "Carica documenti per iniziare..." when in RAG mode with no documents. This reinforces the message without adding UI clutter.

### Unchanged Components

- **DocumentsPage.tsx** — no changes, upload/management UI stays as-is
- **RagModeToggle.tsx** — three-mode toggle stays as-is
- **RagModeBadge.tsx** — header badge stays as-is
- **ChatSidebar.tsx** — "Documenti" link stays as-is

## User Flow

### Flow A: No documents uploaded
1. User clicks "Documenti" in the chat mode toggle
2. Sees empty state with document icon and "Vai ai Documenti" button
3. Clicks button, navigates to `/documents`
4. Uploads files via drag & drop or file picker
5. Returns to chat (via sidebar or "Torna alla Chat" button)
6. Documents are available; if none auto-selected, sees Variant B

### Flow B: Documents exist, none selected
1. User clicks "Documenti" in the chat mode toggle
2. Sees empty state with "Seleziona i documenti da analizzare" and count
3. Clicks "Seleziona Tutti" — all documents get selected
4. Empty state disappears, user can start asking questions

## Files to Modify

1. `frontend/src/components/chat/ChatMessageList.tsx` — replace RAG empty state with two variants; add `useNavigate` import from `react-router-dom`
2. `frontend/src/components/chat/ChatInputArea.tsx` — remove "Carica documenti ora" button

## Scope

- 2 files modified
- New imports: `useNavigate` from `react-router-dom` in ChatMessageList.tsx, `FileText` and `FileCheck` from `lucide-react`
- No new components or files
- No backend changes
- No API changes
