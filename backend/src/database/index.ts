import { FastifyInstance } from 'fastify';
import mysql from 'mysql2/promise';
import fp from 'fastify-plugin';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname_db = dirname(__filename);

declare module 'fastify' {
  interface FastifyInstance {
    db: mysql.Pool;
  }
}

async function databaseConnector(fastify: FastifyInstance) {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'enterprise_ai',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'enterprise_ai_chat',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '25'),
    queueLimit: 50,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  });

  // Test connection
  try {
    const connection = await pool.getConnection();
    fastify.log.info('Database connected successfully');
    connection.release();

    // Run auto-migrations for new tables
    await runAutoMigrations(pool, fastify);
  } catch (err) {
    fastify.log.error({ err }, 'Database connection failed');
    throw err;
  }

  fastify.decorate('db', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
}

export const databasePlugin = fp(databaseConnector, {
  name: 'database'
});

// Query helpers
export async function findOne<T>(pool: mysql.Pool, sql: string, params: any[] = []): Promise<T | null> {
  const [rows] = await pool.execute(sql, params);
  const results = rows as T[];
  return results.length > 0 ? results[0] : null;
}

export async function findMany<T>(pool: mysql.Pool, sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

// Alias for findMany
export const findAll = findMany;

export async function insertOne(pool: mysql.Pool, sql: string, params: any[] = []): Promise<number> {
  const [result] = await pool.execute(sql, params);
  return (result as mysql.ResultSetHeader).insertId;
}

export async function updateOne(pool: mysql.Pool, sql: string, params: any[] = []): Promise<number> {
  const [result] = await pool.execute(sql, params);
  return (result as mysql.ResultSetHeader).affectedRows;
}

// Auto-migrations for new tables
async function runAutoMigrations(pool: mysql.Pool, fastify: FastifyInstance): Promise<void> {
  const migrations = [
    {
      name: 'user_google_auth',
      sql: `CREATE TABLE IF NOT EXISTS user_google_auth (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL UNIQUE,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id)
      ) ENGINE=InnoDB`
    },
    {
      name: 'document_chunks',
      sql: `CREATE TABLE IF NOT EXISTS document_chunks (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        attachment_id BIGINT UNSIGNED NOT NULL,
        chunk_index INT UNSIGNED NOT NULL,
        content TEXT NOT NULL,
        char_count INT UNSIGNED NOT NULL,
        metadata JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_attachment_id (attachment_id),
        INDEX idx_chunk_index (attachment_id, chunk_index),
        FULLTEXT INDEX ft_content (content),
        CONSTRAINT fk_chunk_attachment FOREIGN KEY (attachment_id)
            REFERENCES chat_attachments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'memory_observations',
      sql: `CREATE TABLE IF NOT EXISTS memory_observations (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        conversation_id BIGINT UNSIGNED NULL,
        observation_type ENUM('insight', 'decision', 'pattern', 'error', 'preference', 'fact', 'manual') DEFAULT 'insight',
        content TEXT NOT NULL,
        source_message_id BIGINT UNSIGNED NULL,
        tags JSON,
        importance TINYINT UNSIGNED DEFAULT 5,
        is_archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
        FULLTEXT INDEX ft_content (content),
        INDEX idx_user_type (user_id, observation_type),
        INDEX idx_user_created (user_id, created_at DESC),
        INDEX idx_importance (importance DESC)
      ) ENGINE=InnoDB`
    },
    {
      name: 'memory_summaries',
      sql: `CREATE TABLE IF NOT EXISTS memory_summaries (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        conversation_id BIGINT UNSIGNED NOT NULL,
        summary TEXT NOT NULL,
        key_observations JSON,
        tokens_saved INT UNSIGNED DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FULLTEXT INDEX ft_summary (summary),
        INDEX idx_user_created (user_id, created_at DESC)
      ) ENGINE=InnoDB`
    },
    {
      name: 'memory_settings',
      sql: `CREATE TABLE IF NOT EXISTS memory_settings (
        user_id BIGINT UNSIGNED PRIMARY KEY,
        auto_capture BOOLEAN DEFAULT TRUE,
        inject_context BOOLEAN DEFAULT TRUE,
        max_context_observations INT DEFAULT 10,
        importance_threshold TINYINT DEFAULT 3,
        retention_days INT DEFAULT 365,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`
    },
    {
      name: 'vector_index_status',
      sql: `CREATE TABLE IF NOT EXISTS vector_index_status (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        attachment_id BIGINT UNSIGNED NOT NULL UNIQUE,
        total_chunks INT UNSIGNED NOT NULL DEFAULT 0,
        indexed_chunks INT UNSIGNED NOT NULL DEFAULT 0,
        embedding_model VARCHAR(100) NULL,
        vector_collection VARCHAR(100) NULL,
        status ENUM('pending', 'indexing', 'completed', 'failed') DEFAULT 'pending',
        error TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_attachment_id (attachment_id),
        INDEX idx_status (status),
        CONSTRAINT fk_vector_attachment FOREIGN KEY (attachment_id)
            REFERENCES chat_attachments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'conversational_forms',
      sql: `CREATE TABLE IF NOT EXISTS conversational_forms (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        display_name VARCHAR(200) NOT NULL,
        description TEXT,
        json_schema JSON NOT NULL,
        start_examples JSON,
        stop_examples JSON,
        ask_confirm BOOLEAN DEFAULT TRUE,
        on_complete_action VARCHAR(50) DEFAULT 'save',
        on_complete_config JSON,
        plugin_id BIGINT UNSIGNED NULL,
        is_enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_enabled (is_enabled)
      ) ENGINE=InnoDB`
    },
    {
      name: 'form_sessions',
      sql: `CREATE TABLE IF NOT EXISTS form_sessions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        conversation_id BIGINT UNSIGNED NOT NULL,
        form_id BIGINT UNSIGNED NOT NULL,
        state ENUM('incomplete', 'complete', 'wait_confirm', 'closed') DEFAULT 'incomplete',
        collected_data JSON DEFAULT (JSON_OBJECT()),
        missing_fields JSON,
        last_question TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (form_id) REFERENCES conversational_forms(id) ON DELETE CASCADE,
        INDEX idx_user_conv (user_id, conversation_id),
        INDEX idx_state (state)
      ) ENGINE=InnoDB`
    },
    {
      name: 'user_documents',
      sql: `CREATE TABLE IF NOT EXISTS user_documents (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        file_size BIGINT UNSIGNED NOT NULL,
        status ENUM('processing', 'ready', 'failed') DEFAULT 'processing',
        error TEXT,
        qdrant_source VARCHAR(512),
        chunks_count INT UNSIGNED DEFAULT 0,
        metadata JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_status (user_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'web_ingestions',
      sql: `CREATE TABLE IF NOT EXISTS web_ingestions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        conversation_id BIGINT UNSIGNED NULL,
        url VARCHAR(2048) NOT NULL,
        title VARCHAR(500),
        content_length INT DEFAULT 0,
        chunks_count INT DEFAULT 0,
        status ENUM('pending', 'fetching', 'chunking', 'indexing', 'completed', 'failed') DEFAULT 'pending',
        error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user (user_id),
        INDEX idx_status (status)
      ) ENGINE=InnoDB`
    },
    {
      name: 'memory_settings_vector_columns',
      sql: `ALTER TABLE memory_settings
        ADD COLUMN IF NOT EXISTS auto_rag_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS episodic_recall_k INT DEFAULT 3,
        ADD COLUMN IF NOT EXISTS episodic_recall_threshold DECIMAL(3,2) DEFAULT 0.70,
        ADD COLUMN IF NOT EXISTS declarative_recall_k INT DEFAULT 3,
        ADD COLUMN IF NOT EXISTS declarative_recall_threshold DECIMAL(3,2) DEFAULT 0.70,
        ADD COLUMN IF NOT EXISTS procedural_recall_k INT DEFAULT 3,
        ADD COLUMN IF NOT EXISTS procedural_recall_threshold DECIMAL(3,2) DEFAULT 0.70`
    },
    {
      name: 'prompt_templates',
      sql: `CREATE TABLE IF NOT EXISTS prompt_templates (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        display_name VARCHAR(200) NOT NULL,
        template_type ENUM('prefix', 'suffix', 'instructions', 'tool_prompt', 'custom') NOT NULL,
        content TEXT NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        description TEXT,
        variables JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_type_active (template_type, is_active),
        INDEX idx_default (is_default)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'scheduled_jobs',
      sql: `CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        job_type ENUM('one_shot', 'interval', 'cron') NOT NULL,
        action_type ENUM('scheduled_message', 'webhook', 'hook', 'plugin_action') NOT NULL,
        action_config JSON NOT NULL,
        schedule_config JSON NOT NULL,
        status ENUM('active', 'paused', 'completed', 'failed', 'cancelled') DEFAULT 'active',
        user_id BIGINT UNSIGNED NOT NULL,
        next_run_at TIMESTAMP NULL,
        last_run_at TIMESTAMP NULL,
        run_count INT UNSIGNED DEFAULT 0,
        max_runs INT UNSIGNED NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_status (status),
        INDEX idx_user (user_id),
        INDEX idx_next_run (next_run_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'job_executions',
      sql: `CREATE TABLE IF NOT EXISTS job_executions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        job_id BIGINT UNSIGNED NOT NULL,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        status ENUM('success', 'failed') DEFAULT 'success',
        result TEXT,
        error TEXT,
        FOREIGN KEY (job_id) REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
        INDEX idx_job (job_id),
        INDEX idx_started (started_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'recall_log',
      sql: `CREATE TABLE IF NOT EXISTS recall_log (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        conversation_id BIGINT UNSIGNED NULL,
        query TEXT NOT NULL,
        episodic_count TINYINT UNSIGNED DEFAULT 0,
        declarative_count TINYINT UNSIGNED DEFAULT 0,
        procedural_count TINYINT UNSIGNED DEFAULT 0,
        avg_score DECIMAL(4,3) DEFAULT 0,
        duration_ms INT UNSIGNED DEFAULT 0,
        hyde_used BOOLEAN DEFAULT FALSE,
        reranked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user (user_id),
        INDEX idx_created (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'resource_permissions',
      sql: `CREATE TABLE IF NOT EXISTS resource_permissions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        resource ENUM(
          'memory', 'conversation', 'settings', 'plugins',
          'hooks', 'tools', 'forms', 'models', 'providers',
          'users', 'scheduler'
        ) NOT NULL,
        can_read BOOLEAN DEFAULT TRUE,
        can_write BOOLEAN DEFAULT FALSE,
        can_edit BOOLEAN DEFAULT FALSE,
        can_delete BOOLEAN DEFAULT FALSE,
        can_list BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uniq_user_resource (user_id, resource),
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'token_usage_components',
      sql: `CREATE TABLE IF NOT EXISTS token_usage_components (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        usage_id BIGINT UNSIGNED NULL,
        conversation_id BIGINT UNSIGNED NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        component ENUM('system_prompt','memory_context','hyde','user_message','tool_definitions','tool_results','assistant_response') NOT NULL,
        tokens_estimate INT UNSIGNED NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_usage (usage_id),
        INDEX idx_conversation (conversation_id),
        INDEX idx_user_component (user_id, component),
        INDEX idx_created (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'plugins_add_dependencies',
      sql: `ALTER TABLE plugins ADD COLUMN IF NOT EXISTS dependencies JSON NULL`
    },
    {
      name: 'batch_jobs',
      sql: `CREATE TABLE IF NOT EXISTS batch_jobs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        batch_id VARCHAR(255) NOT NULL,
        model VARCHAR(100) NOT NULL,
        status ENUM('in_progress','canceling','ended') DEFAULT 'in_progress',
        total_requests INT DEFAULT 0,
        succeeded INT DEFAULT 0,
        errored INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        INDEX idx_batch_id (batch_id),
        INDEX idx_user_batch (user_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    // ── AI Act Compliance Tables ──────────────────────────────────────
    {
      name: 'user_consents',
      sql: `CREATE TABLE IF NOT EXISTS user_consents (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        consent_type ENUM('ai_disclosure','data_processing','terms_of_service','cookie') NOT NULL,
        granted BOOLEAN NOT NULL DEFAULT FALSE,
        ip_address VARCHAR(45),
        user_agent TEXT,
        granted_at TIMESTAMP NULL,
        revoked_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uk_user_consent (user_id, consent_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'ai_decision_log',
      sql: `CREATE TABLE IF NOT EXISTS ai_decision_log (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        conversation_id BIGINT UNSIGNED NULL,
        message_id BIGINT UNSIGNED NULL,
        ai_model VARCHAR(100) NOT NULL,
        ai_provider VARCHAR(50) NOT NULL,
        prompt_hash VARCHAR(64),
        response_hash VARCHAR(64),
        tokens_input INT UNSIGNED DEFAULT 0,
        tokens_output INT UNSIGNED DEFAULT 0,
        latency_ms INT UNSIGNED DEFAULT 0,
        safety_flags JSON,
        disclosure_shown BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_created_at (created_at),
        INDEX idx_model (ai_model),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'ai_content_labels',
      sql: `CREATE TABLE IF NOT EXISTS ai_content_labels (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        message_id BIGINT UNSIGNED NOT NULL,
        content_type ENUM('chat_response','document','code','summary') NOT NULL,
        ai_model VARCHAR(100),
        ai_provider VARCHAR(50),
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        INDEX idx_message_id (message_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'response_feedback',
      sql: `CREATE TABLE IF NOT EXISTS response_feedback (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        message_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        rating TINYINT NOT NULL,
        category ENUM('accurate','inaccurate','harmful','biased','helpful','other') NULL,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uk_user_message (user_id, message_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'data_export_requests',
      sql: `CREATE TABLE IF NOT EXISTS data_export_requests (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        status ENUM('pending','processing','completed','failed','expired') DEFAULT 'pending',
        format ENUM('json','zip') DEFAULT 'json',
        file_path VARCHAR(500),
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        expires_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_status (user_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'account_deletion_requests',
      sql: `CREATE TABLE IF NOT EXISTS account_deletion_requests (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        status ENUM('pending','confirmed','completed','cancelled') DEFAULT 'pending',
        reason TEXT,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        confirm_by TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'bias_monitoring_log',
      sql: `CREATE TABLE IF NOT EXISTS bias_monitoring_log (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        period_start TIMESTAMP NOT NULL,
        period_end TIMESTAMP NOT NULL,
        ai_model VARCHAR(100) NOT NULL,
        ai_provider VARCHAR(50) NOT NULL,
        total_requests INT UNSIGNED DEFAULT 0,
        refusal_count INT UNSIGNED DEFAULT 0,
        error_count INT UNSIGNED DEFAULT 0,
        avg_latency_ms INT UNSIGNED DEFAULT 0,
        negative_feedback_count INT UNSIGNED DEFAULT 0,
        positive_feedback_count INT UNSIGNED DEFAULT 0,
        flagged_content_count INT UNSIGNED DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_period (period_start, period_end),
        INDEX idx_model (ai_model)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    // ── Model Orchestrator Tables (FASE 8) ─────────────────────────────
    {
      name: 'model_routing_tiers',
      sql: `CREATE TABLE IF NOT EXISTS model_routing_tiers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tier_name ENUM('fast', 'balanced', 'powerful') NOT NULL,
        provider VARCHAR(50) NOT NULL,
        model_id VARCHAR(100) NOT NULL,
        priority INT DEFAULT 0,
        max_concurrent INT DEFAULT 0,
        is_enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tier_enabled (tier_name, is_enabled),
        UNIQUE KEY uk_tier_model (tier_name, model_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'model_routing_tiers_auto_seed',
      sql: `INSERT IGNORE INTO model_routing_tiers (tier_name, provider, model_id, priority)
        SELECT 'fast', p.name, m.model_id, m.sort_order
        FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
        WHERE m.is_enabled = TRUE AND p.is_enabled = TRUE AND m.model_type IN ('chat','completion')
        ORDER BY m.sort_order ASC LIMIT 4`
    },
    {
      name: 'model_routing_tiers_auto_seed_balanced',
      sql: `INSERT IGNORE INTO model_routing_tiers (tier_name, provider, model_id, priority)
        SELECT 'balanced', p.name, m.model_id, m.sort_order
        FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
        WHERE m.is_enabled = TRUE AND p.is_enabled = TRUE AND m.model_type IN ('chat','completion')
        ORDER BY m.sort_order ASC LIMIT 4 OFFSET 4`
    },
    {
      name: 'model_routing_tiers_auto_seed_powerful',
      sql: `INSERT IGNORE INTO model_routing_tiers (tier_name, provider, model_id, priority)
        SELECT 'powerful', p.name, m.model_id, m.sort_order
        FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
        WHERE m.is_enabled = TRUE AND p.is_enabled = TRUE AND m.model_type IN ('chat','completion')
        ORDER BY m.sort_order DESC LIMIT 4`
    },
    {
      name: 'model_routing_vllm_priority_first',
      sql: `UPDATE model_routing_tiers SET priority = 0 WHERE model_id = 'qwen25vl:32b'`
    },
    {
      name: 'model_routing_bump_non_vllm',
      sql: `UPDATE model_routing_tiers SET priority = GREATEST(priority, 10) WHERE model_id != 'qwen25vl:32b' AND priority < 10`
    },
    {
      name: 'routing_decisions',
      sql: `CREATE TABLE IF NOT EXISTS routing_decisions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        conversation_id BIGINT UNSIGNED NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        query_length INT UNSIGNED DEFAULT 0,
        query_complexity_score FLOAT DEFAULT 0,
        selected_tier ENUM('fast', 'balanced', 'powerful') NOT NULL,
        selected_model VARCHAR(100) NOT NULL,
        routing_reason VARCHAR(500),
        routing_confidence FLOAT DEFAULT 0,
        routing_method ENUM('rule', 'semantic', 'override') DEFAULT 'rule',
        response_quality_score FLOAT NULL,
        latency_ms INT UNSIGNED DEFAULT 0,
        tokens_input INT UNSIGNED DEFAULT 0,
        tokens_output INT UNSIGNED DEFAULT 0,
        cost_usd DECIMAL(10,6) DEFAULT 0,
        user_override BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tier_date (selected_tier, created_at),
        INDEX idx_user_override (user_override, created_at),
        INDEX idx_user (user_id),
        INDEX idx_method (routing_method)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'model_routing_settings',
      sql: `CREATE TABLE IF NOT EXISTS model_routing_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(100) NOT NULL UNIQUE,
        setting_value VARCHAR(500) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'model_routing_settings_seed',
      sql: `INSERT IGNORE INTO model_routing_settings (setting_key, setting_value) VALUES
        ('auto_routing_enabled', 'true'),
        ('cascade_enabled', 'false'),
        ('semantic_routing_enabled', 'false'),
        ('escalation_threshold', '0.5'),
        ('max_escalation_rate', '0.25')`
    },
    {
      name: 'guide_pages',
      sql: `CREATE TABLE IF NOT EXISTS guide_pages (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        slug VARCHAR(100) NOT NULL UNIQUE,
        title VARCHAR(255) NOT NULL,
        description VARCHAR(500) NULL,
        content LONGTEXT NOT NULL,
        updated_by_user_id BIGINT UNSIGNED NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_slug (slug)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    },
    {
      name: 'user_certificates',
      sql: `CREATE TABLE IF NOT EXISTS user_certificates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        subject_cn VARCHAR(255),
        issuer_cn VARCHAR(255),
        serial_number VARCHAR(255),
        valid_from DATETIME,
        valid_to DATETIME,
        certificate_pem TEXT NOT NULL,
        private_key_encrypted TEXT NOT NULL,
        key_encryption_iv VARCHAR(64) NOT NULL,
        key_encryption_salt VARCHAR(64) NOT NULL,
        fingerprint_sha256 VARCHAR(128),
        is_self_signed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY idx_user_fingerprint (user_id, fingerprint_sha256),
        INDEX idx_user_certs (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    }
  ];

  for (const migration of migrations) {
    try {
      await pool.execute(migration.sql);
      fastify.log.info(`[Migration] Table ${migration.name} ready`);
    } catch (err) {
      fastify.log.warn({ err }, `[Migration] Table ${migration.name} migration skipped (may already exist)`);
    }
  }

  // ALTER TABLE migrations for adding columns to existing tables
  const alterMigrations = [
    { name: 'users_add_phone', sql: `ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL` },
    { name: 'users_add_company', sql: `ALTER TABLE users ADD COLUMN company VARCHAR(100) NULL` },
    { name: 'users_add_department', sql: `ALTER TABLE users ADD COLUMN department VARCHAR(100) NULL` },
    { name: 'users_add_job_title', sql: `ALTER TABLE users ADD COLUMN job_title VARCHAR(100) NULL` },
    { name: 'users_add_notes', sql: `ALTER TABLE users ADD COLUMN notes TEXT NULL` },
    { name: 'users_add_mfa_enabled', sql: `ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT FALSE` },
    { name: 'users_add_mfa_secret', sql: `ALTER TABLE users ADD COLUMN mfa_secret VARCHAR(255) NULL` },
    { name: 'user_sessions_add_logged_out_at', sql: `ALTER TABLE user_sessions ADD COLUMN logged_out_at TIMESTAMP NULL` },
    // v4.0: AI model capabilities
    { name: 'ai_models_add_supports_thinking', sql: `ALTER TABLE ai_models ADD COLUMN supports_thinking BOOLEAN DEFAULT FALSE` },
    { name: 'ai_models_add_supports_citations', sql: `ALTER TABLE ai_models ADD COLUMN supports_citations BOOLEAN DEFAULT FALSE` },
    { name: 'ai_models_add_supports_caching', sql: `ALTER TABLE ai_models ADD COLUMN supports_caching BOOLEAN DEFAULT FALSE` },
    { name: 'ai_models_add_supports_native_pdf', sql: `ALTER TABLE ai_models ADD COLUMN supports_native_pdf BOOLEAN DEFAULT FALSE` },
    // v4.0: Token usage cache/thinking tracking
    { name: 'token_usage_add_cache_creation', sql: `ALTER TABLE token_usage ADD COLUMN cache_creation_tokens INT DEFAULT 0` },
    { name: 'token_usage_add_cache_read', sql: `ALTER TABLE token_usage ADD COLUMN cache_read_tokens INT DEFAULT 0` },
    { name: 'token_usage_add_thinking', sql: `ALTER TABLE token_usage ADD COLUMN thinking_tokens INT DEFAULT 0` },
    // ── AI Act Compliance Columns ──────────────────────────────────────
    { name: 'messages_add_is_ai_generated', sql: `ALTER TABLE messages ADD COLUMN is_ai_generated BOOLEAN DEFAULT FALSE` },
    { name: 'messages_add_ai_model', sql: `ALTER TABLE messages ADD COLUMN ai_model VARCHAR(100) NULL` },
    { name: 'messages_add_ai_provider', sql: `ALTER TABLE messages ADD COLUMN ai_provider VARCHAR(50) NULL` },
    { name: 'conversations_add_ai_disclosure_shown', sql: `ALTER TABLE conversations ADD COLUMN ai_disclosure_shown BOOLEAN DEFAULT FALSE` },
    { name: 'conversations_add_ai_disclosure_shown_at', sql: `ALTER TABLE conversations ADD COLUMN ai_disclosure_shown_at TIMESTAMP NULL` },
    { name: 'ai_models_add_knowledge_cutoff', sql: `ALTER TABLE ai_models ADD COLUMN knowledge_cutoff VARCHAR(20) NULL` },
    { name: 'ai_models_add_limitations', sql: `ALTER TABLE ai_models ADD COLUMN limitations TEXT NULL` },
    { name: 'ai_models_add_bias_notes', sql: `ALTER TABLE ai_models ADD COLUMN bias_notes TEXT NULL` },
    { name: 'ai_models_add_safety_rating', sql: `ALTER TABLE ai_models ADD COLUMN safety_rating VARCHAR(20) NULL` },
    { name: 'ai_models_add_documentation_url', sql: `ALTER TABLE ai_models ADD COLUMN documentation_url VARCHAR(500) NULL` },
    { name: 'conversations_add_chat_mode', sql: `ALTER TABLE conversations ADD COLUMN chat_mode ENUM('free', 'rag') DEFAULT 'free'` },
    { name: 'conversations_add_document_ids', sql: `ALTER TABLE conversations ADD COLUMN document_ids JSON NULL` },
    // v4.1: Brainstorming mode
    { name: 'conversations_chat_mode_add_brainstorm', sql: `ALTER TABLE conversations MODIFY COLUMN chat_mode ENUM('free', 'rag', 'brainstorm') DEFAULT 'free'` },
    // v4.2: Hidden and local-only users
    { name: 'users_add_is_hidden', sql: `ALTER TABLE users ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT FALSE` },
    { name: 'users_add_local_only', sql: `ALTER TABLE users ADD COLUMN local_only BOOLEAN NOT NULL DEFAULT FALSE` },
    // v2.1.62: Distinguish admin-disabled models from auto-disabled ones
    // so the LLMSyncWorker can re-enable false-positives without overriding
    // an explicit admin choice.
    { name: 'ai_models_add_is_manually_disabled', sql: `ALTER TABLE ai_models ADD COLUMN is_manually_disabled BOOLEAN NOT NULL DEFAULT FALSE` },
    // v2.1.65: Symmetric flag to mark models the admin explicitly enabled with ?force=true.
    // The LLMSyncWorker auto-disable pass MUST NOT clear admin-forced models even if the
    // chat-completions filter would normally flag them as incompatible.
    { name: 'ai_models_add_is_manually_enabled', sql: `ALTER TABLE ai_models ADD COLUMN is_manually_enabled BOOLEAN NOT NULL DEFAULT FALSE` },
    // v2.1.68: PDF draft persistence for OnlyOffice editor flow
    { name: 'chat_attachments_add_parent_attachment_id', sql: `ALTER TABLE chat_attachments ADD COLUMN parent_attachment_id BIGINT UNSIGNED NULL` },
    { name: 'chat_attachments_add_is_draft', sql: `ALTER TABLE chat_attachments ADD COLUMN is_draft BOOLEAN NOT NULL DEFAULT FALSE` },
    { name: 'chat_attachments_add_draft_session_id', sql: `ALTER TABLE chat_attachments ADD COLUMN draft_session_id VARCHAR(64) NULL` },
    { name: 'chat_attachments_add_idx_conv_draft', sql: `ALTER TABLE chat_attachments ADD INDEX idx_conv_draft (conversation_id, is_draft)` },
  ];

  for (const migration of alterMigrations) {
    try {
      await pool.execute(migration.sql);
      fastify.log.info(`[Migration] Column ${migration.name} added`);
    } catch (err: any) {
      // Error 1060 = Duplicate column name (already exists) - expected, skip silently
      if (err?.errno !== 1060) {
        fastify.log.warn({ err }, `[Migration] Column ${migration.name} migration failed`);
      }
    }
  }

  // v4.0: Enable capabilities for Claude models (only where not already set)
  try {
    await pool.execute(
      `UPDATE ai_models SET
        supports_thinking = TRUE,
        supports_citations = TRUE,
        supports_caching = TRUE,
        supports_native_pdf = TRUE
       WHERE model_id LIKE 'claude-%'
         AND (supports_thinking IS NULL OR supports_thinking = FALSE)`
    );
  } catch (err: any) {
    // Columns might not exist yet on first run, skip
    if (err?.errno !== 1054) {
      fastify.log.warn({ err }, `[Migration] Claude capabilities update failed`);
    }
  }

  // v4.1: Enable thinking for Ollama reasoning models
  try {
    await pool.execute(
      `UPDATE ai_models SET supports_thinking = TRUE
       WHERE (model_id LIKE 'deepseek-r1:%' OR model_id LIKE 'qwq:%' OR model_id LIKE 'qwen3:%')
         AND (supports_thinking IS NULL OR supports_thinking = FALSE)`
    );
  } catch (err: any) {
    if (err?.errno !== 1054) {
      fastify.log.warn({ err }, `[Migration] Ollama thinking capabilities update failed`);
    }
  }

  // Seed AI Act compliance settings
  await seedAIActSettings(pool, fastify);

  // Seed default prompt templates
  await seedPromptTemplates(pool, fastify);

  // Seed guide pages from static HTML files (only if table is empty)
  await seedGuidePages(pool, fastify);
}

async function seedAIActSettings(pool: mysql.Pool, fastify: FastifyInstance): Promise<void> {
  const aiActSettings = [
    { key: 'ai_act_compliance_enabled', value: 'true', type: 'boolean', desc: 'Enable AI Act compliance features', pub: true },
    { key: 'ai_disclosure_banner_text', value: 'Stai interagendo con un sistema di intelligenza artificiale. Le risposte sono generate da modelli AI e potrebbero non essere sempre accurate.', type: 'string', desc: 'AI disclosure banner text shown to users', pub: true },
    { key: 'ai_disclosure_banner_enabled', value: 'true', type: 'boolean', desc: 'Show AI disclosure banner in chat', pub: true },
    { key: 'require_ai_consent_on_login', value: 'true', type: 'boolean', desc: 'Require AI usage consent before first chat', pub: true },
    { key: 'ai_content_labeling_enabled', value: 'true', type: 'boolean', desc: 'Label AI-generated content with model info', pub: true },
    { key: 'data_retention_days', value: '365', type: 'number', desc: 'Days to retain AI decision logs', pub: false },
    { key: 'data_export_enabled', value: 'true', type: 'boolean', desc: 'Allow users to export their data', pub: true },
    { key: 'account_deletion_grace_days', value: '30', type: 'number', desc: 'Grace period in days before account deletion', pub: false },
    { key: 'bias_monitoring_enabled', value: 'true', type: 'boolean', desc: 'Enable periodic bias monitoring', pub: false },
    { key: 'human_oversight_topics', value: '["medical","legal","financial","hiring"]', type: 'json', desc: 'Topics requiring human oversight warning', pub: false },
    { key: 'feedback_enabled', value: 'true', type: 'boolean', desc: 'Enable thumbs up/down feedback on AI responses', pub: true },
    { key: 'mfa_enforced', value: 'false', type: 'boolean', desc: 'Richiedi autenticazione a due fattori (MFA) per accesso esterno', pub: true },
  ];

  for (const s of aiActSettings) {
    try {
      await pool.execute(
        `INSERT IGNORE INTO system_settings (setting_key, setting_value, setting_type, description, is_public)
         VALUES (?, ?, ?, ?, ?)`,
        [s.key, s.value, s.type, s.desc, s.pub]
      );
    } catch {
      // Already exists, skip
    }
  }

  // Seed model documentation (AI Act Art. 50) — includes bias_notes (GAP-8/11)
  const modelDocs = [
    { pattern: 'gpt-4o%', cutoff: '2024-04', limitations: 'Può generare informazioni non accurate (allucinazioni). Non adatto per consulenza medica o legale. Possibili bias nei dati di training.', biasNotes: 'Possibili bias derivanti dai dati di training (Common Crawl, libri, web). Sottorappresentazione di lingue non inglesi. Può riflettere stereotipi culturali occidentali.', rating: 'high', url: 'https://platform.openai.com/docs/models' },
    { pattern: 'gpt-4-turbo%', cutoff: '2024-04', limitations: 'Può generare informazioni non accurate. Non adatto per consulenza medica o legale.', biasNotes: 'Stessi bias del dataset GPT-4. Possibile sycophancy (tendenza ad assecondare l\'utente).', rating: 'high', url: 'https://platform.openai.com/docs/models' },
    { pattern: 'gpt-3.5%', cutoff: '2021-09', limitations: 'Modello meno capace. Maggiore tendenza ad allucinazioni. Contesto limitato.', biasNotes: 'Bias più marcati rispetto a GPT-4. Dataset di training meno curato. Maggiore sensibilità a prompt injection.', rating: 'medium', url: 'https://platform.openai.com/docs/models' },
    { pattern: 'claude-%', cutoff: '2025-04', limitations: 'Può generare informazioni non accurate. Non adatto per consulenza medica o legale. Possibili bias nei dati di training.', biasNotes: 'Addestrato con RLHF e Constitutional AI. Tendenza a essere eccessivamente cauto. Possibili bias culturali anglosassoni.', rating: 'high', url: 'https://docs.anthropic.com/en/docs/about-claude/models' },
    { pattern: 'gemini-%', cutoff: '2024-08', limitations: 'Può generare informazioni non accurate. Contesto più breve rispetto ai concorrenti. Possibili bias nei dati di training.', biasNotes: 'Addestrato su dati Google. Possibile bias verso prodotti/servizi Google. Bias linguistici verso inglese e lingue ad alta risorsa.', rating: 'medium', url: 'https://ai.google.dev/gemini-api/docs' },
  ];

  for (const m of modelDocs) {
    try {
      await pool.execute(
        `UPDATE ai_models SET
          knowledge_cutoff = COALESCE(knowledge_cutoff, ?),
          limitations = COALESCE(limitations, ?),
          bias_notes = COALESCE(bias_notes, ?),
          safety_rating = COALESCE(safety_rating, ?),
          documentation_url = COALESCE(documentation_url, ?)
         WHERE model_id LIKE ?`,
        [m.cutoff, m.limitations, m.biasNotes, m.rating, m.url, m.pattern]
      );
    } catch (err: any) {
      if (err?.errno !== 1054) {
        fastify.log.warn({ err }, `[AI-Act] Model docs seed failed for ${m.pattern}`);
      }
    }
  }

  fastify.log.info('[AI-Act] Compliance settings and model documentation seeded');
}

async function seedPromptTemplates(pool: mysql.Pool, fastify: FastifyInstance): Promise<void> {
  try {
    const [rows] = await pool.execute('SELECT COUNT(*) as cnt FROM prompt_templates');
    const count = (rows as any[])[0]?.cnt || 0;
    if (count > 0) return; // Already seeded

    const { DEFAULT_TEMPLATES } = await import('../services/PromptTemplateService.js');
    for (const t of DEFAULT_TEMPLATES) {
      await pool.execute(
        `INSERT INTO prompt_templates (name, display_name, template_type, content, is_default, is_active, description, variables)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.name, t.display_name, t.template_type, t.content, t.is_default, t.is_active, t.description, JSON.stringify(t.variables)]
      );
    }
    fastify.log.info(`[Migration] Seeded ${DEFAULT_TEMPLATES.length} default prompt templates`);
  } catch (err) {
    fastify.log.warn({ err }, '[Migration] Prompt templates seeding skipped');
  }
}

async function seedGuidePages(pool: mysql.Pool, fastify: FastifyInstance): Promise<void> {
  try {
    const [rows] = await pool.execute('SELECT COUNT(*) as cnt FROM guide_pages');
    const count = (rows as any[])[0]?.cnt || 0;
    if (count > 0) return; // Already seeded

    const guidesDir = join(__dirname_db, '..', 'guides');
    const guides = [
      {
        slug: 'user',
        title: 'Guida Utente',
        description: 'Guida completa per gli utenti della piattaforma Enterprise AI Chat',
        file: join(guidesDir, 'user-guide.html'),
      },
      {
        slug: 'admin',
        title: 'Guida Amministratore',
        description: 'Guida completa per la configurazione e gestione del sistema',
        file: join(guidesDir, 'admin-guide.html'),
      },
    ];

    let seeded = 0;
    for (const g of guides) {
      if (!existsSync(g.file)) {
        fastify.log.warn(`[Guides] File not found, skipping seed for slug "${g.slug}": ${g.file}`);
        continue;
      }
      const content = readFileSync(g.file, 'utf-8');
      await pool.execute(
        `INSERT INTO guide_pages (slug, title, description, content) VALUES (?, ?, ?, ?)`,
        [g.slug, g.title, g.description, content]
      );
      seeded++;
    }
    fastify.log.info(`[Guides] Seeded ${seeded} guide pages from static HTML files`);
  } catch (err) {
    fastify.log.warn({ err }, '[Guides] Guide pages seeding skipped');
  }
}
