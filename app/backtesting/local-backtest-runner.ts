"use client";

export type LocalBacktestKind="portfolio"|"daytrading"|"optimize-daytrading";

export function runLocalBacktest<T>(kind:LocalBacktestKind,input:Record<string,unknown>,signal?:AbortSignal){
  return new Promise<T>((resolve,reject)=>{
    const worker=new Worker(new URL("./backtest-worker.ts",import.meta.url),{type:"module",name:"pulse-backtesting"});
    const stop=()=>{worker.terminate();reject(new DOMException("The local backtest was cancelled","AbortError"));};
    if(signal?.aborted){stop();return;}
    signal?.addEventListener("abort",stop,{once:true});
    worker.onmessage=(event:MessageEvent<{ok:boolean;result?:T;error?:string}>)=>{
      signal?.removeEventListener("abort",stop);worker.terminate();
      if(event.data.ok&&event.data.result!==undefined)resolve(event.data.result);else reject(new Error(event.data.error||"Local backtest failed"));
    };
    worker.onerror=(event)=>{signal?.removeEventListener("abort",stop);worker.terminate();reject(new Error(event.message||"Local backtest worker failed"));};
    worker.postMessage({kind,input});
  });
}
