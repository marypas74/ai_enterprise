# Enterprise AI Chat - Guida Configurazione

## Struttura Progetto

```
enterprise-ai-chat/
├── backend/                 # API Backend (Fastify + TypeScript)
├── frontend/                # Web Frontend (React + Vite)
├── vscode-extension/        # Estensione VS Code
├── k8s/                     # Configurazioni Kubernetes
│   ├── backend/
│   ├── frontend/
│   ├── storage/            # PersistentVolumes per storage condiviso
│   ├── mariadb/
│   └── redis/
└── scripts/                 # Script di deployment e setup
```

## Storage Condiviso (Windows/Linux)

### Directory Principale
- **Path Server**: `/data/shared-projects`
- **Path Container**: `/data/projects`
- **Accesso Windows**: `\\192.168.1.123\projects`
- **Accesso Linux**: `mount -t cifs //192.168.1.123/projects /mnt/projects`

### Struttura Directory Condivisa
```
/data/shared-projects/
├── extensions/              # File .vsix per VS Code Extension
│   ├── enterprise-ai-chat-2.9.1.vsix
│   └── ...
├── agents/                  # Working directory per agent sessions
│   ├── session_1/
│   └── ...
└── repositories/            # Repository git clonati
```

## VS Code Extension

### Pubblicazione Nuove Versioni
1. Build dell'estensione:
   ```bash
   cd vscode-extension
   npm run package
   ```

2. Copia nella cartella condivisa:
   ```bash
   cp enterprise-ai-chat-*.vsix /data/shared-projects/extensions/
   ```

3. L'estensione sarà disponibile per il download dalla web app

### Percorso File Estensioni
- **Variabile ambiente**: `EXTENSION_DIR`
- **Default**: `/data/projects/extensions`
- **Accessibile da Windows**: `\\192.168.1.123\projects\extensions`

## Deployment

### Versioning
- **Frontend**: `frontend/package.json` → `version`
- **Backend**: `backend/package.json` → `version`
- **Extension**: `vscode-extension/package.json` → `version`

### Comandi Deploy

```bash
# Deploy completo
sudo ./scripts/deploy-v1.2.0.sh

# Build e deploy manuale frontend
cd frontend
npm run build
docker build -t enterprise-ai-chat-frontend:1.2.0 .
docker save enterprise-ai-chat-frontend:1.2.0 -o /tmp/frontend.tar
sudo microk8s ctr image import /tmp/frontend.tar
sudo microk8s kubectl set image deployment/frontend frontend=docker.io/library/enterprise-ai-chat-frontend:1.2.0 -n enterprise-ai-chat

# Build e deploy backend
cd backend
npm run build
docker build -t enterprise-ai-chat-backend:1.1.0 .
docker save enterprise-ai-chat-backend:1.1.0 -o /tmp/backend.tar
sudo microk8s ctr image import /tmp/backend.tar
sudo microk8s kubectl set image deployment/backend backend=docker.io/library/enterprise-ai-chat-backend:1.1.0 -n enterprise-ai-chat
```

### Regola: Aggiornamento Guide

Ogni nuova feature con esposizione **utente** o **amministratore** DEVE includere
l'aggiornamento del record corrispondente in `guide_pages` (slug `user` o `admin`)
nella stessa PR. Il code-reviewer e il senior-supervisor verificano la presenza
dell'aggiornamento prima dell'approvazione.

- Sorgenti seed: `backend/src/guides/user-guide.html`, `backend/src/guides/admin-guide.html`
- CMS admin: `/admin/guides` (UI), `PUT /api/admin/guides/:slug` (API)
- Lettura utente: `/help` (UI), `GET /api/guides/:slug` (API JWT user)

### Verifica Deployment
```bash
sudo microk8s kubectl get pods -n enterprise-ai-chat
sudo microk8s kubectl rollout status deployment/frontend -n enterprise-ai-chat
sudo microk8s kubectl rollout status deployment/backend -n enterprise-ai-chat
```

## Configurazione AI Providers

I modelli AI vengono caricati dinamicamente dal backend in base ai provider configurati nel pannello admin.

### Endpoint API
- `GET /api/chat/models` - Restituisce solo i modelli dei provider abilitati con API key configurata

### Provider Supportati
- OpenAI (GPT-4o, GPT-4o-mini)
- Anthropic (Claude 3.5 Sonnet, Claude 3 Opus)
- Google (Gemini 2.0 Flash, Gemini 1.5 Pro)

## Risoluzione Problemi

### Errore 401 Unauthorized
1. Fai logout dalla web app
2. Fai login di nuovo per ottenere un nuovo token

### Estensione VS Code non si scarica
1. Verifica che i file .vsix siano in `/data/shared-projects/extensions/`
2. Verifica i permessi: `sudo chown -R ai-chat:ai-chat /data/shared-projects/extensions/`

### Pod non si avvia
```bash
sudo microk8s kubectl describe pod -l app=backend -n enterprise-ai-chat
sudo microk8s kubectl logs -l app=backend -n enterprise-ai-chat
```

## Setup Iniziale Storage Condiviso

```bash
# 1. Esegui script setup Samba
sudo ./scripts/setup-shared-storage.sh /data/shared-projects

# 2. Imposta password Samba
sudo smbpasswd -a ai-chat

# 3. Crea directory per estensioni
sudo mkdir -p /data/shared-projects/extensions
sudo chown -R ai-chat:ai-chat /data/shared-projects

# 4. Copia estensioni esistenti
sudo cp /home/mpasqui/enterprise-ai-chat/vscode-extension/*.vsix /data/shared-projects/extensions/

# 5. Applica configurazione Kubernetes
sudo microk8s kubectl apply -f k8s/storage/shared-projects-pv.yaml
```

## Parlant - AI Agent Framework

Parlant è un framework Python per creare agenti AI con comportamento controllato tramite guidelines.

### Architettura
- **Deployment Kubernetes**: `k8s/parlant/`
- **Immagine Docker**: `localhost:32000/enterprise-ai-chat/parlant:1.0.1`
- **Porta**: 8800
- **Documentazione**: https://github.com/emcie-co/parlant

### Configurazione API Keys
Parlant richiede una API key OpenAI o Anthropic per funzionare. Le chiavi vengono lette dal secret `app-secrets`:

```bash
# Aggiorna il secret con una API key reale
kubectl create secret generic app-secrets \
  --from-literal=OPENAI_API_KEY='sk-your-real-key' \
  --from-literal=ANTHROPIC_API_KEY='sk-ant-your-real-key' \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Deploy Parlant
```bash
# Applica storage e deployment
sudo microk8s kubectl apply -f k8s/parlant/storage.yaml
sudo microk8s kubectl apply -f k8s/parlant/deployment.yaml

# Verifica stato
sudo microk8s kubectl get pods -n enterprise-ai-chat -l app=parlant
sudo microk8s kubectl logs deployment/parlant -n enterprise-ai-chat
```

### Caratteristiche Parlant
- **Guidelines**: Regole comportamentali in linguaggio naturale
- **Journeys**: Percorsi conversazionali step-by-step
- **Tool Integration**: Integrazione con API esterne
- **Explainability**: Trasparenza sul perché le guidelines vengono applicate

### Integrazione con Enterprise AI Chat
- Backend API: `/api/parlant/*` (da implementare)
- Frontend UI: Pagina dedicata per gestione agenti Parlant
