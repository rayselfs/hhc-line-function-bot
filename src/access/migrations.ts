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
  `,
  `
  create table if not exists access_group_function_grants (
    id uuid primary key,
    profile_name text not null,
    group_id text not null,
    function_name text not null,
    created_at timestamptz not null default now(),
    created_by text not null,
    disabled_at timestamptz,
    disabled_by text,
    unique (profile_name, group_id, function_name)
  )
  `,
  `
  create table if not exists access_user_function_grants (
    id uuid primary key,
    profile_name text not null,
    user_id text not null,
    function_name text not null,
    created_at timestamptz not null default now(),
    created_by text not null,
    disabled_at timestamptz,
    disabled_by text,
    unique (profile_name, user_id, function_name)
  )
  `,
  `
  create table if not exists access_roles (
    id uuid primary key,
    profile_name text not null,
    role_key text not null,
    display_name text not null,
    created_at timestamptz not null default now(),
    unique (profile_name, role_key),
    unique (id, profile_name)
  )
  `,
  `
  create table if not exists access_role_capability_bindings (
    role_id uuid not null references access_roles(id) on delete cascade,
    capability text not null,
    created_at timestamptz not null default now(),
    primary key (role_id, capability)
  )
  `,
  `
  create table if not exists access_principal_role_bindings (
    id uuid primary key,
    profile_name text not null,
    principal_type text not null check (principal_type in ('user', 'group')),
    principal_id text not null,
    role_id uuid not null,
    created_at timestamptz not null default now(),
    unique (profile_name, principal_type, principal_id, role_id),
    foreign key (role_id, profile_name) references access_roles(id, profile_name) on delete cascade
  )
  `
];

export async function runAccessMigrations(db: Queryable): Promise<void> {
  for (const migration of migrations) {
    await db.query(migration);
  }
}
