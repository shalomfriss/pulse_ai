import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const modules = {
  credentials: `export const alpacaTradingBaseUrl=()=>"https://paper-api.alpaca.markets";export const getUserCredentials=async()=>globalThis.__ruleExecutionState.credentials;`,
  rules: `export const listEnabledRuleSets=async()=>globalThis.__ruleExecutionState.sets;export const claimRuleRun=async(id,slot,spec)=>{const state=globalThis.__ruleExecutionState,key=id+slot,prior=state.claims.get(key),snapshot=JSON.stringify(spec);if(prior&&prior!=="retryable")return null;if(prior&&state.snapshots.get(key)!==snapshot)return null;state.snapshots.set(key,snapshot);state.claims.set(key,"running");if(!prior)state.orderVersions.set(key,"slot");return {id:"run-1",orderIdVersion:state.orderVersions.get(key)??"date"};};export const finishRuleRun=async(id,status,result)=>{const state=globalThis.__ruleExecutionState;for(const key of state.claims.keys())state.claims.set(key,status);state.finished.push({id,status,result});};`,
  history: `export const fetchAlpacaHistory=async(input,credentials,options)=>{globalThis.__ruleExecutionState.historyRequest={input,options};return {bars:globalThis.__ruleExecutionState.bars};};`,
};
const bundle = await build({
  entryPoints:[new URL("../lib/rule-execution.ts",import.meta.url).pathname],bundle:true,write:false,platform:"node",format:"esm",
  plugins:[{name:"mock-rule-dependencies",setup(plugin){
    plugin.onResolve({filter:/^\.\.\/db\/user-credentials$/},()=>({path:"credentials",namespace:"mock-rule"}));
    plugin.onResolve({filter:/^\.\.\/db\/rule-sets$/},()=>({path:"rules",namespace:"mock-rule"}));
    plugin.onResolve({filter:/^\.\/historical-data\.mjs$/},()=>({path:"history",namespace:"mock-rule"}));
    plugin.onLoad({filter:/.*/,namespace:"mock-rule"},(args)=>({contents:modules[args.path],loader:"js"}));
  }}],
});
const { runDueRuleSets,previewRuleSet } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const date = new Date("2024-01-09T15:00:00.000Z");
const condition = (type,threshold)=>({type,threshold,fast:0,slow:0});
const bars = [
  ["2024-01-04",95],["2024-01-05",98],["2024-01-08",110],["2024-01-09",60],
].map(([day,close])=>({timestamp:`${day}T14:30:00.000Z`,close}));

function setup(action,threshold,position=[]){
  const rule={symbol:"SPY",condition:condition(action==="buy"?"close_above":"close_below",threshold),action,notionalUsd:action==="buy"?100:0};
  const state={credentials:{keyId:"test",secretKey:"test",autoTrade:true},sets:[{id:"12345678-0000-0000-0000-000000000000",email:"user@example.com",profile:"paper",spec:{name:"Smoke",unsupportedReason:"",schedule:{hour:10,minute:0},rules:[rule]}}],bars,positions:position,orders:[],posts:[],claims:new Map(),snapshots:new Map(),orderVersions:new Map(),finished:[]};
  globalThis.__ruleExecutionState=state;
  return state;
}

test("scheduled rules submit one buy using the last completed daily close",async()=>{
  const state=setup("buy",100),originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname;
    if(path==="/v2/clock")return Response.json({is_open:true});
    if(path==="/v2/positions")return Response.json(state.positions);
    if(path==="/v2/orders"&&init.method==="POST"){
      const payload=JSON.parse(init.body);state.posts.push(payload);return Response.json({id:"order-1"});
    }
    if(path==="/v2/orders")return Response.json(state.orders);
    throw new Error(`Unexpected broker URL: ${url}`);
  };
  try{
    const result=await runDueRuleSets(date);
    assert.equal(result.length,1);
    assert.equal(result[0].rules[0].observed.lastClose,110);
    assert.equal(result[0].rules[0].barDate,"2024-01-08");
    assert.equal(result[0].rules[0].priceAdjustment,"raw");
    assert.equal(state.historyRequest.options.feed,"sip");
    assert.equal(state.historyRequest.options.adjustment,"raw");
    assert.equal(state.historyRequest.input.end,"2024-01-09T14:30:00.000Z");
    assert.deepEqual(state.posts.map(({symbol,side,notional,client_order_id})=>({symbol,side,notional,client_order_id})),[{symbol:"SPY",side:"buy",notional:"100.00",client_order_id:"pulse-r-12345678000000000000000000000000-202401091000-00"}]);
    assert.equal(state.finished[0].status,"completed");
    assert.deepEqual(await runDueRuleSets(date),[]);
    assert.equal(state.posts.length,1);
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});

test("scheduled SMA crossover requests the archive's fully adjusted history",async()=>{
  const state=setup("buy",100),originalFetch=globalThis.fetch;
  state.sets[0].spec.rules[0].condition={type:"sma_cross_above",threshold:0,fast:2,slow:3};
  state.bars=["2024-01-02","2024-01-03","2024-01-04","2024-01-05","2024-01-08"].map((day,index)=>({timestamp:`${day}T14:30:00.000Z`,close:index===4?2:1}));
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname;
    if(path==="/v2/clock")return Response.json({is_open:true});
    if(path==="/v2/positions")return Response.json([]);
    if(path==="/v2/orders"&&init.method==="POST"){
      state.posts.push(JSON.parse(init.body));return Response.json({id:"sma-order"});
    }
    if(path==="/v2/orders")return Response.json([]);
    throw new Error(`Unexpected broker URL: ${url}`);
  };
  try{
    const result=await runDueRuleSets(date);
    assert.equal(state.historyRequest.options.adjustment,"all");
    assert.equal(result[0].rules[0].priceAdjustment,"all");
    assert.equal(result[0].rules[0].outcome,"submitted");
    assert.equal(state.posts.length,1);
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});

test("scheduled threshold rule can trade after a symbol's first completed day",async()=>{
  const state=setup("buy",100),originalFetch=globalThis.fetch;
  state.bars=[bars[2]];
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname;
    if(path==="/v2/clock")return Response.json({is_open:true});
    if(path==="/v2/positions")return Response.json([]);
    if(path==="/v2/orders"&&init.method==="POST"){
      state.posts.push(JSON.parse(init.body));return Response.json({id:"first-day-order"});
    }
    if(path==="/v2/orders")return Response.json([]);
    throw new Error(`Unexpected broker URL: ${url}`);
  };
  try{
    const result=await runDueRuleSets(date);
    assert.equal(result[0].rules[0].outcome,"submitted");
    assert.equal(result[0].rules[0].barDate,"2024-01-08");
    assert.equal(state.posts.length,1);
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});

test("rule sets with the same UUID prefix use distinct broker order IDs",async()=>{
  const state=setup("buy",100),originalFetch=globalThis.fetch;
  state.sets.push({...state.sets[0],id:"12345678-1111-1111-1111-111111111111"});
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname;
    if(path==="/v2/clock")return Response.json({is_open:true});
    if(path==="/v2/positions")return Response.json([]);
    if(path==="/v2/orders"&&init.method==="POST"){
      state.posts.push(JSON.parse(init.body));return Response.json({id:`order-${state.posts.length}`});
    }
    if(path==="/v2/orders")return Response.json([]);
    throw new Error(`Unexpected broker URL: ${url}`);
  };
  try{
    const result=await runDueRuleSets(date);
    assert.equal(result.length,2);
    assert.equal(state.posts.length,2);
    assert.notEqual(state.posts[0].client_order_id,state.posts[1].client_order_id);
    assert.ok(state.posts.every((post)=>post.client_order_id.length<=128));
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});

test("different scheduled times on the same day use distinct broker order IDs",async()=>{
  const state=setup("buy",100),originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname;
    if(path==="/v2/clock")return Response.json({is_open:true});
    if(path==="/v2/positions")return Response.json([]);
    if(path==="/v2/orders"&&init.method==="POST"){
      const order=JSON.parse(init.body);
      if(state.posts.some((prior)=>prior.client_order_id===order.client_order_id))return Response.json({message:"duplicate client order ID"},{status:422});
      state.posts.push(order);return Response.json({id:`order-${state.posts.length}`});
    }
    if(path==="/v2/orders")return Response.json([]);
    throw new Error(`Unexpected broker URL: ${url}`);
  };
  try{
    const first=await runDueRuleSets(date);
    assert.equal(first[0].rules[0].outcome,"submitted");
    state.sets[0].spec.schedule.minute=5;
    const second=await runDueRuleSets(new Date(date.getTime()+5*60_000));
    assert.equal(second[0].rules[0].outcome,"submitted");
    assert.deepEqual(state.posts.map((order)=>order.client_order_id),[
      "pulse-r-12345678000000000000000000000000-202401091000-00",
      "pulse-r-12345678000000000000000000000000-202401091005-00",
    ]);
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});

test("an existing retry keeps its original date-only broker order ID",async()=>{
  const state=setup("buy",100),originalFetch=globalThis.fetch;
  const key=`${state.sets[0].id}2024-01-09T10:00:00[America/New_York]`;
  state.claims.set(key,"retryable");
  state.snapshots.set(key,JSON.stringify(state.sets[0].spec));
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname;
    if(path==="/v2/clock")return Response.json({is_open:true});
    if(path==="/v2/positions")return Response.json([]);
    if(path==="/v2/orders"&&init.method==="POST"){
      state.posts.push(JSON.parse(init.body));return Response.json({id:"legacy-order"});
    }
    if(path==="/v2/orders")return Response.json([]);
    throw new Error(`Unexpected broker URL: ${url}`);
  };
  try{
    const result=await runDueRuleSets(date);
    assert.equal(result[0].rules[0].outcome,"submitted");
    assert.equal(state.posts[0].client_order_id,"pulse-r-12345678000000000000000000000000-20240109-00");
    assert.equal(state.finished[0].result.orderIdVersion,"date");
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});

test("scheduled rules sell an existing position and record the order",async()=>{
  const state=setup("sell",100,[{symbol:"SPY",qty:"2.5"}]),originalFetch=globalThis.fetch;
  state.bars=[...bars.slice(0,2),{...bars[2],close:90},bars[3]];
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname;
    if(path==="/v2/clock")return Response.json({is_open:true});
    if(path==="/v2/positions")return Response.json(state.positions);
    if(path==="/v2/orders"&&init.method==="POST"){
      state.posts.push(JSON.parse(init.body));return Response.json({id:"order-2"});
    }
    if(path==="/v2/orders")return Response.json([]);
    throw new Error(`Unexpected broker URL: ${url}`);
  };
  try{
    const result=await runDueRuleSets(date);
    assert.equal(result[0].rules[0].outcome,"submitted");
    assert.equal(state.posts[0].side,"sell");
    assert.equal(state.posts[0].qty,"2.5");
    assert.equal(state.finished[0].result.rules[0].orderId,"order-2");
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});

test("scheduled rules cannot reach the broker when auto trading is disabled",async()=>{
  const state=setup("buy",100),originalFetch=globalThis.fetch;
  state.credentials.autoTrade=false;
  globalThis.fetch=async()=>{throw new Error("Broker should not be called");};
  try{
    const result=await runDueRuleSets(date);
    assert.match(result[0].error,/Auto trading is disabled/);
    assert.equal(state.finished[0].status,"failed");
    assert.equal(state.posts.length,0);
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});

test("current decision preview reports the planned order without submitting it",async()=>{
  const state=setup("buy",100),originalFetch=globalThis.fetch;
  state.credentials.autoTrade=false;
  let marketOpen=false;
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname;
    if(path==="/v2/clock") return Response.json({is_open:marketOpen});
    if(path==="/v2/positions") return Response.json([]);
    if(path==="/v2/orders"&&init.method==="POST") throw new Error("Preview must not submit an order");
    if(path==="/v2/orders") return Response.json([]);
    throw new Error(`Unexpected broker URL: ${url}`);
  };
  try{
    const closed=await previewRuleSet(state.sets[0],date);
    assert.equal(closed.marketOpen,false);
    assert.equal(closed.autoTradeEnabled,false);
    assert.equal(closed.rules[0].outcome,"market_closed");
    assert.equal(closed.rules[0].plannedOrder.notional,"100.00");
    assert.equal(closed.rules[0].plannedOrder.client_order_id,undefined);
    marketOpen=true;
    const disabled=await previewRuleSet(state.sets[0],date);
    assert.equal(disabled.rules[0].outcome,"auto_trading_disabled");
    state.credentials.autoTrade=true;
    const ready=await previewRuleSet(state.sets[0],date);
    assert.equal(ready.rules[0].outcome,"would_submit");
    assert.equal(state.posts.length,0);
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});

test("a transient broker outage can retry the same scheduled slot",async()=>{
  const state=setup("buy",100),originalFetch=globalThis.fetch;
  let clockCalls=0;
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname;
    if(path==="/v2/clock"){
      clockCalls+=1;
      if(clockCalls===1) throw new TypeError("Temporary connection failure");
      return Response.json({is_open:true});
    }
    if(path==="/v2/positions") return Response.json([]);
    if(path==="/v2/orders"&&init.method==="POST"){
      state.posts.push(JSON.parse(init.body));
      return Response.json({id:"order-after-retry"});
    }
    if(path==="/v2/orders") return Response.json([]);
    throw new Error(`Unexpected broker URL: ${url}`);
  };
  try{
    const first=await runDueRuleSets(date);
    assert.equal(first[0].retryable,true);
    assert.equal(state.finished[0].status,"retryable");
    assert.equal(state.posts.length,0);
    const second=await runDueRuleSets(new Date(date.getTime()+60_000));
    assert.equal(second[0].rules[0].outcome,"submitted");
    assert.equal(state.finished[1].status,"completed");
    assert.equal(state.posts.length,1);
    assert.deepEqual(await runDueRuleSets(new Date(date.getTime()+120_000)),[]);
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});

test("a closed broker clock at the scheduled minute retries within the due window",async()=>{
  const state=setup("buy",100),originalFetch=globalThis.fetch;
  let clockCalls=0;
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname;
    if(path==="/v2/clock")return Response.json({is_open:++clockCalls>1});
    if(path==="/v2/positions")return Response.json([]);
    if(path==="/v2/orders"&&init.method==="POST"){
      state.posts.push(JSON.parse(init.body));return Response.json({id:"order-after-open"});
    }
    if(path==="/v2/orders")return Response.json([]);
    throw new Error(`Unexpected broker URL: ${url}`);
  };
  try{
    const first=await runDueRuleSets(date);
    assert.equal(first[0].skipped,"Alpaca market is closed");
    assert.equal(state.finished[0].status,"retryable");
    assert.equal(state.posts.length,0);
    const second=await runDueRuleSets(new Date(date.getTime()+60_000));
    assert.equal(second[0].rules[0].outcome,"submitted");
    assert.equal(state.finished[1].status,"completed");
    assert.equal(state.posts.length,1);
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});

test("editing a rule set cannot change the instructions on a retry",async()=>{
  const state=setup("buy",100),originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname;
    if(path==="/v2/clock") throw new TypeError("Temporary connection failure");
    if(path==="/v2/orders"&&init.method==="POST") state.posts.push(JSON.parse(init.body));
    throw new Error(`Unexpected broker URL: ${url}`);
  };
  try{
    const first=await runDueRuleSets(date);
    assert.equal(first[0].retryable,true);
    assert.equal(state.finished[0].status,"retryable");
    assert.equal(state.finished[0].result.specSnapshot.rules[0].condition.threshold,100);
    state.sets[0].spec.rules[0].condition.threshold=90;
    assert.deepEqual(await runDueRuleSets(new Date(date.getTime()+60_000)),[]);
    assert.equal(state.posts.length,0);
    assert.equal(state.finished.length,1);
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});

test("a lost order response is reconciled by client order ID without a second submission",async()=>{
  const state=setup("buy",100),originalFetch=globalThis.fetch;
  let lookups=0;
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname;
    if(path==="/v2/clock")return Response.json({is_open:true});
    if(path==="/v2/positions")return Response.json(state.positions);
    if(path==="/v2/orders"&&init.method==="POST"){
      state.posts.push(JSON.parse(init.body));
      throw new TypeError("Connection closed after broker accepted order");
    }
    if(path==="/v2/orders")return Response.json([]);
    if(path==="/v2/orders:by_client_order_id"){
      lookups+=1;
      return Response.json({id:"recovered-order",client_order_id:new URL(url).searchParams.get("client_order_id")});
    }
    throw new Error(`Unexpected broker URL: ${url}`);
  };
  try{
    const result=await runDueRuleSets(date);
    assert.equal(result[0].rules[0].outcome,"submitted");
    assert.equal(result[0].rules[0].orderId,"recovered-order");
    assert.equal(state.posts.length,1);
    assert.equal(lookups,1);
    assert.equal(state.finished[0].status,"completed");
  }finally{globalThis.fetch=originalFetch;delete globalThis.__ruleExecutionState;}
});
