import type { LineSource, RateLimitConfig } from "./types.js";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
}

export interface RateLimiter {
  check(input: { profileName: string; source: LineSource }): Promise<RateLimitResult>;
}

export interface RedisRateLimitClient {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
}

export interface RateLimiterFactoryOptions {
  config: RateLimitConfig;
  redis?: {
    client: RedisRateLimitClient;
    keyPrefix: string;
  };
  now?: () => Date;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly now: () => Date = () => new Date()
  ) {}

  async check(input: { profileName: string; source: LineSource }): Promise<RateLimitResult> {
    if (!this.config.enabled) {
      return {
        allowed: true,
        remaining: Number.MAX_SAFE_INTEGER,
        resetAt: this.now().toISOString()
      };
    }

    const key = `${input.profileName}:${sourceKey(input.source)}`;
    const nowMs = this.now().getTime();
    const current = this.buckets.get(key);
    const bucket =
      current && current.resetAt > nowMs
        ? current
        : { count: 0, resetAt: nowMs + this.config.windowMs };
    bucket.count += 1;
    this.buckets.set(key, bucket);

    return {
      allowed: bucket.count <= this.config.maxRequests,
      remaining: Math.max(0, this.config.maxRequests - bucket.count),
      resetAt: new Date(bucket.resetAt).toISOString()
    };
  }
}

export class RedisRateLimiter implements RateLimiter {
  private readonly now: () => Date;

  constructor(private readonly options: Required<RateLimiterFactoryOptions>) {
    this.now = options.now;
  }

  async check(input: { profileName: string; source: LineSource }): Promise<RateLimitResult> {
    if (!this.options.config.enabled) {
      return {
        allowed: true,
        remaining: Number.MAX_SAFE_INTEGER,
        resetAt: this.now().toISOString()
      };
    }

    const key = `${this.options.redis.keyPrefix}:rate-limit:${input.profileName}:${sourceKey(
      input.source
    )}`;
    const nowMs = this.now().getTime();
    const current = await this.options.redis.client.get(key);
    const bucket: Bucket =
      current && JSON.parse(current).resetAt > nowMs
        ? (JSON.parse(current) as Bucket)
        : { count: 0, resetAt: nowMs + this.options.config.windowMs };
    bucket.count += 1;
    await this.options.redis.client.setEx(
      key,
      ttlSeconds(bucket.resetAt - nowMs),
      JSON.stringify(bucket)
    );

    return {
      allowed: bucket.count <= this.options.config.maxRequests,
      remaining: Math.max(0, this.options.config.maxRequests - bucket.count),
      resetAt: new Date(bucket.resetAt).toISOString()
    };
  }
}

export function createRateLimiter(options: RateLimiterFactoryOptions): RateLimiter {
  if (options.redis) {
    return new RedisRateLimiter({
      config: options.config,
      redis: options.redis,
      now: options.now ?? (() => new Date())
    });
  }
  return new InMemoryRateLimiter(options.config, options.now);
}

function sourceKey(source: LineSource): string {
  switch (source.type) {
    case "group":
      return `group:${source.groupId ?? ""}`;
    case "room":
      return `room:${source.roomId ?? ""}`;
    case "user":
      return `user:${source.userId ?? ""}`;
    default:
      return `${source.type}:unknown`;
  }
}

function ttlSeconds(ttlMs: number): number {
  return Math.max(1, Math.ceil(ttlMs / 1000));
}
