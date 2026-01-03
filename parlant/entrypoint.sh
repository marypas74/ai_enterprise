#!/bin/bash
set -e

echo "Starting Parlant AI Agent Framework..."
echo "Data directory: ${PARLANT_DATA_DIR:-/app/data}"
echo "Host: ${PARLANT_HOST:-0.0.0.0}"
echo "Port: ${PARLANT_PORT:-8800}"

# Start Parlant server
exec python -m parlant.server \
    --host "${PARLANT_HOST:-0.0.0.0}" \
    --port "${PARLANT_PORT:-8800}" \
    --data-dir "${PARLANT_DATA_DIR:-/app/data}"
