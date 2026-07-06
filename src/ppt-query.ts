const wakeWordPattern = /^小哈[\s,，、:：。!！?？]*/i;
const leadingRequestWords = [
  "請",
  "麻煩",
  "可以",
  "可不可以",
  "能不能",
  "幫我",
  "幫忙",
  "幫",
  "我要",
  "我想要",
  "想要",
  "查詢",
  "查",
  "找",
  "搜尋",
  "拿",
  "下載",
  "給我"
];

export function extractPptSlideQuery(text: string): string {
  let query = text.normalize("NFKC").trim().replace(wakeWordPattern, "");

  for (let index = 0; index < 4; index += 1) {
    const before = query;
    query = stripLeadingRequestWords(query);
    if (query === before) {
      break;
    }
  }

  query = query
    .replace(/的?(?:詩歌)?(?:投影片|簡報)/gi, " ")
    .replace(/\b(?:pptx?|powerpoint|slides?|pdf)\b/gi, " ")
    .replace(/[()[\]{}"'“”‘’.,，。!！?？:：、/\\|_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^的+|的+$/g, "")
    .trim();

  return query;
}

function stripLeadingRequestWords(value: string): string {
  let result = value.trimStart();
  for (const word of leadingRequestWords) {
    if (result.startsWith(word)) {
      result = result.slice(word.length).trimStart();
      result = result.replace(/^[,，、:：。!！?？\s]+/, "");
      break;
    }
  }
  return result;
}
