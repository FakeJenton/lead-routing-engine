import type { Metadata } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead Routing Engine",
  description:
    "A lead scoring, matching, routing, and monitoring system with an auditable decision trail. Synthetic B2B GTM demo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="suitebar">
          <div className="wrap">
            <a className="suite-brand" href="https://gtm-command-center-phi.vercel.app">
              <span className="suite-mark">G</span>
              <span>GTM Command Center</span>
            </a>
            <nav className="suite-mods">
              <a className="active" href="/">Lead Routing</a>
              <a href="https://deal-trajectory-engine.vercel.app">Deal Trajectory</a>
            </nav>
          </div>
        </div>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="brand">
              <span className="dot">LR</span>
              <span>Lead Routing Engine</span>
            </Link>
            <nav className="nav">
              <Link href="/">Dashboard</Link>
              <Link href="/simulator">Try a lead</Link>
              <Link href="/trends">Trends</Link>
              <Link href="/methodology">How it works</Link>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="footer">
          <div className="wrap">
            <span>
              Synthetic data. Built to demonstrate lead routing logic (scoring,
              matching, distribution, guardrails).
            </span>
            <span>Python engine + Next.js dashboard</span>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
