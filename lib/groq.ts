/**
 * Groq AI integration.
 *
 * - Forces strict JSON output (`response_format: json_object`, temperature 0).
 * - Falls back from the primary model to the fallback model on hard failure.
 * - Validates + coerces the returned object against the Analysis contract so a
 *   malformed/hallucinated response can never poison downstream storage.
 */

import { assertGroq, config } from "./config";
import { truncate } from "./parser";
import type { Analysis, WeeklyReport } from "@/types/analysis";
import type { StoredArticle } from "@/types/article";

interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function groqJson(
  messages: GroqMessage[],
  maxTokens = 1200
): Promise<unknown> {
  assertGroq();
  const models = [config.groq.model, config.groq.fallbackModel].filter(Boolean);
  let lastErr: unknown;

  for (const model of models) {
    try {
      const res = await fetch(config.groq.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.groq.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Groq ${model} HTTP ${res.status}: ${truncate(body, 300)}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`Groq ${model} returned empty content`);
      return JSON.parse(content);
    } catch (err) {
      lastErr = err;
      // try next model
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Groq request failed");
}

// ── validation helpers ───────────────────────────────────────

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
}

function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(1, Math.min(10, Math.round(n)));
}

/** Coerce arbitrary Groq output into a well-formed Analysis. */
function toAnalysis(raw: unknown): Analysis {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    category: asString(o.category, "General").trim() || "General",
    importance_score: clampScore(o.importance_score),
    summary_fa: asString(o.summary_fa).trim(),
    key_takeaways: asStringArray(o.key_takeaways),
    why_it_matters: asString(o.why_it_matters).trim(),
    action_item: asString(o.action_item).trim(),
    best_for: asString(o.best_for).trim(),
    ai_insight: asString(o.ai_insight).trim(),
    tags: asStringArray(o.tags),
  };
}

const ANALYSIS_SYSTEM = `You are the senior marketing intelligence analyst for "Ink Society", a private Persian-language marketing intelligence service.

You receive one English marketing article. You output STRICT JSON ONLY — no markdown, no prose, no code fences — matching EXACTLY this schema:

{
  "category": string,                 // one of: SEO, Content Marketing, Social Media, Paid Ads, Email Marketing, Analytics, Branding, Strategy, AI Marketing, General
  "importance_score": number,         // integer 1-10, how strategically valuable this is for marketing professionals
  "summary_fa": string,               // ORIGINAL Persian writing summarising the strategic essence. NOT a literal translation. Fluent, professional Persian (فارسی).
  "key_takeaways": string[],          // 3-5 concise Persian bullet points
  "why_it_matters": string,           // Persian, 1-2 sentences on strategic significance
  "action_item": string,              // Persian, one concrete action a marketer should take
  "best_for": string,                 // Persian, the audience this is most useful for
  "ai_insight": string,               // Persian, your own non-obvious analytical insight
  "tags": string[]                    // 3-8 lowercase English tags
}

Rules:
- Output JSON only. No extra keys. No explanations.
- summary_fa, key_takeaways, why_it_matters, action_item, best_for, ai_insight MUST be in Persian.
- Be concise, strategic, and original. Do not invent facts not present in the article.
- importance_score must reflect genuine strategic value; be discerning, do not inflate.`;

/** Analyse a single article. */
export async function analyzeArticle(article: StoredArticle): Promise<Analysis> {
  const user = `Article source: ${article.source}
Title: ${article.title}
URL: ${article.url}
Published: ${article.published_at}

Content:
${truncate(article.content, 6000)}`;

  const raw = await groqJson(
    [
      { role: "system", content: ANALYSIS_SYSTEM },
      { role: "user", content: user },
    ],
    1400
  );
  return toAnalysis(raw);
}

// ── weekly report generation ─────────────────────────────────

const REPORT_SYSTEM = `You are the lead strategist of "Ink Society". You produce a weekly marketing intelligence report in Persian based on the week's most important analysed articles.

Output STRICT JSON ONLY matching EXACTLY:
{
  "top_trends": string[],          // 3-6 Persian bullet trends
  "emerging_themes": string[],     // 3-6 Persian emerging themes
  "strategic_insights": string,    // Persian, 2-4 sentence strategic narrative
  "summary_fa": string             // Persian executive summary, 3-5 sentences
}
Rules: JSON only, Persian content, no extra keys, grounded strictly in the provided articles.`;

export interface ReportInput {
  from: string;
  to: string;
  articles: Array<{
    title: string;
    source: string;
    category?: string;
    importance_score?: number;
    summary_fa?: string;
    tags?: string[];
  }>;
}

export interface ReportNarrative {
  top_trends: string[];
  emerging_themes: string[];
  strategic_insights: string;
  summary_fa: string;
}

export async function generateReportNarrative(
  input: ReportInput
): Promise<ReportNarrative> {
  const lines = input.articles
    .map(
      (a, i) =>
        `${i + 1}. [${a.category ?? "General"}] (${a.importance_score ?? "?"}/10) ${a.title} — ${a.source}\n   ${truncate(a.summary_fa ?? "", 280)}`
    )
    .join("\n");

  const user = `Reporting period: ${input.from} to ${input.to}
Number of high-value articles: ${input.articles.length}

Articles:
${truncate(lines, 9000)}`;

  const raw = (await groqJson(
    [
      { role: "system", content: REPORT_SYSTEM },
      { role: "user", content: user },
    ],
    1600
  )) as Record<string, unknown>;

  return {
    top_trends: asStringArray(raw.top_trends),
    emerging_themes: asStringArray(raw.emerging_themes),
    strategic_insights: asString(raw.strategic_insights).trim(),
    summary_fa: asString(raw.summary_fa).trim(),
  };
}

export type { WeeklyReport };
