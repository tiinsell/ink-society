/**
 * Content parsing helpers: HTML -> plain text, reading-time, truncation,
 * and a stable id (sha256 of the canonical URL).
 *
 * All dependency-free so it runs identically on Node + Edge runtimes.
 */

import { createHash } from "node:crypto";
import { config } from "./config";
import type { ReadingTime } from "@/types/article";

/** Canonicalise a URL: strip tracking params + fragments + trailing slash. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    const drop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "fbclid",
      "gclid",
    ];
    for (const p of drop) u.searchParams.delete(p);
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

/** Stable primary key for an article. */
export function articleId(url: string): string {
  return createHash("sha256").update(canonicalUrl(url)).digest("hex").slice(0, 24);
}

/** Strip HTML tags + decode the most common entities, collapse whitespace. */
export function htmlToText(html: string): string {
  if (!html) return "";
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
    "&hellip;": "…",
    "&mdash;": "—",
    "&ndash;": "–",
    "&rsquo;": "'",
    "&lsquo;": "'",
    "&ldquo;": '"',
    "&rdquo;": '"',
  };
  text = text.replace(/&[a-zA-Z#0-9]+;/g, (m) => entities[m] ?? " ");

  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

export function readingTime(text: string): ReadingTime {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const minutes = Math.max(1, Math.round(words / config.tuning.wordsPerMinute));
  return { minutes, words };
}

/** First image URL found in an HTML blob, or null. */
export function firstImage(html: string | undefined | null): string | null {
  if (!html) return null;
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}
