export const dynamic = "force-static";

const ENDPOINTS: Array<[string, string]> = [
  ["POST /api/collect", "Fetch RSS feeds, dedupe, store raw articles"],
  ["POST /api/process", "Run Groq analysis + importance gate"],
  ["POST /api/publish", "Publish high-value insights to Telegram"],
  ["GET  /api/search?q=", "Keyword / tag / category search"],
  ["GET  /api/cron/daily", "Full daily pipeline (cron-job.org)"],
  ["GET  /api/cron/weekly", "Weekly intelligence report (cron-job.org)"],
  ["POST /api/webhook/telegram", "Telegram bot commands"],
  ["GET  /api/status", "Health + queue depths"],
];

export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 40, margin: 0 }}>🖋 Ink Society</h1>
      <p style={{ color: "#9fb0c3", fontSize: 18, lineHeight: 1.6 }}>
        A private AI-powered marketing intelligence engine. It collects global
        marketing content, distills it into structured Persian intelligence with
        Groq, and publishes high-value insights to Telegram — fully serverless.
      </p>

      <h2 style={{ marginTop: 40, fontSize: 20 }}>API</h2>
      <ul style={{ lineHeight: 2, listStyle: "none", padding: 0 }}>
        {ENDPOINTS.map(([route, desc]) => (
          <li key={route}>
            <code
              style={{
                background: "#161b22",
                padding: "2px 8px",
                borderRadius: 6,
                color: "#7ee787",
              }}
            >
              {route}
            </code>{" "}
            <span style={{ color: "#9fb0c3" }}>— {desc}</span>
          </li>
        ))}
      </ul>

      <p style={{ marginTop: 40, color: "#6e7b8a", fontSize: 14 }}>
        Vercel · Upstash Redis · Groq · Telegram
      </p>
    </main>
  );
}
