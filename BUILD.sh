#!/bin/bash
# Enterprise AI Chat - Script di build e deploy
# Esegui con: bash BUILD.sh

# AI-77/2.1.78: ensure /snap/bin is in PATH so microk8s is available when run via sudo
export PATH=/snap/bin:$PATH

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

# Estrai versione dal backend/package.json (fonte unica di verità)
VERSION=$(grep '"version":' backend/package.json | head -1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')

echo -e "${BLUE}Versione: ${VERSION}${NC}"

# Sincronizza la versione in tutti i package.json e nei manifest K8s
print_step "0. Sincronizzazione versione ${VERSION} in tutti i componenti..."

# Aggiorna frontend/package.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" frontend/package.json
print_status "frontend/package.json -> ${VERSION}"

# Aggiorna vscode-extension/package.json (se presente)
if [ -f "vscode-extension/package.json" ]; then
    sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" vscode-extension/package.json
    print_status "vscode-extension/package.json -> ${VERSION}"
fi

# Aggiorna K8s deployment manifests
sed -i "s|enterprise-ai-chat-backend:[0-9.]*|enterprise-ai-chat-backend:${VERSION}|g" k8s/backend/deployment.yaml
sed -i "s|enterprise-ai-chat-frontend:[0-9.]*|enterprise-ai-chat-frontend:${VERSION}|g" k8s/frontend/deployment.yaml
print_status "K8s manifests -> ${VERSION}"

# Usa la stessa versione per backend e frontend
BACKEND_VERSION="${VERSION}"
FRONTEND_VERSION="${VERSION}"

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
docker build -t localhost:32000/enterprise-ai-chat-backend:latest ./backend
docker build -t localhost:32000/enterprise-ai-chat-backend:${BACKEND_VERSION} ./backend
print_status "Immagine backend creata (latest e ${BACKEND_VERSION})"

# 4. Build Docker Frontend
print_step "4. Build immagine Docker Frontend..."
docker build -t localhost:32000/enterprise-ai-chat-frontend:latest ./frontend
docker build -t localhost:32000/enterprise-ai-chat-frontend:${FRONTEND_VERSION} ./frontend
print_status "Immagine frontend creata (latest e ${FRONTEND_VERSION})"

# 4b. Build Docker Doc-Processor (microservizio elaborazione documenti)
DOC_PROCESSOR_VERSION="1.0.0"
print_step "4b. Build immagine Docker doc-processor..."
if [ -d "doc-processor" ]; then
    cd doc-processor
    if [ ! -d "node_modules" ]; then
        npm install
        print_status "Dipendenze doc-processor installate"
    fi
    npm run build
    cd ..
    docker build -t localhost:32000/doc-processor:latest ./doc-processor
    docker build -t localhost:32000/doc-processor:${DOC_PROCESSOR_VERSION} ./doc-processor
    print_status "Immagine doc-processor creata (latest e ${DOC_PROCESSOR_VERSION})"
else
    print_warning "Directory doc-processor non trovata, skip"
fi

# 4c. Build Docker Marketplace
MARKETPLACE_VERSION="1.0.0"
print_step "4c. Build immagine Docker Marketplace..."
if [ -d "marketplace" ]; then
    cd marketplace
    if [ ! -d "node_modules" ]; then
        npm ci
        print_status "Dipendenze marketplace installate"
    fi
    npm run build
    cd ..
    docker build -t localhost:32000/enterprise-ai-chat/marketplace:latest ./marketplace
    docker build -t localhost:32000/enterprise-ai-chat/marketplace:${MARKETPLACE_VERSION} ./marketplace
    print_status "Immagine marketplace creata (latest e ${MARKETPLACE_VERSION})"
else
    print_warning "Directory marketplace non trovata, skip"
fi

# 5. Push immagini al registry localhost:32000 (necessario per il pull dei pod K8s)
print_step "5. Push immagini al registry localhost:32000..."
docker push localhost:32000/enterprise-ai-chat-backend:${BACKEND_VERSION}
docker push localhost:32000/enterprise-ai-chat-backend:latest
print_status "Backend pushato al registry (${BACKEND_VERSION} e latest)"

docker push localhost:32000/enterprise-ai-chat-frontend:${FRONTEND_VERSION}
docker push localhost:32000/enterprise-ai-chat-frontend:latest
print_status "Frontend pushato al registry (${FRONTEND_VERSION} e latest)"

# Push doc-processor se disponibile
if docker image inspect localhost:32000/doc-processor:${DOC_PROCESSOR_VERSION} >/dev/null 2>&1; then
    docker push localhost:32000/doc-processor:${DOC_PROCESSOR_VERSION}
    docker push localhost:32000/doc-processor:latest
    print_status "doc-processor pushato al registry (${DOC_PROCESSOR_VERSION} e latest)"
fi

# Push marketplace se disponibile
if docker image inspect localhost:32000/enterprise-ai-chat/marketplace:${MARKETPLACE_VERSION} >/dev/null 2>&1; then
    docker push localhost:32000/enterprise-ai-chat/marketplace:${MARKETPLACE_VERSION}
    docker push localhost:32000/enterprise-ai-chat/marketplace:latest
    print_status "marketplace pushato al registry (${MARKETPLACE_VERSION} e latest)"
fi

# 6. Import in MicroK8s (containerd locale — complementare al registry pull)
print_step "6. Import immagini in MicroK8s (containerd locale)..."
docker save localhost:32000/enterprise-ai-chat-backend:${BACKEND_VERSION} > /tmp/backend.tar
docker save localhost:32000/enterprise-ai-chat-frontend:${FRONTEND_VERSION} > /tmp/frontend.tar
microk8s ctr image import /tmp/backend.tar
microk8s ctr image import /tmp/frontend.tar
rm /tmp/backend.tar /tmp/frontend.tar

# Import doc-processor se disponibile
if docker image inspect localhost:32000/doc-processor:${DOC_PROCESSOR_VERSION} >/dev/null 2>&1; then
    docker save localhost:32000/doc-processor:${DOC_PROCESSOR_VERSION} > /tmp/doc-processor.tar
    microk8s ctr image import /tmp/doc-processor.tar
    rm /tmp/doc-processor.tar
    print_status "Immagine doc-processor importata in MicroK8s"
fi

# Import marketplace se disponibile
if docker image inspect localhost:32000/enterprise-ai-chat/marketplace:${MARKETPLACE_VERSION} >/dev/null 2>&1; then
    docker save localhost:32000/enterprise-ai-chat/marketplace:${MARKETPLACE_VERSION} > /tmp/marketplace.tar
    microk8s ctr image import /tmp/marketplace.tar
    rm /tmp/marketplace.tar
    print_status "Immagine marketplace importata in MicroK8s"
fi

print_status "Immagini versionate importate in MicroK8s"

# 7. Copia schema database nel ConfigMap
print_step "7. Configurazione schema database..."
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

# 8. Deploy su Kubernetes
print_step "8. Deploy su Kubernetes..."
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

# Deploy doc-processor se il manifest esiste
if [ -f "k8s/doc-processor/deployment.yaml" ]; then
    microk8s kubectl apply -f k8s/doc-processor/deployment.yaml
    print_status "doc-processor deployato"
fi

# Deploy marketplace se i manifest esistono
if [ -d "k8s/marketplace" ]; then
    microk8s kubectl apply -f k8s/marketplace/
    print_status "marketplace deployato"
fi

microk8s kubectl apply -f k8s/ingress.yaml

# Aggiorna la versione nel database (unica fonte di verità)
print_step "8b. Aggiornamento versione nel database..."
MARIADB_POD=$(microk8s kubectl get pod -l app=mariadb -n enterprise-ai-chat -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ -n "$MARIADB_POD" ]; then
    microk8s kubectl exec -n enterprise-ai-chat "$MARIADB_POD" -- \
        mysql -u root -p"${MYSQL_ROOT_PASSWORD:-enterprise_root_pwd}" enterprise_ai_chat \
        -e "INSERT INTO system_settings (setting_key, setting_value, setting_type, description, is_public) VALUES ('app_version', '${VERSION}', 'string', 'Versione corrente dell''applicazione', TRUE) ON DUPLICATE KEY UPDATE setting_value = '${VERSION}';" 2>/dev/null \
        && print_status "Versione ${VERSION} aggiornata nel database" \
        || print_warning "Impossibile aggiornare la versione nel DB (verrà aggiornata al prossimo init)"
else
    print_warning "Pod MariaDB non trovato, la versione sarà impostata dall'init.sql"
fi

print_status "Deploy completato!"

# 9. Verifica status
print_step "9. Verifica status..."
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
