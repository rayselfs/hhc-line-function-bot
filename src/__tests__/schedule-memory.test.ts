import { describe, expect, it } from "vitest";

import { InMemoryAgentMemoryStore } from "../agent/memory-store.js";
import {
  createQueryScheduleMemoryHandler,
  createSaveScheduleMemoryHandler,
  parseScheduleMemoryContent
} from "../functions/schedule-memory.js";
import type { BotProfileConfig, FunctionHandlerContext } from "../types.js";

const morningPrayerText = `👉週二、週五〝全教會〞實體晨更，週三、週四各家族線上晨更，隔週四有仙履奇緣。

聚會服事如下👇
週二主題：回應主日
週五主題：當週週報

七/10五黃弘家族2

七/14二中平家族
七/16四仙履奇緣
七/17五世緯家園

七/21二黃弘家族1
七/24五新婦家族

七/28二湧泉家園
七/30四仙履奇緣
七/31五學青媽寶家族

🔆由各家族族長安排服事及帶領，早上6:30晨更。`;

const streetSignText = `👉週日下午為耶穌舉牌服事如下👇

✅7/12共生家園

7/19黃弘家族(音樂人)

7/26新婦家族

8/2學青媽寶家族`;

function profile(): BotProfileConfig {
  return {
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
    enabledFunctions: ["save_schedule_memory", "query_schedule_memory"]
  };
}

function context(text = "小哈記住這份晨更服事表"): FunctionHandlerContext {
  return {
    profile: profile(),
    requestId: "req-1",
    event: {
      type: "message",
      replyToken: "reply-token",
      source: { type: "group", groupId: "C1", userId: "U1" },
      message: { type: "text", text }
    }
  };
}

describe("schedule memory", () => {
  it("parses morning prayer family schedule entries", () => {
    const parsed = parseScheduleMemoryContent({
      content: morningPrayerText,
      now: new Date("2026-07-09T00:00:00.000Z")
    });

    expect(parsed.scheduleType).toBe("morning_prayer_family");
    expect(parsed.title).toBe("晨更家族服事表");
    expect(parsed.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceDate: "2026-07-10",
          weekday: "五",
          meetingName: "晨更",
          assignee: "黃弘家族2",
          familyName: "黃弘家族2"
        }),
        expect.objectContaining({
          serviceDate: "2026-07-16",
          weekday: "四",
          meetingName: "仙履奇緣",
          assignee: "仙履奇緣"
        })
      ])
    );
  });

  it("parses street sign service schedule entries", () => {
    const parsed = parseScheduleMemoryContent({
      content: streetSignText,
      now: new Date("2026-07-09T00:00:00.000Z")
    });

    expect(parsed.scheduleType).toBe("street_sign_service");
    expect(parsed.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceDate: "2026-07-12",
          meetingName: "為耶穌舉牌",
          assignee: "共生家園"
        }),
        expect.objectContaining({
          serviceDate: "2026-07-19",
          meetingName: "為耶穌舉牌",
          assignee: "黃弘家族",
          notes: "音樂人"
        })
      ])
    );
  });

  it("previews structured schedule memory before saving", async () => {
    const store = new InMemoryAgentMemoryStore({
      now: () => new Date("2026-07-09T00:00:00.000Z")
    });
    const handler = createSaveScheduleMemoryHandler({
      memoryStore: store,
      now: () => new Date("2026-07-09T00:00:00.000Z")
    });

    const result = await handler({ content: morningPrayerText }, context());

    expect(result.replyText).toContain("我整理到 9 筆晨更家族服事");
    expect(result.replyText).toContain("要保存嗎");
    expect(result.quickReplies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "保存" }),
        expect.objectContaining({ label: "取消" })
      ])
    );
    await expect(
      store.searchScheduleEntries({ profileName: "helper", source: context().event.source })
    ).resolves.toEqual([]);
  });

  it("saves and queries schedule entries by type without mixing service schedules", async () => {
    const store = new InMemoryAgentMemoryStore({
      now: () => new Date("2026-07-09T00:00:00.000Z")
    });
    const save = createSaveScheduleMemoryHandler({
      memoryStore: store,
      now: () => new Date("2026-07-09T00:00:00.000Z")
    });
    const query = createQueryScheduleMemoryHandler({ memoryStore: store });

    await save(
      { content: morningPrayerText, scheduleType: "morning_prayer_family", confirm: true },
      context()
    );
    await save(
      { content: streetSignText, scheduleType: "street_sign_service", confirm: true },
      context("小哈記住這份舉牌服事表")
    );

    const streetSign = await query(
      { query: "7/19舉牌", scheduleType: "street_sign_service" },
      context("小哈 7/19舉牌誰服事")
    );
    const morningPrayer = await query(
      { query: "7/17晨更", scheduleType: "morning_prayer_family" },
      context("小哈 7/17晨更誰服事")
    );

    expect(streetSign.replyText).toContain("7月19日");
    expect(streetSign.replyText).toContain("黃弘家族");
    expect(streetSign.replyText).not.toContain("世緯家園");
    expect(morningPrayer.replyText).toContain("7月17日");
    expect(morningPrayer.replyText).toContain("世緯家園");
    expect(morningPrayer.replyText).not.toContain("黃弘家族");
  });
});
