import { InMemoryAccessStore } from "./memory-access-store.js";
import { runAccessMigrations } from "./migrations.js";
import { PostgresAccessStore, type PgQueryable } from "./postgres-access-store.js";
import type { AccessStore } from "./types.js";

export interface CreateAccessStoreOptions {
  db?: PgQueryable;
}

export async function createAccessStore(options: CreateAccessStoreOptions): Promise<AccessStore> {
  if (!options.db) {
    return new InMemoryAccessStore();
  }
  await runAccessMigrations(options.db);
  return new PostgresAccessStore(options.db);
}
