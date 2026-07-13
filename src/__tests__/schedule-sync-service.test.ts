import { describe, expect, it, vi } from "vitest";

import { syncCatalogSources } from "../catalog/sync-service.js";
import { InMemoryCatalogStore, type CatalogSourceInput } from "../catalog/store.js";
import { InMemoryScheduleStore } from "../schedules/store.js";
import type { NotionDatabaseClient } from "../types.js";

const notionScheduleSource: CatalogSourceInput = {
  profileName: "helper",
  sourceKey: "media_team_service_schedule",
  adapterType: "notion",
  domain: "schedule",
  defaultItemKind: "media_service_schedule",
  rootLocation: { databaseId: "database-1" },
  enabled: true,
  syncPolicy: { mode: "scheduled", intervalMinutes: 15 },
  capabilities: { read: ["query_schedule"], write: [] }
};

describe("schedule sync service", () => {
  it("syncs enabled Notion schedule sources into the schedule read model", async () => {
    const catalog = new InMemoryCatalogStore();
    const schedules = new InMemoryScheduleStore();
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

    await catalog.upsertSource(notionScheduleSource);

    const result = await syncCatalogSources({
      catalog,
      schedules,
      notion,
      notionProperties: { date: "日期", meeting: "聚會", role: "角色", person: "同工" }
    });

    expect(result.scheduleUpserted).toBe(1);
    expect(result.scheduleTombstoned).toBe(0);
    await expect(
      schedules.searchItems({ profileName: "helper", query: "主日投影", limit: 10 })
    ).resolves.toMatchObject([
      {
        profileName: "helper",
        sourceKey: "media_team_service_schedule",
        origin: "notion",
        externalId: "page-1",
        serviceDate: "2026-07-12",
        meeting: "主日",
        role: "投影",
        assignee: "知樂"
      }
    ]);
  });

  it("tombstones Notion-origin schedule rows missing from a later sync", async () => {
    const catalog = new InMemoryCatalogStore();
    const schedules = new InMemoryScheduleStore();
    const notion: NotionDatabaseClient = {
      queryDatabase: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: "page-1",
            properties: {
              日期: { type: "date", date: { start: "2026-07-12" } },
              聚會: { type: "rich_text", rich_text: [{ plain_text: "主日" }] },
              角色: { type: "rich_text", rich_text: [{ plain_text: "投影" }] },
              同工: { type: "rich_text", rich_text: [{ plain_text: "知樂" }] }
            }
          },
          {
            id: "page-2",
            properties: {
              日期: { type: "date", date: { start: "2026-07-19" } },
              聚會: { type: "rich_text", rich_text: [{ plain_text: "主日" }] },
              角色: { type: "rich_text", rich_text: [{ plain_text: "音控" }] },
              同工: { type: "rich_text", rich_text: [{ plain_text: "Ray" }] }
            }
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "page-2",
            properties: {
              日期: { type: "date", date: { start: "2026-07-19" } },
              聚會: { type: "rich_text", rich_text: [{ plain_text: "主日" }] },
              角色: { type: "rich_text", rich_text: [{ plain_text: "音控" }] },
              同工: { type: "rich_text", rich_text: [{ plain_text: "Ray" }] }
            }
          }
        ])
    };

    await catalog.upsertSource(notionScheduleSource);

    await syncCatalogSources({
      catalog,
      schedules,
      notion,
      notionProperties: { date: "日期", meeting: "聚會", role: "角色", person: "同工" }
    });
    const result = await syncCatalogSources({
      catalog,
      schedules,
      notion,
      notionProperties: { date: "日期", meeting: "聚會", role: "角色", person: "同工" },
      now: () => new Date("2026-07-11T00:00:00.000Z")
    });

    expect(result.scheduleTombstoned).toBe(1);
    await expect(
      schedules.searchItems({ profileName: "helper", query: "投影", limit: 10 })
    ).resolves.toHaveLength(0);
    await expect(
      schedules.searchItems({ profileName: "helper", query: "音控", limit: 10 })
    ).resolves.toHaveLength(1);
  });

  it("syncs production-shaped rosters as derived rows and tombstones a removed assignment", async () => {
    const catalog = new InMemoryCatalogStore();
    const schedules = new InMemoryScheduleStore();
    const page = (person: string) => ({
      id: "page-production",
      properties: {
        日期: { type: "date", date: { start: "2026-07-14" } },
        聚會: { type: "rich_text", rich_text: [{ plain_text: "7月14日(二) 晨更" }] },
        角色: { type: "rich_text", rich_text: [] },
        同工: { type: "rich_text", rich_text: [{ plain_text: person }] }
      }
    });
    const fullRoster = [
      "音控: 資恆",
      "導播: 莘凌",
      "投影電腦: 家怡",
      "前攝影: 姵穎,佳美",
      "手機拍照: 阿達,銹姐"
    ].join("\n");
    const updatedRoster = ["音控: Ray", "導播: 莘凌", "投影電腦: 家怡", "前攝影: 姵穎,佳美"].join(
      "\n"
    );
    const notion: NotionDatabaseClient = {
      queryDatabase: vi
        .fn()
        .mockResolvedValueOnce([page(fullRoster)])
        .mockResolvedValueOnce([page(fullRoster)])
        .mockResolvedValueOnce([page(updatedRoster)])
    };

    await catalog.upsertSource(notionScheduleSource);

    const first = await syncCatalogSources({
      catalog,
      schedules,
      notion,
      notionProperties: { date: "日期", meeting: "聚會", role: "角色", person: "同工" }
    });
    const idempotent = await syncCatalogSources({
      catalog,
      schedules,
      notion,
      notionProperties: { date: "日期", meeting: "聚會", role: "角色", person: "同工" }
    });
    const replacement = await syncCatalogSources({
      catalog,
      schedules,
      notion,
      notionProperties: { date: "日期", meeting: "聚會", role: "角色", person: "同工" },
      now: () => new Date("2026-07-13T00:00:00.000Z")
    });

    expect(first.scheduleUpserted).toBe(5);
    expect(idempotent.scheduleUpserted).toBe(5);
    expect(idempotent.scheduleTombstoned).toBe(0);
    expect(replacement.scheduleUpserted).toBe(4);
    expect(replacement.scheduleTombstoned).toBe(1);
    const active = await schedules.searchItems({
      profileName: "helper",
      query: "晨更",
      limit: 10
    });
    expect(active).toHaveLength(4);
    expect(active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalKey: "page-production:1:導播",
          role: "導播",
          assignee: "莘凌"
        }),
        expect.objectContaining({
          externalKey: "page-production:3:前攝影",
          role: "前攝影",
          assignee: "姵穎,佳美"
        }),
        expect.objectContaining({
          externalKey: "page-production:0:音控",
          role: "音控",
          assignee: "Ray"
        }),
        expect.objectContaining({
          externalKey: "page-production:2:投影電腦",
          role: "投影電腦",
          assignee: "家怡"
        })
      ])
    );
    await expect(
      schedules.searchItems({ profileName: "helper", query: "手機拍照", limit: 10 })
    ).resolves.toHaveLength(0);
  });
});
