import { describe, expect, it } from "vitest";

import {
  InMemoryConversationWindowStore,
  RedisConversationWindowStore
} from "../agent/context-manager.js";
import { mergeFunctionContinuationArguments } from "../agent/function-continuation.js";

describe("function continuation context", () => {
  it("stores structured function state inside requester-scoped windows", async () => {
    const store = new InMemoryConversationWindowStore({
      now: () => new Date("2026-07-12T00:00:00Z")
    });
    const scope = { profileName: "helper", sourceKey: "group:G1", requesterUserId: "U1" };

    await store.recordFunctionContext({
      scope,
      functionName: "query_schedule",
      arguments: { query: "下一場服事表", dateIntent: "next_meeting", role: "音控" },
      ttlMs: 60_000
    });

    await expect(store.functionContext(scope)).resolves.toEqual(
      expect.objectContaining({
        functionName: "query_schedule",
        arguments: expect.objectContaining({ dateIntent: "next_meeting", role: "音控" })
      })
    );
    await expect(
      store.functionContext({ ...scope, requesterUserId: "U2" })
    ).resolves.toBeUndefined();
  });

  it("preserves structured function state while recording user and assistant turns", async () => {
    const store = new InMemoryConversationWindowStore({
      now: () => new Date("2026-07-12T00:00:00Z")
    });
    const scope = { profileName: "helper", sourceKey: "user:U1", requesterUserId: "U1" };
    await store.recordFunctionContext({
      scope,
      functionName: "query_schedule",
      arguments: { query: "下一場影視團隊服事表", dateIntent: "next_meeting" },
      ttlMs: 60_000
    });

    await store.recordTurn({ scope, role: "user", text: "下一場影視團隊服事表", ttlMs: 60_000 });
    await store.recordTurn({ scope, role: "assistant", text: "7月14日服事表", ttlMs: 60_000 });

    await expect(store.functionContext(scope)).resolves.toEqual(
      expect.objectContaining({
        functionName: "query_schedule",
        arguments: expect.objectContaining({ dateIntent: "next_meeting" })
      })
    );
  });

  it("preserves structured function state in Redis-backed windows", async () => {
    const records = new Map<string, string>();
    const store = new RedisConversationWindowStore({
      client: {
        get: async (key) => records.get(key) ?? null,
        setEx: async (key, _seconds, value) => {
          records.set(key, value);
        }
      },
      keyPrefix: "test",
      now: () => new Date("2026-07-12T00:00:00Z")
    });
    const scope = { profileName: "helper", sourceKey: "user:U1", requesterUserId: "U1" };
    await store.recordFunctionContext({
      scope,
      functionName: "query_schedule",
      arguments: { dateIntent: "next_meeting" },
      ttlMs: 60_000
    });

    await store.recordTurn({ scope, role: "assistant", text: "7月14日服事表", ttlMs: 60_000 });

    await expect(store.functionContext(scope)).resolves.toEqual(
      expect.objectContaining({
        functionName: "query_schedule",
        arguments: { dateIntent: "next_meeting" }
      })
    );
  });

  it("deterministically carries declared arguments for the same function", () => {
    expect(
      mergeFunctionContinuationArguments({
        action: "query_schedule",
        currentArguments: { query: "音控是誰？", role: "音控" },
        continuation: {
          functionName: "query_schedule",
          arguments: {
            query: "下一場影視團隊服事表",
            dateIntent: "next_meeting",
            meeting: "晨更"
          },
          createdAt: "2026-07-12T00:00:00Z"
        }
      })
    ).toEqual({ query: "音控是誰？", dateIntent: "next_meeting", meeting: "晨更", role: "音控" });
  });

  it("clears stale date fields when the follow-up explicitly changes date", () => {
    expect(
      mergeFunctionContinuationArguments({
        action: "query_schedule",
        currentArguments: { query: "明天的呢", dateIntent: "tomorrow" },
        continuation: {
          functionName: "query_schedule",
          arguments: { dateIntent: "specific_date", specificDate: "2026-07-14", role: "音控" },
          createdAt: "2026-07-12T00:00:00Z"
        }
      })
    ).toEqual({ query: "明天的呢", dateIntent: "tomorrow", role: "音控" });
  });

  it("never carries arguments across different functions", () => {
    expect(
      mergeFunctionContinuationArguments({
        action: "query_knowledge",
        currentArguments: { query: "第二個呢", ordinal: 1 },
        continuation: {
          functionName: "query_schedule",
          arguments: { dateIntent: "next_meeting" },
          createdAt: "2026-07-12T00:00:00Z"
        }
      })
    ).toEqual({ query: "第二個呢", ordinal: 1 });
  });
});
