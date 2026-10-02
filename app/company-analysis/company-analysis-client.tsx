"use client";

import { FormEvent, useState } from "react";
import ThemeToggle from "../theme-toggle";
import TopbarNav from "../topbar-nav";

type Horizon = { value: number | null; yearsUsed: number };

type CompanyResult = {
  symbol: string;
  companyName?: string;
  error?: string;
  cik?: string;
  asOf?: string;
  score?: number;
  verdict?: string;
  roe?: Record<"1y" | "2y" | "3y" | "5y" | "10y", Horizon>;
  annualRoe?: { year: number; value: number | null }[];
  debtToEquity?: number | null;
  totalDebt?: number | null;
  shareholderEquity?: number | null;
  highDebtFlag?: boolean;
  negativeEquity?: boolean;
  earningsCagr?: number | null;
  dividendCagr?: number | null;
  positiveRoeYears?: number;
  yearsAnalyzed?: number;
  strengths?: string[];
  cautions?: string[];
  valuation?: {
    framework: string;
    revenue: number;
    revenueGrowth: number | null;
    operatingIncome: number | null;
    cashTaxRate: number | null;
    nopat: number;
    nopatMargin: number | null;
    investedCapital: number;
    roic: number | null;
    wacc: number | null;
    roicSpread: number | null;
    economicProfit: number | null;
    reinvestmentRate: number | null;
    normalizedFreeCashFlow: number | null;
    terminalGrowth: number | null;
    terminalRoic: number | null;
    forecastYears: number;
    forecast: { year: number; revenue: number; growth: number | null; nopat: number; roic: number | null; reinvestmentRate: number | null; freeCashFlow: number; presentValue: number; economicProfit: number }[];
    explicitPeriodPresentValue: number | null;
    continuingValue: number | null;
    continuingValuePresentValue: number | null;
    continuingValueShare: number | null;
    enterpriseValue: number | null;
    economicProfitValue: number | null;
    economicProfitCrossCheckDifference: number | null;
    cash: number | null;
    netDebt: number | null;
    equityValue: number | null;
    sharesOutstanding: number | null;
    marketCapitalization: number | null;
    fairValuePerShare: number | null;
    marketPrice: number | null;
    valuationGap: number | null;
    signal: string;
    scenarios: { name: string; growth: number | null; discountRate: number | null; perShare: number | null }[];
    sensitivity: { discountRates: (number | null)[]; rows: { terminalGrowth: number | null; values: { discountRate: number | null; perShare: number | null }[] }[] };
    waccBridge: { costOfEquity: number | null; preTaxCostOfDebt: number | null; afterTaxCostOfDebt: number | null; equityWeight: number | null; debtWeight: number | null; wacc: number | null };
    multiples: { modeledEvToNopat: number | null; marketEvToNopat: number | null; modeledEvToOperatingProfit: number | null; marketEvToOperatingProfit: number | null };
    conclusion: { rating: string; action: string; tone: "positive" | "neutral" | "negative"; summary: string; reasons: string[] };
    process: string[];
    coverage: { item: string; status: "included" | "estimated" | "review"; detail: string }[];
    assumptions: string[];
  } | null;
  sourceUrl?: string;
  methodology?: { roe: string; debt: string };
};

type AnalysisResponse = {
  analyzedAt?: string;
  results?: CompanyResult[];
  sourceNote?: string;
  error?: string;
};

type RankedCompany = CompanyResult & {
  massRank: number;
  investmentScore: number;
  rankingReasons: string[];
};

type MassSummary = {
  scanned: number;
  modeled: number;
  dataGaps: number;
  ranked: RankedCompany[];
};

// A broad, auditable large-cap universe rather than an opaque server-side screen.
// It intentionally contains 100 U.S.-listed operating companies and excludes ETFs.
const TOP_100_US_LARGE_CAPS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "BRK-B", "AVGO", "TSLA", "LLY",
  "JPM", "WMT", "V", "ORCL", "MA", "XOM", "COST", "NFLX", "JNJ", "HD",
  "PG", "ABBV", "BAC", "KO", "PLTR", "UNH", "CRM", "PM", "CSCO", "IBM",
  "CVX", "WFC", "ABT", "MCD", "GE", "CAT", "GS", "AXP", "NOW", "TMO",
  "DIS", "MS", "MRK", "RTX", "PEP", "ISRG", "UBER", "INTU", "BKNG", "QCOM",
  "AMD", "AMGN", "TXN", "SPGI", "NEE", "LOW", "AMAT", "PGR", "SCHW", "BLK",
  "DHR", "HON", "SYK", "UNP", "ETN", "PFE", "TJX", "LRCX", "VRTX", "BSX",
  "C", "ADP", "PANW", "DE", "GILD", "ADI", "CB", "MDT", "BMY", "MU",
  "SBUX", "MMC", "COP", "FI", "PLD", "SO", "ICE", "MO", "DUK", "SHW",
  "KLAC", "CME", "PH", "WM", "CDNS", "SNPS", "MCK", "UPS", "NKE", "APH",
] as const;

const horizons = [
  ["1y", "1 YEAR"],
  ["2y", "2 YEAR"],
  ["3y", "3 YEAR"],
  ["5y", "5 YEAR"],
  ["10y", "10 YEAR"],
] as const;

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? "N/A" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function compactMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "N/A";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "N/A";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function rankForInvestment(company: CompanyResult) {
  const valuation = company.valuation;
  if (!valuation?.fairValuePerShare) return null;
  const gap = valuation.valuationGap;
  const quality = company.score ?? 0;
  const roicSpread = valuation.roicSpread ?? 0;
  const leveragePenalty = company.highDebtFlag ? 12 : 0;
  const conclusionAdjustment = valuation.conclusion.tone === "positive" ? 8 : valuation.conclusion.tone === "negative" ? -8 : 0;
  const investmentScore = Math.round(
    Math.max(-100, Math.min(100, gap ?? 0)) * 0.55
    + quality * 0.25
    + Math.max(-20, Math.min(30, roicSpread)) * 0.75
    + conclusionAdjustment
    - leveragePenalty,
  );
  const rankingReasons = [
    gap === null ? "Market price unavailable; ranked on operating quality" : `${percent(gap)} modeled value gap`,
    `${quality}/100 business-quality score`,
    `${percent(roicSpread)} ROIC spread`,
    company.highDebtFlag ? "High leverage reduced the rank" : "No high-leverage flag",
  ];
  return { investmentScore, rankingReasons };
}

export default function CompanyAnalysisClient({ displayName, activeNav = "company" }: { displayName: string; activeNav?: "company" | "valuation" | "mass" }) {
  const [symbols, setSymbols] = useState("KO, AAPL, AMEX");
  const [response, setResponse] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [massProgress, setMassProgress] = useState(0);
  const [massSummary, setMassSummary] = useState<MassSummary | null>(null);

  async function analyze(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setResponse(null);
    try {
      const apiResponse = await fetch("/api/company-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbols }),
      });
      const result = (await apiResponse.json()) as AnalysisResponse;
      if (!apiResponse.ok) throw new Error(result.error || "Analysis unavailable.");
      setResponse(result);
    } catch (error) {
      setResponse({ error: error instanceof Error ? error.message : "Analysis unavailable." });
    } finally {
      setLoading(false);
    }
  }

  async function runMassValuation() {
    setLoading(true);
    setResponse(null);
    setMassSummary(null);
    setMassProgress(0);
    const allResults: CompanyResult[] = [];
    try {
      for (let offset = 0; offset < TOP_100_US_LARGE_CAPS.length; offset += 10) {
        const batch = TOP_100_US_LARGE_CAPS.slice(offset, offset + 10);
        const apiResponse = await fetch("/api/company-analysis", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ symbols: batch.join(",") }),
        });
        const result = (await apiResponse.json()) as AnalysisResponse;
        if (!apiResponse.ok) throw new Error(result.error || `Batch ${offset / 10 + 1} could not be analyzed.`);
        allResults.push(...(result.results ?? []));
        setMassProgress(Math.min(TOP_100_US_LARGE_CAPS.length, offset + batch.length));
      }

      const ranked = allResults
        .map((company) => ({ company, score: rankForInvestment(company) }))
        .filter((item): item is { company: CompanyResult; score: NonNullable<ReturnType<typeof rankForInvestment>> } => Boolean(item.score))
        .sort((a, b) => b.score.investmentScore - a.score.investmentScore)
        .slice(0, 10)
        .map((item, index) => ({ ...item.company, ...item.score, massRank: index + 1 }));

      if (!ranked.length) throw new Error("The scan finished, but no company had enough standardized filing data to build a responsible DCF.");
      const summary = {
        scanned: allResults.length,
        modeled: allResults.filter((company) => company.valuation?.fairValuePerShare).length,
        dataGaps: allResults.filter((company) => company.error || !company.valuation?.fairValuePerShare).length,
        ranked,
      };
      setMassSummary(summary);
      setResponse({
        analyzedAt: new Date().toISOString(),
        results: ranked,
        sourceNote: "Top 10 from the 100-stock U.S. large-cap universe, ranked by modeled value gap, business quality, ROIC spread, and leverage risk.",
      });
    } catch (error) {
      setResponse({ error: error instanceof Error ? error.message : "Mass valuation unavailable." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="company-analysis-page">
      <header className="topbar">
        <a className="brand" href="/command-center" aria-label="Pulse command center"><span className="brand-mark">P</span><span>PULSE<span className="brand-dot">•</span>AI</span></a>
        <TopbarNav activeHref={activeNav === "company" ? "/company-analysis" : activeNav === "valuation" ? "/valuation" : "/mass-valuation"} />
        <ThemeToggle />
        <div className="market-state"><span className="live-dot" /> SEC FILINGS <b>LONG-TERM LENS</b><a className="account-button analysis-account" href="/command-center">{displayName}</a></div>
      </header>

      <section className={`analysis-hero ${activeNav === "valuation" || activeNav === "mass" ? "valuation-hero" : ""}`}>
        <div>
          <div className="eyebrow">{activeNav === "mass" ? "100-COMPANY ENTERPRISE DCF SCREEN" : activeNav === "valuation" ? "MCKINSEY ENTERPRISE DCF WORKBENCH" : "BERKSHIRE 2022 COCA-COLA LENS"}</div>
          <h1>{activeNav === "mass" ? <>Find the ten strongest <em>value candidates.</em></> : activeNav === "valuation" ? <>Turn business performance into <em>value per share.</em></> : <>Find the companies built to <em>compound.</em></>}</h1>
          <p>{activeNav === "mass" ? "Scan 100 U.S. large-cap companies, build the same filing-based enterprise DCF used in Valuation, and rank the ten strongest candidates for deeper research." : activeNav === "valuation" ? "Enter a U.S. public company to build an enterprise DCF from its SEC filings, audit every value driver, test the range, and translate the result into a practical stock-purchase conclusion." : "Compare long-run return on equity, earnings durability, owner distributions, and balance-sheet risk using financial statements reported to the SEC."}</p>
        </div>
        <aside>
          <small>{activeNav === "mass" ? "THE RANKING TEST" : activeNav === "valuation" ? "THE VALUE-DRIVER TEST" : "THE SECRET-SAUCE TEST"}</small>
          <p>{activeNav === "mass" ? "Candidates rise when modeled value exceeds market price, operating returns clear the capital hurdle, business quality is durable, and leverage risk stays controlled. The rank is a research shortlist—not an automated order." : activeNav === "valuation" ? "Value comes from future cash flow. Growth creates the most value when return on invested capital stays above the opportunity cost of capital. The model keeps those drivers visible from forecast to conclusion." : "Berkshire’s 2022 letter highlighted Coke’s steadily rising cash distributions—from $75 million in 1994 to $704 million in 2022—and the patience to let a durable winner keep working."}</p>
          {activeNav === "mass" ? <a href="#mass-ranking">SEE THE TOP 10 ↓</a> : activeNav === "valuation" ? <a href="#valuation-method">SEE THE 7-STEP METHOD ↓</a> : <a href="https://www.berkshirehathaway.com/letters/2022ltr.pdf" target="_blank" rel="noreferrer">READ BERKSHIRE’S 2022 LETTER ↗</a>}
        </aside>
      </section>

      <section className="analysis-input-section">
        {activeNav === "mass" ? <div className="mass-scan-card">
          <div><span>U.S. LARGE-CAP UNIVERSE</span><strong>100 stocks · 10 finalists</strong></div>
          <p>Pulse reads standardized SEC filings in ten batches, builds a full enterprise DCF for every company with sufficient data, and ranks the results using one consistent model.</p>
          <button type="button" onClick={runMassValuation} disabled={loading}>{loading ? `VALUING ${massProgress} / 100…` : massSummary ? "RUN A FRESH 100-STOCK SCAN →" : "SCAN & RANK 100 STOCKS →"}</button>
          {loading && <div className="mass-progress" role="progressbar" aria-label="Mass valuation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={massProgress}><i style={{ width: `${massProgress}%` }} /></div>}
        </div> : <form onSubmit={analyze}>
          <label htmlFor="company-symbols"><span>STOCK SYMBOLS</span><strong>{activeNav === "valuation" ? "Enter a company or compare up to 12" : "Enter up to 12 companies"}</strong></label>
          <textarea id="company-symbols" value={symbols} onChange={(event) => setSymbols(event.target.value.toUpperCase())} placeholder="KO, AAPL, AMEX, MSFT" rows={3} />
          <div><p>Separate symbols with commas, spaces, or new lines. U.S. SEC-reporting companies work best.</p><button type="submit" disabled={loading}>{loading ? "READING COMPANY FILINGS…" : "ANALYZE COMPANIES →"}</button></div>
        </form>}
        <div className="analysis-method">
          {activeNav === "mass" ? <>
            <article><span>01</span><div><strong>Scan the 100</strong><p>Apply the same SEC filing and DCF workflow to every company in the large-cap universe.</p></div></article>
            <article><span>02</span><div><strong>Rank consistently</strong><p>Score modeled value gap, quality, ROIC spread, conclusion tone, and leverage risk.</p></div></article>
            <article><span>03</span><div><strong>Audit the ten</strong><p>Review the complete Valuation-tab analysis for every shortlisted company.</p></div></article>
          </> : activeNav === "valuation" ? <>
            <article><span>01</span><div><strong>Enterprise DCF</strong><p>Forecast operating cash flow, then discount it at the opportunity cost of capital.</p></div></article>
            <article><span>02</span><div><strong>Economic-profit check</strong><p>Confirm that value is supported by returns earned above the capital charge.</p></div></article>
            <article><span>03</span><div><strong>Decision range</strong><p>Compare cautious, base, and optimistic values with the price you would pay.</p></div></article>
          </> : <>
            <article><span>01</span><div><strong>Efficient capital</strong><p>ROE uses annual net income divided by average shareholder equity.</p></div></article>
            <article><span>02</span><div><strong>Durable growth</strong><p>Positive ROE, earnings, and distributions matter more across a decade.</p></div></article>
            <article><span>03</span><div><strong>Staying power</strong><p>Debt above 2.0× equity—or negative equity—raises a red flag.</p></div></article>
          </>}
        </div>
      </section>

      {response?.error && <div className="analysis-error" role="alert"><strong>ANALYSIS UNAVAILABLE</strong><p>{response.error}</p></div>}

      {massSummary && <section className="mass-ranking" id="mass-ranking" aria-live="polite">
        <header><div><small>MASS VALUATION RESULTS</small><h2>Top 10 candidates for deeper research</h2></div><p>{massSummary.scanned} scanned · {massSummary.modeled} complete DCF models · {massSummary.dataGaps} data gaps</p></header>
        <div className="mass-ranking-grid">
          {massSummary.ranked.map((company) => <a href={`#mass-company-${company.symbol}`} key={`rank-${company.symbol}`}>
            <span>#{String(company.massRank).padStart(2, "0")}</span>
            <div><strong>{company.symbol}</strong><small>{company.companyName}</small></div>
            <div><b>{company.investmentScore}</b><small>RANK SCORE</small></div>
            <div><b className={(company.valuation?.valuationGap ?? 0) >= 0 ? "up" : "down"}>{percent(company.valuation?.valuationGap)}</b><small>MODEL VS. MARKET</small></div>
            <p>{company.rankingReasons.slice(1, 3).join(" · ")}</p>
          </a>)}
        </div>
        <p className="mass-ranking-note">Ranking score = 55% modeled value gap + 25% business quality + ROIC-spread adjustment + conclusion adjustment − leverage penalty. Missing market prices are ranked on operating quality and should be reviewed with extra caution.</p>
      </section>}

      {response?.results && <section className="analysis-results" aria-live="polite">
        <div className="analysis-results-head"><div><small>{activeNav === "mass" ? "FULL VALUATION AUDIT" : "COMPARATIVE COMPANY REVIEW"}</small><h2>{activeNav === "mass" ? "The complete top-10 analyses" : `${response.results.length} ${response.results.length === 1 ? "company" : "companies"} analyzed`}</h2></div><p>{response.sourceNote}</p></div>
        <div className="company-result-grid">
          {response.results.map((company) => company.error ? (
            <article className="company-card company-card-error" key={company.symbol}>
              <header><span>{company.symbol}</span><b>DATA GAP</b></header>
              <h3>{company.companyName || "Company not found"}</h3>
              <p>{company.error}</p>
            </article>
          ) : (
            <article id={activeNav === "mass" ? `mass-company-${company.symbol}` : undefined} className={`company-card ${company.highDebtFlag ? "company-card-flagged" : ""}`} key={company.symbol}>
              <header>
                <div><span>{company.symbol}</span><small>FY END {company.asOf ? new Date(`${company.asOf}T00:00:00`).toLocaleDateString([], { month: "short", year: "numeric" }).toUpperCase() : "N/A"}</small></div>
                <div className="quality-score"><strong>{company.score}</strong><small>/ 100</small></div>
              </header>
              <div className="company-title"><div><small>BERKSHIRE-STYLE READ</small><h3>{company.companyName}</h3></div><b>{company.verdict}</b></div>

              <section className="roe-panel">
                <div className="metric-heading"><div><small>RETURN ON EQUITY</small><h4>Capital efficiency over time</h4></div><span>{company.positiveRoeYears}/{company.yearsAnalyzed} POSITIVE YEARS</span></div>
                <div className="roe-horizons">
                  {horizons.map(([key, label]) => {
                    const item = company.roe?.[key];
                    return <div key={key}><small>{label} AVG</small><strong className={(item?.value ?? 0) < 0 ? "down" : ""}>{percent(item?.value)}</strong><span>{item?.yearsUsed ?? 0} filing{item?.yearsUsed === 1 ? "" : "s"}</span></div>;
                  })}
                </div>
                <div className="roe-history" aria-label="Annual return on equity history">
                  {company.annualRoe?.map((year) => <div key={year.year}><i className={(year.value ?? 0) < 0 ? "negative" : ""} style={{ height: `${Math.min(100, Math.max(6, Math.abs(year.value ?? 0) * 2.2))}%` }} /><span>{String(year.year).slice(2)}</span></div>)}
                </div>
              </section>

              <section className="company-metrics">
                <div className={company.highDebtFlag ? "debt-flag" : ""}><small>DEBT / EQUITY</small><strong>{company.negativeEquity ? "NEG. EQUITY" : company.debtToEquity === null ? "N/A" : `${company.debtToEquity?.toFixed(2)}×`}</strong><span>{company.highDebtFlag ? "RED FLAG" : "SCREEN PASSED"}</span></div>
                <div><small>NET INCOME CAGR</small><strong>{percent(company.earningsCagr)}</strong><span>AVAILABLE LONG PERIOD</span></div>
                <div><small>DIVIDEND CAGR</small><strong>{percent(company.dividendCagr)}</strong><span>REPORTED DISTRIBUTIONS</span></div>
                <div><small>CAPITAL BASE</small><strong>{compactMoney(company.shareholderEquity)}</strong><span>{compactMoney(company.totalDebt)} DEBT</span></div>
              </section>

              {company.highDebtFlag && <div className="red-flag-banner"><b>!</b><div><strong>HIGH LEVERAGE RED FLAG</strong><p>{company.cautions?.[0]}</p></div></div>}

              <section className="company-read">
                <div><small>WHAT COMPOUNDS</small>{company.strengths?.map((item) => <p key={item}><span>+</span>{item}</p>)}</div>
                <div><small>WHAT TO QUESTION</small>{company.cautions?.slice(company.highDebtFlag ? 1 : 0).map((item) => <p key={item}><span>!</span>{item}</p>)}</div>
              </section>

              {company.valuation ? <section className="valuation-panel" id="valuation-method" aria-label={`Valuation analysis for ${company.companyName}`}>
                <div className="valuation-heading">
                  <div><small>McKINSEY-STYLE ENTERPRISE DCF</small><h4>From business performance to value per share</h4></div>
                  <div className="valuation-callout"><span>{company.valuation.signal}</span><strong>{money(company.valuation.fairValuePerShare)}</strong><small>MODELED VALUE / SHARE</small></div>
                </div>

                <div className="valuation-primer">
                  <strong>The central idea</strong>
                  <p>A business creates value when the return earned on the money tied up in operations is higher than the return investors require for taking the risk. Growth helps most when that spread is positive. The model therefore starts with operating cash economics—not a shortcut such as a P/E multiple.</p>
                </div>

                <div className="valuation-process">
                  <div><small>BOOK-ALIGNED WORKFLOW</small><h5>Seven linked decisions, one auditable answer</h5><p>Each stage feeds the next. Open any stage below to see what it means and where judgment still enters the model.</p></div>
                  <ol>{company.valuation.process.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><p>{step}</p></li>)}</ol>
                </div>

                <div className="valuation-steps">
                  <article>
                    <span>01</span><small>GROWTH ENGINE</small><h5>Revenue and operating profit</h5>
                    <dl>
                      <div><dt>Latest revenue</dt><dd>{compactMoney(company.valuation.revenue)}</dd></div>
                      <div><dt>Forecast growth</dt><dd>{percent(company.valuation.revenueGrowth)}</dd></div>
                      <div><dt>Operating income</dt><dd>{compactMoney(company.valuation.operatingIncome)}</dd></div>
                    </dl>
                    <p><b>In plain English:</b> Revenue is what customers paid the company. The growth rate is the model’s starting estimate for how quickly that customer spending may expand. Operating income shows what remains after ordinary operating costs, before financing choices such as debt.</p>
                  </article>

                  <article>
                    <span>02</span><small>AFTER-TAX OPERATIONS</small><h5>NOPAT</h5>
                    <dl>
                      <div><dt>Cash tax rate</dt><dd>{percent(company.valuation.cashTaxRate)}</dd></div>
                      <div><dt>NOPAT</dt><dd>{compactMoney(company.valuation.nopat)}</dd></div>
                      <div><dt>NOPAT margin</dt><dd>{percent(company.valuation.nopatMargin)}</dd></div>
                    </dl>
                    <p><b>In plain English:</b> NOPAT means “net operating profit after tax.” It asks what the core business earned after taxes but before interest payments. That makes companies easier to compare even when one uses much more debt than another.</p>
                  </article>

                  <article>
                    <span>03</span><small>CAPITAL EFFICIENCY</small><h5>Invested capital and ROIC</h5>
                    <dl>
                      <div><dt>Invested capital</dt><dd>{compactMoney(company.valuation.investedCapital)}</dd></div>
                      <div><dt>ROIC</dt><dd>{percent(company.valuation.roic)}</dd></div>
                      <div><dt>Required return</dt><dd>{percent(company.valuation.wacc)}</dd></div>
                    </dl>
                    <p><b>In plain English:</b> Invested capital is the owners’ and lenders’ money committed to operations, after excess cash. ROIC shows how much after-tax operating profit each dollar produced. The required return—often called WACC—is the hurdle rate investors need to be compensated for risk.</p>
                  </article>

                  <article className={(company.valuation.roicSpread ?? 0) < 0 ? "valuation-warning" : ""}>
                    <span>04</span><small>VALUE CREATION TEST</small><h5>ROIC minus required return</h5>
                    <dl>
                      <div><dt>ROIC spread</dt><dd>{percent(company.valuation.roicSpread)}</dd></div>
                      <div><dt>Economic profit</dt><dd>{compactMoney(company.valuation.economicProfit)}</dd></div>
                      <div><dt>Reinvestment</dt><dd>{percent(company.valuation.reinvestmentRate)}</dd></div>
                    </dl>
                    <p><b>In plain English:</b> A positive spread means operations earned more than investors required; a negative spread means growth can consume value. Economic profit translates that spread into dollars. Reinvestment estimates how much profit must stay in the business to support the forecast growth.</p>
                  </article>

                  <article>
                    <span>05</span><small>CASH AVAILABLE</small><h5>Normalized free cash flow</h5>
                    <dl>
                      <div><dt>After-tax operating profit</dt><dd>{compactMoney(company.valuation.nopat)}</dd></div>
                      <div><dt>Needed reinvestment</dt><dd>{percent(company.valuation.reinvestmentRate)}</dd></div>
                      <div><dt>Free cash flow</dt><dd>{compactMoney(company.valuation.normalizedFreeCashFlow)}</dd></div>
                    </dl>
                    <p><b>In plain English:</b> Free cash flow is the operating profit left after funding the assets and working capital needed for growth. This is the cash that can ultimately benefit all capital providers, which is why the DCF values cash rather than accounting earnings alone.</p>
                  </article>

                  <article>
                    <span>06</span><small>VALUE BEYOND YEAR FIVE</small><h5>Continuing value</h5>
                    <dl>
                      <div><dt>Long-run growth</dt><dd>{percent(company.valuation.terminalGrowth)}</dd></div>
                      <div><dt>Long-run ROIC</dt><dd>{percent(company.valuation.terminalRoic)}</dd></div>
                      <div><dt>Discount rate</dt><dd>{percent(company.valuation.wacc)}</dd></div>
                    </dl>
                    <p><b>In plain English:</b> A company does not disappear after a five-year forecast, so the model estimates all later cash flows in one continuing value. Growth is reduced to a mature 2.5%, and returns fade toward a more competitive level instead of pretending today’s advantages last unchanged forever.</p>
                  </article>
                </div>

                <div className="forecast-section">
                  <div className="forecast-copy"><small>INTEGRATED EXPLICIT FORECAST</small><h5>{company.valuation.forecastYears}-year path to steady state</h5><p>The forecast fades near-term growth and ROIC toward mature levels. Reinvestment is tied to growth divided by return on capital, so free cash flow cannot rise without the operating investment needed to support it.</p></div>
                  <div className="forecast-table" role="table" aria-label={`Explicit forecast for ${company.companyName}`}>
                    <div className="forecast-row forecast-head" role="row"><span>YEAR</span><span>REVENUE</span><span>GROWTH</span><span>NOPAT</span><span>ROIC</span><span>REINVEST</span><span>FCF</span><span>PV OF FCF</span></div>
                    {company.valuation.forecast.map((year) => <div className="forecast-row" role="row" key={year.year}><strong>{year.year}</strong><span>{compactMoney(year.revenue)}</span><span>{percent(year.growth)}</span><span>{compactMoney(year.nopat)}</span><span>{percent(year.roic)}</span><span>{percent(year.reinvestmentRate)}</span><b>{compactMoney(year.freeCashFlow)}</b><b>{compactMoney(year.presentValue)}</b></div>)}
                  </div>
                  <p className="valuation-explainer"><b>What this means:</b> Revenue and NOPAT describe the operating result; ROIC governs how much capital that growth consumes; free cash flow is the amount left for investors; present value converts each future dollar into today’s dollars.</p>
                </div>

                <div className="wacc-section">
                  <div><small>COST OF CAPITAL</small><h5>How the discount rate is built</h5><p>WACC is the opportunity cost demanded by equity and debt investors, weighted by the company’s target financing mix.</p></div>
                  <div className="wacc-grid">
                    <article><small>COST OF EQUITY</small><strong>{percent(company.valuation.waccBridge.costOfEquity)}</strong><p>Normalized market return required by shareholders for business risk.</p></article>
                    <article><small>PRE-TAX DEBT COST</small><strong>{percent(company.valuation.waccBridge.preTaxCostOfDebt)}</strong><p>Interest expense relative to reported debt, bounded to a responsible range.</p></article>
                    <article><small>AFTER-TAX DEBT COST</small><strong>{percent(company.valuation.waccBridge.afterTaxCostOfDebt)}</strong><p>Debt cost after recognizing the tax deductibility of interest.</p></article>
                    <article><small>CAPITAL MIX</small><strong>{company.valuation.waccBridge.equityWeight?.toFixed(0)} / {company.valuation.waccBridge.debtWeight?.toFixed(0)}</strong><p>Equity percentage / debt percentage using market value when available.</p></article>
                    <article className="wacc-total"><small>WEIGHTED AVERAGE COST</small><strong>{percent(company.valuation.waccBridge.wacc)}</strong><p>The blended rate used to discount enterprise free cash flow.</p></article>
                  </div>
                  <p className="valuation-explainer"><b>What this means:</b> A higher WACC means investors demand more compensation for risk and today’s value falls. Because beta and peer capital structures require external judgment, the sensitivity grid also tests the result one percentage point above and below this estimate.</p>
                </div>

                <div className="valuation-bridge">
                  <div className="bridge-heading"><small>ENTERPRISE-TO-EQUITY BRIDGE</small><h5>Who owns the modeled business value?</h5></div>
                  <div className="bridge-flow">
                    <div><small>OPERATING BUSINESS</small><strong>{compactMoney(company.valuation.enterpriseValue)}</strong><span>Present value of forecast free cash flows</span></div>
                    <i>−</i>
                    <div><small>NET DEBT</small><strong>{compactMoney(company.valuation.netDebt)}</strong><span>Debt minus cash on the balance sheet</span></div>
                    <i>=</i>
                    <div><small>VALUE FOR SHAREHOLDERS</small><strong>{compactMoney(company.valuation.equityValue)}</strong><span>Residual value after lenders’ claims</span></div>
                    <i>÷</i>
                    <div><small>SHARES OUTSTANDING</small><strong>{company.valuation.sharesOutstanding ? new Intl.NumberFormat("en-US", { notation:"compact", maximumFractionDigits:1 }).format(company.valuation.sharesOutstanding) : "N/A"}</strong><span>Reported common shares</span></div>
                  </div>
                  <p><b>In plain English:</b> Enterprise value belongs to both lenders and shareholders. Subtracting net debt leaves the portion attributable to shareholders; dividing by the number of shares turns that total into an estimated value for one share.</p>
                </div>

                <div className="valuation-checks">
                  <div className="check-intro"><small>MODEL VALIDATION</small><h5>Three ways to pressure-test the answer</h5><p>A valuation becomes more useful when the logic reconciles and the market comparison tells a coherent story.</p></div>
                  <div className="check-grid">
                    <article><small>CONTINUING VALUE</small><strong>{compactMoney(company.valuation.continuingValuePresentValue)}</strong><span>{percent(company.valuation.continuingValueShare)} OF ENTERPRISE VALUE</span><p>This is the present value of cash flow after year {company.valuation.forecastYears}. A very high share means the conclusion depends heavily on mature-state assumptions.</p></article>
                    <article><small>ECONOMIC-PROFIT VALUE</small><strong>{compactMoney(company.valuation.economicProfitValue)}</strong><span>{percent(company.valuation.economicProfitCrossCheckDifference)} VS. DCF</span><p>Beginning invested capital plus discounted future profit above the capital charge should reconcile with enterprise DCF when the operating assumptions are internally consistent.</p></article>
                    <article><small>OPERATING MULTIPLES</small><strong>{company.valuation.multiples.modeledEvToNopat?.toFixed(1) ?? "N/A"}× <i>model</i></strong><span>{company.valuation.multiples.marketEvToNopat?.toFixed(1) ?? "N/A"}× MARKET EV / NOPAT</span><p>Multiples are a cross-check, not the primary valuation. A large difference shows how differently the model and market price the same current operating profit.</p></article>
                  </div>
                </div>

                <div className="valuation-verdict">
                  <div><small>MODELED VALUE / SHARE</small><strong>{money(company.valuation.fairValuePerShare)}</strong></div>
                  <div><small>RECENT MARKET PRICE</small><strong>{money(company.valuation.marketPrice)}</strong></div>
                  <div><small>MODEL VS. MARKET</small><strong className={(company.valuation.valuationGap ?? 0) < 0 ? "down" : "up"}>{percent(company.valuation.valuationGap)}</strong></div>
                  <p>The comparison is a conversation starter, not a buy or sell signal. A large gap usually means the assumptions deserve more scrutiny—not that the market is automatically wrong.</p>
                </div>

                <div className="valuation-scenarios">
                  <div><small>SENSITIVITY CHECK</small><h5>What if growth or risk differs?</h5><p>Small assumption changes can move a DCF substantially. The range is more honest than treating one estimate as a precise answer.</p></div>
                  <div className="scenario-table">
                    <div className="scenario-row scenario-head"><span>CASE</span><span>5Y GROWTH</span><span>DISCOUNT RATE</span><span>VALUE / SHARE</span></div>
                    {company.valuation.scenarios.map((scenario) => <div className="scenario-row" key={scenario.name}><strong>{scenario.name}</strong><span>{percent(scenario.growth)}</span><span>{percent(scenario.discountRate)}</span><b>{money(scenario.perShare)}</b></div>)}
                  </div>
                </div>

                <div className="sensitivity-section">
                  <div><small>TWO-WAY SENSITIVITY</small><h5>Value per share across long-run growth and WACC</h5><p>Read across for risk and down for mature growth. This grid exposes which combinations must be true for the current price to offer a margin of safety.</p></div>
                  <div className="sensitivity-table">
                    <div className="sensitivity-row sensitivity-head"><span>TERMINAL GROWTH ↓ / WACC →</span>{company.valuation.sensitivity.discountRates.map((rate) => <b key={String(rate)}>{percent(rate)}</b>)}</div>
                    {company.valuation.sensitivity.rows.map((row) => <div className="sensitivity-row" key={String(row.terminalGrowth)}><strong>{percent(row.terminalGrowth)}</strong>{row.values.map((cell) => <span className={company.valuation?.marketPrice && cell.perShare && cell.perShare >= company.valuation.marketPrice ? "above-market" : ""} key={`${row.terminalGrowth}-${cell.discountRate}`}>{money(cell.perShare)}</span>)}</div>)}
                  </div>
                  <p className="valuation-explainer"><b>What this means:</b> If only optimistic combinations produce a value above the market price, the purchase case is fragile. If most reasonable combinations remain above price, the model shows a broader margin of safety.</p>
                </div>

                <div className="coverage-section">
                  <div><small>SCOPE &amp; ADJUSTMENT AUDIT</small><h5>What is modeled—and what still needs human review</h5><p>The book’s full framework includes items that standardized filings cannot always identify reliably. Pulse labels those gaps instead of treating missing data as zero.</p></div>
                  <div className="coverage-list">{company.valuation.coverage.map((item) => <article key={item.item}><span className={`coverage-${item.status}`}>{item.status}</span><div><strong>{item.item}</strong><p>{item.detail}</p></div></article>)}</div>
                </div>

                <section className={`purchase-conclusion conclusion-${company.valuation.conclusion.tone}`} aria-label={`Purchase conclusion for ${company.companyName}`}>
                  <div className="conclusion-rating"><small>VALUATION CONCLUSION</small><strong>{company.valuation.conclusion.rating}</strong><span>{company.valuation.conclusion.action}</span></div>
                  <div className="conclusion-copy"><h5>What the outcome means for purchasing this stock</h5><p>{company.valuation.conclusion.summary}</p><ul>{company.valuation.conclusion.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><p className="conclusion-caveat">This conclusion is a disciplined interpretation of the modeled range, not personalized investment advice or an automated order.</p></div>
                </section>

                <details className="valuation-assumptions">
                  <summary>READ THE MODEL ASSUMPTIONS AND LIMITS</summary>
                  <ol>{company.valuation.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ol>
                  <div><a href="https://www.mckinsey.com/featured-insights/mckinsey-explainers/how-are-companies-valued" target="_blank" rel="noreferrer">McKINSEY: HOW ARE COMPANIES VALUED? ↗</a><a href="https://books.wiley.com/series/wiley-valuation-7e/" target="_blank" rel="noreferrer">WILEY: VALUATION, 8TH EDITION ↗</a></div>
                </details>
              </section> : <section className="valuation-unavailable"><small>VALUATION DATA GAP</small><h4>A responsible DCF could not be built from the available standardized filing facts.</h4><p>The quality screen remains available, but this issuer did not report enough comparable revenue, operating profit, capital, or share-count data for the valuation bridge.</p></section>}

              <footer><p>ROE: {company.methodology?.roe} Debt: {company.methodology?.debt}</p><a href={company.sourceUrl} target="_blank" rel="noreferrer">OPEN SEC FILINGS ↗</a></footer>
            </article>
          ))}
        </div>
        <p className="analysis-disclaimer">Informational and educational analysis only—not investment advice. The DCF is an illustrative McKinsey-style implementation, not a reproduction of McKinsey’s proprietary model and not affiliated with McKinsey &amp; Company. Reported XBRL facts can vary by issuer, sector, restatement, and fiscal calendar. Banks, insurers, REITs, and highly acquisitive companies require sector-specific valuation methods.</p>
      </section>}

      {!response && !loading && <section className="analysis-empty">
        <span>{activeNav === "mass" ? "100" : "10Y"}</span><div><small>{activeNav === "mass" ? "READY TO SCREEN THE LARGE-CAP UNIVERSE" : "READY FOR A LONGER VIEW"}</small><h2>{activeNav === "mass" ? <>One model. One hundred companies.<br />Ten fully auditable finalists.</> : <>Price tells you what the market thinks today.<br />ROE shows what the business has done with owners’ money.</>}</h2></div>
      </section>}

      <footer className="footer"><span>PULSE•AI / {activeNav === "mass" ? "MASS VALUATION" : "COMPANY ANALYSIS"}</span><p>Primary financial data from SEC EDGAR. Results are informational, model-driven research—not personalized investment advice.</p><span>LONG-TERM QUALITY SCREEN</span></footer>
    </main>
  );
}
