import { normalizeFunctionArguments } from "../functions/argument-normalization.js";
import { FUNCTION_DEFINITIONS } from "../functions/definitions.js";
import type { FunctionName, JsonRecord, RouteResult } from "../types.js";
import type { FunctionContinuationContext } from "./context-manager.js";

export function guardSystemRouteWithFunctionIntent(
  route: RouteResult,
  text: string,
  enabledFunctions: FunctionName[],
  continuation?: FunctionContinuationContext
): RouteResult {
  const continuationIntent = detectContinuationIntent(route, text, enabledFunctions, continuation);
  if (continuationIntent) {
    return {
      type: "execute",
      action: continuationIntent.action,
      arguments: continuationIntent.arguments,
      provider: "keyword",
      fallbackProvider:
        route.provider === "ollama" || route.provider === "deepseek" ? route.provider : undefined,
      fallbackReason: "active_function_continuation"
    };
  }

  if (route.type !== "respond") {
    return route;
  }

  const explicitIntent = detectExplicitReadIntent(text, enabledFunctions);
  if (!explicitIntent) {
    return route;
  }

  return {
    type: "execute",
    action: explicitIntent.action,
    arguments: explicitIntent.arguments,
    provider: "keyword",
    fallbackProvider:
      route.provider === "ollama" || route.provider === "deepseek" ? route.provider : undefined,
    fallbackReason: `system_route_${route.action}`
  };
}

function detectContinuationIntent(
  route: RouteResult,
  text: string,
  enabledFunctions: FunctionName[],
  continuation: FunctionContinuationContext | undefined
): { action: FunctionName; arguments: JsonRecord } | undefined {
  if (!continuation || !enabledFunctions.includes(continuation.functionName)) return undefined;
  if (route.type === "execute") return undefined;
  if (route.type === "respond" && route.action !== "small_talk") return undefined;
  const definition = FUNCTION_DEFINITIONS.find(
    ({ name, continuation: policy }) => name === continuation.functionName && Boolean(policy)
  );
  if (!definition) return undefined;
  const arguments_ = normalizeFunctionArguments(
    continuation.functionName,
    { query: text },
    {
      text,
      continuationArguments: continuation.arguments
    }
  );
  return hasContinuationEvidence(text, continuation.arguments, arguments_)
    ? { action: continuation.functionName, arguments: arguments_ }
    : undefined;
}

function hasContinuationEvidence(
  text: string,
  previous: JsonRecord,
  normalized: JsonRecord
): boolean {
  if (Object.keys(normalized).some((key) => key !== "query" && key !== "originalQuery")) {
    return true;
  }
  const comparable = normalizeText(text);
  return Object.values(previous).some((value) =>
    (Array.isArray(value) ? value : [value]).some(
      (item) =>
        typeof item === "string" && normalizeText(item) && comparable.includes(normalizeText(item))
    )
  );
}

function detectExplicitReadIntent(
  text: string,
  enabledFunctions: FunctionName[]
): { action: FunctionName; arguments: JsonRecord } | undefined {
  const enabled = new Set(enabledFunctions);
  const matches = FUNCTION_DEFINITIONS.filter(
    (definition) =>
      enabled.has(definition.name) &&
      definition.sideEffectLevel === "read" &&
      [
        ...(definition.agentCapability?.intents ?? []),
        ...(definition.agentCapability?.candidateHints ?? []),
        ...(definition.keywordFallback?.keywords ?? [])
      ].some((term) => normalizeText(term) && normalizeText(text).includes(normalizeText(term)))
  );
  if (matches.length !== 1) return undefined;
  const action = matches[0]!.name;
  return {
    action,
    arguments: normalizeFunctionArguments(action, { query: text.trim() }, { text })
  };
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}
