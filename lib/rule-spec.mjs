export const CONDITION_TYPES = ["close_above","close_below","sma_cross_above","sma_cross_below"];
export const ACTION_TYPES = ["buy","sell"];

export const RULE_SPEC_SCHEMA = {
  type:"object",additionalProperties:false,required:["name","unsupportedReason","schedule","rules"],
  properties:{
    name:{type:"string",description:"Short descriptive name for this rule set"},
    unsupportedReason:{type:"string",description:"Empty string if every requested behavior is representable; otherwise explain missing behavior and leave rules empty"},
    schedule:{type:"object",additionalProperties:false,required:["hour","minute"],properties:{
      hour:{type:"integer",description:"Hour in America/New_York, 0 through 23"},
      minute:{type:"integer",description:"Minute, 0 through 59"},
    }},
    rules:{type:"array",description:"Independent symbol rules, evaluated against the most recent completed daily bar",items:{
      type:"object",additionalProperties:false,required:["symbol","condition","action","notionalUsd"],
      properties:{
        symbol:{type:"string",description:"US stock or ETF ticker"},
        condition:{type:"object",additionalProperties:false,required:["type","threshold","fast","slow"],properties:{
          type:{type:"string",enum:CONDITION_TYPES},
          threshold:{type:"number",description:"Price threshold for close conditions; otherwise 0"},
          fast:{type:"integer",description:"Fast SMA period for crossover conditions; otherwise 0"},
          slow:{type:"integer",description:"Slow SMA period for crossover conditions; otherwise 0"},
        }},
        action:{type:"string",enum:ACTION_TYPES},
        notionalUsd:{type:"number",description:"USD amount for buy actions; 0 for sell actions"},
      },
    }},
  },
};

const exactKeys=(value,keys)=>Object.keys(value).length===keys.length&&keys.every((key)=>Object.hasOwn(value,key));
const object=(value)=>value!==null&&typeof value==="object"&&!Array.isArray(value);

export function validateRuleSpec(input) {
  if(!object(input)||!exactKeys(input,Object.hasOwn(input,"semanticsVersion")?["name","unsupportedReason","schedule","rules","semanticsVersion"]:["name","unsupportedReason","schedule","rules"])) throw new Error("Rule set has unsupported fields");
  if(Object.hasOwn(input,"semanticsVersion")&&input.semanticsVersion!==2) throw new Error("Rule set has an unsupported execution semantics version");
  if(typeof input.unsupportedReason!=="string") throw new Error("Rule set support status is invalid");
  if(input.unsupportedReason.trim()) throw new Error(`Cannot represent this request: ${input.unsupportedReason.trim().slice(0,300)}`);
  const name=String(input.name).trim();
  if(name.length<3||name.length>80) throw new Error("Rule set name must be 3–80 characters");
  const schedule=input.schedule;
  if(!object(schedule)||!exactKeys(schedule,["hour","minute"])||!Number.isInteger(schedule.hour)||schedule.hour<0||schedule.hour>23||!Number.isInteger(schedule.minute)||schedule.minute<0||schedule.minute>59) throw new Error("Schedule must have a valid New York hour and minute");
  const scheduleMinute=schedule.hour*60+schedule.minute;
  if(scheduleMinute<570||scheduleMinute>955) throw new Error("Scheduled trades must run between 9:30 AM and 3:55 PM New York time");
  if(!Array.isArray(input.rules)||input.rules.length<1||input.rules.length>20) throw new Error("Rule set must contain 1–20 rules");
  const rules=input.rules.map((rule,index)=>{
    if(!object(rule)||!exactKeys(rule,["symbol","condition","action","notionalUsd"])) throw new Error(`Rule ${index+1} has unsupported fields`);
    const symbol=String(rule.symbol).trim().toUpperCase();
    if(!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error(`Rule ${index+1} has an invalid symbol`);
    const c=rule.condition;
    if(!object(c)||!exactKeys(c,["type","threshold","fast","slow"])||!CONDITION_TYPES.includes(c.type)) throw new Error(`Rule ${index+1} has an unsupported condition`);
    if(!Number.isFinite(c.threshold)||!Number.isInteger(c.fast)||!Number.isInteger(c.slow)) throw new Error(`Rule ${index+1} has invalid condition values`);
    if(c.type.startsWith("close_") ? c.threshold<=0||c.fast!==0||c.slow!==0 : c.threshold!==0||c.fast<2||c.slow<3||c.fast>=c.slow||c.slow>200) throw new Error(`Rule ${index+1} has incompatible condition parameters`);
    if(!ACTION_TYPES.includes(rule.action)) throw new Error(`Rule ${index+1} has an unsupported action`);
    if(!Number.isFinite(rule.notionalUsd)||rule.action==="buy"&&(rule.notionalUsd<1||rule.notionalUsd>100_000)||rule.action==="sell"&&rule.notionalUsd!==0) throw new Error(`Rule ${index+1} has an invalid trade amount`);
    return {symbol,condition:{type:c.type,threshold:c.threshold,fast:c.fast,slow:c.slow},action:rule.action,notionalUsd:rule.notionalUsd};
  });
  return {name,unsupportedReason:"",schedule:{hour:schedule.hour,minute:schedule.minute},rules,...(input.semanticsVersion===2?{semanticsVersion:2}:{})};
}

export function ruleRequiresReview(spec){
  return spec.semanticsVersion!==2&&spec.rules.some((rule)=>rule.condition.type==="close_above"||rule.condition.type==="close_below");
}
