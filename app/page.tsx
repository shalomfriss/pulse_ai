"use client";

import { PointerEvent as ReactPointerEvent,useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import ThemeToggle from "./theme-toggle";
import TopbarNav from "./topbar-nav";

type Signal = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  sentiment: number;
  confidence: number;
  buyScore?: number;
  rank?: number;
  action: "BUY" | "SELL" | "WATCH";
  reason: string;
  mentions: number;
  evidence?: {
    source: string;
    headline: string;
    score: number;
    positiveTerms: string[];
    negativeTerms: string[];
  }[];
  spark: number[];
};

type Snapshot = {
  mode: "demo" | "live";
  scannedAt: string;
  marketOpen: boolean;
  account: { equity: number; buyingPower: number; dayPnl: number; dayPnlPct: number };
  breadth: { bullish: number; neutral: number; bearish: number };
  signals: Signal[];
  news: { source: string; headline: string; age: string; sentiment: "positive" | "neutral" | "negative"; symbols: string[] }[];
  execution: {
    enabled: boolean;
    ordersPlaced: number;
    bought?: string[];
    sold?: string[];
    managedPositions?: number;
    managedNotional?: number;
    positions?: { symbol:string; qty:number; marketValue:number; avgEntryPrice:number; currentPrice:number; unrealizedPnl:number }[];
  };
};

const REFRESH_SECONDS = 60;
type StrategyHolding = { symbol:string;rank:number;score:number;price:number;day:number;reason:string;side?:"long"|"short";assetClass?:"equity"|"option" };
type StrategyResult = {
  id:string;code:string;name:string;short:string;horizon:string;description:string;allocation:number;deployed:number;cash:number;
  enabled:boolean;paused:boolean;windowOpen:boolean;window:string;holdings:StrategyHolding[];orders:{ bought:string[];sold:string[] };dataMode:"live"|"demo";
};
type StrategySnapshot = { scannedAt:string;marketOpen:boolean;totalAllocation:number;strategies:StrategyResult[] };
type PositionItem = { symbol:string;qty:number;marketValue:number;costBasis:number;avgEntryPrice:number;currentPrice:number;unrealizedPnl:number;unrealizedPnlPct:number;dayChangePct:number;dayPnl:number };
type PositionCategory = { id:string;code:string;name:string;allocation:number;marketValue:number;costBasis:number;unrealizedPnl:number;realizedPnl:number;totalPnl:number;returnPct:number;dayPnl:number;positionCount:number;positions:PositionItem[] };
type PerformancePoint = { recordedAt:string;equity:number;totalPnl:number;realizedPnl:number;unrealizedPnl:number };
const performanceRanges = [
  { days:1,short:"1D",label:"one day" },
  { days:2,short:"2D",label:"two days" },
  { days:3,short:"3D",label:"three days" },
  { days:5,short:"5D",label:"five days" },
  { days:7,short:"1W",label:"one week" },
  { days:14,short:"2W",label:"two weeks" },
  { days:30,short:"1M",label:"one month" },
  { days:90,short:"3M",label:"three months" },
  { days:180,short:"6M",label:"six months" },
  { days:365,short:"1Y",label:"one year" },
] as const;
type Transaction = { id:string;symbol:string;side:"buy"|"sell";status:string;qty:number;price:number;total:number;filledAt:string;strategyCode:string;strategyName:string };
type TransactionSnapshot = { mode:"live"|"demo";asOf:string;transactions:Transaction[] };
type PositionsSnapshot = {
  mode:"live"|"demo";asOf:string;
  summary:{ equity:number;cash:number;buyingPower:number;totalMarketValue:number;totalCostBasis:number;totalUnrealizedPnl:number;positionCount:number };
  categories:PositionCategory[];
};
type AccountProfile = "paper"|"live";
type ProfileSummary = { configured:boolean;keyHint:string|null;autoTrade:boolean;source:"stored"|"legacy"|"none";updatedAt:string|null };
type AccountState = {
  status:"loading"|"anonymous"|"authenticated"|"error";
  user?:{ email:string;displayName:string };
  profiles:Record<AccountProfile,ProfileSummary>;
  error?:string;
};
const emptyProfile:ProfileSummary={ configured:false,keyHint:null,autoTrade:false,source:"none",updatedAt:null };
const emptyProfiles:Record<AccountProfile,ProfileSummary>={ paper:emptyProfile,live:emptyProfile };

const strategyDefinitions = [
  ["momentum","mom","Medium-term momentum","Buy persistent market leaders","20–60 trading days","Ranks liquid stocks by 20- and 60-day relative strength, then penalizes unstable price paths."],
  ["quality-value","qv","Quality + value","Stable compounders at reasonable prices","Quarterly / long horizon","Uses trend consistency, lower realized volatility, liquidity and position within the recent range as an Alpaca-only market-quality proxy."],
  ["earnings-drift","earn","Earnings-surprise drift","Follow confirmed earnings reactions","1–20 trading days","Finds earnings and guidance headlines, then requires positive tone, price confirmation and abnormal volume."],
  ["short-reversal","rev","Short-term reversal","Buy liquid, non-fundamental dislocations","2–10 trading days","Looks for sharp five-day declines that begin to stabilize without strongly negative news."],
  ["news-catalyst","news","News-catalyst momentum","Trade relevant positive catalysts","Minutes–5 days","Combines ticker-specific headline tone, mention count, same-day price confirmation and volume."],
  ["intraday","scalp","Intraday momentum","Follow short, liquid bursts","5–60 minutes","Ranks persistent 5-minute price movement and intraday volume acceleration while the market is open."],
  ["opening-range","orb","Opening-range breakout","Trade a confirmed break of the opening range","15 minutes–3 hours","Builds the first 30-minute high/low, then requires a breakout, positive short-term trend and expanding volume."],
  ["vwap","vwap","VWAP reclaim / rejection","Trade institutional intraday balance","5 minutes–several hours","Compares price with session VWAP and enters confirmed reclaims or rejection reversals only when volume supports the move."],
  ["gap","gap","Gap continuation / fade","Trade overnight dislocations with confirmation","Minutes–1 day","Measures the opening gap versus the prior close, then follows news-backed continuation or buys a recovering unsupported gap-down fade."],
  ["squeeze","squeeze","Volatility-squeeze breakout","Trade expansion after compression","Minutes–2 days","Detects narrow 20-day Bollinger width and low realized movement, then waits for a price and volume breakout."],
  ["closing","close","Closing-session momentum","Trade confirmed final-hour continuation","Final 60–90 minutes","Activates near the close and combines the opening move, session trend, market direction and volume to rank continuation candidates."],
  ["order-flow","flow","Order-flow imbalance","Follow top-of-book pressure","Seconds–minutes","Uses Alpaca’s latest bid/ask sizes as a top-of-book pressure proxy, confirmed by 5-minute price and volume. This is not full-depth order-book analysis."],
  ["medallion","medal","Medallion","Combine many small statistical edges","15 minutes–5 trading days","A cash-only, long-only ensemble inspired by publicly described Renaissance principles. It combines weak price, volume, sentiment and risk signals; it is not the proprietary Medallion Fund model."],
] as const;

const strategyWindows:Record<string,string> = {
  momentum:"Daily 3:30–3:55 PM ET","quality-value":"Friday 3:30–3:55 PM ET","earnings-drift":"10:00 AM–3:30 PM ET","short-reversal":"3:15–3:55 PM ET","news-catalyst":"9:35 AM–3:30 PM ET",intraday:"9:45 AM–3:30 PM ET",
  "opening-range":"10:00–11:30 AM ET",vwap:"10:00 AM–3:30 PM ET",gap:"9:35–11:00 AM ET",squeeze:"10:00 AM–3:30 PM ET",closing:"3:00–3:55 PM ET","order-flow":"9:35 AM–3:55 PM ET",medallion:"9:45 AM–3:30 PM ET",
};

const strategyCadence:Record<string,{ frequency:string;why:string }> = {
  momentum:{ frequency:"Reviewed daily; typically trades every few weeks.",why:"The model waits for multi-week leadership ranks to change, so it avoids reacting to ordinary daily noise." },
  "quality-value":{ frequency:"Reviewed weekly; typically trades monthly or quarterly.",why:"Slow-moving stability and market-quality inputs need meaningful deterioration or a stronger replacement before turnover is justified." },
  "earnings-drift":{ frequency:"Event-driven; trades around eligible earnings releases.",why:"A position changes only when a fresh earnings or guidance catalyst is confirmed by price and unusual volume." },
  "short-reversal":{ frequency:"Reviewed daily; positions usually last 2–10 trading days.",why:"The opportunity is a temporary dislocation, so entries wait for stabilization and exits occur after the rebound or renewed weakness." },
  "news-catalyst":{ frequency:"Event-driven; may trade several times per week.",why:"Fresh company news decays quickly, so the roster changes when newer catalysts gain stronger price and volume confirmation." },
  intraday:{ frequency:"Checked every scan during market hours; positions target minutes to one hour.",why:"Five-minute direction and volume can reverse quickly, making frequent reevaluation essential to the signal." },
  "opening-range":{ frequency:"At most once per qualifying stock near the morning breakout window.",why:"The setup depends on a break of the first 30-minute range; after that window, the original reference loses relevance." },
  vwap:{ frequency:"Checked throughout the session; may trade a few times per day.",why:"Price can reclaim or reject VWAP as institutional order flow shifts, but volume confirmation limits unnecessary churn." },
  gap:{ frequency:"Primarily reviewed during the first 90 minutes; usually same-day trades.",why:"Overnight gaps are most informative near the open, and the continuation-or-fade thesis weakens as the session matures." },
  squeeze:{ frequency:"Reviewed daily and intraday; trades only after uncommon compression breaks.",why:"Volatility compression can persist for days, so the strategy remains patient until price and volume confirm expansion." },
  closing:{ frequency:"Evaluated once in the final 60–90 minutes each session.",why:"The signal specifically tests whether established intraday direction is likely to continue into the close." },
  "order-flow":{ frequency:"Checked every scan; positions can turn over within minutes.",why:"Top-of-book imbalance is short-lived, so price and volume must keep confirming it or the trade is no longer valid." },
  medallion:{ frequency:"Checked every 15 minutes; positions may last from minutes to several days.",why:"The ensemble looks for agreement among several small, changing effects instead of relying on one large prediction." },
};

type StrategyEducation = {
  summary:string;
  signal:string;
  entry:string;
  exit:string;
  risk:string;
  inDepth:string;
  sources:{ label:string;url:string;note:string }[];
};

const strategyEducation:Record<string,StrategyEducation> = {
  momentum:{
    summary:"Momentum assumes that leadership can persist: stocks that have outperformed over several months may continue to outperform for a while as information and capital move through the market gradually.",
    signal:"Ranks liquid stocks by 20- and 60-session return, rewards agreement across both horizons, and penalizes high realized volatility so a single violent jump is less likely to masquerade as a durable trend.",
    entry:"A stock must remain among the highest-scoring names with a stable positive path. The model checks near the close, when most of the day’s information is already reflected in price.",
    exit:"The position leaves the roster when its relative-strength rank deteriorates, the trend turns negative, or another name offers a stronger risk-adjusted score.",
    risk:"Momentum can reverse abruptly around macro shocks, crowded positioning, or a market regime change. Turnover and whipsaw can erase a paper edge.",
    inDepth:"The classic cross-sectional version buys recent winners and sells recent losers. Pulse uses only the long side and adds a stability penalty, so it is a conservative implementation rather than a replication of the academic long-short portfolio. The signal is comparative: a positive return alone is not enough if other liquid stocks are stronger.",
    sources:[{ label:"Jegadeesh & Titman — Returns to Buying Winners and Selling Losers",url:"https://www.jstor.org/stable/2328882",note:"Foundational 1993 momentum study." }],
  },
  "quality-value":{
    summary:"Quality-and-value strategies normally seek durable businesses at inexpensive fundamental valuations. This Alpaca-only version cannot see financial statements, so it uses market behavior as an explicitly labeled proxy.",
    signal:"Combines trend consistency, lower realized volatility, ample liquidity, and where price sits inside its recent range. Smooth, liquid price behavior raises the proxy score; unstable or thin trading lowers it.",
    entry:"The model reviews candidates late on Fridays and admits only stable, liquid names that score well across the proxy inputs. It does not claim that a company is cheap on earnings or book value.",
    exit:"A holding is removed when its stability, liquidity, or range-position score weakens enough to fall outside the qualifying roster.",
    risk:"Market quality is not business quality. Without balance-sheet, profitability, and valuation data, the proxy can favor a calm but fundamentally expensive or deteriorating company.",
    inDepth:"Academic value factors compare prices with accounting measures such as book equity, while quality commonly uses profitability, leverage, and earnings stability. Pulse currently approximates only the market-behavior portion of that idea. Treat this module as a low-volatility trend screen until a fundamentals provider is connected.",
    sources:[{ label:"Kenneth French — Fama/French factor definitions",url:"https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library/f-f_factors.html",note:"Primary factor construction and value methodology." }],
  },
  "earnings-drift":{
    summary:"Post-earnings-announcement drift is the tendency for prices to continue moving in the direction of an earnings surprise after the initial announcement reaction.",
    signal:"Finds ticker-tagged earnings or guidance headlines, scores their language, then requires same-day price strength and above-normal volume. News tone alone cannot qualify a stock.",
    entry:"A candidate needs at least one relevant earnings story, positive headline tone, a positive day, and confirming volume during the strategy window.",
    exit:"The position drops when the earnings catalyst ages, price confirmation fails, or its combined catalyst score is displaced by stronger candidates.",
    risk:"Headline language is an imperfect substitute for the actual surprise versus consensus. Guidance nuance, one-time items, and an already-priced-in beat can make a positive headline misleading.",
    inDepth:"The theory is underreaction: investors may not incorporate all implications of an earnings surprise immediately. The strongest implementations measure standardized unexpected earnings and subsequent analyst revisions. Pulse uses the faster but less precise combination of earnings text, price reaction, and volume, so the confirmation gates are essential.",
    sources:[{ label:"Caltech research note — Post-Earnings Announcement Drift",url:"https://jkatz.caltech.edu/documents/28622/peads.pdf",note:"Research discussion of PEAD mechanics and evidence." }],
  },
  "short-reversal":{
    summary:"Short-term reversal looks for a sharp recent loser whose selling pressure appears to be exhausting, then attempts to capture a partial snapback rather than a new long-term uptrend.",
    signal:"Measures the five-day decline, today’s stabilization, and ticker-news tone. A large dislocation helps, but strongly negative news blocks the trade.",
    entry:"The stock must be down materially over five sessions, stop making a comparably large loss today, and avoid a severe negative-news score.",
    exit:"The model exits after the short holding horizon, when the rebound is captured, or when renewed weakness shows that the move was deterioration rather than temporary pressure.",
    risk:"Falling prices may reflect genuine new information. Buying too early creates a classic falling-knife trade, and bid-ask effects can exaggerate apparent reversals in less-liquid names.",
    inDepth:"Weekly reversal research tests whether recent losers outperform recent winners over the next short interval. Possible explanations include liquidity provision, temporary price pressure, and overreaction. Pulse adds stabilization and news filters because a raw contrarian rule cannot distinguish temporary dislocation from a lasting fundamental repricing.",
    sources:[{ label:"NBER — Fads, Martingales, and Market Efficiency",url:"https://www.nber.org/papers/w2533",note:"Foundational short-horizon reversal research." }],
  },
  "news-catalyst":{
    summary:"News-catalyst momentum looks for new, company-specific information that is positive enough to attract attention and is already being confirmed by trading activity.",
    signal:"Averages the tone of recent ticker-tagged headlines, adds mention count, same-day return, and relative volume, then ranks only positive and price-confirmed candidates.",
    entry:"At least one relevant headline must exist; average tone must clear the positive threshold; price must be up; and volume should support the move.",
    exit:"The trade leaves when the catalyst becomes stale, price confirmation reverses, or a fresher and stronger catalyst takes its roster slot.",
    risk:"Simple language scoring misses context, negation, source quality, and whether information was expected. Duplicate stories can also make one event look more important than it is.",
    inDepth:"Text-based finance research shows that the tone of financial media can be related to returns and trading volume. Pulse uses a transparent keyword score rather than a black-box language model, then requires market confirmation. This makes the calculation auditable, but it also means users should read the cited headline rather than interpreting the score as full semantic understanding.",
    sources:[{ label:"Tetlock — Giving Content to Investor Sentiment",url:"https://papers.ssrn.com/sol3/papers.cfm?abstract_id=685145",note:"Foundational study of media tone and market activity." }],
  },
  intraday:{
    summary:"Intraday momentum seeks continuation inside one trading session, when a liquid stock’s short bursts of price movement and volume are aligned.",
    signal:"Scores recent five-minute returns for persistence, checks that intraday volume is accelerating, and favors liquid names to reduce noise and execution friction.",
    entry:"The model waits beyond the chaotic open, then requires repeated movement in one direction with supporting volume during regular market hours.",
    exit:"Positions are designed to close within the session or when short-term direction, volume support, or the strategy window fails.",
    risk:"Microstructure noise, spreads, latency, and rapid reversals dominate at short horizons. A backtested signal can disappear after realistic fills and slippage.",
    inDepth:"Intraday momentum is different from multi-month momentum: the holding period is minutes, and the likely drivers include delayed information, inventory management, and institutional trading patterns. Pulse uses several consecutive bars and volume confirmation to avoid treating a single print as a trend, but it does not eliminate execution risk.",
    sources:[{ label:"Gao, Han, Li & Zhou — Market Intraday Momentum",url:"https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2552752",note:"Research on first- and last-half-hour return predictability." }],
  },
  "opening-range":{
    summary:"The opening-range breakout defines the first 30 minutes’ high and low, then looks for a decisive move beyond that range as the market settles on a direction.",
    signal:"Builds the opening high and low, checks for a breakout, and requires positive short-term trend plus expanding volume to reduce false signals.",
    entry:"No entry occurs while the range is forming. After 10:00 a.m. ET, price must clear the boundary with directional and volume confirmation.",
    exit:"The trade invalidates if price falls back inside the range, momentum fades, or the late-morning trading window closes.",
    risk:"The open is noisy and sensitive to overnight orders. Breakouts frequently fail, while stops near an obvious range boundary can be vulnerable to rapid whipsaw.",
    inDepth:"The opening auction concentrates overnight supply and demand into an official price; continuous trading then tests whether that price holds. The strategy treats the next 30 minutes as a second price-discovery interval. Pulse does not trade the boundary alone—it asks whether price trend and volume agree that the market is accepting prices outside the range.",
    sources:[{ label:"Nasdaq — Opening and Closing Crosses",url:"https://www.nasdaqtrader.com/trader.aspx?id=openclose",note:"Official explanation of opening-auction price discovery." }],
  },
  vwap:{
    summary:"VWAP is the session’s cumulative dollar value traded divided by shares traded. A reclaim strategy watches price move back above this volume-weighted reference after trading below it.",
    signal:"Compares current price with session VWAP, measures the direction of the crossing, and asks for supportive short-term price and volume behavior.",
    entry:"A bullish reclaim requires price to cross and hold above VWAP with confirmation; a rejection setup requires the opposite behavior and must satisfy the strategy’s reversal rules.",
    exit:"A failed hold back through VWAP invalidates the setup. The model also exits when confirmation disappears or the intraday window ends.",
    risk:"VWAP is descriptive, not inherently support or resistance. It lags the session, changes with every trade, and can produce repeated false crosses in sideways markets.",
    inDepth:"Because VWAP weights prices by volume, it approximates the average session price paid per share and is widely used as an execution benchmark. Pulse uses it as a balance reference, not a prediction. The useful information comes from how price crosses and holds around VWAP together with volume, not from the line by itself.",
    sources:[{ label:"Investor.gov — Volume-Weighted Average Price",url:"https://www.investor.gov/introduction-investing/investing-basics/glossary/volume-weighted-average-price-vwap-0",note:"Official U.S. investor glossary entry." }],
  },
  gap:{
    summary:"A gap is the difference between today’s opening price and the prior close. This model can follow a confirmed gap or fade a gap-down that begins to recover.",
    signal:"Measures gap size, price versus today’s open, and news tone. Continuation needs price to extend with nonnegative news; a fade needs a meaningful gap down followed by recovery without severe negative news.",
    entry:"The setup activates only after the opening auction. Direction must be confirmed relative to the open, and news must not contradict the intended trade.",
    exit:"A continuation fails when price loses the open; a fade fails when recovery stalls and the gap-down low is threatened. All positions are short-horizon.",
    risk:"Overnight gaps often contain real information and can keep extending. The opening spread can be wide, so theoretical entries may be materially better than executable prices.",
    inDepth:"Close-to-open and open-to-close returns are distinct parts of the daily return with different information and liquidity conditions. Pulse separates the overnight displacement from the trading session’s response. It follows acceptance of the new price or fades rejection of it; gap size alone never determines the trade.",
    sources:[{ label:"Research paper — Overnight and Daytime Returns",url:"https://arxiv.org/abs/0903.0993",note:"Empirical separation of close-to-open and open-to-close returns." }],
  },
  squeeze:{
    summary:"A volatility squeeze looks for unusually narrow Bollinger Bands, then waits for price and volume to confirm that a new expansion has begun.",
    signal:"Calculates 20-day band width and recent realized movement. Compression creates a watch state; a directional price break with stronger volume creates the candidate.",
    entry:"Low volatility is necessary but not sufficient. Price must leave the compressed range in a clear direction and volume must expand.",
    exit:"A move back inside the range, weak follow-through, or an opposing break invalidates the setup.",
    risk:"Compression predicts potential expansion, not direction. False breaks are common, and volatility may remain low longer than expected.",
    inDepth:"Bollinger Bands adapt to volatility by placing bands around a moving average using standard deviation. Band contraction describes a quiet regime. Pulse waits for the market to reveal direction instead of guessing it, then uses volume as an independent confirmation that participation is broadening.",
    sources:[{ label:"John Bollinger — Volatility Breakout / The Squeeze",url:"https://bollingerbands.us/help-methods.php",note:"Creator’s explanation of the squeeze method." }],
  },
  closing:{
    summary:"Closing-session momentum tests whether the day’s established direction is likely to persist through the final hour, when institutional rebalancing and benchmark trading intensify.",
    signal:"Combines return from the open, recent intraday trend, market direction, and volume. Agreement across stock and market inputs raises the score.",
    entry:"The model activates only in the final 60–90 minutes and requires an established move with continuing participation rather than a late isolated spike.",
    exit:"The position is intended to close with the session or when the stock loses its intraday trend and market confirmation.",
    risk:"Closing auctions can create abrupt moves unrelated to lasting information. Crowded imbalances, end-of-day spreads, and limited reaction time increase execution risk.",
    inDepth:"Research finds a relationship between early-session and late-session market returns, especially on high-volume or volatile days. Pulse adapts that concept cross-sectionally by checking the individual stock, the broad market, and volume together. The window is narrow because the hypothesis concerns closing flows, not overnight exposure.",
    sources:[{ label:"Gao, Han, Li & Zhou — Market Intraday Momentum",url:"https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2552752",note:"Evidence on return continuation into the final half hour." }],
  },
  "order-flow":{
    summary:"Order-flow imbalance compares visible size at the best bid and ask. More displayed demand than supply can indicate short-lived upward pressure, and the reverse can indicate downward pressure.",
    signal:"Uses Alpaca’s latest IEX bid and ask sizes, then requires short-term price and volume confirmation. It is a top-of-book proxy, not a full-depth order-book model.",
    entry:"The visible imbalance must be material, align with recent price movement, and occur in a liquid name during regular trading.",
    exit:"The setup expires quickly when the imbalance disappears, price stops confirming, or the trading window ends.",
    risk:"Displayed liquidity can cancel instantly, may represent only one venue, and can be strategically placed. The signal is noisy and highly sensitive to latency.",
    inDepth:"Market-microstructure research distinguishes order-flow imbalance from traded volume alone: additions, cancellations, and executions at the best quotes all affect immediate supply and demand. Pulse can observe only the latest top-of-book snapshot, so it uses the idea as a weak directional input and demands independent price and volume evidence.",
    sources:[{ label:"Cont, Kukanov & Stoikov — The Price Impact of Order Book Events",url:"https://arxiv.org/abs/1011.6402",note:"Primary research on order-flow imbalance and short-term price impact." }],
  },
  medallion:{
    summary:"Medallion is a transparent Pulse strategy inspired by publicly known Renaissance Technologies principles: use many small statistical signals, combine them systematically, diversify, and control risk tightly. Renaissance’s actual Medallion Fund methods are proprietary, so this is not a replica or a promise of similar returns.",
    signal:"Blends five independently scaled components: medium-term trend, short-term price behavior, volume and quote participation, headline information, and a volatility-and-gap risk penalty. A candidate needs agreement from at least three confirming inputs.",
    entry:"Only ordinary equities from the existing liquid-stock universe can qualify. The combined score must clear its threshold during regular market hours, and the order must fit inside both the strategy allocation and settled account cash.",
    exit:"A long holding is sold when it falls out of the qualifying roster. The strategy never opens a short position and never buys an option, future, leveraged token, or other debt-producing instrument.",
    risk:"Combining weak signals does not make them reliable. Relationships can disappear, transaction costs can overwhelm small edges, and correlated inputs can create false confidence. Losses remain possible, including the full cash amount invested.",
    inDepth:"Public accounts of Renaissance emphasize data, automated pattern discovery, many modest signals, frequent re-estimation, diversification, and disciplined execution. Pulse implements only a simple, auditable ensemble using the market data already available in this app. It is deliberately cash-only and long-only: cash caps every buy, option symbols are rejected, margin buying power is ignored, leverage is not requested, and exits can only sell an existing positive share quantity.",
    sources:[{ label:"Renaissance Technologies — official firm overview",url:"https://www.rentec.com/",note:"Public description of the quantitative investment firm; proprietary Medallion methods are not disclosed." }],
  },
};

const strategyFallback:StrategySnapshot = {
  scannedAt:new Date().toISOString(),marketOpen:true,totalAllocation:strategyDefinitions.length*1000,
  strategies:strategyDefinitions.map(([id,code,name,short,horizon,description],strategyIndex) => ({
    id,code,name,short,horizon,description,window:strategyWindows[id],allocation:1000,deployed:400,cash:600,enabled:false,paused:false,windowOpen:false,dataMode:"demo" as const,orders:{ bought:[],sold:[] },
    holdings:["NVDA","PLTR","AMD","META"].map((symbol,index) => ({ symbol,rank:index+1,score:89-index*6-strategyIndex,price:125+index*31,day:2.1-index*.3,reason:`Demo rationale: ${symbol} satisfies the ${name.toLowerCase()} entry filters.` })),
  })),
};

const positionsFallback:PositionsSnapshot = {
  mode:"demo",asOf:new Date().toISOString(),
  summary:{ equity:100000,cash:99800,buyingPower:199600,totalMarketValue:200,totalCostBasis:197,totalUnrealizedPnl:3,positionCount:2 },
  categories:strategyDefinitions.map(([id,code,name],index) => ({ id,code,name,allocation:1000,marketValue:index < 2 ? 100 : 0,costBasis:index < 2 ? (index ? 101 : 96) : 0,unrealizedPnl:index < 2 ? (index ? -1 : 4) : 0,realizedPnl:0,totalPnl:index < 2 ? (index ? -1 : 4) : 0,returnPct:index < 2 ? (index ? -.1 : .4) : 0,dayPnl:index < 2 ? (index ? .79 : 2.06) : 0,positionCount:index < 2 ? 1 : 0,positions:index < 2 ? [{ symbol:index ? "PLTR" : "NVDA",qty:index ? .68 : .57,marketValue:100,costBasis:index ? 101 : 96,avgEntryPrice:index ? 148.53 : 168.42,currentPrice:index ? 147.06 : 175.44,unrealizedPnl:index ? -1 : 4,unrealizedPnlPct:index ? -.99 : 4.17,dayChangePct:index ? .8 : 2.1,dayPnl:index ? .79 : 2.06 }] : [] })),
};

const transactionsFallback:TransactionSnapshot = {
  mode:"demo",asOf:new Date().toISOString(),transactions:[
    { id:"demo-1",symbol:"NVDA",side:"buy",status:"filled",qty:.57,price:168.42,total:96,filledAt:new Date(Date.now()-18*60_000).toISOString(),strategyCode:"mom",strategyName:"Medium-term momentum" },
    { id:"demo-2",symbol:"PLTR",side:"buy",status:"filled",qty:.68,price:148.53,total:101,filledAt:new Date(Date.now()-47*60_000).toISOString(),strategyCode:"qv",strategyName:"Quality + value" },
    { id:"demo-3",symbol:"AMD",side:"sell",status:"filled",qty:.62,price:161.29,total:100,filledAt:new Date(Date.now()-2.4*60*60_000).toISOString(),strategyCode:"news",strategyName:"News-catalyst momentum" },
  ],
};

const fallback: Snapshot = {
  mode: "demo",
  scannedAt: new Date().toISOString(),
  marketOpen: true,
  account: { equity: 104287.42, buyingPower: 184120, dayPnl: 1287.42, dayPnlPct: 1.25 },
  breadth: { bullish: 54, neutral: 27, bearish: 19 },
  signals: [
    ["NVDA","NVIDIA",174.31,2.84,82,91],["PLTR","Palantir",147.62,2.31,75,88],["AMD","AMD",158.62,1.92,71,84],["AVGO","Broadcom",292.74,1.67,68,81],["META","Meta",704.18,1.42,63,79],["AMZN","Amazon",226.45,1.18,58,76],["MSFT","Microsoft",512.09,.96,54,73],["GOOGL","Alphabet",197.88,.83,51,71],["UBER","Uber",93.16,.76,47,68],["JPM","JPMorgan",289.52,.64,44,66],
  ].map(([symbol,name,price,change,sentiment,confidence], index) => ({ symbol:String(symbol), name:String(name), price:Number(price), change:Number(change), sentiment:Number(sentiment), confidence:Number(confidence), buyScore:Number(confidence), rank:index + 1, action:"BUY" as const, reason:`Ranked #${index + 1} by combined sentiment and price momentum.`, mentions:20-index, evidence:symbol === "NVDA" || symbol === "AMD" ? [{ source:"Reuters",headline:"Chipmakers climb as AI infrastructure spending outlook strengthens",score:40,positiveTerms:["strong"],negativeTerms:[] }] : symbol === "META" || symbol === "MSFT" ? [{ source:"Bloomberg",headline:"Technology shares advance on improving demand expectations",score:0,positiveTerms:[],negativeTerms:[] }] : [], spark:[31,38,34,49,52,61,58,72,78,91].map((v) => v + index) })),
  news: [
    { source: "Reuters", headline: "Chipmakers climb as AI infrastructure spending outlook strengthens", age: "4m", sentiment: "positive", symbols: ["NVDA", "AMD"] },
    { source: "MarketWatch", headline: "U.S. equities hold gains as traders parse fresh economic data", age: "11m", sentiment: "neutral", symbols: ["SPY"] },
    { source: "Bloomberg", headline: "EV makers face renewed questions on near-term delivery pace", age: "18m", sentiment: "negative", symbols: ["TSLA"] },
  ],
  execution: { enabled: false, ordersPlaced: 0, positions: [] },
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const exactMoney = new Intl.NumberFormat("en-US", { style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2 });
const shares = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

function Sparkline({ values, action }: { values: number[]; action: Signal["action"] }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  return (
    <div className={`spark spark-${action.toLowerCase()}`} aria-label="Recent price momentum">
      {values.map((value, index) => (
        <i key={index} style={{ height: `${18 + ((value - min) / Math.max(1, max - min)) * 54}%` }} />
      ))}
    </div>
  );
}

function AccountSettings({ account,activeProfile="paper",setup=false,onSaved,onProfileChange,onClose }:{ account:AccountState;activeProfile?:AccountProfile;setup?:boolean;onSaved:(next:AccountState) => void;onProfileChange?:(profile:AccountProfile) => void;onClose?:() => void }) {
  const [profile,setProfile] = useState<AccountProfile>(activeProfile);
  const [keyId,setKeyId] = useState("");
  const [secretKey,setSecretKey] = useState("");
  const [autoTrade,setAutoTrade] = useState(account.profiles[activeProfile].autoTrade);
  const [saving,setSaving] = useState(false);
  const [message,setMessage] = useState("");
  const summary=account.profiles[profile];
  const chooseProfile=(next:AccountProfile) => { setProfile(next);setKeyId("");setSecretKey("");setAutoTrade(account.profiles[next].autoTrade);setMessage(""); };
  const save = async (event:React.FormEvent) => {
    event.preventDefault();setSaving(true);setMessage("Verifying with Alpaca…");
    try {
      const response = await fetch("/api/settings",{ method:"PUT",headers:{ "content-type":"application/json" },body:JSON.stringify({ profile,keyId,secretKey,autoTrade }) });
      const result = await response.json() as AccountState & { error?:string };
      if (!response.ok) throw new Error(result.error || "Settings could not be saved");
      onSaved({ ...result,status:"authenticated" });onProfileChange?.(profile);setKeyId("");setSecretKey("");setMessage(`${profile === "live" ? "Live" : "Paper"} profile saved and kept separate.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Settings could not be saved"); }
    finally { setSaving(false); }
  };
  return <section className={setup ? "account-setup" : "settings-dialog"} aria-label="Alpaca account settings">
    <div className="settings-card">
      <header><div><small>{setup ? "PERSONAL WORKSPACE SETUP" : "ACCOUNT PROFILES"}</small><h1>{setup ? "Connect an Alpaca account." : "Paper and live, separated"}</h1></div>{onClose && <button type="button" onClick={onClose} aria-label="Close settings">×</button>}</header>
      <p>Signed in as <strong>{account.user?.email}</strong>. Each profile has separate credentials, strategy controls, positions, transactions, and performance history.</p>
      <div className="profile-settings-tabs" role="tablist" aria-label="Alpaca account profile"><button type="button" role="tab" aria-selected={profile==="paper"} onClick={() => chooseProfile("paper")}><span>PAPER</span><small>{account.profiles.paper.configured?"CONNECTED":"NOT CONNECTED"}</small></button><button type="button" role="tab" aria-selected={profile==="live"} onClick={() => chooseProfile("live")}><span>LIVE</span><small>{account.profiles.live.configured?"CONNECTED":"NOT CONNECTED"}</small></button></div>
      {profile === "live" && <div className="live-account-warning"><strong>REAL-MONEY ACCOUNT</strong><p>Live credentials connect to Alpaca’s production trading endpoint. Auto-trading remains off unless you explicitly enable it below.</p></div>}
      {summary.configured && <div className="connection-status"><span>CONNECTED</span><strong>{summary.keyHint}</strong><small>{summary.source === "legacy" ? "Owner-only environment credentials" : `${profile === "live" ? "Live" : "Paper"} profile · stored for this user`}</small></div>}
      {summary.source === "legacy" ? <div className="owner-managed"><strong>MANAGED BY THE HOSTED ENVIRONMENT</strong><p>The Paper profile is read-only here. You can still add an independent Live profile using the Live tab.</p></div> : <form onSubmit={save}>
        <label><span>ALPACA {profile.toUpperCase()} API KEY ID</span><input value={keyId} onChange={(event) => setKeyId(event.target.value)} autoComplete="off" placeholder={summary.source === "stored" ? "Leave blank to keep current key" : `Enter ${profile} API key ID`} required={summary.source !== "stored"} /></label>
        <label><span>ALPACA {profile.toUpperCase()} SECRET KEY</span><input type="password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} autoComplete="new-password" placeholder={summary.source === "stored" ? "Leave blank to keep current secret" : `Enter ${profile} secret key`} required={summary.source !== "stored"} /></label>
        <label className={`trade-toggle ${profile === "live" ? "live-trade-toggle" : ""}`}><input type="checkbox" checked={autoTrade} onChange={(event) => setAutoTrade(event.target.checked)} /><span><strong>Enable {profile} auto-trading</strong><small>{profile === "live" ? "Allows strategies to submit real-money orders to this live Alpaca account." : "Allows strategies to submit orders to this Alpaca sandbox account."}</small></span></label>
        <button className="save-settings" disabled={saving}>{saving ? "VERIFYING…" : summary.source === "stored" ? `SAVE ${profile.toUpperCase()} SETTINGS` : `CONNECT ${profile.toUpperCase()} ACCOUNT`}</button>
      </form>}
      {message && <p className="settings-message" role="status">{message}</p>}
      <footer><span>{profile === "live" ? "Alpaca production profile" : "Alpaca sandbox profile"}</span><span>Secrets are encrypted and never returned to the browser</span></footer>
    </div>
  </section>;
}

function PerformanceChart({ points,loading }:{ points:PerformancePoint[];loading:boolean }) {
  const [rangeDays,setRangeDays]=useState<(typeof performanceRanges)[number]["days"]>(365);
  const [windowRange,setWindowRange]=useState<[number,number]|null>(null);
  const [selection,setSelection]=useState<{start:number;current:number}|null>(null);
  const latest=points.at(-1);
  const rangePoints=useMemo(() => {
    if (!latest) return [];
    const cutoff=new Date(latest.recordedAt).getTime()-rangeDays*24*60*60*1000;
    return points.filter((point) => new Date(point.recordedAt).getTime()>=cutoff);
  },[latest,points,rangeDays]);
  const effectiveWindow=useMemo<[number,number]>(()=>{if(!rangePoints.length)return[0,-1];if(!windowRange)return[0,rangePoints.length-1];const start=Math.max(0,Math.min(rangePoints.length-1,windowRange[0])),end=Math.max(start,Math.min(rangePoints.length-1,windowRange[1]));return[start,end];},[rangePoints,windowRange]);
  const visibleEntries=useMemo(() => {
    const [start,end]=effectiveWindow,windowPoints=rangePoints.slice(start,end+1).map((point,index)=>({point,sourceIndex:start+index})),maxBars=160;
    if (windowPoints.length<=maxBars) return windowPoints;
    return Array.from({ length:maxBars },(_,index) => windowPoints[Math.floor(index*(windowPoints.length-1)/(maxBars-1))]);
  },[effectiveWindow,rangePoints]);
  const visible=visibleEntries.map((entry)=>entry.point),isZoomed=effectiveWindow[0]>0||effectiveWindow[1]<rangePoints.length-1;
  const changeZoom=(direction:number,anchor=.5) => {const currentCount=effectiveWindow[1]-effectiveWindow[0]+1,nextCount=direction>0?Math.max(12,Math.round(currentCount*.6)):Math.min(rangePoints.length,Math.round(currentCount*1.67));if(nextCount===currentCount)return;const center=effectiveWindow[0]+Math.round((currentCount-1)*anchor),start=Math.max(0,Math.min(rangePoints.length-nextCount,center-Math.round(nextCount*anchor)));setWindowRange([start,start+nextCount-1]);setSelection(null);};
  const position=(event:ReactPointerEvent<HTMLDivElement>)=>{const rect=event.currentTarget.getBoundingClientRect();return Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));};
  const selectStart=(event:ReactPointerEvent<HTMLDivElement>)=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);const x=position(event);setSelection({start:x,current:x});};
  const selectMove=(event:ReactPointerEvent<HTMLDivElement>)=>{if(selection)setSelection({...selection,current:position(event)});};
  const selectEnd=()=>{if(!selection)return;const left=Math.min(selection.start,selection.current),right=Math.max(selection.start,selection.current);setSelection(null);if(right-left<.025||visibleEntries.length<3)return;const first=Math.max(0,Math.min(visibleEntries.length-1,Math.floor(left*visibleEntries.length))),last=Math.max(first,Math.min(visibleEntries.length-1,Math.ceil(right*visibleEntries.length)-1));if(last-first<2)return;setWindowRange([visibleEntries[first].sourceIndex,visibleEntries[last].sourceIndex]);};
  const reset=()=>{setWindowRange(null);setSelection(null);};
  const max=Math.max(1,...visible.map((point) => Math.abs(point.totalPnl)));
  const selectedRange=performanceRanges.find((range) => range.days===rangeDays)!;
  return <section className="performance-chart" aria-label="Historical strategy profit and loss">
    <header><div><small>HISTORICAL PERFORMANCE</small><h3>Strategy equity and cumulative P&amp;L</h3></div><div><strong className={(latest?.totalPnl??0)>=0?"up":"down"}>{latest ? `${latest.totalPnl>=0?"+":""}${exactMoney.format(latest.totalPnl)}` : "—"}</strong><small>{latest ? exactMoney.format(latest.equity) : "$1,000.00"} strategy equity</small></div></header>
    <div className="performance-ranges" role="group" aria-label="Profit and loss time range">
      <span>TIME SCALE</span>
      {performanceRanges.map((range) => <button key={range.short} type="button" aria-pressed={range.days===rangeDays} aria-label={`Show ${range.label} of profit and loss history`} title={range.label} onClick={() => {setRangeDays(range.days);reset();}}>{range.short}</button>)}
    </div>
    {loading ? <p className="chart-empty">Loading performance history…</p> : visible.length ? <>
      <div className="chart-zoom-controls performance-zoom" role="group" aria-label="Zoom historical performance chart"><span>{isZoomed?"ZOOMED":"FULL"} · {effectiveWindow[1]-effectiveWindow[0]+1} POINTS · DRAG TO SELECT</span><button type="button" onClick={()=>changeZoom(-1)} disabled={!isZoomed} aria-label="Zoom out historical performance chart">−</button><button type="button" onClick={()=>changeZoom(1)} disabled={effectiveWindow[1]-effectiveWindow[0]+1<=12} aria-label="Zoom in historical performance chart">+</button><button type="button" onClick={reset} disabled={!isZoomed}>RESET</button></div>
      <div className="pnl-chart chart-selectable" onPointerDown={selectStart} onPointerMove={selectMove} onPointerUp={selectEnd} onPointerCancel={()=>setSelection(null)} onWheel={(event)=>{event.preventDefault();const rect=event.currentTarget.getBoundingClientRect(),anchor=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));changeZoom(event.deltaY<0?1:-1,anchor);}} role="img" aria-label={`${selectedRange.label} profit and loss chart showing ${effectiveWindow[1]-effectiveWindow[0]+1} of ${rangePoints.length} recorded strategy performance points. Drag across a portion to zoom into it, use the mouse wheel to zoom, or use the zoom buttons.`}><span className="chart-zero" />{visible.map((point) => <i key={point.recordedAt} className={point.totalPnl>=0?"positive":"negative"} style={{ height:`${Math.max(2,Math.abs(point.totalPnl)/max*46)}%` }} title={`${new Date(point.recordedAt).toLocaleString()}: ${exactMoney.format(point.totalPnl)}`} />)}{selection&&<span className="chart-selection" style={{left:`${Math.min(selection.start,selection.current)*100}%`,width:`${Math.abs(selection.current-selection.start)*100}%`}}><b>RELEASE TO ZOOM</b></span>}</div>
      <footer><span>{new Date(visible[0].recordedAt).toLocaleString([], { month:"short",day:"numeric",hour:"numeric",minute:"2-digit" })}</span><span>15-minute snapshots · {selectedRange.label} · realized + open P&amp;L</span><span>{new Date(visible.at(-1)!.recordedAt).toLocaleString([], { month:"short",day:"numeric",hour:"numeric",minute:"2-digit" })}</span></footer>
    </> : <p className="chart-empty">History starts with the next successful Alpaca position scan. New snapshots are recorded every 15 minutes.</p>}
  </section>;
}

function MiniStrategyChart({ points }:{ points:PerformancePoint[] }) {
  const [windowRange,setWindowRange]=useState<[number,number]|null>(null),[selection,setSelection]=useState<{start:number;current:number}|null>(null);const baseStart=Math.max(0,points.length-24),effectiveWindow:readonly [number,number]=windowRange?[Math.max(baseStart,windowRange[0]),Math.min(points.length-1,windowRange[1])]:[baseStart,points.length-1],visible=points.slice(effectiveWindow[0],effectiveWindow[1]+1),latest=visible.at(-1)?.totalPnl ?? 0,scale=Math.max(1,...visible.map((point) => Math.abs(point.totalPnl))),isZoomed=effectiveWindow[0]>baseStart||effectiveWindow[1]<points.length-1;
  const changeZoom=(direction:number,anchor=.5)=>{const total=Math.min(24,points.length),currentCount=visible.length,nextCount=direction>0?Math.max(4,Math.round(currentCount*.67)):Math.min(total,Math.round(currentCount*1.5));if(nextCount===currentCount)return;const center=effectiveWindow[0]+Math.round((currentCount-1)*anchor),start=Math.max(baseStart,Math.min(points.length-nextCount,center-Math.round(nextCount*anchor)));setWindowRange([start,start+nextCount-1]);};
  const position=(event:ReactPointerEvent<HTMLDivElement>)=>{const rect=event.currentTarget.getBoundingClientRect();return Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));};
  const selectEnd=()=>{if(!selection)return;const left=Math.min(selection.start,selection.current),right=Math.max(selection.start,selection.current);setSelection(null);if(right-left<.05||visible.length<3)return;const first=Math.max(0,Math.min(visible.length-1,Math.floor(left*visible.length))),last=Math.max(first,Math.min(visible.length-1,Math.ceil(right*visible.length)-1));if(last-first<1)return;setWindowRange([effectiveWindow[0]+first,effectiveWindow[0]+last]);};
  return <div className="mini-performance" aria-label={visible.length ? `Recent performance, ${latest>=0?"plus ":"minus "}${Math.abs(latest).toFixed(2)} dollars` : "No performance history yet"}>
    <div className="mini-bars chart-selectable" onPointerDown={(event)=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);const x=position(event);setSelection({start:x,current:x});}} onPointerMove={(event)=>{if(selection)setSelection({...selection,current:position(event)});}} onPointerUp={selectEnd} onPointerCancel={()=>setSelection(null)} onWheel={(event)=>{event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();changeZoom(event.deltaY<0?1:-1,Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width))));}} title="Drag across a portion to zoom into it">{visible.length ? visible.map((point,index) => <i key={`${point.recordedAt}-${index}`} className={point.totalPnl>=0?"positive":"negative"} style={{ height:`${Math.max(8,Math.abs(point.totalPnl)/scale*100)}%` }} />) : Array.from({ length:12 },(_,index) => <i className="empty" key={index} style={{ height:`${18+(index%4)*8}%` }} />)}{selection&&<span className="chart-selection mini-selection" style={{left:`${Math.min(selection.start,selection.current)*100}%`,width:`${Math.abs(selection.current-selection.start)*100}%`}}/>}</div>
    <div className="mini-chart-footer"><span className={latest>=0?"up":"down"}>{visible.length ? `${latest>=0?"+":""}${exactMoney.format(latest)}` : "NO HISTORY"}</span><div className="mini-zoom" role="group" aria-label="Zoom recent strategy performance"><button type="button" onClick={()=>changeZoom(-1)} disabled={!isZoomed} aria-label="Zoom out recent strategy performance">−</button><small>{visible.length}P</small><button type="button" onClick={()=>changeZoom(1)} disabled={visible.length<=4} aria-label="Zoom in recent strategy performance">+</button><button type="button" onClick={()=>{setWindowRange(null);setSelection(null);}} disabled={!isZoomed} aria-label="Reset recent strategy performance zoom">↺</button></div></div>
  </div>;
}

export default function Home() {
  const pathname = usePathname();
  const [account,setAccount] = useState<AccountState>({ status:"loading",profiles:emptyProfiles });
  const [activeProfile,setActiveProfile] = useState<AccountProfile>("paper");
  const [settingsOpen,setSettingsOpen] = useState(false);
  const [settingsProfile,setSettingsProfile] = useState<AccountProfile>("paper");
  const [data, setData] = useState<Snapshot>(fallback);
  const [strategyData,setStrategyData] = useState<StrategySnapshot>(strategyFallback);
  const [positionsData,setPositionsData] = useState<PositionsSnapshot>(positionsFallback);
  const [transactionsData,setTransactionsData] = useState<TransactionSnapshot>(transactionsFallback);
  const [activeStrategy,setActiveStrategy] = useState("momentum");
  const [strategyTrading,setStrategyTrading] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [trading, setTrading] = useState(false);
  const [seconds, setSeconds] = useState(REFRESH_SECONDS);
  const [activeSymbol, setActiveSymbol] = useState("NVDA");
  const [notice, setNotice] = useState("");
  const [performance,setPerformance] = useState<PerformancePoint[]>([]);
  const [strategyPerformance,setStrategyPerformance] = useState<Record<string,PerformancePoint[]>>({});
  const [performanceLoading,setPerformanceLoading] = useState(false);
  const [transactionFrom,setTransactionFrom] = useState("");
  const [transactionTo,setTransactionTo] = useState("");
  const [transactionStock,setTransactionStock] = useState("all");
  const [transactionStrategy,setTransactionStrategy] = useState("all");
  const initialScanStarted = useRef(false);
  const activeProfileSummary=account.profiles[activeProfile];

  useEffect(() => {
    let active = true;
    fetch("/api/settings").then(async (response) => {
      if (!active) return;
      if (response.status === 401) { setAccount({ status:"anonymous",profiles:emptyProfiles });return; }
      const result = await response.json() as Omit<AccountState,"status"> & { error?:string };
      if (!response.ok) throw new Error(result.error || "Account settings are unavailable");
      const preferredProfile = window.localStorage.getItem("pulse-active-profile");
      if (preferredProfile === "paper" || preferredProfile === "live") setActiveProfile(preferredProfile);
      setAccount({ ...result,status:"authenticated" });
    }).catch((error) => active && setAccount({ status:"error",profiles:emptyProfiles,error:error instanceof Error ? error.message : "Account settings are unavailable" }));
    return () => { active = false; };
  },[]);

  useEffect(() => {
    if (account.status!=="authenticated"||!activeProfileSummary.configured) return;
    let active=true;setPerformanceLoading(true);
    fetch(`/api/performance?profile=${activeProfile}&strategyId=${encodeURIComponent(activeStrategy)}`).then(async (response) => {
      const result=await response.json() as { points?:PerformancePoint[] };if (!response.ok) throw new Error("Performance unavailable");if (active) setPerformance(result.points??[]);
    }).catch(() => active&&setPerformance([])).finally(() => active&&setPerformanceLoading(false));
    return () => { active=false; };
  },[account.status,activeProfile,activeProfileSummary.configured,activeStrategy,positionsData.asOf]);

  useEffect(() => {
    if (account.status!=="authenticated"||!activeProfileSummary.configured) return;
    let active=true;
    fetch(`/api/performance?profile=${activeProfile}&all=1`).then(async (response) => {
      const result=await response.json() as { histories?:Record<string,PerformancePoint[]> };if (!response.ok) throw new Error("Performance unavailable");if (active) setStrategyPerformance(result.histories??{});
    }).catch(() => active&&setStrategyPerformance({}));
    return () => { active=false; };
  },[account.status,activeProfile,activeProfileSummary.configured,positionsData.asOf]);

  const runScan = useCallback(async () => {
    if (account.status !== "authenticated" || !activeProfileSummary.configured || scanning || trading) return;
    setScanning(true);
    setNotice("Agent is reading market data and the latest news…");
    try {
      const [response,strategyResponse,positionsResponse,transactionsResponse] = await Promise.all([
        fetch("/api/agent", { method:"POST",headers:{ "content-type":"application/json" },body:JSON.stringify({ profile:activeProfile,execute:false }) }),
        fetch("/api/strategies", { method:"POST",headers:{ "content-type":"application/json" },body:JSON.stringify({ profile:activeProfile,execute:true }) }),
        fetch(`/api/positions?profile=${activeProfile}`, { method:"POST" }),
        fetch(`/api/transactions?profile=${activeProfile}`),
      ]);
      if (!response.ok || !strategyResponse.ok || !positionsResponse.ok || !transactionsResponse.ok) throw new Error("Scan unavailable");
      const next = (await response.json()) as Snapshot;
      const nextStrategies = (await strategyResponse.json()) as StrategySnapshot;
      const nextPositions = (await positionsResponse.json()) as PositionsSnapshot;
      const nextTransactions = (await transactionsResponse.json()) as TransactionSnapshot;
      setData(next);
      setStrategyData(nextStrategies);
      setPositionsData(nextPositions);
      setTransactionsData(nextTransactions);
      const strategyOrders = nextStrategies.strategies.reduce((sum,strategy) => sum+strategy.orders.bought.length+strategy.orders.sold.length,0);
      setNotice(next.mode === "live" ? `${nextStrategies.strategies.length}-strategy ${activeProfile} scan complete${strategyOrders ? ` — ${strategyOrders} ${activeProfile} orders submitted.` : "."}` : `Demo scan complete — add Alpaca ${activeProfile} credentials to connect.`);
    } catch {
      setData({ ...fallback, scannedAt: new Date().toISOString() });
      setNotice(`Using a demo snapshot while the ${activeProfile} profile is offline.`);
    } finally {
      setScanning(false);
      setSeconds(REFRESH_SECONDS);
    }
  }, [account.status,activeProfile,activeProfileSummary.configured,scanning,trading]);

  const tradeNow = useCallback(async () => {
    if (scanning || trading) return;
    setTrading(true);
    setNotice(`Refreshing signals and preparing the ${activeProfile} rotation…`);
    try {
      const [response,strategyResponse,positionsResponse,transactionsResponse] = await Promise.all([
        fetch("/api/agent", { method:"POST",headers:{ "content-type":"application/json" },body:JSON.stringify({ profile:activeProfile,execute:false }) }),
        fetch("/api/strategies", { method:"POST",headers:{ "content-type":"application/json" },body:JSON.stringify({ profile:activeProfile,execute:true }) }),
        fetch(`/api/positions?profile=${activeProfile}`, { method:"POST" }),
        fetch(`/api/transactions?profile=${activeProfile}`),
      ]);
      if (!response.ok || !strategyResponse.ok || !positionsResponse.ok || !transactionsResponse.ok) throw new Error("Trade unavailable");
      const next = (await response.json()) as Snapshot;
      const nextStrategies = (await strategyResponse.json()) as StrategySnapshot;
      const nextPositions = (await positionsResponse.json()) as PositionsSnapshot;
      const nextTransactions = (await transactionsResponse.json()) as TransactionSnapshot;
      setData(next);
      setStrategyData(nextStrategies);
      setPositionsData(nextPositions);
      setTransactionsData(nextTransactions);
      const bought = nextStrategies.strategies.flatMap((strategy) => strategy.orders.bought.map((symbol) => `${strategy.name}: ${symbol}`));
      const sold = nextStrategies.strategies.flatMap((strategy) => strategy.orders.sold.map((symbol) => `${strategy.name}: ${symbol}`));
      if (next.mode !== "live") {
        setNotice(`${activeProfile === "live" ? "Live" : "Paper"} trading is in demo mode. Add matching Alpaca credentials to submit orders.`);
      } else if (!next.execution.enabled) {
        setNotice(`${activeProfile === "live" ? "Live" : "Paper"} execution is locked. Enable auto-trading in that profile’s secure settings.`);
      } else if (bought.length || sold.length) {
        const actions = [...sold.map((symbol) => `sold ${symbol}`), ...bought.map((symbol) => `bought $100 of ${symbol}`)];
        setNotice(`Strategy rotations submitted — ${actions.join(", ")}.`);
      } else {
        setNotice("No active strategy inside its trading window required a portfolio change.");
      }
    } catch {
      setNotice(`The ${activeProfile} trade could not be submitted. Please try again.`);
    } finally {
      setTrading(false);
      setSeconds(REFRESH_SECONDS);
    }
  }, [activeProfile,scanning,trading]);

  const tradeOneStrategy = useCallback(async (strategyId:string) => {
    if (scanning || trading || strategyTrading) return;
    setStrategyTrading(strategyId);
    const strategy = strategyData.strategies.find((item) => item.id === strategyId);
    setNotice(`Refreshing ${strategy?.name ?? "strategy"} signals…`);
    try {
      const response = await fetch("/api/strategies", { method:"POST",headers:{ "content-type":"application/json" },body:JSON.stringify({ profile:activeProfile,execute:true,strategyId }) });
      if (!response.ok) throw new Error("Strategy trade unavailable");
      const next = (await response.json()) as StrategySnapshot;
      setStrategyData(next);
      const refreshedPositions = await fetch(`/api/positions?profile=${activeProfile}`,{ method:"POST" });
      if (refreshedPositions.ok) setPositionsData(await refreshedPositions.json() as PositionsSnapshot);
      const refreshedTransactions = await fetch(`/api/transactions?profile=${activeProfile}`);
      if (refreshedTransactions.ok) setTransactionsData(await refreshedTransactions.json() as TransactionSnapshot);
      const updated = next.strategies.find((item) => item.id === strategyId);
      if (!updated || updated.dataMode !== "live") setNotice(`Strategy trading is in demo mode. Add Alpaca ${activeProfile} credentials to submit orders.`);
      else if (!updated.enabled) setNotice(`${activeProfile === "live" ? "Live" : "Paper"} execution is locked. Enable auto-trading in secure settings.`);
      else if (updated.paused) setNotice(`${updated.name} is paused. Analysis continues, but trading is disabled.`);
      else if (!updated.windowOpen) setNotice(`${updated.name} is outside its ${updated.window} trading window. No order was submitted.`);
      else if (updated.orders.bought.length || updated.orders.sold.length) setNotice(`${updated.name} submitted ${updated.orders.bought.length} buys and ${updated.orders.sold.length} sells.`);
      else setNotice(`${updated.name} is aligned for the current window; no order was needed.`);
    } catch { setNotice("The strategy trade could not be submitted. Please try again."); }
    finally { setStrategyTrading(null);setSeconds(REFRESH_SECONDS); }
  },[activeProfile,scanning,trading,strategyTrading,strategyData.strategies]);

  const toggleStrategyPause = useCallback(async (strategyId:string,paused:boolean) => {
    if (strategyTrading) return;setStrategyTrading(strategyId);setNotice(paused?"Pausing this strategy…":"Resuming this strategy…");
    try {
      const response=await fetch("/api/strategy-settings",{ method:"PUT",headers:{ "content-type":"application/json" },body:JSON.stringify({ profile:activeProfile,strategyId,paused }) });
      if (!response.ok) throw new Error("Pause control unavailable");
      setStrategyData((current) => ({ ...current,strategies:current.strategies.map((strategy) => strategy.id===strategyId?{ ...strategy,paused }:strategy) }));
      setNotice(paused?"Strategy paused. Signals and performance tracking continue, but no orders will be submitted.":"Strategy resumed. Orders remain gated by its theory-aligned trading window.");
    } catch { setNotice("The strategy pause setting could not be saved."); }
    finally { setStrategyTrading(null); }
  },[activeProfile,strategyTrading]);

  useEffect(() => {
    if (account.status !== "authenticated" || !activeProfileSummary.configured) return;
    if (initialScanStarted.current) return;
    initialScanStarted.current = true;
    void runScan();
  }, [account.status,activeProfile,activeProfileSummary.configured,runScan]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!running) return;
      setSeconds((current) => {
        if (current <= 1) {
          window.setTimeout(runScan, 0);
          return REFRESH_SECONDS;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, runScan]);

  const activateProfile=useCallback((profile:AccountProfile) => {
    try { window.localStorage.setItem("pulse-active-profile",profile); } catch { /* Selection remains active for this page. */ }
    initialScanStarted.current=false;setActiveProfile(profile);setData(fallback);setStrategyData(strategyFallback);setPositionsData(positionsFallback);setTransactionsData(transactionsFallback);setPerformance([]);setStrategyPerformance({});setSeconds(REFRESH_SECONDS);setNotice(`Switched to the isolated ${profile === "live" ? "Live" : "Paper"} profile.`);
  },[]);

  const selected = useMemo(
    () => data.signals.find((signal) => signal.symbol === activeSymbol) ?? data.signals[0] ?? fallback.signals[0],
    [activeSymbol, data.signals],
  );
  const analysis = useMemo(() => {
    const signalCount = data.signals.length;
    const averageSentiment = signalCount
      ? Math.round(data.signals.reduce((sum, signal) => sum + signal.sentiment, 0) / signalCount)
      : 0;
    const strongestSentiment = data.signals.reduce<Signal | null>(
      (strongest, signal) => !strongest || signal.sentiment > strongest.sentiment ? signal : strongest,
      null,
    );
    const headlineMix = data.news.reduce(
      (mix, story) => ({ ...mix, [story.sentiment]: mix[story.sentiment] + 1 }),
      { positive: 0, neutral: 0, negative: 0 },
    );
    const marketRead = data.breadth.bullish > data.breadth.bearish
      ? "Bullish participation leads"
      : data.breadth.bearish > data.breadth.bullish
        ? "Bearish participation leads"
        : "Participation is balanced";
    const executionResult = data.mode !== "live"
      ? `Demo results only — no ${activeProfile} orders were sent.`
      : !data.execution.enabled
        ? `Analysis is live; ${activeProfile} execution is currently locked.`
        : data.execution.ordersPlaced > 0
          ? `${data.execution.ordersPlaced} ${activeProfile} order${data.execution.ordersPlaced === 1 ? " was" : "s were"} submitted in this run.`
          : `The ${activeProfile} portfolio already matched the current top 10, so no order was needed.`;
    return { averageSentiment, strongestSentiment, headlineMix, marketRead, executionResult };
  }, [activeProfile,data]);
  const selectedStrategy = useMemo(() => strategyData.strategies.find((strategy) => strategy.id === activeStrategy) ?? strategyData.strategies[0],[activeStrategy,strategyData.strategies]);
  const selectedEducation = strategyEducation[selectedStrategy.id] ?? strategyEducation.momentum;
  const selectedCadence = strategyCadence[selectedStrategy.id] ?? strategyCadence.momentum;
  const activeStrategyIndex = Math.max(0,strategyData.strategies.findIndex((strategy) => strategy.id === selectedStrategy.id));
  const moveStrategy = useCallback((direction:number) => {
    if (!strategyData.strategies.length) return;
    const next=(activeStrategyIndex+direction+strategyData.strategies.length)%strategyData.strategies.length;
    setActiveStrategy(strategyData.strategies[next].id);
  },[activeStrategyIndex,strategyData.strategies]);
  const transactionStocks = useMemo(() => Array.from(new Set(transactionsData.transactions.map((transaction) => transaction.symbol))).sort(),[transactionsData.transactions]);
  const transactionStrategies = useMemo(() => Array.from(new Map(transactionsData.transactions.map((transaction) => [transaction.strategyCode,transaction.strategyName])).entries()).sort((a,b) => a[1].localeCompare(b[1])),[transactionsData.transactions]);
  const filteredTransactions = useMemo(() => {
    const fromTime = transactionFrom ? new Date(transactionFrom).getTime() : Number.NEGATIVE_INFINITY;
    const toTime = transactionTo ? new Date(transactionTo).getTime() : Number.POSITIVE_INFINITY;
    return transactionsData.transactions.filter((transaction) => {
      const filledTime = new Date(transaction.filledAt).getTime();
      return filledTime >= fromTime && filledTime <= toTime
        && (transactionStock === "all" || transaction.symbol === transactionStock)
        && (transactionStrategy === "all" || transaction.strategyCode === transactionStrategy);
    });
  },[transactionsData.transactions,transactionFrom,transactionTo,transactionStock,transactionStrategy]);
  const pageKey = pathname === "/signals" ? "signals"
    : pathname === "/why-these-decisions" || pathname === "/decisions" ? "decisions"
      : pathname === "/strategy-lab" || pathname === "/strategies" ? "strategies"
        : pathname === "/positions" ? "positions"
          : pathname === "/transactions" ? "transactions"
            : pathname === "/news-radar" || pathname === "/news" ? "news"
              : "command";
  const activeNavHref:Record<string,string> = {
    command:"/command-center",
    signals:"/signals",
    decisions:"/why-these-decisions",
    strategies:"/strategy-lab",
    positions:"/positions",
    transactions:"/transactions",
    news:"/news-radar",
  };
  const pageMeta:Record<string,{ eyebrow:string;title:string;description:string }> = {
    signals:{ eyebrow:"RANKED MARKET EVIDENCE",title:"Signals",description:"Compare the agent’s highest-conviction names, inspect price and sentiment inputs, and open the full thesis for any selected stock." },
    decisions:{ eyebrow:"EXPLAINABLE MARKET INTELLIGENCE",title:"Why these decisions",description:"Audit the score formula, sentiment breadth, and individual decision trace behind the latest ranked roster." },
    strategies:{ eyebrow:`${strategyDefinitions.length} INDEPENDENT ${activeProfile.toUpperCase()} MODELS`,title:"Strategy lab",description:`Explore each strategy’s qualifiers, cadence, allocation, and isolated ${activeProfile} performance.` },
    positions:{ eyebrow:`ALPACA ${activeProfile.toUpperCase()} PORTFOLIO`,title:"Positions",description:`Review holdings, cost basis, profit and loss, and strategy attribution for the isolated ${activeProfile} profile.` },
    transactions:{ eyebrow:"FILTERABLE EXECUTION HISTORY",title:"Transactions",description:`Search filled Alpaca ${activeProfile} orders by time range, stock, or originating strategy.` },
    news:{ eyebrow:"TICKER-AWARE HEADLINE TONE",title:"News radar",description:"Read the latest stories used by the agent and see which symbols and sentiment labels were attached to them." },
  };
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  if (account.status === "loading") return <main className="account-gate"><div className="gate-card"><span className="orb orb-live"><i /></span><small>SECURE WORKSPACE</small><h1>Loading your market agent…</h1></div></main>;
  if (account.status === "anonymous") return <main className="account-gate"><div className="gate-card"><span className="brand-mark">P</span><small>MULTI-USER MARKET INTELLIGENCE</small><h1>Your trading agent.<br /><em>Your Alpaca accounts.</em></h1><p>Sign in with ChatGPT to access isolated Paper and Live account profiles with separate credentials and performance histories.</p><a className="signin-button" href="/signin-with-chatgpt?return_to=%2F">SIGN IN WITH CHATGPT →</a></div></main>;
  if (account.status === "error") return <main className="account-gate"><div className="gate-card"><small>SETUP UNAVAILABLE</small><h1>Secure storage needs attention.</h1><p>{account.error}</p><button className="signin-button" onClick={() => window.location.reload()}>TRY AGAIN</button></div></main>;
  if (!account.profiles.paper.configured&&!account.profiles.live.configured) return <main><AccountSettings account={account} activeProfile="paper" setup onSaved={setAccount} onProfileChange={activateProfile} /></main>;

  return (
    <main className={pageKey === "strategies" ? "strategy-view" : undefined}>
      <header className="topbar">
        <a className="brand" href="/command-center" aria-label="Pulse command center"><span className="brand-mark">P</span><span>PULSE<span className="brand-dot">•</span>AI</span></a>
        <TopbarNav activeHref={activeNavHref[pageKey]} />
        <ThemeToggle />
        <div className="market-state"><div className="profile-switcher" role="group" aria-label="Active Alpaca account profile"><button type="button" aria-pressed={activeProfile==="paper"} onClick={() => account.profiles.paper.configured?activateProfile("paper"):(setSettingsProfile("paper"),setSettingsOpen(true))}>PAPER</button><button type="button" aria-pressed={activeProfile==="live"} onClick={() => account.profiles.live.configured?activateProfile("live"):(setSettingsProfile("live"),setSettingsOpen(true))}>LIVE{!account.profiles.live.configured&&<i>+</i>}</button></div><span className={`live-dot ${activeProfile==="live"?"real-money-dot":""}`} /> {data.marketOpen ? "MARKET OPEN" : "MARKET CLOSED"} <b className={activeProfile==="live"?"live-profile-badge":""}>{data.mode === "live" ? `ALPACA ${activeProfile.toUpperCase()}` : "DEMO MODE"}</b><button className="account-button" onClick={() => { setSettingsProfile(activeProfile);setSettingsOpen(true); }}>{account.user?.displayName ?? account.user?.email}</button></div>
      </header>

      {settingsOpen && <AccountSettings account={account} activeProfile={settingsProfile} onSaved={(next) => { setAccount(next);initialScanStarted.current = false; }} onProfileChange={activateProfile} onClose={() => setSettingsOpen(false)} />}

      {pageKey === "command" ? <><section className="hero" id="top">
        <div>
          <div className="eyebrow">AUTONOMOUS MARKET INTELLIGENCE</div>
          <h1>The market never stops talking.<br /><em>Pulse listens.</em></h1>
          <p>One focused agent reads price action, Alpaca positions, and the news cycle every minute, scores conviction, and routes qualified ideas to the selected {activeProfile === "live" ? "live" : "paper"} account profile.</p>
        </div>
        <div className="agent-control">
          <div>
            <span className={`orb ${running ? "orb-live" : ""}`}><i /></span>
            <div><small>AGENT LOOP</small><strong>{running ? "Scanning automatically" : "Agent paused"}</strong></div>
          </div>
          <div className="countdown"><small>NEXT SCAN</small><strong>{running ? `${mm}:${ss}` : "PAUSED"}</strong></div>
          <button className="pause-button" onClick={() => setRunning((value) => !value)}>{running ? "Pause" : "Resume"}</button>
          <button className="scan-button" onClick={runScan} disabled={scanning || trading}>{scanning ? "Scanning…" : "Scan now ↗"}</button>
          <button className={`trade-button ${activeProfile === "live" ? "live-trade-button" : ""}`} onClick={tradeNow} disabled={scanning || trading} aria-label={`Trade all strategies in the Alpaca ${activeProfile} account`}>
            <span>{trading ? `SUBMITTING ${activeProfile.toUpperCase()} ORDERS…` : activeProfile === "live" ? "TRADE LIVE ACCOUNT NOW" : "TRADE ALL STRATEGIES NOW"}</span><b>{trading ? "•••" : `${money.format(strategyData.totalAllocation)} ALLOCATED  →`}</b>
          </button>
        </div>
      </section></> : <section className="page-hero"><div className="eyebrow">{pageMeta[pageKey].eyebrow}</div><h1>{pageMeta[pageKey].title}</h1><p>{pageMeta[pageKey].description}</p></section>}

      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}

      {pageKey === "command" && <section className="stats" aria-label={`${activeProfile} account summary`}>
        <article><small>{activeProfile.toUpperCase()} EQUITY</small><strong>{money.format(data.account.equity)}</strong><span className="up">↗ {data.account.dayPnlPct.toFixed(2)}% today</span></article>
        <article><small>DAY P&amp;L</small><strong className={data.account.dayPnl >= 0 ? "profit" : "loss"}>{data.account.dayPnl >= 0 ? "+" : ""}{money.format(data.account.dayPnl)}</strong><span>Since market open</span></article>
        <article><small>BUYING POWER</small><strong>{money.format(data.account.buyingPower)}</strong><span>Alpaca {activeProfile} account</span></article>
        <article className="breadth-card"><small>MARKET SENTIMENT</small><strong>{data.breadth.bullish}% <i>BULLISH</i></strong><div className="breadth"><span style={{ width: `${data.breadth.bullish}%` }} /><span style={{ width: `${data.breadth.neutral}%` }} /><span style={{ width: `${data.breadth.bearish}%` }} /></div><div className="breadth-key"><i>Bull {data.breadth.bullish}</i><i>Neutral {data.breadth.neutral}</i><i>Bear {data.breadth.bearish}</i></div></article>
      </section>}

      {pageKey === "command" && <section className="strategy-shortcuts" aria-label="Strategy trading controls">
        <div className="shortcut-heading"><div><small>QUICK STRATEGY CONTROL</small><h2>Turn models on or off.</h2></div><p>Saved to your account. An off strategy keeps analyzing and recording performance, but submits no entry or exit orders.</p></div>
        <div className="shortcut-grid">
          {strategyData.strategies.map((strategy,index) => (
            <article className={strategy.paused?"strategy-off":""} key={`shortcut-${strategy.id}`}>
              <header><span>{String(index+1).padStart(2,"0")}</span><button type="button" role="switch" aria-checked={!strategy.paused} aria-label={`${strategy.paused?"Turn on":"Turn off"} ${strategy.name}`} onClick={() => toggleStrategyPause(strategy.id,!strategy.paused)} disabled={Boolean(strategyTrading)}><i /><b>{strategyTrading===strategy.id?"SAVING":strategy.paused?"OFF":"ON"}</b></button></header>
              <div><h3>{strategy.name}</h3><small>{strategy.short}</small></div>
              <MiniStrategyChart points={strategyPerformance[strategy.id]??[]} />
              <footer><span>{strategy.paused?"TRADING STOPPED":strategy.windowOpen?"WINDOW OPEN":"WAITING FOR WINDOW"}</span><a href="/strategy-lab">DETAILS ↗</a></footer>
            </article>
          ))}
        </div>
      </section>}

      {pageKey === "signals" && <section className="workspace" id="signals">
        <div className="signal-board" id="signals">
          <div className="section-title"><div><span>01</span><h2>Market signal overview</h2></div><p>Shared research layer for {strategyData.strategies.length} independent strategies</p></div>
          <div className="signal-table" role="table" aria-label="Agent signals">
            <div className="signal-row signal-head" role="row"><span>RANK / ASSET</span><span>PRICE / DAY</span><span>MOMENTUM</span><span>SENTIMENT</span><span>BUY SCORE</span><span>ROSTER</span></div>
            {data.signals.map((signal) => (
              <button className={`signal-row ${activeSymbol === signal.symbol ? "selected" : ""}`} role="row" key={signal.symbol} onClick={() => setActiveSymbol(signal.symbol)}>
                <span className="asset"><b>#{signal.rank ?? "—"} {signal.symbol}</b><small>{signal.name}</small></span>
                <span className="price"><b>${signal.price.toFixed(2)}</b><small className={signal.change >= 0 ? "up" : "down"}>{signal.change >= 0 ? "+" : ""}{signal.change.toFixed(2)}%</small></span>
                <Sparkline values={signal.spark} action={signal.action} />
                <span className={`sentiment sentiment-${signal.sentiment > 20 ? "pos" : signal.sentiment < -20 ? "neg" : "neu"}`}><b>{signal.sentiment > 0 ? "+" : ""}{signal.sentiment}</b><small>{signal.mentions} mentions</small></span>
                <span className="confidence"><b>{signal.confidence}%</b><i><em style={{ width: `${signal.confidence}%` }} /></i></span>
                <span className="action action-buy">TOP 10</span>
              </button>
            ))}
          </div>
        </div>

        <aside className="thesis-panel">
          <div className="section-title compact"><div><span>02</span><h2>Agent thesis</h2></div><b className={`action action-${selected.action.toLowerCase()}`}>{selected.action}</b></div>
          <div className="ticker-focus"><div><small>SELECTED ASSET</small><h3>{selected.symbol}</h3><p>{selected.name}</p></div><strong>{selected.confidence}<small>/100</small></strong></div>
          <div className="thesis-copy"><small>WHY NOW</small><p>{selected.reason}</p></div>
          <div className="factor-list">
            <div><span>News sentiment</span><b className={selected.sentiment >= 0 ? "up" : "down"}>{selected.sentiment > 0 ? "+" : ""}{selected.sentiment}</b></div>
            <div><span>Price confirmation</span><b className={selected.change >= 0 ? "up" : "down"}>{selected.change >= 0 ? "+" : ""}{selected.change.toFixed(2)}%</b></div>
            <div><span>Risk gate</span><b>PASS</b></div>
          </div>
          <section className="thesis-sentiment" aria-label={`Sentiment evidence for ${selected.symbol}`}>
            <header><small>HOW SENTIMENT WAS SCORED</small><p>Recent Alpaca headlines tagged to {selected.symbol} were checked for a fixed catalyst vocabulary. Each positive term adds 20 points, each negative term subtracts 20, and the headline scores are averaged. That tone is then combined with today’s price move for the final rank.</p></header>
            <div className="thesis-stories">
              {(selected.evidence ?? []).length ? (selected.evidence ?? []).map((story, index) => (
                <article key={`${story.source}-${story.headline}`}>
                  <div><span>STORY {index + 1} · {story.source}</span><b className={story.score >= 0 ? "up" : "down"}>{story.score > 0 ? "+" : ""}{story.score}</b></div>
                  <p>{story.headline}</p>
                  <footer>
                    {story.positiveTerms.map((term) => <em className="term-positive" key={`positive-${term}`}>+ {term}</em>)}
                    {story.negativeTerms.map((term) => <em className="term-negative" key={`negative-${term}`}>− {term}</em>)}
                    {!story.positiveTerms.length && !story.negativeTerms.length && <em className="term-neutral">No catalyst terms · neutral</em>}
                  </footer>
                </article>
              )) : <article className="no-story"><div><span>NEWS EVIDENCE</span><b>0 MATCHES</b></div><p>No recent Alpaca story was tagged to {selected.symbol}. Its news input is neutral, so today’s {selected.change >= 0 ? "positive" : "negative"} price move is the main reason it reached this rank.</p></article>}
            </div>
          </section>
          <div className="paper-ticket"><div><small>STRATEGY CAPITAL</small><b>{strategyData.strategies.length} models · {exactMoney.format(strategyData.totalAllocation/Math.max(1,strategyData.strategies.length))} each</b></div><strong>{money.format(strategyData.totalAllocation)} total</strong></div>
          <div className="alpaca-positions">
            <div className="positions-head"><small>ALPACA OPEN POSITIONS</small><span>Refreshes every minute</span></div>
            {(data.execution.positions ?? []).length ? (data.execution.positions ?? []).map((position) => (
              <div className="position-row" key={position.symbol}>
                <span><b>{position.symbol}</b><small>{shares.format(position.qty)} shares</small></span>
                <span><b>{money.format(position.marketValue)}</b><small>@ ${position.currentPrice.toFixed(2)}</small></span>
                <b className={position.unrealizedPnl >= 0 ? "up" : "down"}>{position.unrealizedPnl >= 0 ? "+" : ""}{money.format(position.unrealizedPnl)}</b>
              </div>
            )) : <p>No agent-tagged Alpaca position is currently open.</p>}
          </div>
          <p className="guardrail">◆ Each strategy owns a separately tagged {activeProfile} roster. Signals that fail a strategy’s entry rules remain in cash. Execution remains gated by this profile’s auto-trade setting.</p>
        </aside>
      </section>}

      {pageKey === "decisions" && <section className="explain-section" id="explainability">
        <div className="section-title explain-title">
          <div><span>03</span><h2>Decision intelligence</h2></div>
          <p>Plain-language audit of the latest {data.mode} scan</p>
        </div>

        <div className="explain-grid">
          <article className="explain-card outcome-card">
            <small>THE RESULT</small>
            <div className="explain-kicker"><strong>{data.signals.length}</strong><span>ranked<br />selections</span></div>
            <h3>{selected.symbol} is the current focus at {selected.confidence}/100.</h3>
            <p>{selected.reason}</p>
            <div className="result-strip"><b>{data.execution.managedPositions ?? 0}/10 managed</b><span>{analysis.executionResult}</span></div>
          </article>

          <article className="explain-card method-card">
            <small>ANALYSIS METHOD</small>
            <h3>Two signals become one ranked score.</h3>
            <ol className="method-steps">
              <li><b>01</b><span><strong>Read the news</strong>Score recent ticker headlines with positive and negative language.</span></li>
              <li><b>02</b><span><strong>Confirm price action</strong>Measure today’s move against the previous daily close.</span></li>
              <li><b>03</b><span><strong>Rank conviction</strong>Combine both inputs, clamp the result from 0–100, then sort highest first.</span></li>
            </ol>
            <code className="score-formula">50 + (sentiment × 0.28) + (daily change × 7)</code>
          </article>

          <article className="explain-card meaning-card">
            <small>WHAT THE SCORE MEANS</small>
            <h3>A conviction rank, not a prediction.</h3>
            <div className="score-key">
              <div><b className="score-high">60–100</b><span><strong>Bullish evidence</strong>News and price action are reinforcing each other.</span></div>
              <div><b className="score-mid">40–59</b><span><strong>Mixed evidence</strong>The inputs do not strongly agree.</span></div>
              <div><b className="score-low">0–39</b><span><strong>Cautious evidence</strong>Negative tone or weak price action dominates.</span></div>
            </div>
            <p>Only rank and portfolio rules determine inclusion. The score does not estimate a future return or probability of profit.</p>
          </article>

          <article className="explain-card sentiment-card">
            <small>SENTIMENT ANALYSIS</small>
            <div className="sentiment-read"><strong>{analysis.averageSentiment > 0 ? "+" : ""}{analysis.averageSentiment}</strong><span>average tone<br />across ranked names</span></div>
            <h3>{analysis.marketRead}: {data.breadth.bullish}% bullish vs. {data.breadth.bearish}% bearish.</h3>
            <div className="explain-breadth" aria-label={`${data.breadth.bullish}% bullish, ${data.breadth.neutral}% neutral, ${data.breadth.bearish}% bearish`}>
              <span style={{ width: `${data.breadth.bullish}%` }} /><span style={{ width: `${data.breadth.neutral}%` }} /><span style={{ width: `${data.breadth.bearish}%` }} />
            </div>
            <div className="sentiment-facts">
              <span><b>{analysis.headlineMix.positive}</b> positive headlines</span>
              <span><b>{analysis.headlineMix.neutral}</b> neutral</span>
              <span><b>{analysis.headlineMix.negative}</b> negative</span>
            </div>
            <p>{analysis.strongestSentiment ? `${analysis.strongestSentiment.symbol} has the strongest ranked news tone at ${analysis.strongestSentiment.sentiment > 0 ? "+" : ""}${analysis.strongestSentiment.sentiment}, based on ${analysis.strongestSentiment.mentions} matched headline${analysis.strongestSentiment.mentions === 1 ? "" : "s"}.` : "No ranked sentiment result is available for this scan."}</p>
          </article>
        </div>

        <div className="decision-trace">
          <div className="trace-heading"><div><small>DECISION TRACE</small><h3>How every ranked name earned its place</h3></div><p>Higher scores rise in rank; the top 10 become the target {activeProfile} roster.</p></div>
          <div className="trace-table" role="table" aria-label="Decision reasoning for ranked signals">
            <div className="trace-row trace-head" role="row"><span>RANK / ASSET</span><span>NEWS TONE</span><span>PRICE INPUT</span><span>COMBINED SCORE</span><span>INTERPRETATION</span></div>
            {data.signals.map((signal) => (
              <div className="trace-row" role="row" key={`trace-${signal.symbol}`}>
                <span><b>#{signal.rank ?? "—"} {signal.symbol}</b><small>{signal.name}</small></span>
                <span><b className={signal.sentiment >= 0 ? "up" : "down"}>{signal.sentiment > 0 ? "+" : ""}{signal.sentiment}</b><small>{signal.mentions} headline match{signal.mentions === 1 ? "" : "es"}</small></span>
                <span><b className={signal.change >= 0 ? "up" : "down"}>{signal.change >= 0 ? "+" : ""}{signal.change.toFixed(2)}%</b><small>vs. prior close</small></span>
                <span className="trace-score"><b>{signal.confidence}/100</b><i><em style={{ width: `${signal.confidence}%` }} /></i></span>
                <span><p>{signal.reason}</p></span>
              </div>
            ))}
          </div>
        </div>
      </section>}

      {pageKey === "strategies" && <section className="strategy-lab strategy-browser" id="strategy-lab">
        <div className="strategy-browser-head"><div><small>CHART SUMMARY</small><strong>{String(activeStrategyIndex+1).padStart(2,"0")} / {String(strategyData.strategies.length).padStart(2,"0")}</strong></div><p>Use the tabs or arrow keys to move through every strategy without leaving this view.</p></div>
        <div className="strategy-tabs" role="tablist" aria-label="Trading strategies" onKeyDown={(event) => { if(event.key==="ArrowRight"){event.preventDefault();moveStrategy(1);}if(event.key==="ArrowLeft"){event.preventDefault();moveStrategy(-1);} }}>
          {strategyData.strategies.map((strategy,index) => (
            <button key={strategy.id} role="tab" id={`strategy-tab-${strategy.id}`} aria-controls="strategy-chart-panel" tabIndex={activeStrategy === strategy.id ? 0 : -1} aria-selected={activeStrategy === strategy.id} className={`${activeStrategy === strategy.id ? "active" : ""} ${strategy.paused ? "paused" : ""}`} onClick={() => setActiveStrategy(strategy.id)}><i>{String(index+1).padStart(2,"0")}</i>{strategy.name}{strategy.paused&&<b>PAUSED</b>}</button>
          ))}
        </div>
        <article className="strategy-page strategy-chart-card" role="tabpanel" id="strategy-chart-panel" aria-labelledby={`strategy-tab-${selectedStrategy.id}`}>
          <div className="strategy-chart-summary">
            <div className="strategy-chart-copy"><small>{selectedStrategy.horizon} · {selectedStrategy.paused?"PAUSED":selectedStrategy.windowOpen?"WINDOW OPEN":"WAITING FOR WINDOW"}</small><h2>{selectedStrategy.name}</h2><h3>{selectedStrategy.short}</h3><p>{selectedStrategy.description}</p><p className="strategy-summary">{selectedEducation.summary}</p><div className="strategy-cadence"><small>HOW OFTEN IT TRADES</small><strong>{selectedCadence.frequency}</strong><p>{selectedCadence.why}</p></div></div>
            <div className="strategy-chart-metrics"><div><small>ALLOCATION</small><strong>{exactMoney.format(selectedStrategy.allocation)}</strong></div><div><small>DEPLOYED</small><strong>{exactMoney.format(selectedStrategy.deployed)}</strong></div><div><small>CASH</small><strong>{exactMoney.format(selectedStrategy.cash)}</strong></div></div>
          </div>
          <PerformanceChart points={performance} loading={performanceLoading} />
          <footer className="strategy-chart-nav"><button type="button" onClick={() => moveStrategy(-1)} aria-label="Previous strategy">← PREVIOUS</button><span>{selectedStrategy.dataMode === "live" ? "LIVE ALPACA DATA" : "DEMO DATA"} · 15-MINUTE SNAPSHOTS · UP TO 1 YEAR</span><button type="button" onClick={() => moveStrategy(1)} aria-label="Next strategy">NEXT →</button></footer>
        </article>
      </section>}

      {pageKey === "positions" && <section className="positions-section" id="positions">
        <div className="section-title positions-title"><div><span>05</span><h2>Alpaca positions</h2></div><p>Actual holdings reconciled to agent order tags · refreshes every minute</p></div>
        <div className="position-summary">
          <article><small>TOTAL INVESTED</small><strong>{exactMoney.format(positionsData.summary.totalMarketValue)}</strong><span>{positionsData.summary.positionCount} Alpaca position{positionsData.summary.positionCount === 1 ? "" : "s"}</span></article>
          <article><small>TOTAL COST BASIS</small><strong>{exactMoney.format(positionsData.summary.totalCostBasis)}</strong><span>Across all strategies and manual holdings</span></article>
          <article><small>UNREALIZED P&amp;L</small><strong className={positionsData.summary.totalUnrealizedPnl >= 0 ? "up" : "down"}>{positionsData.summary.totalUnrealizedPnl >= 0 ? "+" : ""}{exactMoney.format(positionsData.summary.totalUnrealizedPnl)}</strong><span>Open-position profit and loss</span></article>
          <article><small>ACCOUNT EQUITY</small><strong>{exactMoney.format(positionsData.summary.equity)}</strong><span>{exactMoney.format(positionsData.summary.cash)} cash</span></article>
        </div>
        <div className="strategy-position-grid">
          {positionsData.categories.map((category) => (
            <article className="position-category" key={category.id}>
              <header>
                <div><small>{category.id === "unassigned" ? "ALPACA ACCOUNT" : "STRATEGY"}</small><h3>{category.name}</h3></div>
                <div><strong>{exactMoney.format(category.marketValue)}</strong><small>{category.positionCount} position{category.positionCount === 1 ? "" : "s"}</small></div>
              </header>
              {category.allocation > 0 && <div className="category-allocation"><i><em style={{ width:`${Math.min(100,category.marketValue/category.allocation*100)}%` }} /></i><span>{exactMoney.format(category.marketValue)} of {exactMoney.format(category.allocation)}</span></div>}
              <div className="category-performance">
                <div><small>TOTAL PROFIT / LOSS</small><strong className={category.totalPnl >= 0 ? "up" : "down"}>{category.totalPnl >= 0 ? "+" : ""}{exactMoney.format(category.totalPnl)}</strong></div>
                <div><small>RETURN</small><strong className={category.returnPct >= 0 ? "up" : "down"}>{category.returnPct >= 0 ? "+" : ""}{category.returnPct.toFixed(2)}%</strong></div>
                <div><small>REALIZED</small><strong className={category.realizedPnl >= 0 ? "up" : "down"}>{category.realizedPnl >= 0 ? "+" : ""}{exactMoney.format(category.realizedPnl)}</strong></div>
                <div><small>TODAY</small><strong className={category.dayPnl >= 0 ? "up" : "down"}>{category.dayPnl >= 0 ? "+" : ""}{exactMoney.format(category.dayPnl)}</strong></div>
              </div>
              <div className="category-table">
                <div className="category-row category-head"><span>ASSET</span><span>QTY</span><span>VALUE</span><span>P&amp;L</span></div>
                {category.positions.length ? category.positions.map((position) => (
                  <div className="category-row" key={`${category.id}-${position.symbol}`}>
                    <span><b>{position.symbol}</b><small>@ {exactMoney.format(position.currentPrice)}</small></span>
                    <span><b>{shares.format(position.qty)}</b><small>shares</small></span>
                    <span><b>{exactMoney.format(position.marketValue)}</b><small>{position.dayChangePct >= 0 ? "+" : ""}{position.dayChangePct.toFixed(2)}% today</small></span>
                    <span><b className={position.unrealizedPnl >= 0 ? "up" : "down"}>{position.unrealizedPnl >= 0 ? "+" : ""}{exactMoney.format(position.unrealizedPnl)}</b><small>{position.unrealizedPnlPct >= 0 ? "+" : ""}{position.unrealizedPnlPct.toFixed(2)}%</small></span>
                  </div>
                )) : <p className="category-empty">No open Alpaca position is attributed to this strategy.</p>}
              </div>
              <footer><span>COST BASIS</span><strong>{exactMoney.format(category.costBasis)}</strong></footer>
            </article>
          ))}
        </div>
        <p className="positions-note">Positions are categorized using filled Alpaca orders with Pulse strategy IDs. Strategy totals combine realized results from tagged fills with current open-position P&amp;L; 15-minute snapshots feed each strategy’s historical chart. Any remaining quantity appears under “Unassigned / manual.”</p>
      </section>}

      {pageKey === "transactions" && <section className="transactions-section" id="transactions">
        <div className="section-title transactions-title"><div><span>06</span><h2>Transaction history</h2><b className="history-tag">TRADE LOG</b></div><p>Filled Alpaca orders matched to their originating strategy</p></div>
        <div className="transaction-filters" aria-label="Transaction filters">
          <label><span>FROM DATE / TIME</span><input type="datetime-local" value={transactionFrom} onChange={(event) => setTransactionFrom(event.target.value)} /></label>
          <label><span>TO DATE / TIME</span><input type="datetime-local" value={transactionTo} onChange={(event) => setTransactionTo(event.target.value)} /></label>
          <label><span>STOCK</span><select value={transactionStock} onChange={(event) => setTransactionStock(event.target.value)}><option value="all">All stocks</option>{transactionStocks.map((symbol) => <option value={symbol} key={symbol}>{symbol}</option>)}</select></label>
          <label><span>STRATEGY</span><select value={transactionStrategy} onChange={(event) => setTransactionStrategy(event.target.value)}><option value="all">All strategies</option>{transactionStrategies.map(([code,name]) => <option value={code} key={code}>{name}</option>)}</select></label>
          <button type="button" onClick={() => { setTransactionFrom("");setTransactionTo("");setTransactionStock("all");setTransactionStrategy("all"); }} disabled={!transactionFrom&&!transactionTo&&transactionStock==="all"&&transactionStrategy==="all"}>CLEAR FILTERS</button>
          <p><strong>{filteredTransactions.length}</strong> of {transactionsData.transactions.length} filled orders</p>
        </div>
        <div className="transaction-table" role="table" aria-label="Alpaca transaction history">
          <div className="transaction-row transaction-head" role="row"><span>DATE / TIME</span><span>TRADE</span><span>STRATEGY</span><span>QUANTITY</span><span>FILL PRICE</span><span>VALUE</span></div>
          {filteredTransactions.length ? filteredTransactions.map((transaction) => (
            <div className="transaction-row" role="row" key={transaction.id}>
              <span><b>{new Date(transaction.filledAt).toLocaleDateString([], { month:"short",day:"numeric" })}</b><small>{new Date(transaction.filledAt).toLocaleTimeString([], { hour:"numeric",minute:"2-digit" })}</small></span>
              <span className="transaction-asset"><b>{transaction.symbol}</b><small className={`side-tag side-${transaction.side}`}>{transaction.side.toUpperCase()}</small></span>
              <span><b className="strategy-tag">{transaction.strategyName}</b><small>{transaction.strategyCode.toUpperCase()} · {transaction.status.replaceAll("_"," ")}</small></span>
              <span><b>{shares.format(transaction.qty)}</b><small>{transaction.symbol.match(/^[A-Z]{1,6}\d{6}[CP]\d{8}$/) ? "contracts" : "shares"}</small></span>
              <span><b>{exactMoney.format(transaction.price)}</b><small>average fill</small></span>
              <span><b>{exactMoney.format(transaction.total)}</b><small>notional</small></span>
            </div>
          )) : <div className="transaction-empty"><strong>No matching trades.</strong><p>{transactionsData.transactions.length ? "Adjust or clear the filters to see more transaction history." : `Completed Alpaca ${activeProfile} orders will appear here with their strategy tag.`}</p></div>}
        </div>
        <p className="positions-note">Showing {filteredTransactions.length} matching filled order{filteredTransactions.length === 1 ? "" : "s"} from the isolated {activeProfile} profile. Manual orders remain visible as “Unassigned / manual.” {transactionsData.mode === "demo" && `Demo trades are shown until the ${activeProfile} profile is connected.`}</p>
      </section>}

      {pageKey === "news" && <section className="news-section" id="news">
        <div className="section-title"><div><span>07</span><h2>News radar</h2></div><p>Headlines scored for ticker relevance and financial tone</p></div>
        <div className="news-grid">
          {data.news.map((item, index) => (
            <article key={`${item.headline}-${index}`}>
              <div><span className={`news-score news-${item.sentiment}`}>{item.sentiment === "positive" ? "+" : item.sentiment === "negative" ? "−" : "○"}</span><small>{item.source} · {item.age}</small></div>
              <h3>{item.headline}</h3>
              <footer>{item.symbols.map((symbol) => <b key={symbol}>${symbol}</b>)}<span>{item.sentiment} signal</span></footer>
            </article>
          ))}
        </div>
      </section>}

      <footer className="footer"><span>PULSE•AI / {activeProfile.toUpperCase()} PROFILE</span><p>{activeProfile === "live" ? "Live orders use real money. Review credentials, permissions, and strategy controls carefully." : "Analysis is informational. Paper trades carry no real-money execution."}</p><span>LAST SCAN {new Date(data.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></footer>
    </main>
  );
}
