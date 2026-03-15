# Document Mode Empty State Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing document mode empty state with a clear, two-variant CTA that guides users to upload or select documents.

**Architecture:** Modify the RAG empty state in ChatMessageList.tsx to branch on `documents.length` (Variant A: no docs → navigate to /documents) vs `selectedDocumentIds.length === 0` (Variant B: docs exist → select all). Remove the redundant pulsing "Carica documenti ora" button from ChatInputArea.tsx.

**Tech Stack:** React 18, Tailwind CSS, Lucide React icons, react-router-dom, Zustand (useDocumentStore)

**Spec:** `docs/superpowers/specs/2026-03-15-document-mode-empty-state-redesign.md`

---

## Chunk 1: Implementation

### Task 1: Update ChatMessageList.tsx — Two-variant RAG empty state

**Files:**
- Modify: `frontend/src/components/chat/ChatMessageList.tsx:1-143`

- [ ] **Step 1: Add new imports**

Add `useNavigate` from react-router-dom and `FileCheck` from lucide-react to the existing imports. `FileText` is already imported.

In `ChatMessageList.tsx`, update the import block:

```tsx
// Add to the lucide-react import (line 2-13):
import {
  Brain,
  Paperclip,
  Database,
  ExternalLink,
  Globe,
  User,
  ChevronDown,
  Download,
  FileText,
  FileCheck,
  Loader2,
} from 'lucide-react';

// Add after line 17 (after clsx import):
import { useNavigate } from 'react-router-dom';
```

- [ ] **Step 2: Add documents and selectedDocumentIds to store destructuring**

In the component body (line 128), update the store destructuring:

```tsx
// Replace line 128:
const { chatMode } = useDocumentStore();

// With:
const { chatMode, documents, selectedDocumentIds, selectAllDocuments } = useDocumentStore();
```

- [ ] **Step 3: Add useNavigate hook**

After the store destructuring, add:

```tsx
const navigate = useNavigate();
```

- [ ] **Step 4: Replace the RAG empty state block**

Replace lines 132-143 (the `if (isRagMode)` block inside `if (messages.length === 0)`) with the two-variant empty state:

```tsx
    if (isRagMode) {
      const hasDocuments = documents.length > 0;

      if (!hasDocuments) {
        // Variant A: No documents uploaded
        return (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 animate-in fade-in duration-700">
            <div className="w-20 h-20 rounded-3xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-8 border border-indigo-600/20">
              <FileText className="w-10 h-10 text-indigo-500 dark:text-indigo-400" />
            </div>
            <h2 className="text-3xl font-bold mb-3 tracking-tight">Carica i tuoi documenti</h2>
            <p className="text-surface-500 max-w-md text-lg leading-relaxed mb-8">
              Carica documenti per analizzarli con l'AI
            </p>
            <button
              onClick={() => navigate('/documents')}
              aria-label="Vai ai Documenti"
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white font-semibold text-base transition-colors"
            >
              Vai ai Documenti
            </button>
          </div>
        );
      }

      // Variant B: Documents exist but none selected
      if (selectedDocumentIds.length === 0) {
        const readyCount = documents.filter(d => d.status === 'ready').length;

        // Sub-case: all documents still processing/failed
        if (readyCount === 0) {
          return (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 animate-in fade-in duration-700">
              <div className="w-20 h-20 rounded-3xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-8 border border-indigo-600/20">
                <Loader2 className="w-10 h-10 text-indigo-500 dark:text-indigo-400 animate-spin" />
              </div>
              <h2 className="text-3xl font-bold mb-3 tracking-tight">Elaborazione in corso</h2>
              <p className="text-surface-500 max-w-md text-lg leading-relaxed">
                I documenti sono ancora in fase di elaborazione. Saranno disponibili a breve.
              </p>
            </div>
          );
        }

        return (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 animate-in fade-in duration-700">
            <div className="w-20 h-20 rounded-3xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-8 border border-indigo-600/20">
              <FileCheck className="w-10 h-10 text-indigo-500 dark:text-indigo-400" />
            </div>
            <h2 className="text-3xl font-bold mb-3 tracking-tight">Seleziona i documenti da analizzare</h2>
            <p className="text-surface-500 max-w-md text-lg leading-relaxed mb-8">
              Hai {readyCount} document{readyCount === 1 ? 'o' : 'i'} disponibil{readyCount === 1 ? 'e' : 'i'}. Selezionali per iniziare l'analisi.
            </p>
            <button
              onClick={selectAllDocuments}
              aria-label="Seleziona Tutti"
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white font-semibold text-base transition-colors"
            >
              Seleziona Tutti
            </button>
          </div>
        );
      }

      // Documents selected — show standard empty chat (user can start asking)
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-4 animate-in fade-in duration-700">
          <div className="w-20 h-20 rounded-3xl bg-indigo-600/10 flex items-center justify-center mb-8 border border-indigo-600/20 text-indigo-600">
            <FileText className="w-10 h-10" />
          </div>
          <h2 className="text-3xl font-bold mb-3 tracking-tight">Analisi Documenti</h2>
          <p className="text-surface-500 max-w-md text-lg leading-relaxed">
            {selectedDocumentIds.length} document{selectedDocumentIds.length === 1 ? 'o' : 'i'} selezionat{selectedDocumentIds.length === 1 ? 'o' : 'i'}. Scrivi una domanda per iniziare l'analisi.
          </p>
        </div>
      );
    }
```

- [ ] **Step 5: Verify the file builds**

Run:
```bash
cd /home/marcello/enterprise-ai-chat/frontend && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors in ChatMessageList.tsx

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/ChatMessageList.tsx
git commit -m "feat: redesign document mode empty state with two-variant CTA

Variant A (no docs): guides user to /documents page
Variant B (docs exist, none selected): select all button
Variant C (docs selected): shows count and invites questions"
```

---

### Task 2: Remove redundant "Carica documenti ora" button from ChatInputArea.tsx

**Files:**
- Modify: `frontend/src/components/chat/ChatInputArea.tsx:150-162`

- [ ] **Step 1: Remove the pulsing upload button**

In `ChatInputArea.tsx`, remove lines 153-161 (the `{isRagMode && hasNoDocs && (...)}` block). The resulting `<div>` at line 150 becomes:

```tsx
        {/* RAG Mode Toggle */}
        <div className="flex items-center mb-4">
          <RagModeToggle onModeChange={onModeChange} />
        </div>
```

Note: `justify-between` is no longer needed since there's only one child.

- [ ] **Step 2: Verify the file builds**

Run:
```bash
cd /home/marcello/enterprise-ai-chat/frontend && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors in ChatInputArea.tsx

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/chat/ChatInputArea.tsx
git commit -m "fix: remove redundant 'Carica documenti ora' pulsing button

The new empty state CTA in ChatMessageList handles this flow now"
```

---

### Task 3: Manual verification

- [ ] **Step 1: Build the frontend**

```bash
cd /home/marcello/enterprise-ai-chat/frontend && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Visual verification checklist**

Open `plane.lushlolli.com` in browser and verify:

1. Switch to "Documenti" mode with NO documents uploaded → see Variant A (FileText icon + "Carica i tuoi documenti" + "Vai ai Documenti" button)
2. Click "Vai ai Documenti" → navigates to `/documents` page
3. Upload a document, wait for processing to complete
4. Return to chat in "Documenti" mode with no docs selected → see Variant B (FileCheck icon + "Seleziona i documenti da analizzare" + "Seleziona Tutti" button + document count)
5. Click "Seleziona Tutti" → documents get selected, empty state changes to show selected count
6. Verify the old pulsing "Carica documenti ora" button is gone from the input area
7. Verify dark mode works for both variants
8. Verify "Chat Libera" and "Brainstorming" modes are unaffected
