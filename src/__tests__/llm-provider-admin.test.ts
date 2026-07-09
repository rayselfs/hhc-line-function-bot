import { describe, expect, it, vi } from "vitest";

import { InMemoryAccessStore } from "../access/memory-access-store.js";
import { signLineBody } from "../line-signature.js";
import { createApp } from "../server.js";
import type { AppConfig, LineReplyClient } from "../types.js";

function config(): AppConfig {
  return {
    serviceName: "hhc-line-function-bot",
    host: "127.0.0.1",
    port: 3000,
    timeZone: "Asia/Taipei",
    healthPath: "/healthz",
    readyPath: "/readyz",
    maxBodyBytes: 32_768,
    profiles: [
      {
        name: "helper",
        webhookPath: "/api/line/webhook/helper",
        channelSecret: "helper-secret",
        channelAccessToken: "helper-token",
        allowDirectUser: true,
        allowRooms: false,
        allowedMessageTypes: ["text"],
        groupRequireWakeWord: true,
        wakeKeywords: ["小哈"],
        acceptMention: true,
        enabledFunctions: ["query_service_schedule"],
        adminUserId: "Uroot",
        adminDirectOnly: true,
        directAccessPolicy: "managed",
        groupAccessPolicy: "managed",
        llmProvider: "codex_app_server",
        allowedProviders: ["ollama", "codex_app_server"],
        allowSubscriptionProviders: true
      }
    ],
    llm: {
      provider: "codex_app_server",
      fallbackProvider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3:4b-instruct",
      codexAppServerCommand: "codex",
      codexAppServerArgs: ["app-server", "--listen", "stdio://"],
      codexHome: "/tmp/codex-home",
      timeoutMs: 8000,
      keywordFallbackEnabled: true
    }
  };
}

function mainConfig(): AppConfig {
  const value = config();
  return {
    ...value,
    profiles: [
      {
        ...value.profiles[0],
        name: "main",
        webhookPath: "/api/line/webhook/main",
        llmProvider: "ollama",
        allowedProviders: ["ollama"],
        allowSubscriptionProviders: false
      }
    ]
  };
}

function lineBody(event: Record<string, unknown>) {
  return JSON.stringify({ destination: "bot", events: [event] });
}

function signedHeaders(body: string) {
  return {
    "content-type": "application/json",
    "x-line-signature": signLineBody(Buffer.from(body), "helper-secret")
  };
}

describe("LLM provider admin commands", () => {
  it("keeps provider login direct-chat superadmin only", async () => {
    const replyText = vi.fn<LineReplyClient["replyText"]>().mockResolvedValue(undefined);
    const app = createApp(config(), {
      router: { route: vi.fn() },
      accessStore: new InMemoryAccessStore(),
      createLineReplyClient: () => ({ replyText })
    });
    const body = lineBody({
      type: "message",
      replyToken: "reply-token",
      source: { type: "group", groupId: "C1", userId: "Uroot" },
      message: { type: "text", text: "/llm-login codex" }
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/line/webhook/helper",
      headers: signedHeaders(body),
      payload: body
    });

    expect(res.statusCode).toBe(200);
    expect(replyText.mock.calls[0]?.[1]).toContain("請在 1 對 1 對話中使用");
  });

  it("returns Codex runtime login guidance to the bootstrap superadmin", async () => {
    const replyText = vi.fn<LineReplyClient["replyText"]>().mockResolvedValue(undefined);
    const app = createApp(config(), {
      router: { route: vi.fn() },
      accessStore: new InMemoryAccessStore(),
      createLineReplyClient: () => ({ replyText })
    });
    const body = lineBody({
      type: "message",
      replyToken: "reply-token",
      source: { type: "user", userId: "Uroot" },
      message: { type: "text", text: "/llm-login codex" }
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/line/webhook/helper",
      headers: signedHeaders(body),
      payload: body
    });

    expect(res.statusCode).toBe(200);
    expect(replyText.mock.calls[0]?.[1]).toContain("Codex app-server");
    expect(replyText.mock.calls[0]?.[1]).toContain("CODEX_HOME");
    expect(replyText.mock.calls[0]?.[1]).not.toContain("/api/line/llm-auth/openai-codex");
  });

  it("reports the active provider without persisting a switch from LINE", async () => {
    const replyText = vi.fn<LineReplyClient["replyText"]>().mockResolvedValue(undefined);
    const app = createApp(config(), {
      router: { route: vi.fn() },
      accessStore: new InMemoryAccessStore(),
      createLineReplyClient: () => ({ replyText })
    });
    const body = lineBody({
      type: "message",
      replyToken: "reply-token",
      source: { type: "user", userId: "Uroot" },
      message: { type: "text", text: "/llm-use" }
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/line/webhook/helper",
      headers: signedHeaders(body),
      payload: body
    });

    expect(res.statusCode).toBe(200);
    expect(replyText.mock.calls[0]?.[1]).toContain("active: codex_app_server");
    expect(replyText.mock.calls[0]?.[1]).toContain("available: ollama, codex_app_server");
  });

  it("lists only providers allowed by the current profile", async () => {
    const replyText = vi.fn<LineReplyClient["replyText"]>().mockResolvedValue(undefined);
    const app = createApp(mainConfig(), {
      router: { route: vi.fn() },
      accessStore: new InMemoryAccessStore(),
      createLineReplyClient: () => ({ replyText })
    });
    const body = JSON.stringify({
      destination: "bot",
      events: [
        {
          type: "message",
          replyToken: "reply-token",
          source: { type: "user", userId: "Uroot" },
          message: { type: "text", text: "/llm-use" }
        }
      ]
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/line/webhook/main",
      headers: {
        "content-type": "application/json",
        "x-line-signature": signLineBody(Buffer.from(body), "helper-secret")
      },
      payload: body
    });

    expect(res.statusCode).toBe(200);
    expect(replyText.mock.calls[0]?.[1]).toContain("available: ollama");
    expect(replyText.mock.calls[0]?.[1]).not.toContain("codex_app_server");
  });

  it("blocks subscription provider login when the current profile disallows it", async () => {
    const replyText = vi.fn<LineReplyClient["replyText"]>().mockResolvedValue(undefined);
    const app = createApp(mainConfig(), {
      router: { route: vi.fn() },
      accessStore: new InMemoryAccessStore(),
      createLineReplyClient: () => ({ replyText })
    });
    const body = JSON.stringify({
      destination: "bot",
      events: [
        {
          type: "message",
          replyToken: "reply-token",
          source: { type: "user", userId: "Uroot" },
          message: { type: "text", text: "/llm-login codex" }
        }
      ]
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/line/webhook/main",
      headers: {
        "content-type": "application/json",
        "x-line-signature": signLineBody(Buffer.from(body), "helper-secret")
      },
      payload: body
    });

    expect(res.statusCode).toBe(200);
    expect(replyText.mock.calls[0]?.[1]).toContain("provider is not allowed for this profile");
    expect(replyText.mock.calls[0]?.[1]).not.toContain("CODEX_HOME");
  });
});
