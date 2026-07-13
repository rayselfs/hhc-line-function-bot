import { describe, expect, it } from "vitest";

import { buildCapabilityCandidates } from "../agent/capability-candidates.js";
import {
  deriveKnowledgeRoutingMetadata,
  listKnowledgeRoutingMetadata
} from "../knowledge/routing-metadata.js";
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
});
