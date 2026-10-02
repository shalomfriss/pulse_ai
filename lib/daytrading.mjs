import { compileBars } from "./backtesting.mjs";

export const MAX_INTRADAY_BARS = 300_000;
export const DAY_TRADING_ELEMENTS = [
  { id:"orb",family:"Breakout",name:"Opening-range breakout",description:"Buy a close above the session's opening range." },
  { id:"vwap",family:"Trend",name:"VWAP trend",description:"Require price to remain above session volume-weighted value." },
  { id:"ema",family:"Trend",name:"EMA trend",description:"Require the fast exponential average to remain above the slow average." },
  { id:"rsi",family:"Mean reversion",name:"RSI pullback",description:"Buy statistically compressed momentum and wait for it to normalize." },
  { id:"rvol",family:"Volume",name:"Relative volume",description:"Require participation above the same time-of-day baseline." },
  { id:"macd",family:"Momentum",name:"MACD crossover",description:"Buy when fast-versus-slow momentum crosses above its signal line." },
  { id:"bollinger",family:"Mean reversion",name:"Bollinger-band reversion",description:"Buy a close below the lower volatility band and target the mean." },
  { id:"stochastic",family:"Mean reversion",name:"Stochastic reversal",description:"Buy when the close sits near the bottom of its recent range." },
  { id:"vwapReversion",family:"Mean reversion",name:"VWAP mean reversion",description:"Buy a defined discount below VWAP and target session value." },
  { id:"donchian",family:"Breakout",name:"Donchian breakout",description:"Buy a close above the highest high of a rolling lookback." },
  { id:"atrExpansion",family:"Volatility",name:"ATR expansion",description:"Buy an upward bar whose true range expands beyond its recent norm." },
  { id:"previousHigh",family:"Prior session",name:"Previous-day high breakout",description:"Buy acceptance above the prior regular-session high." },
  { id:"gapGo",family:"Gap",name:"Gap-and-go",description:"Buy continuation after a meaningful gap up holds above the open." },
  { id:"gapFade",family:"Gap",name:"Gap-down reversal",description:"Buy recovery through the open after a meaningful gap down." },
  { id:"hodBreakout",family:"Breakout",name:"High-of-day breakout",description:"Buy a close above every earlier high in the current session." },
  { id:"momentum",family:"Momentum",name:"Multi-bar momentum",description:"Require an ordered run of rising closes with a minimum net advance." },
  { id:"trendPullback",family:"Trend",name:"EMA trend pullback",description:"Buy a test and recovery of the fast EMA inside a larger uptrend." },
  { id:"insideBar",family:"Breakout",name:"Inside-bar breakout",description:"Buy expansion above a compressed inside bar." },
  { id:"mfi",family:"Volume",name:"Money-flow pullback",description:"Buy when price-and-volume flow reaches an oversold reading." },
  { id:"obv",family:"Volume",name:"On-balance-volume trend",description:"Require cumulative signed volume to exceed its smoothed baseline." },
  { id:"efficiency",family:"Trend",name:"Trend efficiency",description:"Require net progress to be large relative to path noise." },
  { id:"volumeSpike",family:"Volume",name:"Volume-spike momentum",description:"Buy an upward bar with volume far above its recent average." },
  { id:"squeeze",family:"Volatility",name:"Volatility-squeeze breakout",description:"Buy an upside band break immediately after volatility compression." },
  { id:"pivotBounce",family:"Prior session",name:"Prior-pivot reclaim",description:"Buy a test and reclaim of the prior session's classic pivot." },
];

const allowedElements = new Set(DAY_TRADING_ELEMENTS.map((item) => item.id));
const easternParts = new Intl.DateTimeFormat("en-US",{
  timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23",
});
const round=(value,digits=4)=>Number(Number(value).toFixed(digits));
const average=(values)=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;
const median=(values)=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
const stdev=(values)=>{if(values.length<2)return 0;const mean=average(values);return Math.sqrt(average(values.map((value)=>(value-mean)**2)));};
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

function number(value,fallback,min,max,label){
  const parsed=Number(value??fallback);
  if(!Number.isFinite(parsed)||parsed<min||parsed>max) throw new Error(`${label} must be between ${min} and ${max}`);
  return parsed;
}

function marketStamp(timestamp){
  const parts=Object.fromEntries(easternParts.formatToParts(new Date(timestamp)).filter((part)=>part.type!=="literal").map((part)=>[part.type,part.value]));
  return { date:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute) };
}

function normalizeConfiguration(input={}){
  const elements=[...new Set(Array.isArray(input.elements)?input.elements.map(String):["orb","vwap","rvol"])].filter((item)=>allowedElements.has(item));
  if(!elements.length) throw new Error("Select at least one day-trading strategy element");
  return {
    elements,
    combine:input.combine==="any"?"any":"all",
    openingRangeBars:Math.round(number(input.openingRangeBars,2,1,12,"Opening range bars")),
    emaFast:Math.round(number(input.emaFast,8,2,100,"Fast EMA")),
    emaSlow:Math.round(number(input.emaSlow,21,3,250,"Slow EMA")),
    rsiPeriod:Math.round(number(input.rsiPeriod,14,2,100,"RSI period")),
    rsiEntry:number(input.rsiEntry,30,1,60,"RSI entry"),
    rsiExit:number(input.rsiExit,55,2,99,"RSI exit"),
    macdSignal:Math.round(number(input.macdSignal,9,2,100,"MACD signal")),
    bandPeriod:Math.round(number(input.bandPeriod,20,5,100,"Band period")),
    bandDeviation:number(input.bandDeviation,2,.25,5,"Band deviation"),
    stochasticPeriod:Math.round(number(input.stochasticPeriod,14,3,100,"Stochastic period")),
    stochasticEntry:number(input.stochasticEntry,20,1,60,"Stochastic entry"),
    stochasticExit:number(input.stochasticExit,60,2,99,"Stochastic exit"),
    atrPeriod:Math.round(number(input.atrPeriod,14,2,100,"ATR period")),
    atrMultiplier:number(input.atrMultiplier,1.3,.25,10,"ATR multiplier"),
    breakoutLookback:Math.round(number(input.breakoutLookback,20,2,100,"Breakout lookback")),
    gapThresholdPct:number(input.gapThresholdPct,.5,.05,20,"Gap threshold"),
    vwapDeviationPct:number(input.vwapDeviationPct,.4,.05,10,"VWAP deviation"),
    momentumBars:Math.round(number(input.momentumBars,3,2,12,"Momentum bars")),
    momentumThresholdPct:number(input.momentumThresholdPct,.25,.01,10,"Momentum threshold"),
    efficiencyThreshold:number(input.efficiencyThreshold,.35,.05,1,"Efficiency threshold"),
    relativeVolume:number(input.relativeVolume,1.35,.25,10,"Relative volume"),
    volumeLookback:Math.round(number(input.volumeLookback,20,2,100,"Volume lookback")),
    stopLossPct:number(input.stopLossPct,.7,.05,25,"Stop loss"),
    takeProfitPct:number(input.takeProfitPct,1.4,.05,50,"Take profit"),
    trailingStopPct:number(input.trailingStopPct,.6,0,25,"Trailing stop"),
    maxHoldBars:Math.round(number(input.maxHoldBars,16,1,200,"Maximum holding bars")),
    exitOnSignalLoss:input.exitOnSignalLoss!==false,
    sessionStart:Math.round(number(input.sessionStart,570,0,1439,"Session start")),
    sessionEnd:Math.round(number(input.sessionEnd,960,1,1440,"Session end")),
  };
}

function prepareBars(input){
  const compiled=compileBars(input,MAX_INTRADAY_BARS);
  const bars=compiled.bars.map((bar)=>({ ...bar,...marketStamp(bar.timestamp) })).filter((bar)=>bar.minute>=570&&bar.minute<=960);
  if(bars.length<2) throw new Error("No regular-session intraday bars were found");
  return { bars,report:{ ...compiled.report,validRows:bars.length,sessionFiltered:compiled.bars.length-bars.length,start:bars[0].timestamp,end:bars.at(-1).timestamp } };
}

function indicatorRows(bars,config){
  const rows=Array(bars.length);
  const priorSlotVolumes=new Map();
  let currentDate="";
  let sessionBars=[];
  let cumulativePriceVolume=0;
  let cumulativeVolume=0;
  let emaFast=null;
  let emaSlow=null;
  let macdSignal=null;
  let priorMacd=null;
  let priorMacdSignal=null;
  let obv=0;
  let obvAverage=null;
  let previousClose=null;
  let previousSession=null;
  let sessionSummary=null;
  let priorSqueeze=false;
  const fastAlpha=2/(config.emaFast+1),slowAlpha=2/(config.emaSlow+1);
  const macdAlpha=2/(config.macdSignal+1),obvAlpha=2/(config.bandPeriod+1);
  const closes=[],highs=[],lows=[],trueRanges=[],typicalPrices=[],moneyFlows=[],volumes=[],bandwidths=[];
  for(let index=0;index<bars.length;index+=1){
    const bar=bars[index];
    if(bar.date!==currentDate){
      if(sessionSummary)previousSession=sessionSummary;
      currentDate=bar.date;sessionBars=[];cumulativePriceVolume=0;cumulativeVolume=0;
      priorSqueeze=false;
      sessionSummary={open:bar.open,high:bar.high,low:bar.low,close:bar.close};
    }else{sessionSummary.high=Math.max(sessionSummary.high,bar.high);sessionSummary.low=Math.min(sessionSummary.low,bar.low);sessionSummary.close=bar.close;}
    const sessionIndex=sessionBars.length;
    const priorSessionHigh=sessionBars.length?Math.max(...sessionBars.map((item)=>item.high)):null;
    sessionBars.push(bar);
    const typical=(bar.high+bar.low+bar.close)/3;
    cumulativePriceVolume+=typical*bar.volume;cumulativeVolume+=bar.volume;
    const vwap=cumulativeVolume?cumulativePriceVolume/cumulativeVolume:bar.close;
    emaFast=emaFast===null?bar.close:bar.close*fastAlpha+emaFast*(1-fastAlpha);
    emaSlow=emaSlow===null?bar.close:bar.close*slowAlpha+emaSlow*(1-slowAlpha);
    const macd=emaFast-emaSlow;
    macdSignal=macdSignal===null?macd:macd*macdAlpha+macdSignal*(1-macdAlpha);
    const trueRange=previousClose===null?bar.high-bar.low:Math.max(bar.high-bar.low,Math.abs(bar.high-previousClose),Math.abs(bar.low-previousClose));
    if(previousClose!==null)obv+=bar.close>previousClose?bar.volume:bar.close<previousClose?-bar.volume:0;
    obvAverage=obvAverage===null?obv:obv*obvAlpha+obvAverage*(1-obvAlpha);
    closes.push(bar.close);highs.push(bar.high);lows.push(bar.low);trueRanges.push(trueRange);volumes.push(bar.volume);
    const rawMoneyFlow=typical*bar.volume,priorTypical=typicalPrices.at(-1);
    typicalPrices.push(typical);moneyFlows.push({positive:priorTypical!==undefined&&typical>priorTypical?rawMoneyFlow:0,negative:priorTypical!==undefined&&typical<priorTypical?rawMoneyFlow:0});
    let rsi=50;
    if(closes.length>config.rsiPeriod){
      let gains=0,losses=0;
      for(let offset=closes.length-config.rsiPeriod;offset<closes.length;offset+=1){const change=closes[offset]-closes[offset-1];if(change>=0)gains+=change;else losses-=change;}
      const averageGain=gains/config.rsiPeriod,averageLoss=losses/config.rsiPeriod;
      rsi=averageLoss===0?100:100-100/(1+averageGain/averageLoss);
    }
    const slotVolumes=priorSlotVolumes.get(sessionIndex)??[];
    const volumeBaseline=average(slotVolumes.slice(-config.volumeLookback));
    slotVolumes.push(bar.volume);priorSlotVolumes.set(sessionIndex,slotVolumes);
    const openingBars=sessionBars.slice(0,config.openingRangeBars);
    const openingHigh=Math.max(...openingBars.map((item)=>item.high));
    const openingLow=Math.min(...openingBars.map((item)=>item.low));
    const ready=sessionIndex>=config.openingRangeBars;
    const bandCloses=closes.slice(-config.bandPeriod),bandMean=average(bandCloses),bandStd=stdev(bandCloses),bandUpper=bandMean+config.bandDeviation*bandStd,bandLower=bandMean-config.bandDeviation*bandStd;
    const bandwidth=bandMean?((bandUpper-bandLower)/bandMean):0,bandwidthBaseline=average(bandwidths.slice(-config.bandPeriod));
    bandwidths.push(bandwidth);
    const stochasticHigh=Math.max(...highs.slice(-config.stochasticPeriod)),stochasticLow=Math.min(...lows.slice(-config.stochasticPeriod));
    const stochastic=stochasticHigh===stochasticLow?50:(bar.close-stochasticLow)/(stochasticHigh-stochasticLow)*100;
    const atr=average(trueRanges.slice(-config.atrPeriod));
    const priorHighs=highs.slice(Math.max(0,highs.length-config.breakoutLookback-1),-1),priorLows=lows.slice(Math.max(0,lows.length-config.breakoutLookback-1),-1);
    const donchianHigh=priorHighs.length?Math.max(...priorHighs):Infinity,donchianLow=priorLows.length?Math.min(...priorLows):-Infinity;
    const momentumStart=closes.at(-1-config.momentumBars),momentumPct=momentumStart?((bar.close/momentumStart)-1)*100:0;
    const momentumWindow=closes.slice(-config.momentumBars-1),orderedMomentum=momentumWindow.length===config.momentumBars+1&&momentumWindow.every((value,offset)=>offset===0||value>momentumWindow[offset-1]);
    const efficiencyWindow=closes.slice(-config.breakoutLookback-1),efficiencyTravel=efficiencyWindow.slice(1).reduce((total,value,offset)=>total+Math.abs(value-efficiencyWindow[offset]),0),efficiency=efficiencyWindow.length===config.breakoutLookback+1&&efficiencyTravel?Math.abs(efficiencyWindow.at(-1)-efficiencyWindow[0])/efficiencyTravel:0;
    const flowWindow=moneyFlows.slice(-config.stochasticPeriod),positiveFlow=sum(flowWindow,"positive"),negativeFlow=sum(flowWindow,"negative"),mfi=negativeFlow===0?100:100-100/(1+positiveFlow/negativeFlow);
    const rollingVolume=average(volumes.slice(Math.max(0,volumes.length-config.volumeLookback-1),-1));
    const gapPct=previousSession?((sessionSummary.open/previousSession.close)-1)*100:0;
    const pivot=previousSession?(previousSession.high+previousSession.low+previousSession.close)/3:null;
    const previousBar=bars[index-1],motherBar=bars[index-2],insideBreakout=Boolean(previousBar&&motherBar&&previousBar.date===bar.date&&motherBar.date===bar.date&&previousBar.high<motherBar.high&&previousBar.low>motherBar.low&&bar.close>previousBar.high);
    const priorSqueezeValue=priorSqueeze;
    priorSqueeze=bandCloses.length===config.bandPeriod&&bandwidthBaseline>0&&bandwidth<bandwidthBaseline*.7;
    const macdCross=priorMacd!==null&&priorMacdSignal!==null&&priorMacd<=priorMacdSignal&&macd>macdSignal;
    const entry={
      orb:ready&&bar.close>openingHigh,
      vwap:bar.close>vwap,
      ema:emaFast>emaSlow,
      rsi:closes.length>config.rsiPeriod&&rsi<=config.rsiEntry,
      rvol:volumeBaseline>0&&bar.volume/volumeBaseline>=config.relativeVolume,
      macd:macdCross,
      bollinger:bandCloses.length===config.bandPeriod&&bar.close<bandLower,
      stochastic:closes.length>=config.stochasticPeriod&&stochastic<=config.stochasticEntry,
      vwapReversion:bar.close<=vwap*(1-config.vwapDeviationPct/100),
      donchian:priorHighs.length===config.breakoutLookback&&bar.close>donchianHigh,
      atrExpansion:trueRanges.length>=config.atrPeriod&&trueRange>=atr*config.atrMultiplier&&bar.close>bar.open,
      previousHigh:Boolean(previousSession&&bar.close>previousSession.high),
      gapGo:Boolean(previousSession&&gapPct>=config.gapThresholdPct&&bar.close>sessionSummary.open&&bar.close>vwap),
      gapFade:Boolean(previousSession&&gapPct<=-config.gapThresholdPct&&bar.close>sessionSummary.open),
      hodBreakout:ready&&priorSessionHigh!==null&&bar.close>priorSessionHigh,
      momentum:orderedMomentum&&momentumPct>=config.momentumThresholdPct,
      trendPullback:emaFast>emaSlow&&bar.low<=emaFast&&bar.close>=emaFast,
      insideBar:insideBreakout,
      mfi:flowWindow.length===config.stochasticPeriod&&mfi<=config.stochasticEntry,
      obv:obv>obvAverage,
      efficiency:efficiency>=config.efficiencyThreshold&&efficiencyWindow.at(-1)>efficiencyWindow[0],
      volumeSpike:rollingVolume>0&&bar.volume/rollingVolume>=config.relativeVolume&&bar.close>bar.open,
      squeeze:priorSqueezeValue&&bar.close>bandUpper,
      pivotBounce:Boolean(pivot!==null&&bar.low<=pivot&&bar.close>pivot),
    };
    const hold={
      orb:ready&&bar.close>openingLow,vwap:bar.close>=vwap,ema:emaFast>=emaSlow,rsi:rsi<config.rsiExit,rvol:true,
      macd:macd>=macdSignal,bollinger:bar.close<bandMean,stochastic:stochastic<config.stochasticExit,vwapReversion:bar.close<vwap,
      donchian:bar.close>donchianLow,atrExpansion:true,previousHigh:Boolean(previousSession&&bar.close>previousSession.close),gapGo:bar.close>=sessionSummary.open,
      gapFade:pivot===null||bar.close<pivot,hodBreakout:bar.close>=openingLow,momentum:bar.close>=emaFast,trendPullback:bar.close>=emaSlow,
      insideBar:bar.close>=previousBar?.low,mfi:mfi<config.stochasticExit,obv:obv>=obvAverage,efficiency:bar.close>=emaFast,volumeSpike:true,
      squeeze:bar.close>=bandMean,pivotBounce:pivot===null||bar.close>=pivot,
    };
    const entryVotes=config.elements.map((element)=>entry[element]);
    const holdVotes=config.elements.map((element)=>hold[element]);
    rows[index]={
      entry:config.combine==="all"?entryVotes.every(Boolean):entryVotes.some(Boolean),
      hold:config.combine==="all"?holdVotes.every(Boolean):holdVotes.some(Boolean),
      diagnostics:{ vwap:round(vwap),rsi:round(rsi,2),macd:round(macd),stochastic:round(stochastic,2),mfi:round(mfi,2),atr:round(atr),efficiency:round(efficiency,3),relativeVolume:round(volumeBaseline?bar.volume/volumeBaseline:0,2),openingHigh:round(openingHigh),openingLow:round(openingLow) },
    };
    priorMacd=macd;priorMacdSignal=macdSignal;previousClose=bar.close;
  }
  return rows;
}

export function runDayTradingBacktest(input){
  const { bars,report }=prepareBars(input.bars);
  const config=normalizeConfiguration(input.configuration);
  if(config.emaFast>=config.emaSlow) throw new Error("Fast EMA must be less than slow EMA");
  if(config.rsiEntry>=config.rsiExit) throw new Error("RSI entry must be less than RSI exit");
  if(config.sessionStart>=config.sessionEnd) throw new Error("Session start must be before session end");
  const sessionBars=bars.filter((bar)=>bar.minute>=config.sessionStart&&bar.minute<=config.sessionEnd);
  if(sessionBars.length<2) throw new Error("The selected session window contains fewer than two bars");
  const indicators=indicatorRows(sessionBars,config);
  const initialCapital=number(input.initialCapital,25_000,1,1e12,"Initial capital");
  const commission=number(input.commission,0,0,initialCapital-.000001,"Commission");
  const slippageBps=number(input.slippageBps,3,0,1000,"Slippage");
  let cash=initialCapital,quantity=0,entry=null,pendingEntry=false,pendingExit=false,peak=initialCapital,maxDrawdown=0,investedBars=0,fillCount=0;
  const trades=[],equityCurve=[],dailyReturns=[];
  let dayStartEquity=initialCapital,currentDate=sessionBars[0].date;
  const sell=(bar,rawPrice,reason,index)=>{
    const price=rawPrice*(1-slippageBps/10_000),proceeds=Math.max(0,quantity*price-commission),invested=entry.quantity*entry.price+entry.commission,pnl=proceeds-invested;
    cash+=proceeds;fillCount+=1;trades.push({ entryTime:entry.time,exitTime:bar.timestamp,entryPrice:round(entry.price),exitPrice:round(price),quantity:round(quantity,6),pnl:round(pnl),returnPct:round(pnl/invested*100),barsHeld:index-entry.index,reason });
    quantity=0;entry=null;pendingExit=false;
  };
  for(let index=0;index<sessionBars.length;index+=1){
    const bar=sessionBars[index],next=sessionBars[index+1],isLastOfDay=!next||next.date!==bar.date;
    if(bar.date!==currentDate){currentDate=bar.date;dayStartEquity=cash;pendingEntry=false;pendingExit=false;}
    if(quantity>0&&pendingExit) sell(bar,bar.open,"signal",index);
    if(quantity===0&&pendingEntry){
      const price=bar.open*(1+slippageBps/10_000),available=Math.max(0,cash-commission);
      quantity=available/price;cash-=quantity*price+commission;fillCount+=1;entry={ time:bar.timestamp,price,quantity,commission,index,highest:price };pendingEntry=false;
    }
    if(quantity>0){
      investedBars+=1;
      const stopPrice=entry.price*(1-config.stopLossPct/100);
      const trailingPrice=entry.highest*(1-config.trailingStopPct/100);
      const takePrice=entry.price*(1+config.takeProfitPct/100);
      if(bar.low<=stopPrice) sell(bar,stopPrice,"stop loss",index);
      else if(quantity>0&&config.trailingStopPct>0&&bar.low<=trailingPrice) sell(bar,trailingPrice,"trailing stop",index);
      else if(quantity>0&&bar.high>=takePrice) sell(bar,takePrice,"take profit",index);
      else if(quantity>0&&entry&&index-entry.index>=config.maxHoldBars) sell(bar,bar.close,"maximum hold",index);
      if(quantity>0&&entry) entry.highest=Math.max(entry.highest,bar.high);
    }
    if(isLastOfDay&&quantity>0) sell(bar,bar.close,"session close",index);
    const equity=cash+quantity*bar.close;
    peak=Math.max(peak,equity);maxDrawdown=Math.min(maxDrawdown,equity/peak-1);
    equityCurve.push({ timestamp:bar.timestamp,equity:round(equity) });
    if(isLastOfDay){dailyReturns.push({ date:bar.date,returnPct:round((equity/dayStartEquity-1)*100) });dayStartEquity=equity;}
    if(!isLastOfDay){
      if(quantity===0&&indicators[index].entry) pendingEntry=true;
      else if(quantity>0&&config.exitOnSignalLoss&&!indicators[index].hold) pendingExit=true;
    } else { pendingEntry=false;pendingExit=false; }
  }
  const returns=dailyReturns.map((item)=>item.returnPct/100),winners=trades.filter((trade)=>trade.pnl>0),losses=trades.filter((trade)=>trade.pnl<0);
  const totalReturn=cash/initialCapital-1,elapsedDays=Math.max(1,(Date.parse(sessionBars.at(-1).timestamp)-Date.parse(sessionBars[0].timestamp))/86_400_000);
  const annualized=totalReturn<=-1?-1:(1+totalReturn)**(365.25/elapsedDays)-1;
  const volatility=stdev(returns)*Math.sqrt(252),dailyStd=stdev(returns);
  const buyHold=(sessionBars.at(-1).close/sessionBars[0].open-1)*100;
  return {
    configuration:config,
    metrics:{
      initialCapital:round(initialCapital,2),finalEquity:round(cash,2),totalReturnPct:round(totalReturn*100),annualizedReturnPct:round(annualized*100),buyHoldReturnPct:round(buyHold),
      averageDailyReturnPct:round(average(returns)*100),medianDailyReturnPct:round(median(returns)*100),profitableDayPct:round(returns.length?returns.filter((value)=>value>0).length/returns.length*100:0),
      maxDrawdownPct:round(maxDrawdown*100),sharpeRatio:volatility?round(average(returns)*252/volatility):0,downsideDeviationPct:round(Math.sqrt(average(returns.filter((value)=>value<0).map((value)=>value**2)))*100),
      tradeCount:trades.length,winRatePct:round(trades.length?winners.length/trades.length*100:0),profitFactor:round(losses.length?sum(winners,"pnl")/Math.abs(sum(losses,"pnl")):winners.length?999:0),
      exposurePct:round(investedBars/sessionBars.length*100),totalCosts:round(fillCount*commission,2),tradingDays:dailyReturns.length,
    },
    data:{ ...report,validRows:sessionBars.length,sessionFiltered:report.sessionFiltered+(bars.length-sessionBars.length),start:sessionBars[0].timestamp,end:sessionBars.at(-1).timestamp },
    equityCurve,dailyReturns,trades,
  };
}

function sum(items,key){return items.reduce((total,item)=>total+item[key],0);}
function score(metrics){if(metrics.tradeCount<5)return-1e9;return metrics.annualizedReturnPct*.2+metrics.sharpeRatio*12+metrics.maxDrawdownPct*.7+metrics.profitableDayPct*.08;}

function candidateConfigurations(){
  const standalone=DAY_TRADING_ELEMENTS.map(({id})=>[id]);
  const confirmations=[["orb","rvol"],["orb","vwap"],["orb","volumeSpike"],["donchian","atrExpansion"],["previousHigh","rvol"],["gapGo","volumeSpike"],["hodBreakout","vwap","rvol"],["momentum","ema"],["macd","vwap"],["trendPullback","ema"],["squeeze","atrExpansion"],["obv","ema"],["efficiency","ema"],["rsi","vwapReversion"],["bollinger","rsi"],["stochastic","vwapReversion"],["gapFade","vwapReversion"],["pivotBounce","rsi"],["mfi","bollinger"]];
  const elementSets=[...standalone,...confirmations];
  const risks=[
    { stopLossPct:.45,takeProfitPct:.9,trailingStopPct:.35,maxHoldBars:8 },
    { stopLossPct:.7,takeProfitPct:1.4,trailingStopPct:.6,maxHoldBars:16 },
    { stopLossPct:1,takeProfitPct:2,trailingStopPct:.8,maxHoldBars:26 },
  ];
  return elementSets.flatMap((elements,index)=>risks.map((risk,riskIndex)=>({
    elements,combine:"all",openingRangeBars:[1,2,3][riskIndex],emaFast:riskIndex===2?12:8,emaSlow:riskIndex===2?26:21,
    rsiPeriod:14,rsiEntry:riskIndex===0?25:30,rsiExit:riskIndex===2?60:55,macdSignal:9,bandPeriod:20,bandDeviation:riskIndex===0?1.5:2,stochasticPeriod:14,stochasticEntry:riskIndex===0?15:20,stochasticExit:60,atrPeriod:14,atrMultiplier:riskIndex===0?1.1:riskIndex===1?1.3:1.6,breakoutLookback:riskIndex===2?30:20,gapThresholdPct:riskIndex===0?.3:riskIndex===1?.5:1,vwapDeviationPct:riskIndex===0?.25:riskIndex===1?.4:.7,momentumBars:riskIndex===2?5:3,momentumThresholdPct:riskIndex===0?.15:riskIndex===1?.25:.5,efficiencyThreshold:riskIndex===0?.25:riskIndex===1?.4:.55,relativeVolume:riskIndex===0?1.2:riskIndex===1?1.5:2,volumeLookback:20,...risk,exitOnSignalLoss:true,
  })));
}

export function optimizeDayTrading(input){
  const prepared=prepareBars(input.bars),dates=[...new Set(prepared.bars.map((bar)=>bar.date))];
  if(dates.length<100) throw new Error("Optimization needs at least 100 trading sessions; use a longer intraday dataset");
  const splitIndex=Math.max(70,Math.floor(dates.length*.7)),validationStart=dates[splitIndex],trainBars=prepared.bars.filter((bar)=>bar.date<validationStart),validationBars=prepared.bars.filter((bar)=>bar.date>=validationStart);
  const candidates=candidateConfigurations();
  const trained=candidates.map((configuration)=>({ configuration,result:runDayTradingBacktest({ ...input,bars:trainBars,configuration }) })).sort((a,b)=>score(b.result.metrics)-score(a.result.metrics));
  const finalists=trained.slice(0,12).map((candidate)=>{
    const validation=runDayTradingBacktest({ ...input,bars:validationBars,configuration:candidate.configuration });
    return { configuration:candidate.configuration,trainingScore:round(score(candidate.result.metrics),2),trainingMetrics:candidate.result.metrics,validationMetrics:validation.metrics };
  }).sort((a,b)=>score(b.validationMetrics)-score(a.validationMetrics));
  const best=finalists[0],targetMet=Boolean(best&&best.validationMetrics.averageDailyReturnPct>=10&&best.validationMetrics.profitableDayPct>=80&&best.validationMetrics.maxDrawdownPct>=-25);
  return {
    searchedCandidates:candidates.length,split:{ trainingStart:trainBars[0].timestamp,trainingEnd:trainBars.at(-1).timestamp,validationStart:validationBars[0].timestamp,validationEnd:validationBars.at(-1).timestamp,trainingDays:splitIndex,validationDays:dates.length-splitIndex },
    leaderboard:finalists.slice(0,8),
    target:{ dailyReturnPct:10,minimumProfitableDayPct:80,met:targetMet,verdict:targetMet?"The target appeared in this holdout sample, but remains unproven until prospective paper trading and additional symbols confirm it.":"No tested configuration delivered a 10% average daily return with at least 80% profitable days in the holdout period.",compoundingContext:"Compounding 10% on each of 252 trading days turns $10,000 into roughly $269.7 trillion before costs and taxes—an extraordinary target, not a reasonable baseline." },
    nextResearch:["Repeat the holdout test across a liquid multi-symbol universe instead of one ticker.","Add spread, market-impact, borrow, halt, and partial-fill models before trusting higher-turnover candidates.","Paper trade the leading configuration prospectively; do not tune on the new observations.","Investigate regime gates using volatility, gap size, and scheduled news without weakening the validation boundary."],
  };
}
