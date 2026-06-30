/**
 * Search service over stored intelligence.
 *
 * Supports keyword (q), tag, and category search, combinable. Candidate ids are
 * resolved from the most selective available index (tag/category set, else the
 * recency ZSET), then hydrated, filtered, and ranked by
 * importance + recency + relevance.
 */

import { config } from "./config";
import {
  getArticles,
  idsForCategory,
  idsForTag,
  recentArticleIds,
} from "./redis";
import { rank, tokenize, matches, type RankedResult } from "@/utils/ranker";
import type { StoredArticle } from "@/types/article";

export interface SearchQuery {
  q?: string;
  tag?: string;
  category?: string;
  limit?: number;
}

export interface SearchResponse {
  query: SearchQuery;
  count: number;
  results: RankedResult[];
}

function intersect(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter((x) => set.has(x));
}

/** An article is searchable once it has been analysed and kept. */
function isSearchable(a: StoredArticle): boolean {
  return (
    (a.status === "analyzed" || a.status === "published") &&
    typeof a.importance_score === "number"
  );
}

export async function search(query: SearchQuery): Promise<SearchResponse> {
  const limit = Math.max(1, Math.min(50, query.limit ?? 20));
  const terms = tokenize(query.q ?? "");

  // Resolve candidate id set.
  let ids: string[] | null = null;
  if (query.tag) ids = await idsForTag(query.tag);
  if (query.category) {
    const catIds = await idsForCategory(query.category);
    ids = ids ? intersect(ids, catIds) : catIds;
  }
  if (ids === null) {
    ids = await recentArticleIds(config.tuning.searchScanLimit);
  }

  if (ids.length === 0) {
    return { query, count: 0, results: [] };
  }

  const hydrated = (await getArticles(ids)).filter(
    (a): a is StoredArticle => a !== null && isSearchable(a)
  );

  const filtered =
    terms.length > 0 ? hydrated.filter((a) => matches(a, terms)) : hydrated;

  const ranked = rank(filtered, terms).slice(0, limit);

  return { query, count: ranked.length, results: ranked };
}
