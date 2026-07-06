import type { CacheStore, CacheStoreStats } from "./cache-store.js";

export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

export interface RedisCacheStoreOptions {
  client: RedisCacheClient;
  keyPrefix: string;
}

export class RedisCacheStore implements CacheStore {
  constructor(private readonly options: RedisCacheStoreOptions) {}

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.options.client.get(this.key(key));
    return raw ? (JSON.parse(raw) as T) : undefined;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.options.client.setEx(this.key(key), ttlSeconds(ttlMs), JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.options.client.del(this.key(key));
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = await this.options.client.keys(this.key(`${prefix}*`));
    if (keys.length === 0) {
      return 0;
    }
    return this.options.client.del(keys);
  }

  async stats(): Promise<CacheStoreStats> {
    const keys = await this.options.client.keys(this.key("*"));
    return { totalEntries: keys.length };
  }

  private key(key: string): string {
    return `${this.options.keyPrefix}:cache:${key}`;
  }
}

function ttlSeconds(ttlMs: number): number {
  return Math.max(1, Math.ceil(ttlMs / 1000));
}
