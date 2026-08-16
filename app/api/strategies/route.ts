import { getChatGPTUser } from "../../chatgpt-auth";
import { accountProfile, alpacaTradingBaseUrl, getUserCredentials } from "../../../db/user-credentials";
import { getPausedStrategies } from "../../../db/strategy-state";

const CORE_UNIVERSE = [
  "AAPL","AMD","AMZN","AVGO","COIN","CRM","CRWD","GOOGL","INTC","JPM","META","MSFT","NFLX","NVDA","ORCL",
  "PLTR","QCOM","RDDT","SHOP","SMCI","SNOW","SOFI","TSLA","TSM","UBER","V","WMT","XOM","ZM","SPY",
];
const UNIVERSE = CORE_UNIVERSE;
const STRATEGIES = [
  { id:"momentum",code:"mom",name:"Medium-term momentum",short:"Buy persistent market leaders",horizon:"20–60 trading days",window:"Daily 3:30–3:55 PM ET",description:"Ranks liquid stocks by 20- and 60-day relative strength, then penalizes unstable price paths." },
  { id:"quality-value",code:"qv",name:"Quality + value",short:"Stable compounders at reasonable prices",horizon:"Quarterly / long horizon",window:"Friday 3:30–3:55 PM ET",description:"Uses trend consistency, lower realized volatility, liquidity and position within the recent range as an Alpaca-only market-quality proxy." },
  { id:"earnings-drift",code:"earn",name:"Earnings-surprise drift",short:"Follow confirmed earnings reactions",horizon:"1–20 trading days",window:"10:00 AM–3:30 PM ET",description:"Finds earnings and guidance headlines, then requires positive tone, price confirmation and abnormal volume." },
  { id:"short-reversal",code:"rev",name:"Short-term reversal",short:"Buy liquid, non-fundamental dislocations",horizon:"2–10 trading days",window:"3:15–3:55 PM ET",description:"Looks for sharp five-day declines that begin to stabilize without strongly negative news." },
  { id:"news-catalyst",code:"news",name:"News-catalyst momentum",short:"Trade relevant positive catalysts",horizon:"Minutes–5 days",window:"9:35 AM–3:30 PM ET",description:"Combines ticker-specific headline tone, mention count, same-day price confirmation and volume." },
  { id:"intraday",code:"scalp",name:"Intraday momentum",short:"Follow short, liquid bursts",horizon:"5–60 minutes",window:"9:45 AM–3:30 PM ET",description:"Ranks persistent 5-minute price movement and intraday volume acceleration while the market is open." },
  { id:"opening-range",code:"orb",name:"Opening-range breakout",short:"Trade a confirmed break of the opening range",horizon:"15 minutes–3 hours",window:"10:00–11:30 AM ET",description:"Builds the first 30-minute high/low, then requires a breakout, positive short-term trend and expanding volume before entering." },
  { id:"vwap",code:"vwap",name:"VWAP reclaim / rejection",short:"Trade institutional intraday balance",horizon:"5 minutes–several hours",window:"10:00 AM–3:30 PM ET",description:"Compares price with session VWAP and enters confirmed reclaims or rejection reversals only when volume supports the move." },
  { id:"gap",code:"gap",name:"Gap continuation / fade",short:"Trade overnight dislocations with confirmation",horizon:"Minutes–1 day",window:"9:35–11:00 AM ET",description:"Measures the opening gap versus the prior close, then follows news-backed continuation or buys a recovering unsupported gap-down fade." },
  { id:"squeeze",code:"squeeze",name:"Volatility-squeeze breakout",short:"Trade expansion after compression",horizon:"Minutes–2 days",window:"10:00 AM–3:30 PM ET",description:"Detects narrow 20-day Bollinger width and low realized movement, then waits for a price and volume breakout." },
  { id:"closing",code:"close",name:"Closing-session momentum",short:"Trade confirmed final-hour continuation",horizon:"Final 60–90 minutes",window:"3:00–3:55 PM ET",description:"Activates near the close and combines the opening move, session trend, market direction and volume to rank continuation candidates." },
  { id:"order-flow",code:"flow",name:"Order-flow imbalance",short:"Follow top-of-book pressure",horizon:"Seconds–minutes",window:"9:35 AM–3:55 PM ET",description:"Uses Alpaca’s latest bid/ask sizes as a top-of-book pressure proxy, confirmed by 5-minute price and volume. This is not full-depth order-book analysis." },
  { id:"medallion",code:"medal",name:"Medallion",short:"Combine many small statistical edges",horizon:"15 minutes–5 trading days",window:"9:45 AM–3:30 PM ET",description:"A cash-only, long-only ensemble inspired by publicly described Renaissance principles. It combines several weak price, volume, sentiment and risk signals; it does not reproduce the proprietary Medallion Fund." },
] as const;

const FIXED_PAPER_ALLOCATION = 1000;
const LIVE_TRADING_POOL = 100;
const POSITIVE = ["beat","beats","growth","gain","gains","strong","surge","record","upgrade","bullish","profit","wins","rally","raises","optimism","accelerates","higher","contract","approval","launch"];
const NEGATIVE = ["miss","misses","drop","falls","weak","cut","cuts","downgrade","bearish","loss","probe","risk","slump","warning","layoffs","lower","recall","lawsuit","investigation"];
const EARNINGS = ["earnings","revenue","guidance","quarter","eps","profit","forecast","outlook"];
const MAX_POSITIONS = 10;

type Bar = { t:string;o:number;h:number;l:number;c:number;v:number;n?:number;vw?:number };
type Story = { headline:string;source:string;created_at:string;symbols:string[];score:number };
type AlpacaOrder = { symbol:string;side:"buy"|"sell";status:string;filled_qty:string;filled_avg_price?:string;client_order_id:string };
type Snapshot = { latestQuote?:{ bp:number;ap:number;bs:number;as:number } };
type Metrics = {
  symbol:string;price:number;open:number;prevClose:number;day:number;gap:number;ret5:number;ret20:number;ret60:number;volatility:number;
  rangePosition:number;volumeRatio:number;intraday30:number;intraday5:number;intradayVolume:number;vwap:number;openingHigh:number;openingLow:number;
  bandwidth:number;breakout20:number;quoteImbalance:number;sentiment:number;mentions:number;earningsSentiment:number;earningsMentions:number;
};
type Candidate = Metrics & { score:number;eligible:boolean;reason:string;assetClass?:"equity"|"option" };

function clamp(value:number,min=0,max=100) { return Math.max(min,Math.min(max,value)); }
function pct(now:number,then:number) { return then ? (now/then-1)*100 : 0; }
function average(values:number[]) { return values.length ? values.reduce((a,b) => a+b,0)/values.length : 0; }
function stdev(values:number[]) { if (values.length < 2) return 0;const mean=average(values);return Math.sqrt(average(values.map((value) => (value-mean)**2))); }
function scoreHeadline(text:string) { const words=text.toLowerCase();return clamp((POSITIVE.filter((word) => words.includes(word)).length-NEGATIVE.filter((word) => words.includes(word)).length)*18,-100,100); }
function isEarningsStory(text:string) { const lower=text.toLowerCase();return EARNINGS.some((word) => lower.includes(word)); }
function barAt(bars:Bar[],offset:number) { return bars[Math.max(0,bars.length-1-offset)]?.c ?? bars.at(-1)?.c ?? 0; }
function easternDate(value:string|Date) {
  const parts=new Intl.DateTimeFormat("en-US",{ timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit" }).formatToParts(new Date(value));
  const part=(type:string) => parts.find((item) => item.type===type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function tradingWindow(strategyId:string,timestamp:string,isMarketOpen:boolean) {
  const parts=new Intl.DateTimeFormat("en-US",{ timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23" }).formatToParts(new Date(timestamp));
  const value=(type:string) => parts.find((item) => item.type===type)?.value ?? "0";
  const minute=Number(value("hour"))*60+Number(value("minute"));const weekday=value("weekday");
  const ranges:Record<string,[number,number]>={
    momentum:[930,955],"quality-value":[930,955],"earnings-drift":[600,930],"short-reversal":[915,955],"news-catalyst":[575,930],intraday:[585,930],
    "opening-range":[600,690],vwap:[600,930],gap:[575,660],squeeze:[600,930],closing:[900,955],"order-flow":[575,955],medallion:[585,930],
  };
  const range=ranges[strategyId] ?? [570,960];const correctDay=strategyId!=="quality-value"||weekday==="Fri";
  return isMarketOpen&&correctDay&&minute>=range[0]&&minute<=range[1];
}

function buildMetrics(symbol:string,daily:Bar[],intraday:Bar[],stories:Story[],snapshot?:Snapshot):Metrics {
  const sortedDaily=[...daily].sort((a,b) => a.t.localeCompare(b.t));
  const allIntraday=[...intraday].sort((a,b) => a.t.localeCompare(b.t));
  const lastDay=easternDate(allIntraday.at(-1)?.t ?? new Date());
  const session=allIntraday.filter((bar) => easternDate(bar.t)===lastDay);
  const latest=sortedDaily.at(-1);const price=session.at(-1)?.c ?? latest?.c ?? 0;const prior=barAt(sortedDaily,1);const open=session[0]?.o ?? latest?.o ?? price;
  const returns=sortedDaily.slice(-21).map((bar,index,array) => index ? pct(bar.c,array[index-1].c) : 0).slice(1);
  const recent=sortedDaily.slice(-60);const high=Math.max(...recent.map((bar) => bar.h),price);const low=Math.min(...recent.map((bar) => bar.l),price);
  const avgVolume=average(sortedDaily.slice(-20).map((bar) => bar.v));const related=stories.filter((story) => story.symbols?.includes(symbol));const earnings=related.filter((story) => isEarningsStory(story.headline));
  const sessionVolumes=session.slice(-12).map((bar) => bar.v);const opening=session.slice(0,6);const vwapDen=session.reduce((sum,bar) => sum+bar.v,0);const vwapNum=session.reduce((sum,bar) => sum+((bar.h+bar.l+bar.c)/3)*bar.v,0);
  const closes=sortedDaily.slice(-20).map((bar) => bar.c);const mean20=average(closes);const sd20=stdev(closes);const quote=snapshot?.latestQuote;const quoteTotal=(quote?.bs ?? 0)+(quote?.as ?? 0);
  return {
    symbol,price,open,prevClose:prior,day:pct(price,prior),gap:pct(open,prior),ret5:pct(price,barAt(sortedDaily,5)),ret20:pct(price,barAt(sortedDaily,20)),ret60:pct(price,barAt(sortedDaily,60)),
    volatility:stdev(returns)*Math.sqrt(252),rangePosition:high===low?.5:(price-low)/(high-low),volumeRatio:avgVolume?(latest?.v ?? 0)/avgVolume:1,
    intraday30:pct(price,session.at(-7)?.c ?? price),intraday5:pct(price,session.at(-2)?.c ?? price),intradayVolume:sessionVolumes.length>2?(sessionVolumes.at(-1) ?? 0)/Math.max(1,average(sessionVolumes.slice(0,-1))):1,
    vwap:vwapDen?vwapNum/vwapDen:price,openingHigh:opening.length?Math.max(...opening.map((bar) => bar.h)):price,openingLow:opening.length?Math.min(...opening.map((bar) => bar.l)):price,
    bandwidth:mean20?sd20*4/mean20*100:100,breakout20:pct(price,sortedDaily.length>2?Math.max(...sortedDaily.slice(-21,-1).map((bar) => bar.h)):price),quoteImbalance:quoteTotal?((quote?.bs ?? 0)-(quote?.as ?? 0))/quoteTotal:0,
    sentiment:related.length?average(related.map((story) => story.score)):0,mentions:related.length,earningsSentiment:earnings.length?average(earnings.map((story) => story.score)):0,earningsMentions:earnings.length,
  };
}

function analyze(strategyId:string,m:Metrics,minutesToClose:number):Candidate {
  if (strategyId==="momentum") { const score=clamp(50+m.ret20*1.2+m.ret60*.45-Math.max(0,m.volatility-35)*.35);return { ...m,score,eligible:m.ret20>1&&m.ret60>2,reason:`${m.ret20.toFixed(1)}% over 20 days and ${m.ret60.toFixed(1)}% over 60 days; ${m.volatility.toFixed(0)}% annualized volatility.` }; }
  if (strategyId==="quality-value") { const score=clamp(clamp(90-m.volatility)*.45+clamp((1-m.rangePosition)*100)*.25+clamp(50+m.ret60)*.2+clamp(m.volumeRatio*50)*.1);return { ...m,score,eligible:m.ret60>0&&m.volatility<65,reason:`Stable ${m.volatility.toFixed(0)}% volatility, positive 60-day trend, and price at ${(m.rangePosition*100).toFixed(0)}% of its recent range.` }; }
  if (strategyId==="earnings-drift") { const score=clamp(45+m.earningsSentiment*.38+m.day*7+(m.volumeRatio-1)*12);return { ...m,score,eligible:m.earningsMentions>0&&m.earningsSentiment>0&&m.day>0,reason:`${m.earningsMentions} earnings headline(s), ${m.earningsSentiment.toFixed(0)} tone, ${m.day.toFixed(1)}% price confirmation and ${m.volumeRatio.toFixed(1)}× volume.` }; }
  if (strategyId==="short-reversal") { const score=clamp(45+Math.max(0,-m.ret5)*7+Math.max(0,m.day)*5+m.sentiment*.12);return { ...m,score,eligible:m.ret5<-2&&m.day>-.5&&m.sentiment>-35,reason:`A ${m.ret5.toFixed(1)}% five-day dislocation is stabilizing at ${m.day.toFixed(1)}% today; news tone is ${m.sentiment.toFixed(0)}.` }; }
  if (strategyId==="news-catalyst") { const score=clamp(45+m.sentiment*.38+m.day*6+Math.min(15,m.mentions*2)+(m.volumeRatio-1)*8);return { ...m,score,eligible:m.mentions>0&&m.sentiment>15&&m.day>0,reason:`${m.mentions} relevant headline(s) score ${m.sentiment.toFixed(0)}, confirmed by ${m.day.toFixed(1)}% price action and ${m.volumeRatio.toFixed(1)}× volume.` }; }
  if (strategyId==="opening-range") { const breakPct=pct(m.price,m.openingHigh);const score=clamp(55+breakPct*20+m.intraday30*10+(m.intradayVolume-1)*14);return { ...m,score,eligible:breakPct>.05&&m.intraday30>0&&m.intradayVolume>1.05,reason:`Price is ${breakPct.toFixed(2)}% above the first 30-minute high with ${m.intradayVolume.toFixed(1)}× recent volume.` }; }
  if (strategyId==="vwap") { const distance=pct(m.price,m.vwap);const reclaim=distance>0&&m.intraday5>0;return { ...m,score:clamp(52+distance*18+m.intraday5*14+(m.intradayVolume-1)*10),eligible:reclaim&&m.intradayVolume>.9,reason:`Price is ${distance.toFixed(2)}% above session VWAP after a ${m.intraday5.toFixed(2)}% confirming bar; volume is ${m.intradayVolume.toFixed(1)}×.` }; }
  if (strategyId==="gap") { const continuation=m.gap>1&&m.price>m.open&&m.sentiment>=0;const fade=m.gap<-1&&m.price>m.open&&m.sentiment>-25;return { ...m,score:clamp(50+Math.abs(m.gap)*7+pct(m.price,m.open)*12+m.sentiment*.15),eligible:continuation||fade,reason:`Opened ${m.gap>=0?"+":""}${m.gap.toFixed(1)}% from the prior close and is ${pct(m.price,m.open)>=0?"+":""}${pct(m.price,m.open).toFixed(1)}% from the open; news tone ${m.sentiment.toFixed(0)}.` }; }
  if (strategyId==="squeeze") { const score=clamp(55+(6-m.bandwidth)*7+m.breakout20*18+(m.intradayVolume-1)*10);return { ...m,score,eligible:m.bandwidth<6&&m.breakout20>0&&m.intradayVolume>1,reason:`20-day band width compressed to ${m.bandwidth.toFixed(1)}%; price is ${m.breakout20.toFixed(2)}% above the prior range with ${m.intradayVolume.toFixed(1)}× volume.` }; }
  if (strategyId==="closing") { const score=clamp(50+m.day*8+m.intraday30*14+(m.intradayVolume-1)*10);return { ...m,score,eligible:minutesToClose>=0&&minutesToClose<=90&&m.day>.4&&m.intraday30>0&&m.intradayVolume>.9,reason:`${minutesToClose.toFixed(0)} minutes to close; ${m.day.toFixed(1)}% session trend and ${m.intraday30.toFixed(2)}% final-hour confirmation.` }; }
  if (strategyId==="order-flow") { const score=clamp(50+m.quoteImbalance*45+m.intraday5*18+(m.intradayVolume-1)*9);return { ...m,score,eligible:m.quoteImbalance>.18&&m.intraday5>0&&m.intradayVolume>.9,reason:`Top-of-book bid-size imbalance is ${(m.quoteImbalance*100).toFixed(0)}%, confirmed by ${m.intraday5.toFixed(2)}% price movement and ${m.intradayVolume.toFixed(1)}× volume.` }; }
  if (strategyId==="medallion") {
    const trend=clamp(50+m.ret20*1.1+m.ret60*.35);
    const shortTerm=clamp(50+m.intraday30*10+m.intraday5*14-Math.max(0,-m.ret5)*2);
    const participation=clamp(50+(m.volumeRatio-1)*18+(m.intradayVolume-1)*16+m.quoteImbalance*12);
    const information=clamp(50+m.sentiment*.28+Math.min(10,m.mentions));
    const riskControl=clamp(100-m.volatility*1.25-Math.abs(m.gap)*3);
    const score=clamp(trend*.25+shortTerm*.25+participation*.2+information*.15+riskControl*.15);
    const confirmingSignals=[m.ret20>0,m.intraday30>0,m.intraday5>0,m.volumeRatio>.9,m.sentiment>=0].filter(Boolean).length;
    return { ...m,score,eligible:score>=58&&confirmingSignals>=3&&m.volatility<55&&m.price>0,reason:`Ensemble score ${score.toFixed(0)} combines trend ${trend.toFixed(0)}, short-term behavior ${shortTerm.toFixed(0)}, participation ${participation.toFixed(0)}, information ${information.toFixed(0)} and risk control ${riskControl.toFixed(0)}. Cash-only equity; no options, shorting, margin or leverage.` };
  }
  const score=clamp(50+m.intraday30*16+m.intraday5*10+(m.intradayVolume-1)*12);return { ...m,score,eligible:m.intraday30>.2&&m.intraday5>0&&m.intradayVolume>1,reason:`${m.intraday30.toFixed(2)}% over 30 minutes, ${m.intraday5.toFixed(2)}% in the last bar, with ${m.intradayVolume.toFixed(1)}× intraday volume.` };
}

function managedState(orders:AlpacaOrder[],code:string) { const prefix=`pulse-s-${code}-`;const quantities=new Map<string,number>();const pending=new Set<string>();const openStatuses=new Set(["new","accepted","pending_new","partially_filled","held","calculated"]);for (const order of orders.filter((item) => item.client_order_id?.startsWith(prefix))) { const filled=Number(order.filled_qty||0);quantities.set(order.symbol,(quantities.get(order.symbol)??0)+(order.side==="buy"?filled:-filled));if (openStatuses.has(order.status)) pending.add(order.symbol); }return { quantities,pending }; }
async function placeOrder(tradingBase:string,headers:Record<string,string>,payload:Record<string,unknown>) { return fetch(`${tradingBase}/v2/orders`,{ method:"POST",headers:{ ...headers,"content-type":"application/json" },body:JSON.stringify(payload) }); }
function demoStrategies(pausedStrategies=new Set<string>(),allocation=FIXED_PAPER_ALLOCATION) { const symbols=["NVDA","PLTR","AMD","SPY"];const deployed=Math.min(allocation,allocation*.4);return STRATEGIES.map((strategy,index) => ({ ...strategy,allocation,deployed,cash:Math.max(0,allocation-deployed),enabled:false,paused:pausedStrategies.has(strategy.id),windowOpen:false,holdings:symbols.map((symbol,rank) => ({ symbol,rank:rank+1,score:Math.max(61,91-rank*6-index),price:110+rank*23,day:2.1-rank*.3,side:"long",assetClass:"equity",reason:`Demo rationale: ${symbol} satisfies the ${strategy.name.toLowerCase()} entry filters.` })),orders:{ bought:[] as string[],sold:[] as string[] },dataMode:"demo" })); }

function isOptionSymbol(symbol:string) { return /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(symbol); }

function strategyExposure(quantities:Map<string,number>,prices:Map<string,number>,allocation:number) {
  let exposure=0;
  for (const [symbol,qty] of quantities) {
    if (Math.abs(qty)<=.000001) continue;
    const price=prices.get(symbol);
    if (!price) return allocation;
    exposure+=Math.abs(qty)*price*(isOptionSymbol(symbol)?100:1);
  }
  return Math.min(allocation,exposure);
}

export async function POST(request:Request) {
  const user=await getChatGPTUser();if (!user) return Response.json({ error:"Sign in required" },{ status:401 });const body=await request.json().catch(() => ({})) as { profile?:string;execute?:boolean;strategyId?:string };const profile=accountProfile(body.profile);const tradingBase=alpacaTradingBaseUrl(profile);
  const pausedStrategies:Set<string>=await getPausedStrategies(user.email,profile).catch(() => new Set<string>(STRATEGIES.map((strategy) => strategy.id)));
  const credentials=await getUserCredentials(user.email,profile).catch(() => null);const key=credentials?.keyId,secret=credentials?.secretKey;if (!key||!secret) { const allocation=profile==="live"?LIVE_TRADING_POOL/STRATEGIES.length:FIXED_PAPER_ALLOCATION;return Response.json({ profile,scannedAt:new Date().toISOString(),marketOpen:true,totalAllocation:allocation*STRATEGIES.length,strategies:demoStrategies(pausedStrategies,allocation) }); }
  const headers={ "APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret };
  try {
    const now=new Date(),dailyStart=new Date(now.getTime()-110*86400000).toISOString(),minuteStart=new Date(now.getTime()-2*86400000).toISOString(),symbols=UNIVERSE.join(",");
    const [clockRes,dailyRes,minuteRes,newsRes,ordersRes,snapshotRes,accountRes]=await Promise.all([
      fetch(`${tradingBase}/v2/clock`,{ headers }),fetch(`https://data.alpaca.markets/v2/stocks/bars?symbols=${symbols}&timeframe=1Day&start=${encodeURIComponent(dailyStart)}&limit=10000&adjustment=all&feed=iex`,{ headers }),
      fetch(`https://data.alpaca.markets/v2/stocks/bars?symbols=${symbols}&timeframe=5Min&start=${encodeURIComponent(minuteStart)}&limit=10000&adjustment=all&feed=iex`,{ headers }),fetch(`https://data.alpaca.markets/v1beta1/news?symbols=${symbols}&limit=50&sort=desc`,{ headers }),
      fetch(`${tradingBase}/v2/orders?status=all&limit=500&direction=desc&nested=false`,{ headers }),fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${symbols}&feed=iex`,{ headers }),
      fetch(`${tradingBase}/v2/account`,{ headers }),
    ]);if (![clockRes,dailyRes,minuteRes,newsRes,ordersRes,snapshotRes,accountRes].every((response) => response.ok)) throw new Error("Strategy data unavailable");
    const clock=await clockRes.json() as { is_open:boolean;timestamp:string;next_close:string };const dailyData=await dailyRes.json() as { bars?:Record<string,Bar[]> };const minuteData=await minuteRes.json() as { bars?:Record<string,Bar[]> };const newsData=await newsRes.json() as { news?:Omit<Story,"score">[] };const orders=await ordersRes.json() as AlpacaOrder[];const account=await accountRes.json() as Record<string,string>;
    const snapshotPayload=await snapshotRes.json() as { snapshots?:Record<string,Snapshot> } & Record<string,unknown>;const snapshots=snapshotPayload.snapshots ?? snapshotPayload as Record<string,Snapshot>;const stories:Story[]=(newsData.news??[]).map((story) => ({ ...story,score:scoreHeadline(story.headline) }));
    const metrics=UNIVERSE.map((symbol) => buildMetrics(symbol,dailyData.bars?.[symbol]??[],minuteData.bars?.[symbol]??[],stories,snapshots[symbol])).filter((item) => item.price>0);const minutesToClose=(new Date(clock.next_close).getTime()-new Date(clock.timestamp).getTime())/60000;
    const executionEnabled=credentials.autoTrade;const cycleKey=Math.floor(Date.now()/900000).toString(36);const results=[];
    const equity=Math.max(0,Number(account.equity||0));
    const totalAllocation=profile==="live"?Math.min(LIVE_TRADING_POOL,equity):STRATEGIES.length*FIXED_PAPER_ALLOCATION;
    const strategyAllocation=totalAllocation/STRATEGIES.length;
    const cash=Math.max(0,Number(account.cash||0));
    let availableOrderBudget=Math.min(totalAllocation,cash);
    const priceBySymbol=new Map(metrics.map((metric) => [metric.symbol,metric.price]));
    for (const strategy of STRATEGIES) {
      const ranked=metrics.map((metric) => analyze(strategy.id,metric,minutesToClose)).filter((item) => item.eligible&&item.assetClass!=="option"&&!isOptionSymbol(item.symbol)).sort((a,b) => b.score-a.score).slice(0,MAX_POSITIONS);
      const targets=new Map(ranked.map((item) => [item.symbol,item]));const managed=managedState(orders,strategy.code);const bought:string[]=[],sold:string[]=[];
      const paused=pausedStrategies.has(strategy.id);const windowOpen=tradingWindow(strategy.id,clock.timestamp,clock.is_open);
      const positionTarget=profile==="live"?strategyAllocation:strategyAllocation/MAX_POSITIONS;
      let deployed=strategyExposure(managed.quantities,priceBySymbol,strategyAllocation);
      let strategyBudget=Math.max(0,strategyAllocation-deployed-managed.pending.size*positionTarget);
      if (body.execute&&executionEnabled&&!paused&&windowOpen&&(!body.strategyId||body.strategyId===strategy.id)) {
        for (const [symbol,qty] of managed.quantities) { const target=targets.get(symbol);if (qty<=.000001||isOptionSymbol(symbol)) continue;if (!target) { const response=await placeOrder(tradingBase,headers,{ symbol,qty:String(qty),side:"sell",type:"market",time_in_force:"day",position_intent:"sell_to_close",client_order_id:`pulse-s-${strategy.code}-x${cycleKey}-${symbol}` });if (response.ok) sold.push(symbol); } }
        const activeCount=[...managed.quantities.entries()].filter(([symbol,qty]) => qty>.000001&&!isOptionSymbol(symbol)).length;
        for (const candidate of ranked.filter((item) => Math.abs(managed.quantities.get(item.symbol)??0)<=.000001&&!managed.pending.has(item.symbol)).slice(0,Math.max(0,MAX_POSITIONS-activeCount))) {
          if (candidate.assetClass==="option") continue;
          const payload:Record<string,unknown>={ symbol:candidate.symbol,side:"buy",type:"market",time_in_force:"day",client_order_id:`pulse-s-${strategy.code}-entry-${cycleKey}-${candidate.symbol}`,position_intent:"buy_to_open" };
          const orderBudget=Math.min(positionTarget,strategyBudget,availableOrderBudget);
          if (orderBudget<1) break;
          let estimatedNotional=orderBudget;
          payload.notional=orderBudget.toFixed(2);
          payload.client_order_id=`pulse-s-${strategy.code}-${cycleKey}-${candidate.symbol}`;
          const response=await placeOrder(tradingBase,headers,payload);if (response.ok) { bought.push(candidate.symbol);strategyBudget=Math.max(0,strategyBudget-estimatedNotional);availableOrderBudget=Math.max(0,availableOrderBudget-estimatedNotional);deployed=Math.min(strategyAllocation,deployed+estimatedNotional); }
        }
      }
      const holdings=ranked.map((candidate,rank) => ({ symbol:candidate.symbol,rank:rank+1,score:Math.round(candidate.score),price:candidate.price,day:candidate.day,side:"long" as const,assetClass:candidate.assetClass??"equity",reason:candidate.reason }));
      results.push({ ...strategy,allocation:strategyAllocation,deployed,cash:Math.max(0,strategyAllocation-deployed),enabled:executionEnabled,paused,windowOpen,holdings,orders:{ bought,sold },dataMode:"live" });
    }
    return Response.json({ profile,scannedAt:new Date().toISOString(),marketOpen:clock.is_open,totalAllocation,strategies:results });
  } catch { const allocation=profile==="live"?LIVE_TRADING_POOL/STRATEGIES.length:FIXED_PAPER_ALLOCATION;return Response.json({ profile,scannedAt:new Date().toISOString(),marketOpen:true,totalAllocation:allocation*STRATEGIES.length,strategies:demoStrategies(pausedStrategies,allocation) }); }
}
