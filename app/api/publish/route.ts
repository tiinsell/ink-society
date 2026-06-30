import { isAuthorized, unauthorized } from "@/utils/auth";
import { runPublish } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/publish?limit=10
 * Deliver queued high-value articles to the Telegram channel and mark them sent.
 * Protected by CRON_SECRET.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) return unauthorized();
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit")) || 10;
    const summary = await runPublish(limit);
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(req: Request): Promise<Response> {
  return POST(req);
}
