import { isAuthorized, unauthorized } from "@/utils/auth";
import { runCollect } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/collect
 * Fetch all RSS feeds, dedupe, store new raw articles, enqueue for processing.
 * Protected by CRON_SECRET.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) return unauthorized();
  try {
    const summary = await runCollect();
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
