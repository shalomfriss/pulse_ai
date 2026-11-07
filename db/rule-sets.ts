import { database } from "./database";
import type { AccountProfile } from "./user-credentials";
import { ruleRequiresReview,validateRuleSpec } from "../lib/rule-spec.mjs";

type RuleSetRow={id:string;user_email:string;account_profile:AccountProfile;name:string;prompt:string;spec_json:string;enabled:number;created_at:string;updated_at:string};

function owner(email:string){return email.trim().toLowerCase();}
function parse(row:RuleSetRow){const spec=validateRuleSpec(JSON.parse(row.spec_json)),requiresReview=ruleRequiresReview(spec);return {id:row.id,profile:row.account_profile,name:row.name,prompt:row.prompt,spec,enabled:Boolean(row.enabled)&&!requiresReview,requiresReview,createdAt:row.created_at,updatedAt:row.updated_at};}

export async function listRuleSets(email:string,profile:AccountProfile){
  const rows=await database().prepare("SELECT * FROM user_rule_sets WHERE user_email=?1 AND account_profile=?2 ORDER BY updated_at DESC").bind(owner(email),profile).all<RuleSetRow>();
  return rows.results.map(parse);
}

export async function getRuleSet(email:string,id:string){
  const row=await database().prepare("SELECT * FROM user_rule_sets WHERE user_email=?1 AND id=?2").bind(owner(email),id).first<RuleSetRow>();
  return row?parse(row):null;
}

export async function createRuleSet(email:string,profile:AccountProfile,prompt:string,input:unknown){
  const spec={...validateRuleSpec(input),semanticsVersion:2};
  if(prompt.length<15||prompt.length>3000) throw new Error("Source instructions must be 15–3,000 characters");
  const id=crypto.randomUUID(),now=new Date().toISOString();
  await database().prepare("INSERT INTO user_rule_sets (id,user_email,account_profile,name,prompt,spec_json,enabled,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,0,?7,?7)").bind(id,owner(email),profile,spec.name,prompt,JSON.stringify(spec),now).run();
  return getRuleSet(email,id);
}

export async function updateRuleSet(email:string,id:string,input:{enabled?:boolean;spec?:unknown}){
  const existing=await getRuleSet(email,id);
  if(!existing) throw new Error("Rule set not found");
  const spec=input.spec===undefined?existing.spec:validateRuleSpec(input.spec);
  const enabled=input.enabled===undefined?existing.enabled:input.enabled;
  if(typeof enabled!=="boolean") throw new Error("Enabled must be a boolean");
  if(enabled&&ruleRequiresReview(spec)) throw new Error("Reparse and inspect this rule set under the current price-basis rules before enabling it");
  if(input.spec!==undefined&&JSON.stringify(spec)!==JSON.stringify(existing.spec)&&enabled) throw new Error("Save rule changes disabled, inspect them, then enable");
  const now=new Date().toISOString();
  await database().prepare("UPDATE user_rule_sets SET name=?1,spec_json=?2,enabled=?3,updated_at=?4 WHERE id=?5 AND user_email=?6").bind(spec.name,JSON.stringify(spec),enabled?1:0,now,id,owner(email)).run();
  return getRuleSet(email,id);
}

export async function deleteRuleSet(email:string,id:string){
  const existing=await getRuleSet(email,id);
  if(!existing) throw new Error("Rule set not found");
  const db=database();
  await db.batch([db.prepare("DELETE FROM rule_runs WHERE rule_set_id=?1").bind(id),db.prepare("DELETE FROM user_rule_sets WHERE id=?1 AND user_email=?2").bind(id,owner(email))]);
}

export async function listEnabledRuleSets(){
  const rows=await database().prepare("SELECT * FROM user_rule_sets WHERE enabled=1 ORDER BY updated_at").all<RuleSetRow>();
  return rows.results.map((row)=>({...parse(row),email:row.user_email})).filter((row)=>!row.requiresReview);
}

export async function claimRuleRun(ruleSetId:string,scheduledSlot:string,spec:unknown){
  const snapshot=JSON.stringify(validateRuleSpec(spec));
  const id=crypto.randomUUID(),now=new Date().toISOString(),db=database();
  try {
    const inserted=await db.prepare("INSERT INTO rule_runs (id,rule_set_id,scheduled_slot,status,result_json,created_at,updated_at) SELECT ?1,id,?2,'running',?3,?4,?4 FROM user_rule_sets WHERE id=?5 AND enabled=1 AND spec_json=?6").bind(id,scheduledSlot,JSON.stringify({specSnapshot:JSON.parse(snapshot),orderIdVersion:"slot"}),now,ruleSetId,snapshot).run() as {meta?:{changes?:number}};
    if((inserted.meta?.changes??0)!==1) return null;
    return {id,orderIdVersion:"slot" as const};
  } catch(error) {
    if(/unique|duplicate/i.test(error instanceof Error?error.message:String(error))){
      const prior=await db.prepare("SELECT id,result_json FROM rule_runs WHERE rule_set_id=?1 AND scheduled_slot=?2").bind(ruleSetId,scheduledSlot).first<{id:string;result_json:string}>();
      if(!prior) return null;
      const priorResult=JSON.parse(prior.result_json);
      if(JSON.stringify(priorResult.specSnapshot)!==snapshot) return null;
      const cutoff=new Date(Date.now()-60_000).toISOString();
      const updated=await db.prepare("UPDATE rule_runs SET status='running',updated_at=?1 WHERE rule_set_id=?2 AND scheduled_slot=?3 AND status='retryable' AND updated_at<=?4 AND EXISTS (SELECT 1 FROM user_rule_sets WHERE id=?2 AND enabled=1 AND spec_json=?5)").bind(now,ruleSetId,scheduledSlot,cutoff,snapshot).run() as {meta?:{changes?:number}};
      if((updated.meta?.changes??0)!==1) return null;
      return {id:prior.id,orderIdVersion:priorResult.orderIdVersion==="slot"?"slot" as const:"date" as const};
    }
    throw error;
  }
}

export async function finishRuleRun(id:string,status:"completed"|"failed"|"retryable",result:unknown){
  await database().prepare("UPDATE rule_runs SET status=?1,result_json=?2,updated_at=?3 WHERE id=?4").bind(status,JSON.stringify(result),new Date().toISOString(),id).run();
}

export async function listRuleRuns(ruleSetId:string){
  const rows=await database().prepare("SELECT id,scheduled_slot,status,result_json,created_at,updated_at FROM rule_runs WHERE rule_set_id=?1 ORDER BY created_at DESC LIMIT 30").bind(ruleSetId).all<{id:string;scheduled_slot:string;status:string;result_json:string;created_at:string;updated_at:string}>();
  return rows.results.map((row)=>({id:row.id,scheduledSlot:row.scheduled_slot,status:row.status,result:JSON.parse(row.result_json),createdAt:row.created_at,updatedAt:row.updated_at}));
}
