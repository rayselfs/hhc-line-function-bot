import { MemoryCacheStore, type CacheStore } from "./cache-store.js";
import { RedisCacheStore, type RedisCacheClient } from "./redis-cache-store.js";

export interface CacheStoreFactoryOptions {
  redis?: {
    client: RedisCacheClient;
    keyPrefix: string;
  };
}

export function createCacheStore(options: CacheStoreFactoryOptions): CacheStore {
  if (options.redis) {
    return new RedisCacheStore(options.redis);
  }
  return new MemoryCacheStore();
}
