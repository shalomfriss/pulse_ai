"use client";

import { useEffect,useState } from "react";
import { resolveHistoricalDataset } from "./local-history";
import { runLocalBacktest } from "./local-backtest-runner";
import "./rule-sets.css";
import "./rule-backtest.css";

type Condition={type:string;threshold:number;fast:number;slow:number};
type Rule={symbol:string;condition:Condition;action:"buy"|"sell";notionalUsd:number};
type Spec={name:string;unsupportedReason:string;schedule:{hour:number;minute:number};rules:Rule[];semanticsVersion?:2};
type Saved={id:string;profile:"paper"|"live";name:string;prompt:string;spec:Spec;enabled:boolean;requiresReview:boolean;createdAt:string;updatedAt:string};
type Run={id:string;scheduledSlot:string;status:string;result:{error?:string;skipped?:string;rules?:{symbol:string;outcome:string;priceAdjustment?:"raw"|"all";error?:string;observed?:Record<string,number>;orderId?:string;clientOrderId?:string}[]};createdAt:string};
type Preview={asOf:string;marketOpen:boolean;autoTradeEnabled:boolean;failed:boolean;rules:{symbol:string;action:"buy"|"sell";outcome:string;triggered?:boolean;barDate?:string;priceAdjustment?:"raw"|"all";observed?:Record<string,number>;plannedOrder?:{symbol:string;side:string;notional?:string;qty?:string};error?:string}[]};
type SpeechResult={results:ArrayLike<ArrayLike<{transcript:string}>>};
type SpeechRecognizer={lang:string;interimResults:boolean;onresult:((event:SpeechResult)=>void)|null;onerror:(()=>void)|null;onend:(()=>void)|null;start:()=>void};
type SpeechWindow=Window&{SpeechRecognition?:new()=>SpeechRecognizer;webkitSpeechRecognition?:new()=>SpeechRecognizer};
type RuleBacktestResult={name:string;start:string;end:string;requestedStart:string;requestedEnd:string;symbols:string[];warnings:string[];metrics:{initialCapital:number;finalEquity:number;totalReturnPct:number;maxDrawdownPct:number;tradeCount:number;winRatePct:number;totalCosts:number;exposurePct:number};data:Record<string,{validRows:number;start:string;end:string}>;equityCurve:{date:string;equity:number}[];fills:{date:string;symbol:string;side:string;price:number;quantity:number;notional:number}[];trades:{symbol:string;entryDate:string;exitDate:string;pnl:number}[];openPositions:{symbol:string;quantity:number;lastClose:number}[]};

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await fetch(path,init);
  const payload=await response.json() as T&{error?:string};
  if(!response.ok) throw new Error(payload.error||`Request failed (${response.status})`);
  return payload;
}
const json=(value:unknown)=>JSON.stringify(value,null,2);
const conditionText=(c:Condition)=>c.type==="close_above"?`raw close > $${c.threshold}`:c.type==="close_below"?`raw close < $${c.threshold}`:`${c.fast}-day adjusted-close SMA crosses ${c.type==="sma_cross_above"?"above":"below"} ${c.slow}-day SMA`;

export default function RuleSetsPanel({start,end,capital,commission,slippage}:{start:string;end:string;capital:number;commission:number;slippage:number}){
  const [profile,setProfile]=useState<"paper"|"live">("paper");
  const [prompt,setPrompt]=useState("");
  const [draft,setDraft]=useState<Spec|null>(null);
  const [draftPrompt,setDraftPrompt]=useState("");
  const [saved,setSaved]=useState<Saved[]>([]);
  const [selected,setSelected]=useState<Saved|null>(null);
  const [runs,setRuns]=useState<Run[]>([]);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [listening,setListening]=useState(false);
  const [backtestResult,setBacktestResult]=useState<RuleBacktestResult|null>(null);
  const [backtestProgress,setBacktestProgress]=useState("");
  const [backtestWarnings,setBacktestWarnings]=useState<string[]>([]);

  useEffect(()=>{let active=true;api<{ruleSets:Saved[]}>(`/api/rule-sets?profile=${profile}`).then((value)=>{if(active){setSaved(value.ruleSets);setSelected(null);setRuns([]);setPreview(null);setBacktestResult(null);}}).catch((cause)=>{if(active)setError(cause.message);});return()=>{active=false;};},[profile]);

  async function refresh(){const value=await api<{ruleSets:Saved[]}>(`/api/rule-sets?profile=${profile}`);setSaved(value.ruleSets);return value.ruleSets;}
  async function parse(){setBusy(true);setError("");setNotice("");setDraft(null);setPreview(null);setBacktestResult(null);const source=prompt.trim();try{const value=await api<{spec:Spec}>("/api/rule-sets/parse",{method:"POST",headers:{"content-type":"application/json"},body:json({prompt:source})});setDraftPrompt(source);setDraft(value.spec);}catch(cause){setError(cause instanceof Error?cause.message:"Could not parse rules");}finally{setBusy(false);}}
  async function save(){if(!draft)return;setBusy(true);setError("");try{const value=await api<{ruleSet:Saved}>("/api/rule-sets",{method:"POST",headers:{"content-type":"application/json"},body:json({profile,prompt:draftPrompt,spec:draft})});await refresh();setSelected(value.ruleSet);setRuns([]);setDraft(null);setPreview(null);setNotice("Saved disabled. Inspect the rules, then enable scheduling when ready.");}catch(cause){setError(cause instanceof Error?cause.message:"Could not save rule set");}finally{setBusy(false);}}
  function reparseExisting(item:Saved){setPrompt(item.prompt);setDraft(null);setDraftPrompt("");setSelected(null);setPreview(null);setBacktestResult(null);setNotice("Original instructions loaded. Parse them again, inspect the new raw-price threshold, and save a new disabled set.");}
  async function choose(item:Saved){setBusy(true);setError("");setDraft(null);setPreview(null);setBacktestResult(null);try{const value=await api<{ruleSet:Saved;runs:Run[]}>(`/api/rule-sets?id=${encodeURIComponent(item.id)}`);setSelected(value.ruleSet);setRuns(value.runs);}catch(cause){setError(cause instanceof Error?cause.message:"Could not load rule set");}finally{setBusy(false);}}
  async function toggle(item:Saved){if(!item.enabled&&item.profile==="live"&&!window.confirm(`Enable live orders for “${item.name}”? Review every rule and ensure live auto trading is enabled in Settings.`))return;setBusy(true);setError("");try{const value=await api<{ruleSet:Saved}>("/api/rule-sets",{method:"PUT",headers:{"content-type":"application/json"},body:json({id:item.id,enabled:!item.enabled})});await refresh();setSelected(value.ruleSet);setPreview(null);setNotice(value.ruleSet.enabled?"Scheduled execution enabled.":"Scheduled execution paused.");}catch(cause){setError(cause instanceof Error?cause.message:"Could not update rule set");}finally{setBusy(false);}}
  async function remove(item:Saved){if(!window.confirm(`Delete “${item.name}” and its run history?`))return;setBusy(true);setError("");try{await api("/api/rule-sets?id="+encodeURIComponent(item.id),{method:"DELETE"});await refresh();if(selected?.id===item.id){setSelected(null);setRuns([]);setPreview(null);}setNotice("Rule set deleted.");}catch(cause){setError(cause instanceof Error?cause.message:"Could not delete rule set");}finally{setBusy(false);}}
  function dictate(){
    const Speech=(window as SpeechWindow).SpeechRecognition??(window as SpeechWindow).webkitSpeechRecognition;
    if(!Speech){setError("Voice dictation is unavailable in this browser. You can type the rule instead.");return;}
    const recognition=new Speech();recognition.lang="en-US";recognition.interimResults=false;
    recognition.onresult=(event)=>{const spoken=Array.from(event.results).map((result)=>result[0]?.transcript??"").join(" ").trim();if(spoken){setPrompt((current)=>`${current.trim()} ${spoken}`.trim());setDraft(null);setPreview(null);}};
    recognition.onerror=()=>setError("Voice dictation stopped before a rule was captured");
    recognition.onend=()=>setListening(false);
    try{recognition.start();setListening(true);setError("");}catch{setError("Could not start voice dictation");}
  }
  async function previewCurrent(item:Saved){
    setBusy(true);setError("");setPreview(null);
    try{const value=await api<{preview:Preview}>(`/api/rule-sets/preview?id=${encodeURIComponent(item.id)}`);setPreview(value.preview);}
    catch(cause){setError(cause instanceof Error?cause.message:"Could not preview current signals");}
    finally{setBusy(false);}
  }
  async function backtest(spec:Spec){
    setBusy(true);setError("");setBacktestResult(null);setBacktestProgress("");setBacktestWarnings([]);
    try{
      const preload=new Date(`${start}T00:00:00Z`);preload.setUTCDate(preload.getUTCDate()-400);
      const earliest=new Date(`${end}T00:00:00Z`);earliest.setUTCFullYear(earliest.getUTCFullYear()-20);earliest.setUTCDate(earliest.getUTCDate()-30);
      const loadStart=new Date(Math.max(preload.getTime(),earliest.getTime())).toISOString().slice(0,10);
      const symbols=[...new Set(spec.rules.map((rule)=>rule.symbol))],barsBySymbol:Record<string,unknown[]>={},warnings:string[]=[];
      for(let index=0;index<symbols.length;index+=1){
        const symbol=symbols[index];setBacktestProgress(`Loading ${symbol} (${index+1}/${symbols.length})…`);
        const dataset=await resolveHistoricalDataset({symbol,timeframe:"1Day",start:loadStart,end,forceRefresh:true});
        barsBySymbol[symbol]=dataset.bars;
        if(dataset.warning)warnings.push(dataset.warning);
      }
      setBacktestProgress("Simulating next-day orders…");
      const result=await runLocalBacktest<RuleBacktestResult>("rules",{spec,barsBySymbol,start,end,initialCapital:capital,commission,slippageBps:slippage});
      setBacktestResult(result);setBacktestWarnings([...warnings,...result.warnings]);setBacktestProgress("");
    }catch(cause){setBacktestProgress("");setError(cause instanceof Error?cause.message:"Rule backtest failed");}
    finally{setBusy(false);}
  }
  function downloadResult(){
    if(!backtestResult)return;
    const url=URL.createObjectURL(new Blob([json(backtestResult)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download=`rule-backtest-${backtestResult.start}-${backtestResult.end}.json`;link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1_000);
  }

  const shown=draft??selected?.spec??null;
  return <section className="rule-workspace" aria-label="Automated rule sets">
    <div className="rule-heading"><div><small>05 / AUTOMATED RULE SETS</small><h2>Describe. Inspect. Schedule.</h2><p>Describe daily stock rules in plain English. AI turns them into a fixed format; only the saved format is evaluated. New sets start disabled.</p></div><label>ACCOUNT PROFILE<select value={profile} onChange={(event)=>{setProfile(event.target.value as "paper"|"live");setDraft(null);setDraftPrompt("");setPreview(null);}}><option value="paper">Paper trading</option><option value="live">Live trading</option></select></label></div>
    <div className="rule-columns"><div className="rule-editor"><label htmlFor="rule-prompt">PLAIN ENGLISH INSTRUCTIONS</label><textarea id="rule-prompt" value={prompt} onChange={(event)=>{setPrompt(event.target.value);setDraft(null);setPreview(null);setBacktestResult(null);}} placeholder="Every weekday at 9:35 AM New York time, buy $100 of SPY if its last completed raw daily close is above $500. Sell SPY when its last completed raw daily close falls below $450." rows={6}/><button type="button" disabled={busy||prompt.trim().length<15} onClick={()=>void parse()}>{busy?"WORKING…":"PARSE WITH AI"}</button><button type="button" className="rule-dictate" disabled={listening} onClick={dictate}>{listening?"LISTENING…":"🎙 DICTATE"}</button><p className="rule-note">Instructions are sent to OpenAI for parsing. Fixed dollar thresholds use the last completed raw close. SMA crossings use split-and-dividend-adjusted daily closes. Each rule set has one daily schedule. Buy uses a fixed dollar amount. Sell closes the entire position for that symbol in the selected account. Orders require Alpaca credentials and auto trading enabled in Settings.</p>
      <h3>Saved rule sets</h3>{saved.length?<div className="rule-list">{saved.map((item)=><article key={item.id}><div><b>{item.name}</b><span>{item.profile.toUpperCase()} · {item.requiresReview?"REVIEW REQUIRED":item.enabled?"ENABLED":"DISABLED"} · {item.spec.rules.length} rule{item.spec.rules.length===1?"":"s"}</span></div><div><button type="button" disabled={busy} onClick={()=>void choose(item)}>INSPECT</button>{item.requiresReview?<button type="button" disabled={busy} onClick={()=>reparseExisting(item)}>REPARSE</button>:<button type="button" disabled={busy} onClick={()=>void toggle(item)}>{item.enabled?"PAUSE":"ENABLE"}</button>}<button type="button" disabled={busy} onClick={()=>void remove(item)}>DELETE</button></div></article>)}</div>:<p className="rule-empty">No saved rule sets for this account profile.</p>}
    </div><div className="rule-inspector">{shown?<><div className="rule-inspector-head"><small>{draft?"UNSAVED DRAFT":selected?.requiresReview?"REPARSE REQUIRED":selected?.enabled?"ENABLED RULE SET":"SAVED · DISABLED"}</small><h3>{shown.name}</h3><p>Weekdays at {String(shown.schedule.hour).padStart(2,"0")}:{String(shown.schedule.minute).padStart(2,"0")} New York time · {draft?profile:selected?.profile} account</p></div>{selected?.requiresReview&&<p className="rule-note">This older fixed-price set is paused because its price basis was previously described incorrectly. Use REPARSE in the saved list, inspect the new rule, and save a replacement before enabling it.</p>}<ol>{shown.rules.map((rule,index)=><li key={`${rule.symbol}-${index}`}><b>{rule.action.toUpperCase()} {rule.symbol}</b><span>When {conditionText(rule.condition)} on the last completed daily bar.</span><small>{rule.action==="buy"?`Buy $${rule.notionalUsd.toFixed(2)} of stock.`:"Sell the entire current position."}</small></li>)}</ol><details><summary>Inspect exact deterministic rule JSON</summary><pre>{json(shown)}</pre></details>{selected&&!draft&&<div className="rule-preview-controls"><button type="button" disabled={busy||selected.requiresReview} onClick={()=>void previewCurrent(selected)}>PREVIEW CURRENT DECISION</button><small>Read-only check of the latest completed daily bar, account position, open orders, and trading gates. No order is sent.</small></div>}{preview&&selected&&!draft&&<div className="rule-preview" aria-label="Current rule decision preview"><h4>Current decision preview</h4><p>As of {preview.asOf} · Market {preview.marketOpen?"open":"closed"} · Auto trading {preview.autoTradeEnabled?"enabled":"disabled"}</p>{preview.rules.map((entry,index)=><article key={`${entry.symbol}-${index}`}><b>{entry.action.toUpperCase()} {entry.symbol} · {entry.outcome.replaceAll("_"," ").toUpperCase()}</b>{entry.barDate&&<small>Completed bar: {entry.barDate}</small>}{entry.priceAdjustment&&<small>Price basis: {entry.priceAdjustment==="raw"?"raw as-traded close":"split-and-dividend-adjusted close"}</small>}{entry.plannedOrder&&<small>Planned order: {entry.plannedOrder.side.toUpperCase()} {entry.plannedOrder.symbol} {entry.plannedOrder.notional?`$${entry.plannedOrder.notional}`:`${entry.plannedOrder.qty} shares`}</small>}{entry.observed&&<pre>{json(entry.observed)}</pre>}{entry.error&&<small>{entry.error}</small>}</article>)}</div>}<div className="rule-backtest-controls"><button type="button" disabled={busy||Boolean(selected?.requiresReview&&!draft)} onClick={()=>void backtest(shown)}>RUN HISTORICAL RULE BACKTEST</button><small>Uses the date range, starting capital, commission, and slippage above. Starts flat and simulates this rule set in isolation; no broker orders are sent.</small>{backtestProgress&&<p role="status">{backtestProgress}</p>}</div>{draft&&<button className="rule-save" type="button" disabled={busy} onClick={()=>void save()}>SAVE DISABLED DRAFT</button>}{selected&&<div className="rule-run-log"><h4>Recent scheduled runs</h4>{runs.length?runs.map((run)=><article key={run.id}><b>{run.status.toUpperCase()} · {run.scheduledSlot}</b>{run.result.error&&<p>{run.result.error}</p>}{run.result.skipped&&<p>{run.result.skipped}</p>}{run.result.rules?.map((entry,index)=><p key={index}>{entry.symbol}: {entry.outcome}{entry.priceAdjustment?` · ${entry.priceAdjustment==="raw"?"raw close":"adjusted close"}`:""}{entry.error?` — ${entry.error}`:""}{entry.clientOrderId?` · ${entry.clientOrderId}`:""}</p>)}</article>):<p>No scheduled runs yet.</p>}</div>}</>:<div className="rule-inspector-empty"><b>Rule inspection</b><p>Parse instructions or select a saved set to see the schedule, conditions, trade actions, and exact JSON the engine will use.</p></div>}</div></div>
    {backtestResult&&<section className="rule-backtest-result" aria-label="Rule backtest results"><header><div><small>HISTORICAL RULE BACKTEST</small><h3>{backtestResult.name}</h3><p>{backtestResult.start} → {backtestResult.end} · {backtestResult.symbols.join(", ")}</p></div><button type="button" onClick={downloadResult}>EXPORT FULL RESULTS JSON</button></header><div className="rule-backtest-metrics"><article><small>FINAL EQUITY</small><b>${backtestResult.metrics.finalEquity.toFixed(2)}</b></article><article><small>TOTAL RETURN</small><b>{backtestResult.metrics.totalReturnPct.toFixed(2)}%</b></article><article><small>MAX DRAWDOWN</small><b>{backtestResult.metrics.maxDrawdownPct.toFixed(2)}%</b></article><article><small>CLOSED TRADES</small><b>{backtestResult.metrics.tradeCount}</b></article><article><small>OPEN POSITIONS</small><b>{backtestResult.openPositions.length}</b></article></div><RuleEquityChart curve={backtestResult.equityCurve}/>{backtestWarnings.length>0&&<div className="rule-backtest-warnings"><b>DATA COVERAGE NOTES</b>{backtestWarnings.map((warning,index)=><p key={index}>{warning}</p>)}</div>}<div className="rule-backtest-ledger"><h4>Fills · {backtestResult.fills.length}</h4>{backtestResult.fills.length?<div>{backtestResult.fills.slice(-200).reverse().map((fill,index)=><p key={`${fill.date}-${fill.symbol}-${index}`}><b>{fill.date}</b><span>{fill.side.toUpperCase()} {fill.symbol}</span><span>{fill.quantity.toFixed(4)} shares @ ${fill.price.toFixed(2)}</span></p>)}</div>:<p>No rules triggered an affordable fill in this period.</p>}{backtestResult.fills.length>200&&<small>Showing the 200 latest fills. Export JSON for the full ledger.</small>}</div></section>}
    {error&&<p className="rule-message rule-error" role="alert">{error}</p>}{notice&&<p className="rule-message" role="status">{notice}</p>}
  </section>;
}

function RuleEquityChart({curve}:{curve:{date:string;equity:number}[]}){
  const stride=Math.max(1,Math.ceil(curve.length/1000));
  const points=curve.filter((_,index)=>index%stride===0||index===curve.length-1);
  const values=points.map((point)=>point.equity),minimum=Math.min(...values),maximum=Math.max(...values),range=Math.max(1,maximum-minimum);
  const path=points.map((point,index)=>`${index?"L":"M"} ${20+index/Math.max(1,points.length-1)*760} ${180-(point.equity-minimum)/range*160}`).join(" ");
  return <svg className="rule-equity-chart" viewBox="0 0 800 200" role="img" aria-label="Rule set equity over time"><path d={path}/></svg>;
}
