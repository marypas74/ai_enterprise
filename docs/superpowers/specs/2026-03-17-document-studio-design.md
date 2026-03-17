# Document Studio — Suite Documentale Completa

**Data:** 2026-03-17
**Stato:** Approvato
**Approccio:** MuPDF.js (WASM) + pdf-lib + Ollama Vision AI

## Sommario

Suite documentale completa ispirata a Wondershare PDFelement, integrata nell'app enterprise-ai-chat. Tutte le operazioni sono invocabili via chat tramite AI tool calling. Un widget PDF editor interattivo (MuPDF.js WASM) appare inline nella conversazione per editing visuale, annotazioni, form e firma.

## Requisiti

- **Interfaccia:** Chat-first — l'AI esegue operazioni via tool calling
- **Editor visuale:** Widget MuPDF.js inline nella chat per editing interattivo
- **Editing PDF:** Editing reale del testo/immagini nel PDF (non ricostruzione)
- **Annotazioni/form:** AI-driven + editor interattivo inline
- **Firma:** Semplice (immagine/disegno) + certificata (X.509/PAdES)
- **Utenti simultanei:** Fino a 10 (operazioni sincrone accettabili)
- **Licenze:** Solo open-source/gratuite
- **AGPL compliance:** MuPDF.js e mupdf npm sono AGPL. L'applicazione e ad uso interno enterprise (non distribuita), quindi AGPL e compatibile. Se in futuro l'app venisse distribuita o offerta come SaaS a terzi, sara necessaria licenza commerciale Artifex.
- **Stack:** MuPDF.js (AGPL, frontend WASM), pdf-lib (MIT, backend), mupdf npm (AGPL, backend WASM), node-forge (MIT, firma certificata)

## Architettura

### Stack tecnologico

| Componente | Libreria | Licenza | Uso |
|-----------|----------|---------|-----|
| Viewer/editor frontend | MuPDF.js WebViewer | AGPL | Rendering, editing, annotazioni client-side |
| Manipolazione backend | pdf-lib | MIT | Merge, split, compress, rotate, form fill |
| Editing/OCR backend | mupdf (npm WASM) | AGPL | Editing testo, render pagine, estrazione strutturata |
| Conversioni Office | LibreOffice headless | MPL | DOCX/XLSX/PPTX ↔ PDF |
| OCR | Ollama Vision + Tesseract.js | Open | OCR strutturato con fallback |
| Generazione DOCX | docx (npm) | MIT | Ricostruzione DOCX da struttura estratta |
| Generazione XLSX | ExcelJS | MIT | Tabelle estratte → Excel |
| Generazione PPTX | PptxGenJS | MIT | Pagine PDF → slide |
| Firma certificata | node-forge | BSD | X.509, PKCS#7/CMS, PAdES |
| Compressione immagini | sharp | Apache 2.0 | Resize immagini per compressione PDF |

### Struttura moduli

```
backend/src/
├── services/
│   └── document-processing/
│       ├── PDFManipulationService.ts    ← Fase 1: merge/split/compress/rotate
│       ├── PDFConversionService.ts      ← Fase 2: conversioni qualita
│       ├── PDFEditingService.ts         ← Fase 3: editing testo/immagini server-side
│       ├── PDFAnnotationService.ts      ← Fase 4: annotazioni programmatiche
│       ├── PDFSecurityService.ts        ← Fase 4: password/redazione
│       ├── PDFSignatureService.ts       ← Fase 5: firma digitale
│       ├── OCRService.ts               ← Esistente (migliorato in Fase 2)
│       ├── ConversionService.ts         ← Esistente (sostituito in Fase 2)
│       ├── DocumentGenerationService.ts ← Esistente
│       └── OfficeExtractionService.ts   ← Esistente
│
├── modules/tools/
│   └── DocumentTools.ts                 ← Tool AI esistenti + nuovi tool per ogni fase

frontend/src/
├── components/
│   └── chat/
│       └── PDFEditorWidget/
│           ├── PDFEditorWidget.tsx       ← Container principale
│           ├── PDFToolbar.tsx            ← Barra strumenti
│           ├── PDFAnnotationLayer.tsx    ← Fase 4
│           ├── PDFFormLayer.tsx          ← Fase 4
│           ├── PDFSignatureDialog.tsx    ← Fase 5
│           └── usePDFEditor.ts          ← Hook stato editor
```

### Flusso dati

**Operazioni AI-driven (merge, split, conversioni, editing programmatico):**
```
Utente (chat) → AI interpreta richiesta → Tool call → Backend service
                                                         ↓
                                              PDF modificato/generato
                                                         ↓
                                              Salvato in /app/attachments/
                                                         ↓
                                              Link download + widget preview nella chat
```

**Operazioni interattive (annotazioni, editing visuale):**
```
Utente (chat) → AI apre widget → MuPDF.js WASM (client-side)
                                       ↓
                              Utente edita nel browser
                                       ↓
                              Salva → Upload PDF modificato → Backend
```

---

## Fase 1: Manipolazione PDF

**Dipendenza:** pdf-lib (nuova dipendenza da aggiungere — puro JS, zero dipendenze native)

### AI Tool

| Tool | Parametri | Descrizione |
|------|-----------|-------------|
| `pdf_manipulate` | `attachment_id(s)`, `action: "merge"\|"split"\|"compress"\|"rotate"\|"reorder"\|"info"`, `pages?`, `degrees?`, `quality?`, `order?`, `output_name?` | Operazioni di manipolazione PDF (merge, split, compress, rotate, reorder, info) |

### PDFManipulationService.ts

**Operazioni:**
- **Merge:** carica N documenti con `PDFDocument.load()`, copia pagine con `copyPages()`
- **Split:** crea nuovo `PDFDocument`, copia solo le pagine richieste
- **Compress:** Fase 1 (solo pdf-lib): rimozione metadata, flatten annotations, rimozione oggetti duplicati. Compressione immagini avanzata (re-encode DPI) spostata a Fase 2 quando mupdf e disponibile (pdf-lib ha supporto limitato per estrazione/re-encoding immagini embedded)
- **Rotate:** `page.setRotation(degrees(N))` per ogni pagina target
- **Reorder:** crea nuovo documento, copia pagine nell'ordine specificato
- **Info:** `doc.getPageCount()`, `doc.getTitle()`, `doc.getAuthor()`, dimensione file

**Compressione per livello:**

| Livello | Immagini DPI | Rimozione metadata | Risultato tipico |
|---------|-------------|-------------------|-----------------|
| `high` | Originale | Solo duplicati | -10-20% |
| `medium` | 150 DPI (richiede mupdf, Fase 2) | Si | -40-60% (PDF con immagini) |
| `low` | 72 DPI (richiede mupdf, Fase 2) | Si + flatten annotations | -60-80% (PDF con immagini) |

**Nota:** I risultati di compressione variano significativamente in base al contenuto. PDF con molte immagini vedranno riduzioni importanti; PDF prevalentemente testuali avranno riduzioni minime (5-15%). L'AI informera l'utente del risultato effettivo.

**Validazioni:**
- Verifica attachment_ids esistano e siano PDF
- Verifica permessi utente su ogni attachment
- Max 50 PDF per merge, max 100MB totale
- Pagine valide per split/rotate (non fuori range)
- Lock a livello di attachment: un solo utente alla volta puo modificare un attachment (lock advisory con timeout 5 minuti)

---

## Fase 2: Conversioni di Qualita

**Dipendenze:** mupdf (Node WASM), Ollama Vision, LibreOffice, docx, ExcelJS, PptxGenJS

### AI Tool

| Tool | Parametri | Descrizione |
|------|-----------|-------------|
| `convert_pdf_to_docx` | `attachment_id`, `method: "smart"\|"ocr"\|"layout"` | PDF→DOCX con 3 strategie |
| `convert_pdf_to_xlsx` | `attachment_id`, `pages?: string`, `method: "auto"\|"vision"` | PDF→Excel (tabelle) |
| `convert_pdf_to_pptx` | `attachment_id` | PDF→PowerPoint (pagina=slide) |
| `convert_pdf_to_images` | `attachment_id`, `format: "png"\|"jpg"`, `dpi?: number`, `pages?: string` | PDF→Immagini |
| `convert_image_to_pdf` | `attachment_ids: number[]` | Immagini→PDF singolo |
| `convert_office_to_pdf` | `attachment_id` | DOCX/XLSX/PPTX→PDF (esistente, migliorato) |

### PDFConversionService.ts — Strategie

#### PDF→DOCX

**`smart` (default):** Pipeline intelligente a 3 fasi
1. mupdf: estrae struttura (testo + posizioni + font + tabelle)
2. Ollama Vision: analizza ogni pagina per identificare layout (colonne, tabelle, intestazioni, liste)
3. docx (npm): ricostruisce DOCX preservando heading levels, tabelle, liste, colonne, font originali

**`ocr`:** Per PDF scannati/immagine
1. mupdf: render pagine a PNG (300 DPI)
2. Ollama Vision: OCR strutturato con prompt per preservare tabelle/heading
3. docx: ricostruzione con formattazione dedotta

**`layout`:** Per documenti dove il layout visivo e critico
1. mupdf: render pagine a PNG ad alta risoluzione
2. Ogni pagina diventa immagine inline nel DOCX
3. Sotto ogni immagine: testo OCR hidden/selezionabile (accessibilita)

#### PDF→XLSX
1. mupdf: estrae testo con coordinate (x, y, width, height)
2. Algoritmo clustering: raggruppa testo in righe/colonne per allineamento coordinate
3. Ollama Vision (fallback): analizza pagina e restituisce JSON tabellare
4. ExcelJS: genera XLSX con fogli separati per tabella, header auto-detect, tipi dato inferiti, column width auto-fit

#### PDF→PPTX
1. mupdf: render ogni pagina come PNG (1920x1080)
2. PptxGenJS: slide con background = immagine pagina, testo nelle speaker notes

#### PDF→Immagini
1. mupdf: render pagine a PNG/JPG con DPI specificato (default 150)
2. ZIP se multiple pagine, singolo file se una pagina

### Migrazione da ConversionService esistente

L'attuale `ConversionService.ts` usa pdf2docx (Python) + LibreOffice fallback per PDF→DOCX. Strategia di migrazione:
1. `PDFConversionService.ts` implementa i nuovi metodi (smart/ocr/layout)
2. L'esistente `convertPdfToDocx()` in `ConversionService.ts` viene ri-esportata come alias che chiama `PDFConversionService.convertToDocx(id, 'smart')`
3. La dipendenza Python pdf2docx viene rimossa dal Dockerfile dopo validazione dei nuovi metodi
4. I caller esistenti (streaming.ts, upload.ts) vengono aggiornati per usare i nuovi tool

### Miglioramento OCR Pipeline

- Sostituzione pdftoppm con mupdf per render pagine (elimina dipendenza poppler-utils)
- Prompt OCR strutturato: output Markdown con tabelle, heading, liste
- Confidence score: se <0.6 fallback Tesseract
- Cache risultati OCR per attachment_id

### Validazioni
- Max 200 pagine per conversione, max 100MB per file
- Timeout: 5 minuti per conversione
- Queue asincrona con notifica completamento via WebSocket

---

## Fase 3: Viewer/Editor PDF Interattivo

**Dipendenze:** MuPDF.js WebViewer (frontend WASM), mupdf npm (backend)

### AI Tool

| Tool | Parametri | Descrizione |
|------|-----------|-------------|
| `edit_pdf_text` | `attachment_id`, `page`, `search_text`, `new_text`, `font_size?`, `font?` | Trova e sostituisce testo. **Nota per l'AI:** funziona bene per sostituzioni semplici (parole, frasi brevi). Per riscritture pesanti o re-flow di paragrafi, suggerire PDF→DOCX→modifica→PDF. |
| `add_pdf_text` | `attachment_id`, `page`, `x`, `y`, `text`, `font_size?`, `color?` | Aggiunge testo in posizione |
| `add_pdf_image` | `attachment_id`, `page`, `image_attachment_id`, `x`, `y`, `width`, `height` | Inserisce immagine |
| `remove_pdf_page` | `attachment_id`, `pages: string` | Rimuove pagine |
| `add_pdf_watermark` | `attachment_id`, `text`, `opacity?`, `rotation?`, `pages?: string` | Watermark |
| `open_pdf_editor` | `attachment_id` | Apre widget editor interattivo nella chat |

### PDFEditingService.ts (Backend — mupdf WASM)

- **Trova e sostituisci:** `page.search(text)` → coordinate → cancella area → ridisegna con nuovo testo
- **Aggiungi testo:** `page.insertText(point, text, font, size)`
- **Aggiungi immagine:** `page.insertImage(rect, imageBuffer)`
- **Watermark:** per ogni pagina, testo semitrasparente centrato e ruotato
- **Rimuovi pagine:** `document.deletePage(index)`

**Limitazione:** editing testuale reale e complesso (font embedded, kerning, re-flow). Per modifiche semplici (trova/sostituisci, aggiungi testo) funziona bene. Per riscritture pesanti, l'AI suggerira PDF→DOCX→modifica→PDF.

### Frontend: PDFEditorWidget

**Layout widget inline nella chat:**
```
+---------------------------------------------+
| filename.pdf                           [X]   |
| +------------------------------------------+|
| | Toolbar: Select|Text|Image|Zoom|Undo|Save||
| |                                          ||
| |           PDF Page View                  ||
| |          (MuPDF.js WASM)                 ||
| |                                          ||
| |  < Pagina 1 di 12 >       100%          ||
| +------------------------------------------+|
| [Salva modifiche]  [Scarica]                 |
+---------------------------------------------+
```

**Componenti:**

`PDFEditorWidget.tsx` — Container principale
- Carica MuPDF.js WASM (lazy, ~8MB, cached dopo primo load)
- Riceve `attachmentId` come prop
- Fetch PDF dal backend → render nel viewer
- Undo/redo stack (max 50 operazioni)

`PDFToolbar.tsx` — Barra strumenti
- Modalita: Select, Testo, Immagine, Zoom, Navigazione, Undo/Redo, Salva

`usePDFEditor.ts` — Hook di stato
```typescript
interface PDFEditorState {
  documentId: string | null;
  currentPage: number;
  totalPages: number;
  zoom: number;
  mode: 'select' | 'text' | 'image' | 'annotate' | 'form' | 'sign';
  isDirty: boolean;
  undoStack: EditOperation[];
  redoStack: EditOperation[];
  loading: boolean;
}
```

### Lifecycle del widget
1. AI chiama `open_pdf_editor({ attachment_id: 42 })`
2. Backend verifica permessi, restituisce URL firmato per il PDF
3. Frontend renderizza PDFEditorWidget nel flusso chat
4. MuPDF.js WASM caricato (lazy), PDF renderizzato
5. Utente edita nel browser (tutto client-side, zero roundtrip)
6. "Salva modifiche" → MuPDF.js esporta PDF buffer
7. Upload al backend come nuovo attachment (nome_originale_edited.pdf)
8. Messaggio nella chat: "PDF salvato come documento_edited.pdf"

### Caricamento WASM
- Lazy loading: bundle MuPDF.js (~8MB) scaricato solo al primo utilizzo
- Caching: Service Worker o Cache API
- Fallback primario: se WASM init fallisce (OOM, cache corrotta), le operazioni restano disponibili via AI tool calling (eseguite server-side dal backend mupdf)
- Fallback secondario: messaggio "Editor non disponibile, usa i comandi chat" se WASM non supportato
- Loading state: spinner + progress bar

---

## Fase 4: Annotazioni, Form e Sicurezza

**Dipendenze:** MuPDF.js (frontend), mupdf npm (backend), Ollama Vision (smart redaction)

### AI Tool — Annotazioni (consolidati per ridurre il numero totale di tool)

| Tool | Parametri | Descrizione |
|------|-----------|-------------|
| `annotate_pdf` | `attachment_id`, `action: "highlight"\|"note"\|"underline"\|"strikethrough"\|"draw"\|"stamp"\|"remove"`, `page`, `search_text?`, `x?`, `y?`, `text?`, `shape?`, `coords?`, `color?`, `thickness?`, `stamp_type?`, `custom_text?`, `pages?` | Tutte le operazioni di annotazione PDF |

### AI Tool — Form

| Tool | Parametri | Descrizione |
|------|-----------|-------------|
| `pdf_form` | `attachment_id`, `action: "add_field"\|"fill"\|"extract"\|"detect"`, `page?`, `type?`, `name?`, `x?`, `y?`, `width?`, `height?`, `options?`, `fields?` | Gestione form PDF (aggiunta campi, compilazione, estrazione, rilevamento AI) |

### AI Tool — Sicurezza

| Tool | Parametri | Descrizione |
|------|-----------|-------------|
| `pdf_security` | `attachment_id`, `action: "protect"\|"unlock"\|"redact"\|"redact_smart"`, `user_password?`, `owner_password?`, `password?`, `permissions?`, `targets?`, `replacement?`, `types?` | Sicurezza PDF (password, permessi, redazione manuale e smart) |

### PDFAnnotationService.ts
Tipi supportati da MuPDF: Text, Highlight, Underline, StrikeOut, Squiggly, Line, Square, Circle, Polygon, PolyLine, Ink, Stamp, FreeText, Caret.

Per highlight di testo: `page.search(text)` restituisce QuadPoints esatte per posizionare l'annotazione.

### PDFSecurityService.ts
- Password/permessi: MuPDF `document.save("encrypt", userPass, ownerPass, permissions)` — RC4/AES
- Redazione: `page.addRedactAnnotation(rect)` → `page.applyRedactions()` — rimozione permanente irrecuperabile

**Smart redaction (ibrido regex + AI):**
1. Estrai testo con posizioni (mupdf)
2. **Pass 1 — Deterministico (regex):** rileva pattern strutturati con certezza:
   - Email: `/[\w.-]+@[\w.-]+\.\w+/`
   - Telefoni: `/(\+39)?[\s-]?\d{2,4}[\s-]?\d{6,8}/`
   - Codice Fiscale: `/[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/`
   - IBAN: `/IT\d{2}[A-Z]\d{22}/`
   - Partita IVA: `/\d{11}/` (con validazione contesto)
3. **Pass 2 — AI (Ollama):** per PII non strutturato (nomi, indirizzi, aziende). Ollama analizza il testo e identifica entita aggiuntive non catturate dal regex
4. Unione risultati (deduplica), preview all'utente
5. Per ogni entita confermata: `page.search(text)` → `addRedactAnnotation`
6. `applyRedactions()` → contenuto eliminato permanentemente

### detect_pdf_form_fields (AI-powered)
Per PDF non interattivi (form stampati/scannati):
1. mupdf: render pagina come PNG
2. Ollama Vision: identifica campi compilabili (linee vuote, checkbox, aree firma)
3. Per ogni campo: aggiungi form field interattivo via mupdf
4. Risultato: PDF scannato trasformato in PDF con form compilabili

### Frontend — Estensioni widget

`PDFAnnotationLayer.tsx` — Highlight, note, disegno, stamp, lista annotazioni laterale

`PDFFormLayer.tsx` — Campi form come input HTML sovrapposti al PDF (text, checkbox, dropdown, signature)

**Toolbar aggiornata:**
```
[Select] [Text] [Image] | [Highlight] [Note] [Draw] [Stamp] | [Form] | [Redact] | [Lock]
```

### Validazioni
- Redazione: conferma utente obbligatoria (operazione irreversibile)
- Password: minimo 8 caratteri
- Smart redaction: preview aree prima di applicare
- Form fields: nomi unici per campo

---

## Fase 5: Firma Digitale

**Dipendenze:** MuPDF.js (frontend), mupdf npm (backend), node-forge (firma certificata)

### AI Tool

| Tool | Parametri | Descrizione |
|------|-----------|-------------|
| `sign_pdf_simple` | `attachment_id`, `page`, `x`, `y`, `method: "draw"\|"image"\|"text"`, ... | Firma visiva |
| `sign_pdf_certified` | `attachment_id`, `page`, `x`, `y`, `certificate_id`, `reason?`, `location?` | Firma X.509/PAdES |
| `verify_pdf_signatures` | `attachment_id` | Verifica firme (validita, integrita, certificato) |
| `manage_certificates` | `action: "list"\|"import"\|"delete"\|"generate_self_signed"`, ... | Gestione certificati |

### Livello 1 — Firma visiva semplice

Tre modalita:
- **Draw:** disegno firma nel widget (canvas → PNG → overlay nel PDF)
- **Image:** upload immagine firma (PNG/JPG trasparente)
- **Text:** nome in font corsivo (Great Vibes, Dancing Script)

Backend: `mupdf page.insertImage(rect, signatureImage)` + riga "Firmato da: {nome} il {data}"

### Livello 2 — Firma digitale certificata (CMS/X.509, conformance PAdES-B-B)

**Nota tecnica:** L'implementazione mira al livello PAdES-B-B (Basic, il livello minimo PAdES). Questo include firma CMS detached embedded nel PDF con ByteRange, ma NON include timestamp authority (TSA) ne Long-Term Validation (LTV). Per PAdES-B-T (con TSA) o PAdES-B-LT, servira integrazione TSA futura (configurabile via URL). Le firme PAdES-B-B sono verificabili in Adobe/Foxit ma segnalate come "non timestamp-verified".

**Flusso:**
1. Utente importa certificato .p12/.pfx via `manage_certificates` (max 100KB)
2. Certificato salvato criptato nel DB (tabella `user_certificates`)
3. `sign_pdf_certified` chiamato dall'AI
4. Backend:
   a. mupdf: aggiunge signature field vuoto con ByteRange placeholder
   b. Calcola hash SHA-256 del contenuto PDF (escludendo la signature area)
   c. node-forge: crea firma CMS detached (PKCS#7) con chiave privata
   d. Inserisce blob CMS nel PDF signature field
   e. Aggiunge aspetto visivo (nome, data, ragione, icona lucchetto)
5. PDF firmato verificabile in Adobe/Foxit (conformance PAdES-B-B)

### Verifica firme
Per ogni firma nel PDF:
- Verifica firma contro hash documento (integrita)
- Verifica catena certificati (self-signed, CA, scadenza)
- Report: signer, date, reason, valid, integrity, certificate info

### Database — user_certificates

```sql
CREATE TABLE user_certificates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  subject_cn VARCHAR(255),
  issuer_cn VARCHAR(255),
  serial_number VARCHAR(255),
  valid_from DATETIME,
  valid_to DATETIME,
  certificate_pem TEXT NOT NULL,
  private_key_encrypted TEXT NOT NULL,
  key_encryption_iv VARCHAR(64),
  key_encryption_salt VARCHAR(64),
  fingerprint_sha256 VARCHAR(128),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY idx_user_fingerprint (user_id, fingerprint_sha256)
);
```

**Sicurezza chiavi private:**
- Criptata con AES-256-GCM
- Chiave derivata con **PBKDF2** (100.000 iterazioni, SHA-256) da: `ENCRYPTION_KEY` (env) + `user_id` + salt random (32 bytes, salvato in `key_encryption_salt` column)
- Chiave in chiaro solo in memoria durante la firma (zeroed dopo uso)
- Mai loggata, mai esposta via API

### Frontend: PDFSignatureDialog.tsx

Dialog modale con:
- Scelta tipo firma (semplice/certificata)
- Firma semplice: area disegno, upload immagine, o testo corsivo
- Firma certificata: selezione certificato, password, ragione, luogo
- Import nuovo certificato

### Validazioni
- Import certificato: verifica formato .p12/.pfx, max 100KB, richiede password
- Verifica scadenza certificato prima di firmare
- Password certificato mai salvata, richiesta ogni volta
- Rate limit: max 10 firme/minuto per utente

### Audit logging
Operazioni di firma e redazione generano entry nel modulo `activity` esistente:
- `certificate_imported`, `certificate_deleted`
- `pdf_signed_simple`, `pdf_signed_certified`
- `pdf_redacted`, `pdf_redacted_smart`
- `pdf_protected`, `pdf_unlocked`

Ogni entry include: user_id, attachment_id, timestamp, tipo operazione, metadata (es. signer CN per firma).

---

## Riepilogo dipendenze npm

### Backend (nuove)
- `mupdf` — WASM bindings per Node.js (editing, rendering, annotazioni, sicurezza)
- `node-forge` — crittografia, certificati X.509, PKCS#7/CMS
- `sharp` — compressione/resize immagini (potrebbe essere gia presente)

### Frontend (nuove)
- `mupdf` — MuPDF.js WebViewer WASM (viewer/editor interattivo)

### Backend (nuove — Fase 1)
- `pdf-lib` — merge/split/compress/rotate/form fill (NON presente nel progetto, da aggiungere)

### Gia presenti (riutilizzate)
- `docx` — generazione DOCX
- `exceljs` — generazione XLSX
- `pptxgenjs` — generazione PPTX
- `tesseract.js` — OCR fallback

## Ordine di implementazione

| Fase | Prerequisiti | Deliverable |
|------|-------------|-------------|
| 1 | Nessuno | 1 AI tool (pdf_manipulate) con 6 azioni |
| 2 | Fase 1 (infrastruttura) | 6 AI tool per conversioni + OCR migliorato |
| 3 | Fase 2 (mupdf setup) | Widget editor inline + 6 AI tool editing |
| 4 | Fase 3 (widget) | 3 AI tool consolidati (annotate_pdf, pdf_form, pdf_security) |
| 5 | Fase 4 (widget completo) | 4 AI tool firma + certificati |

**Totale: 20 nuovi AI tool (consolidati da 37 per migliore routing AI), 7 nuovi servizi backend, 6 nuovi componenti frontend, 1 nuova tabella DB.**
