import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import "./overload.css";
import "./replication.css";
import "./recovery.css";
import "./native.css";

export const metadata: Metadata = {
  title: "server-lab",
  description: "Interactive experiments for latency, load balancing, replication, consistency, recovery, coordination, native networking, queues, overload, and availability.",
};

const navLinkStyle = {
  padding: "9px 12px",
  color: "var(--muted)",
  border: "1px solid var(--line)",
  borderRadius: "10px",
  background: "var(--panel)",
  fontSize: "0.82rem",
  fontWeight: 700,
  textDecoration: "none",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <nav
          aria-label="Server lab lessons"
          style={{
            width: "min(1480px, calc(100% - 40px))",
            margin: "0 auto",
            paddingTop: "20px",
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          <Link href="/" style={navLinkStyle}>Routing &amp; capacity</Link>
          <Link href="/replication" style={navLinkStyle}>Replication &amp; consistency</Link>
          <Link href="/recovery" style={navLinkStyle}>Recovery &amp; coordination</Link>
          <Link href="/native" style={navLinkStyle}>Native network experiments</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
