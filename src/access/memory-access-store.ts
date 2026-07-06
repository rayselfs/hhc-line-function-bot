import { randomUUID } from "node:crypto";

import type {
  AccessAuditInput,
  AccessAuditEvent,
  AccessInviteCode,
  AccessPrincipal,
  AccessPrincipalType,
  AccessRequest,
  AccessStore,
  AddPrincipalInput,
  ApproveAccessRequestInput,
  CreateInviteCodeInput,
  CreateAccessRequestInput,
  DenyAccessRequestInput,
  DisableInviteCodeInput,
  DisablePrincipalInput
} from "./types.js";

export interface InMemoryAccessStoreOptions {
  principals?: AccessPrincipal[];
  inviteCodes?: AccessInviteCode[];
  requests?: AccessRequest[];
}

export class InMemoryAccessStore implements AccessStore {
  private readonly principals = new Map<string, AccessPrincipal>();
  private readonly inviteCodes = new Map<string, AccessInviteCode>();
  private readonly requests = new Map<string, AccessRequest>();
  readonly audit: AccessAuditEvent[] = [];

  constructor(options: InMemoryAccessStoreOptions = {}) {
    for (const principal of options.principals ?? []) {
      this.principals.set(principal.id, { ...principal });
    }
    for (const inviteCode of options.inviteCodes ?? []) {
      this.inviteCodes.set(inviteCode.id, { ...inviteCode });
    }
    for (const request of options.requests ?? []) {
      this.requests.set(request.id, { ...request });
    }
  }

  async hasActivePrincipal(
    profileName: string,
    type: AccessPrincipalType,
    principalId: string
  ): Promise<boolean> {
    return Array.from(this.principals.values()).some(
      (principal) =>
        principal.profileName === profileName &&
        principal.type === type &&
        principal.principalId === principalId &&
        !principal.disabledAt
    );
  }

  async listPrincipals(profileName: string): Promise<AccessPrincipal[]> {
    return Array.from(this.principals.values())
      .filter((principal) => principal.profileName === profileName && !principal.disabledAt)
      .sort((a, b) => a.type.localeCompare(b.type) || a.principalId.localeCompare(b.principalId))
      .map((principal) => ({ ...principal }));
  }

  async addPrincipal(input: AddPrincipalInput): Promise<AccessPrincipal> {
    const existing = Array.from(this.principals.values()).find(
      (principal) =>
        principal.profileName === input.profileName &&
        principal.type === input.type &&
        principal.principalId === input.principalId
    );
    if (existing) {
      const enabled = {
        ...existing,
        displayName: input.displayName ?? existing.displayName,
        disabledAt: undefined,
        disabledBy: undefined
      };
      this.principals.set(existing.id, enabled);
      return { ...enabled };
    }

    const principal: AccessPrincipal = {
      id: randomUUID(),
      profileName: input.profileName,
      type: input.type,
      principalId: input.principalId,
      displayName: input.displayName,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy
    };
    this.principals.set(principal.id, principal);
    return { ...principal };
  }

  async disablePrincipal(input: DisablePrincipalInput): Promise<boolean> {
    const existing = Array.from(this.principals.values()).find(
      (principal) =>
        principal.profileName === input.profileName &&
        principal.type === input.type &&
        principal.principalId === input.principalId &&
        !principal.disabledAt
    );
    if (!existing) {
      return false;
    }
    this.principals.set(existing.id, {
      ...existing,
      disabledAt: new Date().toISOString(),
      disabledBy: input.disabledBy
    });
    return true;
  }

  async createInviteCode(input: CreateInviteCodeInput): Promise<AccessInviteCode> {
    const inviteCode: AccessInviteCode = {
      id: randomUUID(),
      profileName: input.profileName,
      codeHash: input.codeHash,
      maxUses: input.maxUses,
      usedCount: 0,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy
    };
    this.inviteCodes.set(inviteCode.id, inviteCode);
    return { ...inviteCode };
  }

  async listInviteCodes(profileName: string): Promise<AccessInviteCode[]> {
    return Array.from(this.inviteCodes.values())
      .filter((code) => code.profileName === profileName && !code.disabledAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((code) => ({ ...code }));
  }

  async disableInviteCode(input: DisableInviteCodeInput): Promise<boolean> {
    const inviteCode = this.inviteCodes.get(input.inviteCodeId);
    if (!inviteCode || inviteCode.profileName !== input.profileName || inviteCode.disabledAt) {
      return false;
    }
    this.inviteCodes.set(inviteCode.id, {
      ...inviteCode,
      disabledAt: new Date().toISOString()
    });
    return true;
  }

  async findInviteCode(
    profileName: string,
    codeHash: string,
    now: Date
  ): Promise<AccessInviteCode | undefined> {
    const found = Array.from(this.inviteCodes.values()).find(
      (code) =>
        code.profileName === profileName &&
        code.codeHash === codeHash &&
        !code.disabledAt &&
        (!code.expiresAt || new Date(code.expiresAt).getTime() > now.getTime()) &&
        (code.maxUses === undefined || code.usedCount < code.maxUses)
    );
    return found ? { ...found } : undefined;
  }

  async incrementInviteCodeUse(inviteCodeId: string): Promise<void> {
    const inviteCode = this.inviteCodes.get(inviteCodeId);
    if (!inviteCode) {
      return;
    }
    this.inviteCodes.set(inviteCodeId, {
      ...inviteCode,
      usedCount: inviteCode.usedCount + 1
    });
  }

  async createAccessRequest(
    input: CreateAccessRequestInput
  ): Promise<{ request: AccessRequest; created: boolean }> {
    const existing = Array.from(this.requests.values()).find(
      (request) =>
        request.profileName === input.profileName &&
        request.sourceType === input.sourceType &&
        request.sourceId === input.sourceId &&
        request.status === "pending"
    );
    if (existing) {
      return { request: { ...existing }, created: false };
    }

    const request: AccessRequest = {
      id: randomUUID(),
      profileName: input.profileName,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      displayName: input.displayName,
      requestedBy: input.requestedBy,
      status: "pending",
      createdAt: new Date().toISOString()
    };
    this.requests.set(request.id, request);
    return { request: { ...request }, created: true };
  }

  async listPendingRequests(profileName: string): Promise<AccessRequest[]> {
    return Array.from(this.requests.values())
      .filter((request) => request.profileName === profileName && request.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((request) => ({ ...request }));
  }

  async getAccessRequest(
    profileName: string,
    requestId: string
  ): Promise<AccessRequest | undefined> {
    const request = this.requests.get(requestId);
    if (!request || request.profileName !== profileName) {
      return undefined;
    }
    return { ...request };
  }

  async approveAccessRequest(input: ApproveAccessRequestInput): Promise<AccessRequest | undefined> {
    const request = this.requests.get(input.requestId);
    if (!request || request.profileName !== input.profileName || request.status !== "pending") {
      return undefined;
    }
    const approved: AccessRequest = {
      ...request,
      status: "approved",
      decidedAt: new Date().toISOString(),
      decidedBy: input.approvedBy
    };
    this.requests.set(approved.id, approved);
    await this.addPrincipal({
      profileName: request.profileName,
      type: request.sourceType,
      principalId: request.sourceId,
      displayName: request.displayName,
      createdBy: input.approvedBy
    });
    return { ...approved };
  }

  async denyAccessRequest(input: DenyAccessRequestInput): Promise<AccessRequest | undefined> {
    const request = this.requests.get(input.requestId);
    if (!request || request.profileName !== input.profileName || request.status !== "pending") {
      return undefined;
    }
    const denied: AccessRequest = {
      ...request,
      status: "denied",
      decidedAt: new Date().toISOString(),
      decidedBy: input.deniedBy
    };
    this.requests.set(denied.id, denied);
    return { ...denied };
  }

  async countPendingRequests(profileName: string): Promise<number> {
    return Array.from(this.requests.values()).filter(
      (request) => request.profileName === profileName && request.status === "pending"
    ).length;
  }

  async recordAudit(input: AccessAuditInput): Promise<void> {
    this.audit.unshift({
      id: randomUUID(),
      profileName: input.profileName,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
      createdAt: new Date().toISOString()
    });
  }

  async listAuditEvents(profileName: string, limit: number): Promise<AccessAuditEvent[]> {
    return this.audit
      .filter((event) => event.profileName === profileName)
      .slice(0, limit)
      .map((event) => ({ ...event }));
  }
}
