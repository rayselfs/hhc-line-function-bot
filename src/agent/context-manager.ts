import type { FunctionName } from "../types.js";

export interface ConversationWindowScope {
  profileName: string;
  sourceKey: string;
  requesterUserId?: string;
}

export type ConversationTurnRole = "user" | "assistant";

export interface ConversationWindowTurn {
  role: ConversationTurnRole;
  text: string;
  createdAt: string;
}

export interface ConversationWindowStore {
  isActive(scope: ConversationWindowScope): Promise<boolean>;
  recordTurn(input: {
    scope: ConversationWindowScope;
    role: ConversationTurnRole;
    text: string;
    ttlMs: number;
  }): Promise<void>;
  recentTurns(scope: ConversationWindowScope, limit: number): Promise<string[]>;
}

interface ConversationWindowRecord {
  expiresAt: string;
  turns: ConversationWindowTurn[];
}

export interface RedisConversationWindowClient {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
}

export class InMemoryConversationWindowStore implements ConversationWindowStore {
  private readonly records = new Map<string, ConversationWindowRecord>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async isActive(scope: ConversationWindowScope): Promise<boolean> {
    const record = this.liveRecord(scope);
    return Boolean(record);
  }

  async recordTurn(input: {
    scope: ConversationWindowScope;
    role: ConversationTurnRole;
    text: string;
    ttlMs: number;
  }): Promise<void> {
    const existing = this.liveRecord(input.scope);
    const now = this.now();
    const turns = [
      ...(existing?.turns ?? []),
      {
        role: input.role,
        text: compactText(input.text),
        createdAt: now.toISOString()
      }
    ].slice(-8);
    this.records.set(conversationScopeKey(input.scope), {
      expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
      turns
    });
  }

  async recentTurns(scope: ConversationWindowScope, limit: number): Promise<string[]> {
    const record = this.liveRecord(scope);
    return (record?.turns ?? [])
      .slice(-Math.max(0, limit))
      .map((turn) => `${turn.role}: ${turn.text}`);
  }

  private liveRecord(scope: ConversationWindowScope): ConversationWindowRecord | undefined {
    const key = conversationScopeKey(scope);
    const record = this.records.get(key);
    if (!record) {
      return undefined;
    }
    if (new Date(record.expiresAt).getTime() <= this.now().getTime()) {
      this.records.delete(key);
      return undefined;
    }
    return record;
  }
}

export class RedisConversationWindowStore implements ConversationWindowStore {
  private readonly now: () => Date;

  constructor(
    private readonly options: {
      client: RedisConversationWindowClient;
      keyPrefix: string;
      now?: () => Date;
    }
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async isActive(scope: ConversationWindowScope): Promise<boolean> {
    return Boolean(await this.liveRecord(scope));
  }

  async recordTurn(input: {
    scope: ConversationWindowScope;
    role: ConversationTurnRole;
    text: string;
    ttlMs: number;
  }): Promise<void> {
    const existing = await this.liveRecord(input.scope);
    const now = this.now();
    const record: ConversationWindowRecord = {
      expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
      turns: [
        ...(existing?.turns ?? []),
        {
          role: input.role,
          text: compactText(input.text),
          createdAt: now.toISOString()
        }
      ].slice(-8)
    };
    await this.options.client.setEx(
      this.key(input.scope),
      Math.max(1, Math.ceil(input.ttlMs / 1000)),
      JSON.stringify(record)
    );
  }

  async recentTurns(scope: ConversationWindowScope, limit: number): Promise<string[]> {
    const record = await this.liveRecord(scope);
    return (record?.turns ?? [])
      .slice(-Math.max(0, limit))
      .map((turn) => `${turn.role}: ${turn.text}`);
  }

  private async liveRecord(
    scope: ConversationWindowScope
  ): Promise<ConversationWindowRecord | undefined> {
    const raw = await this.options.client.get(this.key(scope));
    if (!raw) {
      return undefined;
    }
    const record = JSON.parse(raw) as ConversationWindowRecord;
    return new Date(record.expiresAt).getTime() > this.now().getTime() ? record : undefined;
  }

  private key(scope: ConversationWindowScope): string {
    return `${this.options.keyPrefix}:conversation-window:${conversationScopeKey(scope)}`;
  }
}

export interface ContextManagerOptions {
  runtimeContextBudgetTokens: number;
  compressionThresholdRatio: number;
}

export interface ContextSafetyInput {
  profileName: string;
  sourceKey: string;
  requesterUserId?: string;
  enabledFunctions: FunctionName[];
  adminAllowed: boolean;
  webAllowlistDecision: string;
}

export interface ContextBuildInput {
  safety: ContextSafetyInput;
  currentMessage: string;
  activeSessionSummary?: string;
  recentTurns?: string[];
  functionResultSummaries?: string[];
  memoryCandidates?: string[];
}

export interface ContextBundle {
  prompt: string;
  approximateTokens: number;
  compressed: boolean;
}

export interface ContextManager {
  build(input: ContextBuildInput): ContextBundle;
}

export function createContextManager(options: ContextManagerOptions): ContextManager {
  const thresholdTokens = Math.max(
    1,
    Math.floor(options.runtimeContextBudgetTokens * options.compressionThresholdRatio)
  );
  return {
    build(input: ContextBuildInput): ContextBundle {
      const safety = formatSafety(input.safety);
      const essential = [
        "Safety context (do not summarize or drop):",
        safety,
        input.activeSessionSummary ? `activeSession=${input.activeSessionSummary}` : undefined,
        "",
        "Current user message:",
        input.currentMessage
      ].filter((line): line is string => typeof line === "string");

      const fullOptional = formatOptional(input, false);
      const fullPrompt = [...essential, ...fullOptional].join("\n");
      if (approximateTokens(fullPrompt) <= thresholdTokens) {
        return {
          prompt: fullPrompt,
          approximateTokens: approximateTokens(fullPrompt),
          compressed: false
        };
      }

      const compressedPrompt = [...essential, ...formatOptional(input, true)].join("\n");
      return {
        prompt: compressedPrompt,
        approximateTokens: approximateTokens(compressedPrompt),
        compressed: true
      };
    }
  };
}

function formatSafety(safety: ContextSafetyInput): string {
  return [
    `profile=${safety.profileName}`,
    `source=${safety.sourceKey}`,
    `requester=${safety.requesterUserId ?? "(unknown)"}`,
    `enabledFunctions=${safety.enabledFunctions.join(",") || "(none)"}`,
    `adminAllowed=${safety.adminAllowed ? "true" : "false"}`,
    `webAllowlist=${safety.webAllowlistDecision}`
  ].join("\n");
}

function formatOptional(input: ContextBuildInput, compressed: boolean): string[] {
  if (compressed) {
    return [
      "",
      "Compressed context:",
      summarizeList("recentTurns", input.recentTurns),
      summarizeList("functionResults", input.functionResultSummaries),
      summarizeList("memoryCandidates", input.memoryCandidates)
    ].filter(Boolean);
  }
  return [
    "",
    "Recent engaged turns:",
    ...(input.recentTurns ?? []),
    "",
    "Recent function results:",
    ...(input.functionResultSummaries ?? []),
    "",
    "Relevant memory candidates:",
    ...(input.memoryCandidates ?? [])
  ];
}

function summarizeList(label: string, values: string[] | undefined): string {
  const count = values?.length ?? 0;
  if (count === 0) {
    return `${label}: none`;
  }
  const first = values?.[0]?.slice(0, 80) ?? "";
  return `${label}: ${count} item(s); first=${first}`;
}

function approximateTokens(value: string): number {
  return Math.ceil(Array.from(value).length / 4);
}

export function conversationScopeKey(scope: ConversationWindowScope): string {
  return [scope.profileName, scope.sourceKey, scope.requesterUserId ?? ""]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

function compactText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, 240);
}
