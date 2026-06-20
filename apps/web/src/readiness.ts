import pg from "pg";

const { Pool } = pg;

export interface ReadinessSnapshot {
  status: "ready" | "partial";
  database: {
    connected: boolean;
    latencyMs: number;
    error?: string;
  };
}

export interface ReadinessPool {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

export type ReadinessPoolFactory = () => ReadinessPool;

const defaultDatabaseUrl = "postgresql://agent:agent@localhost:54329/agent_control_plane";

export async function getReadinessSnapshot(
  env: NodeJS.ProcessEnv = process.env,
  createPool: ReadinessPoolFactory = () => createReadinessPool(env),
): Promise<ReadinessSnapshot> {
  const start = Date.now();
  const pool = createPool();

  try {
    await pool.query("select 1");
    return {
      status: "ready",
      database: {
        connected: true,
        latencyMs: Date.now() - start,
      },
    };
  } catch (error) {
    return {
      status: "partial",
      database: {
        connected: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function createReadinessPool(env: NodeJS.ProcessEnv): ReadinessPool {
  return new Pool({
    connectionString: env.DATABASE_URL?.trim() || defaultDatabaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 1_000,
    statement_timeout: 2_000,
  });
}
