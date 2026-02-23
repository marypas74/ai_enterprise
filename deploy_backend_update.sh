#!/bin/bash
echo "Building Backend 1.5.8..."
docker build -t localhost:32000/enterprise-ai-chat-backend:1.5.8 -f backend/Dockerfile backend

echo "Importing into MicroK8s..."
docker save localhost:32000/enterprise-ai-chat-backend:1.5.8 | sudo microk8s ctr image import -

echo "Applying K8s Manifests..."
sudo microk8s kubectl apply -f k8s/backend/deployment.yaml
sudo microk8s kubectl rollout status deployment/backend -n enterprise-ai-chat
