import { classifySmallTalkCategory } from "../engagement.js";

const WRITE_ACTION = "記住|保存|儲存|存下|新增|修改|更新|刪除|移除|上傳|建立";
const MAX_IMPERATIVE_CONTENT_CHARACTERS = 80;
const BOUNDED_IMPERATIVE_CONTENT = `.{0,${MAX_IMPERATIVE_CONTENT_CHARACTERS}}`;
const POLITE_HELPER = "(?:(?:請|麻煩|可以|可不可以|能不能|能否)(?:你|您)?)?(?:幫我|替我)";
const HELPER_WRITE_PATTERN = new RegExp(
  `^${POLITE_HELPER}(?:把|將)?${BOUNDED_IMPERATIVE_CONTENT}(?:${WRITE_ACTION})`,
  "u"
);
const OBJECT_WRITE_PATTERN = new RegExp(
  `^(?:請)?(?:把|將)${BOUNDED_IMPERATIVE_CONTENT}(?:${WRITE_ACTION})`,
  "u"
);
const DESIRE_WRITE_PATTERN = new RegExp(
  `^(?:我要|要)(?:把|將)?${BOUNDED_IMPERATIVE_CONTENT}(?:${WRITE_ACTION})`,
  "u"
);
const DIRECT_WRITE_PATTERN = new RegExp(`^(?:請)?(?:${WRITE_ACTION})`, "u");

export function hasWriteIntent(text: string): boolean {
  const normalized = normalizeIntentText(text);
  return (
    HELPER_WRITE_PATTERN.test(normalized) ||
    OBJECT_WRITE_PATTERN.test(normalized) ||
    DESIRE_WRITE_PATTERN.test(normalized) ||
    DIRECT_WRITE_PATTERN.test(normalized)
  );
}

export function isConservativeKnowledgeEvidenceText(text: string): boolean {
  const addressedText = stripBotAddress(text);
  if (hasWriteIntent(addressedText)) return false;
  if (isInterpersonalOrSmallTalkText(addressedText)) return false;
  return Array.from(normalizeIntentText(addressedText)).length >= 2;
}

export function isInterpersonalOrSmallTalkText(text: string): boolean {
  const addressedText = stripBotAddress(text);
  if (classifySmallTalkCategory(addressedText)) return true;
  const normalized = normalizeIntentText(addressedText);
  const hasSecondPerson = /(?:你|妳|您)/u.test(normalized);
  if (!hasSecondPerson) return false;
  const hasQuestionStructure =
    /(?:誰|什麼|甚麼|啥|哪(?:裡|邊|個|位)?|幾|怎麼|如何|為什麼|何時|多久|多少|名字|姓名|嗎|嘛|呢|啊|呀)/u.test(
      normalized
    );
  return hasQuestionStructure;
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
