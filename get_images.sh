#!/bin/bash
/snap/bin/microk8s.kubectl get pods -n enterprise-ai-chat -l app=frontend -o custom-columns=NAME:.metadata.name,IMAGE:.spec.containers[0].image
