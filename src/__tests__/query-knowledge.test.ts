import { describe, expect, it, vi } from "vitest";

import { InMemoryKnowledgeStore } from "../knowledge/store.js";
import { createQueryKnowledgeHandler } from "../functions/query-knowledge.js";
import type { BotProfileConfig } from "../types.js";

const profile = { name: "helper", enabledFunctions: ["query_knowledge"] } as BotProfileConfig;

describe("query_knowledge", () => {
  it("answers only from retrieved evidence and includes a source link without provider names", async () => {
    const store = new InMemoryKnowledgeStore();
    const source = await store.upsertSource({
      profileName: "helper",
      sourceKey: "trip",
      displayName: "八月出遊",
      adapterType: "notion",
      externalRootId: "root",
      rootUrl: "https://www.notion.so/root",
      enabled: true
    });
    const document = await store.replaceDocument({
      sourceId: source.id,
      externalId: "doc",
      title: "八月出遊",
      url: "https://www.notion.so/doc",
      nodes: [],
      chunks: [
        { headingPath: ["第一天"], ordinal: 0, content: "第一個地點是日月潭。", contentHash: "h1" }
      ]
    });
    const embed = vi.fn().mockResolvedValue([[1, 0, 0]]);
    await store.upsertEmbedding({
      chunkId: document.chunks[0]!.id,
      provider: "ollama",
      model: "bge-m3",
      dimensions: 3,
      embedding: [1, 0, 0],
      contentHash: "h1"
    });
    const completeText = vi.fn().mockResolvedValue("第一個地點是日月潭。");
    const handler = createQueryKnowledgeHandler({
      store,
      embedding: { provider: "ollama", model: "bge-m3", dimensions: 3, embed },
      textGenerator: { completeText }
    });

    const result = await handler(
      { query: "第一個地點是哪裡", ordinal: 0 },
      {
        profile,
        event: {
          type: "message",
          replyToken: "r",
          source: { type: "user", userId: "u" },
          message: { type: "text", text: "第一個地點是哪裡" }
        }
      }
    );

    expect(result.replyText).toContain("第一個地點是日月潭");
    expect(result.replyText).toContain("八月出遊：https://www.notion.so/doc");
    expect(result.replyText).not.toMatch(/(?:Notion|pgvector|Ollama)[：:]/iu);
    expect(completeText).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining("只能根據證據") })
    );
    expect(result.agentResult).toMatchObject({
      status: "success",
      anchors: {
        sourceKey: "trip",
        documentId: document.id,
        section: "第一天",
        ordinal: 0
      },
      entities: expect.arrayContaining([
        expect.objectContaining({ type: "source", label: "八月出遊" }),
        expect.objectContaining({ type: "document", label: "八月出遊" }),
        expect.objectContaining({ type: "section", label: "第一天" }),
        expect.objectContaining({ type: "ordinal", key: "0" })
      ]),
      supportedOperations: ["continue", "refine", "select"]
    });
    expect(JSON.stringify(result.agentResult)).not.toMatch(/https?:|日月潭|notion/iu);
  });

  it("falls back to lexical retrieval and a controlled excerpt when providers fail", async () => {
    const store = new InMemoryKnowledgeStore();
    const source = await store.upsertSource({
      profileName: "helper",
      sourceKey: "sop",
      displayName: "聚會 SOP",
      adapterType: "notion",
      externalRootId: "root",
      rootUrl: "https://example.test/root",
      enabled: true
    });
    await store.replaceDocument({
      sourceId: source.id,
      externalId: "doc",
      title: "聚會 SOP",
      url: "https://example.test/doc",
      nodes: [],
      chunks: [
        {
          headingPath: ["場復"],
          ordinal: 0,
          content: "聚會結束後請關閉音控設備。",
          contentHash: "h1"
        }
      ]
    });
    const handler = createQueryKnowledgeHandler({
      store,
      embedding: {
        provider: "ollama",
        model: "bge-m3",
        dimensions: 3,
        embed: vi.fn().mockRejectedValue(new Error("offline"))
      },
      textGenerator: { completeText: vi.fn().mockRejectedValue(new Error("offline")) }
    });

    const result = await handler(
      { query: "關閉音控設備" },
      {
        profile,
        event: {
          type: "message",
          replyToken: "r",
          source: { type: "user", userId: "u" },
          message: { type: "text", text: "關閉音控設備" }
        }
      }
    );

    expect(result.ok).toBe(true);
    expect(result.replyText).toContain("聚會結束後請關閉音控設備");
  });

  it("uses the canonical document first and only switches globally with current metadata evidence", async () => {
    const store = new InMemoryKnowledgeStore();
    const trip = await store.upsertSource({
      profileName: "helper",
      sourceKey: "trip",
      displayName: "出遊計畫",
      adapterType: "notion",
      externalRootId: "trip-root",
      rootUrl: "https://example.test/trip",
      enabled: true,
      aliases: ["出遊"],
      topics: ["共同事項"]
    });
    const sop = await store.upsertSource({
      profileName: "helper",
      sourceKey: "sop",
      displayName: "聚會 SOP",
      adapterType: "notion",
      externalRootId: "sop-root",
      rootUrl: "https://example.test/sop",
      enabled: true,
      aliases: ["場復"],
      topics: ["消防設備"]
    });
    const tripDocument = await store.replaceDocument({
      sourceId: trip.id,
      externalId: "trip-doc",
      title: "出遊計畫",
      url: "https://example.test/trip-doc",
      nodes: [],
      chunks: [{ headingPath: [], ordinal: 0, content: "共同事項是攜帶雨具。", contentHash: "t1" }]
    });
    await store.replaceDocument({
      sourceId: sop.id,
      externalId: "sop-doc",
      title: "聚會 SOP",
      url: "https://example.test/sop-doc",
      nodes: [],
      chunks: [
        {
          headingPath: [],
          ordinal: 0,
          content: "共同事項是關閉門窗。消防設備放在後門。",
          contentHash: "s1"
        }
      ]
    });
    const handler = createQueryKnowledgeHandler({ store });
    const continuation = {
      functionName: "query_knowledge" as const,
      arguments: {},
      resultReferences: { sourceKey: "trip", documentId: tripDocument.id },
      createdAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2026-07-12T00:01:00.000Z"
    };
    const handlerContext = {
      profile,
      continuation,
      event: {
        type: "message" as const,
        source: { type: "user" as const, userId: "u" },
        message: { type: "text" as const, text: "共同事項" }
      }
    };

    const scoped = await handler({ query: "共同事項" }, handlerContext);
    const noSwitch = await handler(
      { query: "後門在哪裡" },
      {
        ...handlerContext,
        event: { ...handlerContext.event, message: { type: "text", text: "後門在哪裡" } }
      }
    );
    const switched = await handler(
      { query: "消防設備放哪裡" },
      {
        ...handlerContext,
        event: { ...handlerContext.event, message: { type: "text", text: "消防設備放哪裡" } }
      }
    );

    expect(scoped.replyText).toContain("攜帶雨具");
    expect(scoped.replyText).not.toContain("sop-doc");
    expect(noSwitch.agentResult).toMatchObject({ status: "not_found" });
    expect(switched.replyText).toContain("消防設備放在後門");
    expect(switched.continuation?.resultReferences).toEqual(
      expect.objectContaining({ sourceKey: "sop" })
    );
  });

  it("returns safe not-found, ambiguous, and unavailable result envelopes", async () => {
    const now = () => new Date("2026-07-13T00:00:00Z");
    const store = new InMemoryKnowledgeStore(now);
    for (const sourceKey of ["alpha", "beta"]) {
      const source = await store.upsertSource({
        profileName: "helper",
        sourceKey,
        displayName: `${sourceKey} 手冊`,
        adapterType: "notion",
        externalRootId: `${sourceKey}-root`,
        rootUrl: `https://example.test/${sourceKey}`,
        enabled: true,
        topics: ["集合"]
      });
      await store.replaceDocument({
        sourceId: source.id,
        externalId: `${sourceKey}-doc`,
        title: `${sourceKey} 文件`,
        url: `https://example.test/${sourceKey}-doc`,
        nodes: [],
        chunks: [
          {
            headingPath: ["集合"],
            ordinal: 0,
            content: `${sourceKey} 集合資料`,
            contentHash: `${sourceKey}-hash`
          }
        ]
      });
    }
    const handler = createQueryKnowledgeHandler({ store });
    const context = {
      profile,
      event: {
        type: "message" as const,
        source: { type: "user" as const, userId: "u" },
        message: { type: "text" as const, text: "集合" }
      }
    };

    const ambiguous = await handler({ query: "集合" }, context);
    const notFound = await handler(
      { query: "完全不存在的詞" },
      {
        ...context,
        event: { ...context.event, message: { type: "text", text: "完全不存在的詞" } }
      }
    );
    const unavailable = await handler(
      { query: "再說一次" },
      {
        ...context,
        continuation: {
          functionName: "query_knowledge" as const,
          arguments: {},
          resultReferences: { sourceKey: "removed", documentId: "missing" },
          createdAt: "2026-07-13T00:00:00.000Z",
          expiresAt: "2026-07-13T00:01:00.000Z"
        },
        event: { ...context.event, message: { type: "text", text: "再說一次" } }
      }
    );
    const missingExplicitAnchor = await handler(
      { query: "再說一次", sourceKey: "alpha", documentId: "missing" },
      {
        ...context,
        event: { ...context.event, message: { type: "text", text: "再說一次" } }
      }
    );

    expect(ambiguous.agentResult).toMatchObject({
      status: "ambiguous",
      clarification: { choices: ["alpha 手冊", "beta 手冊"] }
    });
    expect(notFound.agentResult).toMatchObject({ status: "not_found" });
    expect(unavailable.agentResult).toMatchObject({ status: "unavailable" });
    expect(missingExplicitAnchor.agentResult).toMatchObject({ status: "unavailable" });
    for (const result of [ambiguous, notFound, unavailable, missingExplicitAnchor]) {
      expect(JSON.stringify(result.agentResult)).not.toMatch(/https?:|集合資料/iu);
    }
  });

  it("accepts an explicit safe section anchor and searches only that section", async () => {
    const store = new InMemoryKnowledgeStore();
    const source = await store.upsertSource({
      profileName: "helper",
      sourceKey: "retreat",
      displayName: "2026 青年出隊",
      adapterType: "notion",
      externalRootId: "root",
      rootUrl: "https://example.test/root",
      enabled: true
    });
    await store.replaceDocument({
      sourceId: source.id,
      externalId: "doc",
      title: "出隊行程",
      url: "https://example.test/doc",
      nodes: [],
      chunks: [
        { headingPath: ["第一天"], ordinal: 0, content: "集合時間是七點。", contentHash: "d1" },
        { headingPath: ["第二天"], ordinal: 1, content: "集合時間是八點。", contentHash: "d2" }
      ]
    });
    const handler = createQueryKnowledgeHandler({ store });

    const result = await handler(
      { query: "集合時間", sourceKey: "retreat", section: "第二天" },
      {
        profile,
        event: {
          type: "message",
          source: { type: "user", userId: "u" },
          message: { type: "text", text: "第二天集合時間" }
        }
      }
    );

    expect(result.replyText).toContain("八點");
    expect(result.replyText).not.toContain("七點");
  });
});
