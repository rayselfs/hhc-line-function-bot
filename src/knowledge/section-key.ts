import { createHash } from "node:crypto";

export function knowledgeSectionKey(headingPath: readonly string[]): string {
  const normalized = headingPath
    .map((heading) =>
      heading
        .normalize("NFKC")
        .toLocaleLowerCase("zh-TW")
        .replace(/[\p{P}\p{S}\s]+/gu, "")
    )
    .filter(Boolean)
    .join("\u001f");
  return createHash("sha256")
    .update(`knowledge-section-v1\0${normalized || "root"}`)
    .digest("hex");
}
