import type { FunctionName, JsonRecord } from "../../types.js";
import { getRouterEvalCases } from "../../functions/modules.js";

export const routerEvalEnabledFunctions: FunctionName[] = [
  "find_ppt_slides",
  "query_service_schedule",
  "find_pop_sheet_music"
];

export interface KeywordRouteEvalCase {
  text: string;
  action: FunctionName;
  arguments: JsonRecord;
}

export const keywordRouteEvalCases: KeywordRouteEvalCase[] = getRouterEvalCases();

export const keywordDenyEvalTexts = [
  "小哈 查流行歌 Yesterday",
  "小哈 查詩歌 奇異恩典",
  "小哈 幫我查資料"
];
