# vLLM Vision Document Processing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire il modello vLLM con Qwen2.5-VL-32B-AWQ (vision-language) e aggiungere una pipeline di rendering che converte PDF scansionati in immagini per l'elaborazione nativa da parte del modello.

**Architecture:** Il backend rileva automaticamente se un PDF è testuale o scansionato tramite `DocumentTypeDetector`. Per i documenti scansionati, `PdfPageRenderer` chiama il già-disponibile `convertPdfToImages` (mupdf WASM, `PDFConversionService.ts`) e produce array di base64 PNG. `VisionPipelineService` orchestra il tutto e fa fallback silenzioso al path testuale in caso di errore. `RabbitHoleService` acquisisce un nuovo metodo `ingestFileBuffer()` che usa la pipeline vision prima di chunking/embedding.

**Tech Stack:** TypeScript, Vitest, mupdf WASM (già in stack), pdf-parse (già in stack), OpenAI SDK (già in VLLMProvider), vLLM 0.18+, Docker Compose, MicroK8s.

---

## File Map

| Operazione | File |
|---|---|
| MODIFY | `vllm/docker-compose.yml` |
| MODIFY | `vllm/.env` |
| MODIFY | `backend/src/modules/ai/providers/VLLMProvider.ts` |
| CREATE | `backend/src/services/DocumentTypeDetector.ts` |
| CREATE | `backend/src/services/DocumentTypeDetector.test.ts` |
| CREATE | `backend/src/services/PdfPageRenderer.ts` |
| CREATE | `backend/src/services/PdfPageRenderer.test.ts` |
| CREATE | `backend/src/services/VisionPipelineService.ts` |
| CREATE | `backend/src/services/VisionPipelineService.test.ts` |
| MODIFY | `backend/src/modules/ai/AIProviderFactory.ts` |
| MODIFY | `backend/src/services/RabbitHoleService.ts` |
| MODIFY | `k8s/doc-processor/deployment.yaml` |

---

## Task 1: Backup pre-deploy e salvataggio stato corrente

**Files:**
- Read: `vllm/docker-compose.yml`
- Read: `vllm/.env`

- [ ] **Step 1: Crea directory di backup con timestamp**

```bash
BACKUP_DIR="/tmp/vllm-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp /home/marcello/vllm/docker-compose.yml "$BACKUP_DIR/"
cp /home/marcello/vllm/.env "$BACKUP_DIR/"
echo "Backup salvato in: $BACKUP_DIR"
ls "$BACKUP_DIR"
```

Expected output: `docker-compose.yml  .env`

- [ ] **Step 2: Annota tag e image ID correnti**

```bash
docker inspect vllm --format '{{.Image}}' > /tmp/vllm-backup-$(date +%Y%m%d)/old-image-id.txt
docker exec vllm python3 -c "import vllm; print(vllm.__version__)" >> /tmp/vllm-backup-$(date +%Y%m%d)/old-image-id.txt 2>/dev/null || true
cat /tmp/vllm-backup-*/old-image-id.txt
```

- [ ] **Step 3: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add docs/superpowers/specs/2026-04-14-vllm-vision-document-processing-design.md
git add docs/superpowers/plans/2026-04-14-vllm-vision-document-processing.md
git commit -m "docs: add vision document processing spec and implementation plan"
```

---

## Task 2: Aggiornamento configurazione vLLM

**Files:**
- Modify: `vllm/docker-compose.yml`
- Modify: `vllm/.env`

- [ ] **Step 1: Aggiorna `.env`**

Sostituisci l'intero contenuto di `/home/marcello/vllm/.env` con:

```bash
# HuggingFace token (required for gated models like Llama)
# Get yours at https://huggingface.co/settings/tokens
HF_TOKEN=

# vLLM API key (used for Bearer auth)
VLLM_API_KEY=vllm-local-2026

# Model to serve (HuggingFace model ID)
# Qwen2.5-VL-32B-Instruct-AWQ: Vision-Language model, 32B dense params
# Processes text AND images natively — optimal for document processing
# VRAM: ~22GB (AWQ marlin) + 7GB KV cache GPU + 20GB KV cache CPU offload
VLLM_MODEL=Qwen/Qwen2.5-VL-32B-Instruct-AWQ
SERVED_MODEL_NAME=qwen25vl:32b

# Context length: 128K — covers documents up to ~100+ pages
MAX_MODEL_LEN=131072

# GPU memory utilization (0.0-1.0)
# 0.92 = ~29.4GB on RTX 5090 (32GB)
GPU_MEM_UTIL=0.92

# Inference mode: vllm (primary provider)
INFERENCE_MODE=vllm
```

- [ ] **Step 2: Aggiorna `docker-compose.yml` — sezione command**

Nel file `/home/marcello/vllm/docker-compose.yml`, sostituisci l'intera sezione `command:` con:

```yaml
    command:
      - ${VLLM_MODEL:-Qwen/Qwen2.5-VL-32B-Instruct-AWQ}
      - --dtype=bfloat16
      - --quantization=awq_marlin
      - --gpu-memory-utilization=${GPU_MEM_UTIL:-0.92}
      - --max-model-len=${MAX_MODEL_LEN:-131072}
      - --cpu-offload-gb=20
      - --kv-cache-dtype=fp8
      - --tensor-parallel-size=1
      - --host=0.0.0.0
      - --port=8000
      - --api-key=${VLLM_API_KEY:-vllm-local-2026}
      - --served-model-name=${SERVED_MODEL_NAME:-qwen25vl:32b}
      - --enable-prefix-caching
      - --limit-mm-per-prompt=image=50
      - --mm-processor-kwargs={"max_pixels":1003520}
      - --max-num-batched-tokens=8192
```

- [ ] **Step 3: Aggiorna healthcheck `start_period` a 900s**

Nel file `docker-compose.yml`, la sezione `healthcheck:` deve diventare:

```yaml
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 900s
```

- [ ] **Step 4: Aggiorna `VLLMProvider` — default `SERVED_MODEL`**

In `backend/src/modules/ai/providers/VLLMProvider.ts`, riga 22, cambia:

```typescript
  private static readonly SERVED_MODEL = process.env.VLLM_SERVED_MODEL || 'qwen3:30b-a3b';
```

in:

```typescript
  private static readonly SERVED_MODEL = process.env.VLLM_SERVED_MODEL || 'qwen25vl:32b';
```

- [ ] **Step 5: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/modules/ai/providers/VLLMProvider.ts
git commit -m "feat: update VLLMProvider default served model to qwen25vl:32b"
```

---

## Task 3: `DocumentTypeDetector` — rilevamento tipo documento

**Files:**
- Create: `backend/src/services/DocumentTypeDetector.ts`
- Create: `backend/src/services/DocumentTypeDetector.test.ts`

- [ ] **Step 1: Scrivi il test (RED)**

Crea `backend/src/services/DocumentTypeDetector.test.ts`:

```typescript
/**
 * Tests for DocumentTypeDetector
 */
import { describe, it, expect } from 'vitest';
import { DocumentTypeDetector } from './DocumentTypeDetector.js';

// Minimal valid PDF with text layer (~200 chars of text)
const TEXT_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmogPDwgL0xlbmd0aCAxMDAgPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgoxMDAgNzAwIFRkCihRdWVzdG8gZSB1biBkb2N1bWVudG8gdGVzdHVhbGUgY29uIGNvbnRlbnV0byBzdWZmaWNpZW50ZSBwZXIgaWwgdGVzdC4pIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI3NCAwMDAwMCBuIAowMDAwMDAwNDI0IDAwMDAwIG4gCnRyYWlsZXIgPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNTAyCiUlRU9G';

describe('DocumentTypeDetector', () => {
  describe('detect — non-PDF files', () => {
    it('classifica DOCX sempre come text', async () => {
      const result = await DocumentTypeDetector.detect(
        Buffer.from('fake docx'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(result.path).toBe('text');
      expect(result.textDensity).toBe(9999);
      expect(result.pageCount).toBe(1);
    });

    it('classifica XLSX sempre come text', async () => {
      const result = await DocumentTypeDetector.detect(
        Buffer.from('fake xlsx'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(result.path).toBe('text');
    });

    it('classifica text/plain sempre come text', async () => {
      const result = await DocumentTypeDetector.detect(
        Buffer.from('contenuto testo'),
        'text/plain',
      );
      expect(result.path).toBe('text');
    });
  });

  describe('detect — PDF testuale', () => {
    it('classifica PDF con testo come text path', async () => {
      const buf = Buffer.from(TEXT_PDF_BASE64, 'base64');
      const result = await DocumentTypeDetector.detect(buf, 'application/pdf');
      // text PDF has sufficient density
      expect(['text', 'hybrid']).toContain(result.path);
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('detect — PDF corrotto/vuoto', () => {
    it('fallback a vision per PDF non leggibile', async () => {
      const result = await DocumentTypeDetector.detect(
        Buffer.from('not a pdf at all'),
        'application/pdf',
      );
      // When pdf-parse fails, should default to vision (safe fallback)
      expect(result.path).toBe('vision');
      expect(result.textDensity).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Esegui il test — verifica che fallisca**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/DocumentTypeDetector.test.ts 2>&1 | tail -10
```

Expected: `FAIL` — `DocumentTypeDetector.ts not found`

- [ ] **Step 3: Implementa `DocumentTypeDetector.ts`**

Crea `backend/src/services/DocumentTypeDetector.ts`:

```typescript
/**
 * DocumentTypeDetector — Rileva se un documento è testuale o scansionato.
 *
 * Usa pdf-parse per estrarre il testo delle prime 5 pagine e calcolare
 * la densità di caratteri per pagina. Sotto la soglia → path vision.
 */

export type DocumentPath = 'text' | 'vision' | 'hybrid';

export interface DetectionResult {
  path: DocumentPath;
  textDensity: number;   // chars/pagina (media prime 5pp)
  pageCount: number;
}

/** Chars/pagina minimi per considerare il documento testuale */
const TEXT_DENSITY_THRESHOLD = 50;
/** Chars/pagina minimi per "hybrid" (testo scarso ma presente) */
const HYBRID_DENSITY_THRESHOLD = 10;

export class DocumentTypeDetector {
  /**
   * Rileva il tipo di documento e restituisce il path di elaborazione ottimale.
   * Non-PDF → sempre 'text'. PDF → analisi densità.
   */
  static async detect(buffer: Buffer, mimeType: string): Promise<DetectionResult> {
    if (mimeType !== 'application/pdf') {
      return { path: 'text', textDensity: 9999, pageCount: 1 };
    }

    try {
      // Importazione dinamica per consistenza con il resto del codebase
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();

      const pageCount = (result.info?.Pages as number | undefined) ?? 1;
      const density = result.text.length / Math.max(pageCount, 1);

      const path: DocumentPath =
        density >= TEXT_DENSITY_THRESHOLD ? 'text' :
        density >= HYBRID_DENSITY_THRESHOLD ? 'hybrid' :
        'vision';

      return { path, textDensity: density, pageCount };
    } catch {
      // PDF corrotto, protetto o non leggibile → fallback sicuro a vision
      return { path: 'vision', textDensity: 0, pageCount: 1 };
    }
  }
}
```

- [ ] **Step 4: Esegui il test — verifica che passi**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/DocumentTypeDetector.test.ts 2>&1 | tail -15
```

Expected: `✓ src/services/DocumentTypeDetector.test.ts (4 tests)`

- [ ] **Step 5: TypeScript check**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx tsc --noEmit 2>&1 | grep -E "DocumentTypeDetector|error" | head -10
```

Expected: nessun output (zero errori)

- [ ] **Step 6: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/services/DocumentTypeDetector.ts backend/src/services/DocumentTypeDetector.test.ts
git commit -m "feat: add DocumentTypeDetector service for PDF text density analysis"
```

---

## Task 4: `PdfPageRenderer` — wrapper mupdf per rendering pagine

**Files:**
- Create: `backend/src/services/PdfPageRenderer.ts`
- Create: `backend/src/services/PdfPageRenderer.test.ts`

- [ ] **Step 1: Scrivi il test (RED)**

Crea `backend/src/services/PdfPageRenderer.test.ts`:

```typescript
/**
 * Tests for PdfPageRenderer
 */
import { describe, it, expect, vi } from 'vitest';
import { PdfPageRenderer } from './PdfPageRenderer.js';

// Mock convertPdfToImages per evitare dipendenza da mupdf nei test
vi.mock('./document-processing/PDFConversionService.js', () => ({
  convertPdfToImages: vi.fn().mockResolvedValue([
    { pageNumber: 1, buffer: Buffer.from('fake-png-page1'), format: 'png' },
    { pageNumber: 2, buffer: Buffer.from('fake-png-page2'), format: 'png' },
    { pageNumber: 3, buffer: Buffer.from('fake-png-page3'), format: 'png' },
  ]),
}));

describe('PdfPageRenderer', () => {
  it('converte PageImage[] in array di stringhe base64', async () => {
    const pages = await PdfPageRenderer.renderToBase64(Buffer.from('fake-pdf'), 50);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toBe(Buffer.from('fake-png-page1').toString('base64'));
    expect(pages[1]).toBe(Buffer.from('fake-png-page2').toString('base64'));
  });

  it('rispetta il limite maxPages', async () => {
    const pages = await PdfPageRenderer.renderToBase64(Buffer.from('fake-pdf'), 2);
    expect(pages).toHaveLength(2);
  });

  it('accetta maxPages=1', async () => {
    const pages = await PdfPageRenderer.renderToBase64(Buffer.from('fake-pdf'), 1);
    expect(pages).toHaveLength(1);
  });

  it('restituisce array vuoto se convertPdfToImages restituisce vuoto', async () => {
    const { convertPdfToImages } = await import('./document-processing/PDFConversionService.js');
    vi.mocked(convertPdfToImages).mockResolvedValueOnce([]);
    const pages = await PdfPageRenderer.renderToBase64(Buffer.from('fake-pdf'), 50);
    expect(pages).toEqual([]);
  });
});
```

- [ ] **Step 2: Esegui il test — verifica che fallisca**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/PdfPageRenderer.test.ts 2>&1 | tail -10
```

Expected: `FAIL` — `PdfPageRenderer.ts not found`

- [ ] **Step 3: Implementa `PdfPageRenderer.ts`**

Crea `backend/src/services/PdfPageRenderer.ts`:

```typescript
/**
 * PdfPageRenderer — Converte pagine PDF in immagini base64.
 *
 * Thin wrapper attorno a convertPdfToImages (mupdf WASM, già disponibile).
 * Restituisce array di stringhe base64 PNG pronte per vLLM vision.
 */
import { convertPdfToImages } from './document-processing/PDFConversionService.js';

export class PdfPageRenderer {
  /**
   * Renderizza le pagine di un PDF in base64 PNG.
   * @param buffer - Buffer del PDF
   * @param maxPages - Numero massimo di pagine (default 50, limite vLLM --limit-mm-per-prompt)
   * @param dpi - Risoluzione (default 150 → ~1MP per A4, sotto il limite max_pixels vLLM)
   * @returns Array di stringhe base64 PNG, una per pagina
   */
  static async renderToBase64(
    buffer: Buffer,
    maxPages = 50,
    dpi = 150,
  ): Promise<string[]> {
    const images = await convertPdfToImages(buffer, 'png', dpi);
    return images
      .slice(0, maxPages)
      .map(img => img.buffer.toString('base64'));
  }
}
```

- [ ] **Step 4: Esegui il test — verifica che passi**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/PdfPageRenderer.test.ts 2>&1 | tail -10
```

Expected: `✓ src/services/PdfPageRenderer.test.ts (4 tests)`

- [ ] **Step 5: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/services/PdfPageRenderer.ts backend/src/services/PdfPageRenderer.test.ts
git commit -m "feat: add PdfPageRenderer — mupdf wrapper for base64 PNG output"
```

---

## Task 5: `VisionPipelineService` — orchestratore con fallback

**Files:**
- Create: `backend/src/services/VisionPipelineService.ts`
- Create: `backend/src/services/VisionPipelineService.test.ts`

- [ ] **Step 1: Scrivi il test (RED)**

Crea `backend/src/services/VisionPipelineService.test.ts`:

```typescript
/**
 * Tests for VisionPipelineService
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VisionPipelineService } from './VisionPipelineService.js';

vi.mock('./DocumentTypeDetector.js', () => ({
  DocumentTypeDetector: {
    detect: vi.fn(),
  },
}));

vi.mock('./PdfPageRenderer.js', () => ({
  PdfPageRenderer: {
    renderToBase64: vi.fn(),
  },
}));

import { DocumentTypeDetector } from './DocumentTypeDetector.js';
import { PdfPageRenderer } from './PdfPageRenderer.js';

const PDF_BUF = Buffer.from('fake-pdf');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VisionPipelineService.prepare', () => {
  it('restituisce path=text e pages=[] per documenti testuali', async () => {
    vi.mocked(DocumentTypeDetector.detect).mockResolvedValue({
      path: 'text', textDensity: 200, pageCount: 5,
    });

    const result = await VisionPipelineService.prepare(PDF_BUF, 'application/pdf');

    expect(result.path).toBe('text');
    expect(result.pages).toEqual([]);
    expect(result.fallbackUsed).toBe(false);
    expect(PdfPageRenderer.renderToBase64).not.toHaveBeenCalled();
  });

  it('renderizza le pagine per documenti vision', async () => {
    vi.mocked(DocumentTypeDetector.detect).mockResolvedValue({
      path: 'vision', textDensity: 2, pageCount: 3,
    });
    vi.mocked(PdfPageRenderer.renderToBase64).mockResolvedValue(['b64p1', 'b64p2', 'b64p3']);

    const result = await VisionPipelineService.prepare(PDF_BUF, 'application/pdf');

    expect(result.path).toBe('vision');
    expect(result.pages).toEqual(['b64p1', 'b64p2', 'b64p3']);
    expect(result.fallbackUsed).toBe(false);
    expect(PdfPageRenderer.renderToBase64).toHaveBeenCalledWith(PDF_BUF, 50, 150);
  });

  it('renderizza le pagine per documenti hybrid', async () => {
    vi.mocked(DocumentTypeDetector.detect).mockResolvedValue({
      path: 'hybrid', textDensity: 25, pageCount: 8,
    });
    vi.mocked(PdfPageRenderer.renderToBase64).mockResolvedValue(['b64p1']);

    const result = await VisionPipelineService.prepare(PDF_BUF, 'application/pdf');

    expect(result.path).toBe('hybrid');
    expect(result.pages).toHaveLength(1);
  });

  it('fa fallback a text se il rendering fallisce', async () => {
    vi.mocked(DocumentTypeDetector.detect).mockResolvedValue({
      path: 'vision', textDensity: 0, pageCount: 4,
    });
    vi.mocked(PdfPageRenderer.renderToBase64).mockRejectedValue(
      new Error('mupdf crash'),
    );

    const result = await VisionPipelineService.prepare(PDF_BUF, 'application/pdf');

    expect(result.path).toBe('text');
    expect(result.pages).toEqual([]);
    expect(result.fallbackUsed).toBe(true);
  });

  it('fa fallback a text se il rendering va in timeout', async () => {
    vi.mocked(DocumentTypeDetector.detect).mockResolvedValue({
      path: 'vision', textDensity: 0, pageCount: 1,
    });
    // Simula timeout: la promise non risolve mai entro il timeout adattivo
    vi.mocked(PdfPageRenderer.renderToBase64).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(['b64']), 60_000)),
    );
    vi.useFakeTimers();

    const preparePromise = VisionPipelineService.prepare(PDF_BUF, 'application/pdf');
    // Avanza di 10s (sopra il timeout min di 3s per 1 pagina)
    vi.advanceTimersByTime(10_000);
    const result = await preparePromise;

    expect(result.fallbackUsed).toBe(true);
    expect(result.pages).toEqual([]);
    vi.useRealTimers();
  });

  it('non chiama renderToBase64 per MIME type non-PDF', async () => {
    vi.mocked(DocumentTypeDetector.detect).mockResolvedValue({
      path: 'text', textDensity: 9999, pageCount: 1,
    });

    const result = await VisionPipelineService.prepare(
      Buffer.from('fake docx'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(result.path).toBe('text');
    expect(PdfPageRenderer.renderToBase64).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Esegui il test — verifica che fallisca**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/VisionPipelineService.test.ts 2>&1 | tail -10
```

Expected: `FAIL` — `VisionPipelineService.ts not found`

- [ ] **Step 3: Implementa `VisionPipelineService.ts`**

Crea `backend/src/services/VisionPipelineService.ts`:

```typescript
/**
 * VisionPipelineService — Orchestratore pipeline vision per documenti.
 *
 * Coordina DocumentTypeDetector → PdfPageRenderer con timeout adattivo
 * e fallback automatico al path testuale in caso di errore.
 */
import { DocumentTypeDetector, type DocumentPath } from './DocumentTypeDetector.js';
import { PdfPageRenderer } from './PdfPageRenderer.js';

export interface VisionPipelineResult {
  /** Array base64 PNG delle pagine; vuoto se path testuale */
  pages: string[];
  /** Path effettivamente usato (dopo eventuale fallback) */
  path: DocumentPath;
  /** Numero di pagine rilevate nel documento */
  pageCount: number;
  /** true se il rendering è fallito e si è usato il fallback testuale */
  fallbackUsed: boolean;
}

/** Secondi per pagina per il timeout adattivo */
const TIMEOUT_PER_PAGE_MS = 3_000;
/** Timeout massimo assoluto per il rendering */
const MAX_TIMEOUT_MS = 120_000;
/** Pagine massime inviate a vLLM (corrisponde a --limit-mm-per-prompt=image=50) */
const MAX_PAGES = 50;
/** DPI di rendering — 150 dpi → ~1MP per A4, sotto il limite max_pixels vLLM */
const RENDER_DPI = 150;

export class VisionPipelineService {
  /**
   * Prepara il documento per l'elaborazione vLLM.
   * Restituisce le pagine come base64 PNG (path vision/hybrid)
   * oppure array vuoto con path='text' per i documenti testuali.
   * Non lancia mai eccezioni: in caso di errore fa fallback a text.
   */
  static async prepare(
    buffer: Buffer,
    mimeType: string,
  ): Promise<VisionPipelineResult> {
    const detection = await DocumentTypeDetector.detect(buffer, mimeType);

    if (detection.path === 'text') {
      return {
        pages: [],
        path: 'text',
        pageCount: detection.pageCount,
        fallbackUsed: false,
      };
    }

    const renderTimeout = Math.min(
      detection.pageCount * TIMEOUT_PER_PAGE_MS,
      MAX_TIMEOUT_MS,
    );

    try {
      const pages = await Promise.race<string[]>([
        PdfPageRenderer.renderToBase64(buffer, MAX_PAGES, RENDER_DPI),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`render timeout after ${renderTimeout}ms`)),
            renderTimeout,
          ),
        ),
      ]);

      return {
        pages,
        path: detection.path,
        pageCount: detection.pageCount,
        fallbackUsed: false,
      };
    } catch {
      // Fallback silenzioso: il chiamante usa il path testuale
      return {
        pages: [],
        path: 'text',
        pageCount: detection.pageCount,
        fallbackUsed: true,
      };
    }
  }
}
```

- [ ] **Step 4: Esegui il test — verifica che passi**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/VisionPipelineService.test.ts 2>&1 | tail -10
```

Expected: `✓ src/services/VisionPipelineService.test.ts (6 tests)`

- [ ] **Step 5: TypeScript check**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx tsc --noEmit 2>&1 | grep -E "VisionPipeline|DocumentType|PdfPage|error" | head -10
```

Expected: nessun output

- [ ] **Step 6: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/services/VisionPipelineService.ts backend/src/services/VisionPipelineService.test.ts
git commit -m "feat: add VisionPipelineService with adaptive timeout and text fallback"
```

---

## Task 6: `AIProviderFactory.buildDocumentMessage()` — messaggi multimodali

**Files:**
- Modify: `backend/src/modules/ai/AIProviderFactory.ts`

- [ ] **Step 1: Aggiungi `buildDocumentMessage` ad `AIProviderFactory`**

In `backend/src/modules/ai/AIProviderFactory.ts`, aggiungi il metodo statico dopo `clearProviders()`:

```typescript
  /**
   * Costruisce un messaggio utente OpenAI-compatible per l'elaborazione documenti.
   *
   * Se pageImages è vuoto → messaggio testuale semplice (path testuale).
   * Se pageImages ha elementi → messaggio multimodale con immagini + testo
   *   (formato OpenAI vision, compatibile con vLLM Qwen2.5-VL).
   *
   * @param prompt - Istruzione per il modello (es. "Riassumi questo documento")
   * @param pageImages - Array di stringhe base64 PNG delle pagine; [] per path testuale
   * @param textContent - Testo estratto (usato solo nel path testuale)
   */
  static buildDocumentMessage(
    prompt: string,
    pageImages: string[],
    textContent?: string,
  ): { role: 'user'; content: string | Array<Record<string, unknown>> } {
    if (pageImages.length === 0) {
      const content = textContent
        ? `${prompt}\n\n${textContent}`
        : prompt;
      return { role: 'user', content };
    }

    const content: Array<Record<string, unknown>> = [
      ...pageImages.map(b64 => ({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${b64}` },
      })),
      { type: 'text', text: prompt },
    ];

    return { role: 'user', content };
  }
```

- [ ] **Step 2: TypeScript check**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx tsc --noEmit 2>&1 | grep -E "AIProviderFactory|error" | head -10
```

Expected: nessun output

- [ ] **Step 3: Test rapido del metodo**

```bash
cd /home/marcello/enterprise-ai-chat/backend
node -e "
import('./src/modules/ai/AIProviderFactory.js').then(({ AIProviderFactory }) => {
  // path testuale
  const msg1 = AIProviderFactory.buildDocumentMessage('Riassumi', [], 'testo del doc');
  console.assert(typeof msg1.content === 'string', 'text path deve essere stringa');
  console.assert(msg1.content.includes('testo del doc'), 'deve includere il testo');

  // path vision
  const msg2 = AIProviderFactory.buildDocumentMessage('Riassumi', ['base64abc']);
  console.assert(Array.isArray(msg2.content), 'vision path deve essere array');
  console.assert(msg2.content.length === 2, 'deve avere immagine + testo');
  console.log('OK: buildDocumentMessage funziona correttamente');
});
" 2>&1
```

Expected: `OK: buildDocumentMessage funziona correttamente`

- [ ] **Step 4: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/modules/ai/AIProviderFactory.ts
git commit -m "feat: add buildDocumentMessage to AIProviderFactory for multimodal vLLM messages"
```

---

## Task 7: Integrazione in `RabbitHoleService` — `ingestFileBuffer()`

**Files:**
- Modify: `backend/src/services/RabbitHoleService.ts`

- [ ] **Step 1: Aggiungi import in cima al file**

In `backend/src/services/RabbitHoleService.ts`, aggiungi agli import esistenti:

```typescript
import { VisionPipelineService } from './VisionPipelineService.js';
import { AIProviderFactory } from '../modules/ai/AIProviderFactory.js';
```

- [ ] **Step 2: Aggiungi il metodo `ingestFileBuffer()`**

Aggiungi questo metodo alla classe `RabbitHoleService`, dopo `ingestFileContent()` (riga ~205):

```typescript
  /**
   * Ingest di un file raw (Buffer + MIME type).
   * Per i PDF: rileva automaticamente se testuale o scansionato.
   * Se scansionato → usa vLLM Qwen2.5-VL per estrarre il testo dalle immagini.
   * Se testuale → path ordinario (chiamante deve passare il testo estratto).
   *
   * @param buffer - Buffer del file
   * @param mimeType - MIME type (es. 'application/pdf')
   * @param extractedText - Testo già estratto (usato se vision non disponibile o non necessaria)
   * @param filename - Nome originale del file
   * @param userId - ID utente
   * @param conversationId - ID conversazione opzionale
   * @param onProgress - Callback di progresso
   */
  async ingestFileBuffer(
    buffer: Buffer,
    mimeType: string,
    extractedText: string,
    filename: string,
    userId: number,
    conversationId?: number,
    onProgress?: ProgressCallback,
  ): Promise<IngestionResult> {
    // Prepara la pipeline vision (rileva tipo e renderizza se necessario)
    const vision = await VisionPipelineService.prepare(buffer, mimeType);

    let contentToIngest = extractedText;

    // Se abbiamo pagine renderizzate, usa vLLM per estrarre il testo
    if (vision.pages.length > 0) {
      try {
        const prompt =
          'Estrai e trascrivi fedelmente tutto il testo visibile in questo documento. ' +
          'Preserva la struttura (titoli, paragrafi, tabelle, elenchi). ' +
          'Non aggiungere commenti o interpretazioni — solo il testo del documento.';

        const message = AIProviderFactory.buildDocumentMessage(prompt, vision.pages);
        const provider = AIProviderFactory.getProvider('qwen25vl:32b', 'vllm');
        const result = await provider.complete([message as any], {
          model: 'qwen25vl:32b',
          temperature: 0.1,
          maxTokens: 8192,
        });

        if (result.content && result.content.length > 50) {
          contentToIngest = result.content;
        }
      } catch {
        // Fallback silenzioso: usa il testo già estratto
      }
    }

    return this.ingestFileContent(contentToIngest, filename, userId, conversationId, onProgress);
  }
```

- [ ] **Step 3: TypeScript check**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx tsc --noEmit 2>&1 | grep -E "RabbitHole|VisionPipeline|error TS" | head -15
```

Expected: nessun output

- [ ] **Step 4: Verifica test suite esistente non rotta**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run src/services/ 2>&1 | tail -20
```

Expected: tutti i test precedenti ancora passano

- [ ] **Step 5: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add backend/src/services/RabbitHoleService.ts
git commit -m "feat: add ingestFileBuffer to RabbitHoleService with vision pipeline integration"
```

---

## Task 8: Aggiornamento risorse K8s doc-processor

**Files:**
- Modify: `k8s/doc-processor/deployment.yaml`

- [ ] **Step 1: Aggiorna i limiti di risorse**

In `k8s/doc-processor/deployment.yaml`, sostituisci la sezione `resources:`:

```yaml
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "4Gi"
              cpu: "2000m"
```

- [ ] **Step 2: Commit**

```bash
cd /home/marcello/enterprise-ai-chat
git add k8s/doc-processor/deployment.yaml
git commit -m "chore: increase doc-processor resource limits for PDF rendering workloads"
```

---

## Task 9: Deploy vLLM con nuovo modello

- [ ] **Step 1: Pull del nuovo modello (download ~22GB — solo la prima volta)**

```bash
cd /home/marcello/vllm
docker pull vllm/vllm-openai:cu130-nightly
```

Expected: immagine aggiornata (già scaricata nel task auto-update precedente)

- [ ] **Step 2: Ferma il container corrente**

```bash
cd /home/marcello/vllm
docker compose stop vllm
docker compose stop vllm-proxy
```

- [ ] **Step 3: Avvia con nuovo modello**

```bash
cd /home/marcello/vllm
docker compose up -d
```

- [ ] **Step 4: Monitora lo startup (modello ~22GB, primo avvio scarica da HuggingFace)**

```bash
docker logs -f vllm 2>&1 | grep -E "INFO|ERROR|Uvicorn|model loaded|Application startup"
# Attendere "Application startup complete." — può richiedere 5-15 minuti al primo avvio (download HF)
# Avvii successivi: ~3-5 minuti (modello in cache nel volume)
```

Expected: `INFO:     Application startup complete.`

- [ ] **Step 5: Verifica health e modello servito**

```bash
curl -sf http://localhost:8000/health && echo "Health: OK"

curl -s http://localhost:8000/v1/models \
  -H "Authorization: Bearer vllm-local-2026" | python3 -m json.tool
```

Expected: `{"id": "qwen25vl:32b", ...}` nel campo `data[0].id`

- [ ] **Step 6: Test rapido inferenza testo**

```bash
curl -s http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer vllm-local-2026" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen25vl:32b",
    "messages": [{"role": "user", "content": "Rispondi con una sola parola: OK"}],
    "max_tokens": 10
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['choices'][0]['message']['content'])"
```

Expected: `OK` (o simile risposta breve)

- [ ] **Step 7: Verifica VRAM e RAM**

```bash
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader
# Expected: ~29000 MiB / 32768 MiB (circa 88-92% VRAM)

free -h | grep Mem
# Expected: RAM usata aumentata di ~20GB rispetto al baseline (cpu-offload)
```

---

## Task 10: Build e deploy backend

- [ ] **Step 1: Build TypeScript backend**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npm run build 2>&1 | tail -5
```

Expected: `Build succeeded` o nessun errore

- [ ] **Step 2: Run test suite completa**

```bash
cd /home/marcello/enterprise-ai-chat/backend
npx vitest run 2>&1 | tail -20
```

Expected: tutti i test passano, copertura ≥ 80%

- [ ] **Step 3: Version bump (obbligatorio ad ogni deploy)**

Incrementa la versione in tutti i file richiesti dalla checklist MEMORY.md.
Versione corrente: `2.1.53` → nuova: `2.1.54`

```bash
# Verifica versione corrente
grep -rn "2.1.53" /home/marcello/enterprise-ai-chat --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yaml" --include="*.yml" | grep -v node_modules | grep -v dist | grep -v package-lock
```

Aggiorna tutti i file trovati con `2.1.54`, poi esegui:

```bash
grep -rn "2.1.53" /home/marcello/enterprise-ai-chat --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yaml" --include="*.yml" | grep -v node_modules | grep -v dist
# Expected: nessun output (zero occorrenze rimanenti)
```

- [ ] **Step 4: Build Docker e push al registry**

```bash
cd /home/marcello/enterprise-ai-chat
sudo bash BUILD.sh 2>&1 | tail -30
```

- [ ] **Step 5: Deploy K8s backend**

```bash
# Scale a 0
sudo microk8s kubectl scale deployment backend -n enterprise-ai-chat --replicas=0
sudo microk8s kubectl scale deployment frontend -n enterprise-ai-chat --replicas=0
sudo microk8s kubectl scale deployment doc-processor -n enterprise-ai-chat --replicas=0

# Apply deployment aggiornati
sudo microk8s kubectl apply -f enterprise-ai-chat/k8s/backend/deployment.yaml
sudo microk8s kubectl apply -f enterprise-ai-chat/k8s/frontend/deployment.yaml
sudo microk8s kubectl apply -f enterprise-ai-chat/k8s/doc-processor/deployment.yaml

# Scale up
sudo microk8s kubectl scale deployment backend -n enterprise-ai-chat --replicas=2
sudo microk8s kubectl scale deployment frontend -n enterprise-ai-chat --replicas=2
sudo microk8s kubectl scale deployment doc-processor -n enterprise-ai-chat --replicas=1

# Verifica
sudo microk8s kubectl get pods -n enterprise-ai-chat
sudo microk8s kubectl rollout status deployment/backend -n enterprise-ai-chat
```

Expected: tutti i pod in `Running`

- [ ] **Step 6: Smoke test end-to-end**

```bash
# Carica un PDF scansionato via API e verifica ingestion
curl -s -X POST https://plane.lushlolli.com/api/ingestion/file \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@/path/to/scanned-test.pdf" \
  | python3 -m json.tool
```

Expected: `{"status": "completed", "chunksCount": > 0}`

- [ ] **Step 7: Verifica log backend — nessun errore VisionPipeline**

```bash
sudo microk8s kubectl logs deployment/backend -n enterprise-ai-chat --tail=50 | grep -E "VisionPipeline|DocumentType|ERROR"
```

Expected: nessun ERROR, eventuale `fallbackUsed: false` per documenti scansionati

- [ ] **Step 8: Commit finale**

```bash
cd /home/marcello/enterprise-ai-chat
git add .
git commit -m "feat: deploy vision document processing pipeline with Qwen2.5-VL-32B

- Switch vLLM model to Qwen2.5-VL-32B-Instruct-AWQ (vision-language)
- Add DocumentTypeDetector, PdfPageRenderer, VisionPipelineService
- Add AIProviderFactory.buildDocumentMessage() for multimodal messages
- Add RabbitHoleService.ingestFileBuffer() with vision pipeline integration
- Increase doc-processor K8s resource limits
- Enable cpu-offload-gb=20 for 128K context on 64GB RAM"
```

---

## Rollback rapido

In caso di problemi dopo il deploy, seguire lo scenario corrispondente nella spec:
`docs/superpowers/specs/2026-04-14-vllm-vision-document-processing-design.md` — Sezione 9.

**Rollback vLLM in 3 comandi:**
```bash
cd /home/marcello/vllm
cp /tmp/vllm-backup-*/docker-compose.yml . && cp /tmp/vllm-backup-*/.env .
docker compose up -d vllm
```

**Rollback backend in 1 comando:**
```bash
sudo microk8s kubectl rollout undo deployment/backend -n enterprise-ai-chat
```
