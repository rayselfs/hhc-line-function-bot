export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<unknown>;
}

const migrations = [
  `
  create table if not exists access_principals (
    id uuid primary key,
    profile_name text not null,
    principal_type text not null check (principal_type in ('admin', 'user', 'group')),
    principal_id text not null,
    display_name text,
    created_at timestamptz not null default now(),
    created_by text not null,
    disabled_at timestamptz,
    disabled_by text,
    unique (profile_name, principal_type, principal_id)
  )
  `,
  `
  create table if not exists access_invite_codes (
    id uuid primary key,
    profile_name text not null,
    code_hash text not null,
    max_uses integer,
    used_count integer not null default 0,
    expires_at timestamptz,
    created_at timestamptz not null default now(),
    created_by text not null,
    disabled_at timestamptz,
    unique (profile_name, code_hash)
  )
  `,
  `
  create table if not exists access_requests (
    id uuid primary key,
    profile_name text not null,
    source_type text not null check (source_type in ('user', 'group')),
    source_id text not null,
    display_name text,
    requested_by text not null,
    status text not null check (status in ('pending', 'approved', 'denied')),
    created_at timestamptz not null default now(),
    decided_at timestamptz,
    decided_by text
  )
  `,
  `
  create unique index if not exists access_requests_one_pending
  on access_requests (profile_name, source_type, source_id)
  where status = 'pending'
  `,
  `
  create table if not exists access_audit_events (
    id uuid primary key,
    profile_name text not null,
    actor_user_id text not null,
    action text not null,
    target_type text,
    target_id text,
    metadata jsonb,
    created_at timestamptz not null default now()
  )
  `
];

export async function runAccessMigrations(db: Queryable): Promise<void> {
  for (const migration of migrations) {
    await db.query(migration);
  }
}
