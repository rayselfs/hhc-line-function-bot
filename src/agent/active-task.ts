import {
  FUNCTION_NAMES,
  type FunctionExecutionResult,
  type FunctionName,
  type JsonRecord
} from "../types.js";
import type { AgentEntity } from "./result-envelope.js";

const LIMITS = {
  totalBytes: 16_384,
  recordKeys: 16,
  recordKeyChars: 80,
  recordValueChars: 500,
  recordArrayItems: 10,
  recordArrayValueChars: 200,
  entities: 20,
  entityIdChars: 200,
  entityLabelChars: 500,
  aliases: 10,
  aliasChars: 200,
  operations: 8,
  operationChars: 200
} as const;

type NormalizeMode = "sanitize" | "strict";

export interface ActiveTaskContext {
  version: 1;
  capability: FunctionName;
  anchors: JsonRecord;
  entities: AgentEntity[];
  references?: JsonRecord;
  supportedOperations: string[];
  createdAt: string;
  expiresAt: string;
}

export function activeTaskFromResult(
  capability: FunctionName,
  result: FunctionExecutionResult,
  now: Date,
  ttlMs: number
): ActiveTaskContext | undefined {
  if (!result.ok || result.agentResult?.status !== "success") return undefined;
  return normalizeActiveTask(
    {
      version: 1,
      capability,
      anchors: result.agentResult.anchors ?? {},
      entities: result.agentResult.entities ?? [],
      references: result.agentResult.evidence?.[0]?.reference,
      supportedOperations: result.agentResult.supportedOperations ?? [],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString()
    },
    now,
    "sanitize"
  );
}

export function prepareActiveTaskForStorage(
  task: ActiveTaskContext,
  now: Date
): ActiveTaskContext | undefined {
  return normalizeActiveTask(task, now, "sanitize");
}

export function decodeActiveTask(raw: string, now: Date): ActiveTaskContext | undefined {
  if (serializedBytes(raw) > LIMITS.totalBytes) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  return normalizeActiveTask(value, now, "strict");
}

export function cloneActiveTask(task: ActiveTaskContext): ActiveTaskContext {
  return {
    version: 1,
    capability: task.capability,
    anchors: cloneRecord(task.anchors),
    entities: task.entities.map((entity) => ({
      type: entity.type,
      key: entity.key,
      label: entity.label,
      ...(entity.aliases ? { aliases: [...entity.aliases] } : {})
    })),
    ...(task.references ? { references: cloneRecord(task.references) } : {}),
    supportedOperations: [...task.supportedOperations],
    createdAt: task.createdAt,
    expiresAt: task.expiresAt
  };
}

const ACTIVE_TASK_KEYS = new Set([
  "version",
  "capability",
  "anchors",
  "entities",
  "references",
  "supportedOperations",
  "createdAt",
  "expiresAt"
]);
const ENTITY_KEYS = new Set(["type", "key", "label", "aliases"]);

function normalizeActiveTask(
  input: unknown,
  now: Date,
  mode: NormalizeMode
): ActiveTaskContext | undefined {
  if (!isPlainRecord(input) || (mode === "strict" && !hasOnlyKeys(input, ACTIVE_TASK_KEYS))) {
    return undefined;
  }
  if (
    input.version !== 1 ||
    !isFunctionName(input.capability) ||
    !isCanonicalTimestamp(input.createdAt) ||
    !isCanonicalTimestamp(input.expiresAt) ||
    Date.parse(input.expiresAt) <= Date.parse(input.createdAt) ||
    Date.parse(input.expiresAt) <= now.getTime()
  ) {
    return undefined;
  }
  const anchors = normalizeRecord(input.anchors, mode);
  const entities = normalizeEntities(input.entities, mode);
  const references =
    input.references === undefined ? undefined : normalizeRecord(input.references, mode);
  const supportedOperations = normalizeStringArray(
    input.supportedOperations,
    LIMITS.operations,
    LIMITS.operationChars,
    mode
  );
  if (
    !anchors ||
    !entities ||
    (input.references !== undefined && !references) ||
    !supportedOperations
  ) {
    return undefined;
  }
  const task: ActiveTaskContext = {
    version: 1,
    capability: input.capability,
    anchors,
    entities,
    ...(references ? { references } : {}),
    supportedOperations,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt
  };
  return serializedBytes(task) <= LIMITS.totalBytes ? task : undefined;
}

function normalizeRecord(input: unknown, mode: NormalizeMode): JsonRecord | undefined {
  if (!isPlainRecord(input)) return undefined;
  const entries = Object.entries(input);
  if (
    entries.some(([key, value]) => isForbiddenKey(key) || isSensitiveRecordValue(value)) ||
    (mode === "strict" && entries.length > LIMITS.recordKeys)
  ) {
    return undefined;
  }
  const output: JsonRecord = {};
  for (const [key, value] of entries.slice(0, LIMITS.recordKeys)) {
    if (characterCount(key) === 0 || characterCount(key) > LIMITS.recordKeyChars) return undefined;
    if (typeof value === "string") {
      const normalized = normalizeText(value, LIMITS.recordValueChars, mode, true);
      if (normalized === undefined) return undefined;
      output[key] = normalized;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      output[key] = value;
    } else if (typeof value === "boolean") {
      output[key] = value;
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      const normalized = normalizeStringArray(
        value,
        LIMITS.recordArrayItems,
        LIMITS.recordArrayValueChars,
        mode,
        true
      );
      if (!normalized) return undefined;
      output[key] = normalized;
    } else if (mode === "strict") {
      return undefined;
    }
  }
  return output;
}

function isSensitiveRecordValue(value: unknown): boolean {
  return (
    (typeof value === "string" && isSensitiveValue(value)) ||
    (Array.isArray(value) &&
      value.some((entry) => typeof entry === "string" && isSensitiveValue(entry)))
  );
}

function normalizeEntities(input: unknown, mode: NormalizeMode): AgentEntity[] | undefined {
  if (!Array.isArray(input) || (mode === "strict" && input.length > LIMITS.entities)) {
    return undefined;
  }
  const output: AgentEntity[] = [];
  for (const value of input.slice(0, LIMITS.entities)) {
    if (!isPlainRecord(value) || (mode === "strict" && !hasOnlyKeys(value, ENTITY_KEYS))) {
      return undefined;
    }
    const type = normalizeText(value.type, LIMITS.entityIdChars, mode);
    const key = normalizeText(value.key, LIMITS.entityIdChars, mode);
    const label = normalizeText(value.label, LIMITS.entityLabelChars, mode);
    const aliases =
      value.aliases === undefined
        ? undefined
        : normalizeStringArray(value.aliases, LIMITS.aliases, LIMITS.aliasChars, mode);
    if (!type || !key || !label || (value.aliases !== undefined && !aliases)) return undefined;
    output.push({ type, key, label, ...(aliases ? { aliases } : {}) });
  }
  return output;
}

function normalizeStringArray(
  input: unknown,
  maxItems: number,
  maxChars: number,
  mode: NormalizeMode,
  allowEmpty = false
): string[] | undefined {
  if (
    !Array.isArray(input) ||
    !input.every((value) => typeof value === "string") ||
    (mode === "strict" && input.length > maxItems) ||
    input.some((value) => isSensitiveValue(value))
  ) {
    return undefined;
  }
  const output: string[] = [];
  for (const value of input.slice(0, maxItems)) {
    const normalized = normalizeText(value, maxChars, mode, allowEmpty);
    if (normalized === undefined) return undefined;
    output.push(normalized);
  }
  return output;
}

function normalizeText(
  value: unknown,
  maxChars: number,
  mode: NormalizeMode,
  allowEmpty = false
): string | undefined {
  if (
    typeof value !== "string" ||
    (!allowEmpty && characterCount(value) === 0) ||
    isSensitiveValue(value) ||
    (mode === "strict" && characterCount(value) > maxChars)
  ) {
    return undefined;
  }
  return truncateText(value, maxChars);
}

function isSensitiveValue(value: string): boolean {
  return (
    /\b(?:https?|line):\/\/\S+/iu.test(value) ||
    /\bwww\.[^\s]+/iu.test(value) ||
    /\bbearer\s+\S+/iu.test(value) ||
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/u.test(value) ||
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u.test(value) ||
    /\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|secret|password)\s*[:=]\s*\S+/iu.test(
      value
    )
  );
}

function isForbiddenKey(value: string): boolean {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
  return (
    ["proto", "prototype", "constructor", "authorization", "bearer"].includes(normalized) ||
    [
      "token",
      "secret",
      "password",
      "apikey",
      "accesskey",
      "credential",
      "credentials",
      "sharingurl",
      "shareurl"
    ].some((suffix) => normalized.endsWith(suffix))
  );
}

function isFunctionName(value: unknown): value is FunctionName {
  return typeof value === "string" && (FUNCTION_NAMES as readonly string[]).includes(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function cloneRecord(input: JsonRecord): JsonRecord {
  const output: JsonRecord = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = Array.isArray(value) ? [...value] : value;
  }
  return output;
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function truncateText(value: string, maxChars: number): string {
  return Array.from(value).slice(0, maxChars).join("");
}

function serializedBytes(value: unknown): number {
  const serialized = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return new TextEncoder().encode(serialized).length;
}
