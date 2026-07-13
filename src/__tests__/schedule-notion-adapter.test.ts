import { describe, expect, it } from "vitest";

import { normalizeNotionSchedulePage } from "../schedules/notion-adapter.js";

describe("Notion schedule adapter", () => {
  it("splits a multiline roster into canonical assignments", () => {
    expect(
      normalizeNotionSchedulePage({
        pageId: "page-1",
        serviceDate: "2026-07-14",
        meeting: "7月14日(二) 晨更",
        role: "",
        person: [
          "音控: 資恆",
          "導播: 莘凌",
          "投影電腦: 家怡",
          "前攝影: 姵穎,佳美",
          "手機拍照: 阿達,銹姐"
        ].join("\n")
      })
    ).toMatchObject({
      malformedLines: 0,
      meeting: {
        serviceDate: "2026-07-14",
        meeting: "7月14日(二) 晨更",
        assignments: [
          { role: "音控", assignees: ["資恆"], externalKey: "page-1:0:音控" },
          { role: "導播", assignees: ["莘凌"], externalKey: "page-1:1:導播" },
          { role: "投影電腦", assignees: ["家怡"], externalKey: "page-1:2:投影電腦" },
          { role: "前攝影", assignees: ["姵穎", "佳美"], externalKey: "page-1:3:前攝影" },
          { role: "手機拍照", assignees: ["阿達", "銹姐"], externalKey: "page-1:4:手機拍照" }
        ]
      }
    });
  });

  it("keeps a one-row role assignment canonical", () => {
    const result = normalizeNotionSchedulePage({
      pageId: "page-2",
      serviceDate: "2026-07-19",
      meeting: "主日",
      role: "音控",
      person: "Ray"
    });

    expect(result.meeting.assignments).toEqual([
      { role: "音控", assignees: ["Ray"], externalKey: "page-2:0:音控" }
    ]);
  });

  it("preserves malformed roster lines as generic service assignments", () => {
    const result = normalizeNotionSchedulePage({
      pageId: "page-3",
      serviceDate: "2026-07-21",
      meeting: "晨更",
      role: "",
      person: "音控: 資恆\n臨時支援"
    });

    expect(result.malformedLines).toBe(1);
    expect(result.meeting.assignments).toEqual([
      { role: "音控", assignees: ["資恆"], externalKey: "page-3:0:音控" },
      { role: "服事", assignees: ["臨時支援"], externalKey: "page-3:1:服事" }
    ]);
  });
});
