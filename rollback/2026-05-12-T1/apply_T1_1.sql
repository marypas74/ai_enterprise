-- T1.1 — Abilitazione GLM-OCR in ai_models (idempotente)
-- Eseguito 2026-05-12 — vedi dev-chat.md "### Marcello — 10:30"

-- 1) Verifica che il provider 'ollama' esista (atteso 1 row)
SELECT id, name, is_enabled FROM ai_providers WHERE name = 'ollama';

-- 2) Snapshot pre-fix: dump degli ai_models con 'ocr' nel nome (per rollback)
SELECT * FROM ai_models WHERE model_id LIKE '%ocr%' OR display_name LIKE '%OCR%';

-- 3) INSERT o UPDATE GLM-OCR (idempotente via UNIQUE uk_provider_model)
INSERT INTO ai_models (
    provider_id,
    model_id,
    display_name,
    description,
    model_type,
    context_window,
    max_output_tokens,
    supports_streaming,
    supports_functions,
    supports_vision,
    is_enabled,
    is_default,
    sort_order
)
SELECT
    p.id,
    'glm-ocr:latest',
    'GLM-OCR (Vision OCR)',
    'Modello OCR specializzato 0.9B parametri. Pilot v2.1.69+: ottimo su scan testuali (CER 0.002), inadeguato su tabelle (CER 0.618). Routing: scan-text-only via VisionService.resolveOCRModel.',
    'chat',         -- multimodal generate, no embedding
    2048,           -- context window basso → preferito da resolveOCRModel (ORDER BY context_window ASC)
    2048,
    FALSE,          -- no streaming necessario per OCR
    FALSE,          -- no function calling
    TRUE,           -- supports_vision: TRUE → eleggibile per VisionService
    TRUE,           -- is_enabled
    FALSE,          -- is_default no (default chat resta altrove)
    100             -- sort_order alto: non comparire in cima
FROM ai_providers p
WHERE p.name = 'ollama'
ON DUPLICATE KEY UPDATE
    is_enabled = TRUE,
    supports_vision = TRUE,
    context_window = 2048,
    display_name = VALUES(display_name),
    description = VALUES(description),
    updated_at = CURRENT_TIMESTAMP;

-- 4) Verifica post-fix
SELECT
    m.id, m.model_id, m.display_name, m.context_window,
    m.supports_vision, m.is_enabled, p.name AS provider
FROM ai_models m
JOIN ai_providers p ON m.provider_id = p.id
WHERE p.name = 'ollama' AND m.supports_vision = TRUE
ORDER BY m.context_window ASC;
-- Atteso: glm-ocr:latest in prima posizione (context_window=2048).
