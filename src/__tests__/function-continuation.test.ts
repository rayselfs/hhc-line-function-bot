import { describe, expect, it } from "vitest";

import { InMemoryConversationWindowStore } from "../agent/context-manager.js";

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
});
