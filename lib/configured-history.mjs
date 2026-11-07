import { normalizeHistoryRequest } from "./historical-data.mjs";
import { historyBoundary } from "./history-dates.mjs";

export async function fetchConfiguredHistory(input, source, options = {}) {
  if (!source) return null;
  const request = normalizeHistoryRequest(input);
  const base = new URL(source.endsWith("/") ? source : `${source}/`);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("BACKTESTING_DATA_SOURCE must be an HTTP(S) URL");
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(base.href));
  const sourceKey = Array.from(new Uint8Array(digest).slice(0,12),(byte)=>byte.toString(16).padStart(2,"0")).join("");
  const paths = [
    `v1/history/${encodeURIComponent(request.symbol)}/${request.timeframe}.json`,
    `${encodeURIComponent(request.symbol)}.${request.timeframe}.json`,
  ];
  let response;
  for (const path of paths) {
    response = await fetch(new URL(path, base), {
      signal: options.signal,
      headers: options.authToken ? { authorization: `Bearer ${options.authToken}` } : undefined,
    });
    if (response.status !== 404) break;
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Configured history source returned ${response.status}`);
  const payload = await response.json();
  if (payload.symbol !== request.symbol || payload.timeframe !== request.timeframe) throw new Error("Configured history file has invalid symbol or timeframe");
  const listings = payload.listings;
  if (listings !== undefined && (!Array.isArray(listings) || listings.length < 2 || listings.some((item) => !Array.isArray(item?.bars) || !item.listingId))) throw new Error("Configured history file has invalid listing histories");
  if (listings === undefined && !Array.isArray(payload.bars)) throw new Error("Configured history file has invalid bars");
  const segments = listings ?? [payload];
  if (segments.reduce((total,item) => total + item.bars.length,0) > (options.maximumBars ?? 300_000)) throw new Error("Configured history file exceeds the bar limit");
  const start = request.start.getTime(), end = request.end.getTime();
  const matches = segments.map((item) => ({ item, bars:item.bars.filter((bar) => {
    const time = Date.parse(bar?.timestamp);
    return Number.isFinite(time) && time >= start && time <= end;
  }) })).filter((item) => item.bars.length);
  if (matches.length > 1) throw new Error(`Archive contains multiple listings for ${request.symbol} in the selected dates (${matches.map(({item}) => item.listingId).join(", ")}); narrow the date range to one listing`);
  const selected = matches[0]?.item ?? payload;
  let coverageStartIso=selected.coverageStart,coverageEndIso=selected.coverageEnd;
  if (!Number.isFinite(historyBoundary(coverageStartIso).getTime()) || !Number.isFinite(historyBoundary(coverageEndIso,true).getTime())) throw new Error("Configured history file has invalid coverage dates");
  if (request.timeframe === "1Day" && selected.bars.length) {
    const firstStamp=selected.bars[0].timestamp,lastStamp=selected.bars.at(-1).timestamp;
    const firstDay=typeof firstStamp==="string"?firstStamp.slice(0,10):"",lastDay=typeof lastStamp==="string"?lastStamp.slice(0,10):"";
    const first=historyBoundary(firstDay).getTime(),last=historyBoundary(lastDay).getTime();
    if (!Number.isFinite(first) || !Number.isFinite(last) || first>last) throw new Error("Configured history file has invalid daily bar dates");
    coverageStartIso=new Date(first).toISOString();
    coverageEndIso=new Date(last+86_400_000).toISOString();
  }
  const coverageStart=historyBoundary(coverageStartIso).getTime(),coverageEnd=historyBoundary(coverageEndIso,true).getTime();
  const bars = matches[0]?.bars ?? [];
  if (!bars.length) throw new Error(`Configured archive for ${request.symbol} has no bars between ${request.start.toISOString().slice(0,10)} and ${request.end.toISOString().slice(0,10)}; archive coverage is ${payload.coverageStart.slice(0,10)} through ${payload.coverageEnd.slice(0,10)}`);
  const warnings=[];
  if(start<coverageStart||end>coverageEnd) warnings.push(`Archive coverage for ${request.symbol} is ${coverageStartIso.slice(0,10)} through ${new Date(coverageEnd-1).toISOString().slice(0,10)}; selected dates outside that range have no bars.`);
  if(selected.listingId) warnings.push(`Historical listing ${selected.listingId} selected; other companies that reused ${request.symbol} are excluded.`);
  else warnings.push("This archive does not verify security identity across ticker reuse.");
  if(payload.adjusted!==true) warnings.push("This archive does not declare adjusted prices; splits or dividends may distort backtests.");
  return {
    symbol:request.symbol,timeframe:request.timeframe,provider:"configured-source",
    archiveProvider:payload.provider??null,
    sourceKey,
    requestedStart:request.start.toISOString(),requestedEnd:request.end.toISOString(),
    coverageStart:coverageStartIso,
    coverageEnd:coverageEndIso,
    listingId:selected.listingId??null,
    warning:warnings.length?warnings.join(" "):null,bars,
  };
}
