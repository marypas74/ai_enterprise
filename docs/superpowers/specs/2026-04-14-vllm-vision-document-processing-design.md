# Design Spec: vLLM Vision Pipeline per Document Processing

**Data**: 2026-04-14  
**Stato**: Approvato  
**Contesto**: enterprise-ai-chat — migrazione modello vLLM per elaborazione documentale esclusiva

---

## 1. Obiettivo

Sostituire il modello vLLM corrente (`Qwen3.5-35B-A3B-GPTQ-Int4`, MoE 3B attivi, ottimizzato per coding) con `Qwen2.5-VL-32B-Instruct-AWQ`, modello vision-language denso da 32B parametri, ottimale per:

- Sintesi e riassunto documenti (testo e scansionati)
- Q&A su documenti
- Estrazione strutturata di dati
- Documenti multilingua (IT, EN, FR, DE, ES)
- Mix di PDF testuali e scansionati

**Hardware**: RTX 5090 32GB VRAM + 64GB RAM  
**Carico target**: medio, latenza <15s, utenti concorrenti in orario lavorativo

---

## 2. Architettura generale

```
[Documento in ingresso]
        │
        ▼
┌──────────────────────────────┐
│  DocumentTypeDetector        │  Analizza text density del PDF
│  (backend — nuovo servizio)  │  → path: 'text' | 'vision' | 'hybrid'
└──────────┬───────────────────┘
           │                   │
     path=text           path=vision/hybrid
           │                   │
           │                   ▼
           │         doc-processor:3001
           │         POST /render/pages (NUOVO)
           │         pdftoppm → PNG base64
           │                   │
           └──────────┬────────┘
                      ▼
           VisionPipelineService (NUOVO)
           Costruisce messaggio multimodale
                      │
                      ▼
           vLLM — Qwen2.5-VL-32B-AWQ
           (testo + immagini pagine)
                      │
                      ▼
           [Risposta strutturata]
```

**Componenti coinvolti**:
- `vllm/docker-compose.yml` + `.env` — cambio modello
- `doc-processor/src/index.ts` — nuovo endpoint `/render/pages`
- `k8s/doc-processor/deployment.yaml` — risorse aumentate
- `backend/src/services/DocumentTypeDetector.ts` — NUOVO
- `backend/src/services/PdfPageRenderer.ts` — NUOVO (client HTTP doc-processor)
- `backend/src/services/VisionPipelineService.ts` — NUOVO
- `backend/src/modules/ai/AIProviderFactory.ts` — aggiunta `buildDocumentMessage()`
- `backend/src/services/RabbitHoleService.ts` — integrazione pipeline vision

---

## 3. Configurazione vLLM

**Modello**: `Qwen/Qwen2.5-VL-32B-Instruct-AWQ`  
**Quantizzazione**: `awq_marlin`

```yaml
command:
  - Qwen/Qwen2.5-VL-32B-Instruct-AWQ
  - --dtype=bfloat16
  - --quantization=awq_marlin
  - --gpu-memory-utilization=0.92
  - --max-model-len=131072
  - --cpu-offload-gb=20
  - --max-num-batched-tokens=8192
  - --tensor-parallel-size=1
  - --host=0.0.0.0
  - --port=8000
  - --api-key=${VLLM_API_KEY}
  - --served-model-name=${SERVED_MODEL_NAME}
  - --limit-mm-per-prompt=image=50
  - --mm-processor-kwargs={"max_pixels":1003520}
  - --enable-prefix-caching
```

**Stima risorse**:

| Componente | VRAM | RAM |
|---|---|---|
| Pesi modello AWQ | ~22 GB | — |
| KV cache GPU | ~7 GB | — |
| KV cache CPU (offload) | — | ~20 GB |
| Vision encoder overhead | ~1 GB | — |
| Sistema + runtime | ~1 GB | ~8 GB |
| **Totale** | **~31 GB** | **~28 GB** |

**Variabili `.env`**:
```bash
VLLM_MODEL=Qwen/Qwen2.5-VL-32B-Instruct-AWQ
SERVED_MODEL_NAME=qwen25vl:32b
GPU_MEM_UTIL=0.92
MAX_MODEL_LEN=131072
```

**Healthcheck**: `start_period: 900s` (download pesi ~22GB + init ViT)

---

## 4. Nuovo endpoint doc-processor: `POST /render/pages`

Aggiunto a `doc-processor/src/index.ts`. Usa `pdftoppm` (già disponibile via `poppler-utils` nel Dockerfile).

**Input**: multipart PDF file, query params `maxPages` (default 50) e `dpi` (default 150)  
**Output**: `{ pages: string[], pageCount: number, dpi: number }` — pages = array base64 PNG

**Risoluzione**: 150 DPI → ~1240×1754px per A4 → sotto il limite 1MP di vLLM  
**Timeout**: 3s per pagina, max 120s  
**Limite pagine**: max 50 (corrisponde a `--limit-mm-per-prompt=image=50`)

**Risorse K8s aggiornate**:
```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "4Gi"
    cpu: "2000m"
```

---

## 5. Nuovi servizi backend

### DocumentTypeDetector

Analizza text density del PDF (campionando prime 5 pagine):
- `density >= 50 chars/pp` → `path: 'text'`
- `density 10–50` → `path: 'hybrid'`
- `density < 10` → `path: 'vision'`
- Non-PDF (DOCX, XLSX, TXT…) → sempre `path: 'text'`

### PdfPageRenderer

Client HTTP verso `doc-processor:3001/render/pages`. Restituisce array di base64 PNG.

### VisionPipelineService

Orchestratore principale. Sequenza:
1. `DocumentTypeDetector.detect()`
2. Se vision/hybrid: chiama `PdfPageRenderer` con timeout adattivo
3. Costruisce messaggio multimodale via `AIProviderFactory.buildDocumentMessage()`
4. Chiama vLLM
5. Fallback a text path in caso di errore in qualunque step

### AIProviderFactory — buildDocumentMessage()

Costruisce payload OpenAI-compatible con content array misto `image_url` + `text`.  
Path testuale: comportamento invariato rispetto all'attuale.

---

## 6. Strategia di fallback

Ogni punto critico ha un fallback esplicito verso il path testuale:

| Evento | Fallback | Log level |
|---|---|---|
| doc-processor non raggiungibile | path testuale forzato | WARN |
| pdftoppm fallisce | path testuale forzato | WARN |
| Timeout rendering | path testuale forzato | WARN |
| vLLM 413 (payload troppo grande) | riduce DPI 150→100, riprova; poi text | WARN |
| vLLM 503 / timeout | retry 1× con backoff 5s; poi errore utente | ERROR |

Messaggi utente localizzati, senza dettagli interni.

---

## 7. Piano di testing

**Copertura minima: 80%**

| Tipo | Target | Framework |
|---|---|---|
| Unit | DocumentTypeDetector, VisionPipelineService | Vitest |
| Integration | doc-processor /render/pages | Vitest + supertest |
| Integration | VisionPipelineService fallback (mock doc-processor) | Vitest |
| E2E | Upload PDF scansionato → risposta vLLM coerente | Playwright |

---

## 8. Metriche di osservabilità

Log strutturati su ogni elaborazione:
- `docPath`: path effettivamente usato
- `pagesProcessed`: numero pagine renderizzate
- `renderMs`: tempo rendering immagini
- `vllmMs`: tempo risposta vLLM
- `fallbackUsed`: se è stato necessario il fallback
- `mimeType`, `pageCount`

---

## 9. Piano di rollback

### Principio generale

La pipeline è progettata con **degradazione graduale**: ogni componente può fallire indipendentemente senza bloccare il sistema. Il fallback al path testuale è automatico e trasparente per l'utente. Il rollback manuale si attiva solo in caso di regressioni che superano i fallback automatici.

---

### Scenario A — vLLM non si avvia con il nuovo modello

**Sintomi**: container `vllm` in crash loop, `/health` non risponde dopo 900s

**Rollback**:
```bash
cd /home/marcello/vllm

# 1. Ferma il container
docker compose stop vllm

# 2. Ripristina modello precedente nel .env
sed -i 's|Qwen/Qwen2.5-VL-32B-Instruct-AWQ|Qwen/Qwen3.5-35B-A3B-GPTQ-Int4|' .env
sed -i 's|qwen25vl:32b|qwen3:30b-a3b|' .env
sed -i 's|GPU_MEM_UTIL=0.92|GPU_MEM_UTIL=0.90|' .env
sed -i 's|MAX_MODEL_LEN=131072|MAX_MODEL_LEN=32768|' .env

# 3. Ripristina docker-compose.yml (parametri vecchio modello)
# Rimuovere: --cpu-offload-gb, --limit-mm-per-prompt, --mm-processor-kwargs
# Aggiungere: --enforce-eager, --tool-call-parser=hermes, --reasoning-parser=qwen3

# 4. Riavvia — il vecchio modello è in cache nel volume vllm-models
docker compose up -d vllm

# 5. Verifica
sleep 30 && curl -sf http://localhost:8000/health && echo "OK"
```

**Impatto utenti**: downtime vLLM durante il riavvio (~5-8 min). Backend continua a funzionare via fallback testuale automatico.

---

### Scenario B — Qualità risposte degradata dopo il cambio modello

**Sintomi**: risposte incoerenti, allucinazioni su documenti, output troncati

**Rollback**: identico allo Scenario A.

**Prima di eseguire il rollback**, verificare i log per distinguere tra:
- Problema del modello → rollback immediato
- Problema di parametri (temperatura, max_tokens) → tuning prima del rollback
```bash
docker logs vllm --tail 100 | grep -E "ERROR|WARNING|truncat"
```

---

### Scenario C — doc-processor `/render/pages` causa crash o OOM

**Sintomi**: pod doc-processor in OOM kill, rendering fallisce sistematicamente

**Rollback immediato** (senza toccare vLLM):
```bash
# 1. Il VisionPipelineService fa già fallback automatico al path testuale
#    — gli utenti non vedono errori, solo qualità leggermente inferiore sui scansionati

# 2. Se il pod crasha in loop, scala a 0 e ripristina risorse originali
sudo microk8s kubectl scale deployment doc-processor -n enterprise-ai-chat --replicas=0

# Ripristina limiti originali nel deployment.yaml
# limits.memory: 4Gi → 1Gi
# limits.cpu: 2000m → 500m
sudo microk8s kubectl apply -f k8s/doc-processor/deployment.yaml
sudo microk8s kubectl scale deployment doc-processor -n enterprise-ai-chat --replicas=1
```

**Impatto utenti**: zero — fallback automatico già attivo.

---

### Scenario D — Backend non integra correttamente VisionPipelineService

**Sintomi**: errori 500 su ingestion documenti, eccezioni TypeScript in produzione

**Rollback**:
```bash
# 1. Scala backend a 0
sudo microk8s kubectl scale deployment backend -n enterprise-ai-chat --replicas=0

# 2. Ripristina immagine backend precedente (tag versione prima del deploy)
# Modifica k8s/backend/deployment.yaml con il tag precedente
sudo microk8s kubectl apply -f k8s/backend/deployment.yaml
sudo microk8s kubectl scale deployment backend -n enterprise-ai-chat --replicas=2

# 3. Verifica
sudo microk8s kubectl rollout status deployment/backend -n enterprise-ai-chat
```

**Alternativa rapida** (se il tag precedente è noto):
```bash
sudo microk8s kubectl rollout undo deployment/backend -n enterprise-ai-chat
```

---

### Scenario E — Rollback completo (tutti i componenti)

Se più componenti sono compromessi simultaneamente:

```bash
# Ordine di rollback: prima vLLM (più impattante), poi backend, poi doc-processor

# 1. vLLM → Scenario A
cd /home/marcello/vllm && docker compose stop vllm
# (ripristina .env e docker-compose.yml come da Scenario A)
docker compose up -d vllm &

# 2. Backend → Scenario D
sudo microk8s kubectl rollout undo deployment/backend -n enterprise-ai-chat

# 3. doc-processor → Scenario C (solo se in crash)
sudo microk8s kubectl rollout undo deployment/doc-processor -n enterprise-ai-chat

# 4. Verifica stato generale
sudo microk8s kubectl get pods -n enterprise-ai-chat
curl -sf http://localhost:8000/health && echo "vLLM OK"
```

---

### Checklist pre-deploy (gate obbligatorio)

Prima di applicare le modifiche in produzione verificare:

- [ ] `docker pull Qwen/Qwen2.5-VL-32B-Instruct-AWQ` completato senza errori
- [ ] Test locale `/render/pages` su PDF campione (testo e scansionato)
- [ ] `tsc --noEmit` backend senza errori
- [ ] Vitest unit test passano (DocumentTypeDetector, VisionPipelineService)
- [ ] Snapshot del `.env` e `docker-compose.yml` correnti salvato in `/tmp/vllm-backup-YYYYMMDD/`
- [ ] Tag immagine backend corrente annotato per rollback rapido

### Checklist post-deploy (validazione)

- [ ] `curl -sf http://localhost:8000/health` → 200
- [ ] Upload PDF testuale → risposta coerente entro 15s
- [ ] Upload PDF scansionato → risposta coerente entro 20s
- [ ] Log backend: nessun ERROR su VisionPipelineService
- [ ] Metriche GPU: utilizzo VRAM stabile sotto 31GB
- [ ] Metriche RAM: utilizzo KV cache offload sotto 20GB

---

## 10. Dipendenze nuove

**doc-processor**: nessuna (pdftoppm già disponibile)  
**backend**: nessuna npm dependency aggiuntiva  
**vLLM**: nessuna modifica al Dockerfile (AWQ già supportato da vLLM 0.18+)
