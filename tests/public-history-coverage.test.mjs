import assert from "node:assert/strict";
import test from "node:test";
import { fetchPublicDailyHistory } from "../lib/historical-data.mjs";

test("public daily coverage follows actual bars instead of a future request end",async()=>{
  const originalFetch=globalThis.fetch;
  const days=["2026-10-26","2026-10-27"];
  globalThis.fetch=async()=>Response.json({chart:{result:[{
    timestamp:days.map((day)=>Date.parse(`${day}T13:30:00.000Z`)/1000),
    indicators:{quote:[{open:[10,11],high:[12,13],low:[9,10],close:[11,12],volume:[100,200]}],adjclose:[{adjclose:[11,12]}]},
  }]}});
  try{
    const history=await fetchPublicDailyHistory({symbol:"SPY",timeframe:"1Day",start:"2026-10-25",end:"2026-10-29"});
    assert.equal(history.coverageStart,"2026-10-26T00:00:00.000Z");
    assert.equal(history.coverageEnd,"2026-10-28T00:00:00.000Z");
    assert.equal(history.bars.length,2);
  }finally{globalThis.fetch=originalFetch;}
});
