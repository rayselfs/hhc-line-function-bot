import { z } from "zod";

import { FUNCTION_NAMES, isFunctionName } from "./types.js";
import type {
  ChatProvider,
  FunctionName,
  FunctionRouterPort,
  JsonRecord,
  RouteInput,
  RouteResult
} from "./types.js";
import type { KeywordFallbackRouter } from "./keyword-router.js";

const modelDecisionSchema = z.object({
  action: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional()
});

export class ProviderResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderResponseError";
  }
}

export interface FunctionRouterOptions {
  primary: ChatProvider;
  keywordFallback?: KeywordFallbackRouter;
  keywordFallbackEnabled: boolean;
}

export function createFunctionRouter(options: FunctionRouterOptions): FunctionRouterPort {
  return new FunctionRouter(options);
}

class FunctionRouter implements FunctionRouterPort {
  constructor(private readonly options: FunctionRouterOptions) {}

  async route(input: RouteInput): Promise<RouteResult> {
    const prompt = buildRouterPrompt(input.enabledFunctions);

    try {
      return parseProviderDecision(
        "ollama",
        await this.options.primary.completeJson({ ...input, prompt }),
        input
      );
    } catch (error) {
      if (!this.shouldFallback(error)) {
        return { type: "deny", reason: "router_failed", provider: "router" };
      }
    }

    if (!this.options.keywordFallback || !this.options.keywordFallbackEnabled) {
      return { type: "deny", reason: "keyword_fallback_not_configured", provider: "router" };
    }

    return this.options.keywordFallback.route(input);
  }

  private shouldFallback(error: unknown): boolean {
    if (!this.options.keywordFallbackEnabled || !this.options.keywordFallback) {
      return false;
    }
    return error instanceof ProviderResponseError;
  }
}

function parseProviderDecision(
  provider: "ollama",
  rawContent: string,
  input: RouteInput
): RouteResult {
  const json = parseJsonObject(rawContent);
  const parsed = modelDecisionSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderResponseError("invalid_json");
  }

  const action = parsed.data.action.trim();
  if (action === "deny") {
    return {
      type: "deny",
      reason: parsed.data.reason?.trim() || "not_matched",
      provider
    };
  }

  if (!isFunctionName(action)) {
    return { type: "deny", reason: "unknown_action", provider };
  }

  if (!input.enabledFunctions.includes(action)) {
    return { type: "deny", reason: "function_disabled", provider };
  }

  return {
    type: "execute",
    action,
    arguments: parsed.data.arguments ?? {},
    confidence: parsed.data.confidence,
    provider
  };
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch {
        throw new ProviderResponseError("invalid_json");
      }
    }
    throw new ProviderResponseError("invalid_json");
  }
}

function buildRouterPrompt(enabledFunctions: FunctionName[]): string {
  const available = enabledFunctions.map((name) => functionDescriptions[name]).join("\n");
  return [
    "You are a strict JSON function router for a LINE bot.",
    "Return exactly one JSON object and no markdown.",
    'If the user request does not clearly match an enabled function, return {"action":"deny","reason":"not_matched"}.',
    "Never invent a function name.",
    "Available functions:",
    available || "(none)"
  ].join("\n");
}

const functionDescriptions: Record<FunctionName, string> = {
  find_ppt_slides:
    '- find_ppt_slides: find church PowerPoint/PDF slide files by title or keyword. Arguments: {"query":"text", "includePdf": boolean}.',
  query_service_schedule:
    '- query_service_schedule: query church meeting service schedule or serving assignments. Arguments: {"query":"text", "date":"YYYY-MM-DD optional", "meeting":"text optional", "role":"text optional"}.'
};

export function coerceFunctionArguments(args: unknown): JsonRecord {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as JsonRecord;
  }
  return {};
}

export { FUNCTION_NAMES };
