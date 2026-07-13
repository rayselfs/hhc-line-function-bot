import { createHash } from "node:crypto";

import type { KnowledgeChunkInput, KnowledgeNodeInput } from "./store.js";
import { knowledgeSectionKey } from "./section-key.js";

const TARGET_CHARS = 700;

export function chunkKnowledgeNodes(nodes: KnowledgeNodeInput[]): KnowledgeChunkInput[] {
  const chunks: KnowledgeChunkInput[] = [];
  const headingPath: string[] = [];
  let pending: string[] = [];
  let pendingStart = 0;

  const flush = () => {
    const content = pending.join("\n").trim();
    if (content) {
      chunks.push({
        headingPath: [...headingPath],
        sectionKey: knowledgeSectionKey(headingPath),
        ordinal: pendingStart,
        content,
        contentHash: createHash("sha256")
          .update(`${headingPath.join("/")}\n${content}`)
          .digest("hex")
      });
    }
    pending = [];
  };

  for (const node of [...nodes].sort((a, b) => a.ordinal - b.ordinal)) {
    const level = headingLevel(node.type);
    if (level) {
      flush();
      headingPath.splice(level - 1);
      headingPath[level - 1] = node.text.trim();
      continue;
    }
    if (!node.text.trim()) continue;
    if (pending.length === 0) pendingStart = node.ordinal;
    if (pending.join("\n").length + node.text.length > TARGET_CHARS) {
      flush();
      pendingStart = node.ordinal;
    }
    pending.push(node.text.trim());
  }
  flush();
  return chunks;
}

function headingLevel(type: string): number | undefined {
  const match = type.match(/^heading_([1-3])$/u);
  return match ? Number(match[1]) : undefined;
}
