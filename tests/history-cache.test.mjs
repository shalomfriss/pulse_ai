import assert from "node:assert/strict";
import test from "node:test";
import { compileHistoryRecord,historyKey,selectHistoryRange } from "../lib/history-cache.mjs";
import { HISTORY_MAX_BARS,HISTORY_MAX_YEARS,normalizeHistoryRequest } from "../lib/historical-data.mjs";

const bar=(timestamp,close)=>({timestamp,open:close,high:close+1,low:close-1,close,volume:1_000_000});

test("ten-year history requests are normalized and longer requests are rejected",()=>{
  const request=normalizeHistoryRequest({symbol:"spy",timeframe:"15Min",start:"2016-09-10",end:"2026-09-10"});
  assert.equal(request.symbol,"SPY");
  assert.equal(request.timeframe,"15Min");
  assert.equal(HISTORY_MAX_YEARS,10.1);
  assert.equal(HISTORY_MAX_BARS,300_000);
  assert.throws(()=>normalizeHistoryRequest({symbol:"SPY",timeframe:"15Min",start:"2010-01-01",end:"2026-01-01"}),/limited to ten years/i);
});

test("compiled local history merges, deduplicates, and serves covered ranges offline",()=>{
  const first=compileHistoryRecord({symbol:"spy",timeframe:"1Day",coverageStart:"2016-01-01",coverageEnd:"2021-01-01",bars:[bar("2016-01-04T00:00:00.000Z",100),bar("2020-12-31T00:00:00.000Z",150)]});
  const merged=compileHistoryRecord({symbol:"SPY",timeframe:"1Day",coverageStart:"2020-12-01",coverageEnd:"2026-01-01",bars:[bar("2020-12-31T00:00:00.000Z",151),bar("2025-12-31T00:00:00.000Z",200)]},first);
  assert.equal(merged.key,historyKey("SPY","1Day"));
  assert.equal(merged.bars.length,3);
  assert.equal(merged.report.duplicatesRemoved,1);
  assert.equal(selectHistoryRange(merged,"2016-01-01","2026-01-01")?.length,3);
  assert.equal(selectHistoryRange(merged,"2015-01-01","2026-01-01"),null);
});

test("one shared browser worker exposes both backtesting engines",async()=>{
  const{readFile}=await import("node:fs/promises"),root=new URL("../",import.meta.url);
  const[worker,runner,readme]=await Promise.all([readFile(new URL("app/backtesting/backtest-worker.ts",root),"utf8"),readFile(new URL("app/backtesting/local-backtest-runner.ts",root),"utf8"),readFile(new URL("README.md",root),"utf8")]);
  assert.match(worker,/runBacktest/);
  assert.match(worker,/runDayTradingBacktest/);
  assert.match(worker,/optimizeDayTrading/);
  assert.match(runner,/new Worker\(new URL/);
  assert.match(readme,/Compile market history for offline backtests/);
});
