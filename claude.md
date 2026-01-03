# CLAUDE.md - Istruzioni per Claude Code

## Panoramica del Progetto

Questo è **Enterprise AI Chat**, una piattaforma di chat AI enterprise con:
- Supporto multi-provider (OpenAI, Anthropic, Google Gemini)
- Autenticazione JWT con gestione utenti e gruppi
- Frontend React moderno con interfaccia stile Claude
- Deploy su Kubernetes (MicroK8s) con TLS automatico

## Struttura del Progetto

```
enterprise-ai-chat/
├── backend/           # Node.js + Fastify + TypeScript
├── frontend/          # React + Vite + Tailwind
├── k8s/               # Manifesti Kubernetes
├── database/          # Script SQL (init.sql)
├── skill.md           # Competenze tecniche
└── claude.md          # Questo file
```

## Comandi Principali

### Sviluppo Locale

```bash
# Backend
cd backend
npm install
cp .env.example .env  # Configurare le variabili
npm run dev           # Avvia in modalità sviluppo

# Frontend
cd frontend
npm install
npm run dev           # Avvia Vite dev server
```

### Build con Buildah (NO Docker)

```bash
# Abilita registry MicroK8s
microk8s enable registry

# Build immagini con Buildah
sudo buildah build -t localhost:32000/enterprise-ai-chat/backend:latest ./backend
sudo buildah build -t localhost:32000/enterprise-ai-chat/frontend:latest ./frontend

# Push al registry MicroK8s (porta 32000)
sudo buildah push --tls-verify=false localhost:32000/enterprise-ai-chat/backend:latest
sudo buildah push --tls-verify=false localhost:32000/enterprise-ai-chat/frontend:latest
```

> **Nota**: Non usiamo Docker. Buildah crea immagini OCI compatibili direttamente.

### Deploy Kubernetes

```bash
# Prerequisiti MicroK8s
microk8s enable dns storage ingress cert-manager

# Deploy applicazione
microk8s kubectl apply -k k8s/

# Verifica stato
microk8s kubectl get all -n enterprise-ai-chat
```

## Convenzioni Codice

### Backend (TypeScript)
- Usa Fastify plugins per modularità
- Schema validation con Zod
- Async/await per operazioni DB
- SSE per streaming responses

### Frontend (React)
- Functional components con hooks
- Zustand per state management
- Tailwind per styling (no CSS custom)
- TypeScript strict mode

## File Critici

| File | Descrizione |
|------|-------------|
| `backend/src/index.ts` | Entry point server |
| `backend/src/modules/ai/providers.ts` | Abstraction layer AI |
| `backend/src/modules/auth/routes.ts` | Autenticazione JWT |
| `backend/src/modules/chat/routes.ts` | Chat con streaming |
| `frontend/src/pages/ChatPage.tsx` | Interfaccia chat principale |
| `k8s/ingress.yaml` | Configurazione TLS/routing |

## Variabili d'Ambiente Richieste

```env
# API Keys (richieste)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_API_KEY=...

# Database
DB_HOST=localhost
DB_PASSWORD=...

# JWT
JWT_SECRET=...
```

## Note Importanti

1. **Node.js 20+** richiesto per Fastify 5
2. **@google/generative-ai è DEPRECATO** - usa `@google/genai`
3. Modifica `chat.yourdomain.com` nei file K8s con il tuo dominio
4. I Secrets in `k8s/secrets.yaml` devono essere aggiornati prima del deploy
5. L'utente admin di default ha password `admin123` - cambiare subito!

## Troubleshooting

### MariaDB non si avvia
```bash
microk8s kubectl logs -n enterprise-ai-chat mariadb-0
```

### Backend non connette al DB
- Verificare che MariaDB sia ready
- Controllare secrets e configmap

### TLS non funziona
```bash
# Verifica cert-manager
microk8s kubectl get certificates -n enterprise-ai-chat
microk8s kubectl describe clusterissuer letsencrypt-prod
```

### SSE streaming non funziona
- Verificare `proxy_buffering off` in nginx/ingress
- Controllare timeout settings
