import { classifySmallTalkCategory } from "../engagement.js";

const WRITE_ACTION = "記住|保存|儲存|存下|新增|修改|更新|刪除|移除|上傳|建立";
const WRITE_ACTION_PATTERN = new RegExp(`(?:${WRITE_ACTION})`, "u");
const DIRECT_WRITE_PATTERN = new RegExp(`^(?:請)?(?:${WRITE_ACTION})`, "u");

export function hasWriteIntent(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!WRITE_ACTION_PATTERN.test(normalized)) return false;
  return (
    /^(?:請)?(?:幫我|替我)/u.test(normalized) ||
    /^(?:請)?(?:把|將)/u.test(normalized) ||
    /^(?:我要|要)(?:把|將)?/u.test(normalized) ||
    DIRECT_WRITE_PATTERN.test(normalized)
  );
}

export function isConservativeKnowledgeEvidenceText(text: string): boolean {
  const addressedText = stripBotAddress(text);
  if (hasWriteIntent(addressedText)) return false;
  if (classifySmallTalkCategory(addressedText)) return false;
  return Array.from(normalizeIntentText(addressedText)).length >= 2;
}

function stripBotAddress(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .replace(/^小哈[\s,，、:：。.!！?？]*/u, "");
}

function normalizeIntentText(text: string): string {
  return stripBotAddress(text)
    .toLocaleLowerCase("zh-TW")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}
