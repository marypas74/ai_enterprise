#!/bin/bash
# Enterprise AI Chat - Script di build e deploy
# Esegui con: bash BUILD.sh

set -e

echo "=========================================="
echo "Enterprise AI Chat - Build & Deploy"
echo "=========================================="

# Colori
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${GREEN}[OK]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_step() { echo -e "\n${BLUE}==> $1${NC}"; }

# Directory base
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BASE_DIR"

# 1. Installa dipendenze Backend
print_step "1. Installazione dipendenze Backend..."
cd backend
if [ ! -d "node_modules" ]; then
    npm install
    print_status "Dipendenze backend installate"
else
    print_warning "node_modules già presente, skip"
fi

# Crea .env se non esiste
if [ ! -f ".env" ]; then
    cp .env.example .env
    print_warning "File .env creato da .env.example"
    print_warning "IMPORTANTE: Configura le API keys in backend/.env"
fi
cd ..

# 2. Installa dipendenze Frontend
print_step "2. Installazione dipendenze Frontend..."
cd frontend
if [ ! -d "node_modules" ]; then
    npm install
    print_status "Dipendenze frontend installate"
else
    print_warning "node_modules già presente, skip"
fi
cd ..

# 3. Build Docker Backend
print_step "3. Build immagine Docker Backend..."
docker build -t enterprise-ai-chat/backend:latest ./backend
print_status "Immagine backend creata"

# 4. Build Docker Frontend
print_step "4. Build immagine Docker Frontend..."
docker build -t enterprise-ai-chat/frontend:latest ./frontend
print_status "Immagine frontend creata"

# 5. Import in MicroK8s
print_step "5. Import immagini in MicroK8s..."
docker save enterprise-ai-chat/backend:latest > /tmp/backend.tar
docker save enterprise-ai-chat/frontend:latest > /tmp/frontend.tar
microk8s ctr image import /tmp/backend.tar
microk8s ctr image import /tmp/frontend.tar
rm /tmp/backend.tar /tmp/frontend.tar
print_status "Immagini importate in MicroK8s"

# 6. Copia schema database nel ConfigMap
print_step "6. Configurazione schema database..."
# Aggiorna il ConfigMap con lo schema SQL reale
cat > k8s/mariadb/init-configmap.yaml << 'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: mariadb-init
  namespace: enterprise-ai-chat
data:
  init.sql: |
EOF
sed 's/^/    /' database/init.sql >> k8s/mariadb/init-configmap.yaml
print_status "Schema database configurato"

# 7. Deploy su Kubernetes
print_step "7. Deploy su Kubernetes..."
microk8s kubectl apply -f k8s/namespace.yaml
microk8s kubectl apply -f k8s/configmap.yaml
microk8s kubectl apply -f k8s/secrets.yaml
microk8s kubectl apply -f k8s/mariadb/init-configmap.yaml
microk8s kubectl apply -f k8s/mariadb/statefulset.yaml
microk8s kubectl apply -f k8s/redis/statefulset.yaml

# Attendi che MariaDB sia pronto
echo "Attendo che MariaDB sia pronto..."
microk8s kubectl wait --for=condition=ready pod -l app=mariadb -n enterprise-ai-chat --timeout=120s || true

microk8s kubectl apply -f k8s/backend/deployment.yaml
microk8s kubectl apply -f k8s/frontend/deployment.yaml
microk8s kubectl apply -f k8s/ingress.yaml

print_status "Deploy completato!"

# 8. Verifica status
print_step "8. Verifica status..."
echo ""
microk8s kubectl get all -n enterprise-ai-chat
echo ""

# Info finali
echo "=========================================="
echo -e "${GREEN}Deploy completato!${NC}"
echo "=========================================="
echo ""
echo "Comandi utili:"
echo "  microk8s kubectl get pods -n enterprise-ai-chat -w"
echo "  microk8s kubectl logs -n enterprise-ai-chat deployment/backend"
echo "  microk8s kubectl logs -n enterprise-ai-chat deployment/frontend"
echo ""
echo "Accesso:"
echo "  - Modifica /etc/hosts per puntare chat.yourdomain.com al tuo IP"
echo "  - Oppure usa: microk8s kubectl port-forward -n enterprise-ai-chat svc/frontend 8080:80"
echo "    e accedi a http://localhost:8080"
echo ""
print_warning "RICORDA: Configura le API keys reali in k8s/secrets.yaml e riapplica!"
