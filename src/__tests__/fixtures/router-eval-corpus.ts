import type { FunctionName, JsonRecord } from "../../types.js";

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

export const keywordRouteEvalCases: KeywordRouteEvalCase[] = [
  {
    text: "小哈 查投影片 主日報告 pdf",
    action: "find_ppt_slides",
    arguments: { query: "主日報告", fileType: "pdf", matchMode: "fuzzy" }
  },
  {
    text: "小哈 查流行歌譜 A TIME FOR US",
    action: "find_pop_sheet_music",
    arguments: { query: "A TIME FOR US", fileType: "pdf", matchMode: "fuzzy" }
  },
  {
    text: "小哈 查歌譜 Yesterday jpg",
    action: "find_pop_sheet_music",
    arguments: { query: "Yesterday", fileType: "image", matchMode: "fuzzy" }
  },
  {
    text: "小哈 下一場聚會服事表",
    action: "query_service_schedule",
    arguments: { query: "下一場聚會服事表" }
  },
  {
    text: "小哈 查服事表",
    action: "query_service_schedule",
    arguments: { query: "服事表" }
  }
];

export const keywordDenyEvalTexts = [
  "小哈 查流行歌 Yesterday",
  "小哈 查詩歌 奇異恩典",
  "小哈 幫我查資料"
];
