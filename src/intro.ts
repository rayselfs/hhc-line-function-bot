import { getFunctionDefinitions } from "./functions/definitions.js";
import { buildFunctionQuickReplies } from "./line-reply.js";
import type { BotProfileConfig, FunctionExecutionResult, FunctionName } from "./types.js";

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

const introDescriptions: Partial<Record<FunctionName, string>> = {
  find_ppt_slides: "幫你找聚會或詩歌需要的投影片。",
  query_service_schedule: "幫你看近期聚會的服事安排。",
  find_pop_sheet_music: "幫你找流行歌曲樂譜。"
};

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
      replyText: "我是小哈，教會同工小幫手。目前還沒有開放可查詢的項目。"
    };
  }

  return {
    ok: true,
    replyText: [
      "我是小哈，教會同工小幫手。",
      "需要資料時可以叫我一聲，我可以幫忙：",
      "",
      ...definitions.map(
        (definition) =>
          `- ${definition.quickReply.label}：${
            introDescriptions[definition.name] ?? "幫你查詢已開放的資料。"
          }`
      ),
      "",
      "可以直接點下方按鈕，或用一句話告訴我想查什麼。"
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
