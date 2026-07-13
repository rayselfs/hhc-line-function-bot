import { describe, expect, it, vi } from "vitest";

import { PostgresKnowledgeStore } from "../knowledge/postgres-store.js";

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    profile_name: "helper",
    source_key: "retreat",
    display_name: "青年出隊",
    routing_display_name: "青年出隊",
    admin_aliases: [],
    admin_topics: [],
    admin_sample_queries: [],
    aliases: ["出隊"],
    topics: ["集合時間"],
    sample_queries: ["何時集合"],
    adapter_type: "notion",
    external_root_id: "root",
    root_url: "https://example.test/root",
    enabled: true,
    expires_at: null,
    disabled_at: null,
    purge_after: null,
    last_synced_at: "2026-07-13T00:00:00Z",
    sync_status: "ready",
    sync_error_code: null,
    ...overrides
  };
}

describe("PostgresKnowledgeStore routing parity", () => {
  it("quarantines malformed legacy source rows instead of failing the entire list", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [sourceRow({ id: "not-a-uuid", source_key: "" }), sourceRow()]
    });
    const store = new PostgresKnowledgeStore({ query });

    await expect(
      store.listSources({ profileName: "helper", includeDisabled: true })
    ).resolves.toEqual([expect.objectContaining({ id: "11111111-1111-4111-8111-111111111111" })]);
  });

  it("requires last-success eligibility and matches opaque section keys in anchor and search SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PostgresKnowledgeStore({ query });

    await store.hasAnchor({
      profileName: "helper",
      sourceId: "11111111-1111-4111-8111-111111111111",
      documentId: "22222222-2222-4222-8222-222222222222",
      sectionKey: "a".repeat(64)
    });
    await store.search({
      profileName: "helper",
      query: "集合",
      sourceId: "11111111-1111-4111-8111-111111111111",
      sectionKey: "a".repeat(64)
    });

    const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql.match(/last_synced_at\s+is\s+not\s+null/giu)).toHaveLength(2);
    expect(sql).toMatch(/section_key\s*=\s*\$\d+/iu);
    expect(sql).not.toMatch(/any\s*\(c\.heading_path\)/iu);
  });
});
