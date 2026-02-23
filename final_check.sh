#!/bin/bash
echo "--- FRONTEND PODS ---"
/snap/bin/microk8s.kubectl get pods -n enterprise-ai-chat -l app=frontend -o custom-columns=NAME:.metadata.name,IMAGE:.spec.containers[0].image,STATUS:.status.phase,READY:.status.containerStatuses[0].ready
echo "--- BACKEND PODS ---"
/snap/bin/microk8s.kubectl get pods -n enterprise-ai-chat -l app=backend -o custom-columns=NAME:.metadata.name,IMAGE:.spec.containers[0].image,STATUS:.status.phase,READY:.status.containerStatuses[0].ready
