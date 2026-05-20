#!/bin/bash
# DEBT-88-C: Genera CA root interna + cert per aia2.lan firmato dalla CA.
# La CA root va importata nel browser per evitare warning self-signed.
# Run UNA VOLTA durante deploy iniziale; il cert è valido 825 giorni (limite browser moderni).

set -e

CERT_DIR="/data/shared-projects/certs"
mkdir -p "$CERT_DIR"

# ─── Root CA (10 anni) ─────────────────────────────────────────────────────────
if [ ! -f "$CERT_DIR/enterprise-ai-ca.key" ]; then
  echo "[INFO] Genero Root CA (Enterprise AI Chat Internal CA)..."
  openssl genrsa -out "$CERT_DIR/enterprise-ai-ca.key" 4096
  openssl req -x509 -new -nodes -key "$CERT_DIR/enterprise-ai-ca.key" -sha256 -days 3650 \
    -out "$CERT_DIR/enterprise-ai-ca.crt" \
    -subj "/CN=Enterprise AI Chat Internal CA/O=enterprise-ai-chat"
  echo "[OK] Root CA generata."
else
  echo "[INFO] Root CA esistente, riutilizzo."
fi

# ─── Server cert per aia2.lan (825 giorni) ─────────────────────────────────────
echo "[INFO] Genero server cert per aia2.lan..."
openssl genrsa -out "$CERT_DIR/aia2-lan-server.key" 4096
openssl req -new -key "$CERT_DIR/aia2-lan-server.key" -out "$CERT_DIR/aia2-lan-server.csr" \
  -subj "/CN=aia2.lan/O=enterprise-ai-chat"

cat > "$CERT_DIR/aia2-lan-server.ext" <<EOF_EXT
subjectAltName = DNS:aia2.lan,DNS:plane.lushlolli.com,DNS:localhost,IP:94.185.104.3,IP:192.168.34.198,IP:127.0.0.1
extendedKeyUsage = serverAuth
EOF_EXT

openssl x509 -req -in "$CERT_DIR/aia2-lan-server.csr" \
  -CA "$CERT_DIR/enterprise-ai-ca.crt" -CAkey "$CERT_DIR/enterprise-ai-ca.key" \
  -CAcreateserial -out "$CERT_DIR/aia2-lan-server.crt" -days 825 -sha256 \
  -extfile "$CERT_DIR/aia2-lan-server.ext"

# Permessi: CA pubblica leggibile (per download utente), chiavi private restritte
chmod 644 "$CERT_DIR/enterprise-ai-ca.crt"
chmod 600 "$CERT_DIR/enterprise-ai-ca.key" "$CERT_DIR/aia2-lan-server.key"

# ─── Update K8s Secret lan-tls ────────────────────────────────────────────────
echo "[INFO] Aggiorno K8s Secret lan-tls..."
sudo /snap/bin/microk8s kubectl create secret tls lan-tls -n enterprise-ai-chat \
  --cert="$CERT_DIR/aia2-lan-server.crt" --key="$CERT_DIR/aia2-lan-server.key" \
  --dry-run=client -o yaml | sudo /snap/bin/microk8s kubectl apply -f -

echo ""
echo "=============================================="
echo "[OK] CA + cert generato."
echo "  CA pubblica per import browser:"
echo "    $CERT_DIR/enterprise-ai-ca.crt"
echo "  Download via web:"
echo "    https://plane.lushlolli.com/api/public/internal-ca.crt"
echo "    https://aia2.lan/api/public/internal-ca.crt"
echo "  Cert server (riferimento):"
echo "    $CERT_DIR/aia2-lan-server.crt"
echo "    valido 825 giorni"
echo "=============================================="
