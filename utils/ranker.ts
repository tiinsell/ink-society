/**
 * Search ranking + relevance scoring.
 *
 * Relevance is a lightweight TF-style match over title/summary/tags/category,
 * combined with importance + recency by lib/scoring.compositeScore.
 */

import { compositeScore } from "@/lib/scoring";
import type { StoredArticle } from "@/types/article";

export interface RankedResult {
  id: string;
  title: string;
  url: string;
  source: string;
  category: string;
  importance_score: number;
  summary_fa: string;
  tags: string[];
  published_at: string;
  score: number;
}

export function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** 0..1 relevance of an article to the query terms. */
export function relevance(article: StoredArticle, terms: string[]): number {
  if (terms.length === 0) return 0;

  const title = (article.title ?? "").toLowerCase();
  const summary = (article.summary_fa ?? "").toLowerCase();
  const category = (article.category ?? "").toLowerCase();
  const tags = (article.tags ?? []).map((t) => t.toLowerCase());
  const body = (article.content ?? "").toLowerCase();

  let hits = 0;
  for (const term of terms) {
    if (title.includes(term)) hits += 3;
    else if (tags.some((t) => t.includes(term))) hits += 2.5;
    else if (category.includes(term)) hits += 2;
    else if (summary.includes(term)) hits += 1.5;
    else if (body.includes(term)) hits += 1;
  }
  // Normalise against the best achievable score (all terms hit the title).
  const max = terms.length * 3;
  return Math.min(1, hits / max);
}

/** True if the article matches at least one query term anywhere. */
export function matches(article: StoredArticle, terms: string[]): boolean {
  if (terms.length === 0) return true;
  return relevance(article, terms) > 0;
}

export function toRanked(article: StoredArticle, score: number): RankedResult {
  return {
    id: article.id,
    title: article.title,
    url: article.url,
    source: article.source,
    category: article.category ?? "General",
    importance_score: article.importance_score ?? 0,
    summary_fa: article.summary_fa ?? "",
    tags: article.tags ?? [],
    published_at: article.published_at,
    score: Number(score.toFixed(4)),
  };
}

/** Rank a set of candidate articles for a query. */
export function rank(
  articles: StoredArticle[],
  terms: string[],
  now = Date.now()
): RankedResult[] {
  return articles
    .map((a) => {
      const rel = relevance(a, terms);
      const score = compositeScore({
        importance: a.importance_score,
        publishedAt: a.published_at,
        relevance: rel,
        now,
      });
      return toRanked(a, score);
    })
    .sort((a, b) => b.score - a.score);
}
