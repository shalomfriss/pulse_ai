import assert from "node:assert/strict";
import test from "node:test";
import { compileHistoryRecord,historyKey,selectHistoryRange } from "../lib/history-cache.mjs";
import { HISTORY_MAX_BARS,HISTORY_MAX_YEARS,fetchPublicDailyHistory,normalizeHistoryRequest } from "../lib/historical-data.mjs";

const bar=(timestamp,close)=>({timestamp,open:close,high:close+1,low:close-1,close,volume:1_000_000});

test("twenty-year history requests are normalized and longer requests are rejected",()=>{
  const request=normalizeHistoryRequest({symbol:"spy",timeframe:"1Day",start:"2006-09-10",end:"2026-09-10"});
  assert.equal(request.symbol,"SPY");
  assert.equal(request.timeframe,"1Day");
  assert.equal(request.end.toISOString(),"2026-09-10T23:59:59.999Z");
  assert.equal(HISTORY_MAX_YEARS,20.1);
  assert.equal(HISTORY_MAX_BARS,300_000);
  assert.throws(()=>normalizeHistoryRequest({symbol:"SPY",timeframe:"1Day",start:"2005-01-01",end:"2026-01-01"}),/limited to twenty years/i);
});

test("date-only range includes daily bars timestamped during the final day",()=>{
  const record=compileHistoryRecord({symbol:"SPY",timeframe:"1Day",coverageStart:"2024-01-02",coverageEnd:"2024-01-03",bars:[
    bar("2024-01-02T14:30:00.000Z",100),bar("2024-01-03T14:30:00.000Z",101),
  ]});
  assert.equal(selectHistoryRange(record,"2024-01-02","2024-01-03")?.length,2);
});

test("local history cache retains a newly listed symbol's first trading day",()=>{
  const record=compileHistoryRecord({symbol:"NEW",timeframe:"1Day",coverageStart:"2026-10-27",coverageEnd:"2026-10-28",bars:[bar("2026-10-27T14:30:00.000Z",10)]});
  assert.equal(record.report.validRows,1);
  assert.equal(selectHistoryRange(record,"2026-10-27","2026-10-27")?.length,1);
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

test("public daily history requires adjusted closes before compiling an adjusted archive",async()=>{
  const originalFetch=globalThis.fetch;
  const payload=(adjclose)=>({chart:{result:[{timestamp:[1704205800,1704292200],indicators:{quote:[{open:[100,101],high:[102,103],low:[99,100],close:[101,102],volume:[1000,1100]}],adjclose:[{adjclose}]}}]}});
  try{
    globalThis.fetch=async()=>Response.json(payload([50.5,51]));
    const data=await fetchPublicDailyHistory({symbol:"SPY",timeframe:"1Day",start:"2024-01-01",end:"2024-01-05"});
    assert.equal(data.bars[0].open,50);
    assert.equal(data.bars[0].rawClose,101);
    assert.equal(data.bars[1].close,51);
    globalThis.fetch=async()=>Response.json(payload([50.5,null]));
    await assert.rejects(fetchPublicDailyHistory({symbol:"SPY",timeframe:"1Day",start:"2024-01-01",end:"2024-01-05"}),/did not supply an adjusted close/);
  }finally{globalThis.fetch=originalFetch;}
});

test("public history uses Yahoo's warrant ticker and retains its source identity",async()=>{
  const originalFetch=globalThis.fetch;
  let requested="";
  try{
    globalThis.fetch=async(url)=>{
      requested=String(url);
      return Response.json({chart:{result:[{timestamp:[1793107800],indicators:{quote:[{open:[1],high:[2],low:[0.5],close:[1.5],volume:[100]}],adjclose:[{adjclose:[1.5]}]}}]}});
    };
    const data=await fetchPublicDailyHistory({symbol:"BBAI.W",timeframe:"1Day",start:"2026-10-26",end:"2026-10-28"});
    assert.match(requested,/\/BBAI-WT\?/);
    assert.equal(data.symbol,"BBAI.W");
    assert.equal(data.providerSymbol,"BBAI-WT");
    assert.equal(data.bars.length,1);
  }finally{globalThis.fetch=originalFetch;}
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
