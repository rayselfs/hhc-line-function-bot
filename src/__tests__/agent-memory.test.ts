import { describe, expect, it, vi } from "vitest";

import { createAgentRuntime } from "../agent/agent-runtime.js";
import { InMemoryAgentMemoryStore } from "../agent/memory-store.js";
import type { BotProfileConfig, FunctionHandlerContext, GraphDriveClient } from "../types.js";

function profile(): BotProfileConfig {
  return {
    name: "helper",
    webhookPath: "/api/line/webhook/helper",
    channelSecret: "secret",
    channelAccessToken: "token",
    allowDirectUser: true,
    allowRooms: false,
    allowedMessageTypes: ["text"],
    groupRequireWakeWord: true,
    wakeKeywords: ["小哈"],
    acceptMention: true,
    enabledFunctions: ["find_ppt_slides", "find_pop_sheet_music", "save_memory", "retrieve_memory"]
  };
}

function context(): FunctionHandlerContext {
  return {
    profile: profile(),
    requestId: "req-1",
    event: {
      type: "message",
      replyToken: "reply-token",
      source: { type: "group", groupId: "C1", userId: "U1" },
      message: { type: "text", text: "小哈 查投影片 奇異恩典" }
    }
  };
}

describe("agent memory", () => {
  it("stores recent resources by source and requester and ignores expired records", async () => {
    const now = new Date("2026-07-08T00:00:00.000Z");
    const store = new InMemoryAgentMemoryStore({ now: () => now });
    await store.recordResource({
      profileName: "helper",
      source: { type: "group", groupId: "C1", userId: "U1" },
      createdBy: "U1",
      resourceType: "ppt_slide",
      title: "奇異恩典.pptx",
      query: "奇異恩典",
      storage: { provider: "graph", driveId: "drive-id", itemId: "ppt-1" },
      expiresAt: "2026-07-07T00:00:00.000Z"
    });
    await store.recordResource({
      profileName: "helper",
      source: { type: "group", groupId: "C1", userId: "U1" },
      createdBy: "U1",
      resourceType: "ppt_slide",
      title: "恩典之路.pptx",
      query: "恩典之路",
      storage: { provider: "graph", driveId: "drive-id", itemId: "ppt-2" },
      expiresAt: "2026-08-07T00:00:00.000Z"
    });

    await expect(
      store.findRecentResource({
        profileName: "helper",
        source: { type: "group", groupId: "C1", userId: "U1" },
        requesterUserId: "U1",
        resourceTypes: ["ppt_slide"]
      })
    ).resolves.toMatchObject({ title: "恩典之路.pptx" });
    await expect(
      store.findRecentResource({
        profileName: "helper",
        source: { type: "group", groupId: "C1", userId: "U2" },
        requesterUserId: "U2",
        resourceTypes: ["ppt_slide"]
      })
    ).resolves.toBeUndefined();
  });

  it("uses scoped aliases before falling back to file search", async () => {
    const now = new Date("2026-07-08T00:00:00.000Z");
    const store = new InMemoryAgentMemoryStore({ now: () => now });
    const resource = await store.recordResource({
      profileName: "helper",
      source: { type: "group", groupId: "C1", userId: "U1" },
      createdBy: "U1",
      resourceType: "ppt_slide",
      title: "奇異恩典青年版.pptx",
      query: "奇異恩典",
      storage: { provider: "graph", driveId: "drive-id", itemId: "ppt-2" },
      expiresAt: "2026-08-07T00:00:00.000Z"
    });
    await store.rememberAlias({
      profileName: "helper",
      source: { type: "group", groupId: "C1", userId: "U1" },
      createdBy: "U1",
      alias: "奇異恩典",
      resourceId: resource.id
    });

    await expect(
      store.findResourceByAlias({
        profileName: "helper",
        source: { type: "group", groupId: "C1", userId: "U2" },
        alias: "奇異恩典",
        resourceTypes: ["ppt_slide"]
      })
    ).resolves.toMatchObject({ title: "奇異恩典青年版.pptx" });
  });

  it("recalls the latest resource through the agent runtime without routing again", async () => {
    const now = new Date("2026-07-08T00:00:00.000Z");
    const store = new InMemoryAgentMemoryStore({ now: () => now });
    const graph: GraphDriveClient = {
      listFolderChildren: vi.fn(),
      createSharingLink: vi.fn().mockResolvedValue("https://download.invalid/recalled")
    };
    const runtime = createAgentRuntime({ memoryStore: store, graph, now: () => now });

    await runtime.afterFunctionResult({
      context: context(),
      action: "find_ppt_slides",
      arguments: { query: "奇異恩典" },
      result: {
        ok: true,
        replyText: "done",
        agentResource: {
          resourceType: "ppt_slide",
          title: "奇異恩典.pptx",
          storage: { provider: "graph", driveId: "drive-id", itemId: "ppt-1" }
        }
      }
    });
    const result = await runtime.handleTextBeforeRouting({
      text: "小哈 再給我一次",
      context: context()
    });

    expect(result?.replyText).toContain("奇異恩典.pptx");
    expect(result?.replyText).toContain("https://download.invalid/recalled");
    expect(graph.createSharingLink).toHaveBeenCalledWith(
      "drive-id",
      "ppt-1",
      "2026-07-09T00:00:00.000Z"
    );
  });

  it("saves explicit text memory and retrieves it by query", async () => {
    const now = new Date("2026-07-08T00:00:00.000Z");
    const store = new InMemoryAgentMemoryStore({ now: () => now });
    const runtime = createAgentRuntime({ memoryStore: store, now: () => now });

    const saved = await runtime.handleTextBeforeRouting({
      text: "小哈幫我記住這個月服事表：主日導播是知樂",
      context: context()
    });
    const retrieved = await runtime.handleTextBeforeRouting({
      text: "小哈查我記住的服事表",
      context: context()
    });

    expect(saved?.replyText).toContain("已記住");
    expect(retrieved?.replyText).toContain("主日導播是知樂");
  });

  it("lists text memories and keeps memory status admin-only", async () => {
    const now = new Date("2026-07-08T00:00:00.000Z");
    const store = new InMemoryAgentMemoryStore({ now: () => now });
    const runtime = createAgentRuntime({ memoryStore: store, now: () => now });

    await runtime.handleTextBeforeRouting({
      text: "小哈幫我記住主日導播是知樂",
      context: context()
    });

    await expect(
      runtime.handleCommand({ text: "/memories", context: context(), isAdmin: false })
    ).resolves.toMatchObject({
      replyText: expect.stringContaining("主日導播是知樂")
    });
    await expect(
      runtime.handleCommand({ text: "/memory-status", context: context(), isAdmin: false })
    ).resolves.toMatchObject({
      replyText: "這個指令需要管理員權限。"
    });
    await expect(
      runtime.handleCommand({ text: "/memory-status", context: context(), isAdmin: true })
    ).resolves.toMatchObject({
      replyText: expect.stringContaining("textMemories: 1")
    });
  });
});
