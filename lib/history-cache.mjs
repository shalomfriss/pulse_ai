import { compileBars } from "./backtesting.mjs";

export const LOCAL_HISTORY_MAX_BARS = 300_000;

export const historyKey = (symbol,timeframe) => `${String(symbol).trim().toUpperCase()}:${String(timeframe)}`;

function iso(value,label){
  const time=Date.parse(value);
  if(!Number.isFinite(time))throw new Error(`${label} must be a valid date`);
  return new Date(time).toISOString();
}

/** @param {any} input @param {any} [existing] */
export function compileHistoryRecord(input,existing=null){
  const symbol=String(input.symbol??"").trim().toUpperCase(),timeframe=String(input.timeframe??"");
  if(!symbol||!timeframe)throw new Error("Historical data requires a symbol and timeframe");
  const compiled=compileBars([...(existing?.bars??[]),...(input.bars??[])],LOCAL_HISTORY_MAX_BARS);
  const incomingStart=iso(input.coverageStart,"Coverage start"),incomingEnd=iso(input.coverageEnd,"Coverage end");
  if(Date.parse(incomingStart)>Date.parse(incomingEnd))throw new Error("Coverage start must not follow coverage end");
  return{
    key:historyKey(symbol,timeframe),symbol,timeframe,
    coverageStart:existing&&Date.parse(existing.coverageStart)<Date.parse(incomingStart)?existing.coverageStart:incomingStart,
    coverageEnd:existing&&Date.parse(existing.coverageEnd)>Date.parse(incomingEnd)?existing.coverageEnd:incomingEnd,
    updatedAt:new Date().toISOString(),bars:compiled.bars,report:compiled.report,
  };
}

export function selectHistoryRange(record,start,end){
  if(!record)return null;
  const startTime=Date.parse(start),endTime=Date.parse(end);
  if(!Number.isFinite(startTime)||!Number.isFinite(endTime)||startTime>=endTime)throw new Error("Choose a valid historical date range");
  if(Date.parse(record.coverageStart)>startTime||Date.parse(record.coverageEnd)<endTime)return null;
  const bars=record.bars.filter((bar)=>{const time=Date.parse(bar.timestamp);return time>=startTime&&time<=endTime;});
  return bars.length>=2?bars:null;
}
