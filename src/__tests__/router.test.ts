import { describe, expect, it, vi } from "vitest";

import { createKeywordFallbackRouter } from "../keyword-router.js";
import { ProviderResponseError, createFunctionRouter } from "../router.js";
import type { ChatProvider } from "../types.js";

function provider(raw: string): ChatProvider {
  return {
    completeJson: vi.fn().mockResolvedValue(raw)
  };
}

describe("function router", () => {
  it("returns an executable action when Qwen returns valid JSON for an enabled function", async () => {
    const qwen = provider(
      JSON.stringify({
        action: "find_ppt_slides",
        confidence: 0.93,
        arguments: { query: "奇異恩典", includePdf: true }
      })
    );
    const router = createFunctionRouter({
      primary: qwen,
      keywordFallback: createKeywordFallbackRouter(),
      keywordFallbackEnabled: true
    });

    const result = await router.route({
      profileName: "main",
      text: "小哈 查投影片 奇異恩典",
      enabledFunctions: ["find_ppt_slides"],
      source: { type: "user", userId: "U1" }
    });

    expect(result).toMatchObject({
      type: "execute",
      action: "find_ppt_slides",
      provider: "ollama",
      arguments: { query: "奇異恩典", includePdf: true }
    });
  });

  it("denies disabled functions without calling keyword fallback", async () => {
    const qwen = provider(
      JSON.stringify({
        action: "query_service_schedule",
        confidence: 0.9,
        arguments: { query: "服事表" }
      })
    );
    const router = createFunctionRouter({
      primary: qwen,
      keywordFallback: createKeywordFallbackRouter(),
      keywordFallbackEnabled: true
    });

    const result = await router.route({
      profileName: "slides",
      text: "小哈 查服事表",
      enabledFunctions: ["find_ppt_slides"],
      source: { type: "group", groupId: "C1", userId: "U1" }
    });

    expect(result).toMatchObject({
      type: "deny",
      reason: "function_disabled",
      provider: "ollama"
    });
  });

  it("does not fallback when Qwen explicitly denies", async () => {
    const qwen = provider(JSON.stringify({ action: "deny", reason: "not_matched" }));
    const router = createFunctionRouter({
      primary: qwen,
      keywordFallback: createKeywordFallbackRouter(),
      keywordFallbackEnabled: true
    });

    const result = await router.route({
      profileName: "main",
      text: "小哈 查投影片",
      enabledFunctions: ["find_ppt_slides", "query_service_schedule"],
      source: { type: "user", userId: "U1" }
    });

    expect(result).toMatchObject({ type: "deny", reason: "not_matched", provider: "ollama" });
  });

  it("falls back to keyword routing when Qwen returns invalid JSON", async () => {
    const qwen = provider("not-json");
    const router = createFunctionRouter({
      primary: qwen,
      keywordFallback: createKeywordFallbackRouter(),
      keywordFallbackEnabled: true
    });

    const result = await router.route({
      profileName: "main",
      text: "小哈 查投影片 奇異恩典",
      enabledFunctions: ["find_ppt_slides"],
      source: { type: "user", userId: "U1" }
    });

    expect(result).toMatchObject({
      type: "execute",
      action: "find_ppt_slides",
      provider: "keyword",
      arguments: { query: "奇異恩典" }
    });
  });

  it("falls back to keyword routing when Qwen times out", async () => {
    const qwen: ChatProvider = {
      completeJson: vi.fn().mockRejectedValue(new ProviderResponseError("timeout"))
    };
    const router = createFunctionRouter({
      primary: qwen,
      keywordFallback: createKeywordFallbackRouter(),
      keywordFallbackEnabled: true
    });

    const result = await router.route({
      profileName: "main",
      text: "小哈 查服事表",
      enabledFunctions: ["query_service_schedule"],
      source: { type: "group", groupId: "C1", userId: "U1" }
    });

    expect(result).toMatchObject({
      type: "execute",
      action: "query_service_schedule",
      provider: "keyword",
      arguments: { query: "服事表" }
    });
  });

  it("does not treat poetry or pop-song keywords as PPT requests", async () => {
    const qwen = provider("not-json");
    const router = createFunctionRouter({
      primary: qwen,
      keywordFallback: createKeywordFallbackRouter(),
      keywordFallbackEnabled: true
    });

    const result = await router.route({
      profileName: "main",
      text: "小哈 查詩歌 奇異恩典",
      enabledFunctions: ["find_ppt_slides"],
      source: { type: "group", groupId: "C1", userId: "U1" }
    });

    expect(result).toMatchObject({
      type: "deny",
      reason: "keyword_no_match",
      provider: "keyword"
    });
  });

  it("denies ambiguous keyword fallback matches", async () => {
    const qwen = provider("not-json");
    const router = createFunctionRouter({
      primary: qwen,
      keywordFallback: createKeywordFallbackRouter(),
      keywordFallbackEnabled: true
    });

    const result = await router.route({
      profileName: "main",
      text: "小哈 查服事投影片",
      enabledFunctions: ["find_ppt_slides", "query_service_schedule"],
      source: { type: "group", groupId: "C1", userId: "U1" }
    });

    expect(result).toMatchObject({
      type: "deny",
      reason: "keyword_ambiguous",
      provider: "keyword"
    });
  });

  it("denies keyword fallback matches for disabled functions", async () => {
    const qwen = provider("not-json");
    const router = createFunctionRouter({
      primary: qwen,
      keywordFallback: createKeywordFallbackRouter(),
      keywordFallbackEnabled: true
    });

    const result = await router.route({
      profileName: "main",
      text: "小哈 查服事表",
      enabledFunctions: ["find_ppt_slides"],
      source: { type: "group", groupId: "C1", userId: "U1" }
    });

    expect(result).toMatchObject({
      type: "deny",
      reason: "function_disabled",
      provider: "keyword"
    });
  });
});
