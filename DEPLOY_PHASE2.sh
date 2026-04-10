#!/bin/bash
# Deploy LiteLLM and Open WebUI
#
# SECURITY WARNING (2026-03-24):
# LiteLLM was subject to a critical supply chain attack (CVE-2026-33634, CVSS 9.4).
# PyPI versions 1.82.7-1.82.8 were compromised by TeamPCP with credential-stealing malware.
# Docker image is pinned to v1.82.6 (last verified safe release).
# DO NOT change the image tag without verifying safety.
# Reference: https://docs.litellm.ai/blog/security-update-march-2026
#
set -euo pipefail

echo "============================================================"
echo "  SECURITY NOTICE: LiteLLM pinned to v1.82.6 (safe)"
echo "  CVE-2026-33634 — DO NOT use versions >= 1.82.7"
echo "============================================================"
echo ""

# Pre-flight: verify litellm-secrets exists with LITELLM_MASTER_KEY
if ! microk8s kubectl get secret litellm-secrets -n enterprise-ai-chat -o jsonpath='{.data.LITELLM_MASTER_KEY}' &>/dev/null; then
  echo "ERROR: litellm-secrets missing or does not contain LITELLM_MASTER_KEY."
  echo "Create it first:"
  echo "  MASTER_KEY=\$(openssl rand -hex 32)"
  echo "  microk8s kubectl create secret generic litellm-secrets \\"
  echo "    --from-literal=LITELLM_MASTER_KEY=\$MASTER_KEY \\"
  echo "    --from-literal=ANTHROPIC_API_KEY=<your-key> \\"
  echo "    --from-literal=OPENAI_API_KEY=<your-key> \\"
  echo "    -n enterprise-ai-chat"
  exit 1
fi

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

echo ""
echo "Done! Verify LiteLLM is healthy:"
echo "  microk8s kubectl get pods -n enterprise-ai-chat -l app=litellm"
echo "  microk8s kubectl logs -l app=litellm -n enterprise-ai-chat"
