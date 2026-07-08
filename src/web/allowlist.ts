import { randomUUID } from "node:crypto";
import { domainToASCII } from "node:url";

export interface WebAllowlistEntry {
  id: string;
  profileName: string;
  domain: string;
  pathPrefix?: string;
  label?: string;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AddWebAllowlistEntryInput {
  profileName: string;
  domain: string;
  pathPrefix?: string;
  label?: string;
  createdBy: string;
}

export interface WebAllowlistDecision {
  allowed: boolean;
  reason: string;
  entry?: WebAllowlistEntry;
}

export interface WebAllowlistStore {
  list(profileName: string): Promise<WebAllowlistEntry[]>;
  add(input: AddWebAllowlistEntryInput): Promise<WebAllowlistEntry>;
  setEnabled(profileName: string, id: string, enabled: boolean): Promise<boolean>;
  remove(profileName: string, id: string): Promise<boolean>;
}

export interface PgQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[] }>;
}

export class InMemoryWebAllowlistStore implements WebAllowlistStore {
  private readonly entries = new Map<string, WebAllowlistEntry>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async list(profileName: string): Promise<WebAllowlistEntry[]> {
    return Array.from(this.entries.values())
      .filter((entry) => entry.profileName === profileName)
      .sort((left, right) => left.domain.localeCompare(right.domain));
  }

  async add(input: AddWebAllowlistEntryInput): Promise<WebAllowlistEntry> {
    const now = this.now().toISOString();
    const entry: WebAllowlistEntry = {
      id: randomUUID(),
      profileName: input.profileName,
      domain: normalizeDomain(input.domain),
      pathPrefix: normalizePathPrefix(input.pathPrefix),
      label: input.label,
      enabled: true,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now
    };
    this.entries.set(entry.id, entry);
    return { ...entry };
  }

  async setEnabled(profileName: string, id: string, enabled: boolean): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry || entry.profileName !== profileName) {
      return false;
    }
    this.entries.set(id, { ...entry, enabled, updatedAt: this.now().toISOString() });
    return true;
  }

  async remove(profileName: string, id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry || entry.profileName !== profileName) {
      return false;
    }
    return this.entries.delete(id);
  }
}

export class PostgresWebAllowlistStore implements WebAllowlistStore {
  constructor(private readonly db: PgQueryable) {}

  async list(profileName: string): Promise<WebAllowlistEntry[]> {
    const result = await this.db.query(
      `
      select *
      from web_allowlist_entries
      where profile_name = $1
        and deleted_at is null
      order by domain, coalesce(path_prefix, '')
      `,
      [profileName]
    );
    return result.rows.map(mapEntry);
  }

  async add(input: AddWebAllowlistEntryInput): Promise<WebAllowlistEntry> {
    const result = await this.db.query(
      `
      insert into web_allowlist_entries
        (id, profile_name, domain, path_prefix, label, enabled, created_by)
      values ($1, $2, $3, $4, $5, true, $6)
      returning *
      `,
      [
        randomUUID(),
        input.profileName,
        normalizeDomain(input.domain),
        normalizePathPrefix(input.pathPrefix) ?? null,
        input.label ?? null,
        input.createdBy
      ]
    );
    return mapEntry(result.rows[0]);
  }

  async setEnabled(profileName: string, id: string, enabled: boolean): Promise<boolean> {
    const result = await this.db.query(
      `
      update web_allowlist_entries
      set enabled = $3, updated_at = now()
      where profile_name = $1
        and id = $2
        and deleted_at is null
      returning id
      `,
      [profileName, id, enabled]
    );
    return result.rows.length > 0;
  }

  async remove(profileName: string, id: string): Promise<boolean> {
    const result = await this.db.query(
      `
      update web_allowlist_entries
      set deleted_at = now(), updated_at = now()
      where profile_name = $1
        and id = $2
        and deleted_at is null
      returning id
      `,
      [profileName, id]
    );
    return result.rows.length > 0;
  }
}

export async function runWebAllowlistMigrations(db: PgQueryable): Promise<void> {
  const migrations = [
    `
    create table if not exists web_allowlist_entries (
      id uuid primary key,
      profile_name text not null,
      domain text not null,
      path_prefix text,
      label text,
      enabled boolean not null default true,
      created_by text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    )
    `,
    `
    create index if not exists web_allowlist_entries_profile_idx
    on web_allowlist_entries (profile_name, domain, path_prefix)
    where deleted_at is null
    `
  ];
  for (const migration of migrations) {
    await db.query(migration);
  }
}

export async function isUrlAllowedByWebAllowlist(
  store: WebAllowlistStore,
  profileName: string,
  rawUrl: string
): Promise<WebAllowlistDecision> {
  const parsed = parseHttpsUrl(rawUrl);
  if (!parsed.ok) {
    return { allowed: false, reason: parsed.reason };
  }
  const host = normalizeDomain(parsed.url.hostname);
  if (isPrivateTarget(host)) {
    return { allowed: false, reason: "private_target_denied" };
  }
  const entries = await store.list(profileName);
  const match = entries.find(
    (entry) =>
      entry.enabled &&
      entry.domain === host &&
      (!entry.pathPrefix || parsed.url.pathname.startsWith(entry.pathPrefix))
  );
  return match
    ? { allowed: true, reason: "allowed", entry: match }
    : { allowed: false, reason: "domain_not_allowed" };
}

export function normalizeDomain(value: string): string {
  const trimmed =
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//u, "")
      .split("/")[0] ?? "";
  return domainToASCII(trimmed);
}

function normalizePathPrefix(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function parseHttpsUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "https_required" };
  }
  return { ok: true, url };
}

function isPrivateTarget(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (host === "0.0.0.0" || host === "::1") {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  if (!ipv4) {
    return false;
  }
  const parts = ipv4.slice(1).map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function mapEntry(row: Record<string, unknown>): WebAllowlistEntry {
  return {
    id: String(row.id),
    profileName: String(row.profile_name),
    domain: String(row.domain),
    pathPrefix: optionalString(row.path_prefix),
    label: optionalString(row.label),
    enabled: Boolean(row.enabled),
    createdBy: String(row.created_by),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
