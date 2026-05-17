-- ROLLBACK T1.1 — Disabilita o rimuove GLM-OCR da ai_models
-- Eseguire SOLO se T1.1 ha prodotto regressioni o si vuole tornare allo stato pre-2026-05-12.

-- OPZIONE A (CONSERVATIVA, RACCOMANDATA): soft-disable via flag
-- VisionService.resolveOCRModel ignora i modelli con is_enabled=FALSE.
UPDATE ai_models
SET is_enabled = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE model_id = 'glm-ocr:latest';

-- Verifica
SELECT model_id, is_enabled, supports_vision
FROM ai_models WHERE model_id = 'glm-ocr:latest';
-- Atteso: is_enabled=0

-- OPZIONE B (HARD): rimozione completa della row (perde history + group_permissions associate via FK CASCADE)
-- DELETE FROM ai_models WHERE model_id = 'glm-ocr:latest';

-- Effetto runtime: dopo TTL cache (5 min) o restart pod backend, VisionService
-- non considera più GLM-OCR e ricade automaticamente su qwen2.5vl:7b (o vLLM 32B per
-- pipeline RAG documentale, a seconda dell'endpoint chiamato).
