import assert from "node:assert/strict";
import test from "node:test";
import { runRuleSetBacktest } from "../lib/rule-backtesting.mjs";

const dates=["2024-01-02","2024-01-03","2024-01-04","2024-01-05","2024-01-08","2024-01-09"];
const bars=(closes)=>closes.map((close,index)=>({timestamp:`${dates[index]}T14:30:00.000Z`,open:close,high:close+1,low:close-1,close,rawClose:close,volume:1000}));
const condition=(type,threshold)=>({type,threshold,fast:0,slow:0});
const spec={name:"Two symbol test",unsupportedReason:"",schedule:{hour:9,minute:35},rules:[
  {symbol:"AAA",condition:condition("close_above",11),action:"buy",notionalUsd:40},
  {symbol:"AAA",condition:condition("close_below",10),action:"sell",notionalUsd:0},
  {symbol:"BBB",condition:condition("close_below",19),action:"buy",notionalUsd:30},
]};

test("rule-set backtest fills on the next day's open and shares cash across symbols",()=>{
  const result=runRuleSetBacktest({spec,barsBySymbol:{AAA:bars([10,10,12,13,8,9]),BBB:bars([20,20,19,18,17,16])},start:"2024-01-02",end:"2024-01-09",initialCapital:100,commission:1,slippageBps:0});
  assert.deepEqual(result.fills.map((fill)=>[fill.date,fill.symbol,fill.side]),[["2024-01-05","AAA","buy"],["2024-01-08","BBB","buy"],["2024-01-09","AAA","sell"]]);
  assert.equal(result.fills[0].price,13);
  assert.equal(result.metrics.tradeCount,1);
  assert.equal(result.openPositions.length,1);
  assert.equal(result.openPositions[0].symbol,"BBB");
  assert.equal(result.equityCurve.length,6);
  assert.ok(result.metrics.finalEquity<100);
});

test("a close threshold can first fill on the second trading day's open",()=>{
  const onlyBuy={...spec,rules:[spec.rules[0]]};
  const result=runRuleSetBacktest({spec:onlyBuy,barsBySymbol:{AAA:bars([12,13])},start:"2024-01-02",end:"2024-01-03",initialCapital:100,commission:0,slippageBps:0});
  assert.deepEqual(result.fills.map((fill)=>[fill.date,fill.price]),[["2024-01-03",13]]);
  assert.equal(result.fills[0].signal.lastClose,12);
});

test("absolute threshold uses quoted raw close and rejects adjusted-only histories",()=>{
  const onlyBuy={...spec,rules:[spec.rules[0]]};
  const adjusted=bars([5,6]).map(({rawClose,...bar})=>bar);
  const raw=adjusted.map((bar,index)=>({...bar,rawClose:index===0?12:13}));
  const input={spec:onlyBuy,start:"2024-01-02",end:"2024-01-03",initialCapital:100,commission:0,slippageBps:0};
  const quoted=runRuleSetBacktest({...input,barsBySymbol:{AAA:raw}});
  assert.equal(quoted.fills.length,1);
  assert.equal(quoted.fills[0].signal.lastClose,12);
  assert.equal(quoted.fills[0].signal.priceBasis,"raw");
  assert.throws(()=>runRuleSetBacktest({...input,barsBySymbol:{AAA:adjusted}}),/fixed-dollar rule backtests require raw as-traded closes/);
});

test("SMA-only rules can use adjusted history without raw closes",()=>{
  const smaSpec={...spec,rules:[{...spec.rules[0],condition:{type:"sma_cross_above",threshold:0,fast:2,slow:3}}]};
  const adjusted=bars([2,2,2,2,3,3]).map(({rawClose,...bar})=>bar);
  const result=runRuleSetBacktest({spec:smaSpec,barsBySymbol:{AAA:adjusted},start:"2024-01-02",end:"2024-01-09",initialCapital:100,commission:0,slippageBps:0});
  assert.equal(result.fills.length,1);
});

test("backtest cannot fill on a signal's own bar or without adequate cash",()=>{
  const onlyOne={...spec,rules:[spec.rules[0]]};
  const result=runRuleSetBacktest({spec:onlyOne,barsBySymbol:{AAA:bars([10,10,12,13,8,9])},start:"2024-01-02",end:"2024-01-04",initialCapital:100,commission:0,slippageBps:0});
  assert.equal(result.fills.length,0);
  const poor=runRuleSetBacktest({spec:onlyOne,barsBySymbol:{AAA:bars([10,10,12,13,8,9])},start:"2024-01-02",end:"2024-01-09",initialCapital:30,commission:1,slippageBps:0});
  assert.equal(poor.fills.length,0);
});

test("backtest requires every requested symbol's data",()=>{
  assert.throws(()=>runRuleSetBacktest({spec,barsBySymbol:{AAA:bars([10,10,12,13,8,9])},start:"2024-01-02",end:"2024-01-09",initialCapital:100}),/Missing historical bars for BBB/);
});

test("backtest refuses to value an unclosed position after the data ends",()=>{
  const onlyBuy={...spec,rules:[spec.rules[0]]};
  assert.throws(()=>runRuleSetBacktest({spec:onlyBuy,barsBySymbol:{AAA:bars([10,10,12,13,8,9])},start:"2024-01-02",end:"2024-02-09",initialCapital:100}),/delisting outcome or newer data/);
});

test("backtest rejects sale costs greater than proceeds",()=>{
  const costly={...spec,rules:[{...spec.rules[0],notionalUsd:1},spec.rules[1]]};
  assert.throws(()=>runRuleSetBacktest({spec:costly,barsBySymbol:{AAA:bars([10,10,12,13,8,9])},start:"2024-01-02",end:"2024-01-09",initialCapital:100,commission:2}),/Commission exceeds AAA sale proceeds/);
});
