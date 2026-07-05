import type { FunctionName, JsonRecord, RouteInput, RouteResult } from "./types.js";

interface KeywordRule {
  action: FunctionName;
  keywords: string[];
  stripWords: string[];
}

export interface KeywordFallbackRouter {
  route(input: RouteInput): RouteResult;
}

const commonStripWords = ["小哈", "請", "幫我", "幫忙", "查詢", "查", "找", "搜尋"];

const rules: KeywordRule[] = [
  {
    action: "find_ppt_slides",
    keywords: ["投影片", "ppt", "powerpoint", "slides"],
    stripWords: [...commonStripWords, "投影片", "ppt", "powerpoint", "slides"]
  },
  {
    action: "query_service_schedule",
    keywords: ["服事表", "服事"],
    stripWords: [...commonStripWords]
  }
];

export function createKeywordFallbackRouter(): KeywordFallbackRouter {
  return {
    route(input: RouteInput): RouteResult {
      const text = input.text.trim();
      const matches = rules.filter((rule) =>
        rule.keywords.some((keyword) => includesKeyword(text, keyword))
      );

      if (matches.length === 0) {
        return { type: "deny", reason: "keyword_no_match", provider: "keyword" };
      }

      const enabledMatches = matches.filter((match) =>
        input.enabledFunctions.includes(match.action)
      );
      if (enabledMatches.length === 0) {
        return { type: "deny", reason: "function_disabled", provider: "keyword" };
      }

      if (enabledMatches.length > 1) {
        return { type: "deny", reason: "keyword_ambiguous", provider: "keyword" };
      }

      const match = enabledMatches[0];
      return {
        type: "execute",
        action: match.action,
        arguments: extractArguments(match, text),
        provider: "keyword"
      };
    }
  };
}

function includesKeyword(text: string, keyword: string): boolean {
  return text.toLowerCase().includes(keyword.toLowerCase());
}

function extractArguments(rule: KeywordRule, text: string): JsonRecord {
  const query = cleanupQuery(text, rule.stripWords);
  const argumentsRecord: JsonRecord = { query: query || text.trim() };
  if (rule.action === "find_ppt_slides") {
    argumentsRecord.matchMode = "fuzzy";
    if (includesKeyword(text, "pdf")) {
      argumentsRecord.fileType = "pdf";
    }
  }
  return argumentsRecord;
}

function cleanupQuery(text: string, stripWords: string[]): string {
  let result = text;
  for (const word of stripWords) {
    result = result.replaceAll(word, " ");
  }
  return result.replace(/\s+/g, " ").trim();
}
