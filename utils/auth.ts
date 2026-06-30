/**
 * Endpoint authorization helpers.
 *
 * Cron + admin endpoints require the shared CRON_SECRET, accepted either as
 *   Authorization: Bearer <secret>
 * or (for cron-job.org URL configs) as ?secret=<secret>.
 *
 * The Telegram webhook is protected by Telegram's own secret-token header.
 */

import { config } from "@/lib/config";

/** Constant-time-ish string comparison to avoid trivial timing leaks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAuthorized(req: Request): boolean {
  const secret = config.security.cronSecret;
  if (!secret) return false; // fail closed when unconfigured

  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (bearer && safeEqual(bearer, secret)) return true;

  const url = new URL(req.url);
  const qp = url.searchParams.get("secret") ?? "";
  return qp.length > 0 && safeEqual(qp, secret);
}

export function isTelegramAuthorized(req: Request): boolean {
  const expected = config.telegram.webhookSecret;
  if (!expected) return false; // fail closed
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  return got.length > 0 && safeEqual(got, expected);
}

export function unauthorized(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
