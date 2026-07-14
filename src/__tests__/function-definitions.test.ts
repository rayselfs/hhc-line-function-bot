import { describe, expect, it } from "vitest";

import {
  FUNCTION_DEFINITIONS,
  getFunctionDefinition,
  isFunctionGrantableForPrincipal
} from "../functions/definitions.js";
import { FUNCTION_NAMES } from "../types.js";

describe("function definitions", () => {
  it("defines every function name in one catalog", () => {
    expect(FUNCTION_DEFINITIONS.map((definition) => definition.name).sort()).toEqual(
      [...FUNCTION_NAMES].sort()
    );
  });

  it("exposes Wikipedia lookup as a first-class read capability", () => {
    expect(FUNCTION_NAMES).toContain("query_wikipedia");
  });

  it("uses find_sheet_music as the canonical sheet music function", () => {
    expect(FUNCTION_NAMES).toContain("find_sheet_music");
    expect(getFunctionDefinition("find_sheet_music")).toMatchObject({
      name: "find_sheet_music",
      sideEffectLevel: "read",
      resourcePolicy: {
        kind: "graph_file",
        resourceTypes: ["sheet_music"]
      }
    });
  });

  it("uses one declarative generic-slot contract for user-facing lookups", () => {
    const lookupNames = [
      "find_ppt_slides",
      "query_schedule",
      "find_sheet_music",
      "query_wikipedia",
      "retrieve_memory"
    ] as const;

    for (const name of lookupNames) {
      const slot = getFunctionDefinition(name)?.requiredSlots[0];
      expect(slot?.missingWhen).toBe("blank");
      expect(slot?.genericRequest?.phrases.length).toBeGreaterThan(0);
    }
  });

  it("carries agent capability and quick reply metadata for sheet music", () => {
    const definition = getFunctionDefinition("find_sheet_music");

    expect(definition).toMatchObject({
      name: "find_sheet_music",
      quickReply: {
        label: "查歌譜",
        command: "小哈 查歌譜"
      }
    });
    expect(definition?.shortDescription).toContain("歌譜");
    expect(definition?.agentCapability?.candidateHints).toContain("樂譜");
  });

  it("keeps shared write functions user-grant-only", () => {
    for (const name of ["save_schedule", "save_memory"] as const) {
      expect(isFunctionGrantableForPrincipal(name, "user")).toBe(true);
      expect(isFunctionGrantableForPrincipal(name, "group")).toBe(false);
    }
    expect(isFunctionGrantableForPrincipal("find_ppt_slides", "group")).toBe(true);
  });
});
