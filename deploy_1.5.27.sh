#!/bin/bash
set -e

VERSION="1.5.27"
REGISTRY="localhost:32000"
FRONTEND_IMAGE="$REGISTRY/enterprise-ai-chat-frontend:$VERSION"
BACKEND_IMAGE="$REGISTRY/enterprise-ai-chat-backend:$VERSION"

echo "🚀 Starting Deployment v$VERSION (Metrics Fix Edition)..."

# Build and Push Backend
echo "📦 Building Backend..."
cd backend
sudo docker build -t $BACKEND_IMAGE .
echo "📤 Pushing Backend..."
sudo docker push $BACKEND_IMAGE
cd ..

# Build and Push Frontend
echo "📦 Building Frontend..."
cd frontend
sudo docker build -t $FRONTEND_IMAGE .
echo "📤 Pushing Frontend..."
sudo docker push $FRONTEND_IMAGE
cd ..

# Build VSCode Extension
echo "🔌 Building VSCode Extension..."
cd vscode-extension
npm install
npm run package
# Copy to shared location
mkdir -p /home/marcello/enterprise-ai-chat/extensions
cp -f enterprise-ai-chat-$VERSION.vsix /home/marcello/enterprise-ai-chat/extensions/
cd ..

# Apply Manifests
echo "📝 Applying Kubernetes Manifests..."
microk8s kubectl apply -f k8s/backend/deployment.yaml
microk8s kubectl apply -f k8s/frontend/deployment.yaml
microk8s kubectl apply -f k8s/kustomization.yaml

# Explicit rollout status check
echo "🔄 Rolling out updates..."
microk8s kubectl -n enterprise-ai-chat rollout status deployment/backend --timeout=300s
microk8s kubectl -n enterprise-ai-chat rollout status deployment/frontend --timeout=300s

echo "✅ Deployment v$VERSION Complete!"
echo "Public Console (NEW): http://plane.lushlolli.com/metrics"
echo "Public Console (API): http://plane.lushlolli.com/api/public/metrics"
