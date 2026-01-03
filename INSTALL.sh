#!/bin/bash
# Enterprise AI Chat - Script di installazione
# Esegui con: sudo bash INSTALL.sh

set -e

echo "=========================================="
echo "Enterprise AI Chat - Installazione"
echo "=========================================="

# Colori
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Funzione per stampare status
print_status() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verifica se eseguito come root
if [ "$EUID" -ne 0 ]; then
    print_error "Questo script deve essere eseguito come root (sudo)"
    exit 1
fi

# 1. Aggiorna sistema
echo ""
echo "1. Aggiornamento sistema..."
apt-get update
print_status "Sistema aggiornato"

# 2. Installa Node.js 20
echo ""
echo "2. Installazione Node.js 20..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    print_warning "Node.js già installato: $NODE_VERSION"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    print_status "Node.js $(node --version) installato"
fi

# 3. Installa Docker
echo ""
echo "3. Installazione Docker..."
if command -v docker &> /dev/null; then
    print_warning "Docker già installato: $(docker --version)"
else
    # Installa prerequisiti
    apt-get install -y ca-certificates curl gnupg

    # Aggiungi chiave GPG Docker
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Aggiungi repository Docker
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Installa Docker
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Aggiungi utente corrente al gruppo docker
    SUDO_USER_REAL=${SUDO_USER:-$USER}
    usermod -aG docker $SUDO_USER_REAL

    print_status "Docker installato"
    print_warning "Esegui 'newgrp docker' o logout/login per usare Docker senza sudo"
fi

# 4. Installa MicroK8s
echo ""
echo "4. Installazione MicroK8s..."
if command -v microk8s &> /dev/null; then
    print_warning "MicroK8s già installato"
else
    snap install microk8s --classic

    # Aggiungi utente al gruppo microk8s
    SUDO_USER_REAL=${SUDO_USER:-$USER}
    usermod -aG microk8s $SUDO_USER_REAL

    # Crea alias kubectl
    snap alias microk8s.kubectl kubectl

    print_status "MicroK8s installato"
fi

# 5. Abilita addon MicroK8s
echo ""
echo "5. Abilitazione addon MicroK8s..."
microk8s status --wait-ready
microk8s enable dns
microk8s enable storage
microk8s enable ingress
microk8s enable cert-manager
print_status "Addon MicroK8s abilitati (dns, storage, ingress, cert-manager)"

# 6. Verifica installazione
echo ""
echo "=========================================="
echo "Verifica installazione"
echo "=========================================="
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"
echo "Docker: $(docker --version)"
echo "MicroK8s: $(microk8s version)"
echo ""
print_status "Installazione completata!"
echo ""
echo "Prossimi passi:"
echo "1. Esegui 'newgrp docker' o logout/login"
echo "2. Configura le API keys in backend/.env"
echo "3. Esegui: cd /home/mpasqui/enterprise-ai-chat && bash BUILD.sh"
