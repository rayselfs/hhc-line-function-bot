import { InMemoryAgentMemoryStore, type AgentMemoryStore } from "./memory-store.js";
import { runAgentMemoryMigrations } from "./migrations.js";
import { PostgresAgentMemoryStore, type PgQueryable } from "./postgres-memory-store.js";

export interface CreateAgentMemoryStoreOptions {
  db?: PgQueryable;
  now?: () => Date;
}

export async function createAgentMemoryStore(
  options: CreateAgentMemoryStoreOptions
): Promise<AgentMemoryStore> {
  if (!options.db) {
    return new InMemoryAgentMemoryStore({ now: options.now });
  }
  await runAgentMemoryMigrations(options.db);
  return new PostgresAgentMemoryStore(options.db, { now: options.now });
}
