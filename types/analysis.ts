/**
 * Structured intelligence returned by Groq for a single article.
 * This is the EXACT JSON contract enforced in lib/groq.ts.
 */
export interface Analysis {
  category: string;
  importance_score: number; // 1-10
  summary_fa: string; // ORIGINAL Persian writing — not a translation
  key_takeaways: string[];
  why_it_matters: string;
  action_item: string;
  best_for: string;
  ai_insight: string;
  tags: string[];
}

/** Weekly intelligence report stored at `report:weekly:{isoWeek}`. */
export interface WeeklyReport {
  id: string; // isoWeek, e.g. "2026-W25"
  generated_at: string; // ISO 8601
  period: { from: string; to: string };
  article_count: number;
  top_trends: string[];
  key_articles: Array<{
    id: string;
    title: string;
    url: string;
    source: string;
    importance_score: number;
    category: string;
  }>;
  emerging_themes: string[];
  strategic_insights: string;
  summary_fa: string;
}
