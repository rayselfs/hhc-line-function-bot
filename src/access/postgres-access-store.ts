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
  CreateAccessRequestInput,
  CreateInviteCodeInput,
  DenyAccessRequestInput,
  DisableInviteCodeInput,
  DisablePrincipalInput
} from "./types.js";

export interface PgQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[] }>;
}

export class PostgresAccessStore implements AccessStore {
  constructor(private readonly db: PgQueryable) {}

  async hasActivePrincipal(
    profileName: string,
    type: AccessPrincipalType,
    principalId: string
  ): Promise<boolean> {
    const result = await this.db.query(
      `
      select 1
      from access_principals
      where profile_name = $1
        and principal_type = $2
        and principal_id = $3
        and disabled_at is null
      limit 1
      `,
      [profileName, type, principalId]
    );
    return result.rows.length > 0;
  }

  async listPrincipals(profileName: string): Promise<AccessPrincipal[]> {
    const result = await this.db.query(
      `
      select *
      from access_principals
      where profile_name = $1
        and disabled_at is null
      order by principal_type, principal_id
      `,
      [profileName]
    );
    return result.rows.map(mapPrincipal);
  }

  async addPrincipal(input: AddPrincipalInput): Promise<AccessPrincipal> {
    const id = randomUUID();
    const result = await this.db.query(
      `
      insert into access_principals
        (id, profile_name, principal_type, principal_id, display_name, created_by)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (profile_name, principal_type, principal_id)
      do update set
        display_name = coalesce(excluded.display_name, access_principals.display_name),
        disabled_at = null,
        disabled_by = null
      returning *
      `,
      [
        id,
        input.profileName,
        input.type,
        input.principalId,
        input.displayName ?? null,
        input.createdBy
      ]
    );
    return mapPrincipal(result.rows[0]);
  }

  async disablePrincipal(input: DisablePrincipalInput): Promise<boolean> {
    const result = await this.db.query(
      `
      update access_principals
      set disabled_at = now(), disabled_by = $4
      where profile_name = $1
        and principal_type = $2
        and principal_id = $3
        and disabled_at is null
      returning id
      `,
      [input.profileName, input.type, input.principalId, input.disabledBy]
    );
    return result.rows.length > 0;
  }

  async createInviteCode(input: CreateInviteCodeInput): Promise<AccessInviteCode> {
    const result = await this.db.query(
      `
      insert into access_invite_codes
        (id, profile_name, code_hash, max_uses, expires_at, created_by)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (profile_name, code_hash)
      do update set
        max_uses = excluded.max_uses,
        expires_at = excluded.expires_at,
        disabled_at = null
      returning *
      `,
      [
        randomUUID(),
        input.profileName,
        input.codeHash,
        input.maxUses ?? null,
        input.expiresAt ?? null,
        input.createdBy
      ]
    );
    return mapInviteCode(result.rows[0]);
  }

  async listInviteCodes(profileName: string): Promise<AccessInviteCode[]> {
    const result = await this.db.query(
      `
      select *
      from access_invite_codes
      where profile_name = $1
        and disabled_at is null
      order by created_at desc
      `,
      [profileName]
    );
    return result.rows.map(mapInviteCode);
  }

  async disableInviteCode(input: DisableInviteCodeInput): Promise<boolean> {
    const result = await this.db.query(
      `
      update access_invite_codes
      set disabled_at = now()
      where profile_name = $1
        and id = $2
        and disabled_at is null
      returning id
      `,
      [input.profileName, input.inviteCodeId]
    );
    return result.rows.length > 0;
  }

  async findInviteCode(
    profileName: string,
    codeHash: string,
    now: Date
  ): Promise<AccessInviteCode | undefined> {
    const result = await this.db.query(
      `
      select *
      from access_invite_codes
      where profile_name = $1
        and code_hash = $2
        and disabled_at is null
        and (expires_at is null or expires_at > $3)
        and (max_uses is null or used_count < max_uses)
      limit 1
      `,
      [profileName, codeHash, now.toISOString()]
    );
    return result.rows[0] ? mapInviteCode(result.rows[0]) : undefined;
  }

  async incrementInviteCodeUse(inviteCodeId: string): Promise<void> {
    await this.db.query(
      `
      update access_invite_codes
      set used_count = used_count + 1
      where id = $1
      `,
      [inviteCodeId]
    );
  }

  async createAccessRequest(
    input: CreateAccessRequestInput
  ): Promise<{ request: AccessRequest; created: boolean }> {
    const existing = await this.db.query(
      `
      select *
      from access_requests
      where profile_name = $1
        and source_type = $2
        and source_id = $3
        and status = 'pending'
      limit 1
      `,
      [input.profileName, input.sourceType, input.sourceId]
    );
    if (existing.rows[0]) {
      return { request: mapRequest(existing.rows[0]), created: false };
    }

    const result = await this.db.query(
      `
      insert into access_requests
        (id, profile_name, source_type, source_id, display_name, requested_by, status)
      values ($1, $2, $3, $4, $5, $6, 'pending')
      returning *
      `,
      [
        randomUUID(),
        input.profileName,
        input.sourceType,
        input.sourceId,
        input.displayName ?? null,
        input.requestedBy
      ]
    );
    return { request: mapRequest(result.rows[0]), created: true };
  }

  async listPendingRequests(profileName: string): Promise<AccessRequest[]> {
    const result = await this.db.query(
      `
      select *
      from access_requests
      where profile_name = $1
        and status = 'pending'
      order by created_at
      `,
      [profileName]
    );
    return result.rows.map(mapRequest);
  }

  async getAccessRequest(
    profileName: string,
    requestId: string
  ): Promise<AccessRequest | undefined> {
    const result = await this.db.query(
      `
      select *
      from access_requests
      where profile_name = $1
        and id = $2
      limit 1
      `,
      [profileName, requestId]
    );
    return result.rows[0] ? mapRequest(result.rows[0]) : undefined;
  }

  async approveAccessRequest(input: ApproveAccessRequestInput): Promise<AccessRequest | undefined> {
    const request = await this.getAccessRequest(input.profileName, input.requestId);
    if (!request || request.status !== "pending") {
      return undefined;
    }
    const result = await this.db.query(
      `
      update access_requests
      set status = 'approved', decided_at = now(), decided_by = $3
      where profile_name = $1
        and id = $2
        and status = 'pending'
      returning *
      `,
      [input.profileName, input.requestId, input.approvedBy]
    );
    if (!result.rows[0]) {
      return undefined;
    }
    await this.addPrincipal({
      profileName: request.profileName,
      type: request.sourceType,
      principalId: request.sourceId,
      displayName: request.displayName,
      createdBy: input.approvedBy
    });
    return mapRequest(result.rows[0]);
  }

  async denyAccessRequest(input: DenyAccessRequestInput): Promise<AccessRequest | undefined> {
    const result = await this.db.query(
      `
      update access_requests
      set status = 'denied', decided_at = now(), decided_by = $3
      where profile_name = $1
        and id = $2
        and status = 'pending'
      returning *
      `,
      [input.profileName, input.requestId, input.deniedBy]
    );
    return result.rows[0] ? mapRequest(result.rows[0]) : undefined;
  }

  async countPendingRequests(profileName: string): Promise<number> {
    const result = await this.db.query(
      `
      select count(*)::int as count
      from access_requests
      where profile_name = $1
        and status = 'pending'
      `,
      [profileName]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async recordAudit(input: AccessAuditInput): Promise<void> {
    await this.db.query(
      `
      insert into access_audit_events
        (id, profile_name, actor_user_id, action, target_type, target_id, metadata)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        randomUUID(),
        input.profileName,
        input.actorUserId,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  }

  async listAuditEvents(profileName: string, limit: number): Promise<AccessAuditEvent[]> {
    const result = await this.db.query(
      `
      select *
      from access_audit_events
      where profile_name = $1
      order by created_at desc
      limit $2
      `,
      [profileName, limit]
    );
    return result.rows.map(mapAuditEvent);
  }
}

function mapPrincipal(row: Record<string, unknown>): AccessPrincipal {
  return {
    id: String(row.id),
    profileName: String(row.profile_name),
    type: row.principal_type as AccessPrincipalType,
    principalId: String(row.principal_id),
    displayName: optionalString(row.display_name),
    createdAt: toIso(row.created_at),
    createdBy: String(row.created_by),
    disabledAt: optionalIso(row.disabled_at),
    disabledBy: optionalString(row.disabled_by)
  };
}

function mapInviteCode(row: Record<string, unknown>): AccessInviteCode {
  return {
    id: String(row.id),
    profileName: String(row.profile_name),
    codeHash: String(row.code_hash),
    maxUses: optionalNumber(row.max_uses),
    usedCount: Number(row.used_count ?? 0),
    expiresAt: optionalIso(row.expires_at),
    createdAt: toIso(row.created_at),
    createdBy: String(row.created_by),
    disabledAt: optionalIso(row.disabled_at)
  };
}

function mapRequest(row: Record<string, unknown>): AccessRequest {
  return {
    id: String(row.id),
    profileName: String(row.profile_name),
    sourceType: row.source_type as AccessRequest["sourceType"],
    sourceId: String(row.source_id),
    displayName: optionalString(row.display_name),
    requestedBy: String(row.requested_by),
    status: row.status as AccessRequest["status"],
    createdAt: toIso(row.created_at),
    decidedAt: optionalIso(row.decided_at),
    decidedBy: optionalString(row.decided_by)
  };
}

function mapAuditEvent(row: Record<string, unknown>): AccessAuditEvent {
  return {
    id: String(row.id),
    profileName: String(row.profile_name),
    actorUserId: String(row.actor_user_id),
    action: String(row.action),
    targetType: optionalString(row.target_type),
    targetId: optionalString(row.target_id),
    metadata: jsonRecord(row.metadata),
    createdAt: toIso(row.created_at)
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function optionalIso(value: unknown): string | undefined {
  return value ? toIso(value) : undefined;
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}
