export interface KnowledgeQueryable {
  query(sql: string, values?: unknown[]): Promise<unknown>;
}

const migrations = [
  `
  create table if not exists knowledge_sources (
    id uuid primary key,
    profile_name text not null,
    source_key text not null,
    display_name text not null,
    adapter_type text not null,
    external_root_id text not null,
    root_url text not null,
    enabled boolean not null default true,
    expires_at timestamptz,
    disabled_at timestamptz,
    purge_after timestamptz,
    last_synced_at timestamptz,
    sync_status text not null default 'pending',
    sync_error_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (profile_name, source_key)
  )
  `,
  `
  create table if not exists knowledge_documents (
    id uuid primary key,
    source_id uuid not null references knowledge_sources(id) on delete cascade,
    external_id text not null,
    title text not null,
    url text not null,
    properties jsonb not null default '{}'::jsonb,
    external_updated_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source_id, external_id)
  )
  `,
  `
  create table if not exists knowledge_nodes (
    id uuid primary key,
    document_id uuid not null references knowledge_documents(id) on delete cascade,
    external_id text not null,
    parent_external_id text,
    node_type text not null,
    ordinal integer not null,
    text_content text not null,
    metadata jsonb not null default '{}'::jsonb,
    unique (document_id, external_id)
  )
  `,
  `
  create table if not exists knowledge_chunks (
    id uuid primary key,
    document_id uuid not null references knowledge_documents(id) on delete cascade,
    heading_path text[] not null default '{}',
    ordinal integer not null,
    content text not null,
    content_hash text not null,
    metadata jsonb not null default '{}'::jsonb,
    search_vector tsvector generated always as (to_tsvector('simple', content)) stored,
    active boolean not null default true,
    unique (document_id, content_hash)
  )
  `,
  `
  create table if not exists knowledge_embeddings (
    chunk_id uuid not null references knowledge_chunks(id) on delete cascade,
    provider text not null,
    model text not null,
    dimensions integer not null check (dimensions = 1024),
    embedding vector(1024) not null,
    content_hash text not null,
    embedded_at timestamptz not null default now(),
    primary key (chunk_id, provider, model)
  )
  `,
  `create index if not exists knowledge_sources_active_idx on knowledge_sources (profile_name, source_key) where enabled = true`,
  `create index if not exists knowledge_chunks_search_idx on knowledge_chunks using gin (search_vector) where active = true`,
  `create index if not exists knowledge_embeddings_cosine_idx on knowledge_embeddings using hnsw (embedding vector_cosine_ops)`
];

export async function runKnowledgeMigrations(db: KnowledgeQueryable): Promise<void> {
  for (const migration of migrations) {
    await db.query(migration);
  }
}

export async function verifyPgvector(db: KnowledgeQueryable): Promise<void> {
  const result = (await db.query(
    "select extversion from pg_extension where extname = 'vector'"
  )) as { rows?: unknown[] };
  if (!result.rows?.length) {
    throw new Error("pgvector_extension_missing");
  }
}
