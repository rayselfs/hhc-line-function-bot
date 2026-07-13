import { describe, expect, it } from "vitest";

import { activeTaskFromResult, type ActiveTaskContext } from "../agent/active-task.js";
import {
  InMemoryConversationWindowStore,
  RedisConversationWindowStore
} from "../agent/context-manager.js";

const scope = { profileName: "helper", sourceKey: "group:G1", requesterUserId: "U1" };

const previousTask: ActiveTaskContext = {
  version: 1,
  capability: "query_schedule",
  anchors: { date: "2026-07-14", meeting: "晨更" },
  entities: [
    {
      type: "role",
      key: "front-camera",
      label: "前攝影",
      aliases: ["攝影"]
    }
  ],
  supportedOperations: ["continue", "refine", "advance"],
  createdAt: "2026-07-13T00:00:00.000Z",
  expiresAt: "2026-07-13T00:01:00.000Z"
};

describe("structured result active tasks", () => {
  it("derives an active task only from a successful structured result", () => {
    const task = activeTaskFromResult(
      "query_schedule",
      {
        ok: true,
        replyText: "前攝影：姵穎、佳美",
        agentResult: {
          status: "success",
          replyText: "前攝影：姵穎、佳美",
          anchors: { date: "2026-07-14", meeting: "晨更" },
          entities: [
            {
              type: "role",
              key: "front-camera",
              label: "前攝影",
              aliases: ["攝影"]
            }
          ],
          supportedOperations: ["continue", "refine", "advance"]
        }
      },
      new Date("2026-07-13T00:00:00.000Z"),
      60_000
    );

    expect(task).toEqual(previousTask);
  });

  it.each(["not_found", "ambiguous", "unavailable"] as const)(
    "does not derive an active task for a %s structured result",
    (status) => {
      expect(
        activeTaskFromResult(
          "query_schedule",
          {
            ok: true,
            replyText: "沒有結果",
            agentResult: { status, replyText: "沒有結果" }
          },
          new Date("2026-07-13T00:00:00.000Z"),
          60_000
        )
      ).toBeUndefined();
    }
  );

  it("does not derive an active task from a failed execution", () => {
    expect(
      activeTaskFromResult(
        "query_schedule",
        {
          ok: false,
          replyText: "失敗",
          agentResult: { status: "success", replyText: "不應儲存" }
        },
        new Date("2026-07-13T00:00:00.000Z"),
        60_000
      )
    ).toBeUndefined();
  });

  it("preserves the previous active task after a not-found refinement", async () => {
    const store = new InMemoryConversationWindowStore({
      now: () => new Date("2026-07-13T00:00:00.000Z")
    });
    await store.recordActiveTask({ scope, task: previousTask, ttlMs: 60_000 });

    const replacement = activeTaskFromResult(
      "query_schedule",
      {
        ok: true,
        replyText: "找不到下一筆",
        agentResult: { status: "not_found", replyText: "找不到下一筆" }
      },
      new Date("2026-07-13T00:00:10.000Z"),
      60_000
    );
    if (replacement) {
      await store.recordActiveTask({ scope, task: replacement, ttlMs: 60_000 });
    }

    await expect(store.activeTask(scope)).resolves.toEqual(previousTask);
  });

  it("isolates active tasks by requester and expires them absolutely", async () => {
    let current = new Date("2026-07-13T00:00:00.000Z");
    const store = new InMemoryConversationWindowStore({ now: () => current });
    await store.recordActiveTask({ scope, task: previousTask, ttlMs: 60_000 });

    await expect(store.activeTask({ ...scope, requesterUserId: "U2" })).resolves.toBeUndefined();

    current = new Date("2026-07-13T00:00:50.000Z");
    await store.recordTurn({ scope, role: "user", text: "最近還好嗎", ttlMs: 60_000 });
    current = new Date("2026-07-13T00:01:01.000Z");

    await expect(store.activeTask(scope)).resolves.toBeUndefined();
    await expect(store.isActive(scope)).resolves.toBe(true);
  });

  it("does not create shared active state when the requester id is missing", async () => {
    const store = new InMemoryConversationWindowStore({
      now: () => new Date("2026-07-13T00:00:00.000Z")
    });
    const unknownRequesterScope = {
      profileName: "helper",
      sourceKey: "group:G1"
    };

    await store.recordActiveTask({
      scope: unknownRequesterScope,
      task: previousTask,
      ttlMs: 60_000
    });

    await expect(store.activeTask(unknownRequesterScope)).resolves.toBeUndefined();
  });

  it("bounds and sanitizes persisted task context", async () => {
    const store = new InMemoryConversationWindowStore({
      now: () => new Date("2026-07-13T00:00:00.000Z")
    });
    await store.recordActiveTask({
      scope,
      ttlMs: 60_000,
      task: {
        ...previousTask,
        anchors: {
          long: "a".repeat(600),
          nested: { secret: "drop" },
          choices: Array.from({ length: 12 }, (_, index) => `choice-${index}-${"b".repeat(210)}`)
        },
        entities: Array.from({ length: 22 }, (_, index) => ({
          type: `type-${index}-${"t".repeat(210)}`,
          key: `key-${index}-${"k".repeat(210)}`,
          label: `label-${index}-${"l".repeat(510)}`,
          aliases: Array.from(
            { length: 12 },
            (_, aliasIndex) => `alias-${aliasIndex}-${"x".repeat(210)}`
          )
        })),
        references: { id: "r".repeat(600), nested: { raw: "drop" } },
        supportedOperations: Array.from(
          { length: 10 },
          (_, index) => `operation-${index}-${"o".repeat(210)}`
        )
      }
    });

    const task = await store.activeTask(scope);
    expect(task?.anchors.long).toHaveLength(500);
    expect(task?.anchors.nested).toBeUndefined();
    expect(task?.anchors.choices).toHaveLength(10);
    expect((task?.anchors.choices as string[])[0]).toHaveLength(200);
    expect(task?.entities).toHaveLength(20);
    expect(task?.entities[0]?.type).toHaveLength(200);
    expect(task?.entities[0]?.key).toHaveLength(200);
    expect(task?.entities[0]?.label).toHaveLength(500);
    expect(task?.entities[0]?.aliases).toHaveLength(10);
    expect(task?.entities[0]?.aliases?.[0]).toHaveLength(200);
    expect(task?.references?.id).toHaveLength(500);
    expect(task?.references?.nested).toBeUndefined();
    expect(task?.supportedOperations).toHaveLength(8);
    expect(task?.supportedOperations[0]).toHaveLength(200);
  });

  it("stores Redis active tasks under an independent versioned key and clears them", async () => {
    const records = new Map<string, string>();
    const store = new RedisConversationWindowStore({
      client: {
        get: async (key) => records.get(key) ?? null,
        setEx: async (key, _seconds, value) => records.set(key, value),
        del: async (key) => records.delete(key)
      },
      keyPrefix: "test",
      now: () => new Date("2026-07-13T00:00:00.000Z")
    });

    await store.recordActiveTask({ scope, task: previousTask, ttlMs: 60_000 });
    await store.recordFunctionContext({
      scope,
      functionName: "query_schedule",
      arguments: { date: "2026-07-14" },
      ttlMs: 60_000
    });

    expect(Array.from(records.keys())).toEqual(
      expect.arrayContaining([
        expect.stringContaining(":active-task-v1:"),
        expect.stringContaining(":function-continuation:")
      ])
    );
    await expect(store.activeTask(scope)).resolves.toEqual(previousTask);

    await store.clearActiveTask(scope);
    await expect(store.activeTask(scope)).resolves.toBeUndefined();
    await expect(store.functionContext(scope)).resolves.toBeDefined();
  });
});
