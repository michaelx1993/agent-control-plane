import pg from "pg";
import { getDatabaseUrl } from "./config.js";

const { Pool } = pg;

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.Pool | pg.PoolClient;

export function createDatabasePool(connectionString = getDatabaseUrl()): DatabasePool {
  return new Pool({
    connectionString,
    max: 5,
  });
}

export async function withDatabasePool<T>(
  callback: (pool: DatabasePool) => Promise<T>,
  connectionString = getDatabaseUrl(),
): Promise<T> {
  const pool = createDatabasePool(connectionString);

  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

export async function withTransaction<T>(
  pool: DatabasePool,
  callback: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
