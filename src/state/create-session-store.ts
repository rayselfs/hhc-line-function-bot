import { InMemorySessionStore, type SessionStore } from "./session-store.js";
import { RedisSessionStore, type RedisSessionClient } from "./redis-session-store.js";

export interface SessionStoreFactoryOptions {
  redis?: {
    client: RedisSessionClient;
    keyPrefix: string;
  };
}

export function createSessionStore(options: SessionStoreFactoryOptions): SessionStore {
  if (options.redis) {
    return new RedisSessionStore(options.redis);
  }
  return new InMemorySessionStore();
}
