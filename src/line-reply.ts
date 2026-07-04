import type { BotProfileConfig, FunctionName, QuickReplyItem } from "./types.js";

const functionLabels: Record<FunctionName, string> = {
  find_ppt_slides: "查投影片",
  query_service_schedule: "查服事表"
};

const functionCommands: Record<FunctionName, string> = {
  find_ppt_slides: "小哈 查投影片",
  query_service_schedule: "小哈 查服事表"
};

export function buildFunctionQuickReplies(profile: BotProfileConfig): QuickReplyItem[] {
  return profile.enabledFunctions.map((name) => ({
    label: functionLabels[name],
    action: {
      type: "message",
      label: functionLabels[name],
      text: functionCommands[name]
    }
  }));
}

export function buildPostbackQuickReply(
  label: string,
  data: string,
  displayText = label
): QuickReplyItem {
  return {
    label,
    action: {
      type: "postback",
      label,
      data,
      displayText
    }
  };
}
