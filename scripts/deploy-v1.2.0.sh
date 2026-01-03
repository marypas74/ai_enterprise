#!/bin/bash
#
# Deploy Enterprise AI Chat v1.2.0
# Run with: sudo ./scripts/deploy-v1.2.0.sh
#

set -e

echo "============================================"
echo " Enterprise AI Chat - Deploy v1.2.0"
echo "============================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Error: Please run as root (sudo)"
    exit 1
fi

# Step 1: Setup shared storage directory
echo "[1/7] Setting up shared storage..."
mkdir -p /data/shared-projects/extensions
mkdir -p /data/shared-projects/agents
mkdir -p /data/shared-projects/repositories
chown -R 1001:1001 /data/shared-projects 2>/dev/null || true
chmod -R 2775 /data/shared-projects
echo "      Done."

# Step 2: Copy VS Code extensions to shared folder
echo "[2/7] Copying VS Code extensions..."
if ls /home/mpasqui/enterprise-ai-chat/vscode-extension/*.vsix 1> /dev/null 2>&1; then
    cp /home/mpasqui/enterprise-ai-chat/vscode-extension/*.vsix /data/shared-projects/extensions/
    echo "      Copied $(ls /data/shared-projects/extensions/*.vsix 2>/dev/null | wc -l) extension files."
else
    echo "      No .vsix files found to copy."
fi

# Step 3: Import Docker images
echo "[3/7] Importing Docker images..."
if [ -f /tmp/enterprise-ai-chat-frontend-1.2.0.tar ]; then
    microk8s ctr image import /tmp/enterprise-ai-chat-frontend-1.2.0.tar
    echo "      Frontend image imported."
else
    echo "      WARNING: Frontend image not found at /tmp/enterprise-ai-chat-frontend-1.2.0.tar"
fi

if [ -f /tmp/enterprise-ai-chat-backend-1.2.0.tar ]; then
    microk8s ctr image import /tmp/enterprise-ai-chat-backend-1.2.0.tar
    echo "      Backend image imported."
else
    echo "      WARNING: Backend image not found at /tmp/enterprise-ai-chat-backend-1.2.0.tar"
fi

# Step 4: Apply storage configuration
echo "[4/7] Applying storage configuration..."
microk8s kubectl apply -f /home/mpasqui/enterprise-ai-chat/k8s/storage/shared-projects-pv.yaml 2>/dev/null || true
echo "      Done."

# Step 5: Update backend deployment
echo "[5/7] Updating backend deployment..."
microk8s kubectl set image deployment/backend \
    backend=docker.io/library/enterprise-ai-chat-backend:1.2.0 \
    -n enterprise-ai-chat

# Step 6: Update frontend deployment
echo "[6/7] Updating frontend deployment..."
microk8s kubectl set image deployment/frontend \
    frontend=docker.io/library/enterprise-ai-chat-frontend:1.2.0 \
    -n enterprise-ai-chat

# Step 7: Wait for rollouts
echo "[7/7] Waiting for rollouts to complete..."
microk8s kubectl rollout status deployment/backend -n enterprise-ai-chat --timeout=120s
microk8s kubectl rollout status deployment/frontend -n enterprise-ai-chat --timeout=120s

echo ""
echo "============================================"
echo " Deployment Complete!"
echo "============================================"
echo ""
echo "Versions:"
echo "  - Frontend: 1.2.0"
echo "  - Backend:  1.2.0"
echo ""
echo "Changes in this version:"
echo "  - Models loaded dynamically from API"
echo "  - Token refresh fix for chat streaming"
echo "  - VS Code extensions served from shared folder"
echo "  - Shared storage: /data/shared-projects"
echo ""
echo "VS Code Extensions available at:"
echo "  - Windows: \\\\192.168.1.123\\projects\\extensions"
echo "  - Linux:   /data/shared-projects/extensions"
echo ""
echo "If you see 401 errors, please logout and login again."
echo ""
