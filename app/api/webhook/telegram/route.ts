import { isAuthorized, unauthorized } from "@/utils/auth";
import { isTelegramAuthorized } from "@/utils/auth";
import { sendReply, setWebhook, formatReportMessage } from "@/lib/telegram";
import { escapeHtml } from "@/lib/telegram";
import { search } from "@/lib/search";
import { getReport, latestReportId } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TelegramUpdate {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
}

const HELP = `🖋 <b>Ink Society</b>
دستورات:
/search &lt;عبارت&gt; — جستجو در پایگاه دانش
/tag &lt;برچسب&gt; — جستجو بر اساس برچسب
/category &lt;دسته&gt; — جستجو بر اساس دسته
/report — آخرین گزارش هفتگی`;

/**
 * POST /api/webhook/telegram
 * Receives bot updates. Authenticated by Telegram's secret-token header.
 * Always returns 200 quickly so Telegram doesn't retry.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isTelegramAuthorized(req)) return unauthorized();

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return Response.json({ ok: true });
  }

  const chatId = update.message?.chat?.id;
  const text = (update.message?.text ?? "").trim();
  if (!chatId || !text) return Response.json({ ok: true });

  try {
    await handleCommand(chatId, text);
  } catch (err) {
    try {
      await sendReply(chatId, `⚠️ خطا: ${escapeHtml(String(err))}`);
    } catch {
      // swallow — never fail the webhook
    }
  }

  return Response.json({ ok: true });
}

async function handleCommand(chatId: number | string, text: string): Promise<void> {
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, ""); // strip @botname
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "/start":
    case "/help":
      await sendReply(chatId, HELP);
      return;

    case "/search": {
      if (!arg) return void (await sendReply(chatId, "عبارت جستجو را وارد کنید: /search seo"));
      await replyWithResults(chatId, await searchSafe({ q: arg, limit: 5 }));
      return;
    }
    case "/tag": {
      if (!arg) return void (await sendReply(chatId, "برچسب را وارد کنید: /tag seo"));
      await replyWithResults(chatId, await searchSafe({ tag: arg, limit: 5 }));
      return;
    }
    case "/category": {
      if (!arg) return void (await sendReply(chatId, "دسته را وارد کنید: /category SEO"));
      await replyWithResults(chatId, await searchSafe({ category: arg, limit: 5 }));
      return;
    }
    case "/report": {
      const id = await latestReportId();
      const report = id ? await getReport(id) : null;
      if (!report) return void (await sendReply(chatId, "هنوز گزارشی ثبت نشده است."));
      await sendReply(chatId, formatReportMessage(report));
      return;
    }
    default:
      await sendReply(chatId, HELP);
  }
}

async function searchSafe(q: Parameters<typeof search>[0]) {
  return search(q);
}

async function replyWithResults(
  chatId: number | string,
  res: Awaited<ReturnType<typeof search>>
): Promise<void> {
  if (res.results.length === 0) {
    await sendReply(chatId, "نتیجه‌ای یافت نشد.");
    return;
  }
  const lines = res.results
    .map(
      (r, i) =>
        `${i + 1}. <a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a>\n` +
        `   ⭐ ${r.importance_score}/10 · 🏷 ${escapeHtml(r.category)}`
    )
    .join("\n");
  await sendReply(chatId, `🔍 <b>${res.count} نتیجه</b>\n\n${lines}`);
}

/**
 * GET /api/webhook/telegram?secret=<CRON_SECRET>&url=<public-webhook-url>
 * Admin helper to register the webhook with Telegram (sets the secret token).
 */
export async function GET(req: Request): Promise<Response> {
  if (!isAuthorized(req)) return unauthorized();
  const url = new URL(req.url);
  const webhookUrl = url.searchParams.get("url");
  if (!webhookUrl) {
    return Response.json(
      { ok: false, error: "pass ?url=<https public webhook url>" },
      { status: 400 }
    );
  }
  try {
    const result = await setWebhook(webhookUrl);
    return Response.json({ ok: true, result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
