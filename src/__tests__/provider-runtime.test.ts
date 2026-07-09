import { describe, expect, it, vi } from "vitest";

import { createProfileAwareProvider, resolvePrimaryProviderName } from "../llm/provider-runtime.js";
import type {
  AppConfig,
  BotProfileConfig,
  ChatProvider,
  TextGenerationProvider
} from "../types.js";

function profile(overrides: Partial<BotProfileConfig> = {}): BotProfileConfig {
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
    enabledFunctions: ["query_service_schedule"],
    allowedProviders: ["ollama"],
    allowSubscriptionProviders: false,
    ...overrides
  };
}

function config(profiles: BotProfileConfig[]): AppConfig {
  return {
    serviceName: "hhc-line-function-bot",
    host: "127.0.0.1",
    port: 3000,
    timeZone: "Asia/Taipei",
    healthPath: "/healthz",
    maxBodyBytes: 32_768,
    profiles,
    llm: {
      provider: "ollama",
      fallbackProvider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3:4b-instruct",
      timeoutMs: 8000,
      keywordFallbackEnabled: true
    }
  };
}

function provider(raw: string): ChatProvider & TextGenerationProvider {
  return {
    completeJson: vi.fn().mockResolvedValue(raw),
    completeText: vi.fn().mockResolvedValue(raw)
  };
}

describe("provider runtime", () => {
  it("selects the profile-specific primary provider", async () => {
    const appConfig = config([
      profile({
        llmProvider: "codex_app_server",
        allowedProviders: ["ollama", "codex_app_server"],
        allowSubscriptionProviders: true
      })
    ]);
    const codex = provider("codex");
    const ollama = provider("ollama");
    const runtime = createProfileAwareProvider({
      config: appConfig,
      providers: { ollama, codex_app_server: codex },
      role: "primary"
    });

    await expect(
      runtime.completeJson({
        profileName: "helper",
        prompt: "route",
        text: "hello",
        enabledFunctions: []
      })
    ).resolves.toBe("codex");
    expect(codex.completeJson).toHaveBeenCalledOnce();
    expect(ollama.completeJson).not.toHaveBeenCalled();
  });

  it("rejects subscription providers when the profile does not allow them", () => {
    const appConfig = config([
      profile({
        llmProvider: "codex_app_server",
        allowedProviders: ["ollama"],
        allowSubscriptionProviders: false
      })
    ]);

    expect(() => resolvePrimaryProviderName(appConfig, appConfig.profiles[0])).toThrow(
      "Provider codex_app_server is not allowed for profile helper"
    );
  });
});
