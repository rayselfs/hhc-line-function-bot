import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

export type LlmOAuthProviderName = "openai_codex_oauth";

export type LlmAuthProfileStatus = "active" | "reauth_required";

export interface LlmAuthProfile {
  provider: LlmOAuthProviderName;
  profileName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  accountId?: string;
  status: LlmAuthProfileStatus;
  lastError?: string;
  updatedAt?: string;
}

export interface PersistedLlmAuthProfile {
  provider: LlmOAuthProviderName;
  profileName: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  expiresAt: string;
  accountId?: string;
  status: LlmAuthProfileStatus;
  lastError?: string;
  updatedAt?: string;
}

export interface LlmTokenCipher {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export interface LlmAuthStore {
  get(provider: LlmOAuthProviderName, profileName: string): Promise<LlmAuthProfile | undefined>;
  save(profile: LlmAuthProfile): Promise<void>;
  markReauthRequired(input: {
    provider: LlmOAuthProviderName;
    profileName: string;
    lastError: string;
  }): Promise<void>;
  withRefreshLock<T>(
    provider: LlmOAuthProviderName,
    profileName: string,
    fn: () => Promise<T>
  ): Promise<T>;
}

export interface RefreshedCodexToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  accountId?: string;
}

export class TerminalLlmAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalLlmAuthError";
  }
}

export class LlmReauthRequiredError extends Error {
  constructor() {
    super("reauth_required");
    this.name = "LlmReauthRequiredError";
  }
}

export function createLlmTokenCipher(secret: string): LlmTokenCipher {
  const key = createHash("sha256").update(secret).digest();
  return {
    encrypt(value: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [
        "v1",
        iv.toString("base64url"),
        tag.toString("base64url"),
        ciphertext.toString("base64url")
      ].join(":");
    },
    decrypt(value: string): string {
      const [version, ivRaw, tagRaw, ciphertextRaw] = value.split(":");
      if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
        throw new Error("invalid_encrypted_token");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
      decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextRaw, "base64url")),
        decipher.final()
      ]).toString("utf8");
    }
  };
}

export class InMemoryLlmAuthStore implements LlmAuthStore {
  private readonly profiles = new Map<string, LlmAuthProfile>();
  private readonly locks = new Map<string, Promise<unknown>>();

  async get(
    provider: LlmOAuthProviderName,
    profileName: string
  ): Promise<LlmAuthProfile | undefined> {
    const profile = this.profiles.get(key(provider, profileName));
    return profile ? { ...profile } : undefined;
  }

  async save(profile: LlmAuthProfile): Promise<void> {
    this.profiles.set(key(profile.provider, profile.profileName), {
      ...profile,
      updatedAt: new Date().toISOString()
    });
  }

  async markReauthRequired(input: {
    provider: LlmOAuthProviderName;
    profileName: string;
    lastError: string;
  }): Promise<void> {
    const existing = await this.get(input.provider, input.profileName);
    if (!existing) {
      return;
    }
    await this.save({
      ...existing,
      status: "reauth_required",
      lastError: input.lastError
    });
  }

  async withRefreshLock<T>(
    provider: LlmOAuthProviderName,
    profileName: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const lockKey = key(provider, profileName);
    const previous = this.locks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      lockKey,
      previous.then(() => next)
    );
    try {
      await previous;
      return await fn();
    } finally {
      release();
      if (this.locks.get(lockKey) === next) {
        this.locks.delete(lockKey);
      }
    }
  }
}

export interface PgQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[] }>;
}

export class PostgresLlmAuthStore implements LlmAuthStore {
  constructor(
    private readonly db: PgQueryable,
    private readonly cipher: LlmTokenCipher
  ) {}

  async get(
    provider: LlmOAuthProviderName,
    profileName: string
  ): Promise<LlmAuthProfile | undefined> {
    const result = await this.db.query(
      `
      select *
      from llm_auth_profiles
      where provider = $1 and profile_name = $2
      limit 1
      `,
      [provider, profileName]
    );
    const row = result.rows[0];
    return row ? this.mapRow(row) : undefined;
  }

  async save(profile: LlmAuthProfile): Promise<void> {
    await this.db.query(
      `
      insert into llm_auth_profiles
        (id, provider, profile_name, encrypted_access_token, encrypted_refresh_token,
         expires_at, account_id, status, last_error, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      on conflict (provider, profile_name)
      do update set
        encrypted_access_token = excluded.encrypted_access_token,
        encrypted_refresh_token = excluded.encrypted_refresh_token,
        expires_at = excluded.expires_at,
        account_id = excluded.account_id,
        status = excluded.status,
        last_error = excluded.last_error,
        updated_at = now()
      `,
      [
        randomUUID(),
        profile.provider,
        profile.profileName,
        this.cipher.encrypt(profile.accessToken),
        this.cipher.encrypt(profile.refreshToken),
        profile.expiresAt,
        profile.accountId ?? null,
        profile.status,
        profile.lastError ?? null
      ]
    );
  }

  async markReauthRequired(input: {
    provider: LlmOAuthProviderName;
    profileName: string;
    lastError: string;
  }): Promise<void> {
    await this.db.query(
      `
      update llm_auth_profiles
      set status = 'reauth_required',
          last_error = $3,
          updated_at = now()
      where provider = $1 and profile_name = $2
      `,
      [input.provider, input.profileName, input.lastError]
    );
  }

  async withRefreshLock<T>(
    provider: LlmOAuthProviderName,
    profileName: string,
    fn: () => Promise<T>
  ): Promise<T> {
    await this.db.query("select pg_advisory_lock(hashtextextended($1, 0))", [
      `${provider}:${profileName}`
    ]);
    try {
      return await fn();
    } finally {
      await this.db.query("select pg_advisory_unlock(hashtextextended($1, 0))", [
        `${provider}:${profileName}`
      ]);
    }
  }

  private mapRow(row: Record<string, unknown>): LlmAuthProfile {
    return {
      provider: row.provider as LlmOAuthProviderName,
      profileName: String(row.profile_name),
      accessToken: this.cipher.decrypt(String(row.encrypted_access_token)),
      refreshToken: this.cipher.decrypt(String(row.encrypted_refresh_token)),
      expiresAt: toIso(row.expires_at),
      accountId: optionalString(row.account_id),
      status: row.status === "reauth_required" ? "reauth_required" : "active",
      lastError: optionalString(row.last_error),
      updatedAt: optionalIso(row.updated_at)
    };
  }
}

export const llmAuthMigrations = [
  `
  create table if not exists llm_auth_profiles (
    id uuid primary key,
    provider text not null,
    profile_name text not null,
    encrypted_access_token text not null,
    encrypted_refresh_token text not null,
    expires_at timestamptz not null,
    account_id text,
    status text not null check (status in ('active', 'reauth_required')),
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (provider, profile_name)
  )
  `
];

export async function runLlmAuthMigrations(db: PgQueryable): Promise<void> {
  for (const migration of llmAuthMigrations) {
    await db.query(migration);
  }
}

export class OpenAICodexAuthManager {
  private readonly refreshSkewMs: number;

  constructor(
    private readonly options: {
      store: LlmAuthStore;
      refresh: (refreshToken: string) => Promise<RefreshedCodexToken>;
      refreshSkewMs?: number;
      now?: () => Date;
    }
  ) {
    this.refreshSkewMs = options.refreshSkewMs ?? 120_000;
  }

  async getAccessToken(profileName: string): Promise<string> {
    const profile = await this.options.store.get("openai_codex_oauth", profileName);
    if (!profile || profile.status === "reauth_required") {
      throw new LlmReauthRequiredError();
    }
    if (!this.isExpiring(profile.expiresAt)) {
      return profile.accessToken;
    }

    return this.options.store.withRefreshLock("openai_codex_oauth", profileName, async () => {
      const fresh = await this.options.store.get("openai_codex_oauth", profileName);
      if (!fresh || fresh.status === "reauth_required") {
        throw new LlmReauthRequiredError();
      }
      if (!this.isExpiring(fresh.expiresAt)) {
        return fresh.accessToken;
      }
      try {
        const refreshed = await this.options.refresh(fresh.refreshToken);
        await this.options.store.save({
          provider: "openai_codex_oauth",
          profileName,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
          accountId: refreshed.accountId,
          status: "active"
        });
        return refreshed.accessToken;
      } catch (error) {
        if (error instanceof TerminalLlmAuthError) {
          await this.options.store.markReauthRequired({
            provider: "openai_codex_oauth",
            profileName,
            lastError: error.message
          });
          throw new LlmReauthRequiredError();
        }
        throw error;
      }
    });
  }

  private isExpiring(expiresAt: string): boolean {
    return new Date(expiresAt).getTime() - this.now().getTime() <= this.refreshSkewMs;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function key(provider: LlmOAuthProviderName, profileName: string): string {
  return `${provider}:${profileName}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalIso(value: unknown): string | undefined {
  return value ? toIso(value) : undefined;
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}
