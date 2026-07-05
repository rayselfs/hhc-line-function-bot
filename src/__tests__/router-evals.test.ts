import { describe, expect, it, vi } from "vitest";

import { createKeywordFallbackRouter } from "../keyword-router.js";
import { createFunctionRouter } from "../router.js";
import type { ChatProvider } from "../types.js";
import {
  keywordDenyEvalTexts,
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
    "routes '$text' with conservative keyword fallback",
    async (entry) => {
      const router = createFunctionRouter({
        primary: invalidProvider(),
        keywordFallback: createKeywordFallbackRouter(),
        keywordFallbackEnabled: true
      });

      const result = await router.route({
        profileName: "helper",
        text: entry.text,
        enabledFunctions: routerEvalEnabledFunctions,
        source: { type: "group", groupId: "C1", userId: "U1" }
      });

      expect(result).toMatchObject({
        type: "execute",
        action: entry.action,
        provider: "keyword",
        arguments: entry.arguments
      });
    }
  );

  it.each(keywordDenyEvalTexts)("denies unsupported keyword fallback phrase '%s'", async (text) => {
    const router = createFunctionRouter({
      primary: invalidProvider(),
      keywordFallback: createKeywordFallbackRouter(),
      keywordFallbackEnabled: true
    });

    const result = await router.route({
      profileName: "helper",
      text,
      enabledFunctions: routerEvalEnabledFunctions,
      source: { type: "group", groupId: "C1", userId: "U1" }
    });

    expect(result).toMatchObject({
      type: "deny",
      reason: "keyword_no_match",
      provider: "keyword"
    });
  });
});
