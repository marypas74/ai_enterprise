#!/usr/bin/env bash
# Applica HNSW tuning + scalar quantization int8 alla collection Qdrant esistente.
# Idempotente: re-eseguibile senza side-effects negativi (PATCH non distruttivo).
#
# Uso: bash scripts/qdrant-tune.sh [collection_name]
#
# Riferimenti: https://qdrant.tech/documentation/concepts/optimizer/
#              https://qdrant.tech/documentation/guides/quantization/

set -euo pipefail

COLLECTION="${1:-attachments}"
# Port-forward Qdrant se non già accessibile; usare host se cluster locale.
QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"

echo "[qdrant-tune] Target: $QDRANT_URL/collections/$COLLECTION"

# Verifica esistenza collection
if ! curl -sf "${QDRANT_URL}/collections/${COLLECTION}" >/dev/null; then
    echo "[qdrant-tune] ERROR: collection '$COLLECTION' non trovata su $QDRANT_URL" >&2
    exit 1
fi

echo "[qdrant-tune] Applicazione HNSW tuning (m=32, ef_construct=200)..."
curl -sf -X PATCH "${QDRANT_URL}/collections/${COLLECTION}" \
    -H 'Content-Type: application/json' \
    -d '{
        "hnsw_config": {
            "m": 32,
            "ef_construct": 200,
            "full_scan_threshold": 10000
        }
    }' | head -c 200 ; echo

echo "[qdrant-tune] Applicazione scalar quantization int8 (quantile=0.99, always_ram=true)..."
curl -sf -X PATCH "${QDRANT_URL}/collections/${COLLECTION}" \
    -H 'Content-Type: application/json' \
    -d '{
        "quantization_config": {
            "scalar": {
                "type": "int8",
                "quantile": 0.99,
                "always_ram": true
            }
        }
    }' | head -c 200 ; echo

echo "[qdrant-tune] Optimizer config (default_segment_number=2)..."
curl -sf -X PATCH "${QDRANT_URL}/collections/${COLLECTION}" \
    -H 'Content-Type: application/json' \
    -d '{
        "optimizers_config": {
            "default_segment_number": 2,
            "indexing_threshold": 20000
        }
    }' | head -c 200 ; echo

echo "[qdrant-tune] Verifica stato post-patch..."
curl -sf "${QDRANT_URL}/collections/${COLLECTION}" | head -c 1000
echo
echo "[qdrant-tune] Done. La re-indicizzazione è asincrona — monitora 'optimizer_status' nei prossimi minuti."
