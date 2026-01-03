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
