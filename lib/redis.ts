/**
 * Upstash Redis (REST) client + repository layer.
 *
 * Upstash's REST client is stateless HTTP, so it is safe to instantiate per
 * serverless invocation and needs no connection pooling / teardown.
 *
 * Key schema (per spec):
 *   articles:{id}           -> StoredArticle (JSON)
 *   analysis:{id}           -> Analysis (JSON)
 *   index:articles          -> ZSET  (member=id, score=collected epoch ms)
 *   index:tags:{tag}        -> SET    of ids
 *   index:category:{cat}    -> SET    of ids
 *   dedupe:url:{id}         -> "1"    with TTL (fast duplicate guard)
 *   report:weekly:{isoWeek} -> WeeklyReport (JSON)
 *   index:reports           -> ZSET  (member=isoWeek, score=generated epoch ms)
 */

import { Redis } from "@upstash/redis";
import { assertRedis, config } from "./config";
import type { StoredArticle } from "@/types/article";
import type { Analysis, WeeklyReport } from "@/types/analysis";

let _redis: Redis | null = null;

export function redis(): Redis {
  assertRedis();
  if (!_redis) {
    _redis = new Redis({
      url: config.redis.url,
      token: config.redis.token,
    });
  }
  return _redis;
}

// ── key builders ─────────────────────────────────────────────
export const keys = {
  article: (id: string) => `articles:${id}`,
  analysis: (id: string) => `analysis:${id}`,
  indexArticles: "index:articles",
  tag: (tag: string) => `index:tags:${normalizeTag(tag)}`,
  category: (cat: string) => `index:category:${normalizeCategory(cat)}`,
  dedupe: (id: string) => `dedupe:url:${id}`,
  report: (isoWeek: string) => `report:weekly:${isoWeek}`,
  indexReports: "index:reports",
};

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

export function normalizeCategory(cat: string): string {
  return cat.trim().toLowerCase().replace(/\s+/g, "-");
}

// ── article storage ──────────────────────────────────────────

/**
 * Persist a raw article and register it in the recency index.
 * Idempotent: re-saving the same id overwrites the record.
 */
export async function saveArticle(article: StoredArticle): Promise<void> {
  const r = redis();
  const score = Date.parse(article.collected_at) || Date.now();
  const p = r.pipeline();
  p.set(keys.article(article.id), article);
  p.zadd(keys.indexArticles, { score, member: article.id });
  await p.exec();
}

export async function getArticle(id: string): Promise<StoredArticle | null> {
  return (await redis().get<StoredArticle>(keys.article(id))) ?? null;
}

export async function getArticles(ids: string[]): Promise<(StoredArticle | null)[]> {
  if (ids.length === 0) return [];
  return await redis().mget<StoredArticle[]>(...ids.map(keys.article));
}

export async function updateArticle(
  id: string,
  patch: Partial<StoredArticle>
): Promise<StoredArticle | null> {
  const current = await getArticle(id);
  if (!current) return null;
  const next: StoredArticle = { ...current, ...patch };
  await redis().set(keys.article(id), next);
  return next;
}

// ── analysis storage + indexing ──────────────────────────────

/**
 * Store analysis JSON, mirror searchable fields onto the article, and populate
 * the tag/category indexes. Runs as a single pipeline for atomic-ish writes.
 */
export async function saveAnalysis(
  id: string,
  analysis: Analysis,
  article: StoredArticle
): Promise<StoredArticle> {
  const r = redis();
  const enriched: StoredArticle = {
    ...article,
    status: "analyzed",
    summary_fa: analysis.summary_fa,
    category: analysis.category,
    importance_score: analysis.importance_score,
    key_takeaways: analysis.key_takeaways,
    ai_insight: analysis.ai_insight,
    tags: analysis.tags,
    analyzed_at: new Date().toISOString(),
  };

  const p = r.pipeline();
  p.set(keys.analysis(id), analysis);
  p.set(keys.article(id), enriched);
  if (analysis.category) p.sadd(keys.category(analysis.category), id);
  for (const tag of analysis.tags ?? []) {
    if (tag && tag.trim()) p.sadd(keys.tag(tag), id);
  }
  await p.exec();
  return enriched;
}

export async function getAnalysis(id: string): Promise<Analysis | null> {
  return (await redis().get<Analysis>(keys.analysis(id))) ?? null;
}

// ── indexes / scanning ───────────────────────────────────────

/** Most-recent article ids first (by collected time). */
export async function recentArticleIds(limit: number): Promise<string[]> {
  const r = redis();
  // ZRANGE with REV gives newest first.
  return await r.zrange<string[]>(keys.indexArticles, 0, limit - 1, {
    rev: true,
  });
}

export async function idsForTag(tag: string): Promise<string[]> {
  return await redis().smembers(keys.tag(tag));
}

export async function idsForCategory(category: string): Promise<string[]> {
  return await redis().smembers(keys.category(category));
}

// ── dedupe ───────────────────────────────────────────────────

/**
 * Atomically claim an article id. Returns true if this is the first time we've
 * seen it (caller should process it), false if it already existed.
 * Uses SET NX with TTL so the dedupe set self-prunes.
 */
export async function claimNew(id: string): Promise<boolean> {
  const res = await redis().set(keys.dedupe(id), "1", {
    nx: true,
    ex: config.tuning.cacheTtlDedup,
  });
  return res === "OK";
}

// ── weekly report storage ────────────────────────────────────

export async function saveReport(report: WeeklyReport): Promise<void> {
  const r = redis();
  const score = Date.parse(report.generated_at) || Date.now();
  const p = r.pipeline();
  p.set(keys.report(report.id), report);
  p.zadd(keys.indexReports, { score, member: report.id });
  await p.exec();
}

export async function getReport(isoWeek: string): Promise<WeeklyReport | null> {
  return (await redis().get<WeeklyReport>(keys.report(isoWeek))) ?? null;
}

export async function latestReportId(): Promise<string | null> {
  const ids = await redis().zrange<string[]>(keys.indexReports, 0, 0, {
    rev: true,
  });
  return ids[0] ?? null;
}

// ── processing / publishing queues ───────────────────────────
// Lightweight work queues (Redis lists). Producers LPUSH, consumers RPOP a
// batch. Ids may appear once; consumers are idempotent via status checks.

const QUEUE_PROCESS = "queue:process";
const QUEUE_PUBLISH = "queue:publish";

export async function enqueueProcess(ids: string[]): Promise<void> {
  if (ids.length) await redis().lpush(QUEUE_PROCESS, ...ids);
}

export async function enqueuePublish(id: string): Promise<void> {
  await redis().lpush(QUEUE_PUBLISH, id);
}

export async function dequeueProcess(n: number): Promise<string[]> {
  return drain(QUEUE_PROCESS, n);
}

export async function dequeuePublish(n: number): Promise<string[]> {
  return drain(QUEUE_PUBLISH, n);
}

export async function queueDepths(): Promise<{ process: number; publish: number }> {
  const r = redis();
  const [p, q] = await Promise.all([
    r.llen(QUEUE_PROCESS),
    r.llen(QUEUE_PUBLISH),
  ]);
  return { process: p, publish: q };
}

async function drain(key: string, n: number): Promise<string[]> {
  if (n <= 0) return [];
  const r = redis();
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = await r.rpop<string>(key);
    if (id === null) break;
    out.push(id);
  }
  return out;
}

// ── simple JSON cache (search results) ───────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  return (await redis().get<T>(key)) ?? null;
}

export async function cacheSet<T>(key: string, value: T, ttl: number): Promise<void> {
  await redis().set(key, value, { ex: ttl });
}
