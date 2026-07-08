import { describe, expect, it, vi } from "vitest";

import { InMemoryAccessStore } from "../access/memory-access-store.js";
import { InMemoryLlmAuthStore } from "../llm/auth.js";
import { InMemoryLlmOAuthStateStore } from "../llm/oauth-state-store.js";
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
        groupAccessPolicy: "managed"
      }
    ],
    llm: {
      provider: "openai_codex_oauth",
      fallbackProvider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3:4b-instruct",
      openaiCodexAuthProfile: "helper",
      openaiCodexOAuthAuthorizeUrl: "https://auth.example.test/oauth/authorize",
      openaiCodexOAuthTokenUrl: "https://auth.example.test/oauth/token",
      openaiCodexOAuthClientId: "client-test",
      publicBaseUrl: "https://www.alive.org.tw",
      authLoginStateTtlMinutes: 10,
      authEncryptionKey: "test-key",
      timeoutMs: 8000,
      keywordFallbackEnabled: true
    },
    redis: {
      url: "redis://test",
      keyPrefix: "test"
    },
    database: {
      url: "postgres://test",
      ssl: true
    }
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

describe("LLM OAuth flow", () => {
  it("lets the bootstrap superadmin create a one-time login URL from direct chat", async () => {
    const replyText = vi.fn<LineReplyClient["replyText"]>().mockResolvedValue(undefined);
    const stateStore = new InMemoryLlmOAuthStateStore({
      stateFactory: () => "state-1",
      now: () => new Date("2026-07-08T10:00:00.000Z")
    });
    const app = createApp(config(), {
      router: { route: vi.fn() },
      accessStore: new InMemoryAccessStore(),
      llmOAuthStateStore: stateStore,
      llmAuthStore: new InMemoryLlmAuthStore(),
      createLineReplyClient: () => ({ replyText })
    });
    const body = lineBody({
      type: "message",
      replyToken: "reply-token",
      source: { type: "user", userId: "Uroot" },
      message: { type: "text", text: "/llm-login" }
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/line/webhook/helper",
      headers: signedHeaders(body),
      payload: body
    });

    expect(res.statusCode).toBe(200);
    expect(replyText.mock.calls[0]?.[1]).toContain(
      "https://www.alive.org.tw/api/line/llm-auth/openai-codex/start?state=state-1"
    );
    await expect(stateStore.peek("state-1")).resolves.toMatchObject({
      profileName: "helper",
      actorUserId: "Uroot",
      authProfile: "helper"
    });
  });

  it("keeps llm-login superadmin direct-chat only", async () => {
    const replyText = vi.fn<LineReplyClient["replyText"]>().mockResolvedValue(undefined);
    const app = createApp(config(), {
      router: { route: vi.fn() },
      accessStore: new InMemoryAccessStore(),
      llmOAuthStateStore: new InMemoryLlmOAuthStateStore(),
      llmAuthStore: new InMemoryLlmAuthStore(),
      createLineReplyClient: () => ({ replyText })
    });
    const body = lineBody({
      type: "message",
      replyToken: "reply-token",
      source: { type: "user", userId: "Uother" },
      message: { type: "text", text: "/llm-login" }
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/line/webhook/helper",
      headers: signedHeaders(body),
      payload: body
    });

    expect(res.statusCode).toBe(200);
    expect(replyText.mock.calls[0]?.[1]).toContain("權限");
  });

  it("redirects a valid state to the OAuth authorize endpoint", async () => {
    const stateStore = new InMemoryLlmOAuthStateStore({
      stateFactory: () => "state-1",
      now: () => new Date("2026-07-08T10:00:00.000Z")
    });
    await stateStore.create({
      profileName: "helper",
      actorUserId: "Uroot",
      authProfile: "helper",
      ttlMinutes: 10
    });
    const app = createApp(config(), {
      router: { route: vi.fn() },
      llmOAuthStateStore: stateStore,
      llmAuthStore: new InMemoryLlmAuthStore()
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/line/llm-auth/openai-codex/start?state=state-1"
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("https://auth.example.test/oauth/authorize?");
    expect(res.headers.location).toContain("client_id=client-test");
    expect(res.headers.location).toContain(
      "redirect_uri=https%3A%2F%2Fwww.alive.org.tw%2Fapi%2Fline%2Fllm-auth%2Fopenai-codex%2Fcallback"
    );
    expect(res.headers.location).toContain("state=state-1");
  });

  it("exchanges a callback code and stores auth credentials without leaking tokens", async () => {
    const stateStore = new InMemoryLlmOAuthStateStore({
      stateFactory: () => "state-1",
      now: () => new Date("2026-07-08T10:00:00.000Z")
    });
    await stateStore.create({
      profileName: "helper",
      actorUserId: "Uroot",
      authProfile: "helper",
      ttlMinutes: 10
    });
    const authStore = new InMemoryLlmAuthStore();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600
        }),
        { status: 200 }
      )
    );
    const app = createApp(config(), {
      router: { route: vi.fn() },
      llmOAuthStateStore: stateStore,
      llmAuthStore: authStore,
      llmOAuthFetch: fetchImpl
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/line/llm-auth/openai-codex/callback?state=state-1&code=auth-code"
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Login complete");
    expect(res.body).not.toContain("access-token");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://auth.example.test/oauth/token",
      expect.objectContaining({
        method: "POST",
        body: expect.any(URLSearchParams)
      })
    );
    await expect(authStore.get("openai_codex_oauth", "helper")).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      status: "active"
    });
    await expect(stateStore.peek("state-1")).resolves.toBeUndefined();
  });

  it("lets the bootstrap superadmin logout the stored OAuth profile", async () => {
    const authStore = new InMemoryLlmAuthStore();
    await authStore.save({
      provider: "openai_codex_oauth",
      profileName: "helper",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-07-08T11:00:00.000Z",
      status: "active"
    });
    const replyText = vi.fn<LineReplyClient["replyText"]>().mockResolvedValue(undefined);
    const app = createApp(config(), {
      router: { route: vi.fn() },
      llmAuthStore: authStore,
      llmOAuthStateStore: new InMemoryLlmOAuthStateStore(),
      createLineReplyClient: () => ({ replyText })
    });
    const body = lineBody({
      type: "message",
      replyToken: "reply-token",
      source: { type: "user", userId: "Uroot" },
      message: { type: "text", text: "/llm-logout" }
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/line/webhook/helper",
      headers: signedHeaders(body),
      payload: body
    });

    expect(res.statusCode).toBe(200);
    expect(replyText.mock.calls[0]?.[1]).toContain("Logged out");
    await expect(authStore.get("openai_codex_oauth", "helper")).resolves.toMatchObject({
      status: "reauth_required"
    });
  });
});
