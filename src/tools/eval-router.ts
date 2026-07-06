import { createKeywordFallbackRouter } from "../keyword-router.js";
import { createFunctionRouter } from "../router.js";
import { getRouterEvalCases } from "../functions/modules.js";
import { FUNCTION_NAMES } from "../types.js";
import type { ChatProvider } from "../types.js";

const invalidProvider: ChatProvider = {
  completeJson: async () => "not-json"
};

const router = createFunctionRouter({
  primary: invalidProvider,
  keywordFallback: createKeywordFallbackRouter(),
  keywordFallbackEnabled: true
});

const failures: string[] = [];
for (const entry of getRouterEvalCases()) {
  const result = await router.route({
    profileName: "eval",
    text: entry.text,
    enabledFunctions: [...FUNCTION_NAMES],
    source: { type: "group", groupId: "Ceval", userId: "Ueval" }
  });

  if (
    result.type !== "execute" ||
    result.action !== entry.action ||
    stableJson(result.arguments) !== stableJson(entry.arguments)
  ) {
    failures.push(
      [
        `text: ${entry.text}`,
        `expected: ${entry.action} ${JSON.stringify(entry.arguments)}`,
        `actual: ${JSON.stringify(result)}`
      ].join("\n")
    );
  }
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

if (failures.length > 0) {
  console.error(`Router eval failed: ${failures.length} case(s)`);
  console.error(failures.join("\n\n"));
  process.exitCode = 1;
} else {
  console.log(`Router eval passed: ${getRouterEvalCases().length} case(s)`);
}
