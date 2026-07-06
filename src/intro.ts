import { getFunctionDefinitions } from "./functions/definitions.js";
import { buildFunctionQuickReplies } from "./line-reply.js";
import type { BotProfileConfig, FunctionExecutionResult } from "./types.js";

const introTriggers = [
  "小哈",
  "小哈?",
  "小哈？",
  "help",
  "功能",
  "使用說明",
  "小哈可以幹嘛",
  "小哈你會什麼",
  "小哈會什麼"
];

export function createIntroReply(
  profile: BotProfileConfig,
  rawText: string
): FunctionExecutionResult | undefined {
  const normalized = normalizeIntroText(rawText);
  if (!isIntroRequest(normalized)) {
    return undefined;
  }

  const definitions = getFunctionDefinitions(profile.enabledFunctions);
  if (definitions.length === 0) {
    return {
      ok: true,
      replyText: "我是小哈，目前這個 bot 還沒有啟用可用功能。"
    };
  }

  return {
    ok: true,
    replyText: [
      "我是小哈，可以幫你處理這些事：",
      "",
      ...definitions.map(
        (definition) => `- ${definition.quickReply.label}：${definition.helpText}`
      ),
      "",
      "可以直接點下方按鈕，或用一句話告訴我你要查什麼。"
    ].join("\n"),
    quickReplies: buildFunctionQuickReplies(profile)
  };
}

function isIntroRequest(normalized: string): boolean {
  return introTriggers.includes(normalized);
}

function normalizeIntroText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[!！。.\s]+$/g, "")
    .toLowerCase();
}
