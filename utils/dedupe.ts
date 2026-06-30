/**
 * Duplicate detection for collected articles.
 *
 * Two layers:
 *  1. In-batch dedupe by id (same article appearing in multiple feeds in one run).
 *  2. Cross-run dedupe via Redis SET NX (claimNew) — the authoritative guard
 *     backed by the URL hash, with TTL so the dedupe namespace self-prunes.
 */

import { claimNew } from "@/lib/redis";
import type { RawArticle } from "@/types/article";

export interface DedupeResult {
  fresh: RawArticle[];
  duplicates: number;
}

/** Remove same-id repeats within a single collection batch. */
export function dedupeBatch(articles: RawArticle[]): RawArticle[] {
  const seen = new Set<string>();
  const out: RawArticle[] = [];
  for (const a of articles) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/**
 * Filter to only articles never seen before (claims them atomically in Redis).
 * `limit` caps how many fresh articles we accept per run to respect the
 * serverless time budget.
 */
export async function filterNew(
  articles: RawArticle[],
  limit: number
): Promise<DedupeResult> {
  const batch = dedupeBatch(articles);
  const fresh: RawArticle[] = [];
  let duplicates = 0;

  for (const article of batch) {
    if (fresh.length >= limit) break;
    const isNew = await claimNew(article.id);
    if (isNew) fresh.push(article);
    else duplicates++;
  }

  return { fresh, duplicates };
}
