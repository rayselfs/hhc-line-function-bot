import { getFunctionDefinition } from "../functions/definitions.js";
import type { FunctionExecutionResult, FunctionName } from "../types.js";
import { activeTaskFromResult } from "./active-task.js";
import type { ConversationWindowScope, ConversationWindowStore } from "./context-manager.js";

export async function applyActiveTaskTransition(input: {
  store?: ConversationWindowStore;
  scope?: ConversationWindowScope;
  capability: FunctionName;
  result: FunctionExecutionResult;
  now: Date;
  ttlMs: number;
}): Promise<void> {
  if (
    !input.store ||
    !input.scope?.requesterUserId ||
    !input.result.ok ||
    input.result.agentResult?.status !== "success"
  ) {
    return;
  }

  const contractOperations = getFunctionDefinition(input.capability)?.agentCapability?.operations;
  const resultOperations = input.result.agentResult.supportedOperations ?? [];
  const continuable = Boolean(
    contractOperations?.some((operation) => resultOperations.includes(operation))
  );
  const ttlMs = Math.max(1, input.ttlMs);
  const next = continuable
    ? activeTaskFromResult(input.capability, input.result, input.now, ttlMs)
    : undefined;
  if (next) {
    await input.store.recordActiveTask({ scope: input.scope, task: next, ttlMs });
    return;
  }
  await input.store.clearActiveTask(input.scope);
}
