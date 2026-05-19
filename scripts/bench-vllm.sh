#!/usr/bin/env bash
# bench-vllm.sh — vLLM first-token latency benchmark (PERF-79-B)
# Lancia 10 richieste parallele a /v1/chat/completions e misura p50/p95 TTFT
# Uso: ./bench-vllm.sh [VLLM_URL] [API_KEY] [LABEL]
# Esempio baseline:  ./bench-vllm.sh http://localhost:8087/vllm vllm-local-2026 PRE
# Esempio post-tune: ./bench-vllm.sh http://localhost:8087/vllm vllm-local-2026 POST

set -euo pipefail

VLLM_URL="${1:-http://localhost:8087/vllm}"
API_KEY="${2:-vllm-local-2026}"
LABEL="${3:-BENCH}"
CONCURRENCY=10
RESULTS_FILE="/tmp/bench-vllm-${LABEL}-$(date +%Y%m%d-%H%M%S).txt"

echo "=== vLLM Benchmark [${LABEL}] - $(date) ===" | tee "$RESULTS_FILE"
echo "URL: ${VLLM_URL}/v1/chat/completions" | tee -a "$RESULTS_FILE"
echo "Concurrency: ${CONCURRENCY}" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

PROMPT='{"model":"qwen25vl:32b","stream":false,"max_tokens":50,"messages":[{"role":"user","content":"Rispondi in una sola parola: quale colore ha il cielo?"}]}'

latencies=()

run_request() {
  local idx=$1
  local start end elapsed_ms
  start=$(date +%s%3N)
  HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "${VLLM_URL}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "X-Vllm-Key: mTLS-k8s-backend-2026" \
    -d "$PROMPT" \
    --max-time 120 2>/dev/null) || HTTP_CODE="ERR"
  end=$(date +%s%3N)
  elapsed_ms=$((end - start))
  echo "${elapsed_ms} ${HTTP_CODE}"
}

export -f run_request
export VLLM_URL API_KEY PROMPT

echo "Avvio ${CONCURRENCY} richieste parallele..." | tee -a "$RESULTS_FILE"

# Lancia in parallelo raccogliendo i tempi
declare -a pids
declare -a tmpfiles

for i in $(seq 1 $CONCURRENCY); do
  tf=$(mktemp)
  tmpfiles+=("$tf")
  run_request "$i" > "$tf" &
  pids+=($!)
done

# Attendi tutti
for pid in "${pids[@]}"; do
  wait "$pid" 2>/dev/null || true
done

# Raccolta risultati
declare -a times
echo "" | tee -a "$RESULTS_FILE"
echo "Risultati per richiesta:" | tee -a "$RESULTS_FILE"
for i in "${!tmpfiles[@]}"; do
  tf="${tmpfiles[$i]}"
  if [[ -f "$tf" ]]; then
    result=$(cat "$tf")
    ms=$(echo "$result" | awk '{print $1}')
    code=$(echo "$result" | awk '{print $2}')
    echo "  req $((i+1)): ${ms}ms [HTTP ${code}]" | tee -a "$RESULTS_FILE"
    if [[ "$code" == "200" ]] && [[ -n "$ms" ]]; then
      times+=("$ms")
    fi
    rm -f "$tf"
  fi
done

# Calcola p50/p95
if [[ ${#times[@]} -eq 0 ]]; then
  echo "ERRORE: nessuna risposta 200 ricevuta" | tee -a "$RESULTS_FILE"
  exit 1
fi

# Ordina i tempi
IFS=$'\n' sorted=($(sort -n <<< "${times[*]}")); unset IFS

count=${#sorted[@]}
total=0
for t in "${sorted[@]}"; do total=$((total + t)); done
avg=$((total / count))

# p50 index
p50_idx=$(( (count * 50 + 99) / 100 - 1 ))
p50_idx=$(( p50_idx < 0 ? 0 : p50_idx ))
p95_idx=$(( (count * 95 + 99) / 100 - 1 ))
p95_idx=$(( p95_idx >= count ? count - 1 : p95_idx ))

p50="${sorted[$p50_idx]}"
p95="${sorted[$p95_idx]}"
min="${sorted[0]}"
max="${sorted[$((count-1))]}"

echo "" | tee -a "$RESULTS_FILE"
echo "=== Statistiche [${LABEL}] ===" | tee -a "$RESULTS_FILE"
echo "  Richieste OK: ${count}/${CONCURRENCY}" | tee -a "$RESULTS_FILE"
echo "  Min:  ${min}ms" | tee -a "$RESULTS_FILE"
echo "  p50:  ${p50}ms" | tee -a "$RESULTS_FILE"
echo "  p95:  ${p95}ms" | tee -a "$RESULTS_FILE"
echo "  Max:  ${max}ms" | tee -a "$RESULTS_FILE"
echo "  Avg:  ${avg}ms" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"
echo "Risultati salvati in: ${RESULTS_FILE}"
