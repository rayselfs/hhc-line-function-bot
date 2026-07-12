import { runKnowledgeMigrations, verifyPgvector } from "./migrations.js";
import { PostgresKnowledgeStore, type PgKnowledgeQueryable } from "./postgres-store.js";
import { InMemoryKnowledgeStore, type KnowledgeStore } from "./store.js";

export async function createKnowledgeStore(options: {
  db?: PgKnowledgeQueryable;
  now?: () => Date;
}): Promise<KnowledgeStore> {
  if (!options.db) return new InMemoryKnowledgeStore(options.now);
  await verifyPgvector(options.db);
  await runKnowledgeMigrations(options.db);
  return new PostgresKnowledgeStore(options.db);
}
