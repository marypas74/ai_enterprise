#!/bin/bash
#===============================================================================
# ENTERPRISE AI CHAT - DEPLOY RAPIDO
#
# Esegui questo script per fare il deploy delle nuove immagini su MicroK8s.
# ESEGUIRE CON: sudo bash DEPLOY.sh
#===============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}    ENTERPRISE AI CHAT - Deploy Rapido${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Esegui con sudo: sudo bash DEPLOY.sh${NC}"
    exit 1
fi

# Importa immagini in MicroK8s
echo -e "${YELLOW}[1/4]${NC} Importando immagini in MicroK8s..."
if [ -f /tmp/backend.tar ]; then
    microk8s ctr image import /tmp/backend.tar
    echo -e "${GREEN}[OK]${NC} Backend importato"
else
    echo -e "${YELLOW}[SKIP]${NC} /tmp/backend.tar non trovato, esegui prima il build"
fi

if [ -f /tmp/frontend.tar ]; then
    microk8s ctr image import /tmp/frontend.tar
    echo -e "${GREEN}[OK]${NC} Frontend importato"
else
    echo -e "${YELLOW}[SKIP]${NC} /tmp/frontend.tar non trovato, esegui prima il build"
fi

# Determina namespace
NAMESPACE="enterprise-ai"
if ! microk8s kubectl get ns "$NAMESPACE" &>/dev/null; then
    NAMESPACE="enterprise-ai-chat"
fi
echo -e "${GREEN}[OK]${NC} Namespace: $NAMESPACE"

# Riavvia deployments
echo -e "${YELLOW}[2/4]${NC} Riavviando backend..."
microk8s kubectl rollout restart deployment/backend -n "$NAMESPACE" 2>/dev/null || \
    echo -e "${YELLOW}[SKIP]${NC} Deployment backend non trovato"

echo -e "${YELLOW}[3/4]${NC} Riavviando frontend..."
microk8s kubectl rollout restart deployment/frontend -n "$NAMESPACE" 2>/dev/null || \
    echo -e "${YELLOW}[SKIP]${NC} Deployment frontend non trovato"

# Attendi e verifica
echo -e "${YELLOW}[4/4]${NC} Verificando status..."
sleep 5
microk8s kubectl get pods -n "$NAMESPACE"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}    Deploy completato!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Accesso: https://192.168.1.123"
echo "Admin: admin@enterprise.local / admin123"
echo ""
