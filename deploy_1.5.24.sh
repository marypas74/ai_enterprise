#!/bin/bash
set -e

VERSION="1.5.24"
REGISTRY="localhost:32000"
FRONTEND_IMAGE="$REGISTRY/enterprise-ai-chat-frontend:$VERSION"
BACKEND_IMAGE="$REGISTRY/enterprise-ai-chat-backend:$VERSION"

echo "🚀 Starting Deployment v$VERSION..."

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

# Apply Manifests
echo "📝 Applying Kubernetes Manifests..."
# Update the deployment images in the YAMLs if they aren't already (though I updated them in the source)
microk8s kubectl apply -f k8s/backend/deployment.yaml
microk8s kubectl apply -f k8s/frontend/deployment.yaml

# Explicit restart to ensure new images are pulled
echo "🔄 Rolling out updates..."
microk8s kubectl -n enterprise-ai-chat rollout restart deployment/backend
microk8s kubectl -n enterprise-ai-chat rollout restart deployment/frontend

# Wait for status
echo "⏳ Waiting for rollout..."
microk8s kubectl -n enterprise-ai-chat rollout status deployment/frontend --timeout=120s

echo "✅ Deployment v$VERSION Complete!"
echo "Refresh your browser (Ctrl+F5) to see the changes."
