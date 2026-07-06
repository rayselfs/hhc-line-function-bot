import pg from "pg";

import type { DatabaseConfig } from "../types.js";

export interface PostgresRuntime {
  pool: pg.Pool;
}

export async function createPostgresRuntime(
  config: DatabaseConfig | undefined
): Promise<PostgresRuntime | undefined> {
  if (!config) {
    return undefined;
  }

  const pool = new pg.Pool({
    connectionString: config.url,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined
  });

  await pool.query("select 1");
  return { pool };
}
