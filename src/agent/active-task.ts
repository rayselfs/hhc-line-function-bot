import type { FunctionExecutionResult, FunctionName, JsonRecord } from "../types.js";
import type { AgentEntity } from "./result-envelope.js";

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
  return {
    version: 1,
    capability,
    anchors: result.agentResult.anchors ?? {},
    entities: (result.agentResult.entities ?? []).slice(0, 20),
    references: result.agentResult.evidence?.[0]?.reference,
    supportedOperations: (result.agentResult.supportedOperations ?? []).slice(0, 8),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString()
  };
}
