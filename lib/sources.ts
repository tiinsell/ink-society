/**
 * Marketing RSS sources.
 *
 * Each source has a stable `name` (used as the stored `source` field) and a
 * feed URL. Feeds occasionally move; keeping them in one place makes them easy
 * to maintain. Disabled sources can be toggled with `enabled: false` instead of
 * being deleted, so history is preserved.
 */

export interface Source {
  name: string;
  url: string;
  enabled?: boolean;
}

export const SOURCES: Source[] = [
  { name: "HubSpot", url: "https://blog.hubspot.com/marketing/rss.xml" },
  { name: "Ahrefs", url: "https://ahrefs.com/blog/feed/" },
  { name: "Semrush", url: "https://www.semrush.com/blog/feed/" },
  { name: "Moz", url: "https://moz.com/blog/feed" },
  {
    name: "Search Engine Journal",
    url: "https://www.searchenginejournal.com/feed/",
  },
  {
    name: "Search Engine Land",
    url: "https://searchengineland.com/feed",
  },
  { name: "Backlinko", url: "https://backlinko.com/feed" },
  { name: "Neil Patel", url: "https://neilpatel.com/blog/feed/" },
  {
    name: "Content Marketing Institute",
    url: "https://contentmarketinginstitute.com/feed/",
  },
  { name: "MarketingProfs", url: "https://www.marketingprofs.com/rss/articles.xml" },
  {
    name: "Social Media Examiner",
    url: "https://www.socialmediaexaminer.com/feed/",
  },
  { name: "Buffer", url: "https://buffer.com/resources/rss/" },
  { name: "Hootsuite", url: "https://blog.hootsuite.com/feed/" },
  {
    name: "Google Search Central",
    url: "https://developers.google.com/search/blog/feed.xml",
  },
  {
    name: "Meta Business Blog",
    url: "https://www.facebook.com/business/news/rss",
  },
  {
    name: "LinkedIn Marketing Blog",
    url: "https://www.linkedin.com/business/marketing/blog/rss",
  },
];

export function enabledSources(): Source[] {
  return SOURCES.filter((s) => s.enabled !== false);
}
