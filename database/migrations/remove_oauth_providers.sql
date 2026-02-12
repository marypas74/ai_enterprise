-- Migration: Remove OAuth Providers (anthropic_oauth, google_pro, google_oauth)
-- Date: 2026-01-21
-- Description: Remove Claude Pro OAuth and Google Pro OAuth providers

-- Delete models first (foreign key constraint)
DELETE FROM ai_models WHERE provider_id IN (
    SELECT id FROM ai_providers WHERE name IN ('anthropic_oauth', 'google_pro', 'google_oauth')
);

-- Delete provider settings
DELETE FROM ai_provider_settings WHERE provider_id IN (
    SELECT id FROM ai_providers WHERE name IN ('anthropic_oauth', 'google_pro', 'google_oauth')
);

-- Delete providers
DELETE FROM ai_providers WHERE name IN ('anthropic_oauth', 'google_pro', 'google_oauth');

-- Drop user_google_auth table if exists (no longer needed)
DROP TABLE IF EXISTS user_google_auth;

SELECT 'Migration completed: Removed OAuth providers' AS status;
