import { isAuthorized, unauthorized } from "@/utils/auth";
import { runDaily } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/cron/daily  (triggered by cron-job.org)
 * Full pipeline: collect RSS -> AI analysis -> publish to Telegram.
 * Protected by CRON_SECRET.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) return unauthorized();
  try {
    const summary = await runDaily();
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
