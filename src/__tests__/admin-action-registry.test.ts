import { describe, expect, it } from "vitest";

import { InMemoryAccessStore } from "../access/memory-access-store.js";
import { InMemoryRegistrationInviteCodeStore } from "../access/registration-invite-code-store.js";
import { InMemoryConfirmationStore } from "../actions/confirmation-store.js";
import { createAdminActionRegistry } from "../actions/admin-registry.js";
import { InMemoryWebAllowlistStore } from "../web/allowlist.js";
import type { BotProfileConfig } from "../types.js";

function profile(registrationEnabled = true): BotProfileConfig {
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
    enabledFunctions: ["find_ppt_slides"],
    adminUserId: "Uroot",
    adminDirectOnly: true,
    directAccessPolicy: "managed",
    groupAccessPolicy: "managed",
    registration: { enabled: registrationEnabled }
  };
}

describe("admin action registry", () => {
  it("creates copyable invite codes and records audit events", async () => {
    const accessStore = new InMemoryAccessStore();
    const registrationInviteCodeStore = new InMemoryRegistrationInviteCodeStore({
      codeFactory: () => "ADMINCODE"
    });
    const registry = createAdminActionRegistry({
      accessStore,
      registrationInviteCodeStore,
      registrationInviteCodeTtlMinutes: 60
    });

    const result = await registry.execute({
      action: "invite_code_create",
      profile: profile(),
      event: {
        type: "message",
        source: { type: "user", userId: "Uroot" }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.replyText).toContain("/registry ADMINCODE");
    expect(result.replyText.split("\n")).toContain("/registry ADMINCODE");
    await expect(registrationInviteCodeStore.consume("helper", "ADMINCODE")).resolves.toBe(true);
    expect(accessStore.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "invite_code.create",
          actorUserId: "Uroot",
          metadata: { ttlMinutes: 60 }
        })
      ])
    );
  });

  it("does not create invite codes when registration is disabled", async () => {
    const accessStore = new InMemoryAccessStore();
    const registrationInviteCodeStore = new InMemoryRegistrationInviteCodeStore({
      codeFactory: () => "DISABLED"
    });
    const registry = createAdminActionRegistry({
      accessStore,
      registrationInviteCodeStore,
      registrationInviteCodeTtlMinutes: 60
    });

    const result = await registry.execute({
      action: "invite_code_create",
      profile: profile(false),
      event: {
        type: "message",
        source: { type: "user", userId: "Uroot" }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.replyText).toContain("沒有啟用註冊邀請碼");
    await expect(registrationInviteCodeStore.consume("helper", "DISABLED")).resolves.toBe(false);
    expect(accessStore.audit).toEqual([]);
  });

  it("does not require confirmation for invite code creation", async () => {
    const accessStore = new InMemoryAccessStore();
    const registrationInviteCodeStore = new InMemoryRegistrationInviteCodeStore({
      codeFactory: () => "ADMINCODE"
    });
    const confirmationStore = new InMemoryConfirmationStore({
      idFactory: () => {
        throw new Error("confirmation should not be created");
      }
    });
    const registry = createAdminActionRegistry({
      accessStore,
      registrationInviteCodeStore,
      registrationInviteCodeTtlMinutes: 60,
      confirmationStore
    });

    const result = await registry.execute({
      action: "invite_code_create",
      profile: profile(),
      event: {
        type: "message",
        source: { type: "user", userId: "Uroot" }
      }
    });

    expect(result.replyText).toContain("/registry ADMINCODE");
  });

  it("adds a web allowlist entry from routed natural-language arguments", async () => {
    const accessStore = new InMemoryAccessStore();
    const webAllowlistStore = new InMemoryWebAllowlistStore();
    const registry = createAdminActionRegistry({
      accessStore,
      registrationInviteCodeStore: new InMemoryRegistrationInviteCodeStore(),
      registrationInviteCodeTtlMinutes: 60,
      webAllowlistStore
    });

    const result = await registry.execute({
      action: "web_allowlist_add",
      profile: profile(),
      event: {
        type: "message",
        source: { type: "user", userId: "Uroot" }
      },
      arguments: {
        url: "https://example.org/news/today",
        label: "Example News"
      }
    });

    const entries = await webAllowlistStore.list("helper");
    expect(result.replyText).toContain("Added web allowlist");
    expect(entries).toEqual([
      expect.objectContaining({
        domain: "example.org",
        pathPrefix: "/news/today",
        label: "Example News",
        enabled: true
      })
    ]);
    expect(accessStore.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "web_allowlist.add",
          targetType: "web_allowlist",
          metadata: { domain: "example.org", pathPrefix: "/news/today" }
        })
      ])
    );
  });

  it("asks for a website when web allowlist add is missing a target", async () => {
    const registry = createAdminActionRegistry({
      accessStore: new InMemoryAccessStore(),
      registrationInviteCodeStore: new InMemoryRegistrationInviteCodeStore(),
      registrationInviteCodeTtlMinutes: 60,
      webAllowlistStore: new InMemoryWebAllowlistStore()
    });

    const result = await registry.execute({
      action: "web_allowlist_add",
      profile: profile(),
      event: {
        type: "message",
        source: { type: "user", userId: "Uroot" }
      },
      arguments: {}
    });

    expect(result.replyText).toContain("請提供要加入白名單");
  });

  it("lists web allowlist entries from natural-language admin actions", async () => {
    const accessStore = new InMemoryAccessStore();
    const webAllowlistStore = new InMemoryWebAllowlistStore();
    await webAllowlistStore.add({
      profileName: "helper",
      domain: "example.org",
      pathPrefix: "/news",
      createdBy: "Uroot"
    });
    const registry = createAdminActionRegistry({
      accessStore,
      registrationInviteCodeStore: new InMemoryRegistrationInviteCodeStore(),
      registrationInviteCodeTtlMinutes: 60,
      webAllowlistStore
    });

    const result = await registry.execute({
      action: "web_allowlist_list",
      profile: profile(),
      event: {
        type: "message",
        source: { type: "user", userId: "Uroot" }
      }
    });

    expect(result.replyText).toContain("Web allowlist");
    expect(result.replyText).toContain("example.org");
    expect(result.replyText).toContain("path=/news");
  });

  it("grants and revokes current-group function scopes from routed arguments", async () => {
    const accessStore = new InMemoryAccessStore();
    const registry = createAdminActionRegistry({
      accessStore,
      registrationInviteCodeStore: new InMemoryRegistrationInviteCodeStore(),
      registrationInviteCodeTtlMinutes: 60
    });
    const groupEvent = {
      type: "message" as const,
      source: { type: "group" as const, groupId: "Cmain", userId: "Uroot" }
    };

    const grant = await registry.execute({
      action: "function_scope_grant",
      profile: profile(),
      event: groupEvent,
      arguments: { functionName: "find_pop_sheet_music" }
    });
    const list = await registry.execute({
      action: "function_scope_list",
      profile: profile(),
      event: groupEvent
    });
    const revoke = await registry.execute({
      action: "function_scope_revoke",
      profile: profile(),
      event: groupEvent,
      arguments: { functionName: "find_pop_sheet_music" }
    });

    await expect(accessStore.listGroupFunctionGrants("helper", "Cmain")).resolves.toEqual([]);
    expect(grant.replyText).toContain("find_pop_sheet_music");
    expect(list.replyText).toContain("group-grants: find_pop_sheet_music");
    expect(revoke.replyText).toContain("find_pop_sheet_music");
    expect(accessStore.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "access.function.grant",
          targetId: "Cmain",
          metadata: { functionName: "find_pop_sheet_music" }
        }),
        expect.objectContaining({
          action: "access.function.revoke",
          targetId: "Cmain",
          metadata: { functionName: "find_pop_sheet_music" }
        })
      ])
    );
  });

  it("confirms a stored admin action only once", async () => {
    const accessStore = new InMemoryAccessStore();
    const registrationInviteCodeStore = new InMemoryRegistrationInviteCodeStore({
      codeFactory: () => "ADMINCODE"
    });
    const confirmationStore = new InMemoryConfirmationStore({
      idFactory: () => "CONFIRM1",
      now: () => new Date("2026-07-07T00:00:00.000Z")
    });
    await confirmationStore.create({
      profileName: "helper",
      actorUserId: "Uroot",
      action: "invite_code_create",
      ttlMinutes: 5
    });
    const registry = createAdminActionRegistry({
      accessStore,
      registrationInviteCodeStore,
      registrationInviteCodeTtlMinutes: 60,
      confirmationStore
    });

    const first = await registry.confirm({
      code: "CONFIRM1",
      profile: profile(),
      event: {
        type: "message",
        source: { type: "user", userId: "Uroot" }
      }
    });
    const second = await registry.confirm({
      code: "CONFIRM1",
      profile: profile(),
      event: {
        type: "message",
        source: { type: "user", userId: "Uroot" }
      }
    });

    expect(first.replyText).toContain("/registry ADMINCODE");
    expect(second.replyText).toContain("確認碼不存在");
  });
});
