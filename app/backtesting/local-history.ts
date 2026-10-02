"use client";

import { compileHistoryRecord,historyKey,selectHistoryRange } from "../../lib/history-cache.mjs";

export type HistoricalBar={timestamp:string;open:number;high:number;low:number;close:number;volume:number};
export type HistorySource="local"|"alpaca"|"yahoo"|"upload";
export type CompiledHistory={
  key:string;symbol:string;timeframe:string;coverageStart:string;coverageEnd:string;updatedAt:string;bars:HistoricalBar[];
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

export async function saveCompiledHistory(input:{symbol:string;timeframe:string;coverageStart:string;coverageEnd:string;bars:unknown[]}):Promise<CompiledHistory>{
  const symbol=input.symbol.trim().toUpperCase(),key=historyKey(symbol,input.timeframe),existing=await readRecord(key);
  const compiled=compileHistoryRecord(input,existing);
  const record:CompiledHistory={key:compiled.key,symbol:compiled.symbol,timeframe:compiled.timeframe,coverageStart:compiled.coverageStart,coverageEnd:compiled.coverageEnd,updatedAt:compiled.updatedAt,bars:compiled.bars};
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
  return saveCompiledHistory({symbol,timeframe,coverageStart:start.toISOString(),coverageEnd:end.toISOString(),bars:preview.bars});
}

export async function loadCompiledHistory(symbol:string,timeframe:string,start:string,end:string){
  const record=await readRecord(historyKey(symbol,timeframe));
  const bars=selectHistoryRange(record,start,end);
  if(!record||!bars)return null;
  return{symbol:record.symbol,timeframe:record.timeframe,bars,source:"local" as const,provider:"indexeddb",warning:null,summary:{key:record.key,symbol:record.symbol,timeframe:record.timeframe,coverageStart:record.coverageStart,coverageEnd:record.coverageEnd,updatedAt:record.updatedAt,barCount:record.bars.length}};
}

export async function resolveHistoricalDataset(input:{symbol:string;timeframe:string;start:string;end:string;forceRefresh?:boolean}){
  if(!input.forceRefresh){const local=await loadCompiledHistory(input.symbol,input.timeframe,input.start,input.end);if(local)return local;}
  const response=await fetch("/api/history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
  const payload=await response.json() as {error?:string;symbol?:string;timeframe?:string;requestedStart?:string;requestedEnd?:string;coverageStart?:string;coverageEnd?:string;warning?:string|null;provider?:string;bars?:HistoricalBar[]};
  if(!response.ok||!payload.symbol||!payload.timeframe||!payload.bars)throw new Error(payload.error||"Historical compilation failed");
  const record=await saveCompiledHistory({symbol:payload.symbol,timeframe:payload.timeframe,coverageStart:payload.coverageStart??payload.requestedStart??input.start,coverageEnd:payload.coverageEnd??payload.requestedEnd??input.end,bars:payload.bars});
  const bars=record.bars.filter((bar)=>{const time=Date.parse(bar.timestamp);return time>=Date.parse(input.start)&&time<=Date.parse(input.end);});
  const source:HistorySource=payload.provider==="yahoo-chart"?"yahoo":"alpaca";
  return{symbol:record.symbol,timeframe:record.timeframe,bars,source,provider:payload.provider,warning:payload.warning,summary:{key:record.key,symbol:record.symbol,timeframe:record.timeframe,coverageStart:record.coverageStart,coverageEnd:record.coverageEnd,updatedAt:record.updatedAt,barCount:record.bars.length}};
}
