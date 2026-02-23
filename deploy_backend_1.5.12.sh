#!/bin/bash
set -e

echo "🚀 Starting Backend v1.5.12 Deployment..."

# Backend
echo "📦 Building Backend..."
cd backend
docker build -t localhost:32000/enterprise-ai-chat-backend:1.5.12 .
echo "📤 Pushing to local registry..."
docker push localhost:32000/enterprise-ai-chat-backend:1.5.12
cd ..

# Apply Manifests
echo "📝 Applying Kubernetes Manifests..."
/snap/bin/microk8s.kubectl apply -f k8s/backend/deployment.yaml

# Restart
echo "🔄 Restarting Backend Deployment..."
/snap/bin/microk8s.kubectl rollout restart deployment/backend -n enterprise-ai-chat

# Wait for rollout
echo "⏳ Waiting for rollout..."
/snap/bin/microk8s.kubectl rollout status deployment/backend -n enterprise-ai-chat --timeout=120s

echo "✅ Backend v1.5.12 Deployment Complete!"
