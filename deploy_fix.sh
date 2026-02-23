#!/bin/bash
set -e

echo "🚀 Starting Full Deployment v1.5.16 (Backend + Frontend)..."

# Backend
echo "📦 Building Backend..."
cd backend
docker build -t localhost:32000/enterprise-ai-chat-backend:1.5.16 .
echo "📤 Pushing Backend..."
docker push localhost:32000/enterprise-ai-chat-backend:1.5.16
cd ..

# Frontend
echo "📦 Building Frontend..."
cd frontend
docker build -t localhost:32000/enterprise-ai-chat-frontend:1.5.16 .
echo "📤 Pushing Frontend..."
docker push localhost:32000/enterprise-ai-chat-frontend:1.5.16
cd ..

# Apply Manifests
echo "📝 Applying Kubernetes Manifests..."
/snap/bin/microk8s.kubectl apply -f k8s/backend/deployment.yaml
/snap/bin/microk8s.kubectl apply -f k8s/frontend/deployment.yaml

# Restart
echo "🔄 Restarting Deployments..."
/snap/bin/microk8s.kubectl rollout restart deployment/backend -n enterprise-ai-chat
/snap/bin/microk8s.kubectl rollout restart deployment/frontend -n enterprise-ai-chat

# Wait for rollouts
echo "⏳ Waiting for backend rollout..."
/snap/bin/microk8s.kubectl rollout status deployment/backend -n enterprise-ai-chat --timeout=120s
echo "⏳ Waiting for frontend rollout..."
/snap/bin/microk8s.kubectl rollout status deployment/frontend -n enterprise-ai-chat --timeout=120s

echo "✅ Full Deployment v1.5.16 Complete!"
