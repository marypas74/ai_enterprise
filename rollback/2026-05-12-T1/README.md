# Rollback procedure — Tier 1 fixes (2026-05-12)

Pre-fix state snapshot:
- HEAD commit: see `pre_fix_head.sha`
- Working tree stash snapshot (uncommitted changes preserved): see `pre_fix_stash.sha`
- DB state (ai_models, ai_providers): see `pre_fix_db_state.sql` (created at execution time, before T1.1 SQL run)

## Rollback per intervento

### T1.1 — Abilitazione GLM-OCR in DB
```bash
# Esegui rollback_T1_1.sql contro MariaDB
sudo /snap/bin/microk8s kubectl exec -n enterprise-ai-chat mariadb-0 -- \
  mysql -uroot -p"$MARIADB_ROOT_PASSWORD" enterprise_ai_chat < rollback_T1_1.sql
```
Effetto: rimuove o disabilita la riga `glm-ocr:latest` da `ai_models`. Nessun deploy richiesto — il backend rilegge la config via cache TTL (5 min) o restart pod.

### T1.3 — Layout-heavy detection (codice TS)
File toccati:
- `backend/src/services/VisionService.ts` (modificato: import LayoutDetector, fix bug `m.name`→`m.display_name`, `chooseModelForLayout`, signature `analyzeDocument` con `options.layoutHint`)
- `backend/src/services/document-processing/LayoutDetector.ts` (NUOVO, 80 LOC)
- `backend/src/services/document-processing/LayoutDetector.test.ts` (NUOVO, 4 test)

```bash
# Rollback VisionService (preserva altre modifiche)
git checkout $(cat pre_fix_head.sha) -- backend/src/services/VisionService.ts
# Rimuove i file nuovi
rm -f backend/src/services/document-processing/LayoutDetector.ts
rm -f backend/src/services/document-processing/LayoutDetector.test.ts
# Rebuild + redeploy
cd ../.. && bash BUILD.sh
```

### T1.4 — Marcatura deprecated (NON rimosso)
**Riformulato dopo verifica codice**: il file `pdfEditorService.ts` NON è dead code.
`convertPdfToHtml` e `convertHtmlToPdf` sono ancora chiamati attivamente da
`frontend/src/services/pdfEditorApi.ts:4-15`. Solo aggiunto JSDoc `@deprecated`.

```bash
git checkout $(cat pre_fix_head.sha) -- backend/src/modules/tools/pdfEditorService.ts
# Rebuild non necessario (solo comment changes), ma per sicurezza:
cd ../.. && bash BUILD.sh
```

### Rollback completo (nuke option)
```bash
# Recupera lo stato completo pre-fix (HEAD + working tree)
git stash apply $(cat pre_fix_stash.sha)
# Poi rollback DB:
< rollback_T1_1.sql
# Rebuild + redeploy:
bash ../../BUILD.sh
```

## Verifica post-rollback
- `SELECT model_id, is_enabled FROM ai_models WHERE model_id LIKE '%ocr%'` — atteso: stato pre-fix
- `curl http://backend:3000/api/admin/ai-models` — verifica config recuperata
- Upload PDF di test → verifica metodo OCR usato nei log backend
