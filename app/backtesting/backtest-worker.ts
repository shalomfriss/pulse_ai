/// <reference lib="webworker" />

import { runBacktest } from "../../lib/backtesting.mjs";
import { optimizeDayTrading,runDayTradingBacktest } from "../../lib/daytrading.mjs";
import { runRuleSetBacktest } from "../../lib/rule-backtesting.mjs";

type WorkRequest={kind:"portfolio"|"daytrading"|"optimize-daytrading"|"rules";input:Record<string,unknown>};

self.onmessage=(event:MessageEvent<WorkRequest>)=>{
  try{
    const{kind,input}=event.data;
    const result=kind==="portfolio"?runBacktest(input):kind==="optimize-daytrading"?optimizeDayTrading(input):kind==="rules"?runRuleSetBacktest(input):runDayTradingBacktest(input);
    self.postMessage({ok:true,result});
  }catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:"Local backtest failed"});}
};

export{};
