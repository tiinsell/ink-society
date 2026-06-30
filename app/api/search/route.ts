import { search, type SearchQuery } from "@/lib/search";
import { config } from "@/lib/config";
import { cacheGet, cacheSet } from "@/lib/redis";
import { clientIp, rateLimit } from "@/utils/ratelimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=...&tag=...&category=...&limit=20
 * Public, rate-limited keyword/tag/category search over stored intelligence.
 * Results are cached briefly in Redis.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const tag = url.searchParams.get("tag")?.trim() || undefined;
  const category = url.searchParams.get("category")?.trim() || undefined;
  const limit = Number(url.searchParams.get("limit")) || 20;

  if (!q && !tag && !category) {
    return Response.json(
      { ok: false, error: "provide at least one of: q, tag, category" },
      { status: 400 }
    );
  }

  // Rate limit per client IP.
  try {
    const rl = await rateLimit(
      "search",
      clientIp(req),
      config.tuning.searchRateLimit,
      config.tuning.searchRateWindow
    );
    if (!rl.allowed) {
      return Response.json(
        { ok: false, error: "rate limit exceeded", limit: rl.limit },
        { status: 429, headers: { "Retry-After": String(rl.resetSeconds) } }
      );
    }
  } catch {
    // If Redis is briefly unavailable for the limiter, don't hard-fail search.
  }

  const query: SearchQuery = { q, tag, category, limit };
  const cacheKey = `cache:search:${JSON.stringify(query)}`;

  try {
    const cached = await cacheGet<Awaited<ReturnType<typeof search>>>(cacheKey);
    if (cached) {
      return Response.json({ ok: true, cached: true, ...cached });
    }

    const result = await search(query);
    await cacheSet(cacheKey, result, config.tuning.cacheTtlSearch);
    return Response.json({ ok: true, cached: false, ...result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
