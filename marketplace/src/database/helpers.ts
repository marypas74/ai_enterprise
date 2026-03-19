import type mysql from 'mysql2/promise';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryParams = any[];

export async function findOne<T>(
  pool: mysql.Pool,
  sql: string,
  params: QueryParams = [],
): Promise<T | null> {
  const [rows] = await pool.execute(sql, params);
  const results = rows as T[];
  return results.length > 0 ? results[0] : null;
}

export async function findMany<T>(
  pool: mysql.Pool,
  sql: string,
  params: QueryParams = [],
): Promise<T[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

export async function insertOne(
  pool: mysql.Pool,
  sql: string,
  params: QueryParams = [],
): Promise<number> {
  const [result] = await pool.execute(sql, params);
  return (result as mysql.ResultSetHeader).insertId;
}

export async function execute(
  pool: mysql.Pool,
  sql: string,
  params: QueryParams = [],
): Promise<void> {
  await pool.execute(sql, params);
}
