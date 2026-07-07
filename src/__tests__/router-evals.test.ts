import { describe, expect, it, vi } from "vitest";

import { createKeywordFallbackRouter } from "../keyword-router.js";
import { createFunctionRouter } from "../router.js";
import type { ChatProvider } from "../types.js";
import {
  keywordDenyEvalCases,
  keywordRouteEvalCases,
  routerEvalEnabledFunctions
} from "./fixtures/router-eval-corpus.js";

function invalidProvider(): ChatProvider {
  return {
    completeJson: vi.fn().mockResolvedValue("not-json")
  };
}

describe("router eval corpus", () => {
  it.each(keywordRouteEvalCases)(
    "matches eval case '$text' with conservative keyword fallback",
    async (entry) => {
      const router = createFunctionRouter({
        primary: invalidProvider(),
        keywordFallback: createKeywordFallbackRouter(),
        keywordFallbackEnabled: true
      });

      const result = await router.route({
        profileName: "helper",
        text: entry.text,
        enabledFunctions: entry.enabledFunctions ?? routerEvalEnabledFunctions,
        source: { type: "group", groupId: "C1", userId: "U1" }
      });

      if (entry.expected.type === "execute") {
        expect(result).toMatchObject({
          type: "execute",
          action: entry.expected.action,
          provider: "keyword",
          arguments: entry.expected.arguments
        });
        return;
      }

      expect(result).toMatchObject({
        type: "deny",
        reason: entry.expected.reason,
        provider: "keyword"
      });
    }
  );

  it.each(keywordDenyEvalCases)(
    "denies unsupported keyword fallback phrase '$text'",
    async (entry) => {
      const router = createFunctionRouter({
        primary: invalidProvider(),
        keywordFallback: createKeywordFallbackRouter(),
        keywordFallbackEnabled: true
      });

      const result = await router.route({
        profileName: "helper",
        text: entry.text,
        enabledFunctions: entry.enabledFunctions ?? routerEvalEnabledFunctions,
        source: { type: "group", groupId: "C1", userId: "U1" }
      });

      expect(result).toMatchObject({
        type: "deny",
        reason: entry.expected.type === "deny" ? entry.expected.reason : "keyword_no_match",
        provider: "keyword"
      });
    }
  );
});
