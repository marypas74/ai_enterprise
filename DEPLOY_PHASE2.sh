#!/bin/bash
# Deploy LiteLLM and Open WebUI
echo "Deploying Phase 2: LiteLLM + Open WebUI..."

# Apply LiteLLM
echo "[1/2] Applying LiteLLM manifests..."
microk8s kubectl apply -f k8s/litellm/configmap.yaml
microk8s kubectl apply -f k8s/litellm/deployment.yaml
microk8s kubectl apply -f k8s/litellm/service.yaml

# Apply Open WebUI
echo "[2/2] Applying Open WebUI manifests..."
microk8s kubectl apply -f k8s/open-webui/pvc.yaml
microk8s kubectl apply -f k8s/open-webui/deployment.yaml
microk8s kubectl apply -f k8s/open-webui/service.yaml
microk8s kubectl apply -f k8s/open-webui/ingress.yaml

echo "Done! Access Open WebUI at http://ai.yourdomain.com (configure /etc/hosts if needed)"
