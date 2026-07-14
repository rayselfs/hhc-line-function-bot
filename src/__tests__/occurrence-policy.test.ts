import { describe, expect, it } from "vitest";

import { selectFirstUpcomingOccurrence } from "../schedules/occurrence-policy.js";

describe("schedule occurrence policy", () => {
  it("chooses the earliest future date before comparing meeting names or known windows", () => {
    const result = selectFirstUpcomingOccurrence({
      rows: [
        { serviceDate: "2026-07-16", meeting: "仙履奇緣", assignee: "later" },
        { serviceDate: "2026-07-15", meeting: "臨時聚會", assignee: "earlier" }
      ],
      now: new Date("2026-07-14T08:40:00.000Z"),
      timeZone: "Asia/Taipei"
    });

    expect(result).toEqual([
      { serviceDate: "2026-07-15", meeting: "臨時聚會", assignee: "earlier" }
    ]);
  });
});
