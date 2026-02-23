#!/bin/bash
/snap/bin/microk8s.kubectl describe pod -n enterprise-ai-chat -l app=frontend | grep -A 20 Events
