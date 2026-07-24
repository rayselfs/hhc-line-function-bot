import { randomUUID } from "node:crypto";

import type { AgentJobScope, AgentJobStore } from "../agent/jobs.js";
import type { FunctionExecutionResult } from "../types.js";

export type AttachmentScanWorkStatus = "confirmed" | "claimed" | "completed" | "failed";

export type AttachmentScanFailureCode =
  | "enqueue_failed"
  | "download_failed"
  | "validation_failed"
  | "scan_infected"
  | "scan_unavailable"
  | "signature_stale"
  | "publish_failed"
  | "worker_failed";

export interface AttachmentScanTarget {
  sourceKey: string;
  itemKind: string;
  domain: string;
  title: string;
}

export interface AttachmentScanWorkInput {
  jobId: string;
  lineMessageId: string;
  scope: AgentJobScope & { requesterUserId: string };
  target: AttachmentScanTarget;
  ttlMs: number;
}

export interface AttachmentScanWork {
  version: 1;
  id: string;
  jobId: string;
  lineMessageId: string;
  scope: AgentJobScope & { requesterUserId: string };
  target: AttachmentScanTarget;
  status: AttachmentScanWorkStatus;
  failureCode?: AttachmentScanFailureCode;
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
  expiresAt: string;
}

export interface AttachmentScanWorkStore {
  create(input: AttachmentScanWorkInput): Promise<AttachmentScanWork>;
  claim(id: string): Promise<AttachmentScanWork | undefined>;
  cancelConfirmed(id: string, code: AttachmentScanFailureCode): Promise<boolean>;
  complete(id: string, result: FunctionExecutionResult): Promise<void>;
  fail(id: string, code: AttachmentScanFailureCode): Promise<void>;
}

export interface RedisAttachmentScanWorkClient {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

const workSchemaValidationScript = `
local function isNonEmptyString(value)
  return type(value) == "string" and string.len(value) > 0
end

local function isCanonicalTimestamp(value)
  return
    type(value) == "string" and
    string.len(value) == 24 and
    string.match(value, "^%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%d%.%d%d%dZ$") ~= nil
end

local function hasOnlyKeys(value, allowed)
  for key, _ in pairs(value) do
    if not allowed[key] then
      return false
    end
  end
  return true
end

local valid =
  work.version == 1 and
  hasOnlyKeys(work, {
    version = true,
    id = true,
    jobId = true,
    lineMessageId = true,
    scope = true,
    target = true,
    status = true,
    createdAt = true,
    expiresAt = true
  }) and
  isNonEmptyString(work.id) and
  isNonEmptyString(work.jobId) and
  isNonEmptyString(work.lineMessageId) and
  type(work.scope) == "table" and
  hasOnlyKeys(work.scope, {
    profileName = true,
    sourceKey = true,
    requesterUserId = true
  }) and
  isNonEmptyString(work.scope.profileName) and
  isNonEmptyString(work.scope.sourceKey) and
  isNonEmptyString(work.scope.requesterUserId) and
  type(work.target) == "table" and
  hasOnlyKeys(work.target, {
    sourceKey = true,
    itemKind = true,
    domain = true,
    title = true
  }) and
  isNonEmptyString(work.target.sourceKey) and
  isNonEmptyString(work.target.itemKind) and
  isNonEmptyString(work.target.domain) and
  isNonEmptyString(work.target.title) and
  isCanonicalTimestamp(work.createdAt) and
  isCanonicalTimestamp(work.expiresAt)

if not valid then
  return nil
end
`;

const claimScript = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return nil
end
local work = cjson.decode(raw)
${workSchemaValidationScript}
if work.id ~= ARGV[1] or work.status ~= "confirmed" or work.expiresAt <= ARGV[2] then
  return nil
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl <= 0 then
  return nil
end
work.status = "claimed"
work.claimedAt = ARGV[3]
local claimed = cjson.encode(work)
redis.call("PSETEX", KEYS[1], ttl, claimed)
return claimed
`;

const cancelConfirmedScript = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return nil
end
local work = cjson.decode(raw)
${workSchemaValidationScript}
if work.id ~= ARGV[1] or work.status ~= "confirmed" or work.expiresAt <= ARGV[2] then
  return nil
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl <= 0 then
  return nil
end
work.status = "failed"
work.failureCode = ARGV[3]
work.completedAt = ARGV[2]
local failed = cjson.encode(work)
redis.call("PSETEX", KEYS[1], ttl, failed)
return failed
`;

interface ScanWorkStoreOptions {
  jobStore: AgentJobStore;
  now?: () => Date;
  idFactory?: () => string;
}

export class InMemoryAttachmentScanWorkStore implements AttachmentScanWorkStore {
  private readonly values = new Map<string, AttachmentScanWork>();
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly options: ScanWorkStoreOptions) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async create(input: AttachmentScanWorkInput): Promise<AttachmentScanWork> {
    const createdAt = this.now();
    const work: AttachmentScanWork = {
      version: 1,
      id: this.idFactory(),
      jobId: input.jobId,
      lineMessageId: input.lineMessageId,
      scope: { ...input.scope },
      target: { ...input.target },
      status: "confirmed",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + input.ttlMs).toISOString()
    };
    this.values.set(work.id, work);
    return cloneWork(work);
  }

  async claim(id: string): Promise<AttachmentScanWork | undefined> {
    const work = this.values.get(id);
    const claimedAt = this.now();
    if (
      !work ||
      work.id !== id ||
      work.status !== "confirmed" ||
      work.expiresAt <= claimedAt.toISOString()
    ) {
      return undefined;
    }
    const claimed: AttachmentScanWork = {
      ...work,
      status: "claimed",
      claimedAt: claimedAt.toISOString()
    };
    this.values.set(id, claimed);
    return cloneWork(claimed);
  }

  async cancelConfirmed(id: string, code: AttachmentScanFailureCode): Promise<boolean> {
    const work = this.live(id);
    if (!work || work.status !== "confirmed") return false;
    this.values.set(id, {
      ...work,
      status: "failed",
      failureCode: code,
      completedAt: this.now().toISOString()
    });
    return true;
  }

  async complete(id: string, result: FunctionExecutionResult): Promise<void> {
    const work = this.live(id);
    if (!work || work.status !== "claimed") return;
    await this.options.jobStore.complete(work.jobId, result);
    this.values.set(id, {
      ...work,
      status: "completed",
      completedAt: this.now().toISOString()
    });
  }

  async fail(id: string, code: AttachmentScanFailureCode): Promise<void> {
    const work = this.live(id);
    if (!work || work.status !== "claimed") return;
    await this.options.jobStore.fail(work.jobId, code);
    this.values.set(id, {
      ...work,
      status: "failed",
      failureCode: code,
      completedAt: this.now().toISOString()
    });
  }

  private live(id: string): AttachmentScanWork | undefined {
    const work = this.values.get(id);
    if (!work || work.expiresAt <= this.now().toISOString()) {
      this.values.delete(id);
      return undefined;
    }
    return work;
  }
}

export class RedisAttachmentScanWorkStore implements AttachmentScanWorkStore {
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(
    private readonly options: ScanWorkStoreOptions & {
      client: RedisAttachmentScanWorkClient;
      keyPrefix: string;
    }
  ) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async create(input: AttachmentScanWorkInput): Promise<AttachmentScanWork> {
    const createdAt = this.now();
    const work: AttachmentScanWork = {
      version: 1,
      id: this.idFactory(),
      jobId: input.jobId,
      lineMessageId: input.lineMessageId,
      scope: { ...input.scope },
      target: { ...input.target },
      status: "confirmed",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + input.ttlMs).toISOString()
    };
    await this.write(work);
    return cloneWork(work);
  }

  async claim(id: string): Promise<AttachmentScanWork | undefined> {
    const claimedAt = this.now().toISOString();
    const raw = await this.options.client.eval(claimScript, {
      keys: [this.key(id)],
      arguments: [id, claimedAt, claimedAt]
    });
    if (typeof raw !== "string") return undefined;
    return parseWork(raw, id);
  }

  async cancelConfirmed(id: string, code: AttachmentScanFailureCode): Promise<boolean> {
    const cancelledAt = this.now().toISOString();
    const raw = await this.options.client.eval(cancelConfirmedScript, {
      keys: [this.key(id)],
      arguments: [id, cancelledAt, code]
    });
    if (typeof raw !== "string") return false;
    const work = parseWork(raw, id);
    return work?.status === "failed" && work.failureCode === code;
  }

  async complete(id: string, result: FunctionExecutionResult): Promise<void> {
    const work = await this.read(id);
    if (!work || work.status !== "claimed") return;
    await this.options.jobStore.complete(work.jobId, result);
    await this.write({
      ...work,
      status: "completed",
      completedAt: this.now().toISOString()
    });
  }

  async fail(id: string, code: AttachmentScanFailureCode): Promise<void> {
    const work = await this.read(id);
    if (!work || work.status !== "claimed") return;
    await this.options.jobStore.fail(work.jobId, code);
    await this.write({
      ...work,
      status: "failed",
      failureCode: code,
      completedAt: this.now().toISOString()
    });
  }

  private async read(id: string): Promise<AttachmentScanWork | undefined> {
    const raw = await this.options.client.get(this.key(id));
    if (!raw) return undefined;
    const work = parseWork(raw, id);
    if (!work || work.expiresAt <= this.now().toISOString()) return undefined;
    return work;
  }

  private async write(work: AttachmentScanWork): Promise<void> {
    const ttlMs = new Date(work.expiresAt).getTime() - this.now().getTime();
    await this.options.client.setEx(
      this.key(work.id),
      Math.max(1, Math.ceil(ttlMs / 1000)),
      JSON.stringify(work)
    );
  }

  private key(id: string): string {
    return `${this.options.keyPrefix}:attachment-scan-work:${encodeURIComponent(id)}`;
  }
}

function parseWork(raw: string, expectedId: string): AttachmentScanWork | undefined {
  try {
    const work = JSON.parse(raw) as Partial<AttachmentScanWork>;
    if (
      work.version !== 1 ||
      work.id !== expectedId ||
      !isNonEmptyString(work.jobId) ||
      !isNonEmptyString(work.lineMessageId) ||
      !work.scope ||
      !isNonEmptyString(work.scope.profileName) ||
      !isNonEmptyString(work.scope.sourceKey) ||
      !isNonEmptyString(work.scope.requesterUserId) ||
      !work.target ||
      !isNonEmptyString(work.target.sourceKey) ||
      !isNonEmptyString(work.target.itemKind) ||
      !isNonEmptyString(work.target.domain) ||
      !isNonEmptyString(work.target.title) ||
      !isWorkStatus(work.status) ||
      !isTimestamp(work.createdAt) ||
      !isTimestamp(work.expiresAt) ||
      (work.failureCode !== undefined && !isFailureCode(work.failureCode)) ||
      (work.claimedAt !== undefined && !isTimestamp(work.claimedAt)) ||
      (work.completedAt !== undefined && !isTimestamp(work.completedAt))
    ) {
      return undefined;
    }
    return {
      version: 1,
      id: work.id,
      jobId: work.jobId,
      lineMessageId: work.lineMessageId,
      scope: {
        profileName: work.scope.profileName,
        sourceKey: work.scope.sourceKey,
        requesterUserId: work.scope.requesterUserId
      },
      target: {
        sourceKey: work.target.sourceKey,
        itemKind: work.target.itemKind,
        domain: work.target.domain,
        title: work.target.title
      },
      status: work.status,
      createdAt: work.createdAt,
      expiresAt: work.expiresAt,
      ...(work.failureCode ? { failureCode: work.failureCode } : {}),
      ...(work.claimedAt ? { claimedAt: work.claimedAt } : {}),
      ...(work.completedAt ? { completedAt: work.completedAt } : {})
    };
  } catch {
    return undefined;
  }
}

function isWorkStatus(value: unknown): value is AttachmentScanWorkStatus {
  return (
    value === "confirmed" || value === "claimed" || value === "completed" || value === "failed"
  );
}

function isFailureCode(value: unknown): value is AttachmentScanFailureCode {
  return (
    value === "enqueue_failed" ||
    value === "download_failed" ||
    value === "validation_failed" ||
    value === "scan_infected" ||
    value === "scan_unavailable" ||
    value === "signature_stale" ||
    value === "publish_failed" ||
    value === "worker_failed"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function cloneWork(work: AttachmentScanWork): AttachmentScanWork {
  return {
    ...work,
    scope: { ...work.scope },
    target: { ...work.target }
  };
}
