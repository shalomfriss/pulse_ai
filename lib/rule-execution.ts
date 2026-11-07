import { fetchAlpacaHistory } from "./historical-data.mjs";
import { dueSlot,evaluateRule } from "./rule-evaluator.mjs";
import { planRuleOrder } from "./rule-order-plan.mjs";
import { alpacaTradingBaseUrl,getUserCredentials,type AccountProfile } from "../db/user-credentials";
import { claimRuleRun,finishRuleRun,listEnabledRuleSets } from "../db/rule-sets";

type RuleSet=Awaited<ReturnType<typeof listEnabledRuleSets>>[number];
type Position={symbol:string;qty:string};
type Order={symbol:string;status:string;side:string};

function retryableError(error:unknown){
  if(!(error instanceof Error)) return false;
  return ["TypeError","AbortError","TimeoutError"].includes(error.name)||/\((?:429|5\d\d)\)/.test(error.message);
}

function easternDate(value:string|Date){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value));
  const field=(type:string)=>parts.find((part)=>part.type===type)?.value??"";
  return `${field("year")}-${field("month")}-${field("day")}`;
}

async function alpacaJson(url:string,headers:Record<string,string>,init:RequestInit={}){
  const response=await fetch(url,{...init,signal:init.signal??AbortSignal.timeout(15_000),headers:{...headers,...init.headers}});
  const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok) throw new Error(`Alpaca request failed (${response.status}): ${String(payload.message??"").slice(0,180)}`);
  return payload;
}

async function findOrderByClientId(base:string,headers:Record<string,string>,clientOrderId:string){
  const url=`${base}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`;
  for(let attempt=0;attempt<3;attempt+=1){
    try{
      const response=await fetch(url,{headers,signal:AbortSignal.timeout(10_000)});
      if(response.ok){
        const order=await response.json() as {id?:string;client_order_id?:string};
        if(order.client_order_id!==clientOrderId) throw new Error("Broker returned a different client order ID");
        return order;
      }
      if(response.status!==404) throw new Error(`Order lookup failed (${response.status})`);
    }catch(error){
      if(attempt===2) throw error;
    }
    if(attempt<2) await new Promise((resolve)=>setTimeout(resolve,300*(attempt+1)));
  }
  return null;
}

async function executeSet(set:RuleSet,slot:string,now:Date,preview=false,orderIdVersion:"slot"|"date"="slot"){
  const credentials=await getUserCredentials(set.email,set.profile as AccountProfile);
  if(!credentials) throw new Error("Alpaca credentials are missing for this account profile");
  if(!preview&&!credentials.autoTrade) throw new Error("Auto trading is disabled or Alpaca credentials are missing");
  const base=alpacaTradingBaseUrl(set.profile as AccountProfile);
  const headers={"APCA-API-KEY-ID":credentials.keyId,"APCA-API-SECRET-KEY":credentials.secretKey};
  const clock=await alpacaJson(`${base}/v2/clock`,headers) as {is_open?:boolean};
  if(!clock.is_open&&!preview) return {skipped:"Alpaca market is closed",rules:[],failed:true,retryable:true};
  const today=easternDate(now);
  const [positions,orders]=await Promise.all([
    alpacaJson(`${base}/v2/positions`,headers) as unknown as Promise<Position[]>,
    alpacaJson(`${base}/v2/orders?status=open&limit=500`,headers) as unknown as Promise<Order[]>,
  ]);
  const positionBySymbol=new Map((positions as Position[]).map((item)=>[item.symbol,item.qty]));
  const pending=new Set((orders as Order[]).map((item)=>item.symbol));
  const start=new Date(now.getTime()-400*86_400_000).toISOString();
  const results=[];
  for(let index=0;index<set.spec.rules.length;index+=1){
    const rule=set.spec.rules[index];
    const slotKey=slot==="preview"?"preview":slot.slice(0,orderIdVersion==="slot"?16:10).replace(/\D/g,"");
    const clientOrderId=`pulse-r-${set.id.replaceAll("-","")}-${slotKey}-${String(index).padStart(2,"0")}`;
    try {
      const adjustment=rule.condition.type==="close_above"||rule.condition.type==="close_below"?"raw":"all";
      const history=await fetchAlpacaHistory({symbol:rule.symbol,timeframe:"1Day",start,end:new Date(now.getTime()-30*60_000).toISOString()},credentials,{maximumBars:500,feed:"sip",adjustment});
      const completed=history.bars.filter((bar:{timestamp:string})=>easternDate(bar.timestamp)<today);
      const signal=evaluateRule(rule,completed);
      const evidence={symbol:rule.symbol,action:rule.action,condition:rule.condition,priceAdjustment:adjustment,barDate:easternDate(completed.at(-1)!.timestamp),...signal};
      const quantity=positionBySymbol.get(rule.symbol)??"0";
      const plan=planRuleOrder(rule,signal,quantity,pending.has(rule.symbol),clientOrderId);
      if(plan.outcome!=="ready"){results.push({...evidence,outcome:plan.outcome});continue;}
      if(preview){
        const {client_order_id:unused,...plannedOrder}=plan.payload;
        void unused;
        results.push({...evidence,outcome:!clock.is_open?"market_closed":!credentials.autoTrade?"auto_trading_disabled":"would_submit",plannedOrder});
        continue;
      }
      let order:Record<string,unknown>;
      try {order=await alpacaJson(`${base}/v2/orders`,headers,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(plan.payload)});}
      catch(error){
        const recovered=await findOrderByClientId(base,headers,clientOrderId);
        if(!recovered) throw error;
        order=recovered;
      }
      pending.add(rule.symbol);
      results.push({...evidence,outcome:"submitted",orderId:order.id??null,clientOrderId});
    } catch(error){results.push({symbol:rule.symbol,action:rule.action,outcome:"error",clientOrderId,retryable:retryableError(error),error:error instanceof Error?error.message:String(error)});}
  }
  return {rules:results,failed:results.some((result)=>result.outcome==="error"),retryable:results.some((result)=>result.outcome==="error"&&result.retryable),...(preview?{asOf:now.toISOString(),marketOpen:Boolean(clock.is_open),autoTradeEnabled:credentials.autoTrade}:{})};
}

export async function previewRuleSet(set:RuleSet,now=new Date()){
  return executeSet(set,"preview",now,true);
}

export async function runDueRuleSets(now=new Date()){
  const sets=await listEnabledRuleSets();
  const results=[];
  for(const set of sets){
    const slot=dueSlot(set.spec,now);
    if(!slot) continue;
    const claim=await claimRuleRun(set.id,slot,set.spec);
    if(!claim) continue;
    try {
      const result=await executeSet(set,slot,now,false,claim.orderIdVersion);
      await finishRuleRun(claim.id,result.failed?(result.retryable?"retryable":"failed"):"completed",{...result,specSnapshot:set.spec,orderIdVersion:claim.orderIdVersion});
      results.push({ruleSetId:set.id,slot,...result});
    } catch(error){
      const message=error instanceof Error?error.message:String(error);
      const retryable=retryableError(error);
      await finishRuleRun(claim.id,retryable?"retryable":"failed",{error:message,retryable,specSnapshot:set.spec,orderIdVersion:claim.orderIdVersion});
      results.push({ruleSetId:set.id,slot,error:message,retryable});
    }
  }
  return results;
}
