import { describe, expect, it, vi } from "vitest";

import { runKnowledgeMigrations } from "../knowledge/migrations.js";

describe("knowledge migrations", () => {
  it("creates a 1024-dimension cosine HNSW index without installing pgvector", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await runKnowledgeMigrations({ query });

    const sql = query.mock.calls.map(([statement]) => statement).join("\n");
    expect(sql).toContain("embedding vector(1024)");
    expect(sql).toContain("vector_cosine_ops");
    expect(sql).toContain("using hnsw");
    expect(sql).toContain("aliases text[] not null default '{}'");
    expect(sql).toContain("topics text[] not null default '{}'");
    expect(sql).toContain("sample_queries text[] not null default '{}'");
    expect(sql).toMatch(/alter table knowledge_sources add column if not exists aliases/iu);
    expect(sql).not.toMatch(/create\s+extension/iu);
  });
});
