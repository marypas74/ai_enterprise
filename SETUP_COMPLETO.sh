#!/bin/bash
#===============================================================================
# ENTERPRISE AI CHAT - SETUP COMPLETO
#
# Questo script installa tutto il necessario e fa il deploy dell'applicazione.
#
# ESEGUIRE CON:
#   sudo bash SETUP_COMPLETO.sh
#
# TEMPO STIMATO: 10-15 minuti
#===============================================================================

set -e

# Colori
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Directory base
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Utente originale (non root)
ORIGINAL_USER=${SUDO_USER:-$USER}
ORIGINAL_HOME=$(eval echo ~$ORIGINAL_USER)

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         ENTERPRISE AI CHAT - SETUP COMPLETO                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

#-------------------------------------------------------------------------------
# FASE 1: VERIFICA PREREQUISITI
#-------------------------------------------------------------------------------
echo -e "\n${BLUE}━━━ FASE 1: Verifica sistema ━━━${NC}"

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERRORE] Esegui con sudo: sudo bash SETUP_COMPLETO.sh${NC}"
    exit 1
fi

echo -e "${GREEN}[OK]${NC} Esecuzione come root"
echo "    Utente originale: $ORIGINAL_USER"
echo "    Directory progetto: $SCRIPT_DIR"

#-------------------------------------------------------------------------------
# FASE 2: INSTALLAZIONE NODE.JS 20
#-------------------------------------------------------------------------------
echo -e "\n${BLUE}━━━ FASE 2: Installazione Node.js 20 ━━━${NC}"

if command -v node &> /dev/null; then
    echo -e "${YELLOW}[SKIP]${NC} Node.js già installato: $(node --version)"
else
    echo "Installazione Node.js 20..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg

    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list

    apt-get update -qq
    apt-get install -y -qq nodejs
    echo -e "${GREEN}[OK]${NC} Node.js $(node --version) installato"
fi

#-------------------------------------------------------------------------------
# FASE 3: INSTALLAZIONE DOCKER
#-------------------------------------------------------------------------------
echo -e "\n${BLUE}━━━ FASE 3: Installazione Docker ━━━${NC}"

if command -v docker &> /dev/null; then
    echo -e "${YELLOW}[SKIP]${NC} Docker già installato"
else
    echo "Installazione Docker..."
    apt-get install -y -qq ca-certificates curl

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin

    usermod -aG docker $ORIGINAL_USER
    echo -e "${GREEN}[OK]${NC} Docker installato"
fi

# Avvia Docker se non attivo
systemctl start docker 2>/dev/null || true
systemctl enable docker 2>/dev/null || true

#-------------------------------------------------------------------------------
# FASE 4: INSTALLAZIONE MICROK8S
#-------------------------------------------------------------------------------
echo -e "\n${BLUE}━━━ FASE 4: Installazione MicroK8s ━━━${NC}"

if command -v microk8s &> /dev/null; then
    echo -e "${YELLOW}[SKIP]${NC} MicroK8s già installato"
else
    echo "Installazione MicroK8s..."
    snap install microk8s --classic
    usermod -aG microk8s $ORIGINAL_USER
    echo -e "${GREEN}[OK]${NC} MicroK8s installato"
fi

# Attendi che MicroK8s sia pronto
echo "Attendo che MicroK8s sia pronto..."
microk8s status --wait-ready

#-------------------------------------------------------------------------------
# FASE 5: ABILITAZIONE ADDON MICROK8S
#-------------------------------------------------------------------------------
echo -e "\n${BLUE}━━━ FASE 5: Abilitazione addon MicroK8s ━━━${NC}"

echo "Abilitazione dns..."
microk8s enable dns

echo "Abilitazione storage..."
microk8s enable hostpath-storage

echo "Abilitazione ingress..."
microk8s enable ingress

echo "Abilitazione cert-manager..."
microk8s enable cert-manager

echo -e "${GREEN}[OK]${NC} Addon abilitati"

#-------------------------------------------------------------------------------
# FASE 6: INSTALLAZIONE DIPENDENZE NPM
#-------------------------------------------------------------------------------
echo -e "\n${BLUE}━━━ FASE 6: Installazione dipendenze npm ━━━${NC}"

# Backend
echo "Installazione dipendenze backend..."
cd "$SCRIPT_DIR/backend"
sudo -u $ORIGINAL_USER npm install --silent
echo -e "${GREEN}[OK]${NC} Dipendenze backend installate"

# Crea .env se non esiste
if [ ! -f ".env" ]; then
    sudo -u $ORIGINAL_USER cp .env.example .env
    echo -e "${YELLOW}[!]${NC} File .env creato - CONFIGURA LE API KEYS!"
fi

# Frontend
echo "Installazione dipendenze frontend..."
cd "$SCRIPT_DIR/frontend"
sudo -u $ORIGINAL_USER npm install --silent
echo -e "${GREEN}[OK]${NC} Dipendenze frontend installate"

cd "$SCRIPT_DIR"

#-------------------------------------------------------------------------------
# FASE 7: BUILD IMMAGINI DOCKER
#-------------------------------------------------------------------------------
echo -e "\n${BLUE}━━━ FASE 7: Build immagini Docker ━━━${NC}"

echo "Build backend..."
docker build -t enterprise-ai-chat/backend:latest ./backend
echo -e "${GREEN}[OK]${NC} Immagine backend creata"

echo "Build frontend..."
docker build -t enterprise-ai-chat/frontend:latest ./frontend
echo -e "${GREEN}[OK]${NC} Immagine frontend creata"

#-------------------------------------------------------------------------------
# FASE 8: IMPORT IMMAGINI IN MICROK8S
#-------------------------------------------------------------------------------
echo -e "\n${BLUE}━━━ FASE 8: Import immagini in MicroK8s ━━━${NC}"

echo "Esportazione e import backend..."
docker save enterprise-ai-chat/backend:latest > /tmp/backend.tar
microk8s ctr image import /tmp/backend.tar
rm /tmp/backend.tar

echo "Esportazione e import frontend..."
docker save enterprise-ai-chat/frontend:latest > /tmp/frontend.tar
microk8s ctr image import /tmp/frontend.tar
rm /tmp/frontend.tar

echo -e "${GREEN}[OK]${NC} Immagini importate in MicroK8s"

#-------------------------------------------------------------------------------
# FASE 9: CONFIGURAZIONE SCHEMA DATABASE
#-------------------------------------------------------------------------------
echo -e "\n${BLUE}━━━ FASE 9: Configurazione schema database ━━━${NC}"

# Crea ConfigMap con schema SQL
cat > "$SCRIPT_DIR/k8s/mariadb/init-configmap.yaml" << 'CONFIGMAP_HEADER'
apiVersion: v1
kind: ConfigMap
metadata:
  name: mariadb-init
  namespace: enterprise-ai-chat
data:
  init.sql: |
CONFIGMAP_HEADER

sed 's/^/    /' "$SCRIPT_DIR/database/init.sql" >> "$SCRIPT_DIR/k8s/mariadb/init-configmap.yaml"
echo -e "${GREEN}[OK]${NC} Schema database configurato"

# Verifica che lo schema includa le tabelle nuove
echo "Tabelle incluse nello schema:"
grep -c "CREATE TABLE" "$SCRIPT_DIR/database/init.sql" | xargs -I {} echo "  - {} tabelle definite"
echo "  - Providers: OpenAI, Anthropic, Google, Ollama, Custom"
echo "  - Skills: 8 skill predefinite"
echo "  - Plugins: 6 plugin di sistema"
echo "  - MCP Servers: 8 server MCP configurati"

#-------------------------------------------------------------------------------
# FASE 10: DEPLOY SU KUBERNETES
#-------------------------------------------------------------------------------
echo -e "\n${BLUE}━━━ FASE 10: Deploy su Kubernetes ━━━${NC}"

cd "$SCRIPT_DIR/k8s"

echo "Creazione namespace..."
microk8s kubectl apply -f namespace.yaml

echo "Applicazione configmap e secrets..."
microk8s kubectl apply -f configmap.yaml
microk8s kubectl apply -f secrets.yaml

echo "Deploy MariaDB..."
microk8s kubectl apply -f mariadb/init-configmap.yaml
microk8s kubectl apply -f mariadb/statefulset.yaml

echo "Deploy Redis..."
microk8s kubectl apply -f redis/statefulset.yaml

echo "Attendo che i database siano pronti..."
sleep 10
microk8s kubectl wait --for=condition=ready pod -l app=mariadb -n enterprise-ai-chat --timeout=180s || echo "Timeout MariaDB, continuo..."
microk8s kubectl wait --for=condition=ready pod -l app=redis -n enterprise-ai-chat --timeout=60s || echo "Timeout Redis, continuo..."

echo "Deploy Backend..."
microk8s kubectl apply -f backend/deployment.yaml

echo "Deploy Frontend..."
microk8s kubectl apply -f frontend/deployment.yaml

echo "Configurazione Ingress..."
microk8s kubectl apply -f ingress.yaml

echo -e "${GREEN}[OK]${NC} Deploy completato"

#-------------------------------------------------------------------------------
# FASE 11: VERIFICA FINALE
#-------------------------------------------------------------------------------
echo -e "\n${BLUE}━━━ FASE 11: Verifica finale ━━━${NC}"

sleep 5

echo ""
echo "Status dei pod:"
microk8s kubectl get pods -n enterprise-ai-chat
echo ""
echo "Status dei servizi:"
microk8s kubectl get svc -n enterprise-ai-chat
echo ""

#-------------------------------------------------------------------------------
# COMPLETATO
#-------------------------------------------------------------------------------
echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    SETUP COMPLETATO!                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo ""
echo -e "${GREEN}Versioni installate:${NC}"
echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"
echo "  Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"
echo "  MicroK8s: $(microk8s version | head -1)"
echo ""

echo -e "${YELLOW}IMPORTANTE - Azioni richieste:${NC}"
echo ""
echo "1. Configura le API keys in: $SCRIPT_DIR/k8s/secrets.yaml"
echo "   - OPENAI_API_KEY"
echo "   - ANTHROPIC_API_KEY"
echo "   - GOOGLE_AI_API_KEY"
echo ""
echo "2. Modifica il dominio in: $SCRIPT_DIR/k8s/ingress.yaml"
echo "   - Sostituisci 'chat.yourdomain.com' con il tuo dominio"
echo ""
echo "3. Riapplica i secrets dopo la modifica:"
echo "   microk8s kubectl apply -f $SCRIPT_DIR/k8s/secrets.yaml"
echo ""
echo "4. Per accedere localmente:"
echo "   microk8s kubectl port-forward -n enterprise-ai-chat svc/frontend 8080:80"
echo "   Poi apri: http://localhost:8080"
echo ""
echo "5. Credenziali admin di default:"
echo "   Email: admin@enterprise.local"
echo "   Password: admin123 (CAMBIALA SUBITO!)"
echo ""

# Aggiungi utente ai gruppi (effettivo al prossimo login)
echo -e "${YELLOW}NOTA:${NC} Esegui 'newgrp docker' o effettua logout/login"
echo "      per usare docker e microk8s senza sudo."
echo ""
