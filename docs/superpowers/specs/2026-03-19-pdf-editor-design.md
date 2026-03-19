# Editor PDF in Chat — Design Spec

**Data:** 2026-03-19
**Versione:** 1.0
**Stato:** Approvato

## Obiettivo

Permettere agli utenti di modificare i file PDF allegati direttamente dalla chat. Quando l'utente richiede la modifica di un PDF (o clicca un pulsante dedicato), si apre un pannello laterale con un editor rich text WYSIWYG che carica il contenuto del PDF convertito.

## Decisioni di Design

| Decisione | Scelta | Motivazione |
|---|---|---|
| Funzionalita editing | Completo (testo, immagini, tabelle, formattazione) | Requisito utente |
| Trigger apertura | Doppio: pulsante manuale + rilevamento automatico AI | Massima flessibilita |
| Layout UI | Pannello laterale slide-in da destra | Chat visibile durante editing |
| Rendering PDF | Conversione via LibreOffice (PDF → HTML) | Performance + costo zero |
| Editor frontend | TipTap (basato su ProseMirror) | WYSIWYG maturo, estensibile, open source |
| Salvataggio | Backend converte HTML → PDF via LibreOffice | Risultato affidabile |

## Architettura

### Flusso Dati

```
1. Utente allega PDF alla chat (attachment esistente)
2. Utente chiede modifica OPPURE clicca "Modifica PDF"
3. Frontend chiama POST /api/tools/pdf-editor/convert con attachmentId
4. Backend: LibreOffice converte PDF → DOCX → HTML
5. Backend restituisce HTML al frontend
6. Frontend apre pannello laterale con TipTap editor caricato con l'HTML
7. Utente modifica il contenuto (testo, immagini, tabelle, formattazione)
8. Utente clicca "Salva PDF"
9. Frontend invia HTML modificato a POST /api/tools/pdf-editor/save
10. Backend: LibreOffice converte HTML → DOCX → PDF
11. Backend salva il PDF come nuovo allegato nella conversazione
12. Frontend chiude il pannello e mostra link al nuovo PDF nella chat
```

### Conversione LibreOffice

Due passaggi di conversione con file temporanei:

**Apertura (PDF → HTML):**
```bash
soffice --headless --infilter="writer_pdf_import" --convert-to docx /tmp/input.pdf --outdir /tmp/
soffice --headless --convert-to html /tmp/input.docx --outdir /tmp/
```

**Salvataggio (HTML → PDF):**
```bash
soffice --headless --convert-to docx /tmp/edited.html --outdir /tmp/
soffice --headless --convert-to pdf /tmp/edited.docx --outdir /tmp/
```

I file temporanei vengono eliminati dopo ogni operazione.

## Componenti Frontend

### PDFEditorPanel (`frontend/src/components/chat/PDFEditorPanel.tsx`)

Pannello laterale slide-in (55% larghezza su desktop, 100% su mobile).

**Props:**
- `attachmentId: number` — ID dell'allegato PDF da editare
- `filename: string` — nome del file per display
- `onClose: () => void` — callback chiusura pannello
- `onSaved: (newAttachmentId: number) => void` — callback dopo salvataggio

**Stato interno:**
- `htmlContent: string` — HTML convertito dal PDF
- `loading: boolean` — stato caricamento/conversione
- `saving: boolean` — stato salvataggio
- `dirty: boolean` — modifiche non salvate
- `error: string | null` — errore conversione/salvataggio

**Layout:**
1. Header: nome file, pulsante Salva (disabilitato se !dirty), pulsante Chiudi (con conferma se dirty)
2. Toolbar: formattazione TipTap
3. Area editor: TipTap su sfondo bianco tipo foglio
4. Status bar: stato modifica, formato originale

### PDFEditorToolbar (`frontend/src/components/chat/PDFEditorToolbar.tsx`)

Toolbar per TipTap editor.

**Funzionalita:**
- Formattazione testo: bold, italic, underline, strikethrough
- Heading: H1, H2, H3
- Liste: bullet, numerata
- Allineamento: sinistra, centro, destra
- Inserimento: immagine (upload), tabella
- Undo/Redo

### usePDFEditorStore (`frontend/src/hooks/usePDFEditorStore.ts`)

Store Zustand per stato globale dell'editor.

```typescript
interface PDFEditorState {
  isOpen: boolean;
  attachmentId: number | null;
  filename: string;
  openEditor: (attachmentId: number, filename: string) => void;
  closeEditor: () => void;
}
```

### Trigger Detection

**Pulsante manuale:**
Nel rendering degli allegati PDF in `ChatMessageList.tsx`, aggiungere un pulsante "Modifica" accanto al pulsante "Scarica" esistente per i file `.pdf`.

**Trigger automatico AI:**
Regex nel rendering dei messaggi per rilevare il marker:
```
<!-- pdf_editor:attachmentId=(\d+),filename=(.+?) -->
```
Quando rilevato, chiamare `usePDFEditorStore.getState().openEditor(attachmentId, filename)`.

### Integrazione in ChatPage

`ChatPage.tsx` renderizza `PDFEditorPanel` condizionalmente:
```tsx
{pdfEditor.isOpen && (
  <PDFEditorPanel
    attachmentId={pdfEditor.attachmentId}
    filename={pdfEditor.filename}
    onClose={pdfEditor.closeEditor}
    onSaved={(newId) => { /* aggiunge messaggio con link al nuovo PDF */ }}
  />
)}
```

La chat si riduce al 45% della larghezza quando il pannello e aperto.

## Componenti Backend

### Endpoint: POST /api/tools/pdf-editor/convert

**Input:** `{ attachmentId: number }`

**Logica:**
1. Verificare che l'allegato esista e appartenga all'utente
2. Verificare che sia un file PDF (MIME type)
3. Copiare il file in una directory temporanea
4. Eseguire LibreOffice: PDF → DOCX → HTML
5. Leggere l'HTML risultante
6. Pulire i file temporanei
7. Restituire `{ html: string, filename: string }`

**Errori:**
- 404: allegato non trovato
- 400: file non e un PDF
- 500: errore di conversione LibreOffice
- 413: file troppo grande (limite: 50MB)

### Endpoint: POST /api/tools/pdf-editor/save

**Input:** `{ attachmentId: number, html: string, filename?: string }`

**Limite body:** 100MB (per gestire HTML con immagini base64 embedded). Configurare `bodyLimit` sulla route Fastify.

**Logica:**
1. Verificare che l'allegato originale esista e appartenga all'utente
2. Scrivere l'HTML in un file temporaneo
3. Eseguire LibreOffice: HTML → DOCX → PDF
4. Salvare il PDF risultante come nuovo allegato nella stessa conversazione
5. Pulire i file temporanei
6. Restituire `{ attachmentId: number, filename: string, size: number }`

**Il PDF originale non viene modificato** — si crea sempre un nuovo allegato.

### Route Registration

Nuove route registrate nel modulo `tools`:
```typescript
// In backend/src/modules/tools/routes.ts
fastify.post('/tools/pdf-editor/convert', { preHandler: [authenticate] }, convertHandler);
fastify.post('/tools/pdf-editor/save', { preHandler: [authenticate] }, saveHandler);
```

### Gestione File Temporanei

- Directory: `/tmp/pdf-editor-{userId}-{timestamp}/`
- Cleanup: dopo ogni operazione (try/finally)
- Cleanup residui: on-demand all'avvio di ogni nuova conversione — eliminare directory in `/tmp/pdf-editor-*` piu vecchie di 30 minuti. Nessun cron necessario.

## Librerie

### Frontend (nuove dipendenze)

```json
{
  "@tiptap/react": "^2.x",
  "@tiptap/starter-kit": "^2.x",
  "@tiptap/extension-image": "^2.x",
  "@tiptap/extension-table": "^2.x",
  "@tiptap/extension-table-row": "^2.x",
  "@tiptap/extension-table-cell": "^2.x",
  "@tiptap/extension-table-header": "^2.x",
  "@tiptap/extension-underline": "^2.x",
  "@tiptap/extension-text-align": "^2.x"
}
```

### Backend

Nessuna nuova dipendenza. LibreOffice e gia installato nel Docker image del backend.

## Limitazioni Note

1. **Formattazione complessa** — layout multi-colonna, font custom, margini precisi possono non essere preservati al 100% nella conversione
2. **PDF scansionati** — PDF che contengono solo immagini (scansioni) non possono essere editati come testo. Rilevamento: se l'HTML convertito da LibreOffice contiene solo tag `<img>` senza testo significativo (< 50 caratteri di testo puro), restituire errore 422 con messaggio "Il PDF sembra essere una scansione e non contiene testo editabile"
3. **File grandi** — la conversione di PDF molto grandi (>50 pagine) potrebbe richiedere diversi secondi. Mostrare indicatore di progresso
4. **Concorrenza** — un solo utente alla volta puo editare un allegato (lock non necessario perche ogni salvataggio crea un nuovo allegato)
5. **Immagini nel PDF** — le immagini vengono estratte e incluse nell'HTML come data URI base64 (non riferimenti a file temporanei) per garantire che siano disponibili al momento del salvataggio

## Sicurezza

- Autenticazione JWT richiesta su entrambi gli endpoint
- Verifica ownership dell'allegato (l'utente deve essere il proprietario della conversazione)
- Sanitizzazione HTML in ingresso sul save (prevenire XSS)
- Limite dimensione file: 50MB
- Rate limiting sugli endpoint di conversione (operazione CPU-intensive)
- File temporanei con permessi restrittivi (0600)

## Gestione Sessione Scaduta

Se il JWT scade mentre l'editor e aperto con modifiche non salvate (`dirty: true`), l'interceptor axios gestisce il refresh automaticamente. Se il refresh fallisce, mostrare un avviso all'utente prima del redirect al login: "Hai modifiche non salvate nell'editor PDF. Copia il contenuto prima di procedere." L'HTML editato viene preservato nel DOM di TipTap finche la pagina non viene scaricata.

## Mobile

Su schermi < 768px, il pannello editor si apre al 100% della larghezza (overlay sulla chat) con un pulsante "Torna alla Chat" nel header.
