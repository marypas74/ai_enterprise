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
}
