import { FastifyInstance } from 'fastify';
import mysql from 'mysql2/promise';
import fp from 'fastify-plugin';

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
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
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

  // Seed default prompt templates
  await seedPromptTemplates(pool, fastify);
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
