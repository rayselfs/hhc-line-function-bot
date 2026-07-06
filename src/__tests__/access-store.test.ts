import { describe, expect, it } from "vitest";

import { hashInviteCode } from "../access/invite-code.js";
import { InMemoryAccessStore } from "../access/memory-access-store.js";

describe("access store", () => {
  it("tracks profile-scoped active principals", async () => {
    const store = new InMemoryAccessStore();

    await store.addPrincipal({
      profileName: "helper",
      type: "user",
      principalId: "U1",
      createdBy: "Uadmin"
    });

    await expect(store.hasActivePrincipal("helper", "user", "U1")).resolves.toBe(true);
    await expect(store.hasActivePrincipal("main", "user", "U1")).resolves.toBe(false);
  });

  it("creates one pending registration request per user and profile", async () => {
    const store = new InMemoryAccessStore();

    const first = await store.createAccessRequest({
      profileName: "helper",
      sourceType: "user",
      sourceId: "U1",
      displayName: "Ray",
      requestedBy: "U1"
    });
    const second = await store.createAccessRequest({
      profileName: "helper",
      sourceType: "user",
      sourceId: "U1",
      displayName: "Ray",
      requestedBy: "U1"
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.request.id).toBe(first.request.id);
    await expect(store.countPendingRequests("helper")).resolves.toBe(1);
  });

  it("validates invite code hashes, expiration, and max uses", async () => {
    const secret = "invite-secret";
    const store = new InMemoryAccessStore({
      inviteCodes: [
        {
          id: "code-1",
          profileName: "helper",
          codeHash: hashInviteCode("HHCTEST", secret),
          maxUses: 1,
          usedCount: 0,
          expiresAt: "2099-01-01T00:00:00.000Z",
          createdAt: "2026-07-06T00:00:00.000Z",
          createdBy: "Uadmin",
          disabledAt: undefined
        }
      ]
    });

    await expect(
      store.findInviteCode("helper", hashInviteCode(" hhctest ", secret), new Date("2026-07-06"))
    ).resolves.toMatchObject({ id: "code-1" });

    await store.incrementInviteCodeUse("code-1");

    await expect(
      store.findInviteCode("helper", hashInviteCode("HHCTEST", secret), new Date("2026-07-06"))
    ).resolves.toBeUndefined();
  });

  it("creates, lists, and disables invite codes", async () => {
    const secret = "invite-secret";
    const store = new InMemoryAccessStore();
    const created = await store.createInviteCode({
      profileName: "helper",
      codeHash: hashInviteCode("JOINME", secret),
      maxUses: 2,
      expiresAt: "2099-01-01T00:00:00.000Z",
      createdBy: "Uadmin"
    });

    await expect(store.listInviteCodes("helper")).resolves.toMatchObject([
      { id: created.id, maxUses: 2, usedCount: 0 }
    ]);

    await expect(
      store.findInviteCode("helper", hashInviteCode("JOINME", secret), new Date("2026-07-06"))
    ).resolves.toMatchObject({ id: created.id });

    await expect(
      store.disableInviteCode({
        profileName: "helper",
        inviteCodeId: created.id,
        disabledBy: "Uadmin"
      })
    ).resolves.toBe(true);
    await expect(
      store.findInviteCode("helper", hashInviteCode("JOINME", secret), new Date("2026-07-06"))
    ).resolves.toBeUndefined();
  });

  it("approves pending requests into active users", async () => {
    const store = new InMemoryAccessStore();
    const { request } = await store.createAccessRequest({
      profileName: "helper",
      sourceType: "user",
      sourceId: "U1",
      displayName: "Ray",
      requestedBy: "U1"
    });

    const approved = await store.approveAccessRequest({
      profileName: "helper",
      requestId: request.id,
      approvedBy: "Uadmin"
    });

    expect(approved).toMatchObject({ id: request.id, status: "approved" });
    await expect(store.hasActivePrincipal("helper", "user", "U1")).resolves.toBe(true);
    await expect(store.countPendingRequests("helper")).resolves.toBe(0);
  });
});
