import { isAuthorized, unauthorized } from "@/utils/auth";
import { runWeekly } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/cron/weekly  (triggered by cron-job.org)
 * Generate the weekly intelligence report, store it, and publish to Telegram.
 * Pass ?publish=false to store only.
 * Protected by CRON_SECRET.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) return unauthorized();
  try {
    const url = new URL(req.url);
    const publish = url.searchParams.get("publish") !== "false";
    const summary = await runWeekly({ publish });
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
