import type { FunctionName } from "../../types.js";
import { getRouterEvalCases, type RouterEvalCase } from "../../functions/modules.js";

export const routerEvalEnabledFunctions: FunctionName[] = [
  "find_ppt_slides",
  "query_service_schedule",
  "find_pop_sheet_music",
  "query_wikipedia",
  "save_memory",
  "retrieve_memory",
  "save_schedule_memory",
  "query_schedule_memory"
];

export const keywordRouteEvalCases: RouterEvalCase[] = getRouterEvalCases();

export const keywordDenyEvalCases: RouterEvalCase[] = [
  ...getRouterEvalCases().filter((entry) => entry.expected.type === "deny"),
  "小哈 查流行歌 Yesterday",
  "小哈 查詩歌 奇異恩典",
  "小哈 幫我查資料"
].map((entry) =>
  typeof entry === "string"
    ? {
        kind: "negative",
        text: entry,
        expected: { type: "deny", reason: "keyword_no_match" }
      }
    : entry
);
