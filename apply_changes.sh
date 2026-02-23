#!/bin/bash
/snap/bin/microk8s.kubectl apply -f k8s/backend/deployment.yaml
/snap/bin/microk8s.kubectl apply -f k8s/frontend/deployment.yaml
