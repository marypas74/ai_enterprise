# Docker Build & Deploy Best Practices

## Il Problema "Layer Already Exists"

Quando Docker push mostra "Layer already exists" per tutti i layer dell'applicazione, significa che l'immagine **non è stata aggiornata**. Docker sta riutilizzando layer cachati.

## Soluzione: Usare `--no-cache`

```bash
# SBAGLIATO - usa la cache, potrebbe non includere le modifiche
docker build -t myimage:v1 .

# CORRETTO - forza la ricostruzione di tutti i layer
docker build --no-cache -t myimage:v1 .
```

## Perché Succede?

1. **Docker cache**: Docker memorizza ogni layer del Dockerfile. Se i file non sono cambiati (secondo Docker), riusa il layer cachato
2. **Build context**: Se il file modificato è in `.dockerignore`, non viene incluso
3. **Layer ordering**: Cambiamenti nei primi layer invalidano quelli successivi, ma non viceversa

## Best Practices per CI/CD

### 1. Versioning Semantico
```bash
# Mai sovrascrivere tag esistenti!
docker build --no-cache -t myimage:v1.0.1 .  # Nuovo tag per ogni modifica
docker build --no-cache -t myimage:v$(date +%Y%m%d%H%M) .  # Timestamp
```

### 2. Cache Busting con ARG
```dockerfile
ARG CACHE_BUST=1
COPY . .
```
```bash
docker build --build-arg CACHE_BUST=$(date +%s) -t myimage:v1 .
```

### 3. Combinare --no-cache con --pull
```bash
# Ricostruisce tutto E aggiorna l'immagine base
docker build --no-cache --pull -t myimage:v1 .
```

### 4. Pulire la Cache Docker
```bash
# Elimina tutta la build cache
docker builder prune -af

# Elimina solo cache non usata nelle ultime 24h
docker builder prune --filter until=24h
```

### 5. Selective Cache con BuildKit
```bash
# Invalida cache solo per uno stage specifico
docker build --no-cache-filter=build -t myimage:v1 .
```

## Workflow di Deploy Kubernetes

```bash
# 1. Build con --no-cache e nuovo tag
docker build --no-cache -t localhost:32000/myapp:v$(date +%Y%m%d%H%M) .

# 2. Push
docker push localhost:32000/myapp:v$(date +%Y%m%d%H%M)

# 3. Deploy su Kubernetes
kubectl set image deployment/myapp myapp=localhost:32000/myapp:v$(date +%Y%m%d%H%M)

# 4. Verificare rollout
kubectl rollout status deployment/myapp --timeout=120s
```

## Diagnostica

### Verificare se l'immagine è stata aggiornata
```bash
# Controlla il digest dell'immagine
docker images --digests | grep myimage

# Confronta con registry
docker pull myimage:v1
docker images --digests | grep myimage
```

### Ispezionare i layer
```bash
docker history myimage:v1
docker inspect myimage:v1 | jq '.[0].RootFS.Layers'
```

## Riferimenti

- [Docker Build Cache](https://docs.docker.com/build/cache/)
- [Docker Build Best Practices](https://docs.docker.com/build/building/best-practices/)
- [Cache Invalidation](https://docs.docker.com/build/cache/invalidation/)
- [Docker Build Without Cache](https://www.cloudbees.com/blog/docker-build-without-cache)
- [Fix Layer Already Exists](https://www.codegenes.net/blog/docker-what-is-proper-way-to-rebuild-and-push-updated-image-to-docker-cloud/)

---

# Claude Pro/Max OAuth - Implementazione Corretta (2025)

## Configurazione OAuth Corretta

Basato su implementazioni funzionanti da:
- [sst/opencode-anthropic-auth](https://github.com/sst/opencode-anthropic-auth)
- [grll/claude-code-login](https://github.com/grll/claude-code-login)
- [nsxdavid/anthropic-max-router](https://github.com/nsxdavid/anthropic-max-router)

```
Client ID: 9d1c250a-e61b-44d9-88ed-5944d1962f5e
Authorize URL: https://claude.ai/oauth/authorize
Token URL: https://console.anthropic.com/v1/oauth/token  (IMPORTANTE: /v1/ NON /api/)
Redirect URI: https://console.anthropic.com/oauth/code/callback
Scopes: org:create_api_key user:profile user:inference
Token Expiry: 8 ore (28800 secondi)
```

## Flusso OAuth PKCE Completo

### 1. Generare Code Verifier e Challenge (PKCE)

```typescript
import crypto from 'crypto';

// Code verifier: 32 bytes random, base64url encoded
const codeVerifier = crypto.randomBytes(32).toString('base64url');

// Code challenge: SHA-256 hash del verifier, base64url encoded
const codeChallenge = crypto.createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');

// State: per CSRF protection
const state = crypto.randomBytes(16).toString('hex');
```

### 2. Costruire Authorization URL

```typescript
const authUrl = new URL('https://claude.ai/oauth/authorize');
authUrl.searchParams.set('code', 'true');  // IMPORTANTE: mostra la pagina con il codice
authUrl.searchParams.set('client_id', '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'org:create_api_key user:profile user:inference');
authUrl.searchParams.set('code_challenge', codeChallenge);
authUrl.searchParams.set('code_challenge_method', 'S256');
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('redirect_uri', 'https://console.anthropic.com/oauth/code/callback');
```

### 3. Token Exchange

Il codice restituito può essere nel formato `code#state`. Gestire entrambi i casi:

```typescript
// Il codice può contenere #state
let authCode = receivedCode;
if (authCode.includes('#')) {
  const parts = authCode.split('#');
  authCode = parts[0];
  // parts[1] contiene lo state
}

const response = await fetch('https://console.anthropic.com/v1/oauth/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  body: JSON.stringify({
    grant_type: 'authorization_code',
    client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    code: authCode,
    redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
    code_verifier: codeVerifier,
    state: state
  })
});

// Response:
// {
//   "access_token": "sk-ant-oat01-...",
//   "refresh_token": "sk-ant-ort01-...",
//   "expires_in": 28800,
//   "token_type": "Bearer"
// }
```

### 4. Token Refresh

```bash
curl -X POST https://console.anthropic.com/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "refresh_token",
    "refresh_token": "sk-ant-ort01-...",
    "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
  }'
```

### 5. Usare il Token per API Calls

```typescript
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'oauth-2025-04-20'  // Header beta per OAuth
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```

## Errori Comuni e Soluzioni

### "Invalid or expired state"
- **Causa**: Lo state salvato non corrisponde o è scaduto
- **Soluzione**: Usare Redis per lo state se hai multiple replicas (non in-memory Map)

### Token URL sbagliato
- **Sbagliato**: `https://console.anthropic.com/api/oauth/token`
- **Corretto**: `https://console.anthropic.com/v1/oauth/token`

### Scopes errati
- **Sbagliato**: `user:sessions:claude_code`
- **Corretto**: `org:create_api_key user:profile user:inference`

### Redirect URI mancante per mostrare il codice
- Assicurarsi di usare `code=true` nell'URL di autorizzazione
- Usare `https://console.anthropic.com/oauth/code/callback` come redirect_uri

## Soluzione Alternativa: Input Manuale del Token

Se OAuth non funziona, estrarre token da Claude Code CLI:

```bash
# Dopo aver fatto login con claude login, i token sono in:
cat ~/.claude/credentials.json

# Oppure usare ~/.claude/.credentials.json (nota il punto)
cat ~/.claude/.credentials.json
```

## Riferimenti

- [OpenCode Anthropic Auth](https://deepwiki.com/sst/opencode-anthropic-auth) - Implementazione completa
- [Claude Code Login](https://github.com/grll/claude-code-login) - OAuth per GitHub Actions
- [Unlock Claude API from Claude Pro/Max](https://www.alif.web.id/posts/claude-oauth-api-key)
- [Anthropic Max Router](https://github.com/nsxdavid/anthropic-max-router) - Token management
- [OAuth Authentication Fails #1484](https://github.com/anthropics/claude-code/issues/1484)
- [RooCode OAuth Request #4799](https://github.com/RooCodeInc/Roo-Code/issues/4799)

---

# MariaDB audit_log JSON Constraint

## Il Problema

La tabella `audit_log` ha una colonna `details` con un vincolo CHECK:

```sql
`details` text DEFAULT NULL CHECK (json_valid(`details`))
```

Se si inserisce una stringa non-JSON, l'INSERT fallisce con:

```
CONSTRAINT 'audit_log.details' failed
```

## Soluzione

Usare sempre `JSON.stringify()` per il campo details:

```typescript
// SBAGLIATO - causa errore constraint
await insertOne(db,
  'INSERT INTO audit_log (..., details, ...) VALUES (?, ?, ?, ?, ?, ?)',
  [userId, 'configure_oauth', 'ai_provider', id, 'Claude Pro configured', ip]
);

// CORRETTO - JSON valido
await insertOne(db,
  'INSERT INTO audit_log (..., details, ...) VALUES (?, ?, ?, ?, ?, ?)',
  [userId, 'configure_oauth', 'ai_provider', id, JSON.stringify({ message: 'Claude Pro configured' }), ip]
);

// ALTERNATIVA - NULL è permesso
await insertOne(db,
  'INSERT INTO audit_log (..., details, ...) VALUES (?, ?, ?, ?, ?, ?)',
  [userId, 'configure_oauth', 'ai_provider', id, null, ip]
);
```

---

# System Monitor - BusyBox/Alpine Compatibility

## Problema: TOP PROCESSES non mostra dati

Alpine Linux usa BusyBox che ha versioni limitate dei comandi. Il comando `ps --sort` non funziona.

### Soluzione: Leggere direttamente /proc

```typescript
// BusyBox ps non supporta --sort - leggi /proc direttamente
const procDirs = await fs.promises.readdir('/host/proc');
const pids = procDirs.filter(name => /^\d+$/.test(name));

for (const pid of pids.slice(0, 20)) {
  try {
    const stat = await fs.promises.readFile(`/host/proc/${pid}/stat`, 'utf-8');
    const status = await fs.promises.readFile(`/host/proc/${pid}/status`, 'utf-8');
    const cmdline = await fs.promises.readFile(`/host/proc/${pid}/cmdline`, 'utf-8');

    // Parse stat: pid (comm) state ppid pgrp session tty_nr tpgid ...
    const statMatch = stat.match(/^\d+ \((.+?)\) (\S)/);
    // Parse status: get VmRSS line
    const rssMatch = status.match(/VmRSS:\s*(\d+)/);

    processes.push({
      pid: pid,
      command: cmdline.replace(/\0/g, ' ').trim() || statMatch?.[1] || 'unknown',
      mem: rssMatch ? parseInt(rssMatch[1]) / 1024 : 0  // Convert KB to MB
    });
  } catch { /* process may have exited */ }
}
```

## Problema: K8S PODS non mostra dati

Node.js `fetch` non supporta bene l'opzione `agent` per certificati self-signed. Usare `https.request` nativo.

### Soluzione: https.request nativo

```typescript
const https = await import('https');

const podsData = await new Promise<any>((resolve, reject) => {
  const url = new URL(`${K8S_API_URL}/api/v1/pods?limit=50`);
  const options = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    method: 'GET',
    rejectUnauthorized: false,  // Accept self-signed certs
    headers: {
      'Authorization': `Bearer ${k8sToken}`,
      'Accept': 'application/json'
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(e); }
    });
  });
  req.on('error', reject);
  req.end();
});
```

## Frontend-Backend Property Mismatch

Se la pagina System Monitor è completamente bianca, verificare che le proprietà restituite dal backend corrispondano a quelle attese dal frontend:

```typescript
// Frontend aspetta:
interface Process {
  pid: string;    // NOT number
  mem: number;    // NOT 'memory'
  cpu: number;
}

// Backend deve restituire:
processes.push({
  pid: pid,           // string
  mem: parseFloat(mem),  // NOT 'memory'
  cpu: parseFloat(cpu)
});
```

---

# MariaDB Reserved Words

## Problema: Colonne con nomi riservati

`year_month` può essere interpretato come espressione SQL in alcune versioni di MariaDB. Usare sempre backtick per i nomi delle colonne.

```typescript
// SBAGLIATO - può causare errori di sintassi SQL
`SELECT * FROM monthly_usage WHERE year_month = ?`

// CORRETTO - colonna escapata
`SELECT * FROM monthly_usage WHERE \`year_month\` = ?`
```

---

# OpenAI API Key dal Database

## Problema

OpenAIProvider usava solo `process.env.OPENAI_API_KEY`, ignorando la configurazione del database.

## Soluzione

```typescript
export class OpenAIProvider implements AIProvider {
  constructor(config?: { apiKey?: string }) {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key not configured');
    this.client = new OpenAI({ apiKey });
  }
}

// Nel factory:
case 'openai':
  this.providers.set(providerName, new OpenAIProvider(config));  // Passa config!
  break;
```

---

# Claude API OAuth Header

## Problema

Le chiamate API Claude con OAuth token richiedono l'header beta.

## Soluzione

```typescript
const response = await fetch('https://api.anthropic.com/v1/messages', {
  headers: {
    'Authorization': `Bearer ${oauthToken}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'oauth-2025-04-20'  // OBBLIGATORIO per OAuth
  }
});
```

---

# VERSIONING OBBLIGATORIO - Docker + Kubernetes

## REGOLA FONDAMENTALE

**OGNI MODIFICA RICHIEDE UN NUOVO TAG VERSION!**

```bash
# SBAGLIATO - NON FUNZIONA MAI
docker build -t myapp:v1 .
docker push myapp:v1  # "Layer already exists" = NESSUNA MODIFICA

# CORRETTO - SEMPRE incrementare la versione
docker build --no-cache -t myapp:v15 .  # Era v14? Ora v15!
```

## Workflow OBBLIGATORIO per Deploy

```bash
# 1. Incrementa SEMPRE il tag (v14 → v15, ecc.)
VERSION=v15

# 2. Build con --no-cache
docker build --no-cache -t enterprise-ai-chat-backend:$VERSION .
docker build --no-cache -t enterprise-ai-chat-frontend:$VERSION .

# 3. Aggiorna il patch file PRIMA di deployare
sed -i "s/backend:v[0-9]*/backend:$VERSION/" k8s/backend-monitoring-patch.yaml

# 4. Import e deploy
docker save enterprise-ai-chat-backend:$VERSION -o /tmp/backend.tar
sudo microk8s ctr image import /tmp/backend.tar
sudo microk8s kubectl patch deployment backend -n enterprise-ai-chat --patch-file k8s/backend-monitoring-patch.yaml
sudo microk8s kubectl delete pods -n enterprise-ai-chat -l app=backend
```

## Perché è Necessario

1. **Docker cache**: Senza `--no-cache`, Docker riusa layer esistenti
2. **Kubernetes imagePullPolicy**: Con `Never`, K8s non ripulla mai l'immagine
3. **Registry layer dedup**: Se il layer esiste, non viene ricaricato
4. **Browser cache**: Il bundle JS ha hash basato sul contenuto

## Tracking delle Versioni

Mantieni un log delle versioni deployate:

| Data | Backend | Frontend | Note |
|------|---------|----------|------|
| 28/12 | v14 | v5 | OpenAI sync, OAuth fix |
| 27/12 | v13 | v3 | System Monitor fix |

## Comandi Utili

```bash
# Vedere versione corrente
kubectl get deployment backend -n enterprise-ai-chat -o jsonpath='{.spec.template.spec.containers[0].image}'

# Lista immagini in microk8s
sudo microk8s ctr images list | grep enterprise-ai-chat

# Pulire vecchie immagini
sudo microk8s ctr images rm docker.io/library/enterprise-ai-chat-backend:v13
```

---

# JavaScript toFixed() su valori null/undefined

## Problema

```
TypeError: E.toFixed is not a function
```

Questo errore si verifica quando si chiama `.toFixed()` su un valore che non è un numero (undefined, null, NaN).

## Causa Comune

```typescript
// SBAGLIATO - causa errore se total_tokens è undefined
{(s.totals.total_tokens / 1000000).toFixed(2)}

// SBAGLIATO - divisione per zero o undefined restituisce NaN
{((sys.activeUsers / sys.totalUsers) * 100).toFixed(0)}
```

## Soluzione

```typescript
// CORRETTO - proteggere con || 0 PRIMA della divisione
{((s.totals.total_tokens || 0) / 1000000).toFixed(2)}

// CORRETTO - verificare divisore prima di dividere
{(sys.totalUsers ? ((sys.activeUsers || 0) / sys.totalUsers) * 100 : 0).toFixed(0)}

// ALTERNATIVA - usare optional chaining con fallback
{(s.totals.total_cost ?? 0).toFixed(2)}
```

## Soluzione Definitiva: Funzione safeFixed()

```typescript
// Aggiungere all'inizio del file
const safeFixed = (value: any, digits: number = 2): string => {
  const num = Number(value);
  if (isNaN(num) || !isFinite(num)) return '0';
  return num.toFixed(digits);
};

// Usare così:
{safeFixed(s.totals?.total_cost, 2)}
{safeFixed((sys.activeUsers || 0) / (sys.totalUsers || 1) * 100, 0)}%
```

## Best Practice

1. **MAI** usare `.toFixed()` direttamente su valori API
2. Creare una funzione helper `safeFixed()` riutilizzabile
3. Gestire NaN, Infinity, null, undefined, stringhe
4. Usare optional chaining `?.` per accesso a proprietà annidate

## Riferimenti

- [bobbyhadz - TypeError toFixed is not a function](https://bobbyhadz.com/blog/javascript-typeerror-tofixed-is-not-a-function)
- [Tutorial Reference - JavaScript toFixed Error](https://tutorialreference.com/javascript/examples/faq/javascript-error-typeerror-tofixed-is-not-a-function)

---

# Claude Pro/Max OAuth Token - Limitazioni e Soluzioni

## Problema

```
"This credential is only authorized for use with Claude Code and cannot be used for other API requests."
```

I token OAuth ottenuti da Claude Pro/Max subscription sono **restricted per Claude Code only**.

## Causa Tecnica

Anthropic applica una **restrizione lato server** basata sullo scope OAuth:
- Scope: `user:sessions:claude_code` indica token per Claude Code only
- **NON è aggirabile** con headers (User-Agent, anthropic-beta, etc.)
- È una decisione di business, non un bug

## Architettura Prodotti Anthropic

| Prodotto | Accesso | Pagamento |
|----------|---------|-----------|
| **Claude.ai** (web/desktop/mobile) | Subscription Pro/Max | Abbonamento mensile |
| **Claude Code** (VS Code/CLI) | Subscription Pro/Max | Abbonamento mensile |
| **Claude API** (per sviluppatori) | console.anthropic.com | Pay-per-token |

> "Claude paid plans and the Claude Console are separate products designed for different purposes"
> — [Anthropic Help Center](https://support.claude.com/en/articles/9876003)

## Soluzioni per Caso d'Uso

### 1. Chat Web Enterprise
**Richiede API Key** (crediti separati):
```typescript
// Acquistare crediti su console.anthropic.com
const response = await fetch('https://api.anthropic.com/v1/messages', {
  headers: {
    'x-api-key': 'sk-ant-api03-...',  // API Key, NON OAuth
    'anthropic-version': '2023-06-01'
  },
  // ...
});
```

### 2. VS Code Extension
**Può usare OAuth** tramite Claude Code protocol (ACP):
- Estensioni come Cline, Zed usano Claude Code come proxy
- Richiede Claude Code CLI installato localmente
- Il token OAuth funziona perché passa attraverso Claude Code

### 3. CLIProxyAPI (Soluzione Terze Parti)
Proxy che wrappa Claude Code CLI per esporre API:
```bash
# Installazione
brew tap router-for-me/tap
brew install cliproxyapi

# Login (richiede browser)
cliproxyapi --claude-login

# Avvio proxy
cliproxyapi --config ~/.cli-proxy-api/config.yaml
# Endpoint: http://localhost:8317/v1/...
```

**Nota**: Su server headless richiede SSH tunneling:
```bash
ssh -L 54545:127.0.0.1:54545 user@server
```

## Provider Separati nel DB

```sql
-- OAuth provider (per VS Code extension via CLIProxyAPI)
INSERT INTO ai_providers (name, display_name, provider_type, is_enabled)
VALUES ('anthropic_oauth', 'Claude Pro (OAuth)', 'anthropic', 1);

-- API Key provider (per chat web)
INSERT INTO ai_providers (name, display_name, provider_type, is_enabled)
VALUES ('anthropic_api', 'Claude API (Crediti)', 'anthropic', 1);
```

## Riferimenti

- [Anthropic FAQ - API vs Subscription](https://support.claude.com/en/articles/9876003)
- [Claude vs Claude API vs Claude Code](https://eval.16x.engineer/blog/claude-vs-claude-api-vs-claude-code)
- [CLIProxyAPI GitHub](https://github.com/router-for-me/CLIProxyAPI)
- [Headless Auth Issue #7100](https://github.com/anthropics/claude-code/issues/7100)

---

# React Axios Interceptor - Auto Logout su 401

## Problema

L'utente resta loggato anche quando il token JWT scade, causando errori 401 silenziosi senza redirect alla login.

## Causa

L'interceptor Axios usava `localStorage.removeItem()` direttamente invece di aggiornare lo state Zustand, causando desincronizzazione tra localStorage e React state.

## Soluzione: Zustand getState() Pattern

```typescript
import { useAuthStore } from '../hooks/useAuthStore';

// Force logout - uses Zustand store's getState() outside components
// Best practice: https://docs.pmnd.rs/zustand/guides/using-zustand-without-react
const forceLogout = () => {
  console.warn('[API] Session expired - forcing logout');

  // Update Zustand store directly (don't call logout() to avoid API call)
  useAuthStore.setState({
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isLoading: false,
    error: 'Session expired. Please login again.'
  });

  window.location.href = '/login';
};

// Request interceptor - get token from Zustand for consistency
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor with token refresh queue
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Skip auth endpoints to prevent loops
    if (originalRequest.url?.includes('/auth/')) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // Queue requests during refresh
      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshSubscribers.push((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
        });
      }

      isRefreshing = true;

      try {
        const response = await api.post('/auth/refresh');
        const { accessToken } = response.data;

        // Update Zustand store directly
        useAuthStore.setState({ accessToken });

        // Notify queued requests
        refreshSubscribers.forEach(cb => cb(accessToken));
        refreshSubscribers = [];
        isRefreshing = false;

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch {
        isRefreshing = false;
        refreshSubscribers = [];
        forceLogout();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);
```

## Best Practices

1. **Usa `getState()`** per accedere allo store Zustand fuori dai componenti React
2. **Non chiamare `logout()`** dell'API quando il token è già invalido (evita loop)
3. **Queue delle richieste** durante il refresh per evitare multiple chiamate
4. **Skip endpoints auth** per prevenire loop infiniti
5. **Return `Promise.reject()`** sempre per mantenere la promise chain

## Gestire Fetch oltre ad Axios

Per chiamate fetch (es. streaming):

```typescript
if (response.status === 401) {
  console.warn('[StreamChat] Session expired - forcing logout');
  forceLogout();
  onError('Session expired. Please login again.');
  return;
}
```

## Riferimenti

- [Zustand Without React](https://docs.pmnd.rs/zustand/guides/using-zustand-without-react)
- [Handling User Logout in Zustand](https://remslabs.com/blog/handling-user-logout-in-zustand-when-axios-interceptor-detects-unauthorized-status)
- [Handle 401 with Axios Interceptors](https://dev.to/idboussadel/handle-401-errors-in-a-cleaner-way-with-axios-interceptors-5hkk)
- [Auth Cookie Expiry with Axios](https://medium.com/@kartikey8604/handling-authentication-cookie-expiry-and-session-logout-using-axios-interceptors-in-reactjs-63a8c14825aa)

---

# Auto-Claude - Multi-Agent Autonomous Development

## Cos'è Auto-Claude

Framework per sviluppo autonomo con agenti multipli Claude che gestiscono planning, implementazione e validazione.

GitHub: https://github.com/AndyMik90/Auto-Claude

## Funzionalità Principali

| Feature | Descrizione |
|---------|-------------|
| **Parallel Agents** | Fino a 12 terminali concorrenti |
| **Git Worktrees** | Isolamento sicuro, main branch protetto |
| **Self-Healing** | Loop di correzione automatica (fino a 50 iterazioni) |
| **AI Merge** | Risoluzione conflitti 3-tier (Git → AI conflict → AI full-file) |
| **Persistent Memory** | Context mantenuto tra sessioni |

## Requisiti

- Claude Pro/Max subscription
- Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
- `CLAUDE_CODE_OAUTH_TOKEN` da `claude setup-token`

## Fasi di Lavoro

1. **Specification**: Discovery progetto → Requirements → Research → Spec document
2. **Implementation**: Planner → Coders paralleli → QA reviewers → Self-healing loop
3. **Merge**: Git auto-merge → Conflict-only AI → Full-file AI fallback

## Componenti Integrabili in Altri Progetti

- **Kanban task visualization** per tracking lavoro autonomo
- **Agent terminal multiplexing** per task paralleli
- **Self-validating QA loop** con fix iterativo
- **AI merge conflict resolution**
- **Changelog generation** automatica

## Architettura Agenti

```
┌─────────────────┐
│   Orchestrator  │
├─────────────────┤
│ ┌─────┐ ┌─────┐│
│ │Agent│ │Agent││  ← Fino a 12 paralleli
│ └──┬──┘ └──┬──┘│
│    │worktree│   │  ← Git worktree isolato
│ ┌──┴──┐ ┌──┴──┐│
│ │ QA  │ │ QA  ││  ← Validazione automatica
│ └─────┘ └─────┘│
└────────┬────────┘
         │
    ┌────┴────┐
    │AI Merger│  ← Risoluzione conflitti
    └─────────┘
```

## Riferimenti

- [Auto-Claude GitHub](https://github.com/AndyMik90/Auto-Claude)
- [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code)

---

# Debug Console - Real-time Logging per Enterprise Apps

## Problema

Debugging in produzione è difficile senza visibilità su:
- Errori frontend (console.log non visibili)
- Richieste API e risposte
- Log backend in tempo reale
- Stato sistema e database

## Soluzione: Debug Console Integrata

### 1. Backend - Log Buffer e WebSocket

```typescript
// /modules/admin/debug.ts

// In-memory log buffer
const logBuffer: any[] = [];
const MAX_LOG_BUFFER = 1000;

export function addToLogBuffer(log: any) {
  logBuffer.push({ ...log, timestamp: new Date().toISOString() });
  if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
}

// Endpoint per logs storici
fastify.get('/debug/logs', async (request) => {
  const query = request.query as { limit?: string; level?: string };
  return { logs: logBuffer.slice(-parseInt(query.limit || '100')) };
});

// Endpoint per diagnostiche sistema
fastify.get('/debug/system', async () => ({
  node: { version: process.version, uptime: process.uptime() },
  memory: process.memoryUsage(),
  os: { cpus: os.cpus().length, totalMemory: os.totalmem() }
}));
```

### 2. Backend - Hook per Catturare Tutte le Richieste

```typescript
// In index.ts

// WebSocket clients per debug
const debugClients = new Set<any>();

fastify.register(async function (fastify) {
  fastify.get('/ws/debug', { websocket: true }, async (socket) => {
    debugClients.add(socket);
    socket.on('close', () => debugClients.delete(socket));
  });
});

// Hook su ogni response
fastify.addHook('onResponse', (request, reply, done) => {
  const log = {
    type: 'log',
    level: reply.statusCode >= 400 ? 'error' : 'info',
    msg: `${request.method} ${request.url} - ${reply.statusCode}`,
    statusCode: reply.statusCode,
    responseTime: reply.elapsedTime,
    timestamp: new Date().toISOString()
  };

  addToLogBuffer(log);

  // Broadcast a tutti i client debug
  debugClients.forEach(client => {
    try { client.send(JSON.stringify(log)); }
    catch { debugClients.delete(client); }
  });

  done();
});
```

### 3. Frontend - Intercept Console e Fetch

```typescript
// Intercept console.log/warn/error
useEffect(() => {
  const originalConsole = { log: console.log, error: console.error };

  console.log = (...args) => {
    originalConsole.log(...args);
    addLog({ level: 'info', source: 'frontend', message: args.join(' ') });
  };

  return () => { console.log = originalConsole.log; };
}, []);

// Intercept fetch per tracciare API calls
useEffect(() => {
  const originalFetch = window.fetch;

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input
      : (input instanceof URL ? input.href : input.url);
    const startTime = Date.now();

    try {
      const response = await originalFetch(input, init);
      addLog({
        level: response.ok ? 'info' : 'error',
        source: 'api',
        message: `${init?.method || 'GET'} ${url} - ${response.status} (${Date.now() - startTime}ms)`
      });
      return response;
    } catch (error) {
      addLog({ level: 'error', source: 'api', message: `FAILED: ${url}` });
      throw error;
    }
  };

  return () => { window.fetch = originalFetch; };
}, []);
```

### 4. UI Features

- **Tabs**: All / Backend / Frontend / API
- **Level Filter**: Debug / Info / Warn / Error
- **Search**: Filtro testo full-text
- **Pause/Resume**: Ferma acquisizione
- **Export**: Download JSON logs
- **Auto-scroll**: Scroll automatico ai nuovi log
- **Expand details**: Click per vedere JSON completo

## Fastify TypeScript - Query Parameters

### Problema

Fastify con TypeScript causa errori sui tipi dei query parameters:

```typescript
// ERRORE: Type 'unknown' is not assignable to type '{ limit?: string; }'
async (request: FastifyRequest<{ Querystring: { limit?: string } }>) => {
  const limit = request.query.limit;
}
```

### Soluzione: Type Assertion

```typescript
// CORRETTO - usa type assertion
async (request: FastifyRequest) => {
  const query = request.query as { limit?: string; level?: string };
  const limit = parseInt(query.limit || '100');
}
```

## Docker Build da Directory Corretta

### Problema

Costruire immagine Docker dalla directory sbagliata:

```bash
# SBAGLIATO - dalla root del progetto
cd /home/user/project
docker build -t frontend:v1 .  # Usa Dockerfile root!

# CORRETTO - dalla directory specifica
cd /home/user/project/frontend
docker build -t frontend:v1 .  # Usa frontend/Dockerfile
```

### Sintomi

- Frontend container mostra errori backend (MySQL connection)
- `ECONNREFUSED 127.0.0.1:3306` in container frontend
- Container Node.js invece di nginx

## Riferimenti

- [Fastify WebSocket](https://github.com/fastify/fastify-websocket)
- [React useEffect Cleanup](https://react.dev/learn/synchronizing-with-effects#how-to-handle-the-effect-firing-twice-in-development)
- [Intercepting fetch](https://blog.logrocket.com/intercepting-javascript-fetch-api-requests-responses/)

---

# MicroK8s Image Pull - imagePullPolicy

## Problema

Pods in `ImagePullBackOff` anche se l'immagine è stata importata con `microk8s ctr image import`.

## Causa

`imagePullPolicy: Always` (default per tag non `:latest`) tenta di pullare dal registry anche se l'immagine esiste localmente.

## Soluzione

```bash
# Patch deployment per usare imagePullPolicy: Never
kubectl patch deployment backend -n enterprise-ai-chat \
  --type='json' \
  -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "Never"}]'
```

## Workflow Completo per Deploy Locale

```bash
# 1. Build image
docker build -t localhost:32000/myapp:v14 .

# 2. Save e import (bypass registry)
docker save localhost:32000/myapp:v14 -o /tmp/myapp.tar
sudo microk8s ctr image import /tmp/myapp.tar

# 3. Update deployment con nuovo tag
kubectl set image deployment/myapp myapp=localhost:32000/myapp:v14 -n mynamespace

# 4. Patch imagePullPolicy se necessario
kubectl patch deployment myapp -n mynamespace \
  --type='json' \
  -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "Never"}]'

# 5. Restart pods
kubectl rollout restart deployment/myapp -n mynamespace
```

## Riferimenti

- [MicroK8s Registry](https://microk8s.io/docs/registry-built-in)
- [Kubernetes imagePullPolicy](https://kubernetes.io/docs/concepts/containers/images/#image-pull-policy)
