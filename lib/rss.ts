/**
 * RSS collection.
 *
 * Fetches each feed with a hard timeout (serverless functions have a wall
 * clock), normalises items into RawArticle, and never lets one bad feed abort
 * the whole run — failures are collected and reported.
 */

import Parser from "rss-parser";
import { enabledSources, type Source } from "./sources";
import {
  articleId,
  canonicalUrl,
  firstImage,
  htmlToText,
  truncate,
} from "./parser";
import type { RawArticle } from "@/types/article";

type FeedItem = {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  content?: string;
  "content:encoded"?: string;
  contentSnippet?: string;
  enclosure?: { url?: string };
  ["media:content"]?: { $?: { url?: string } };
};

const parser: Parser<unknown, FeedItem> = new Parser<unknown, FeedItem>({
  timeout: 12000,
  headers: { "User-Agent": "InkSocietyBot/1.0 (+https://ink-society.vercel.app)" },
  customFields: {
    item: [
      ["content:encoded", "content:encoded"],
      ["media:content", "media:content"],
    ],
  },
});

const MAX_CONTENT_CHARS = 8000;

export interface CollectResult {
  articles: RawArticle[];
  errors: Array<{ source: string; error: string }>;
}

function extractImage(item: FeedItem): string | null {
  const media = item["media:content"]?.$?.url;
  if (media) return media;
  if (item.enclosure?.url) return item.enclosure.url;
  return firstImage(item["content:encoded"] ?? item.content);
}

function toRawArticle(source: Source, item: FeedItem): RawArticle | null {
  const link = item.link?.trim();
  if (!link) return null;

  const rawBody =
    item["content:encoded"] ?? item.content ?? item.contentSnippet ?? "";
  const content = truncate(htmlToText(rawBody), MAX_CONTENT_CHARS);
  const publishedRaw = item.isoDate ?? item.pubDate;
  const published_at = publishedRaw
    ? new Date(publishedRaw).toISOString()
    : new Date().toISOString();

  const url = canonicalUrl(link);

  return {
    id: articleId(url),
    title: (item.title ?? "Untitled").trim(),
    url,
    source: source.name,
    content,
    published_at,
    image: extractImage(item),
    collected_at: new Date().toISOString(),
  };
}

/** Fetch a single feed. Returns [] on failure (error surfaced by caller). */
export async function fetchFeed(source: Source): Promise<RawArticle[]> {
  const feed = await parser.parseURL(source.url);
  const items = feed.items ?? [];
  return items
    .map((item) => toRawArticle(source, item))
    .filter((a): a is RawArticle => a !== null);
}

/** Fetch all enabled feeds concurrently; isolate per-feed failures. */
export async function collectAll(sources = enabledSources()): Promise<CollectResult> {
  const settled = await Promise.allSettled(
    sources.map(async (s) => ({ source: s, articles: await fetchFeed(s) }))
  );

  const articles: RawArticle[] = [];
  const errors: CollectResult["errors"] = [];

  settled.forEach((res, i) => {
    if (res.status === "fulfilled") {
      articles.push(...res.value.articles);
    } else {
      errors.push({
        source: sources[i].name,
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
    }
  });

  return { articles, errors };
}
