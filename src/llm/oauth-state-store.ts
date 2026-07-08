import { createHash, randomBytes } from "node:crypto";

import type { LlmOAuthProviderName } from "./auth.js";

export interface LlmOAuthStateRecord {
  state: string;
  provider: LlmOAuthProviderName;
  profileName: string;
  actorUserId: string;
  authProfile: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateLlmOAuthStateInput {
  profileName: string;
  actorUserId: string;
  authProfile: string;
  ttlMinutes: number;
}

export interface LlmOAuthStateStore {
  create(input: CreateLlmOAuthStateInput): Promise<LlmOAuthStateRecord>;
  peek(state: string): Promise<LlmOAuthStateRecord | undefined>;
  consume(state: string): Promise<LlmOAuthStateRecord | undefined>;
}

export interface InMemoryLlmOAuthStateStoreOptions {
  stateFactory?: () => string;
  now?: () => Date;
}

export class InMemoryLlmOAuthStateStore implements LlmOAuthStateStore {
  private readonly records = new Map<string, LlmOAuthStateRecord>();

  constructor(private readonly options: InMemoryLlmOAuthStateStoreOptions = {}) {}

  async create(input: CreateLlmOAuthStateInput): Promise<LlmOAuthStateRecord> {
    const now = this.now();
    const record: LlmOAuthStateRecord = {
      state: this.options.stateFactory?.() ?? randomState(),
      provider: "openai_codex_oauth",
      profileName: input.profileName,
      actorUserId: input.actorUserId,
      authProfile: input.authProfile,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.ttlMinutes * 60_000).toISOString()
    };
    this.records.set(record.state, record);
    return { ...record };
  }

  async peek(state: string): Promise<LlmOAuthStateRecord | undefined> {
    const record = this.records.get(state);
    if (!record) {
      return undefined;
    }
    if (isExpired(record, this.now())) {
      this.records.delete(state);
      return undefined;
    }
    return { ...record };
  }

  async consume(state: string): Promise<LlmOAuthStateRecord | undefined> {
    const record = await this.peek(state);
    this.records.delete(state);
    return record;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

export interface RedisLlmOAuthStateClient {
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  getDel(key: string): Promise<string | null>;
}

export interface RedisLlmOAuthStateStoreOptions {
  client: RedisLlmOAuthStateClient;
  keyPrefix: string;
  stateFactory?: () => string;
  now?: () => Date;
}

export class RedisLlmOAuthStateStore implements LlmOAuthStateStore {
  constructor(private readonly options: RedisLlmOAuthStateStoreOptions) {}

  async create(input: CreateLlmOAuthStateInput): Promise<LlmOAuthStateRecord> {
    const now = this.now();
    const ttlSeconds = Math.max(60, Math.floor(input.ttlMinutes * 60));
    const record: LlmOAuthStateRecord = {
      state: this.options.stateFactory?.() ?? randomState(),
      provider: "openai_codex_oauth",
      profileName: input.profileName,
      actorUserId: input.actorUserId,
      authProfile: input.authProfile,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString()
    };
    await this.options.client.setEx(this.key(record.state), ttlSeconds, JSON.stringify(record));
    return { ...record };
  }

  async peek(state: string): Promise<LlmOAuthStateRecord | undefined> {
    return parseRecord(await this.options.client.get(this.key(state)), this.now());
  }

  async consume(state: string): Promise<LlmOAuthStateRecord | undefined> {
    return parseRecord(await this.options.client.getDel(this.key(state)), this.now());
  }

  private key(state: string): string {
    return `${this.options.keyPrefix}:llm-oauth-state:${hashState(state)}`;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function randomState(): string {
  return randomBytes(32).toString("base64url");
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("base64url");
}

function parseRecord(value: string | null, now: Date): LlmOAuthStateRecord | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const record = JSON.parse(value) as LlmOAuthStateRecord;
    if (!record.state || record.provider !== "openai_codex_oauth") {
      return undefined;
    }
    return isExpired(record, now) ? undefined : record;
  } catch {
    return undefined;
  }
}

function isExpired(record: LlmOAuthStateRecord, now: Date): boolean {
  return new Date(record.expiresAt).getTime() <= now.getTime();
}
