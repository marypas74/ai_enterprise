#!/usr/bin/env bash
# Automatizza il bump versione su tutti i file che la referenziano.
# Riferimento checklist: ~/.claude/projects/-home-marcello/memory/MEMORY.md
#
# Uso:
#   bash scripts/bump-version.sh <OLD> <NEW>
#   esempio: bash scripts/bump-version.sh 2.1.72 2.1.73

set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Uso: $0 <OLD_VERSION> <NEW_VERSION>" >&2
    echo "Es:  $0 2.1.72 2.1.73" >&2
    exit 1
fi

OLD="$1"
NEW="$2"

# Validazione formato semver X.Y.Z
if ! [[ "$OLD" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "ERRORE: versioni devono essere in formato X.Y.Z" >&2
    exit 2
fi

if [[ "$OLD" == "$NEW" ]]; then
    echo "ERRORE: old == new ($OLD)" >&2
    exit 3
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "[bump] $OLD → $NEW (repo: $REPO_ROOT)"

# File obbligatori da aggiornare (checklist MEMORY.md)
FILES=(
    "backend/package.json"
    "frontend/package.json"
    "frontend/src/version.ts"
    "frontend/src/pages/PublicMonitorPage.tsx"
    "vscode-extension/package.json"
    "vscode-extension/webview-ui/src/claude-code/MainLayout.tsx"
    "k8s/backend/deployment.yaml"
    "k8s/frontend/deployment.yaml"
    "k8s/kustomization.yaml"
    "k8s/mariadb/init-configmap.yaml"
    "backend-deploy.yaml"
    "backend/src/guides/user-guide.html"
    "backend/src/guides/admin-guide.html"
)

# Sostituzioni
echo "[bump] Applicando sostituzioni..."
for f in "${FILES[@]}"; do
    if [[ -f "$f" ]]; then
        if grep -q "$OLD" "$f"; then
            sed -i "s/${OLD//./\\.}/${NEW}/g" "$f"
            echo "  ✓ $f"
        else
            echo "  - $f (nessuna occorrenza di $OLD)"
        fi
    else
        echo "  ! $f (non esiste — skip)"
    fi
done

# Verifica residui — failsafe ampio (esclude generated, dipendenze, lock, venv)
echo "[bump] Verifica residui di $OLD..."
RESIDUI=$(
    grep -rn "${OLD//./\\.}" . \
        --include='*.ts' --include='*.tsx' --include='*.json' \
        --include='*.yaml' --include='*.yml' --include='*.html' \
        2>/dev/null \
    | grep -v node_modules \
    | grep -v dist \
    | grep -v package-lock \
    | grep -v ocr-bench-venv \
    | grep -v "/rollback/" \
    | grep -v ".test.ts:" \
    || true
)

if [[ -n "$RESIDUI" ]]; then
    echo "[bump] ATTENZIONE: residui di $OLD trovati (fuori checklist obbligatoria):"
    echo "$RESIDUI"
    echo "[bump] Valuta se aggiungerli alla checklist o se sono falsi positivi."
else
    echo "[bump] OK — nessun residuo di $OLD."
fi

NEW_COUNT=$(
    grep -rn "${NEW//./\\.}" . \
        --include='*.ts' --include='*.tsx' --include='*.json' \
        --include='*.yaml' --include='*.yml' --include='*.html' \
        2>/dev/null \
    | grep -v node_modules \
    | grep -v dist \
    | grep -v package-lock \
    | grep -v ocr-bench-venv \
    | grep -v "/rollback/" \
    | wc -l
)
echo "[bump] $NEW_COUNT occorrenze di $NEW nel repo."
echo "[bump] Done. Prossimo step: BUILD.sh + push + rolling deploy."
