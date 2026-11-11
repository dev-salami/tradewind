import type { Metadata } from "next";
import { Sora } from "next/font/google";
import { AppShell } from "@/components/chrome";
import { TopBanner } from "@/components/top-banner";
import { data, isFixtureMode, network } from "@/lib/data";
import "./globals.css";
const sora = Sora({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-sora", display: "swap" });
export const metadata: Metadata = { title: { default: "Tradewind", template: "%s · Tradewind" }, description: "Get paid today for invoices your buyers pay in 60 days." };
// Live views should never be frozen into a build-time static snapshot.
export const dynamic = "force-dynamic";
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let secondsPerDay: number | null = null;
  try { secondsPerDay = (await data().getConfig()).seconds_per_day; } catch { /* Honest unavailable state; never substitute fixture config for RPC errors. */ }
  return <html lang="en"><body className={sora.variable}>
    <TopBanner network={network()} secondsPerDay={secondsPerDay} fixtures={isFixtureMode()} />
    <AppShell network={network()}>{children}</AppShell>
  </body></html>;
}
