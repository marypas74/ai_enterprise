#!/usr/bin/env bash
# Migration script: copy `document_id` -> `attachment_id` in payload
# of all points in `declarative_memory` where source_type=user_document.
# Idempotent: rerunning on already-migrated points is a no-op.
# Usage: ./reindex_attachment_id.sh [--apply]   (default: dry-run)

set -euo pipefail

QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
COLLECTION="declarative_memory"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

echo "=== Qdrant migration: document_id -> attachment_id (collection=$COLLECTION) ==="
echo "Mode: $([[ $APPLY -eq 1 ]] && echo APPLY || echo DRY-RUN)"
echo

# Count source = user_document
TOTAL=$(curl -s -X POST "$QDRANT_URL/collections/$COLLECTION/points/count" \
  -H 'Content-Type: application/json' \
  -d '{"exact":true,"filter":{"must":[{"key":"source_type","match":{"value":"user_document"}}]}}' \
  | grep -o '"count":[0-9]*' | head -1 | cut -d: -f2)

echo "Total user_document chunks: $TOTAL"

# Count chunks already having attachment_id
ALREADY=$(curl -s -X POST "$QDRANT_URL/collections/$COLLECTION/points/count" \
  -H 'Content-Type: application/json' \
  -d '{"exact":true,"filter":{"must":[{"key":"source_type","match":{"value":"user_document"}},{"is_empty":{"key":"attachment_id"}}]}}' \
  | grep -o '"count":[0-9]*' | head -1 | cut -d: -f2)
echo "Chunks WITHOUT attachment_id (need migration): ${ALREADY:-0}"

# Scroll all user_document points and group by document_id
echo
echo "Scanning distinct document_id values..."
NEXT=""
declare -A DOC_IDS
TOTAL_SCANNED=0
while :; do
  if [[ -z "$NEXT" ]]; then
    BODY='{"limit":256,"with_payload":{"include":["document_id","attachment_id","original_name"]},"with_vector":false,"filter":{"must":[{"key":"source_type","match":{"value":"user_document"}}]}}'
  else
    BODY=$(printf '{"limit":256,"with_payload":{"include":["document_id","attachment_id","original_name"]},"with_vector":false,"offset":%s,"filter":{"must":[{"key":"source_type","match":{"value":"user_document"}}]}}' "$NEXT")
  fi
  RESP=$(curl -s -X POST "$QDRANT_URL/collections/$COLLECTION/points/scroll" -H 'Content-Type: application/json' -d "$BODY")
  IDS=$(echo "$RESP" | python3 -c '
import json, sys
r = json.load(sys.stdin)["result"]
for p in r["points"]:
    pl = p.get("payload", {})
    did = pl.get("document_id")
    aid = pl.get("attachment_id")
    name = pl.get("original_name","?")
    print(f"{did}|{aid}|{name}")
print("---NEXT---")
no = r.get("next_page_offset")
print(no if no is not None else "")
')
  POINTS=$(echo "$IDS" | sed -n '1,/---NEXT---/p' | sed '$d' | sed '/^---NEXT---$/d')
  NEXT_RAW=$(echo "$IDS" | sed -n '/---NEXT---/,$p' | tail -n +2)
  while IFS='|' read -r did aid name; do
    [[ -z "$did" ]] && continue
    TOTAL_SCANNED=$((TOTAL_SCANNED+1))
    KEY="${did}"
    DOC_IDS[$KEY]="${DOC_IDS[$KEY]:-0|$name}"
    cnt="${DOC_IDS[$KEY]%%|*}"
    rest="${DOC_IDS[$KEY]#*|}"
    DOC_IDS[$KEY]="$((cnt+1))|$rest"
  done <<< "$POINTS"
  if [[ -z "$NEXT_RAW" || "$NEXT_RAW" == "None" ]]; then
    break
  fi
  NEXT="$NEXT_RAW"
done

echo "Scanned $TOTAL_SCANNED user_document chunks across ${#DOC_IDS[@]} documents:"
for k in "${!DOC_IDS[@]}"; do
  cnt="${DOC_IDS[$k]%%|*}"
  name="${DOC_IDS[$k]#*|}"
  printf "  doc_id=%s  chunks=%s  name=%s\n" "$k" "$cnt" "$name"
done

if [[ $APPLY -eq 0 ]]; then
  echo
  echo "DRY-RUN complete. Re-run with --apply to perform SetPayload."
  exit 0
fi

echo
echo "=== APPLYING SetPayload per document_id ==="
for k in "${!DOC_IDS[@]}"; do
  echo -n "  doc_id=$k ... "
  RESP=$(curl -s -X POST "$QDRANT_URL/collections/$COLLECTION/points/payload?wait=true" \
    -H 'Content-Type: application/json' \
    -d "{\"payload\":{\"attachment_id\":${k}},\"filter\":{\"must\":[{\"key\":\"source_type\",\"match\":{\"value\":\"user_document\"}},{\"key\":\"document_id\",\"match\":{\"value\":${k}}}]}}")
  STATUS=$(echo "$RESP" | grep -o '"status":"[^"]*"' | head -1)
  echo "$STATUS"
done

echo
echo "=== Verification ==="
AFTER=$(curl -s -X POST "$QDRANT_URL/collections/$COLLECTION/points/count" \
  -H 'Content-Type: application/json' \
  -d '{"exact":true,"filter":{"must":[{"key":"source_type","match":{"value":"user_document"}},{"is_empty":{"key":"attachment_id"}}]}}' \
  | grep -o '"count":[0-9]*' | head -1 | cut -d: -f2)
echo "Chunks still WITHOUT attachment_id after migration: ${AFTER:-?}"
[[ "${AFTER:-1}" == "0" ]] && echo "MIGRATION OK" || echo "MIGRATION INCOMPLETE — investigate"
