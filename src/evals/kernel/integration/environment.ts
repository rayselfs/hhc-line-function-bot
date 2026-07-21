import { randomUUID } from "node:crypto";

import { createClient, type RedisClientType } from "redis";

export interface KernelRedisEnvironment {
  clients: [RedisClientType, RedisClientType];
  keyPrefix: string;
  reconnectReplica(index: 0 | 1): Promise<RedisClientType>;
  cleanup(): Promise<void>;
}

export async function createKernelRedisEnvironment(): Promise<KernelRedisEnvironment> {
  const url = process.env.KERNEL_REDIS_URL?.trim();
  if (!url) {
    throw new Error("kernel_integration_redis_url_required");
  }

  const keyPrefix = `kernel-v1:${randomUUID()}`;
  const clients = [createRedisClient(url), createRedisClient(url)] as [
    RedisClientType,
    RedisClientType
  ];

  try {
    await Promise.all(clients.map(async (client) => client.connect()));
    const pongs = await Promise.all(clients.map(async (client) => client.ping()));
    if (pongs.some((pong) => pong !== "PONG")) {
      throw new Error("kernel_integration_redis_not_ready");
    }
  } catch (error) {
    await Promise.allSettled(clients.map(async (client) => closeRedisClient(client)));
    throw error;
  }

  let cleaned = false;
  return {
    clients,
    keyPrefix,
    async reconnectReplica(index) {
      await closeRedisClient(clients[index]);
      const replacement = createRedisClient(url);
      await replacement.connect();
      if ((await replacement.ping()) !== "PONG") {
        await closeRedisClient(replacement);
        throw new Error("kernel_integration_redis_not_ready");
      }
      clients[index] = replacement;
      return replacement;
    },
    async cleanup() {
      if (cleaned) return;
      let cleanupClient = clients.find((client) => client.isReady);
      let ownsCleanupClient = false;
      let cleanupFailure: unknown;
      try {
        if (!cleanupClient) {
          cleanupClient = createRedisClient(url);
          ownsCleanupClient = true;
          await cleanupClient.connect();
          if ((await cleanupClient.ping()) !== "PONG") {
            throw new Error("kernel_integration_redis_not_ready");
          }
        }
        const keys = await cleanupClient.keys(`${keyPrefix}:*`);
        if (keys.length > 0) await cleanupClient.del(keys);
        if ((await cleanupClient.keys(`${keyPrefix}:*`)).length > 0) {
          throw new Error("kernel_integration_redis_cleanup_incomplete");
        }
      } catch (error) {
        cleanupFailure = error;
      }
      const clientsToClose =
        ownsCleanupClient && cleanupClient ? [...clients, cleanupClient] : clients;
      const closeResults = await Promise.allSettled(
        clientsToClose.map(async (client) => closeRedisClient(client))
      );
      if (cleanupFailure) throw cleanupFailure;
      if (closeResults.some((result) => result.status === "rejected")) {
        throw new Error("kernel_integration_redis_cleanup_close_failed");
      }
      cleaned = true;
    }
  };
}

function createRedisClient(url: string): RedisClientType {
  const client = createClient({ url });
  client.on("error", () => undefined);
  return client;
}

async function closeRedisClient(client: RedisClientType): Promise<void> {
  if (client.isOpen) {
    await client.quit();
  }
}
