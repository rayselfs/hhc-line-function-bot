import type { z } from "zod";

import {
  findPopSheetMusicArgumentsSchema,
  findPptSlidesArgumentsSchema,
  queryServiceScheduleArgumentsSchema,
  retrieveMemoryArgumentsSchema,
  saveMemoryArgumentsSchema
} from "../function-arguments.js";
import type { AgentResourceType, FunctionName, JsonRecord } from "../types.js";

export interface FunctionKeywordFallback {
  keywords: string[];
  stripWords: string[];
  defaultArguments?: JsonRecord;
}

export type FunctionSideEffectLevel = "read" | "write" | "admin" | "destructive";
export type FunctionAllowedSource = "user" | "group";
export type FunctionRequiredSlotMissingWhen = "blank" | "service_schedule_generic";

export interface FunctionRequiredSlot {
  name: string;
  argument: string;
  missingWhen: FunctionRequiredSlotMissingWhen;
  prompt: string;
  quickReplies?: Array<{
    label: string;
    text: string;
  }>;
}

export interface FunctionResourcePolicy {
  kind: "none" | "graph_file";
  resourceTypes?: AgentResourceType[];
  remember: boolean;
  alias: boolean;
}

export interface FunctionMemoryPolicy {
  kind: "none" | "resource_metadata" | "explicit_text" | "retrieve_text";
}

export interface FunctionDefinition {
  name: FunctionName;
  displayName: string;
  shortDescription: string;
  examples: string[];
  requires: Array<"graph" | "notion" | "session" | "cache" | "memory">;
  scope: "profile" | "group_capable";
  sideEffectLevel: FunctionSideEffectLevel;
  allowedSources: FunctionAllowedSource[];
  requiredSlots: FunctionRequiredSlot[];
  resourcePolicy: FunctionResourcePolicy;
  memoryPolicy: FunctionMemoryPolicy;
  clarificationPrompt: string;
  description: string;
  argumentSchema: z.ZodType;
  quickReply: {
    label: string;
    command: string;
  };
  helpText: string;
  keywordFallback?: FunctionKeywordFallback;
}

const commonStripWords = ["小哈", "請", "幫我", "幫忙", "查詢", "查", "找", "搜尋"];

export const FUNCTION_DEFINITIONS: FunctionDefinition[] = [
  {
    name: "find_ppt_slides",
    displayName: "查投影片",
    shortDescription: "幫你找聚會或詩歌需要的投影片。",
    examples: ["小哈 查投影片 奇異恩典", "小哈 查主日報告投影片"],
    requires: ["graph", "session"],
    scope: "group_capable",
    sideEffectLevel: "read",
    allowedSources: ["user", "group"],
    requiredSlots: [
      {
        name: "query",
        argument: "query",
        missingWhen: "blank",
        prompt: "要查哪一份投影片？請直接回覆名稱。"
      }
    ],
    resourcePolicy: {
      kind: "graph_file",
      resourceTypes: ["ppt_slide"],
      remember: true,
      alias: true
    },
    memoryPolicy: { kind: "resource_metadata" },
    clarificationPrompt: "要查哪一份投影片？請直接回覆名稱。",
    description:
      '- find_ppt_slides: find church PowerPoint/PDF slide files by title or keyword. Arguments: {"query":"extracted filename/title keyword", "originalQuery":"full user request optional", "fileType":"ppt|pdf|any optional", "includePdf": boolean optional, "matchMode":"fuzzy|exact optional"}. Use fuzzy for typo-tolerant song/title lookup.',
    argumentSchema: findPptSlidesArgumentsSchema,
    quickReply: {
      label: "查投影片",
      command: "小哈 查投影片"
    },
    helpText: "查 OneDrive 裡的投影片或 PDF，找到後回 1 天有效下載連結。",
    keywordFallback: {
      keywords: ["投影片", "ppt", "powerpoint", "slides"],
      stripWords: [...commonStripWords, "投影片", "ppt", "powerpoint", "slides", "pdf"],
      defaultArguments: { matchMode: "fuzzy" }
    }
  },
  {
    name: "query_service_schedule",
    displayName: "查服事表",
    shortDescription: "幫你看近期聚會的服事安排。",
    examples: ["小哈 下一場聚會服事表", "小哈 查主日服事"],
    requires: ["notion"],
    scope: "group_capable",
    sideEffectLevel: "read",
    allowedSources: ["user", "group"],
    requiredSlots: [
      {
        name: "service_schedule_range",
        argument: "query",
        missingWhen: "service_schedule_generic",
        prompt: "要查哪一場聚會或哪一天的服事？",
        quickReplies: [
          { label: "下一場", text: "下一場" },
          { label: "本週", text: "本週" },
          { label: "明天", text: "明天" },
          { label: "主日", text: "主日服事" }
        ]
      }
    ],
    resourcePolicy: { kind: "none", remember: false, alias: false },
    memoryPolicy: { kind: "none" },
    clarificationPrompt: "要查哪一場聚會或哪一天的服事？",
    description:
      '- query_service_schedule: query church meeting service schedule or serving assignments. Arguments: {"query":"original user request text", "dateIntent":"today|tomorrow|day_after_tomorrow|this_week|next_meeting|specific_date|upcoming optional", "specificDate":"YYYY-MM-DD required for specific_date", "meeting":"text optional", "role":"text optional", "limit": number optional}. For requests like 下一場/最近一場, use dateIntent next_meeting.',
    argumentSchema: queryServiceScheduleArgumentsSchema,
    quickReply: {
      label: "查服事表",
      command: "小哈 查服事表"
    },
    helpText: "查 Notion 上的聚會服事安排，例如下一場、本週、明天或主日。",
    keywordFallback: {
      keywords: ["服事表", "服事"],
      stripWords: [...commonStripWords]
    }
  },
  {
    name: "find_pop_sheet_music",
    displayName: "查流行歌譜",
    shortDescription: "協助查找流行歌曲樂譜，適合同工臨時找譜使用。",
    examples: ["小哈 查流行歌譜 Yesterday", "小哈 幫我找 A TIME FOR US 的樂譜"],
    requires: ["graph", "cache"],
    scope: "group_capable",
    sideEffectLevel: "read",
    allowedSources: ["user", "group"],
    requiredSlots: [
      {
        name: "query",
        argument: "query",
        missingWhen: "blank",
        prompt: "要查哪一首流行歌曲樂譜？請直接回覆歌名。"
      }
    ],
    resourcePolicy: {
      kind: "graph_file",
      resourceTypes: ["sheet_music"],
      remember: true,
      alias: true
    },
    memoryPolicy: { kind: "resource_metadata" },
    clarificationPrompt: "要查哪一首流行歌曲樂譜？請直接回覆歌名。",
    description:
      '- find_pop_sheet_music: find pop song sheet music PDF/image files by title or artist. Arguments: {"query":"song title keyword", "artist":"artist optional", "fileType":"pdf|image|any optional", "matchMode":"fuzzy|exact optional"}. Use this only for 流行歌譜, 流行歌曲樂譜, 樂譜, or sheet music requests.',
    argumentSchema: findPopSheetMusicArgumentsSchema,
    quickReply: {
      label: "查流行歌譜",
      command: "小哈 查流行歌譜"
    },
    helpText: "查 OneDrive 裡的流行歌曲樂譜 PDF 或圖片，找到後回 1 天有效下載連結。",
    keywordFallback: {
      keywords: ["流行歌譜", "流行歌曲樂譜", "樂譜", "歌譜", "sheet music"],
      stripWords: [
        ...commonStripWords,
        "流行歌譜",
        "流行歌曲樂譜",
        "流行歌曲",
        "樂譜",
        "歌譜",
        "sheet music",
        "pdf",
        "jpg",
        "jpeg",
        "png",
        "圖片",
        "image"
      ],
      defaultArguments: { fileType: "pdf", matchMode: "fuzzy" }
    }
  },
  {
    name: "save_memory",
    displayName: "記住資訊",
    shortDescription: "保存使用者明確要求小哈記住的文字資訊。",
    examples: ["小哈幫我記住這個月服事表：主日導播是小明"],
    requires: ["memory"],
    scope: "profile",
    sideEffectLevel: "write",
    allowedSources: ["user", "group"],
    requiredSlots: [
      {
        name: "content",
        argument: "content",
        missingWhen: "blank",
        prompt: "請直接告訴我要記住的內容。"
      }
    ],
    resourcePolicy: { kind: "none", remember: false, alias: false },
    memoryPolicy: { kind: "explicit_text" },
    clarificationPrompt: "請直接告訴我要記住的內容。",
    description:
      '- save_memory: save explicit user-provided text memory only when the user clearly asks the bot to remember/save/store information. Arguments: {"title":"short optional title", "content":"the exact text to remember", "query":"optional lookup phrase"}. Do not use for passive group chatter.',
    argumentSchema: saveMemoryArgumentsSchema,
    quickReply: {
      label: "記住資訊",
      command: "小哈幫我記住："
    },
    helpText: "保存你明確交代小哈記住的文字資訊，預設只保留一段時間。",
    keywordFallback: {
      keywords: ["幫我記住", "記住這個", "幫我保存", "幫我儲存"],
      stripWords: [...commonStripWords, "幫我記住", "記住這個", "幫我保存", "幫我儲存"]
    }
  },
  {
    name: "retrieve_memory",
    displayName: "查記住的資訊",
    shortDescription: "查詢使用者曾明確請小哈記住的資訊。",
    examples: ["小哈查我記住的服事表"],
    requires: ["memory"],
    scope: "profile",
    sideEffectLevel: "read",
    allowedSources: ["user", "group"],
    requiredSlots: [
      {
        name: "query",
        argument: "query",
        missingWhen: "blank",
        prompt: "要查哪一段記住的資訊？請回覆關鍵字。"
      }
    ],
    resourcePolicy: { kind: "none", remember: false, alias: false },
    memoryPolicy: { kind: "retrieve_text" },
    clarificationPrompt: "請告訴我要查哪一段記住的資訊。",
    description:
      '- retrieve_memory: retrieve explicit saved text memories. Arguments: {"query":"keyword or topic to search"}. Use only when the user asks what the bot remembered/saved/stored.',
    argumentSchema: retrieveMemoryArgumentsSchema,
    quickReply: {
      label: "查記憶",
      command: "小哈查我記住的"
    },
    helpText: "查詢先前明確保存的文字資訊。",
    keywordFallback: {
      keywords: ["查我記住", "查我保存", "查我儲存", "我記住的", "小哈記得"],
      stripWords: [
        ...commonStripWords,
        "查我記住的",
        "查我保存的",
        "查我儲存的",
        "我記住的",
        "小哈記得"
      ]
    }
  }
];

export function getFunctionDefinition(name: FunctionName): FunctionDefinition | undefined {
  return FUNCTION_DEFINITIONS.find((definition) => definition.name === name);
}

export function getFunctionDefinitions(names: FunctionName[]): FunctionDefinition[] {
  return names
    .map((name) => getFunctionDefinition(name))
    .filter((definition): definition is FunctionDefinition => Boolean(definition));
}
