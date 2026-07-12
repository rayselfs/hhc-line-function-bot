import { describe, expect, it } from "vitest";

import { InMemoryKnowledgeStore } from "../knowledge/store.js";

describe("knowledge store", () => {
  it("filters disabled and expired sources before hybrid retrieval", async () => {
    const store = new InMemoryKnowledgeStore(() => new Date("2026-07-12T00:00:00Z"));
    const active = await store.upsertSource({
      profileName: "helper",
      sourceKey: "meeting-sop",
      displayName: "聚會 SOP",
      adapterType: "notion",
      externalRootId: "page-1",
      rootUrl: "https://www.notion.so/page-1",
      enabled: true
    });
    const expired = await store.upsertSource({
      profileName: "helper",
      sourceKey: "old-trip",
      displayName: "舊行程",
      adapterType: "notion",
      externalRootId: "page-2",
      rootUrl: "https://www.notion.so/page-2",
      enabled: true,
      expiresAt: "2026-07-11T00:00:00Z"
    });

    await store.replaceDocument({
      sourceId: active.id,
      externalId: "doc-1",
      title: "聚會 SOP",
      url: active.rootUrl,
      nodes: [{ externalId: "node-1", type: "paragraph", ordinal: 0, text: "聚會後關閉音控設備" }],
      chunks: [
        { headingPath: ["場復"], ordinal: 0, content: "聚會後關閉音控設備", contentHash: "h1" }
      ]
    });
    await store.replaceDocument({
      sourceId: expired.id,
      externalId: "doc-2",
      title: "舊行程",
      url: expired.rootUrl,
      nodes: [{ externalId: "node-2", type: "paragraph", ordinal: 0, text: "聚會後關閉音控設備" }],
      chunks: [{ headingPath: [], ordinal: 0, content: "聚會後關閉音控設備", contentHash: "h2" }]
    });

    const results = await store.search({ profileName: "helper", query: "關閉音控", limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0]?.source.sourceKey).toBe("meeting-sop");
  });

  it("combines lexical and vector ranks while preserving exact ordinal matches", async () => {
    const store = new InMemoryKnowledgeStore(() => new Date("2026-07-12T00:00:00Z"));
    const source = await store.upsertSource({
      profileName: "helper",
      sourceKey: "trip",
      displayName: "八月出遊",
      adapterType: "notion",
      externalRootId: "page-1",
      rootUrl: "https://www.notion.so/page-1",
      enabled: true
    });
    const document = await store.replaceDocument({
      sourceId: source.id,
      externalId: "doc-1",
      title: "八月出遊",
      url: source.rootUrl,
      nodes: [],
      chunks: [
        { headingPath: ["第一天"], ordinal: 0, content: "第一個地點是日月潭", contentHash: "h1" },
        { headingPath: ["第二天"], ordinal: 1, content: "第二個地點是清境農場", contentHash: "h2" }
      ]
    });
    await store.upsertEmbedding({
      chunkId: document.chunks[0]!.id,
      provider: "ollama",
      model: "bge-m3",
      dimensions: 3,
      embedding: [0, 1, 0],
      contentHash: "h1"
    });
    await store.upsertEmbedding({
      chunkId: document.chunks[1]!.id,
      provider: "ollama",
      model: "bge-m3",
      dimensions: 3,
      embedding: [1, 0, 0],
      contentHash: "h2"
    });

    const results = await store.search({
      profileName: "helper",
      query: "第一個地點",
      queryEmbedding: [1, 0, 0],
      ordinal: 0,
      limit: 2
    });

    expect(results[0]?.content).toContain("日月潭");
  });
});
