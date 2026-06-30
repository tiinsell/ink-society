import { queueDepths, recentArticleIds, latestReportId } from "@/lib/redis";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/status — lightweight health + operational metrics.
 * Public (no secrets exposed): only counts and configuration booleans.
 */
export async function GET(): Promise<Response> {
  const configured = {
    redis: Boolean(config.redis.url && config.redis.token),
    groq: Boolean(config.groq.apiKey),
    telegram: Boolean(config.telegram.botToken && config.telegram.channelId),
    cronSecret: Boolean(config.security.cronSecret),
    telegramWebhookSecret: Boolean(config.telegram.webhookSecret),
  };

  if (!configured.redis) {
    return Response.json({ ok: true, configured, redis: "unconfigured" });
  }

  try {
    const [queues, recent, latestReport] = await Promise.all([
      queueDepths(),
      recentArticleIds(1),
      latestReportId(),
    ]);
    return Response.json({
      ok: true,
      configured,
      queues,
      hasArticles: recent.length > 0,
      latestReport,
      threshold: config.tuning.importanceThreshold,
    });
  } catch (err) {
    return Response.json(
      { ok: false, configured, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
