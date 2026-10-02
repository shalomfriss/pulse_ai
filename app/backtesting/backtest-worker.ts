/// <reference lib="webworker" />

import { runBacktest } from "../../lib/backtesting.mjs";
import { optimizeDayTrading,runDayTradingBacktest } from "../../lib/daytrading.mjs";

type WorkRequest={kind:"portfolio"|"daytrading"|"optimize-daytrading";input:Record<string,unknown>};

self.onmessage=(event:MessageEvent<WorkRequest>)=>{
  try{
    const{kind,input}=event.data;
    const result=kind==="portfolio"?runBacktest(input):kind==="optimize-daytrading"?optimizeDayTrading(input):runDayTradingBacktest(input);
    self.postMessage({ok:true,result});
  }catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:"Local backtest failed"});}
};

export{};
