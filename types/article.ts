/**
 * Raw + enriched article model.
 *
 * A "raw" article is what we extract from an RSS feed. After AI analysis the
 * enriched fields (summary_fa, category, importance_score, ...) are flattened
 * onto the stored record so a single `articles:{id}` read returns everything
 * the UI / Telegram formatter needs.
 */

export type ArticleStatus = "raw" | "analyzed" | "discarded" | "published";

/** Shape produced by the collector (lib/rss.ts). */
export interface RawArticle {
  id: string; // sha256(url) — stable primary key
  title: string;
  url: string;
  source: string; // human-readable source name, e.g. "HubSpot"
  content: string; // cleaned plain-text body / description
  published_at: string; // ISO 8601
  image: string | null;
  collected_at: string; // ISO 8601
}

/**
 * The canonical record stored at `articles:{id}`.
 * Enriched fields are optional until AI analysis has run.
 */
export interface StoredArticle extends RawArticle {
  status: ArticleStatus;

  // --- enriched (mirrored from Analysis after processing) ---
  summary_fa?: string;
  category?: string;
  importance_score?: number;
  key_takeaways?: string[];
  ai_insight?: string;
  tags?: string[];

  // --- publishing state ---
  telegram_sent: boolean;
  telegram_message_id?: number;
  analyzed_at?: string;
  published_at_telegram?: string;
}

/** Reading-time helper output. */
export interface ReadingTime {
  minutes: number;
  words: number;
}
