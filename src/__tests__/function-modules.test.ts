import { describe, expect, it } from "vitest";

import { FUNCTION_NAMES } from "../types.js";
import { FUNCTION_MODULES, getRouterEvalCases } from "../functions/modules.js";

describe("function modules", () => {
  it("has one module for each supported function", () => {
    expect(FUNCTION_MODULES.map((module) => module.name).sort()).toEqual(
      [...FUNCTION_NAMES].sort()
    );
  });

  it("exposes router eval cases from modules", () => {
    const cases = getRouterEvalCases();

    expect(cases.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["find_ppt_slides", "query_service_schedule", "find_pop_sheet_music"])
    );
    expect(cases.every((entry) => entry.text.trim())).toBe(true);
  });
});
