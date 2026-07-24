import { describe, expect, it } from "vitest";

import { InMemoryAgentJobStore } from "../agent/jobs.js";
import { RedisAttachmentScanWorkStore } from "../attachments/scan-work-store.js";

const now = new Date("2026-07-24T04:00:00.000Z");
const scope = {
  profileName: "helper",
  sourceKey: "group:C1",
  requesterUserId: "U1"
};

describe("attachment scan work store", () => {
  it("atomically yields one record to two parallel claim attempts", async () => {
    const client = new FakeRedisScanWorkClient();
    const jobStore = new InMemoryAgentJobStore({ now: () => now });
    const job = await jobStore.createPending({
      scope,
      label: "保存檔案",
      ttlMs: 600_000
    });
    const store = new RedisAttachmentScanWorkStore({
      client,
      keyPrefix: "test",
      jobStore,
      now: () => now,
      idFactory: () => "4c03465b-8a87-45a2-9d0d-54f904f4e6ab"
    });
    const work = await store.create({
      jobId: job.id,
      lineMessageId: "line-message-opaque-id",
      scope,
      target: {
        sourceKey: "ppt_slides",
        itemKind: "ppt_slide",
        domain: "presentation",
        title: "SundayDeck"
      },
      ttlMs: 600_000
    });

    const claimed = await Promise.all([store.claim(work.id), store.claim(work.id)]);

    expect(claimed.filter(Boolean)).toHaveLength(1);
    expect(claimed.find(Boolean)).toMatchObject({
      id: work.id,
      status: "claimed",
      lineMessageId: "line-message-opaque-id",
      scope,
      target: { title: "SundayDeck" }
    });
    expect(client.evalCalls).toHaveLength(2);
  });

  it("atomically cancels only work that has not already been claimed", async () => {
    const client = new FakeRedisScanWorkClient();
    const jobStore = new InMemoryAgentJobStore({ now: () => now });
    const store = new RedisAttachmentScanWorkStore({
      client,
      keyPrefix: "test",
      jobStore,
      now: () => now,
      idFactory: () => "4c03465b-8a87-45a2-9d0d-54f904f4e6ab"
    });
    const job = await jobStore.createPending({ scope, label: "保存檔案", ttlMs: 600_000 });
    const work = await store.create({
      jobId: job.id,
      lineMessageId: "line-message-opaque-id",
      scope,
      target: {
        sourceKey: "ppt_slides",
        itemKind: "ppt_slide",
        domain: "presentation",
        title: "SundayDeck"
      },
      ttlMs: 600_000
    });

    await expect(store.cancelConfirmed(work.id, "enqueue_failed")).resolves.toBe(true);
    await expect(store.claim(work.id)).resolves.toBeUndefined();
    await expect(store.cancelConfirmed(work.id, "enqueue_failed")).resolves.toBe(false);
  });

  it("refuses expired, completed, already-claimed, or foreign work", async () => {
    const client = new FakeRedisScanWorkClient();
    const jobStore = new InMemoryAgentJobStore({ now: () => now });
    const store = new RedisAttachmentScanWorkStore({
      client,
      keyPrefix: "test",
      jobStore,
      now: () => now,
      idFactory: () => "4c03465b-8a87-45a2-9d0d-54f904f4e6ab"
    });
    const job = await jobStore.createPending({ scope, label: "保存檔案", ttlMs: 600_000 });
    const work = await store.create({
      jobId: job.id,
      lineMessageId: "line-message-opaque-id",
      scope,
      target: {
        sourceKey: "ppt_slides",
        itemKind: "ppt_slide",
        domain: "presentation",
        title: "SundayDeck"
      },
      ttlMs: 600_000
    });

    await expect(store.claim(work.id)).resolves.toMatchObject({ status: "claimed" });
    await expect(store.claim(work.id)).resolves.toBeUndefined();

    const key = "test:attachment-scan-work:4c03465b-8a87-45a2-9d0d-54f904f4e6ab";
    client.values.set(key, JSON.stringify({ ...work, id: "foreign-id", status: "confirmed" }));
    await expect(store.claim(work.id)).resolves.toBeUndefined();

    client.values.set(
      key,
      JSON.stringify({
        ...work,
        status: "confirmed",
        expiresAt: "2026-07-24T03:59:59.000Z"
      })
    );
    await expect(store.claim(work.id)).resolves.toBeUndefined();

    client.values.set(key, JSON.stringify({ ...work, status: "completed" }));
    await expect(store.claim(work.id)).resolves.toBeUndefined();

    client.values.set(
      key,
      JSON.stringify({
        ...work,
        status: "confirmed",
        scope: { profileName: "helper", sourceKey: "group:C1" }
      })
    );
    await expect(store.claim(work.id)).resolves.toBeUndefined();
  });
});

class FakeRedisScanWorkClient {
  readonly values = new Map<string, string>();
  readonly evalCalls: Array<{
    script: string;
    options: { keys: string[]; arguments: string[] };
  }> = [];

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setEx(key: string, _seconds: number, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async eval(
    script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<string | null> {
    this.evalCalls.push({ script, options });
    const [key] = options.keys;
    const [expectedId, currentTime, transitionValue] = options.arguments;
    const raw = this.values.get(key);
    if (!raw) return null;
    const record = JSON.parse(raw) as {
      id: string;
      status: string;
      expiresAt: string;
      claimedAt?: string;
    };
    const isCancel = script.includes('work.status = "failed"');
    if (
      record.id !== expectedId ||
      record.status !== "confirmed" ||
      record.expiresAt <= currentTime ||
      !isValidWork(record)
    ) {
      return null;
    }
    const transitioned = isCancel
      ? {
          ...record,
          status: "failed",
          failureCode: transitionValue,
          completedAt: currentTime
        }
      : { ...record, status: "claimed", claimedAt: transitionValue };
    const serialized = JSON.stringify(transitioned);
    this.values.set(key, serialized);
    return serialized;
  }
}

function isValidWork(record: {
  version?: number;
  jobId?: string;
  lineMessageId?: string;
  scope?: { profileName?: string; sourceKey?: string; requesterUserId?: string };
  target?: { sourceKey?: string; itemKind?: string; domain?: string; title?: string };
}): boolean {
  return Boolean(
    record.version === 1 &&
    record.jobId &&
    record.lineMessageId &&
    record.scope?.profileName &&
    record.scope.sourceKey &&
    record.scope.requesterUserId &&
    record.target?.sourceKey &&
    record.target.itemKind &&
    record.target.domain &&
    record.target.title
  );
}
