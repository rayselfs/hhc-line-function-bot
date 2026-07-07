export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<unknown>;
}

const migrations = [
  `
  create table if not exists agent_resources (
    id uuid primary key,
    profile_name text not null,
    scope_type text not null check (scope_type in ('user', 'group', 'room')),
    scope_id text not null,
    resource_type text not null check (resource_type in ('ppt_slide', 'sheet_music')),
    title text not null,
    query_text text,
    storage_provider text not null check (storage_provider in ('graph')),
    drive_id text not null,
    item_id text not null,
    created_by text,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    deleted_at timestamptz
  )
  `,
  `
  create index if not exists agent_resources_lookup_idx
  on agent_resources (profile_name, scope_type, scope_id, resource_type, created_at desc)
  where deleted_at is null
  `,
  `
  create table if not exists agent_resource_aliases (
    id uuid primary key,
    profile_name text not null,
    scope_type text not null check (scope_type in ('user', 'group', 'room')),
    scope_id text not null,
    alias text not null,
    normalized_alias text not null,
    resource_id uuid not null references agent_resources(id) on delete cascade,
    created_by text,
    created_at timestamptz not null default now()
  )
  `,
  `
  create index if not exists agent_resource_aliases_lookup_idx
  on agent_resource_aliases (profile_name, scope_type, scope_id, normalized_alias, created_at desc)
  `,
  `
  create table if not exists agent_text_memories (
    id uuid primary key,
    profile_name text not null,
    scope_type text not null check (scope_type in ('user', 'group', 'room')),
    scope_id text not null,
    title text,
    content text not null,
    query_text text,
    created_by text,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    deleted_at timestamptz
  )
  `,
  `
  create index if not exists agent_text_memories_lookup_idx
  on agent_text_memories (profile_name, scope_type, scope_id, created_at desc)
  where deleted_at is null
  `
];

export async function runAgentMemoryMigrations(db: Queryable): Promise<void> {
  for (const migration of migrations) {
    await db.query(migration);
  }
}
