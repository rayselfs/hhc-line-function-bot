import { getFunctionDefinition } from "../functions/definitions.js";
import type { FunctionName, JsonRecord } from "../types.js";
import type { FunctionContinuationContext } from "./context-manager.js";

export function mergeFunctionContinuationArguments(input: {
  action: FunctionName;
  currentArguments: JsonRecord;
  continuation: FunctionContinuationContext | undefined;
}): JsonRecord {
  if (!input.continuation || input.continuation.functionName !== input.action) {
    return input.currentArguments;
  }
  const policy = getFunctionDefinition(input.action)?.continuation;
  if (!policy) {
    return input.currentArguments;
  }

  const blocked = new Set<string>();
  for (const group of policy.exclusiveGroups ?? []) {
    if (group.some((argument) => hasValue(input.currentArguments[argument]))) {
      for (const argument of group) blocked.add(argument);
    }
  }

  const carried: JsonRecord = {};
  for (const argument of policy.carryArguments) {
    const value = input.continuation.arguments[argument];
    if (!blocked.has(argument) && !hasValue(input.currentArguments[argument]) && hasValue(value)) {
      carried[argument] = value;
    }
  }
  return { ...carried, ...input.currentArguments };
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}
