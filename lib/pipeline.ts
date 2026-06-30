/**
 * Orchestration pipeline — the business logic shared by the public endpoints
 * (/api/collect, /api/process, /api/publish) and the cron jobs.
 *
 * Stages:
 *   collect  -> fetch RSS, dedupe, store raw, enqueue for processing
 *   process  -> Groq analysis, importance gate, store + index, enqueue publish
 *   publish  -> Telegram delivery, mark sent
 *   weekly   -> aggregate the week's high-value articles into a report
 *
 * Every stage is bounded (counts/limits) to respect the serverless time budget
 * and to minimise Groq calls.
 */

import { config } from "./config";
import { collectAll } from "./rss";
import { analyzeArticle, generateReportNarrative } from "./groq";
import { passesThreshold } from "./scoring";
import { publishArticle, publishReport } from "./telegram";
import {
  dequeueProcess,
  dequeuePublish,
  enqueueProcess,
  enqueuePublish,
  getAnalysis,
  getArticle,
  getArticles,
  queueDepths,
  recentArticleIds,
  saveAnalysis,
  saveArticle,
  saveReport,
  updateArticle,
} from "./redis";
import { filterNew } from "@/utils/dedupe";
import type { StoredArticle } from "@/types/article";
import type { WeeklyReport } from "@/types/analysis";

// ── collect ──────────────────────────────────────────────────

export interface CollectSummary {
  stage: "collect";
  fetched: number;
  fresh: number;
  duplicates: number;
  stored: number;
  feedErrors: Array<{ source: string; error: string }>;
}

export async function runCollect(
  limit = config.tuning.maxArticlesPerRun
): Promise<CollectSummary> {
  const { articles, errors } = await collectAll();
  const { fresh, duplicates } = await filterNew(articles, limit);

  const stored: string[] = [];
  for (const raw of fresh) {
    const article: StoredArticle = { ...raw, status: "raw", telegram_sent: false };
    await saveArticle(article);
    stored.push(article.id);
  }
  await enqueueProcess(stored);

  return {
    stage: "collect",
    fetched: articles.length,
    fresh: fresh.length,
    duplicates,
    stored: stored.length,
    feedErrors: errors,
  };
}

// ── process (Groq) ───────────────────────────────────────────

export interface ProcessSummary {
  stage: "process";
  attempted: number;
  analyzed: number;
  kept: number;
  discarded: number;
  enqueuedForPublish: number;
  errors: Array<{ id: string; error: string }>;
}

export async function runProcess(
  limit = config.tuning.aiBatchSize
): Promise<ProcessSummary> {
  const ids = await dequeueProcess(limit);
  const summary: ProcessSummary = {
    stage: "process",
    attempted: ids.length,
    analyzed: 0,
    kept: 0,
    discarded: 0,
    enqueuedForPublish: 0,
    errors: [],
  };

  for (const id of ids) {
    const article = await getArticle(id);
    if (!article || article.status !== "raw") continue; // already handled

    try {
      const analysis = await analyzeArticle(article);
      summary.analyzed++;

      if (!passesThreshold(analysis.importance_score)) {
        await updateArticle(id, {
          status: "discarded",
          importance_score: analysis.importance_score,
        });
        summary.discarded++;
        continue;
      }

      await saveAnalysis(id, analysis, article);
      await enqueuePublish(id);
      summary.kept++;
      summary.enqueuedForPublish++;
    } catch (err) {
      // Re-enqueue so a transient Groq error doesn't lose the article.
      await enqueueProcess([id]);
      summary.errors.push({
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

// ── publish (Telegram) ───────────────────────────────────────

export interface PublishSummary {
  stage: "publish";
  attempted: number;
  published: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}

export async function runPublish(limit = 10): Promise<PublishSummary> {
  const ids = await dequeuePublish(limit);
  const summary: PublishSummary = {
    stage: "publish",
    attempted: ids.length,
    published: 0,
    skipped: 0,
    errors: [],
  };

  for (const id of ids) {
    const article = await getArticle(id);
    if (!article) continue;
    if (article.telegram_sent) {
      summary.skipped++;
      continue;
    }
    if (!passesThreshold(article.importance_score)) {
      summary.skipped++;
      continue;
    }

    const analysis = await getAnalysis(id);
    if (!analysis) {
      summary.skipped++;
      continue;
    }

    try {
      const res = await publishArticle(article, analysis);
      await updateArticle(id, {
        status: "published",
        telegram_sent: true,
        telegram_message_id: res.message_id,
        published_at_telegram: new Date().toISOString(),
      });
      summary.published++;
    } catch (err) {
      await enqueuePublish(id); // retry next run
      summary.errors.push({
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

// ── daily orchestration ──────────────────────────────────────

export interface DailySummary {
  stage: "daily";
  collect: CollectSummary;
  process: ProcessSummary[];
  publish: PublishSummary;
  queues: { process: number; publish: number };
}

/**
 * Full daily run. Processes in AI-batch-sized chunks up to maxArticlesPerRun so
 * a large collection still drains within the function budget; remaining items
 * stay queued for the next invocation.
 */
export async function runDaily(): Promise<DailySummary> {
  const collect = await runCollect();

  const process: ProcessSummary[] = [];
  const maxBatches = Math.ceil(
    config.tuning.maxArticlesPerRun / Math.max(1, config.tuning.aiBatchSize)
  );
  for (let i = 0; i < maxBatches; i++) {
    const depth = (await queueDepths()).process;
    if (depth === 0) break;
    process.push(await runProcess());
  }

  const publish = await runPublish(config.tuning.maxArticlesPerRun);
  const queues = await queueDepths();

  return { stage: "daily", collect, process, publish, queues };
}

// ── weekly report ────────────────────────────────────────────

export function isoWeek(date: Date): string {
  // ISO-8601 week number.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface WeeklySummary {
  stage: "weekly";
  report: WeeklyReport;
  published: boolean;
}

/**
 * Build the weekly intelligence report from high-value articles collected in
 * the last 7 days. Stores it and (optionally) publishes to Telegram.
 */
export async function runWeekly(opts: { publish: boolean } = { publish: true }): Promise<WeeklySummary> {
  const now = Date.now();
  const since = now - 7 * 86_400_000;

  // Pull a generous window of recent ids, then filter to this week + threshold.
  const ids = await recentArticleIds(Math.max(200, config.tuning.searchScanLimit));
  const articles = (await getArticles(ids)).filter(
    (a): a is StoredArticle => a !== null
  );

  const weekArticles = articles
    .filter((a) => passesThreshold(a.importance_score))
    .filter((a) => {
      const t = Date.parse(a.collected_at) || Date.parse(a.published_at);
      return Number.isFinite(t) && t >= since;
    })
    .sort((a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0));

  const top = weekArticles.slice(0, 20);

  let narrative = {
    top_trends: [] as string[],
    emerging_themes: [] as string[],
    strategic_insights: "",
    summary_fa:
      weekArticles.length === 0
        ? "این هفته مقاله‌ی پراهمیتی برای گزارش ثبت نشد."
        : "",
  };

  if (top.length > 0) {
    narrative = await generateReportNarrative({
      from: new Date(since).toISOString().slice(0, 10),
      to: new Date(now).toISOString().slice(0, 10),
      articles: top.map((a) => ({
        title: a.title,
        source: a.source,
        category: a.category,
        importance_score: a.importance_score,
        summary_fa: a.summary_fa,
        tags: a.tags,
      })),
    });
  }

  const report: WeeklyReport = {
    id: isoWeek(new Date(now)),
    generated_at: new Date(now).toISOString(),
    period: {
      from: new Date(since).toISOString().slice(0, 10),
      to: new Date(now).toISOString().slice(0, 10),
    },
    article_count: weekArticles.length,
    top_trends: narrative.top_trends,
    key_articles: top.slice(0, 8).map((a) => ({
      id: a.id,
      title: a.title,
      url: a.url,
      source: a.source,
      importance_score: a.importance_score ?? 0,
      category: a.category ?? "General",
    })),
    emerging_themes: narrative.emerging_themes,
    strategic_insights: narrative.strategic_insights,
    summary_fa: narrative.summary_fa,
  };

  await saveReport(report);

  let published = false;
  if (opts.publish && top.length > 0) {
    try {
      await publishReport(report);
      published = true;
    } catch {
      published = false;
    }
  }

  return { stage: "weekly", report, published };
}
