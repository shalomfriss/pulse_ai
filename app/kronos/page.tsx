import type { Metadata } from "next";
import { requireChatGPTUser } from "../chatgpt-auth";
import TopbarNav from "../topbar-nav";
import "./kronos.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Kronos — Pulse AI",
  description: "Local Kronos financial-market foundation model workbench.",
};

export default async function KronosPage() {
  await requireChatGPTUser("/kronos");
  return (
    <main className="kronos-shell">
      <header className="kronos-shell-header">
        <a className="brand" href="/command-center" aria-label="Pulse command center"><span className="brand-mark">P</span><span>PULSE<span className="brand-dot">•</span>AI</span></a>
        <TopbarNav activeHref="/kronos" />
        <div className="kronos-local-badge"><span className="live-dot" /> LOCAL MODEL WORKBENCH</div>
      </header>
      <section className="kronos-intro"><div><span className="eyebrow">KRONOS / LOCAL FOUNDATION MODEL</span><h1>Forecast the language<br /><em>of the market.</em></h1><p>Kronos is an open-source foundation model trained to read financial candlestick sequences. It tokenizes multi-dimensional OHLCV data and uses an autoregressive Transformer to generate probabilistic future paths across markets and timeframes.</p><p>Run the full workbench locally: load OHLCV data, choose a model and device, tune temperature, nucleus sampling, and sample count, generate forecasts, compare them with actuals, and save prediction results.</p><a className="kronos-repo-link" href="https://github.com/shiyu-coder/Kronos" target="_blank" rel="noreferrer">VIEW KRONOS ON GITHUB ↗</a></div><aside><strong>LOCAL ONLY</strong><span>Flask service · port 7071</span><small>The workbench runs beside Pulse AI and is available only from this local app session.</small></aside></section>
      <iframe className="kronos-frame" src="http://localhost:7071" title="Kronos financial prediction workbench" />
    </main>
  );
}
