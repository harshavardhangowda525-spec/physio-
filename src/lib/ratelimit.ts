/**
 * Fixed-window rate limiter held in memory. Works for a single server instance.
 * For multi-instance deployments, back this with Redis/Upstash (see README).
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

export type RateResult = { allowed: boolean; remaining: number; retryAfterSec: number };

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateResult {
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  const allowed = b.count <= limit;
  return { allowed, remaining: Math.max(0, limit - b.count), retryAfterSec: allowed ? 0 : Math.ceil((b.resetAt - now) / 1000) };
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
