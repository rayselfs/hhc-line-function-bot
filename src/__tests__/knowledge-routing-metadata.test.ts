import { describe, expect, it } from "vitest";

import { buildCapabilityCandidates } from "../agent/capability-candidates.js";
import {
  deriveKnowledgeRoutingMetadata,
  listKnowledgeRoutingMetadata,
  matchingKnowledgeRoutingMetadata
} from "../knowledge/routing-metadata.js";
import { syncKnowledgeSource } from "../knowledge/sync-service.js";
import { InMemoryKnowledgeStore } from "../knowledge/store.js";

describe("knowledge routing metadata", () => {
  it("derives bounded aliases and topics from titles and headings without reading content", () => {
    const metadata = deriveKnowledgeRoutingMetadata("2026 青年出隊", [
      {
        title: "2026 青年出隊行程",
        nodes: [
          { externalId: "h1", type: "heading_1", ordinal: 0, text: "第一天" },
          {
            externalId: "p1",
            type: "paragraph",
            ordinal: 1,
            text: "Bearer secret-token-value https://private.example.test"
          }
        ]
      }
    ]);

    expect(metadata.aliases).toEqual(expect.arrayContaining(["青年出隊", "青年出隊行程"]));
    expect(metadata.topics).toEqual(expect.arrayContaining(["2026 青年出隊行程", "第一天"]));
    expect(JSON.stringify(metadata)).not.toMatch(/secret-token|private\.example/iu);
    expect(metadata.aliases.length).toBeLessThanOrEqual(20);
    expect(metadata.topics.length).toBeLessThanOrEqual(20);
    expect([...metadata.aliases, ...metadata.topics].every((term) => [...term].length <= 100)).toBe(
      true
    );
  });

  it("normalizes and bounds administrator metadata on write and read", async () => {
    const store = new InMemoryKnowledgeStore(() => new Date("2026-07-13T00:00:00Z"));
    await store.upsertSource({
      profileName: "helper",
      sourceKey: "retreat",
      displayName: " 2026   青年出隊 ",
      adapterType: "notion",
      externalRootId: "root",
      rootUrl: "https://example.test/root",
      enabled: true,
      aliases: ["出隊", " 出隊 ", ...Array.from({ length: 30 }, (_, index) => `別名${index}`)],
      topics: ["第一天", "x".repeat(120)],
      sampleQueries: ["第一天去哪裡", "那幾點集合", "https://private.example.test/token"]
    });
    await store.updateSource({
      profileName: "helper",
      sourceKey: "retreat",
      syncStatus: "ready",
      lastSyncedAt: "2026-07-13T00:00:00Z"
    });

    const [source] = await store.listSources({ profileName: "helper" });
    expect(source).toMatchObject({
      displayName: "2026 青年出隊",
      sampleQueries: ["第一天去哪裡", "那幾點集合"]
    });
    expect(source!.aliases[0]).toBe("出隊");
    expect(source!.aliases).toHaveLength(20);
    expect(source!.topics[1]).toHaveLength(100);

    await expect(listKnowledgeRoutingMetadata(store, "helper", 20)).resolves.toEqual([
      expect.objectContaining({
        sourceKey: "retreat",
        displayName: "2026 青年出隊",
        sampleQueries: ["第一天去哪裡", "那幾點集合"]
      })
    ]);
  });

  it("routes arbitrary titles and sample queries but excludes stale, expired, and other-profile sources", async () => {
    const now = () => new Date("2026-07-13T00:00:00Z");
    const store = new InMemoryKnowledgeStore(now);
    for (const source of [
      {
        profileName: "helper",
        sourceKey: "retreat",
        displayName: "2026 青年出隊",
        enabled: true,
        expiresAt: undefined,
        syncStatus: "ready" as const,
        lastSyncedAt: "2026-07-13T00:00:00Z",
        sampleQueries: ["第一天去哪裡"]
      },
      {
        profileName: "helper",
        sourceKey: "stale",
        displayName: "舊資料",
        enabled: true,
        expiresAt: undefined,
        syncStatus: "failed" as const,
        lastSyncedAt: undefined,
        sampleQueries: ["舊問題"]
      },
      {
        profileName: "helper",
        sourceKey: "last-good",
        displayName: "可用舊版",
        enabled: true,
        expiresAt: undefined,
        syncStatus: "failed" as const,
        lastSyncedAt: "2026-07-12T00:00:00Z",
        sampleQueries: ["沿用舊版"]
      },
      {
        profileName: "helper",
        sourceKey: "expired",
        displayName: "過期資料",
        enabled: true,
        expiresAt: "2026-07-12T00:00:00Z",
        syncStatus: "ready" as const,
        lastSyncedAt: "2026-07-11T00:00:00Z",
        sampleQueries: ["過期問題"]
      },
      {
        profileName: "main",
        sourceKey: "other",
        displayName: "其他 bot",
        enabled: true,
        expiresAt: undefined,
        syncStatus: "ready" as const,
        lastSyncedAt: "2026-07-13T00:00:00Z",
        sampleQueries: ["其他問題"]
      }
    ]) {
      await store.upsertSource({
        ...source,
        adapterType: "notion",
        externalRootId: `${source.sourceKey}-root`,
        rootUrl: `https://example.test/${source.sourceKey}`,
        aliases: [],
        topics: []
      });
      await store.updateSource({
        profileName: source.profileName,
        sourceKey: source.sourceKey,
        syncStatus: source.syncStatus,
        ...(source.lastSyncedAt ? { lastSyncedAt: source.lastSyncedAt } : {})
      });
    }

    const metadata = await listKnowledgeRoutingMetadata(store, "helper", 20);
    expect(metadata.map(({ sourceKey }) => sourceKey)).toEqual(["last-good", "retreat"]);
    expect(
      buildCapabilityCandidates({
        text: "第一天去哪裡",
        enabledFunctions: ["query_knowledge"],
        source: "group",
        knowledgeSources: metadata,
        maxCandidates: 3
      })
    ).toEqual([
      expect.objectContaining({ capability: "query_knowledge", reason: "knowledge_metadata" })
    ]);
  });

  it("keeps staged administrator metadata separate from the promoted last-known-good snapshot", async () => {
    const store = new InMemoryKnowledgeStore();
    let source = await store.upsertSource({
      profileName: "helper",
      sourceKey: "retreat",
      displayName: "舊名稱",
      adapterType: "notion",
      externalRootId: "root",
      rootUrl: "https://example.test/root",
      enabled: true,
      aliases: ["舊管理別名"],
      topics: ["舊管理主題"],
      sampleQueries: ["舊問題"]
    });
    await syncKnowledgeSource({
      source,
      store,
      notion: {
        fetchRoot: async () => [
          {
            externalId: "doc",
            title: "舊文件標題",
            url: "https://example.test/doc",
            nodes: [{ externalId: "h", type: "heading_1", ordinal: 0, text: "舊章節" }]
          }
        ]
      }
    });

    source = await store.upsertSource({
      profileName: "helper",
      sourceKey: "retreat",
      displayName: "新名稱",
      adapterType: "notion",
      externalRootId: "root",
      rootUrl: "https://example.test/root",
      enabled: true,
      aliases: ["新管理別名"],
      topics: ["新管理主題"],
      sampleQueries: ["新問題"]
    });

    await expect(listKnowledgeRoutingMetadata(store, "helper", 20)).resolves.toEqual([
      expect.objectContaining({
        displayName: "舊名稱",
        aliases: expect.arrayContaining(["舊管理別名"]),
        topics: expect.arrayContaining(["舊文件標題", "舊章節"]),
        sampleQueries: ["舊問題"]
      })
    ]);
    expect(source).toMatchObject({
      displayName: "新名稱",
      adminAliases: ["新管理別名"],
      adminTopics: ["新管理主題"],
      adminSampleQueries: ["新問題"]
    });

    await store.updateSource({
      profileName: "helper",
      sourceKey: "retreat",
      syncStatus: "failed",
      syncErrorCode: "source_unavailable"
    });
    await expect(listKnowledgeRoutingMetadata(store, "helper", 20)).resolves.toEqual([
      expect.objectContaining({ displayName: "舊名稱", sampleQueries: ["舊問題"] })
    ]);

    await syncKnowledgeSource({
      source,
      store,
      notion: {
        fetchRoot: async () => [
          {
            externalId: "doc",
            title: "新文件標題",
            url: "https://example.test/doc",
            nodes: [{ externalId: "h", type: "heading_1", ordinal: 0, text: "新章節" }]
          }
        ]
      }
    });
    const [promoted] = await listKnowledgeRoutingMetadata(store, "helper", 20);
    expect(promoted).toMatchObject({
      displayName: "新名稱",
      aliases: expect.arrayContaining(["新管理別名"]),
      topics: expect.arrayContaining(["新管理主題", "新文件標題", "新章節"]),
      sampleQueries: ["新問題"]
    });
    expect(JSON.stringify(promoted)).not.toMatch(/舊管理|舊文件|舊章節|舊問題/u);
  });

  it("matches routing fields conservatively and requires unique evidence", () => {
    const sources = [
      {
        sourceKey: "alpha-source",
        displayName: "甲來源",
        aliases: ["甲", "共同名稱"],
        topics: ["集合時間"],
        sampleQueries: ["何時集合"]
      },
      {
        sourceKey: "beta-source",
        displayName: "乙來源",
        aliases: ["乙", "共同名稱"],
        topics: ["集合地點"],
        sampleQueries: []
      }
    ];

    expect(matchingKnowledgeRoutingMetadata("甲", sources)).toEqual([]);
    expect(matchingKnowledgeRoutingMetadata("請看 alpha-source 內容", sources)).toEqual([]);
    expect(matchingKnowledgeRoutingMetadata("alpha-source", sources)).toEqual([sources[0]]);
    expect(matchingKnowledgeRoutingMetadata("共同名稱", sources)).toEqual([]);
    expect(matchingKnowledgeRoutingMetadata("請問何時集合", sources)).toEqual([sources[0]]);
    for (const text of ["甲", "請看 alpha-source 內容"]) {
      expect(
        buildCapabilityCandidates({
          text,
          enabledFunctions: ["query_knowledge"],
          source: "group",
          knowledgeSources: sources,
          maxCandidates: 3
        })
      ).toEqual([]);
    }
    expect(
      buildCapabilityCandidates({
        text: "alpha-source",
        enabledFunctions: ["query_knowledge"],
        source: "group",
        knowledgeSources: sources,
        maxCandidates: 3
      })
    ).toEqual([
      expect.objectContaining({ capability: "query_knowledge", reason: "knowledge_metadata" })
    ]);
  });
});
