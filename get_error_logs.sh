#!/bin/bash
echo "=== LOGS FROM POD 1 ==="
/snap/bin/microk8s.kubectl logs -n enterprise-ai-chat deployment/backend --tail=1000 | grep -E "500|Error|exception|failed" | tail -n 50
echo "=== LOGS FROM POD 2 ==="
# Get pods first
PODS=$(/snap/bin/microk8s.kubectl get pods -n enterprise-ai-chat -l app=backend -o name)
for POD in $PODS; do
    echo "--- $POD ---"
    /snap/bin/microk8s.kubectl logs -n enterprise-ai-chat $POD --tail=1000 | grep -E "500|Error|error|exception|stack|failed" | tail -n 50
done
