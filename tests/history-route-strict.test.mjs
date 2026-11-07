import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle=await build({
  entryPoints:[new URL("../app/api/history/route.ts",import.meta.url).pathname],bundle:true,write:false,platform:"node",format:"esm",
  plugins:[{name:"mock-user",setup(plugin){
    plugin.onResolve({filter:/chatgpt-auth$/},()=>({path:"auth",namespace:"mock-user"}));
    plugin.onLoad({filter:/.*/,namespace:"mock-user"},()=>({contents:'export const getChatGPTUser=async()=>({email:"test@example.com"});',loader:"js"}));
    plugin.onResolve({filter:/user-credentials$/},()=>({path:"credentials",namespace:"mock-credentials"}));
    plugin.onLoad({filter:/.*/,namespace:"mock-credentials"},()=>({contents:'export const accountProfile=()=>"paper"; export const getUserCredentials=async()=>{throw new Error("Broker credentials should not be requested")};',loader:"js"}));
  }}],
});
const {POST}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const request=(body)=>new Request("http://localhost/api/history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
const input={symbol:"SPY",start:"2024-01-01",end:"2024-01-05"};

test("strict daily archive mode reports missing symbols without a provider fallback",async()=>{
  const originalFetch=globalThis.fetch,source=process.env.BACKTESTING_DATA_SOURCE,strict=process.env.BACKTESTING_DATA_STRICT_DAILY;
  process.env.BACKTESTING_DATA_SOURCE="https://archive.example.test/";
  process.env.BACKTESTING_DATA_STRICT_DAILY="true";
  const calls=[];
  globalThis.fetch=async(url)=>{calls.push(String(url));return new Response(null,{status:404});};
  try{
    const response=await POST(request({...input,timeframe:"1Day"}));
    assert.equal(response.status,404);
    assert.match((await response.json()).error,/no file for SPY/);
    assert.equal(calls.length,2);
    assert.match(calls[0],/v1\/history\/SPY\/1Day\.json$/);
    assert.match(calls[1],/SPY\.1Day\.json$/);
  }finally{
    globalThis.fetch=originalFetch;
    if(source===undefined)delete process.env.BACKTESTING_DATA_SOURCE;else process.env.BACKTESTING_DATA_SOURCE=source;
    if(strict===undefined)delete process.env.BACKTESTING_DATA_STRICT_DAILY;else process.env.BACKTESTING_DATA_STRICT_DAILY=strict;
  }
});

test("missing daily timeframe uses the public daily fallback when strict mode is off",async()=>{
  const originalFetch=globalThis.fetch,source=process.env.BACKTESTING_DATA_SOURCE,strict=process.env.BACKTESTING_DATA_STRICT_DAILY;
  process.env.BACKTESTING_DATA_SOURCE="https://archive.example.test/";
  process.env.BACKTESTING_DATA_STRICT_DAILY="false";
  const calls=[];
  const days=["2024-01-02","2024-01-03"];
  globalThis.fetch=async(url)=>{
    calls.push(String(url));
    if(String(url).startsWith("https://archive.example.test/"))return new Response(null,{status:404});
    if(String(url).startsWith("https://query2.finance.yahoo.com/"))return Response.json({chart:{result:[{
      timestamp:days.map((day)=>Date.parse(`${day}T14:30:00.000Z`)/1000),
      indicators:{quote:[{open:[10,11],high:[12,13],low:[9,10],close:[11,12],volume:[100,200]}],adjclose:[{adjclose:[11,12]}]},
    }]}});
    throw new Error(`Unexpected provider: ${url}`);
  };
  try{
    const response=await POST(request(input));
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.provider,"yahoo-chart");
    assert.equal(data.bars.length,2);
    assert.equal(calls.length,3);
  }finally{
    globalThis.fetch=originalFetch;
    if(source===undefined)delete process.env.BACKTESTING_DATA_SOURCE;else process.env.BACKTESTING_DATA_SOURCE=source;
    if(strict===undefined)delete process.env.BACKTESTING_DATA_STRICT_DAILY;else process.env.BACKTESTING_DATA_STRICT_DAILY=strict;
  }
});
