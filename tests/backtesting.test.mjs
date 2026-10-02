import assert from "node:assert/strict";
import test from "node:test";
import { compileBars, MAX_BARS, runBacktest } from "../lib/backtesting.mjs";

const risingBars = Array.from({ length: 80 }, (_, index) => ({
  timestamp: new Date(Date.UTC(2024, 0, index + 1)).toISOString(),
  open: 100 + index,
  high: 101 + index,
  low: 99 + index,
  close: 100 + index,
  volume: 1_000_000 + index,
}));

test("compileBars sorts, validates, and removes duplicate timestamps", () => {
  const compiled = compileBars([
    risingBars[1],
    { ...risingBars[0], timestamp: "not-a-date" },
    { ...risingBars[0], open: risingBars[0].high + 10 },
    risingBars[0],
    risingBars[1],
  ]);
  assert.equal(compiled.bars.length, 2);
  assert.equal(compiled.bars[0].timestamp, risingBars[0].timestamp);
  assert.equal(compiled.report.duplicatesRemoved, 1);
  assert.equal(compiled.report.invalidRemoved, 2);
});

test("compileBars rejects datasets above the resource limit", () => {
  assert.equal(MAX_BARS,300_000);
  assert.throws(() => compileBars(Array.from({ length: 81 }, (_, index) => ({
    ...risingBars[0],
    timestamp: new Date(Date.UTC(2020, 0, 1, 0, index)).toISOString(),
  })),80), /80-bar limit/i);
});

test("buy-and-hold backtest uses next-bar fills and returns complete analytics", () => {
  const result = runBacktest({
    bars: risingBars,
    strategy: "buy-hold",
    initialCapital: 10_000,
    commission: 1,
    slippageBps: 5,
    parameters: {},
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryTime, risingBars[1].timestamp);
  assert.equal(result.equityCurve.length, risingBars.length);
  assert.deepEqual(result.equityCurve.map((point) => point.equity), result.equityCurve.map((point) => point.benchmark));
  assert.ok(result.metrics.totalReturnPct > 0);
  assert.ok(Number.isFinite(result.metrics.maxDrawdownPct));
  assert.equal(result.data.start, risingBars[0].timestamp);
});

test("backtest rejects costs that can create impossible fills", () => {
  assert.throws(() => runBacktest({ bars:risingBars,strategy:"buy-hold",initialCapital:100,commission:100,slippageBps:0,parameters:{} }), /commission/i);
  assert.throws(() => runBacktest({ bars:risingBars,strategy:"buy-hold",initialCapital:100,commission:0,slippageBps:10_000,parameters:{} }), /slippage/i);
});

test("catastrophic losses still produce finite metrics", () => {
  const bars=[
    { timestamp:"2024-01-01T00:00:00.000Z",open:100,high:101,low:99,close:100,volume:1_000 },
    { timestamp:"2024-01-02T00:00:00.000Z",open:100,high:101,low:99,close:100,volume:1_000 },
    { timestamp:"2024-01-03T00:00:00.000Z",open:.01,high:.02,low:.005,close:.01,volume:1_000 },
  ];
  const result=runBacktest({ bars,strategy:"buy-hold",initialCapital:100,commission:9,slippageBps:1_000,parameters:{},timeframe:"1Day" });
  assert.ok(Object.values(result.metrics).every(Number.isFinite));
  assert.ok(Math.abs(result.metrics.initialCapital+result.trades.reduce((sum,trade)=>sum+trade.pnl,0)-result.metrics.finalEquity)<.01);
});

test("unsafe numeric magnitudes are rejected before arithmetic can overflow", () => {
  const bars=risingBars.map((bar)=>({ ...bar,open:1e308,high:1e308,low:1e308,close:1e308 }));
  assert.throws(() => runBacktest({ bars,strategy:"buy-hold",initialCapital:10_000,commission:0,slippageBps:5,parameters:{} }), /safe numeric range/i);
});

test("trade returns include commissions and intraday metrics use intraday annualization", () => {
  const base={ bars:risingBars,strategy:"buy-hold",initialCapital:10_000,commission:5,slippageBps:5,parameters:{} };
  const daily=runBacktest({ ...base,timeframe:"1Day" });
  const intraday=runBacktest({ ...base,timeframe:"5Min" });
  const trade=daily.trades[0];
  const invested=trade.entryPrice*trade.quantity+5;
  assert.ok(Math.abs(trade.returnPct-trade.pnl/invested*100)<0.01);
  assert.ok(intraday.metrics.volatilityPct>daily.metrics.volatilityPct*5);
  assert.ok(Object.values(daily.metrics).every(Number.isFinite));
});

test("SMA crossover rejects impossible parameter combinations", () => {
  assert.throws(() => runBacktest({
    bars: risingBars,
    strategy: "sma-crossover",
    initialCapital: 10_000,
    commission: 0,
    slippageBps: 0,
    parameters: { fastPeriod: 30, slowPeriod: 10 },
  }), /fast period must be less than slow period/i);
});

test("backtest source exposes the website tab and authenticated API", async () => {
  const { readFile } = await import("node:fs/promises");
  const root = new URL("../", import.meta.url);
  const [navigation, page, client, route,historyRoute,historyLibrary] = await Promise.all([
    readFile(new URL("app/topbar-nav.tsx", root), "utf8"),
    readFile(new URL("app/backtesting/page.tsx", root), "utf8"),
    readFile(new URL("app/backtesting/backtesting-client.tsx", root), "utf8"),
    readFile(new URL("app/api/backtesting/route.ts", root), "utf8"),
    readFile(new URL("app/api/history/route.ts", root), "utf8"),
    readFile(new URL("app/backtesting/local-history.ts", root), "utf8"),
  ]);
  assert.match(navigation, /\["\/backtesting", "Backtesting"\]/);
  assert.match(page, /BacktestingClient/);
  assert.match(route, /getChatGPTUser/);
  assert.match(route, /fetchAlpacaHistory/);
  assert.match(route, /MAX_REQUEST_BYTES/);
  assert.doesNotMatch(route, /compileBars\(/);
  assert.match(historyRoute,/fetchAlpacaHistory/);
  assert.match(historyLibrary,/indexedDB\.open/);
  assert.match(client,/COMPILE 10 YEARS LOCALLY/);
  assert.match(client,/runLocalBacktest/);
  assert.doesNotMatch(client,/fetch\("\/api\/backtesting"/);
  assert.doesNotMatch(client, /Math\.(?:min|max)\(\.\.\.values\)/);
});
