import assert from "node:assert/strict";
import test from "node:test";
import { ruleRequiresReview,validateRuleSpec } from "../lib/rule-spec.mjs";
import { dueSlot,evaluateRule } from "../lib/rule-evaluator.mjs";
import { planRuleOrder } from "../lib/rule-order-plan.mjs";

const spec={name:"SMA entry",unsupportedReason:"",schedule:{hour:9,minute:35},rules:[{symbol:"spy",condition:{type:"sma_cross_above",threshold:0,fast:2,slow:3},action:"buy",notionalUsd:100}]};

test("rule spec rejects unsupported behavior and incompatible parameters",()=>{
  assert.equal(validateRuleSpec(spec).rules[0].symbol,"SPY");
  assert.throws(()=>validateRuleSpec({...spec,unsupportedReason:"RSI is unsupported"}),/Cannot represent/);
  assert.throws(()=>validateRuleSpec({...spec,rules:[{...spec.rules[0],condition:{...spec.rules[0].condition,fast:4}}]}),/incompatible/);
  assert.throws(()=>validateRuleSpec({...spec,rules:[{...spec.rules[0],action:"sell",notionalUsd:100}]}),/invalid trade amount/);
});

test("old fixed-price sets require review under the corrected raw-close contract",()=>{
  const closeSpec={...spec,rules:[{...spec.rules[0],condition:{type:"close_above",threshold:100,fast:0,slow:0}}]};
  assert.equal(ruleRequiresReview(validateRuleSpec(closeSpec)),true);
  assert.equal(ruleRequiresReview(validateRuleSpec({...closeSpec,semanticsVersion:2})),false);
  assert.equal(ruleRequiresReview(validateRuleSpec(spec)),false);
  assert.throws(()=>validateRuleSpec({...closeSpec,semanticsVersion:1}),/unsupported execution semantics version/);
});

test("SMA crossover uses only prior and completed bars",()=>{
  const rule=validateRuleSpec(spec).rules[0];
  assert.equal(evaluateRule(rule,[1,1,1,1,2].map((close)=>({close}))).triggered,true);
  assert.equal(evaluateRule(rule,[1,1,1,2,3].map((close)=>({close}))).triggered,false);
});

test("close threshold uses one completed daily bar",()=>{
  const rule={...validateRuleSpec(spec).rules[0],condition:{type:"close_above",threshold:11,fast:0,slow:0}};
  assert.equal(evaluateRule(rule,[{close:12}]).triggered,true);
  assert.throws(()=>evaluateRule(rule,[]),/At least one completed daily bar/);
});

test("daily New York schedule is due once in a bounded window",()=>{
  assert.equal(dueSlot(spec,new Date("2026-10-27T13:35:00Z")),"2026-10-27T09:35:00[America/New_York]");
  assert.equal(dueSlot(spec,new Date("2026-10-27T13:51:00Z")),null);
  assert.equal(dueSlot(spec,new Date("2026-10-25T13:35:00Z")),null);
});

test("order planner buys once and sells only an existing long position",()=>{
  const buy=validateRuleSpec(spec).rules[0];
  const signal={triggered:true};
  assert.equal(planRuleOrder(buy,signal,0,false,"test-1").payload.notional,"100.00");
  assert.equal(planRuleOrder(buy,signal,2,false,"test-1").outcome,"position_already_open");
  assert.equal(planRuleOrder(buy,signal,0,true,"test-1").outcome,"open_order_exists");
  const sell={...buy,action:"sell",notionalUsd:0};
  assert.equal(planRuleOrder(sell,signal,4.5,false,"test-2").payload.qty,"4.5");
  assert.equal(planRuleOrder(sell,signal,"0.123456789",false,"test-2").payload.qty,"0.123456789");
  assert.equal(planRuleOrder(buy,signal,"0",false,"test-1").payload.notional,"100.00");
  assert.throws(()=>planRuleOrder(sell,signal,"-1",false,"test-2"),/invalid quantity/);
  assert.equal(planRuleOrder(sell,signal,0,false,"test-2").outcome,"no_position");
  assert.equal(planRuleOrder(sell,{triggered:false},4.5,false,"test-2").outcome,"condition_false");
});
