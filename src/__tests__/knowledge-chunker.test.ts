import { describe, expect, it } from "vitest";

import { chunkKnowledgeNodes } from "../knowledge/chunker.js";

describe("knowledge chunker", () => {
  it("preserves heading paths and never merges across headings", () => {
    const chunks = chunkKnowledgeNodes([
      { externalId: "h1", type: "heading_1", ordinal: 0, text: "第一天" },
      { externalId: "p1", type: "paragraph", ordinal: 1, text: "第一個地點是日月潭" },
      { externalId: "h2", type: "heading_1", ordinal: 2, text: "第二天" },
      { externalId: "p2", type: "paragraph", ordinal: 3, text: "第二個地點是清境農場" }
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.headingPath).toEqual(["第一天"]);
    expect(chunks[0]?.content).not.toContain("清境");
    expect(chunks[1]?.headingPath).toEqual(["第二天"]);
  });
});
