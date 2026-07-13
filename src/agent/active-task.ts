import type { FunctionExecutionResult, FunctionName, JsonRecord } from "../types.js";
import { prepareActiveTaskForStorage } from "./active-task-codec.js";
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
  return prepareActiveTaskForStorage(
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
    now
  );
}
