import { describe, expect, it } from "vitest";

import { InMemoryAgentJobStore, RedisAgentJobStore } from "../agent/jobs.js";

const scope = {
  profileName: "helper",
  sourceKey: "group:g1",
  requesterUserId: "u1"
};

describe("agent long-running jobs", () => {
  it("keeps job results scoped to the requester and source", async () => {
    const store = new InMemoryAgentJobStore({
      now: () => new Date("2026-07-08T10:00:00.000Z")
    });

    const job = await store.createPending({
      scope,
      label: "查投影片",
      ttlMs: 600_000
    });
    await store.complete(job.id, { ok: true, replyText: "下載連結" });

    await expect(store.get(job.id, scope)).resolves.toMatchObject({
      status: "completed",
      result: { replyText: "下載連結" }
    });
    await expect(store.get(job.id, { ...scope, requesterUserId: "u2" })).resolves.toBeUndefined();
  });

  it("stores Redis job results with the same requester/source guard", async () => {
    const client = new FakeRedisJobClient();
    const store = new RedisAgentJobStore({
      client,
      keyPrefix: "test",
      idFactory: () => "job-1",
      now: () => new Date("2026-07-08T10:00:00.000Z")
    });

    const job = await store.createPending({
      scope,
      label: "lookup",
      ttlMs: 600_000
    });
    await store.complete(job.id, { ok: true, replyText: "result ready" });

    await expect(store.get("job-1", scope)).resolves.toMatchObject({
      status: "completed",
      result: { replyText: "result ready" }
    });
    await expect(store.get("job-1", { ...scope, requesterUserId: "u2" })).resolves.toBeUndefined();
  });
});

class FakeRedisJobClient {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setEx(key: string, _seconds: number, value: string): Promise<void> {
    this.values.set(key, value);
  }
}
