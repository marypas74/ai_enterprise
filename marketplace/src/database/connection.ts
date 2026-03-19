import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { execute, findMany } from './helpers.js';
import { initialSchema } from './migrations/001-initial-schema.js';

export interface Migration {
  readonly name: string;
  readonly up: (pool: mysql.Pool) => Promise<void>;
}

const migrations: readonly Migration[] = [initialSchema];

function createPool(): mysql.Pool {
  return mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectionLimit: config.db.connectionLimit,
    waitForConnections: true,
    multipleStatements: false,
  });
}

async function ensureMigrationsTable(pool: mysql.Pool): Promise<void> {
  await execute(
    pool,
    `CREATE TABLE IF NOT EXISTS marketplace_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  );
}

async function getAppliedMigrations(pool: mysql.Pool): Promise<readonly string[]> {
  const rows = await findMany<{ name: string }>(
    pool,
    'SELECT name FROM marketplace_migrations ORDER BY applied_at ASC',
  );
  return rows.map((r) => r.name);
}

async function acquireLock(pool: mysql.Pool): Promise<boolean> {
  const [rows] = await pool.execute(
    'SELECT GET_LOCK(?, 10) AS locked',
    ['marketplace_migrate'],
  );
  const result = (rows as Array<{ locked: number }>)[0];
  return result.locked === 1;
}

async function releaseLock(pool: mysql.Pool): Promise<void> {
  await pool.execute('SELECT RELEASE_LOCK(?)', ['marketplace_migrate']);
}

export async function runMigrations(pool: mysql.Pool): Promise<void> {
  const locked = await acquireLock(pool);
  if (!locked) {
    throw new Error('Could not acquire migration lock — another instance may be migrating');
  }

  try {
    await ensureMigrationsTable(pool);
    const applied = await getAppliedMigrations(pool);

    for (const migration of migrations) {
      if (!applied.includes(migration.name)) {
        console.log(`[marketplace] Running migration: ${migration.name}`);
        await migration.up(pool);
        await execute(
          pool,
          'INSERT INTO marketplace_migrations (name) VALUES (?)',
          [migration.name],
        );
        console.log(`[marketplace] Migration complete: ${migration.name}`);
      }
    }
  } finally {
    await releaseLock(pool);
  }
}

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
