/**
 * Centralised, validated configuration.
 *
 * Reads environment variables once and exposes a typed, defaulted config
 * object. Secrets are read lazily where needed so that a missing optional
 * secret never crashes an unrelated route at import time.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  groq: {
    apiKey: str("GROQ_API_KEY"),
    model: str("GROQ_MODEL", "llama-3.1-70b-versatile"),
    fallbackModel: str("GROQ_FALLBACK_MODEL", "mixtral-8x7b-32768"),
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
  },
  redis: {
    url: str("UPSTASH_REDIS_REST_URL"),
    token: str("UPSTASH_REDIS_REST_TOKEN"),
  },
  telegram: {
    botToken: str("TELEGRAM_BOT_TOKEN"),
    channelId: str("TELEGRAM_CHANNEL_ID"),
    webhookSecret: str("TELEGRAM_WEBHOOK_SECRET"),
  },
  security: {
    cronSecret: str("CRON_SECRET"),
  },
  tuning: {
    importanceThreshold: num("IMPORTANCE_THRESHOLD", 7),
    maxArticlesPerRun: num("MAX_ARTICLES_PER_RUN", 40),
    aiBatchSize: num("AI_BATCH_SIZE", 5),
    searchScanLimit: num("SEARCH_SCAN_LIMIT", 500),
    wordsPerMinute: num("WORDS_PER_MINUTE", 200),
    searchRateLimit: num("SEARCH_RATE_LIMIT", 30),
    searchRateWindow: num("SEARCH_RATE_WINDOW", 60),
    cacheTtlSearch: num("CACHE_TTL_SEARCH", 300),
    cacheTtlDedup: num("CACHE_TTL_DEDUP", 2592000),
  },
} as const;

/** Throw a clear error if a required secret group is missing. */
export function assertRedis(): void {
  if (!config.redis.url || !config.redis.token) {
    throw new Error(
      "Upstash Redis not configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN."
    );
  }
}

export function assertGroq(): void {
  if (!config.groq.apiKey) {
    throw new Error("Groq not configured: set GROQ_API_KEY.");
  }
}

export function assertTelegram(): void {
  if (!config.telegram.botToken || !config.telegram.channelId) {
    throw new Error(
      "Telegram not configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID."
    );
  }
}
