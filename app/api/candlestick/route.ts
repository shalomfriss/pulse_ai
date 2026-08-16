import { getChatGPTUser } from "../../chatgpt-auth";
import { getUserCredentials } from "../../../db/user-credentials";

type RangeKey = "1M" | "3M" | "6M" | "1Y";
type AlpacaBar = { t:string;o:number;h:number;l:number;c:number;v:number;n?:number;vw?:number };
const RANGE_DAYS:Record<RangeKey,number> = { "1M":45,"3M":120,"6M":230,"1Y":410 };
const RANGE_BARS:Record<RangeKey,number> = { "1M":22,"3M":66,"6M":132,"1Y":264 };

function round(value:number,digits=2) { const factor=10**digits;return Math.round(value*factor)/factor; }
function average(values:number[]) { return values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : 0; }
function movingAverage(bars:AlpacaBar[],period:number) { return bars.map((bar,index) => index<period-1?null:round(average(bars.slice(index-period+1,index+1).map((item)=>item.c)))); }
function candlePattern(bars:AlpacaBar[]) {
  const current=bars.at(-1),previous=bars.at(-2);if(!current)return{name:"No candle",bias:"neutral",meaning:"No daily price bars were returned."};
  const range=Math.max(.0001,current.h-current.l),body=Math.abs(current.c-current.o),upper=current.h-Math.max(current.o,current.c),lower=Math.min(current.o,current.c)-current.l;
  if(body/range<.12)return{name:"Doji",bias:"neutral",meaning:"Buyers and sellers finished near a draw. Wait for the next candle to confirm direction."};
  if(lower>body*2.2&&upper<body)return{name:"Hammer-shaped candle",bias:current.c>=current.o?"bullish":"neutral",meaning:"Sellers pushed down and buyers reclaimed much of the range. It matters most near support after a decline."};
  if(upper>body*2.2&&lower<body)return{name:"Shooting-star shape",bias:current.c<=current.o?"bearish":"neutral",meaning:"Buyers pushed up but could not hold the advance. It matters most near resistance after a rally."};
  if(previous&&current.c>current.o&&previous.c<previous.o&&current.o<=previous.c&&current.c>=previous.o)return{name:"Bullish engulfing",bias:"bullish",meaning:"The latest up body fully covered the prior down body. Look for volume and trend confirmation."};
  if(previous&&current.c<current.o&&previous.c>previous.o&&current.o>=previous.c&&current.c<=previous.o)return{name:"Bearish engulfing",bias:"bearish",meaning:"The latest down body fully covered the prior up body. Treat it as a warning only when context confirms it."};
  return{name:current.c>=current.o?"Bullish candle":"Bearish candle",bias:current.c>=current.o?"bullish":"bearish",meaning:current.c>=current.o?"Price closed above the open, showing net buying pressure for the session.":"Price closed below the open, showing net selling pressure for the session."};
}
function summarize(symbol:string,bars:AlpacaBar[]) {
  const last=bars.at(-1),prior=bars.at(-2),recent=bars.slice(-20),sma20=average(recent.map((bar)=>bar.c)),sma50=average(bars.slice(-50).map((bar)=>bar.c));
  const support=recent.length?Math.min(...recent.map((bar)=>bar.l)):0,resistance=recent.length?Math.max(...recent.map((bar)=>bar.h)):0,averageVolume=average(recent.map((bar)=>bar.v)),change=last&&prior?(last.c-prior.c)/prior.c*100:0;
  const rangePosition=last&&resistance>support?(last.c-support)/(resistance-support)*100:50,trend=!last?"insufficient data":last.c>sma20&&sma20>sma50?"uptrend":last.c<sma20&&sma20<sma50?"downtrend":"range / transition",volumeRatio=last&&averageVolume?last.v/averageVolume:0;
  const setup=trend==="uptrend"?(rangePosition>82?"Price is near 20-day resistance. A close above resistance with stronger volume is more informative than an intraday poke.":"The trend is constructive, but a pullback that holds support or the 20-day average offers clearer risk definition than chasing."):trend==="downtrend"?"The trend remains weak. A single green candle is not a reversal; wait for a higher low and a close back above the 20-day average.":"Price is between trend states. Let a break of support or resistance confirm direction before assigning conviction.";
  return{symbol,lastPrice:round(last?.c??0),dayChangePct:round(change),trend,sma20:round(sma20),sma50:round(sma50),support:round(support),resistance:round(resistance),rangePosition:round(rangePosition),volumeRatio:round(volumeRatio),pattern:candlePattern(bars),setup};
}
export async function POST(request:Request) {
  const user=await getChatGPTUser();if(!user)return Response.json({error:"Sign in required."},{status:401});
  const body=await request.json().catch(()=>({})) as {symbols?:string;range?:RangeKey;profile?:"paper"|"live"};
  const symbols=Array.from(new Set((body.symbols??"").toUpperCase().split(/[\s,]+/).map((item)=>item.replace(/[^A-Z.\-]/g,"")).filter(Boolean))).slice(0,4);if(!symbols.length)return Response.json({error:"Enter at least one stock ticker."},{status:400});
  const range:RangeKey=body.range&&body.range in RANGE_DAYS?body.range:"3M",credentials=await getUserCredentials(user.email,body.profile==="live"?"live":"paper").catch(()=>null);if(!credentials)return Response.json({error:"Connect an Alpaca account in Settings to load candlestick data."},{status:400});
  const end=new Date(),start=new Date(end.getTime()-RANGE_DAYS[range]*86400000),url=new URL("https://data.alpaca.markets/v2/stocks/bars");url.searchParams.set("symbols",symbols.join(","));url.searchParams.set("timeframe","1Day");url.searchParams.set("start",start.toISOString());url.searchParams.set("end",end.toISOString());url.searchParams.set("limit","10000");url.searchParams.set("adjustment","all");url.searchParams.set("feed","iex");url.searchParams.set("sort","asc");
  try{const response=await fetch(url,{headers:{"APCA-API-KEY-ID":credentials.keyId,"APCA-API-SECRET-KEY":credentials.secretKey}});if(!response.ok)throw new Error(`Market data provider returned ${response.status}.`);const payload=await response.json() as {bars?:Record<string,AlpacaBar[]>};const results=symbols.map((symbol)=>{const source=(payload.bars?.[symbol]??[]).slice(-RANGE_BARS[range]),sma20=movingAverage(source,20),sma50=movingAverage(source,50);return{symbol,bars:source.map((bar,index)=>({...bar,sma20:sma20[index],sma50:sma50[index]})),summary:summarize(symbol,source)}});return Response.json({range,timeframe:"1Day",start:start.toISOString(),end:end.toISOString(),results,source:"Alpaca IEX adjusted daily bars"});}catch(error){return Response.json({error:error instanceof Error?error.message:"Candlestick data is temporarily unavailable."},{status:502});}
}
