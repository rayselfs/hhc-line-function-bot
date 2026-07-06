export type AccessPrincipalType = "admin" | "user" | "group";

export type AccessRequestStatus = "pending" | "approved" | "denied";

export interface AccessPrincipal {
  id: string;
  profileName: string;
  type: AccessPrincipalType;
  principalId: string;
  displayName?: string;
  createdAt: string;
  createdBy: string;
  disabledAt?: string;
  disabledBy?: string;
}

export interface AccessInviteCode {
  id: string;
  profileName: string;
  codeHash: string;
  maxUses?: number;
  usedCount: number;
  expiresAt?: string;
  createdAt: string;
  createdBy: string;
  disabledAt?: string;
}

export interface AccessRequest {
  id: string;
  profileName: string;
  sourceType: "user" | "group";
  sourceId: string;
  displayName?: string;
  requestedBy: string;
  status: AccessRequestStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface AccessAuditEvent {
  id: string;
  profileName: string;
  actorUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AddPrincipalInput {
  profileName: string;
  type: AccessPrincipalType;
  principalId: string;
  displayName?: string;
  createdBy: string;
}

export interface CreateInviteCodeInput {
  profileName: string;
  codeHash: string;
  maxUses?: number;
  expiresAt?: string;
  createdBy: string;
}

export interface DisableInviteCodeInput {
  profileName: string;
  inviteCodeId: string;
  disabledBy: string;
}

export interface DisablePrincipalInput {
  profileName: string;
  type: AccessPrincipalType;
  principalId: string;
  disabledBy: string;
}

export interface CreateAccessRequestInput {
  profileName: string;
  sourceType: "user" | "group";
  sourceId: string;
  displayName?: string;
  requestedBy: string;
}

export interface ApproveAccessRequestInput {
  profileName: string;
  requestId: string;
  approvedBy: string;
}

export interface DenyAccessRequestInput {
  profileName: string;
  requestId: string;
  deniedBy: string;
}

export interface AccessAuditInput {
  profileName: string;
  actorUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export interface AccessStore {
  hasActivePrincipal(
    profileName: string,
    type: AccessPrincipalType,
    principalId: string
  ): Promise<boolean>;
  listPrincipals(profileName: string): Promise<AccessPrincipal[]>;
  addPrincipal(input: AddPrincipalInput): Promise<AccessPrincipal>;
  disablePrincipal(input: DisablePrincipalInput): Promise<boolean>;
  createInviteCode(input: CreateInviteCodeInput): Promise<AccessInviteCode>;
  listInviteCodes(profileName: string): Promise<AccessInviteCode[]>;
  disableInviteCode(input: DisableInviteCodeInput): Promise<boolean>;
  findInviteCode(
    profileName: string,
    codeHash: string,
    now: Date
  ): Promise<AccessInviteCode | undefined>;
  incrementInviteCodeUse(inviteCodeId: string): Promise<void>;
  createAccessRequest(
    input: CreateAccessRequestInput
  ): Promise<{ request: AccessRequest; created: boolean }>;
  listPendingRequests(profileName: string): Promise<AccessRequest[]>;
  getAccessRequest(profileName: string, requestId: string): Promise<AccessRequest | undefined>;
  approveAccessRequest(input: ApproveAccessRequestInput): Promise<AccessRequest | undefined>;
  denyAccessRequest(input: DenyAccessRequestInput): Promise<AccessRequest | undefined>;
  countPendingRequests(profileName: string): Promise<number>;
  recordAudit(input: AccessAuditInput): Promise<void>;
  listAuditEvents(profileName: string, limit: number): Promise<AccessAuditEvent[]>;
}
