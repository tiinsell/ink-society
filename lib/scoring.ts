/**
 * Scoring + the importance gate.
 *
 * The core business rule: only articles scoring >= IMPORTANCE_THRESHOLD are
 * stored as intelligence and published. Everything else is discarded.
 */

import { config } from "./config";

export function passesThreshold(score: number | undefined): boolean {
  return (score ?? 0) >= config.tuning.importanceThreshold;
}

/**
 * Recency decay in [0,1]. ~1.0 today, ~0.5 at 14 days, approaching 0 after.
 * Used as a ranking signal, never as a hard filter.
 */
export function recencyDecay(publishedAtIso: string, now = Date.now()): number {
  const ts = Date.parse(publishedAtIso);
  if (!Number.isFinite(ts)) return 0;
  const ageDays = Math.max(0, (now - ts) / 86_400_000);
  const halfLife = 14;
  return Math.pow(0.5, ageDays / halfLife);
}

/**
 * Composite ranking score for search results.
 *   - importance dominates (0..10 -> normalised 0..1, weight 0.6)
 *   - recency (weight 0.25)
 *   - text relevance (caller supplies 0..1, weight 0.15)
 */
export function compositeScore(params: {
  importance?: number;
  publishedAt: string;
  relevance?: number;
  now?: number;
}): number {
  const importance = Math.max(0, Math.min(10, params.importance ?? 0)) / 10;
  const recency = recencyDecay(params.publishedAt, params.now);
  const relevance = Math.max(0, Math.min(1, params.relevance ?? 0));
  return 0.6 * importance + 0.25 * recency + 0.15 * relevance;
}
