import assert from "node:assert/strict";
import test from "node:test";
import { fetchConfiguredHistory } from "../lib/configured-history.mjs";

test("configured archive returns only the requested covered range", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return Response.json({
      symbol:"SPY",timeframe:"1Day",adjusted:true,coverageStart:"2006-01-01",coverageEnd:"2026-12-31",
      bars:["2010-01-02","2011-01-02","2012-01-02"].map((timestamp) => ({timestamp,open:1,high:2,low:1,close:2,volume:100})),
    });
  };
  try {
    const result = await fetchConfiguredHistory({symbol:"spy",timeframe:"1Day",start:"2010-01-01",end:"2011-12-31"},"https://archive.example/data");
    assert.equal(requestedUrl,"https://archive.example/data/v1/history/SPY/1Day.json");
    assert.equal(result.provider,"configured-source");
    assert.match(result.sourceKey,/^[a-f0-9]{24}$/);
    assert.equal(result.bars.length,2);
    const partial=await fetchConfiguredHistory({symbol:"spy",timeframe:"1Day",start:"2005-01-01",end:"2011-12-31"},"https://archive.example/data");
    assert.equal(partial.bars.length,2);
    assert.match(partial.warning,/outside that range/);
  } finally { globalThis.fetch = originalFetch; }
});

test("configured daily archive includes the requested end date",async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({symbol:"SPY",timeframe:"1Day",adjusted:true,coverageStart:"2024-01-02",coverageEnd:"2024-01-03",bars:[
    {timestamp:"2024-01-02T14:30:00.000Z",open:100,high:101,low:99,close:100,volume:1000},
    {timestamp:"2024-01-03T14:30:00.000Z",open:101,high:102,low:100,close:101,volume:1000},
  ]});
  try{
    const result=await fetchConfiguredHistory({symbol:"SPY",timeframe:"1Day",start:"2024-01-02",end:"2024-01-03"},"https://archive.example/");
    assert.equal(result.bars.length,2);
    assert.match(result.warning,/security identity/);
  }finally{globalThis.fetch=originalFetch;}
});

test("configured history serves a newly listed symbol's only daily bar",async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({symbol:"YSKH",timeframe:"1Day",adjusted:true,coverageStart:"2026-10-27T00:00:00.000Z",coverageEnd:"2026-10-28T00:00:00.000Z",bars:[
    {timestamp:"2026-10-27T13:30:00.000Z",open:50.85,high:50.88,low:50.34,close:50.88,volume:2800},
  ]});
  try{
    const result=await fetchConfiguredHistory({symbol:"YSKH",timeframe:"1Day",start:"2026-10-27",end:"2026-10-27"},"https://archive.example/");
    assert.equal(result.bars.length,1);
    assert.equal(result.coverageEnd,"2026-10-28T00:00:00.000Z");
  }finally{globalThis.fetch=originalFetch;}
});

test("configured daily history does not trust coverage extending beyond its last bar",async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({symbol:"SPY",timeframe:"1Day",adjusted:true,coverageStart:"2024-01-01T00:00:00.000Z",coverageEnd:"2024-01-08T00:00:00.000Z",bars:[
    {timestamp:"2024-01-02T14:30:00.000Z",open:100,high:101,low:99,close:100,volume:1000},
    {timestamp:"2024-01-03T14:30:00.000Z",open:101,high:102,low:100,close:101,volume:1000},
  ]});
  try{
    const result=await fetchConfiguredHistory({symbol:"SPY",timeframe:"1Day",start:"2024-01-02",end:"2024-01-05"},"https://archive.example/");
    assert.equal(result.coverageStart,"2024-01-02T00:00:00.000Z");
    assert.equal(result.coverageEnd,"2024-01-04T00:00:00.000Z");
    assert.match(result.warning,/through 2024-01-03/);
  }finally{globalThis.fetch=originalFetch;}
});

test("configured archive rejects mismatched symbols", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({symbol:"QQQ",timeframe:"1Day",bars:[]});
  try {
    await assert.rejects(fetchConfiguredHistory({symbol:"SPY",timeframe:"1Day",start:"2024-01-01",end:"2024-12-31"},"https://archive.example/"),/invalid symbol/);
  } finally { globalThis.fetch = originalFetch; }
});

test("configured archive never falls back when a known symbol has no bars in the requested dates", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    symbol:"TWTR",timeframe:"1Day",adjusted:true,
    coverageStart:"2022-07-01T00:00:00.000Z",coverageEnd:"2022-10-28T00:00:00.000Z",
    bars:["2022-10-26","2022-10-27"].map((date)=>({timestamp:`${date}T00:00:00.000Z`,open:50,high:51,low:49,close:50,volume:1000})),
  });
  try {
    await assert.rejects(fetchConfiguredHistory({symbol:"TWTR",timeframe:"1Day",start:"2024-01-01",end:"2024-12-31"},"https://archive.example/"),/has no bars.*archive coverage is 2022-07-01 through 2022-10-28/);
  } finally { globalThis.fetch = originalFetch; }
});

test("private online archives receive the configured bearer token",async()=>{
  const originalFetch=globalThis.fetch;
  let received;
  globalThis.fetch=async(_url,init)=>{
    received=init.headers.authorization;
    return Response.json({symbol:"SPY",timeframe:"1Day",adjusted:true,coverageStart:"2024-01-01",coverageEnd:"2024-01-05",bars:[
      {timestamp:"2024-01-02T00:00:00.000Z",open:100,high:101,low:99,close:100,volume:1000},
    ]});
  };
  try{
    await fetchConfiguredHistory({symbol:"SPY",timeframe:"1Day",start:"2024-01-01",end:"2024-01-04"},"https://private.example/",{authToken:"test-secret"});
    assert.equal(received,"Bearer test-secret");
  }finally{globalThis.fetch=originalFetch;}
});

test("plain HTTP archive directories can serve per-symbol JSON files",async()=>{
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,init)=>{
    calls.push({url:String(url),token:init.headers?.authorization});
    if(calls.length===1)return new Response(null,{status:404});
    return Response.json({symbol:"SPY",timeframe:"1Day",adjusted:true,coverageStart:"2024-01-02T00:00:00.000Z",coverageEnd:"2024-01-04T00:00:00.000Z",bars:[
      {timestamp:"2024-01-02T00:00:00.000Z",open:100,high:101,low:99,close:100,volume:1000},
      {timestamp:"2024-01-03T00:00:00.000Z",open:101,high:102,low:100,close:101,volume:1100},
    ]});
  };
  try{
    const result=await fetchConfiguredHistory({symbol:"SPY",timeframe:"1Day",start:"2024-01-02",end:"2024-01-03"},"https://archive.example/data/",{authToken:"private-token"});
    assert.equal(result.bars.length,2);
    assert.deepEqual(calls.map((item)=>item.url),[
      "https://archive.example/data/v1/history/SPY/1Day.json",
      "https://archive.example/data/SPY.1Day.json",
    ]);
    assert.deepEqual(calls.map((item)=>item.token),["Bearer private-token","Bearer private-token"]);
  }finally{globalThis.fetch=originalFetch;}
});

test("history loader selects one listing and rejects a date range spanning reused tickers",async()=>{
  const originalFetch=globalThis.fetch;
  const listing=(id,dates,price)=>({listingId:id,delisted:true,coverageStart:`${dates[0]}T00:00:00.000Z`,coverageEnd:`${dates.at(-1).slice(0,8)}${Number(dates.at(-1).slice(8))+1}T00:00:00.000Z`,bars:dates.map((day)=>({timestamp:`${day}T00:00:00.000Z`,open:price,high:price+1,low:price-1,close:price,volume:1000}))});
  const first=listing("TWTR_day_delisted_2007-06-21",["2007-06-18","2007-06-19"],1.5);
  const second=listing("TWTR_day_delisted_2022-10-31",["2022-10-26","2022-10-27"],50);
  globalThis.fetch=async()=>Response.json({symbol:"TWTR",timeframe:"1Day",adjusted:true,coverageStart:first.coverageStart,coverageEnd:second.coverageEnd,listings:[first,second]});
  try{
    const selected=await fetchConfiguredHistory({symbol:"TWTR",timeframe:"1Day",start:"2022-10-26",end:"2022-10-27"},"https://archive.example/");
    assert.equal(selected.bars.length,2);
    assert.equal(selected.bars[0].close,50);
    assert.equal(selected.listingId,"TWTR_day_delisted_2022-10-31");
    assert.match(selected.warning,/Historical listing TWTR_day_delisted_2022-10-31 selected/);
    await assert.rejects(fetchConfiguredHistory({symbol:"TWTR",timeframe:"1Day",start:"2007-06-18",end:"2022-10-27"},"https://archive.example/"),/multiple listings/);
  }finally{globalThis.fetch=originalFetch;}
});

test("a single identified listing keeps its identity for browser cache isolation",async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({symbol:"TWTR",timeframe:"1Day",provider:"adjusted-csv-import",adjusted:true,listingId:"TWTR_day_delisted_2022-10-31",delisted:true,coverageStart:"2022-10-26T00:00:00.000Z",coverageEnd:"2022-10-28T00:00:00.000Z",bars:[
    {timestamp:"2022-10-26T00:00:00.000Z",open:50,high:51,low:49,close:50,volume:1000},
    {timestamp:"2022-10-27T00:00:00.000Z",open:51,high:52,low:50,close:51,volume:1000},
  ]});
  try{
    const result=await fetchConfiguredHistory({symbol:"TWTR",timeframe:"1Day",start:"2022-10-26",end:"2022-10-27"},"https://archive.example/");
    assert.equal(result.listingId,"TWTR_day_delisted_2022-10-31");
    assert.match(result.warning,/Historical listing TWTR_day_delisted_2022-10-31 selected/);
  }finally{globalThis.fetch=originalFetch;}
});
