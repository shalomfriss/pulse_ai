import assert from "node:assert/strict";
import { build } from "esbuild";
import test from "node:test";

test("reused ticker histories bypass the ticker-only browser cache",async()=>{
  const bundle=await build({entryPoints:[new URL("../app/backtesting/local-history.ts",import.meta.url).pathname],bundle:true,write:false,platform:"node",format:"esm"});
  const {resolveHistoricalDataset}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const originalFetch=globalThis.fetch,originalIndexedDb=globalThis.indexedDB;
  let listingId="TWTR_day_delisted_2007-06-21";
  globalThis.indexedDB={open(){throw new Error("Listing data must not be cached by ticker")}};
  globalThis.fetch=async()=>Response.json({symbol:"TWTR",timeframe:"1Day",provider:"configured-source",listingId,coverageStart:"2007-06-18",coverageEnd:"2022-10-28",bars:[{timestamp:"2007-06-18T00:00:00.000Z",open:1,high:2,low:1,close:1.5,volume:100}]});
  try{
    const first=await resolveHistoricalDataset({symbol:"TWTR",timeframe:"1Day",start:"2007-06-18",end:"2007-06-19",forceRefresh:true});
    listingId="TWTR_day_delisted_2022-10-31";
    globalThis.fetch=async()=>Response.json({symbol:"TWTR",timeframe:"1Day",provider:"configured-source",listingId,coverageStart:"2022-10-26",coverageEnd:"2022-10-28",bars:[{timestamp:"2022-10-26T00:00:00.000Z",open:50,high:51,low:49,close:50,volume:1000}]});
    const second=await resolveHistoricalDataset({symbol:"TWTR",timeframe:"1Day",start:"2022-10-26",end:"2022-10-27",forceRefresh:true});
    assert.equal(first.bars[0].close,1.5);
    assert.equal(second.bars[0].close,50);
    assert.notEqual(first.summary.key,second.summary.key);
  }finally{globalThis.fetch=originalFetch;globalThis.indexedDB=originalIndexedDb;}
});

test("browser cache replaces a different data provider and preserves provenance warnings",async()=>{
  const bundle=await build({entryPoints:[new URL("../app/backtesting/local-history.ts",import.meta.url).pathname],bundle:true,write:false,platform:"node",format:"esm"});
  const {resolveHistoricalDataset,loadCompiledHistory}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const originalFetch=globalThis.fetch,originalIndexedDb=globalThis.indexedDB;
  const records=new Map();
  const database={objectStoreNames:{contains:()=>true},close(){},transaction(){
    const transaction={objectStore(){return{
      get(key){const request={};queueMicrotask(()=>{request.result=records.get(key);request.onsuccess?.()});return request;},
      put(record){records.set(record.key,record);queueMicrotask(()=>transaction.oncomplete?.());},
    };}};return transaction;
  }};
  globalThis.indexedDB={open(){const request={result:database};queueMicrotask(()=>request.onsuccess?.());return request;}};
  const bar=(date,close)=>({timestamp:`${date}T14:30:00.000Z`,open:close,high:close+1,low:close-1,close,volume:1000});
  try{
    globalThis.fetch=async()=>Response.json({symbol:"SPY",timeframe:"1Day",provider:"yahoo-chart",coverageStart:"2024-01-02",coverageEnd:"2024-01-03",bars:[bar("2024-01-02",100),bar("2024-01-03",101)]});
    await resolveHistoricalDataset({symbol:"SPY",timeframe:"1Day",start:"2024-01-02",end:"2024-01-03",forceRefresh:true});
    globalThis.fetch=async()=>Response.json({symbol:"SPY",timeframe:"1Day",provider:"configured-source",archiveProvider:"adjusted-csv-import",sourceKey:"archive-one",coverageStart:"2024-01-03",coverageEnd:"2024-01-04",bars:[bar("2024-01-03",200),bar("2024-01-04",201)]});
    const updated=await resolveHistoricalDataset({symbol:"SPY",timeframe:"1Day",start:"2024-01-03",end:"2024-01-04",forceRefresh:true});
    assert.deepEqual(updated.bars.map((item)=>item.close),[200,201]);
    const cached=await loadCompiledHistory("SPY","1Day","2024-01-03","2024-01-04");
    assert.deepEqual(cached.bars.map((item)=>item.close),[200,201]);
    assert.match(cached.warning,/security identity/);
    assert.equal(await loadCompiledHistory("SPY","1Day","2024-01-02","2024-01-04"),null);
    globalThis.fetch=async()=>Response.json({symbol:"SPY",timeframe:"1Day",provider:"configured-source",archiveProvider:"adjusted-csv-import",sourceKey:"archive-one",coverageStart:"2024-01-04",coverageEnd:"2024-01-05",bars:[bar("2024-01-04",250),bar("2024-01-05",251)]});
    await resolveHistoricalDataset({symbol:"SPY",timeframe:"1Day",start:"2024-01-04",end:"2024-01-05",forceRefresh:true});
    assert.equal(await loadCompiledHistory("SPY","1Day","2024-01-03","2024-01-05"),null);
    globalThis.fetch=async()=>Response.json({symbol:"SPY",timeframe:"1Day",provider:"configured-source",archiveProvider:"adjusted-csv-import",sourceKey:"archive-two",coverageStart:"2024-01-04",coverageEnd:"2024-01-05",bars:[bar("2024-01-04",300),bar("2024-01-05",301)]});
    await resolveHistoricalDataset({symbol:"SPY",timeframe:"1Day",start:"2024-01-04",end:"2024-01-05",forceRefresh:true});
    const switched=await loadCompiledHistory("SPY","1Day","2024-01-04","2024-01-05");
    assert.deepEqual(switched.bars.map((item)=>item.close),[300,301]);
    assert.equal(await loadCompiledHistory("SPY","1Day","2024-01-03","2024-01-05"),null);
  }finally{globalThis.fetch=originalFetch;globalThis.indexedDB=originalIndexedDb;}
});

test("a configured archive takes priority over a complete browser cache",async()=>{
  const bundle=await build({entryPoints:[new URL("../app/backtesting/local-history.ts",import.meta.url).pathname],bundle:true,write:false,platform:"node",format:"esm"});
  const {resolveHistoricalDataset}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const originalFetch=globalThis.fetch,originalIndexedDb=globalThis.indexedDB;
  const records=new Map();
  const database={objectStoreNames:{contains:()=>true},close(){},transaction(){
    const transaction={objectStore(){return{
      get(key){const request={};queueMicrotask(()=>{request.result=records.get(key);request.onsuccess?.()});return request;},
      put(record){records.set(record.key,record);queueMicrotask(()=>transaction.oncomplete?.());},
    };}};return transaction;
  }};
  globalThis.indexedDB={open(){const request={result:database};queueMicrotask(()=>request.onsuccess?.());return request;}};
  const input={symbol:"SPY",timeframe:"1Day",start:"2024-01-02",end:"2024-01-03"};
  let configuredSource=false,strictDaily=false,close=100,posts=0;
  globalThis.fetch=async(_url,init={})=>{
    if(init.method==="GET")return Response.json({configuredSource,strictDaily});
    posts+=1;
    if(strictDaily)return Response.json({error:"Configured daily archive is required"},{status:503});
    return Response.json({symbol:"SPY",timeframe:"1Day",provider:configuredSource?"configured-source":"yahoo-chart",sourceKey:configuredSource?"disk-a":undefined,coverageStart:"2024-01-02",coverageEnd:"2024-01-04",bars:["2024-01-02","2024-01-03"].map((day)=>({timestamp:`${day}T14:30:00.000Z`,open:close,high:close+1,low:close-1,close,volume:1000}))});
  };
  try{
    assert.equal((await resolveHistoricalDataset({...input,forceRefresh:true})).bars[0].close,100);
    configuredSource=true;close=200;
    const archived=await resolveHistoricalDataset(input);
    assert.equal(archived.bars[0].close,200);
    assert.equal(archived.source,"configured");
    configuredSource=false;close=300;
    const publicData=await resolveHistoricalDataset(input);
    assert.equal(publicData.bars[0].close,300);
    assert.equal(publicData.source,"yahoo");
    strictDaily=true;
    await assert.rejects(resolveHistoricalDataset(input),/Configured daily archive is required/);
    assert.equal(posts,4);
  }finally{globalThis.fetch=originalFetch;globalThis.indexedDB=originalIndexedDb;}
});
