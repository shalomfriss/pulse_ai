import { compileBars } from "./backtesting.mjs";
import { validateRuleSpec } from "./rule-spec.mjs";

function number(value,name,min,max){
  const result=Number(value);
  if(!Number.isFinite(result)||result<min||result>max) throw new Error(`${name} must be between ${min} and ${max}`);
  return result;
}

function signalAt(rule,series,index){
  const c=rule.condition;
  if(index<1) return null;
  const lastClose=series.closes[index-1];
  const quotedClose=series.rawCloses[index-1],priceBasis="raw";
  if(c.type==="close_above") return {triggered:quotedClose>c.threshold,observed:{lastClose:quotedClose,threshold:c.threshold,priceBasis}};
  if(c.type==="close_below") return {triggered:quotedClose<c.threshold,observed:{lastClose:quotedClose,threshold:c.threshold,priceBasis}};
  if(index<c.slow+1) return null;
  const sma=(period,end)=>(series.prefix[end]-series.prefix[end-period])/period;
  const fastBefore=sma(c.fast,index-1),slowBefore=sma(c.slow,index-1),fastNow=sma(c.fast,index),slowNow=sma(c.slow,index);
  return {triggered:c.type==="sma_cross_above"?fastBefore<=slowBefore&&fastNow>slowNow:fastBefore>=slowBefore&&fastNow<slowNow,observed:{lastClose,fastBefore,slowBefore,fastNow,slowNow}};
}

export function runRuleSetBacktest(input){
  const spec=validateRuleSpec(input.spec);
  const initialCapital=number(input.initialCapital,"Starting capital",1,1_000_000_000);
  const commission=number(input.commission??0,"Commission",0,10_000);
  const slippageBps=number(input.slippageBps??0,"Slippage",0,1_000);
  const start=String(input.start??""),end=String(input.end??"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>=end) throw new Error("Choose a valid backtest date range");
  const symbols=[...new Set(spec.rules.map((rule)=>rule.symbol))];
  const seriesBySymbol=new Map(),events=new Map();
  for(const symbol of symbols){
    const raw=input.barsBySymbol?.[symbol];
    if(!raw) throw new Error(`Missing historical bars for ${symbol}`);
    const compiled=compileBars(raw);
    const bars=compiled.bars,closes=bars.map((bar)=>bar.close),rawCloses=bars.map((bar)=>bar.rawClose),prefix=[0];
    if(spec.rules.some((rule)=>rule.symbol===symbol&&(rule.condition.type==="close_above"||rule.condition.type==="close_below"))&&rawCloses.some((close)=>close===undefined))
      throw new Error(`${symbol} has daily bars without raw closes; fixed-dollar rule backtests require raw as-traded closes`);
    for(const close of closes) prefix.push(prefix.at(-1)+close);
    const series={bars,closes,rawCloses,prefix,report:compiled.report};
    seriesBySymbol.set(symbol,series);
    for(let index=0;index<bars.length;index+=1){
      const date=bars[index].timestamp.slice(0,10);
      if(!events.has(date)) events.set(date,[]);
      const existing=events.get(date);
      if(existing.some((item)=>item.symbol===symbol)) throw new Error(`Multiple daily bars for ${symbol} on ${date}`);
      existing.push({symbol,index,bar:bars[index]});
    }
  }
  const dates=[...events.keys()].sort();
  const lastClose=new Map(),positions=new Map(),equityCurve=[],fills=[],trades=[],warnings=[];
  let cash=initialCapital,peak=initialCapital,maxDrawdown=0,totalCosts=0,daysInvested=0;
  for(const date of dates){
    if(date>end) break;
    const daily=events.get(date),bySymbol=new Map(daily.map((item)=>[item.symbol,item]));
    if(date>=start){
      const tradedToday=new Set();
      for(const rule of spec.rules){
        const event=bySymbol.get(rule.symbol);
        if(!event||tradedToday.has(rule.symbol)) continue;
        const signal=signalAt(rule,seriesBySymbol.get(rule.symbol),event.index);
        if(!signal?.triggered) continue;
        const existing=positions.get(rule.symbol);
        if(rule.action==="buy"){
          if(existing||cash+1e-8<rule.notionalUsd+commission) continue;
          const price=event.bar.open*(1+slippageBps/10_000),quantity=rule.notionalUsd/price;
          if(!Number.isFinite(quantity)||quantity<=0) throw new Error("Trade quantity exceeds the safe numeric range");
          cash-=rule.notionalUsd+commission;
          positions.set(rule.symbol,{quantity,entryDate:date,entryPrice:price,entryCost:rule.notionalUsd+commission});
          totalCosts+=commission;tradedToday.add(rule.symbol);
          fills.push({date,symbol:rule.symbol,side:"buy",price,quantity,notional:rule.notionalUsd,commission,signal:signal.observed});
        }else{
          if(!existing) continue;
          const price=event.bar.open*(1-slippageBps/10_000);
          const proceeds=existing.quantity*price-commission;
          if(proceeds<0) throw new Error(`Commission exceeds ${rule.symbol} sale proceeds on ${date}`);
          cash+=proceeds;totalCosts+=commission;tradedToday.add(rule.symbol);
          positions.delete(rule.symbol);
          fills.push({date,symbol:rule.symbol,side:"sell",price,quantity:existing.quantity,notional:existing.quantity*price,commission,signal:signal.observed});
          trades.push({symbol:rule.symbol,entryDate:existing.entryDate,exitDate:date,entryPrice:existing.entryPrice,exitPrice:price,quantity:existing.quantity,pnl:proceeds-existing.entryCost});
        }
      }
    }
    for(const item of daily) lastClose.set(item.symbol,item.bar.close);
    if(date<start) continue;
    let equity=cash;
    for(const [symbol,position] of positions) equity+=position.quantity*(lastClose.get(symbol)??position.entryPrice);
    if(!Number.isFinite(equity)) throw new Error("Equity exceeds the safe numeric range");
    if(positions.size) daysInvested+=1;
    peak=Math.max(peak,equity);
    maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak);
    equityCurve.push({date,equity});
  }
  if(!equityCurve.length) throw new Error("No trading days exist in the requested range");
  for(const symbol of symbols){
    const report=seriesBySymbol.get(symbol).report;
    if(report.start.slice(0,10)>start) warnings.push(`${symbol} has no bars before ${report.start.slice(0,10)} in this dataset.`);
    if(report.end.slice(0,10)<end) warnings.push(`${symbol} has no bars after ${report.end.slice(0,10)} in this dataset.`);
    if(positions.has(symbol)&&Date.parse(`${end}T00:00:00Z`)-Date.parse(report.end)>7*86_400_000) throw new Error(`Cannot value an open ${symbol} position after its last available bar; a delisting outcome or newer data is required`);
  }
  const finalEquity=equityCurve.at(-1).equity,winners=trades.filter((trade)=>trade.pnl>0);
  const openPositions=[...positions].map(([symbol,position])=>({symbol,quantity:position.quantity,entryDate:position.entryDate,entryPrice:position.entryPrice,lastClose:lastClose.get(symbol)??position.entryPrice}));
  return {name:spec.name,start:equityCurve[0].date,end:equityCurve.at(-1).date,requestedStart:start,requestedEnd:end,symbols,warnings,
    metrics:{initialCapital,finalEquity,totalReturnPct:(finalEquity/initialCapital-1)*100,maxDrawdownPct:maxDrawdown*100,tradeCount:trades.length,winRatePct:trades.length?winners.length/trades.length*100:0,totalCosts,exposurePct:daysInvested/equityCurve.length*100},
    data:Object.fromEntries(symbols.map((symbol)=>[symbol,seriesBySymbol.get(symbol).report])),equityCurve,fills,trades,openPositions};
}
