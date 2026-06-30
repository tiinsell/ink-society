/**
 * Fixed-window rate limiter backed by Upstash Redis.
 *
 * One INCR per request keyed by (bucket, client-ip, window). The first hit in a
 * window sets the TTL; subsequent hits just increment. Cheap and good enough
 * for protecting the public search endpoint.
 */

import { redis } from "@/lib/redis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetSeconds: number;
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "anonymous"
  );
}

export async function rateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `ratelimit:${bucket}:${identifier}:${window}`;

  const r = redis();
  const count = await r.incr(key);
  if (count === 1) {
    await r.expire(key, windowSeconds);
  }

  const allowed = count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    limit,
    resetSeconds: windowSeconds,
  };
}
