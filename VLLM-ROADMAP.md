# vLLM Integration Roadmap

> **Branch**: `feature/vllm-integration` (indipendente da `feature/v2.0.0-image-gen-voice`)
> **Rollback**: `git checkout feature/v2.0.0-image-gen-voice` — nessuna traccia di vLLM nel sistema

---

## Obiettivo

Aggiungere vLLM come provider di inferenza alternativo a Ollama, con gli stessi modelli, mantenendo la possibilità di rollback completo senza evidenze residue.

---

## Fase 0 — Prerequisiti e Compatibilità RTX 5090

### 0.1 Problema: Architettura Blackwell (sm_120)

L'RTX 5090 usa l'architettura Blackwell che richiede CUDA 12.8+. L'immagine ufficiale `vllm/vllm-openai:latest` **NON supporta** RTX 5090 out-of-the-box.

**Opzioni:**
| Opzione | Pro | Contro |
|---------|-----|--------|
| Community image (`lmcache/vllm-openai:build-latest`) | Pronta all'uso | Potrebbe non essere aggiornata |
| Build da NGC base (`nvcr.io/nvidia/pytorch:25.02-py3`) | Controllo totale | ~20 min build, ~34 GB image |
| Attendere supporto ufficiale vLLM | Stabile, supportata | Tempi incerti |

**Raccomandazione**: Build custom da NGC base con Dockerfile dedicato.

### 0.2 Verifica Driver CUDA

```bash
nvidia-smi                          # Verifica driver >= 560
nvcc --version                      # Verifica CUDA >= 12.8
docker run --gpus all nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi
```

### 0.3 Gestione GPU condivisa

Con una sola RTX 5090 (32 GB VRAM), Ollama e vLLM competono per la memoria.

**Strategia raccomandata**: Mutua esclusione controllata
- vLLM: `--gpu-memory-utilization 0.85` (usa fino all'85% della VRAM)
- Ollama: quando vLLM è attivo, i modelli Ollama vengono scaricati dalla GPU (`keepAlive: 0`)
- Il backend può gestire il routing: modelli "heavy" → vLLM, modelli "light/on-demand" → Ollama

**Strategia alternativa**: Partizionamento fisso
- vLLM: `--gpu-memory-utilization 0.6` (~19 GB)
- Ollama: `CUDA_MEM_LIMIT=13G` (~13 GB)
- Limita i modelli caricabili simultaneamente

---

## Fase 1 — Infrastruttura Docker (Host)

> **Principio**: vLLM è un container Docker sul HOST, identico pattern di Ollama.
> Nessun pod/deployment K8s per vLLM.

### 1.1 Struttura directory

```
/home/marcello/k8s-ollama/          # Esistente (Ollama stack)
/home/marcello/vllm/                # NUOVO (vLLM stack)
├── docker-compose.yml
├── Dockerfile.blackwell            # Build custom per RTX 5090
├── nginx-vllm.conf                 # Proxy config
├── .env                            # HF_TOKEN, API key
├── models.json                     # Configurazione modelli da caricare
└── scripts/
    ├── start.sh                    # Avvia vLLM con modello specificato
    ├── switch-model.sh             # Cambia modello attivo
    └── health-check.sh             # Health check
```

### 1.2 Dockerfile.blackwell

```dockerfile
FROM nvcr.io/nvidia/pytorch:25.02-py3

ENV VLLM_FLASH_ATTN_VERSION=2
ENV TORCH_CUDA_ARCH_LIST="12.0"
ENV MAX_JOBS=8

RUN pip install --no-cache-dir vllm

ENTRYPOINT ["python", "-m", "vllm.entrypoints.openai.api_server"]
```

### 1.3 docker-compose.yml

```yaml
services:
  vllm:
    build:
      context: .
      dockerfile: Dockerfile.blackwell
    container_name: vllm
    expose:
      - "8000"                          # Solo interno Docker
    volumes:
      - vllm-models:/root/.cache/huggingface
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - HF_TOKEN=${HF_TOKEN}
      - VLLM_FLASH_ATTN_VERSION=2
    command:
      - --model=${VLLM_MODEL:-Qwen/Qwen2.5-7B-Instruct}
      - --dtype=auto
      - --gpu-memory-utilization=0.85
      - --max-model-len=${MAX_MODEL_LEN:-8192}
      - --tensor-parallel-size=1
      - --host=0.0.0.0
      - --port=8000
      - --api-key=${VLLM_API_KEY}
      - --served-model-name=${SERVED_MODEL_NAME:-default}
      - --enable-auto-tool-choice
      - --tool-call-parser=hermes
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    ipc: host
    shm_size: "8gb"
    ulimits:
      memlock: -1
      stack: 67108864
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 600s          # I modelli impiegano tempo a caricarsi
    networks:
      - vllm-net

  vllm-proxy:
    image: nginx:alpine
    container_name: vllm-proxy
    ports:
      - "8087:8087"                # HTTP con header auth (per K8s)
    volumes:
      - ./nginx-vllm.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      vllm:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - vllm-net

volumes:
  vllm-models:

networks:
  vllm-net:
    driver: bridge
```

### 1.4 Proxy Nginx (`nginx-vllm.conf`)

```nginx
server {
    listen 8087;

    location /vllm/ {
        # Header auth (stesso pattern di Ollama)
        if ($http_x_vllm_key != "mTLS-k8s-backend-2026") {
            return 403;
        }

        rewrite ^/vllm/(.*) /v1/$1 break;
        proxy_pass http://vllm:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        # SSE support
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
        proxy_buffering off;
        proxy_cache off;
    }

    location /vllm/health {
        rewrite ^/vllm/health /health break;
        proxy_pass http://vllm:8000;
    }
}
```

**Accesso da K8s**: `http://10.0.1.1:8087/vllm/` con header `X-Vllm-Key: mTLS-k8s-backend-2026`

### 1.5 File .env

```env
HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxx
VLLM_API_KEY=vllm-local-2026
VLLM_MODEL=Qwen/Qwen2.5-7B-Instruct
SERVED_MODEL_NAME=qwen2.5-7b
MAX_MODEL_LEN=8192
```

---

## Fase 2 — Mapping Modelli Ollama → HuggingFace

vLLM usa modelli HuggingFace (Safetensors), non GGUF. Serve un mapping esplicito:

| Modello Ollama | Modello HuggingFace (vLLM) | VRAM Stimata | Note |
|---|---|---|---|
| `qwen3:32b` | `Qwen/Qwen3-32B` | ~22 GB (FP16) | Quantizzare AWQ per 32GB VRAM |
| `qwen3:30b-a3b` | `Qwen/Qwen3-30B-A3B` | ~20 GB (FP16) | MoE, potrebbe richiedere AWQ |
| `qwen3:14b` | `Qwen/Qwen3-14B` | ~10 GB (FP16) | Entra comodamente |
| `qwen2.5-coder:32b` | `Qwen/Qwen2.5-Coder-32B-Instruct` | ~22 GB | AWQ consigliato |
| `gemma3:12b` | `google/gemma-3-12b-it` | ~8 GB (FP16) | Entra facilmente |
| `phi4:latest` | `microsoft/phi-4` | ~9 GB (FP16) | Supportato |
| `deepseek-r1:32b` | `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B` | ~22 GB | AWQ per 32GB |
| `qwq:32b` | `Qwen/QwQ-32B` | ~22 GB | AWQ per 32GB |
| `llama4:scout` | `meta-llama/Llama-4-Scout-17B-16E-Instruct` | ~30 GB+ (MoE) | Potrebbe non entrare |
| `mistral:latest` | `mistralai/Mistral-7B-Instruct-v0.3` | ~5 GB (FP16) | Facile |
| `deepseek-r1:14b` | `deepseek-ai/DeepSeek-R1-Distill-Qwen-14B` | ~10 GB | OK |
| `bge-m3:latest` | `BAAI/bge-m3` | ~1 GB | Embedding model |
| `nomic-embed-text:latest` | `nomic-ai/nomic-embed-text-v1.5` | ~0.3 GB | Embedding model |

### Strategia di quantizzazione per modelli >20GB

Per i modelli che superano i 32 GB VRAM in FP16, usare varianti pre-quantizzate AWQ:

```bash
# Esempio: Qwen3-32B con AWQ 4-bit (~10 GB VRAM)
--model Qwen/Qwen3-32B-AWQ --quantization awq --dtype float16
```

### Modelli consigliati per Phase 1 (quelli che entrano in 32GB senza quantizzazione)

1. `Qwen/Qwen3-14B` — General purpose
2. `google/gemma-3-12b-it` — General purpose
3. `microsoft/phi-4` — Fast reasoning
4. `mistralai/Mistral-7B-Instruct-v0.3` — Lightweight
5. `deepseek-ai/DeepSeek-R1-Distill-Qwen-14B` — Reasoning

---

## Fase 3 — Backend: VLLMProvider

### 3.1 Nuovo tipo provider

Aggiungere `'vllm'` al sistema dei provider.

**File da modificare**: `backend/src/modules/ai/AIProviderFactory.ts`

```typescript
// Aggiungere 'vllm' ai provider types
export type ProviderType = 'openai' | 'anthropic' | 'google' | 'ollama' | 'vllm' | 'custom';
```

### 3.2 Nuovo provider: `VLLMProvider.ts`

**File**: `backend/src/modules/ai/providers/VLLMProvider.ts`

Poiché vLLM espone un'API OpenAI-compatible, il provider può estendere/wrappare il client OpenAI:

```typescript
// Pseudocodice della struttura
class VLLMProvider implements AIProvider {
  private baseUrl: string;      // http://10.0.1.1:8087/vllm
  private apiKey: string;       // vllm-local-2026
  private authKey: string;      // X-Vllm-Key header

  // Usa OpenAI SDK puntando a vLLM
  private client: OpenAI;

  constructor(config) {
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      defaultHeaders: {
        'X-Vllm-Key': config.authKey
      }
    });
  }

  async complete(messages, options) { /* OpenAI-compatible call */ }
  async streamComplete(messages, options) { /* SSE streaming */ }
  async listModels() { /* GET /v1/models */ }
}
```

**Vantaggi di usare OpenAI SDK**:
- Tool calling/function calling nativo
- Streaming SSE standard
- Structured output supportato
- Nessun parsing custom necessario

### 3.3 Model routing in AIProviderFactory

```typescript
// Pattern matching per vLLM models
// I modelli vLLM usano nomi HuggingFace, serve un prefisso o mapping
private static isVLLMModel(modelId: string): boolean {
  return modelId.startsWith('vllm:') ||
         modelId.includes('/');  // HuggingFace format: org/model
}
```

### 3.4 Database: Nuovo provider

```sql
INSERT INTO ai_providers (name, display_name, provider_type, is_enabled, is_local, config_schema)
VALUES ('vllm', 'vLLM', 'vllm', 1, 1, '{
  "type": "object",
  "properties": {
    "base_url": { "type": "string", "title": "Base URL", "default": "http://10.0.1.1:8087/vllm" },
    "api_key": { "type": "string", "title": "API Key", "format": "password" },
    "timeout": { "type": "number", "title": "Timeout (ms)", "default": 300000 }
  }
}');

-- Settings
INSERT INTO ai_provider_settings (provider_id, setting_key, setting_value, is_secret)
VALUES
  ((SELECT id FROM ai_providers WHERE name='vllm'), 'base_url', 'http://10.0.1.1:8087/vllm', 0),
  ((SELECT id FROM ai_providers WHERE name='vllm'), 'api_key', 'vllm-local-2026', 1),
  ((SELECT id FROM ai_providers WHERE name='vllm'), 'timeout', '300000', 0);

-- Modelli (esempio per Phase 1)
INSERT INTO ai_models (provider_id, model_id, display_name, model_type, context_window, max_output_tokens, supports_streaming, supports_functions, is_enabled)
VALUES
  ((SELECT id FROM ai_providers WHERE name='vllm'), 'Qwen/Qwen3-14B', 'Qwen 3 14B (vLLM)', 'chat', 32768, 8192, 1, 1, 1),
  ((SELECT id FROM ai_providers WHERE name='vllm'), 'google/gemma-3-12b-it', 'Gemma 3 12B (vLLM)', 'chat', 8192, 4096, 1, 1, 1),
  ((SELECT id FROM ai_providers WHERE name='vllm'), 'microsoft/phi-4', 'Phi 4 (vLLM)', 'chat', 16384, 4096, 1, 1, 1);
```

### 3.5 LLMSyncWorker: Supporto vLLM

Aggiungere sync per vLLM nel worker:
- Health check: `GET /vllm/health`
- Model list: `GET /vllm/models`
- Non serve pull/delete (i modelli sono gestiti via docker-compose)

### 3.6 Model pricing (types.ts)

```typescript
// vLLM models — zero cost (local)
'Qwen/Qwen3-14B': { input: 0, output: 0 },
'google/gemma-3-12b-it': { input: 0, output: 0 },
'microsoft/phi-4': { input: 0, output: 0 },
```

---

## Fase 4 — Frontend: UI Admin

### 4.1 ProvidersPage.tsx

- Aggiungere vLLM alla lista provider nel filtro
- Mostrare status health (green/red) basato su `/vllm/health`
- Form di configurazione dinamico (base_url, api_key, timeout)
- NO interfaccia di pull modelli (gestiti via Docker)

### 4.2 ModelsPage.tsx

- I modelli vLLM appaiono con badge "vLLM" (distinto da "Ollama")
- Enable/disable non triggera pull/remove (solo DB flag)
- Mostrare info aggiuntive: quantizzazione, VRAM usage stimato

### 4.3 Chat Model Selector

- I modelli vLLM appaiono nel dropdown con prefisso/icona identificativo
- Raggruppati sotto "vLLM (Local)" nella lista
- L'utente può scegliere lo stesso modello da Ollama o vLLM

---

## Fase 5 — K8s ConfigMap e Environment

### 5.1 ConfigMap update

```yaml
# vLLM (external Docker container on host, HTTP + header auth)
VLLM_BASE_URL: "http://10.0.1.1:8087/vllm"
VLLM_AUTH_KEY: "mTLS-k8s-backend-2026"
VLLM_API_KEY: "vllm-local-2026"
```

### 5.2 Backend deployment.yaml

```yaml
env:
  - name: VLLM_BASE_URL
    value: "http://10.0.1.1:8087/vllm"
  - name: VLLM_AUTH_KEY
    value: "mTLS-k8s-backend-2026"
  - name: VLLM_API_KEY
    value: "vllm-local-2026"
```

---

## Fase 6 — Testing

### 6.1 Unit Tests

- `VLLMProvider.test.ts` — mock delle chiamate OpenAI SDK
- `AIProviderFactory.test.ts` — verifica routing modelli vLLM
- `ModelRouter.test.ts` — verifica tier routing con modelli vLLM

### 6.2 Integration Tests

- Connessione al container vLLM locale
- Chat completion (streaming e non-streaming)
- Tool calling
- Health check endpoint
- Model list sync

### 6.3 E2E Tests

- Admin: abilita/disabilita provider vLLM
- Admin: configura settings vLLM
- Chat: seleziona modello vLLM e genera risposta
- Chat: confronto risposta stessa domanda Ollama vs vLLM

---

## Fase 7 — Benchmark e Ottimizzazione

### 7.1 Metriche da confrontare

| Metrica | Ollama | vLLM | Target |
|---------|--------|------|--------|
| Tokens/sec (singola richiesta) | ~40 | ~200+ | 3x+ miglioramento |
| Richieste concorrenti | ~2-3 | ~50+ | 10x+ miglioramento |
| TTFT (Time to First Token) | ~500ms | ~100ms | 3x+ miglioramento |
| Throughput peak (tokens/sec) | ~41 | ~793 | 15x+ miglioramento |
| VRAM usage | Variabile | Fisso (pre-allocato) | OK |

### 7.2 Casi d'uso raccomandati

| Scenario | Provider Raccomandato | Motivo |
|----------|----------------------|--------|
| Chat singolo utente | Ollama | Più leggero, caricamento on-demand |
| Multi-utente concorrente | **vLLM** | PagedAttention, batching |
| Tool calling complesso | **vLLM** | Supporto nativo function calling |
| Modelli piccoli (<7B) on-demand | Ollama | Caricamento rapido |
| Modelli grandi (14B+) serviti 24/7 | **vLLM** | Throughput superiore |
| Embedding generation | Ollama o vLLM | Entrambi supportano |
| Sperimentazione modelli | Ollama | Pull/remove facile |

---

## Fase 8 — Rollback Plan

### Rollback Completo (nessuna traccia di vLLM)

```bash
# 1. Ferma container vLLM
cd /home/marcello/vllm && docker compose down -v

# 2. Rimuovi directory vLLM
rm -rf /home/marcello/vllm

# 3. Torna al branch principale
cd /home/marcello/enterprise-ai-chat
git checkout feature/v2.0.0-image-gen-voice

# 4. Rimuovi provider dal DB (se era stato aggiunto)
# Il branch principale non ha il codice vLLM, quindi basta:
DELETE FROM ai_models WHERE provider_id = (SELECT id FROM ai_providers WHERE name = 'vllm');
DELETE FROM ai_provider_settings WHERE provider_id = (SELECT id FROM ai_providers WHERE name = 'vllm');
DELETE FROM ai_providers WHERE name = 'vllm';

# 5. Restart backend pods
sudo microk8s kubectl rollout restart deployment/backend -n enterprise-ai-chat
```

**Risultato**: Il sistema torna esattamente allo stato pre-vLLM. Nessun file, container o configurazione residua.

---

## Timeline Stimata

| Fase | Durata | Dipendenze |
|------|--------|------------|
| **Fase 0**: Prerequisiti RTX 5090 | 1 sessione | Driver CUDA, HF_TOKEN |
| **Fase 1**: Docker setup | 1 sessione | Fase 0 |
| **Fase 2**: Mapping modelli | Incluso in Fase 1 | — |
| **Fase 3**: Backend provider | 1-2 sessioni | Fase 1 funzionante |
| **Fase 4**: Frontend UI | 1 sessione | Fase 3 |
| **Fase 5**: K8s config | Incluso in Fase 3 | — |
| **Fase 6**: Testing | 1 sessione | Fase 3+4 |
| **Fase 7**: Benchmark | 1 sessione | Tutto funzionante |

**Totale**: ~5-6 sessioni di lavoro

---

## File Modificati (nel branch `feature/vllm-integration`)

### Nuovi file
- `/home/marcello/vllm/` — Intera directory Docker (FUORI dal repo git)
- `backend/src/modules/ai/providers/VLLMProvider.ts`
- `backend/src/modules/ai/providers/VLLMProvider.test.ts`
- `backend/src/services/VLLMModelSyncService.ts`

### File modificati
- `backend/src/modules/ai/AIProviderFactory.ts` — Aggiunta tipo 'vllm'
- `backend/src/modules/ai/types.ts` — Pricing modelli vLLM
- `backend/src/modules/admin/providerCrud.ts` — Test connessione vLLM
- `backend/src/services/LLMSyncWorker.ts` — Sync config vLLM
- `backend/src/services/ModelRouter.ts` — Routing tier con vLLM
- `frontend/src/pages/admin/ProvidersPage.tsx` — UI provider vLLM
- `frontend/src/pages/admin/ModelsPage.tsx` — Badge vLLM
- `k8s/backend/deployment.yaml` — Env vars vLLM
- `k8s/configmap.yaml` — Config vLLM

### File NON modificati (separazione pulita)
- Directory `/home/marcello/k8s-ollama/` — Ollama rimane invariato
- `OllamaProvider.ts` — Nessuna modifica
- `OllamaModelSyncService.ts` — Nessuna modifica
