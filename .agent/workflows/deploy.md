---
description: how to update version strings when deploying a fix
---

## Version Update Checklist

When deploying any fix or feature, **always** update the version string in ALL of the following files before building Docker images:

// turbo-all

1. `backend/package.json` → `"version": "X.Y.Z"`
2. `backend/src/index.ts` → Both `/version` and `/api/version` endpoints: `version: 'X.Y.Z'`
3. `frontend/package.json` → `"version": "X.Y.Z"`
4. `frontend/src/version.ts` → `export const APP_VERSION = 'X.Y.Z'`
5. `k8s/backend/deployment.yaml` → `image: localhost:32000/enterprise-ai-chat-backend:X.Y.Z`
6. `k8s/frontend/deployment.yaml` → `image: localhost:32000/enterprise-ai-chat-frontend:X.Y.Z`
7. `deploy_fix.sh` → All version references

## Build & Deploy Steps

1. Update all version strings listed above
2. Build backend image: `docker build -t localhost:32000/enterprise-ai-chat-backend:X.Y.Z .` (from `backend/`)
3. Build frontend image: `docker build -t localhost:32000/enterprise-ai-chat-frontend:X.Y.Z .` (from `frontend/`)
4. Push both: `docker push localhost:32000/enterprise-ai-chat-backend:X.Y.Z && docker push localhost:32000/enterprise-ai-chat-frontend:X.Y.Z`
5. Apply manifests: `/snap/bin/microk8s.kubectl apply -f k8s/backend/deployment.yaml -f k8s/frontend/deployment.yaml`
6. Restart: `/snap/bin/microk8s.kubectl rollout restart deployment/backend deployment/frontend -n enterprise-ai-chat`
7. Wait: `/snap/bin/microk8s.kubectl rollout status deployment/backend -n enterprise-ai-chat --timeout=120s && /snap/bin/microk8s.kubectl rollout status deployment/frontend -n enterprise-ai-chat --timeout=120s`
8. Verify pods: `/snap/bin/microk8s.kubectl get pods -n enterprise-ai-chat`
