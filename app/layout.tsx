import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://pulse-ai-market-agent.shalomfrissgmail-com.chatgpt.site"),
  title: "Pulse AI — Autonomous Market Intelligence",
  description: "Company news, strategic direction, spearhead-product sentiment, competitor race analysis, valuation research, and explainable Alpaca market signals.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Pulse AI — Market Intelligence",
    description: "See where a company is going, the product spearheading that direction, and which competitor looks most likely to win the race.",
    images: [{ url: "/og-market-intelligence.png", width: 1536, height: 1024, alt: "Pulse AI Market Intelligence product-race analysis" }],
  },
  twitter: { card: "summary_large_image", images: ["/og-market-intelligence.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var saved=localStorage.getItem("pulse-theme");var theme=saved==="dark"||saved==="light"?saved:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch(e){}})()` }} /></head><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
