import { isAuthorized, unauthorized } from "@/utils/auth";
import { runProcess } from "@/lib/pipeline";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/process?limit=5
 * Pull a batch of raw articles, run Groq analysis, apply the importance gate,
 * store + index kept articles, enqueue them for publishing.
 * Protected by CRON_SECRET.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) return unauthorized();
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit")) || config.tuning.aiBatchSize;
    const summary = await runProcess(limit);
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
