import { describe, expect, it, vi } from "vitest";

import { createAdminActionRegistry } from "../actions/admin-registry.js";
import { InMemoryConfirmationStore } from "../actions/confirmation-store.js";
import { InMemoryRegistrationInviteCodeStore } from "../access/registration-invite-code-store.js";
import { InMemoryAccessStore } from "../access/memory-access-store.js";
import { InMemoryKnowledgeStore } from "../knowledge/store.js";
import type { BotProfileConfig, LineEvent } from "../types.js";

const profile = {
  name: "helper",
  enabledFunctions: ["query_knowledge"],
  adminUserId: "Uroot",
  registration: { enabled: true }
} as BotProfileConfig;
const event = { type: "message", source: { type: "user", userId: "Uroot" } } as LineEvent;

describe("knowledge source admin actions", () => {
  it("adds and immediately synchronizes a shared page", async () => {
    const store = new InMemoryKnowledgeStore();
    const accessStore = new InMemoryAccessStore();
    const registry = createAdminActionRegistry({
      accessStore,
      registrationInviteCodeStore: new InMemoryRegistrationInviteCodeStore(),
      registrationInviteCodeTtlMinutes: 60,
      knowledgeStore: store,
      notionKnowledge: {
        fetchRoot: vi.fn().mockResolvedValue([
          {
            externalId: "doc",
            title: "聚會 SOP",
            url: "https://www.notion.so/doc",
            properties: {},
            nodes: [{ externalId: "p", type: "paragraph", ordinal: 0, text: "關閉設備" }]
          }
        ])
      }
    });

    const result = await registry.execute({
      action: "knowledge_source_add",
      profile,
      event,
      arguments: {
        url: "https://www.notion.so/SOP-0123456789abcdef0123456789abcdef",
        displayName: "聚會 SOP"
      }
    });

    expect(result.replyText).toContain("已加入知識來源");
    await expect(store.search({ profileName: "helper", query: "關閉設備" })).resolves.toHaveLength(
      1
    );
    expect(accessStore.audit).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "knowledge.source.add" })])
    );
  });

  it("preserves the source key through destructive confirmation", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.upsertSource({
      profileName: "helper",
      sourceKey: "sop-12345678",
      displayName: "SOP",
      adapterType: "notion",
      externalRootId: "root",
      rootUrl: "https://example.test",
      enabled: true
    });
    const confirmationStore = new InMemoryConfirmationStore({ idFactory: () => "CONFIRM" });
    const registry = createAdminActionRegistry({
      accessStore: new InMemoryAccessStore(),
      registrationInviteCodeStore: new InMemoryRegistrationInviteCodeStore(),
      registrationInviteCodeTtlMinutes: 60,
      confirmationStore,
      knowledgeStore: store
    });

    const preview = await registry.execute({
      action: "knowledge_source_remove",
      profile,
      event,
      arguments: { sourceKey: "sop-12345678" }
    });
    expect(preview.replyText).toContain("/confirm CONFIRM");
    const committed = await registry.confirm({ code: "CONFIRM", profile, event });

    expect(committed.replyText).toContain("已永久移除");
    await expect(
      store.listSources({ profileName: "helper", includeDisabled: true })
    ).resolves.toEqual([]);
  });
});
