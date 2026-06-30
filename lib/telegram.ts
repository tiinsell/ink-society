/**
 * Telegram Bot API integration (HTML parse mode).
 *
 * Publishing strategy:
 *  - If the article has an image, try sendPhoto with the formatted caption.
 *    Telegram caps captions at 1024 chars, so we send a compact card as the
 *    caption and never let a bad image URL block delivery (fallback to text).
 *  - Otherwise sendMessage with the full formatted body.
 */

import { assertTelegram, config } from "./config";
import { readingTime, truncate } from "./parser";
import type { StoredArticle } from "@/types/article";
import type { Analysis, WeeklyReport } from "@/types/analysis";

const API = (method: string) =>
  `https://api.telegram.org/bot${config.telegram.botToken}/${method}`;

interface TelegramResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  assertTelegram();
  const res = await fetch(API(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as TelegramResponse<T>;
  if (!data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
  }
  return data.result as T;
}

/** Escape user/AI text for Telegram HTML parse mode. */
export function escapeHtml(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function bullets(items: string[]): string {
  return items.map((t) => `• ${escapeHtml(t)}`).join("\n");
}

/** Build the full Persian intelligence card. */
export function formatArticleMessage(article: StoredArticle, analysis: Analysis): string {
  const rt = readingTime(article.content);
  const parts: string[] = [];

  parts.push(`📰 <b>${escapeHtml(article.title)}</b>`);
  parts.push(
    `⭐ امتیاز اهمیت: <b>${analysis.importance_score}/10</b>   🏷 ${escapeHtml(
      analysis.category
    )}   ⏱ ${rt.minutes} دقیقه`
  );
  parts.push("");
  parts.push(`📝 <b>خلاصه</b>\n${escapeHtml(analysis.summary_fa)}`);

  if (analysis.key_takeaways.length) {
    parts.push(`\n✅ <b>نکات کلیدی</b>\n${bullets(analysis.key_takeaways)}`);
  }
  if (analysis.why_it_matters) {
    parts.push(`\n💡 <b>چرا مهم است</b>\n${escapeHtml(analysis.why_it_matters)}`);
  }
  if (analysis.action_item) {
    parts.push(`\n🎯 <b>اقدام پیشنهادی</b>\n${escapeHtml(analysis.action_item)}`);
  }
  if (analysis.best_for) {
    parts.push(`\n👤 <b>مناسب برای</b>\n${escapeHtml(analysis.best_for)}`);
  }
  if (analysis.ai_insight) {
    parts.push(`\n🤖 <b>تحلیل هوش مصنوعی</b>\n${escapeHtml(analysis.ai_insight)}`);
  }
  if (analysis.tags.length) {
    parts.push(
      `\n${analysis.tags.map((t) => "#" + escapeHtml(t.replace(/\s+/g, "_"))).join(" ")}`
    );
  }
  parts.push(`\n🔗 <a href="${escapeHtml(article.url)}">${escapeHtml(article.source)}</a>`);

  return parts.join("\n");
}

/** Compact caption (<=1024) used when sending with a photo. */
function formatCaption(article: StoredArticle, analysis: Analysis): string {
  const rt = readingTime(article.content);
  const head = `📰 <b>${escapeHtml(article.title)}</b>
⭐ ${analysis.importance_score}/10   🏷 ${escapeHtml(analysis.category)}   ⏱ ${rt.minutes}'

📝 ${escapeHtml(analysis.summary_fa)}

🔗 <a href="${escapeHtml(article.url)}">${escapeHtml(article.source)}</a>`;
  return truncate(head, 1020);
}

export interface PublishResult {
  message_id: number;
  used_photo: boolean;
}

/** Publish a single analysed article to the channel. */
export async function publishArticle(
  article: StoredArticle,
  analysis: Analysis
): Promise<PublishResult> {
  const chat_id = config.telegram.channelId;

  if (article.image) {
    try {
      const result = await call<{ message_id: number }>("sendPhoto", {
        chat_id,
        photo: article.image,
        caption: formatCaption(article, analysis),
        parse_mode: "HTML",
      });
      return { message_id: result.message_id, used_photo: true };
    } catch {
      // bad image URL etc. — fall through to text
    }
  }

  const result = await call<{ message_id: number }>("sendMessage", {
    chat_id,
    text: truncate(formatArticleMessage(article, analysis), 4090),
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
  return { message_id: result.message_id, used_photo: false };
}

/** Send a plain HTML message to the channel. */
export async function sendChannelMessage(text: string): Promise<number> {
  const result = await call<{ message_id: number }>("sendMessage", {
    chat_id: config.telegram.channelId,
    text: truncate(text, 4090),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  return result.message_id;
}

/** Reply to an arbitrary chat (used by the webhook bot commands). */
export async function sendReply(chatId: number | string, text: string): Promise<void> {
  await call("sendMessage", {
    chat_id: chatId,
    text: truncate(text, 4090),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

export function formatReportMessage(report: WeeklyReport): string {
  const parts: string[] = [];
  parts.push(`📈 <b>گزارش هفتگی هوش بازاریابی</b>`);
  parts.push(`🗓 ${report.period.from} تا ${report.period.to}`);
  parts.push(`📊 ${report.article_count} مقاله‌ی ارزشمند بررسی شد`);
  parts.push(`\n📝 ${escapeHtml(report.summary_fa)}`);
  if (report.top_trends.length) {
    parts.push(`\n🔥 <b>روندهای برتر</b>\n${bullets(report.top_trends)}`);
  }
  if (report.emerging_themes.length) {
    parts.push(`\n🌱 <b>موضوعات نوظهور</b>\n${bullets(report.emerging_themes)}`);
  }
  if (report.strategic_insights) {
    parts.push(`\n♟ <b>بینش‌های راهبردی</b>\n${escapeHtml(report.strategic_insights)}`);
  }
  if (report.key_articles.length) {
    const items = report.key_articles
      .slice(0, 5)
      .map(
        (a) =>
          `• <a href="${escapeHtml(a.url)}">${escapeHtml(a.title)}</a> (${a.importance_score}/10)`
      )
      .join("\n");
    parts.push(`\n📌 <b>مقالات کلیدی</b>\n${items}`);
  }
  return parts.join("\n");
}

export async function publishReport(report: WeeklyReport): Promise<number> {
  return sendChannelMessage(formatReportMessage(report));
}

/** Register the webhook URL with Telegram (called from the webhook GET handler). */
export async function setWebhook(url: string): Promise<unknown> {
  return call("setWebhook", {
    url,
    secret_token: config.telegram.webhookSecret || undefined,
    allowed_updates: ["message"],
  });
}
