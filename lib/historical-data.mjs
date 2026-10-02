export const HISTORY_TIMEFRAMES = ["1Day","1Hour","15Min","5Min"];
export const HISTORY_MAX_YEARS = 10.1;
export const HISTORY_MAX_BARS = 300_000;

const allowedTimeframes = new Set(HISTORY_TIMEFRAMES);

export function validateHistorySymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) throw new Error("Enter a valid ticker symbol");
  return symbol;
}

export function normalizeHistoryRequest(input = {}, options = {}) {
  const allowed = new Set(options.timeframes ?? HISTORY_TIMEFRAMES);
  const symbol = validateHistorySymbol(input.symbol);
  const timeframe = allowed.has(String(input.timeframe)) ? String(input.timeframe) : (options.defaultTimeframe ?? "1Day");
  if (!allowedTimeframes.has(timeframe)) throw new Error("Choose a supported historical timeframe");
  const start = new Date(String(input.start));
  const end = new Date(String(input.end));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) throw new Error("Choose a valid historical date range");
  const maximumYears = options.maximumYears ?? HISTORY_MAX_YEARS;
  if (end.getTime() - start.getTime() > maximumYears * 365.25 * 86_400_000) throw new Error("Historical research is limited to ten years per run");
  return { symbol,timeframe,start,end };
}

function coverageFor(request,bars){
  const actualStart=new Date(bars[0].timestamp),actualEnd=new Date(bars.at(-1).timestamp),tolerance=7*86_400_000;
  const startComplete=actualStart.getTime()-request.start.getTime()<=tolerance,endComplete=request.end.getTime()-actualEnd.getTime()<=tolerance;
  return{
    actualStart:actualStart.toISOString(),actualEnd:actualEnd.toISOString(),
    coverageStart:(startComplete?request.start:actualStart).toISOString(),coverageEnd:(endComplete?request.end:actualEnd).toISOString(),
    complete:startComplete&&endComplete,
    warning:startComplete&&endComplete?null:`The provider returned ${actualStart.toISOString().slice(0,10)} through ${actualEnd.toISOString().slice(0,10)}, which does not fully cover the requested range.`,
  };
}

export async function fetchAlpacaHistory(input, credentials, options = {}) {
  if (!credentials?.keyId || !credentials?.secretKey) throw new Error("Connect Alpaca in Settings or use a locally compiled dataset");
  const request = normalizeHistoryRequest(input,options);
  const maximumBars = options.maximumBars ?? HISTORY_MAX_BARS;
  const headers = { "APCA-API-KEY-ID":credentials.keyId,"APCA-API-SECRET-KEY":credentials.secretKey };
  const bars = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ timeframe:request.timeframe,start:request.start.toISOString(),end:request.end.toISOString(),limit:"10000",adjustment:"all",feed:"iex",sort:"asc" });
    if (pageToken) query.set("page_token",pageToken);
    const response = await fetch(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(request.symbol)}/bars?${query}`,{ headers });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Alpaca historical data failed (${response.status})${detail?`: ${detail.slice(0,160)}`:""}`);
    }
    const payload = await response.json();
    bars.push(...(payload.bars ?? []));
    pageToken = payload.next_page_token ?? "";
    if (bars.length > maximumBars) throw new Error(`Historical request exceeds the ${maximumBars.toLocaleString("en-US")}-bar limit; choose a larger timeframe or shorter range`);
  } while (pageToken);
  if (!bars.length) throw new Error("Alpaca returned no bars for this symbol and date range");
  const normalized=bars.map((bar) => ({ timestamp:bar.t,open:bar.o,high:bar.h,low:bar.l,close:bar.c,volume:bar.v }));
  return {
    symbol:request.symbol,
    timeframe:request.timeframe,
    provider:"alpaca-iex",
    requestedStart:request.start.toISOString(),
    requestedEnd:request.end.toISOString(),
    ...coverageFor(request,normalized),
    bars:normalized,
  };
}

export async function fetchPublicDailyHistory(input,options={}){
  const request=normalizeHistoryRequest(input,{...options,timeframes:["1Day"],defaultTimeframe:"1Day"});
  const maximumBars=options.maximumBars??HISTORY_MAX_BARS;
  const period1=Math.floor(request.start.getTime()/1000),period2=Math.floor(request.end.getTime()/1000),ticker=request.symbol.replaceAll(".","-");
  const url=`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits`;
  const response=await fetch(url,{headers:{accept:"application/json","user-agent":"Pulse-AI-Historical-Compiler/1.0"}});
  if(!response.ok)throw new Error(`Public daily history failed (${response.status})`);
  const payload=await response.json(),result=payload?.chart?.result?.[0],quote=result?.indicators?.quote?.[0],adjusted=result?.indicators?.adjclose?.[0]?.adjclose??[];
  if(!result?.timestamp?.length||!quote)throw new Error(payload?.chart?.error?.description||"Public provider returned no daily bars");
  const bars=[];
  for(let index=0;index<result.timestamp.length;index+=1){
    const close=Number(quote.close?.[index]),adjustedClose=Number(adjusted[index]),factor=Number.isFinite(adjustedClose)&&Number.isFinite(close)&&close>0?adjustedClose/close:1;
    const open=Number(quote.open?.[index]),high=Number(quote.high?.[index]),low=Number(quote.low?.[index]),volume=Number(quote.volume?.[index]);
    if(![open,high,low,close,volume].every(Number.isFinite))continue;
    bars.push({timestamp:new Date(result.timestamp[index]*1000).toISOString(),open:open*factor,high:high*factor,low:low*factor,close:close*factor,volume});
    if(bars.length>maximumBars)throw new Error(`Historical request exceeds the ${maximumBars.toLocaleString("en-US")}-bar limit; choose a larger timeframe or shorter range`);
  }
  if(!bars.length)throw new Error("Public provider returned no valid daily bars");
  return{symbol:request.symbol,timeframe:"1Day",provider:"yahoo-chart",requestedStart:request.start.toISOString(),requestedEnd:request.end.toISOString(),...coverageFor(request,bars),bars};
}
