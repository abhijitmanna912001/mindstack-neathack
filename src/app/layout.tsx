import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "./_components/AppHeader";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "SignalScout AI",
    template: "%s · SignalScout AI",
  },
  description:
    "Discover and qualify B2B prospects against your ideal customer profile, with evidence-backed scores, budget-aware enrichment and draft outreach.",
  applicationName: "SignalScout AI",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <AppHeader />
        {children}
        <footer className="border-t border-slate-200 dark:border-slate-800">
          <p className="mx-auto w-full max-w-7xl px-4 py-4 text-xs text-slate-500 sm:px-6 lg:px-8 dark:text-slate-400">
            SignalScout AI · neatHack 2026 prototype. Synthetic data only; no
            live provider calls are made.
          </p>
        </footer>
      </body>
    </html>
  );
}
