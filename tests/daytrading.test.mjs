import assert from "node:assert/strict";
import test from "node:test";
import { DAY_TRADING_ELEMENTS, optimizeDayTrading, runDayTradingBacktest } from "../lib/daytrading.mjs";

function intradayBars(days=120){
  const bars=[];
  for(let day=0;day<days;day+=1){
    const date=new Date(Date.UTC(2024,0,2+day));
    const base=100+day*.08;
    for(let slot=0;slot<8;slot+=1){
      const open=base+slot*.12,close=open+(slot>=2?.18:-.03);
      bars.push({timestamp:new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),14,30+slot*15)).toISOString(),open,high:Math.max(open,close)+.06,low:Math.min(open,close)-.06,close,volume:1_000_000+slot*120_000+day*1_000});
    }
  }
  return bars;
}

test("day-trading engine uses next-bar entries and closes every position by session end",()=>{
  const result=runDayTradingBacktest({bars:intradayBars(12),initialCapital:25_000,commission:0,slippageBps:0,configuration:{elements:["orb"],combine:"all",openingRangeBars:2,stopLossPct:2,takeProfitPct:5,trailingStopPct:0,maxHoldBars:20,exitOnSignalLoss:false}});
  assert.ok(result.trades.length>0);
  assert.ok(result.trades.every((trade)=>trade.entryTime.slice(0,10)===trade.exitTime.slice(0,10)));
  assert.ok(result.trades.every((trade)=>trade.reason==="session close"));
  assert.equal(result.metrics.tradingDays,12);
  assert.ok(result.metrics.averageDailyReturnPct>0);
});

test("composable confirmations and realistic costs are reflected in results",()=>{
  const base={bars:intradayBars(40),initialCapital:25_000,configuration:{elements:["orb","vwap","ema"],combine:"all",openingRangeBars:2,emaFast:5,emaSlow:12,stopLossPct:1,takeProfitPct:2,trailingStopPct:.6,maxHoldBars:8}};
  const free=runDayTradingBacktest({...base,commission:0,slippageBps:0});
  const costly=runDayTradingBacktest({...base,commission:1,slippageBps:8});
  assert.ok(free.metrics.tradeCount>0);
  assert.ok(costly.metrics.finalEquity<free.metrics.finalEquity);
  assert.ok(costly.metrics.totalCosts>0);
  assert.ok(Object.values(costly.metrics).every(Number.isFinite));
});

test("optimizer preserves a chronological holdout and audits the 10% daily target",()=>{
  const result=optimizeDayTrading({bars:intradayBars(120),initialCapital:25_000,commission:0,slippageBps:2});
  assert.equal(result.searchedCandidates,129);
  assert.ok(result.leaderboard.length>0);
  assert.equal(result.split.trainingDays,84);
  assert.equal(result.split.validationDays,36);
  assert.equal(result.target.dailyReturnPct,10);
  assert.equal(typeof result.target.met,"boolean");
  assert.match(result.target.compoundingContext,/\$269\.7 trillion/i);
});

test("catalog covers every major single-symbol OHLCV family and every strategy executes",()=>{
  assert.equal(DAY_TRADING_ELEMENTS.length,24);
  assert.equal(new Set(DAY_TRADING_ELEMENTS.map((item)=>item.id)).size,24);
  assert.deepEqual(new Set(DAY_TRADING_ELEMENTS.map((item)=>item.family)),new Set(["Breakout","Trend","Mean reversion","Volume","Momentum","Volatility","Prior session","Gap"]));
  for(const strategy of DAY_TRADING_ELEMENTS){
    const result=runDayTradingBacktest({bars:intradayBars(40),initialCapital:25_000,commission:.25,slippageBps:2,configuration:{elements:[strategy.id]}});
    assert.deepEqual(result.configuration.elements,[strategy.id]);
    assert.ok(Object.values(result.metrics).every(Number.isFinite),`${strategy.id} produced non-finite metrics`);
  }
});

test("day-trading tab, authenticated API, and research limits are wired into the app",async()=>{
  const{readFile}=await import("node:fs/promises"),root=new URL("../",import.meta.url);
  const[navigation,page,client,route,historyLibrary]=await Promise.all([
    readFile(new URL("app/topbar-nav.tsx",root),"utf8"),readFile(new URL("app/daytrading/page.tsx",root),"utf8"),readFile(new URL("app/daytrading/daytrading-client.tsx",root),"utf8"),readFile(new URL("app/api/daytrading/route.ts",root),"utf8"),readFile(new URL("app/backtesting/local-history.ts",root),"utf8"),
  ]);
  assert.match(navigation,/\["\/daytrading", "Day Trading"\]/);
  assert.match(page,/DayTradingClient/);
  assert.match(client,/FIND BEST VALIDATED COMBINATION/);
  assert.match(client,/complete bar-based strategy field guide/i);
  assert.match(client,/Strategies that need a different engine/);
  assert.match(route,/getChatGPTUser/);
  assert.match(route,/MAX_INTRADAY_BARS/);
  assert.match(route,/fetchAlpacaHistory/);
  assert.match(client,/SHARED LOCAL HISTORY/);
  assert.match(historyLibrary,/resolveHistoricalDataset/);
  assert.match(client,/runLocalBacktest/);
  assert.doesNotMatch(client,/fetch\("\/api\/daytrading"/);
});
