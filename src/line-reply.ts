import type { QuickReplyItem } from "./types.js";

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
