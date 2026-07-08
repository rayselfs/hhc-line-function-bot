import { describe, expect, it } from "vitest";

import { createContextManager } from "../agent/context-manager.js";

describe("ContextManager", () => {
  it("keeps safety context while compressing low value history", () => {
    const manager = createContextManager({
      runtimeContextBudgetTokens: 70,
      compressionThresholdRatio: 0.5
    });

    const bundle = manager.build({
      safety: {
        profileName: "helper",
        sourceKey: "group:g1",
        requesterUserId: "u1",
        enabledFunctions: ["find_ppt_slides"],
        adminAllowed: false,
        webAllowlistDecision: "not_requested"
      },
      currentMessage: "小哈，幫我查奇異恩典投影片",
      activeSessionSummary: "pending_slot=query",
      recentTurns: [
        "小哈你好",
        "我想查資料",
        "很多人在群組聊天但不是叫小哈",
        "另一個人提到小哈的人設"
      ],
      memoryCandidates: ["奇異恩典投影片 drive item 1", "Amazing Grace sheet music drive item 2"]
    });

    expect(bundle.compressed).toBe(true);
    expect(bundle.prompt).toContain("profile=helper");
    expect(bundle.prompt).toContain("requester=u1");
    expect(bundle.prompt).toContain("enabledFunctions=find_ppt_slides");
    expect(bundle.prompt).toContain("pending_slot=query");
    expect(bundle.prompt).not.toContain("很多人在群組聊天但不是叫小哈");
  });
});
