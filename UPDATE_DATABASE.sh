#!/bin/bash
#===============================================================================
# ENTERPRISE AI CHAT - AGGIORNAMENTO DATABASE
#
# Questo script aggiorna solo il database MariaDB con il nuovo schema.
# Usa questo script se hai già l'ambiente configurato e vuoi solo
# applicare le nuove tabelle per Skills, Plugins e MCP.
#
# ESEGUIRE CON:
#   sudo bash UPDATE_DATABASE.sh
#
# ATTENZIONE: Questo script CANCELLA e RICREA il database!
# Tutti i dati esistenti verranno persi.
#===============================================================================

set -e

# Colori
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}    ENTERPRISE AI CHAT - Aggiornamento Database${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Verifica esecuzione come root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERRORE] Esegui con sudo: sudo bash UPDATE_DATABASE.sh${NC}"
    exit 1
fi

# Trova il pod MariaDB
echo -e "${YELLOW}[1/4]${NC} Cercando pod MariaDB..."
MARIADB_POD=$(microk8s kubectl get pods -n enterprise-ai -l app=mariadb -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || \
              microk8s kubectl get pods -n enterprise-ai-chat -l app=mariadb -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

if [ -z "$MARIADB_POD" ]; then
    echo -e "${RED}[ERRORE] Pod MariaDB non trovato!${NC}"
    echo "Verifica che il deployment sia attivo con:"
    echo "  microk8s kubectl get pods -n enterprise-ai"
    exit 1
fi

# Determina il namespace
NAMESPACE=$(microk8s kubectl get pods -A | grep "$MARIADB_POD" | awk '{print $1}')
echo -e "${GREEN}[OK]${NC} Pod trovato: $MARIADB_POD (namespace: $NAMESPACE)"

# Conferma
echo ""
echo -e "${RED}ATTENZIONE: Questo cancellerà TUTTI i dati esistenti!${NC}"
read -p "Sei sicuro di voler continuare? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Operazione annullata."
    exit 0
fi

# Drop e ricrea database
echo -e "${YELLOW}[2/4]${NC} Ricreando database..."
microk8s kubectl exec -n "$NAMESPACE" "$MARIADB_POD" -- mysql -u root -pEnterprise2024! -e \
    "DROP DATABASE IF EXISTS enterprise_ai_chat; CREATE DATABASE enterprise_ai_chat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo -e "${GREEN}[OK]${NC} Database ricreato"

# Copia e applica schema
echo -e "${YELLOW}[3/4]${NC} Applicando nuovo schema..."
microk8s kubectl cp "$SCRIPT_DIR/database/init.sql" "$NAMESPACE/$MARIADB_POD:/tmp/init.sql"
microk8s kubectl exec -n "$NAMESPACE" "$MARIADB_POD" -- bash -c "mysql -u root -pEnterprise2024! enterprise_ai_chat < /tmp/init.sql"
echo -e "${GREEN}[OK]${NC} Schema applicato"

# Verifica
echo -e "${YELLOW}[4/4]${NC} Verificando tabelle..."
TABLE_COUNT=$(microk8s kubectl exec -n "$NAMESPACE" "$MARIADB_POD" -- mysql -u root -pEnterprise2024! enterprise_ai_chat -N -e \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'enterprise_ai_chat';" 2>/dev/null)

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}    Aggiornamento completato!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Tabelle create: $TABLE_COUNT"
echo ""
echo "Nuove funzionalità disponibili:"
echo "  - Skills Management (8 skill predefinite)"
echo "  - Plugins Management (6 plugin di sistema)"
echo "  - MCP Servers (8 server configurati)"
echo "  - Tools per function calling"
echo "  - Kanban/Projects Management"
echo ""
echo "Credenziali admin:"
echo "  - Email: admin@enterprise.local"
echo "  - Password: admin123"
echo ""

# Lista tabelle
echo "Tabelle nel database:"
microk8s kubectl exec -n "$NAMESPACE" "$MARIADB_POD" -- mysql -u root -pEnterprise2024! enterprise_ai_chat -e "SHOW TABLES;" 2>/dev/null | tail -n +2 | column
echo ""
