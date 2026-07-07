import { createOllamaProvider } from "../clients/ollama.js";
import { getRouterEvalCases, type RouterEvalCase } from "../functions/modules.js";
import { createFunctionRouter } from "../router.js";
import { FUNCTION_NAMES } from "../types.js";
import type { RouteResult } from "../types.js";

const router = createFunctionRouter({
  primary: createOllamaProvider({
    baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
    model: process.env.OLLAMA_MODEL || "qwen3:4b-instruct",
    timeoutMs: readInt(process.env.OLLAMA_TIMEOUT_MS, 8000)
  }),
  keywordFallbackEnabled: false
});

const failures: string[] = [];
for (const entry of getRouterEvalCases()) {
  const result = await router.route({
    profileName: "eval",
    text: entry.text,
    enabledFunctions: entry.enabledFunctions ?? [...FUNCTION_NAMES],
    source: { type: "group", groupId: "Ceval", userId: "Ueval" }
  });

  if (!matchesExpectedResult(result, entry.expected)) {
    failures.push(
      [
        `kind: ${entry.kind}`,
        `text: ${entry.text}`,
        `enabledFunctions: ${(entry.enabledFunctions ?? [...FUNCTION_NAMES]).join(", ")}`,
        `expected: ${JSON.stringify(entry.expected)}`,
        `actual: ${JSON.stringify(result)}`
      ].join("\n")
    );
  }
}

function matchesExpectedResult(result: RouteResult, expected: RouterEvalCase["expected"]): boolean {
  if (expected.type === "deny") {
    return result.type === "deny";
  }

  return (
    result.type === "execute" &&
    result.action === expected.action &&
    isObjectSubset(expected.arguments, result.arguments)
  );
}

function isObjectSubset(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => stableJson(actual[key]) === stableJson(value)
  );
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const record = value as Record<string, unknown>;
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]])
    )
  );
}

function readInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

if (failures.length > 0) {
  console.error(`Ollama router eval failed: ${failures.length} case(s)`);
  console.error(failures.join("\n\n"));
  process.exitCode = 1;
} else {
  console.log(`Ollama router eval passed: ${getRouterEvalCases().length} case(s)`);
}
