import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";

const bundle=await build({
  entryPoints:[new URL("../db/rule-sets.ts",import.meta.url).pathname],bundle:true,write:false,platform:"node",format:"esm",
  plugins:[{name:"mock-database",setup(plugin){
    plugin.onResolve({filter:/^\.\/database$/},()=>({path:"database",namespace:"mock-review"}));
    plugin.onLoad({filter:/.*/,namespace:"mock-review"},()=>({contents:"export const database=()=>globalThis.__ruleReviewDb;",loader:"js"}));
  }}],
});
const {createRuleSet,getRuleSet,listEnabledRuleSets,updateRuleSet}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const condition=(type,threshold=0,fast=0,slow=0)=>({type,threshold,fast,slow});
const spec=(type)=>({name:`${type} rule`,unsupportedReason:"",schedule:{hour:10,minute:0},rules:[{symbol:"SPY",condition:type==="close_above"?condition(type,100):condition(type,0,2,3),action:"buy",notionalUsd:100}]});
const row=(id,value)=>({id,user_email:"user@example.com",account_profile:"paper",name:value.name,prompt:"Every weekday at 10, buy $100 of SPY when the rule triggers.",spec_json:JSON.stringify(value),enabled:1,created_at:"2026-10-01T00:00:00Z",updated_at:"2026-10-01T00:00:00Z"});

test("legacy threshold sets cannot run until re-parsed under the current price basis",async()=>{
  const rows=[row("old-close",spec("close_above")),row("old-sma",spec("sma_cross_above"))];
  globalThis.__ruleReviewDb={prepare(sql){
    let args=[];
    return{
      bind(...values){args=values;return this;},
      async all(){return{results:rows.filter((item)=>item.enabled)};},
      async first(){return rows.find((item)=>item.id===args[1]&&item.user_email===args[0])??null;},
      async run(){
        if(sql.startsWith("INSERT INTO user_rule_sets"))rows.push({id:args[0],user_email:args[1],account_profile:args[2],name:args[3],prompt:args[4],spec_json:args[5],enabled:0,created_at:args[6],updated_at:args[6]});
        else if(sql.startsWith("UPDATE user_rule_sets")){const item=rows.find((candidate)=>candidate.id===args[4]&&candidate.user_email===args[5]);Object.assign(item,{name:args[0],spec_json:args[1],enabled:args[2],updated_at:args[3]});}
        else throw new Error(`Unexpected SQL: ${sql}`);
        return{meta:{changes:1}};
      },
    };
  }};
  try{
    const legacy=await getRuleSet("user@example.com","old-close");
    assert.equal(legacy.requiresReview,true);
    assert.equal(legacy.enabled,false);
    assert.deepEqual((await listEnabledRuleSets()).map((item)=>item.id),["old-sma"]);
    await assert.rejects(updateRuleSet("user@example.com","old-close",{enabled:true}),/Reparse and inspect/);
    const replacement=await createRuleSet("user@example.com","paper",legacy.prompt,legacy.spec);
    assert.equal(replacement.spec.semanticsVersion,2);
    assert.equal(replacement.requiresReview,false);
    assert.equal(replacement.enabled,false);
    const enabled=await updateRuleSet("user@example.com",replacement.id,{enabled:true});
    assert.equal(enabled.enabled,true);
    assert.deepEqual((await listEnabledRuleSets()).map((item)=>item.id),["old-sma",replacement.id]);
  }finally{delete globalThis.__ruleReviewDb;}
});
