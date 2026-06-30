import type { ReactNode } from "react";

export const metadata = {
  title: "Ink Society — Marketing Intelligence",
  description:
    "AI-powered marketing intelligence engine. Serverless on Vercel + Upstash + Groq + Telegram.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#0b0f17",
          color: "#e6edf3",
        }}
      >
        {children}
      </body>
    </html>
  );
}
