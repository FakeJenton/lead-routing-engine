import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead Routing Engine",
  description:
    "A lead scoring, matching, routing, and monitoring system. Synthetic early-education GTM demo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="brand">
              <span className="dot">LR</span>
              <span>Lead Routing Engine</span>
            </Link>
            <nav className="nav">
              <Link href="/">Dashboard</Link>
              <Link href="/methodology">Methodology</Link>
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
      </body>
    </html>
  );
}
