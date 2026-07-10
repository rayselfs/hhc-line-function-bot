import { describe, expect, it, vi } from "vitest";

import { InMemoryAgentMemoryStore } from "../agent/memory-store.js";
import { createQueryScheduleHandler } from "../functions/query-schedule.js";
import { createSaveScheduleHandler } from "../functions/schedule-memory.js";
import type { BotProfileConfig, FunctionHandlerContext, NotionDatabaseClient } from "../types.js";

function context(text = "小哈查服事表"): FunctionHandlerContext {
  return {
    requestId: "req-1",
    profile: {
      name: "helper",
      webhookPath: "/api/line/webhook/helper",
      channelSecret: "secret",
      channelAccessToken: "token",
      allowDirectUser: true,
      allowRooms: false,
      allowedMessageTypes: ["text"],
      groupRequireWakeWord: true,
      wakeKeywords: ["小哈"],
      acceptMention: true,
      enabledFunctions: ["query_schedule", "save_schedule"]
    } satisfies BotProfileConfig,
    event: {
      type: "message",
      source: { type: "group", groupId: "C1", userId: "U1" },
      message: { type: "text", text }
    }
  };
}

describe("query_schedule", () => {
  it("uses one user-facing function for a saved schedule without exposing its storage", async () => {
    const store = new InMemoryAgentMemoryStore({
      now: () => new Date("2026-07-09T00:00:00.000Z")
    });
    const save = createSaveScheduleHandler({
      memoryStore: store,
      now: () => new Date("2026-07-09T00:00:00.000Z")
    });
    const query = createQueryScheduleHandler({ memoryStore: store });
    await save(
      { content: "7/19黃弘家族(音樂人)", scheduleType: "street_sign_service", confirm: true },
      context("小哈記住舉牌服事表")
    );

    const result = await query(
      { query: "7/19舉牌", scheduleType: "street_sign_service" },
      context("小哈查7/19舉牌服事")
    );

    expect(result.replyText).toContain("7月19日");
    expect(result.replyText).toContain("黃弘家族");
    expect(result.replyText).not.toMatch(/Notion|Postgres|記憶來源/u);
  });

  it("uses the configured schedule source when a saved schedule has no match", async () => {
    const notion: NotionDatabaseClient = {
      queryDatabase: vi.fn().mockResolvedValue([
        {
          id: "page-1",
          properties: {
            日期: { type: "date", date: { start: "2026-07-12" } },
            聚會: { type: "rich_text", rich_text: [{ plain_text: "主日" }] },
            角色: { type: "rich_text", rich_text: [{ plain_text: "投影" }] },
            同工: { type: "rich_text", rich_text: [{ plain_text: "知樂" }] }
          }
        }
      ])
    };
    const query = createQueryScheduleHandler({
      memoryStore: new InMemoryAgentMemoryStore(),
      notion,
      databaseId: "database-1",
      properties: { date: "日期", meeting: "聚會", role: "角色", person: "同工" },
      timeZone: "Asia/Taipei"
    });

    const result = await query({ query: "主日服事" }, context("小哈查主日服事"));

    expect(result.replyText).toContain("主日");
    expect(result.replyText).toContain("投影：知樂");
    expect(result.replyText).not.toMatch(/Notion|Postgres/u);
  });
});
