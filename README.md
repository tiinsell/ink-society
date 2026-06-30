# 🖋 Ink Society

> A private, AI-powered **marketing intelligence engine**. It collects global
> marketing content, distills it into structured **Persian intelligence** using
> Groq, stores it in Upstash Redis, and publishes high-value insights to
> Telegram — **fully serverless, zero infrastructure**.

Runs entirely on **Vercel + Upstash Redis + Groq + Telegram**, scheduled by
**cron-job.org**. No Docker, no VPS, no Postgres, no workers.

---

## Architecture

```
cron-job.org ──▶ /api/cron/daily  ──┐
                                    ├─▶ collect (RSS) ─▶ dedupe (Redis) ─▶ store raw
                                    │                                       │
                                    │                                       ▼
                                    ├─▶ process (Groq) ─▶ importance gate (>=7)
                                    │                                       │
                                    │                                       ▼
                                    └─▶ publish (Telegram) ◀── index (tags/category)

cron-job.org ──▶ /api/cron/weekly ─▶ aggregate week ─▶ Groq report ─▶ store + publish

users ──▶ /api/search?q= ─▶ Redis scan + rank (importance · recency · relevance)
Telegram bot ──▶ /api/webhook/telegram ─▶ /search /tag /category /report
```

### Project structure

```
app/
  api/
    collect/route.ts        POST  fetch RSS, dedupe, store, enqueue
    process/route.ts        POST  Groq analysis + importance gate
    publish/route.ts        POST  deliver to Telegram
    search/route.ts         GET   keyword/tag/category search (rate-limited)
    status/route.ts         GET   health + queue depths
    cron/daily/route.ts     GET   full daily pipeline
    cron/weekly/route.ts    GET   weekly intelligence report
    webhook/telegram/route.ts  POST bot commands · GET register webhook
  layout.tsx · page.tsx     minimal landing page
lib/
  config.ts    env + validation        redis.ts    Upstash repo + queues
  rss.ts       feed collection         groq.ts     AI analysis + report
  telegram.ts  publishing/formatting   parser.ts   html→text, id, reading time
  scoring.ts   importance gate + rank  sources.ts  RSS source list
  search.ts    search service          pipeline.ts orchestration (collect/process/...)
types/
  article.ts · analysis.ts
utils/
  dedupe.ts · ranker.ts · auth.ts · ratelimit.ts
```

---

## Setup

### 1. Provision services (all free tiers)

| Service        | What you need                                              |
| -------------- | --------------------------------------------------------- |
| Upstash Redis  | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`      |
| Groq           | `GROQ_API_KEY`                                            |
| Telegram       | Bot token (via @BotFather), channel id (e.g. `@mychannel`) |
| cron-job.org   | account to schedule the daily/weekly triggers            |

Add the bot as an **admin** of your Telegram channel so it can post.

### 2. Environment variables

Copy `.env.example` → `.env` (local) and set the same variables in the Vercel
project settings. Generate strong random values for `CRON_SECRET` and
`TELEGRAM_WEBHOOK_SECRET`:

```bash
openssl rand -hex 32
```

### 3. Install & run locally

```bash
npm install
npm run typecheck     # strict type check
npm run build         # production build
npm run dev           # http://localhost:3000
```

### 4. Deploy

```bash
npm i -g vercel
vercel --prod
```

Set all env vars in the Vercel dashboard (Project → Settings → Environment
Variables), then redeploy.

---

## Wiring up automation (cron-job.org)

Create two jobs. Authenticate with the shared secret via the query string
(simplest for cron-job.org) **or** an `Authorization: Bearer` header.

| Job    | URL                                                              | Schedule       |
| ------ | --------------------------------------------------------------- | -------------- |
| Daily  | `https://<app>.vercel.app/api/cron/daily?secret=CRON_SECRET`    | e.g. every 6h  |
| Weekly | `https://<app>.vercel.app/api/cron/weekly?secret=CRON_SECRET`   | weekly         |

## Register the Telegram webhook (optional — enables bot search)

```bash
curl "https://<app>.vercel.app/api/webhook/telegram?secret=CRON_SECRET&url=https://<app>.vercel.app/api/webhook/telegram"
```

This sets the webhook **and** registers `TELEGRAM_WEBHOOK_SECRET` as the secret
token Telegram echoes back, so the endpoint rejects forged requests.

---

## API reference

All write/cron endpoints require the secret:
`Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`.

| Endpoint | Method | Auth | Description |
| --- | --- | --- | --- |
| `/api/collect` | POST/GET | secret | Fetch feeds, dedupe, store raw, enqueue |
| `/api/process?limit=5` | POST/GET | secret | Groq analysis + importance gate |
| `/api/publish?limit=10` | POST/GET | secret | Publish queued insights to Telegram |
| `/api/search?q=&tag=&category=&limit=` | GET | public, rate-limited | Search stored intelligence |
| `/api/cron/daily` | GET/POST | secret | Collect → process → publish |
| `/api/cron/weekly?publish=true` | GET/POST | secret | Generate + store + publish report |
| `/api/webhook/telegram` | POST | Telegram secret token | Bot commands |
| `/api/status` | GET | public | Health + queue depths |

### AI output contract

Groq is forced to return **strict JSON only** (`response_format: json_object`,
`temperature: 0`) matching:

```json
{
  "category": "",
  "importance_score": 7,
  "summary_fa": "",
  "key_takeaways": [],
  "why_it_matters": "",
  "action_item": "",
  "best_for": "",
  "ai_insight": "",
  "tags": []
}
```

Only articles with `importance_score >= IMPORTANCE_THRESHOLD` (default **7**)
are stored as intelligence and published; the rest are discarded.

### Redis key schema

```
articles:{id}            StoredArticle (raw + enriched)
analysis:{id}            Analysis JSON
index:articles           ZSET  member=id score=collected ms (recency)
index:tags:{tag}         SET   ids
index:category:{cat}     SET   ids
dedupe:url:{id}          string TTL  (duplicate guard)
queue:process            LIST  ids awaiting AI
queue:publish            LIST  ids awaiting Telegram
report:weekly:{isoWeek}  WeeklyReport JSON
index:reports            ZSET  member=isoWeek score=generated ms
cache:search:{...}       cached search responses (TTL)
ratelimit:search:{ip}:{w}  fixed-window counter
```

---

## Design notes

- **Models** — primary `llama-3.1-70b-versatile`, automatic fallback to
  `mixtral-8x7b-32768`. Both configurable via env; if Groq retires a model,
  change `GROQ_MODEL` without code edits.
- **Bounded runs** — each stage is capped (`MAX_ARTICLES_PER_RUN`,
  `AI_BATCH_SIZE`) so a function always finishes within Vercel's limit;
  leftovers stay queued for the next invocation.
- **Resilience** — one failing feed never aborts a run; transient Groq/Telegram
  errors re-enqueue the item instead of dropping it.
- **Minimal Groq usage** — dedupe before analysis, importance gate before
  storage, search results cached in Redis.
- **Security** — secrets only in env; cron/admin endpoints behind a shared
  secret with constant-time comparison; Telegram webhook behind Telegram's
  secret-token header; public search is IP rate-limited.
```
