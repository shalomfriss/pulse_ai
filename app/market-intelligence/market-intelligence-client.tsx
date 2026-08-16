"use client";

import { FormEvent, useState } from "react";
import ThemeToggle from "../theme-toggle";

type CompanyAnalysis = {
  symbol:string;companyName:string;product:string;direction:string;category:string;
  sentiment:"positive"|"mixed"|"cautious";sentimentScore:number;raceScore:number;confidence:number;
  mentionCount:number;productMentionCount:number;keySignals:string[];
};
type Headline = { id:number;headline:string;summary:string;source:string;createdAt:string;url:string;tone:number;productHits:string[];positive:string[];negative:string[] };
type RaceCompany = CompanyAnalysis & { rank:number;isTarget:boolean };
type IntelligenceResponse = {
  error?:string;
  company?:{ ticker:string;name:string };
  period?:{ start:string;end:string;days:number };
  analysis?:CompanyAnalysis;
  headlines?:Headline[];
  race?:RaceCompany[];
  verdict?:{ leader:string;advantage:string;category:string };
  methodology?:string;
};

const examples = ["NVIDIA","Microsoft","Tesla","Salesforce"];

function toneLabel(score:number) { return score >= 61 ? "POSITIVE" : score <= 42 ? "CAUTIOUS" : "MIXED"; }
function shortDate(value:string) { return new Date(value).toLocaleDateString([], { month:"short",day:"numeric" }).toUpperCase(); }

export default function MarketIntelligenceClient({ displayName }:{ displayName:string }) {
  const [company,setCompany] = useState("NVIDIA");
  const [result,setResult] = useState<IntelligenceResponse | null>(null);
  const [loading,setLoading] = useState(false);

  async function analyze(event?:FormEvent) {
    event?.preventDefault();
    if (!company.trim() || loading) return;
    setLoading(true);setResult(null);
    try {
      const response = await fetch("/api/market-intelligence",{ method:"POST",headers:{ "content-type":"application/json" },body:JSON.stringify({ company }) });
      const payload = await response.json() as IntelligenceResponse;
      if (!response.ok) throw new Error(payload.error || "Analysis unavailable.");
      setResult(payload);
    } catch (error) {
      setResult({ error:error instanceof Error ? error.message : "Analysis unavailable." });
    } finally { setLoading(false); }
  }

  const analysis = result?.analysis;
  return <main className="market-intelligence-page">
    <header className="topbar">
      <a className="brand" href="/command-center" aria-label="Pulse command center"><span className="brand-mark">P</span><span>PULSE<span className="brand-dot">•</span>AI</span></a>
      <nav aria-label="Primary navigation">
        <a href="/command-center">Command Center</a><a href="/signals">Signals</a><a href="/company-analysis">Company Analysis</a><a className="nav-active" href="/market-intelligence">Market Intelligence</a><a href="/valuation">Valuation</a><details className="nav-more"><summary aria-label="Open more navigation links">More <span aria-hidden="true">⌄</span></summary><div className="nav-more-menu"><a href="/mass-valuation">Mass Valuation</a><a href="/candlestick">Candlestick</a><a href="/why-these-decisions">Why These Decisions</a><a href="/strategy-lab">Strategy Lab</a><a href="/positions">Positions</a><a href="/transactions">Transactions</a><a href="/news-radar">News Radar</a><a href="/settings">Settings</a></div></details>
      </nav>
      <ThemeToggle />
      <div className="market-state"><span className="live-dot" /> 30-DAY NEWS <b>COMPETITIVE LENS</b><a className="account-button analysis-account" href="/settings">{displayName}</a></div>
    </header>

    <section className="intel-hero">
      <div className="intel-hero-copy"><span className="eyebrow">PRODUCT-RACE INTELLIGENCE</span><h1>See where a company is going—<em>and who could get there first.</em></h1><p>Pulse reads the last month of company news, identifies the product carrying the strategy, then benchmarks its closest rivals on evidence, sentiment, and momentum.</p></div>
      <form className="intel-search" onSubmit={analyze}>
        <label htmlFor="intel-company">COMPANY OR STOCK TICKER</label>
        <div><input id="intel-company" value={company} onChange={(event) => setCompany(event.target.value)} placeholder="e.g. NVIDIA or NVDA" autoComplete="organization" /><button disabled={loading}>{loading ? "READING THE MARKET…" : "ANALYZE THE RACE →"}</button></div>
        <p>Try {examples.map((example,index) => <button type="button" key={example} onClick={() => setCompany(example)}>{example}{index < examples.length-1 ? "," : ""}</button>)}</p>
      </form>
    </section>

    {loading && <section className="intel-loading" aria-live="polite"><div><i /><i /><i /></div><strong>Collecting 30 days of evidence</strong><p>Matching the company, reading headlines and summaries, identifying the spearhead product, then scoring its competitive set.</p></section>}
    {result?.error && <section className="intel-error" role="alert"><span>!</span><div><strong>RESEARCH UNAVAILABLE</strong><p>{result.error}</p><a href="/settings">OPEN SETTINGS →</a></div></section>}

    {analysis && result.company && <>
      <section className="intel-brief" aria-live="polite">
        <header><div><small>30-DAY DIRECTION BRIEF</small><h2>{result.company.name}</h2><span>${result.company.ticker} · {result.period ? `${shortDate(result.period.start)}—${shortDate(result.period.end)}` : "PAST MONTH"}</span></div><div className={`intel-sentiment sentiment-${analysis.sentiment}`}><small>DIRECTION SENTIMENT</small><strong>{analysis.sentimentScore}</strong><span>{analysis.sentiment.toUpperCase()} · {analysis.confidence}% confidence</span></div></header>
        <div className="intel-thesis-grid">
          <article className="intel-thesis"><span>01</span><small>THE DIRECTION</small><h3>{analysis.direction}</h3><p>The clearest strategic vector across the month’s launches, partnerships, customer signals, and risks.</p></article>
          <article className="intel-product"><span>02</span><small>THE SPEARHEAD PRODUCT</small><h3>{analysis.product}</h3><p><b>{analysis.productMentionCount}</b> directly relevant stories inside <b>{analysis.mentionCount}</b> company headlines.</p><div>{analysis.keySignals.length ? analysis.keySignals.map((signal) => <i key={signal}>{signal}</i>) : <i>Insufficient explicit signal terms</i>}</div></article>
          <article className="intel-score"><span>03</span><small>EXECUTION MOMENTUM</small><strong>{analysis.raceScore}</strong><div className="intel-meter"><i style={{ width:`${analysis.raceScore}%` }} /></div><p>A comparative score built from product relevance, news tone, launches, partnerships, customer adoption, and recency.</p></article>
        </div>
      </section>

      <section className="intel-headlines">
        <header><div><small>THE EVIDENCE</small><h2>Latest company headlines</h2></div><p>{result.headlines?.length ?? 0} stories mentioning {result.company.name} in the past month, newest first.</p></header>
        <div className="intel-headline-grid">{result.headlines?.length ? result.headlines.map((item) => <article key={item.id}>
          <div><span className={`headline-tone ${item.tone >= 61 ? "up" : item.tone <= 42 ? "down" : ""}`}>{item.tone}</span><small>{item.source} · {shortDate(item.createdAt)}</small><b>{toneLabel(item.tone)}</b></div>
          <h3>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.headline}</a> : item.headline}</h3>
          {item.summary && <p>{item.summary}</p>}
          <footer>{item.productHits.length ? <span>PRODUCT SIGNAL · {item.productHits.join(", ")}</span> : <span>COMPANY SIGNAL</span>} {item.url && <a href={item.url} target="_blank" rel="noreferrer">READ SOURCE ↗</a>}</footer>
        </article>) : <div className="intel-no-news"><strong>No matching stories were returned.</strong><p>Try the ticker directly or rerun after the provider publishes new coverage.</p></div>}</div>
      </section>

      <section className="intel-race">
        <header><div><small>COMPETITIVE ANALYSIS</small><h2>Who looks most likely to win the {result.verdict?.category} race?</h2></div><p>{result.verdict?.advantage}</p></header>
        <div className="race-table" role="table" aria-label="Competitive product race ranking">
          <div className="race-row race-head" role="row"><span>RANK / COMPANY</span><span>SPEARHEAD PRODUCT</span><span>NEWS TONE</span><span>PRODUCT PROOF</span><span>RACE SCORE</span></div>
          {result.race?.map((item) => <div className={`race-row ${item.isTarget ? "race-target" : ""}`} role="row" key={item.symbol}>
            <span><i>#{item.rank}</i><b>{item.companyName}</b><small>${item.symbol}{item.isTarget ? " · SELECTED" : ""}</small></span>
            <span><b>{item.product}</b><small>{item.direction}</small></span>
            <span><b className={item.sentimentScore >= 61 ? "up" : item.sentimentScore <= 42 ? "down" : ""}>{item.sentimentScore}</b><small>{item.sentiment.toUpperCase()}</small></span>
            <span><b>{item.productMentionCount}</b><small>of {item.mentionCount} stories</small></span>
            <span className="race-score-cell"><strong>{item.raceScore}</strong><i><em style={{ width:`${item.raceScore}%` }} /></i></span>
          </div>)}
        </div>
        <aside><span>LEADER</span><strong>{result.verdict?.leader}</strong><p>Highest current evidence score—not a permanent moat or investment recommendation. Re-run as the news cycle changes.</p></aside>
      </section>

      <footer className="intel-method"><span>PULSE•AI / MARKET INTELLIGENCE</span><p>{result.methodology}</p><span>INFORMATIONAL · NOT INVESTMENT ADVICE</span></footer>
    </>}

    {!result && !loading && <section className="intel-empty"><span>30D</span><div><small>READY FOR A COMPETITIVE READ</small><h2>One company in.<br />The whole product race out.</h2></div><ol><li><b>01</b> Latest headlines</li><li><b>02</b> Direction + product</li><li><b>03</b> Competitor ranking</li></ol></section>}
  </main>;
}
