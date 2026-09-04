import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "server-lab",
  description: "Interactive experiments for latency, load balancing, replication, and availability.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
