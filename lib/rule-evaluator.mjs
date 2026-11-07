import { validateRuleSpec } from "./rule-spec.mjs";

const average=(values)=>values.reduce((sum,value)=>sum+value,0)/values.length;
const sma=(closes,period,end)=>average(closes.slice(end-period,end));

export function evaluateRule(rule,bars){
  if(!Array.isArray(bars)||!bars.length) throw new Error("At least one completed daily bar is required");
  const closes=bars.map((bar)=>Number(bar.close));
  if(closes.some((close)=>!Number.isFinite(close)||close<=0)) throw new Error("Daily bars contain an invalid close");
  const c=rule.condition,last=closes.at(-1),prior=closes.at(-2);
  if(c.type==="close_above") return {triggered:last>c.threshold,observed:{lastClose:last,threshold:c.threshold}};
  if(c.type==="close_below") return {triggered:last<c.threshold,observed:{lastClose:last,threshold:c.threshold}};
  if(closes.length<c.slow+1) throw new Error(`${c.slow+1} completed daily bars are required for the SMA crossover`);
  const fastBefore=sma(closes,c.fast,closes.length-1),slowBefore=sma(closes,c.slow,closes.length-1);
  const fastNow=sma(closes,c.fast,closes.length),slowNow=sma(closes,c.slow,closes.length);
  return {triggered:c.type==="sma_cross_above"?fastBefore<=slowBefore&&fastNow>slowNow:fastBefore>=slowBefore&&fastNow<slowNow,observed:{lastClose:last,priorClose:prior,fastBefore,slowBefore,fastNow,slowNow}};
}

export function dueSlot(spec,now=new Date()){
  const valid=validateRuleSpec(spec);
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const value=(type)=>parts.find((part)=>part.type===type)?.value??"";
  if(["Sat","Sun"].includes(value("weekday"))) return null;
  const minutes=Number(value("hour"))*60+Number(value("minute"));
  const scheduled=valid.schedule.hour*60+valid.schedule.minute;
  if(minutes<scheduled||minutes-scheduled>15) return null;
  return `${value("year")}-${value("month")}-${value("day")}T${String(valid.schedule.hour).padStart(2,"0")}:${String(valid.schedule.minute).padStart(2,"0")}:00[America/New_York]`;
}
