"use client";

import { compileHistoryRecord,historyKey,selectHistoryRange } from "../../lib/history-cache.mjs";
import { historyBoundary } from "../../lib/history-dates.mjs";

export type HistoricalBar={timestamp:string;open:number;high:number;low:number;close:number;volume:number};
export type HistorySource="local"|"alpaca"|"yahoo"|"configured"|"upload";
export type CompiledHistory={
  key:string;symbol:string;timeframe:string;coverageStart:string;coverageEnd:string;updatedAt:string;bars:HistoricalBar[];provider?:string;warning?:string|null;
};
export type HistorySummary=Omit<CompiledHistory,"bars">&{barCount:number};

const DATABASE="pulse-backtesting";
const STORE="compiled-history";
const VERSION=1;

function requestResult<T>(request:IDBRequest<T>){
  return new Promise<T>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??new Error("Local history operation failed"));});
}

function openDatabase(){
  if(typeof indexedDB==="undefined")throw new Error("This browser does not support local historical storage");
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,VERSION);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:"key"});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error??new Error("Could not open the local history library"));
  });
}

async function readRecord(key:string){
  const database=await openDatabase();
  try{return await requestResult(database.transaction(STORE,"readonly").objectStore(STORE).get(key)) as CompiledHistory|undefined;}
  finally{database.close();}
}

async function writeRecord(record:CompiledHistory){
  const database=await openDatabase();
  try{
    const transaction=database.transaction(STORE,"readwrite");
    transaction.objectStore(STORE).put(record);
    await new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error??new Error("Could not save local history"));transaction.onabort=()=>reject(transaction.error??new Error("Local history save was aborted"));});
  }finally{database.close();}
}

export async function getLocalHistorySummary(symbol:string,timeframe:string):Promise<HistorySummary|null>{
  const record=await readRecord(historyKey(symbol,timeframe));
  if(!record)return null;
  const{bars,...summary}=record;
  return{...summary,barCount:bars.length};
}

export async function saveCompiledHistory(input:{symbol:string;timeframe:string;coverageStart:string;coverageEnd:string;bars:unknown[];provider?:string;warning?:string|null}):Promise<CompiledHistory>{
  const symbol=input.symbol.trim().toUpperCase(),key=historyKey(symbol,input.timeframe),existing=await readRecord(key);
  const provider=input.provider??"uploaded-csv";
  // A configured archive is authoritative for each request. Merging an older
  // browser copy could restore bars the archive has since removed or corrected.
  const reusable=provider.startsWith("configured-source:")?null:existing?.provider===provider?existing:null;
  const compiled=compileHistoryRecord(input,reusable);
  const record:CompiledHistory={key:compiled.key,symbol:compiled.symbol,timeframe:compiled.timeframe,coverageStart:compiled.coverageStart,coverageEnd:compiled.coverageEnd,updatedAt:compiled.updatedAt,bars:compiled.bars,provider,warning:input.warning??null};
  await writeRecord(record);
  return record;
}

export async function importCompiledHistory(symbol:string,timeframe:string,bars:unknown[]){
  const timestamps=bars.map((bar)=>Date.parse((bar as HistoricalBar)?.timestamp)).filter(Number.isFinite);
  if(!timestamps.length)throw new Error("Imported history contains no valid timestamps");
  const bounds=timestamps.reduce((result,time)=>({minimum:Math.min(result.minimum,time),maximum:Math.max(result.maximum,time)}),{minimum:Infinity,maximum:-Infinity});
  const preview=compileHistoryRecord({symbol,timeframe,coverageStart:new Date(bounds.minimum).toISOString(),coverageEnd:new Date(bounds.maximum).toISOString(),bars});
  const start=new Date(preview.bars[0].timestamp);start.setUTCHours(0,0,0,0);
  const end=new Date(preview.bars.at(-1).timestamp);end.setUTCDate(end.getUTCDate()+1);end.setUTCHours(0,0,0,0);
  return saveCompiledHistory({symbol,timeframe,coverageStart:start.toISOString(),coverageEnd:end.toISOString(),bars:preview.bars,provider:"uploaded-csv",warning:"Uploaded CSV has no verified adjustment or security identity metadata."});
}

export async function loadCompiledHistory(symbol:string,timeframe:string,start:string,end:string){
  const record=await readRecord(historyKey(symbol,timeframe));
  const bars=selectHistoryRange(record,start,end);
  if(!record||!bars)return null;
  return{symbol:record.symbol,timeframe:record.timeframe,bars,source:"local" as const,provider:record.provider??"indexeddb-legacy",warning:record.warning===undefined?"Cached history has no verified security identity metadata; refresh it from a known source.":record.warning,summary:{key:record.key,symbol:record.symbol,timeframe:record.timeframe,coverageStart:record.coverageStart,coverageEnd:record.coverageEnd,updatedAt:record.updatedAt,barCount:record.bars.length}};
}

export async function resolveHistoricalDataset(input:{symbol:string;timeframe:string;start:string;end:string;forceRefresh?:boolean}){
  if(!input.forceRefresh){
    let sourceStatus:{configuredSource?:boolean;strictDaily?:boolean}|null=null;
    try{
      const statusResponse=await fetch("/api/history",{method:"GET"});
      if(statusResponse.status===401||statusResponse.status===403) throw new Error("Sign in required");
      if(statusResponse.ok) sourceStatus=await statusResponse.json() as {configuredSource?:boolean;strictDaily?:boolean};
    }catch(error){if(error instanceof Error&&error.message==="Sign in required")throw error;}
    if(!sourceStatus?.configuredSource&&!sourceStatus?.strictDaily){
      const local=await loadCompiledHistory(input.symbol,input.timeframe,input.start,input.end);
      if(local&&(!sourceStatus||!String(local.provider).startsWith("configured-source:"))) return sourceStatus?local:{...local,warning:[local.warning,"Active history source could not be verified; this browser cache may be stale."].filter(Boolean).join(" ")};
    }
  }
  const response=await fetch("/api/history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
  const payload=await response.json() as {error?:string;symbol?:string;timeframe?:string;requestedStart?:string;requestedEnd?:string;coverageStart?:string;coverageEnd?:string;warning?:string|null;provider?:string;archiveProvider?:string|null;sourceKey?:string;listingId?:string|null;bars?:HistoricalBar[]};
  if(!response.ok||!payload.symbol||!payload.timeframe||!payload.bars)throw new Error(payload.error||"Historical compilation failed");
  if(payload.listingId){
    // The browser library is keyed only by ticker. Caching one listing under
    // that key could merge two different companies when the ticker is reused.
    return{symbol:payload.symbol,timeframe:payload.timeframe,bars:payload.bars,source:"configured" as const,provider:payload.provider,warning:payload.warning,summary:{key:`${payload.symbol}:${payload.timeframe}:${payload.listingId}`,symbol:payload.symbol,timeframe:payload.timeframe,coverageStart:payload.coverageStart??input.start,coverageEnd:payload.coverageEnd??input.end,updatedAt:new Date().toISOString(),barCount:payload.bars.length}};
  }
  const provider=payload.provider==="configured-source"?`configured-source:${payload.sourceKey??"unknown"}:${payload.archiveProvider??"unknown"}`:payload.provider??"unknown";
  const warning=payload.provider==="configured-source"?"This archive does not verify security identity across ticker reuse.":"Ticker history does not verify security identity across ticker reuse.";
  const record=await saveCompiledHistory({symbol:payload.symbol,timeframe:payload.timeframe,coverageStart:payload.coverageStart??payload.requestedStart??input.start,coverageEnd:payload.coverageEnd??payload.requestedEnd??input.end,bars:payload.bars,provider,warning});
  const startTime=historyBoundary(input.start).getTime(),endTime=historyBoundary(input.end,true).getTime();
  const bars=record.bars.filter((bar)=>{const time=Date.parse(bar.timestamp);return time>=startTime&&time<=endTime;});
  const source:HistorySource=payload.provider==="configured-source"?"configured":payload.provider==="yahoo-chart"?"yahoo":"alpaca";
  const resultWarning=payload.warning?.includes("security identity")?payload.warning:[payload.warning,warning].filter(Boolean).join(" ");
  return{symbol:record.symbol,timeframe:record.timeframe,bars,source,provider:payload.provider,warning:resultWarning,summary:{key:record.key,symbol:record.symbol,timeframe:record.timeframe,coverageStart:record.coverageStart,coverageEnd:record.coverageEnd,updatedAt:record.updatedAt,barCount:record.bars.length}};
}
