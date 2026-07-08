import { describe, expect, it, vi } from "vitest";

import {
  createLlmTokenCipher,
  InMemoryLlmAuthStore,
  OpenAICodexAuthManager,
  TerminalLlmAuthError
} from "../llm/auth.js";

describe("LLM OAuth auth store", () => {
  it("encrypts token material so raw OAuth tokens are not persisted", () => {
    const cipher = createLlmTokenCipher("test-encryption-key");

    const encrypted = cipher.encrypt("access-token-value");

    expect(encrypted).not.toContain("access-token-value");
    expect(cipher.decrypt(encrypted)).toBe("access-token-value");
  });

  it("refreshes expired Codex OAuth credentials once and persists rotated tokens", async () => {
    const store = new InMemoryLlmAuthStore();
    await store.save({
      provider: "openai_codex_oauth",
      profileName: "helper",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      status: "active"
    });
    const refresh = vi.fn().mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      accountId: "acct_1"
    });
    const manager = new OpenAICodexAuthManager({ store, refresh });

    await expect(manager.getAccessToken("helper")).resolves.toBe("new-access");
    await expect(manager.getAccessToken("helper")).resolves.toBe("new-access");

    expect(refresh).toHaveBeenCalledTimes(1);
    await expect(store.get("openai_codex_oauth", "helper")).resolves.toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      accountId: "acct_1",
      status: "active"
    });
  });

  it("quarantines terminal refresh failures so later calls fail fast", async () => {
    const store = new InMemoryLlmAuthStore();
    await store.save({
      provider: "openai_codex_oauth",
      profileName: "helper",
      accessToken: "old-access",
      refreshToken: "dead-refresh",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      status: "active"
    });
    const refresh = vi.fn().mockRejectedValue(new TerminalLlmAuthError("invalid_grant"));
    const manager = new OpenAICodexAuthManager({ store, refresh });

    await expect(manager.getAccessToken("helper")).rejects.toMatchObject({
      message: "reauth_required"
    });
    await expect(manager.getAccessToken("helper")).rejects.toMatchObject({
      message: "reauth_required"
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    await expect(store.get("openai_codex_oauth", "helper")).resolves.toMatchObject({
      status: "reauth_required",
      lastError: "invalid_grant"
    });
  });
});
