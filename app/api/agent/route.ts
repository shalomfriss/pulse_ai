import { getChatGPTUser } from "../../chatgpt-auth";
import { accountProfile, alpacaTradingBaseUrl, getUserCredentials } from "../../../db/user-credentials";

const UNIVERSE = [
  "AAPL", "AMD", "AMZN", "AVGO", "COIN", "CRM", "CRWD", "GOOGL", "INTC", "JPM",
  "META", "MSFT", "NFLX", "NVDA", "ORCL", "PLTR", "QCOM", "RDDT", "SHOP", "SMCI",
  "SNOW", "SOFI", "TSLA", "TSM", "UBER", "V", "WMT", "XOM", "ZM", "SPY",
];
const NAMES: Record<string, string> = {
  AAPL:"Apple", AMD:"AMD", AMZN:"Amazon", AVGO:"Broadcom", COIN:"Coinbase", CRM:"Salesforce",
  CRWD:"CrowdStrike", GOOGL:"Alphabet", INTC:"Intel", JPM:"JPMorgan", META:"Meta", MSFT:"Microsoft",
  NFLX:"Netflix", NVDA:"NVIDIA", ORCL:"Oracle", PLTR:"Palantir", QCOM:"Qualcomm", RDDT:"Reddit",
  SHOP:"Shopify", SMCI:"Super Micro", SNOW:"Snowflake", SOFI:"SoFi", TSLA:"Tesla", TSM:"TSMC",
  UBER:"Uber", V:"Visa", WMT:"Walmart", XOM:"Exxon Mobil", ZM:"Zoom", SPY:"S&P 500 ETF",
};

const POSITIVE = ["beat","beats","growth","gain","gains","strong","surge","record","upgrade","bullish","profit","wins","rally","raises","optimism","accelerates","higher"];
const NEGATIVE = ["miss","misses","drop","falls","weak","cut","cuts","downgrade","bearish","loss","probe","risk","slump","warning","layoffs","lower"];

const DEMO_NEWS = [
  { source:"Reuters", headline:"Chipmakers climb as AI infrastructure spending outlook strengthens", age:"4m", sentiment:"positive" as const, symbols:["NVDA","AMD"] },
  { source:"MarketWatch", headline:"U.S. equities hold gains as traders parse fresh economic data", age:"11m", sentiment:"neutral" as const, symbols:["SPY"] },
  { source:"Bloomberg", headline:"Technology shares advance on improving demand expectations", age:"18m", sentiment:"positive" as const, symbols:["MSFT","META"] },
];

const DEMO_SIGNALS = [
  ["NVDA","NVIDIA",174.31,2.84,82,91,47],["PLTR","Palantir",147.62,2.31,75,88,31],
  ["AMD","AMD",158.62,1.92,71,84,22],["AVGO","Broadcom",292.74,1.67,68,81,19],
  ["META","Meta",704.18,1.42,63,79,26],["AMZN","Amazon",226.45,1.18,58,76,24],
  ["MSFT","Microsoft",512.09,.96,54,73,28],["GOOGL","Alphabet",197.88,.83,51,71,20],
  ["UBER","Uber",93.16,.76,47,68,14],["JPM","JPMorgan",289.52,.64,44,66,13],
] as const;

const DEMO = {
  mode: "demo" as const,
  marketOpen: true,
  account: { equity: 104287.42, buyingPower: 184120, dayPnl: 1287.42, dayPnlPct: 1.25 },
  breadth: { bullish: 54, neutral: 27, bearish: 19 },
  signals: DEMO_SIGNALS.map(([symbol,name,price,change,sentiment,buyScore,mentions], index) => ({
    symbol, name, price, change, sentiment, confidence:buyScore, buyScore, rank:index + 1,
    action:"BUY" as const, reason:"News tone and price momentum combine for a top-10 buy score.", mentions,
    evidence:DEMO_NEWS.filter((story) => story.symbols.includes(symbol)).map((story) => ({ ...story, ...analyzeHeadline(story.headline) })),
    spark:Array.from({ length:10 }, (_, i) => Math.round((price * (1 + (change / 100) * (i - 9) / 9)) * 100) / 100),
  })),
  news: DEMO_NEWS,
};

const MANAGED_PREFIX = "pulse-top10-";
const TARGET_NOTIONAL = 100;
const MAX_POSITIONS = 10;

type AlpacaOrder = {
  id:string; symbol:string; side:"buy"|"sell"; status:string; filled_qty:string;
  client_order_id:string; created_at:string;
};

type AlpacaPosition = {
  symbol:string;
  qty:string;
  market_value:string;
  avg_entry_price:string;
  current_price:string;
  unrealized_pl:string;
};

type AlpacaSnapshot = {
  latestTrade?:{ p:number };
  dailyBar?:{ c:number };
  prevDailyBar?:{ c:number };
};

function analyzeHeadline(text: string) {
  const words = text.toLowerCase();
  const positiveTerms = POSITIVE.filter((word) => words.includes(word));
  const negativeTerms = NEGATIVE.filter((word) => words.includes(word));
  const score = Math.max(-100, Math.min(100, (positiveTerms.length - negativeTerms.length) * 20));
  return { score, positiveTerms, negativeTerms };
}

function managedState(orders: AlpacaOrder[]) {
  const managedSymbols = new Set<string>();
  const pendingBuys = new Set<string>();
  const pendingSells = new Set<string>();
  const pending = new Set(["new","accepted","pending_new","partially_filled","held","calculated"]);
  for (const order of orders.filter((item) => item.client_order_id?.startsWith(MANAGED_PREFIX))) {
    managedSymbols.add(order.symbol);
    if (pending.has(order.status)) (order.side === "buy" ? pendingBuys : pendingSells).add(order.symbol);
  }
  return { managedSymbols, pendingBuys, pendingSells };
}

async function placeOrder(tradingBase:string,headers: Record<string,string>, payload: Record<string,string>) {
  return fetch(`${tradingBase}/v2/orders`, {
    method:"POST", headers:{ ...headers, "content-type":"application/json" }, body:JSON.stringify(payload),
  });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error:"Sign in required" },{ status:401 });
  const body = await request.json().catch(() => ({})) as { profile?:string;symbols?: string[]; execute?: boolean };
  const profile=accountProfile(body.profile);const tradingBase=alpacaTradingBaseUrl(profile);
  const symbols = Array.from(new Set((body.symbols?.length ? body.symbols : UNIVERSE).map((s) => s.toUpperCase()))).slice(0, 40);
  const credentials = await getUserCredentials(user.email,profile).catch(() => null);
  const key = credentials?.keyId;
  const secret = credentials?.secretKey;
  const emptyExecution = { enabled:false, ordersPlaced:0, bought:[] as string[], sold:[] as string[], managedPositions:0, managedNotional:0, positions:[] };
  if (!key || !secret) return Response.json({ ...DEMO, profile,scannedAt:new Date().toISOString(), execution:emptyExecution });

  const headers = { "APCA-API-KEY-ID":key, "APCA-API-SECRET-KEY":secret };
  try {
    const [accountRes, clockRes, snapshotRes, newsRes, ordersRes, positionsRes] = await Promise.all([
      fetch(`${tradingBase}/v2/account`, { headers }),
      fetch(`${tradingBase}/v2/clock`, { headers }),
      fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${symbols.join(",")}&feed=iex`, { headers }),
      fetch(`https://data.alpaca.markets/v1beta1/news?symbols=${symbols.join(",")}&limit=50&sort=desc`, { headers }),
      fetch(`${tradingBase}/v2/orders?status=all&limit=500&direction=desc&nested=false`, { headers }),
      fetch(`${tradingBase}/v2/positions`, { headers }),
    ]);
    if (![accountRes,clockRes,snapshotRes,newsRes,ordersRes,positionsRes].every((res) => res.ok)) throw new Error("Alpaca request failed");

    const account = await accountRes.json() as Record<string,string>;
    const clock = await clockRes.json() as { is_open:boolean };
    const snapshotPayload = await snapshotRes.json() as { snapshots?:Record<string,AlpacaSnapshot> } & Record<string,unknown>;
    // Alpaca's multi-symbol snapshots response is normally the symbol map itself,
    // while some compatible responses wrap that map in `snapshots`.
    const snapshots = snapshotPayload.snapshots ?? snapshotPayload as Record<string,AlpacaSnapshot>;
    const newsData = await newsRes.json() as { news?:{ headline:string; source:string; created_at:string; symbols:string[] }[] };
    const orders = await ordersRes.json() as AlpacaOrder[];
    const openPositions = await positionsRes.json() as AlpacaPosition[];
    const stories = (newsData.news ?? []).map((story) => ({ ...story, ...analyzeHeadline(story.headline) }));

    const ranked = symbols.map((symbol) => {
      const snapshot = snapshots[symbol];
      const price = snapshot?.latestTrade?.p ?? snapshot?.dailyBar?.c ?? 0;
      const previous = snapshot?.prevDailyBar?.c ?? price;
      const change = previous ? ((price - previous) / previous) * 100 : 0;
      const related = stories.filter((story) => story.symbols?.includes(symbol));
      const sentiment = related.length ? Math.round(related.reduce((sum, story) => sum + story.score, 0) / related.length) : 0;
      const buyScore = Math.max(0, Math.min(100, Math.round(50 + sentiment * .28 + change * 7)));
      const spark = Array.from({ length:10 }, (_, i) => Math.round(Math.max(1,price) * (1 + (change / 100) * (i - 9) / 9) * 100) / 100);
      const evidence = related.slice(0, 3).map((story) => ({
        source:story.source, headline:story.headline, score:story.score,
        positiveTerms:story.positiveTerms, negativeTerms:story.negativeTerms,
      }));
      return { symbol, name:NAMES[symbol] ?? symbol, price, change, sentiment, buyScore, confidence:buyScore, mentions:related.length, evidence, spark };
    }).filter((signal) => signal.price > 0).sort((a,b) => b.buyScore - a.buyScore || b.change - a.change);

    const topTen = ranked.slice(0, MAX_POSITIONS).map((signal, index) => ({
      ...signal, rank:index + 1, action:"BUY" as const,
      reason:`Ranked #${index + 1} across the liquid-stock universe by combined news sentiment and price momentum.`,
    }));
    const targetSymbols = new Set(topTen.map((signal) => signal.symbol));
    const state = managedState(orders);
    const positionBySymbol = new Map(openPositions.map((position) => [position.symbol, position]));
    const activeManaged = new Set<string>();
    for (const position of openPositions) {
      if (state.managedSymbols.has(position.symbol) && Number(position.qty) > .000001) activeManaged.add(position.symbol);
    }
    for (const symbol of state.pendingBuys) activeManaged.add(symbol);

    const executionEnabled = credentials.autoTrade;
    const bought:string[] = [];
    const sold:string[] = [];
    let ordersPlaced = 0;
    if (body.execute && executionEnabled && clock.is_open) {
      // A 15-minute bucket makes retries and simultaneous tabs idempotent at Alpaca.
      const cycleKey = Math.floor(Date.now() / 900000).toString(36);
      const exits = [...activeManaged].filter((symbol) => !targetSymbols.has(symbol) && !state.pendingSells.has(symbol));
      for (const symbol of exits) {
        const quantity = Number(positionBySymbol.get(symbol)?.qty ?? 0);
        if (quantity <= .000001) continue;
        const response = await placeOrder(tradingBase,headers, {
          symbol, qty:String(quantity), side:"sell", type:"market", time_in_force:"day",
          client_order_id:`${MANAGED_PREFIX}sell-${cycleKey}-${symbol}`,
        });
        if (response.ok) { sold.push(symbol); ordersPlaced += 1; activeManaged.delete(symbol); }
      }

      const retained = [...activeManaged].filter((symbol) => targetSymbols.has(symbol)).length;
      const availableSlots = Math.max(0, MAX_POSITIONS - retained);
      const entries = topTen.filter((signal) => !activeManaged.has(signal.symbol) && !state.pendingBuys.has(signal.symbol)).slice(0, availableSlots);
      for (const signal of entries) {
        const response = await placeOrder(tradingBase,headers, {
          symbol:signal.symbol, notional:String(TARGET_NOTIONAL), side:"buy", type:"market", time_in_force:"day",
          client_order_id:`${MANAGED_PREFIX}buy-${cycleKey}-${signal.symbol}`,
        });
        if (response.ok) { bought.push(signal.symbol); ordersPlaced += 1; activeManaged.add(signal.symbol); }
      }
    }

    const equity = Number(account.equity ?? 0);
    const lastEquity = Number(account.last_equity ?? equity);
    const dayPnl = equity - lastEquity;
    const dayPnlPct = lastEquity ? (dayPnl / lastEquity) * 100 : 0;
    const positives = ranked.filter((signal) => signal.buyScore >= 60).length;
    const negatives = ranked.filter((signal) => signal.buyScore < 40).length;
    const bullish = Math.round((positives / Math.max(1, ranked.length)) * 100);
    const bearish = Math.round((negatives / Math.max(1, ranked.length)) * 100);
    const positions = openPositions.filter((position) => state.managedSymbols.has(position.symbol)).map((position) => ({
      symbol:position.symbol,
      qty:Number(position.qty),
      marketValue:Number(position.market_value),
      avgEntryPrice:Number(position.avg_entry_price),
      currentPrice:Number(position.current_price),
      unrealizedPnl:Number(position.unrealized_pl),
    })).sort((a,b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));
    const managedPositions = positions.length;
    const managedNotional = positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0);

    return Response.json({
      mode:"live", profile,scannedAt:new Date().toISOString(), marketOpen:clock.is_open,
      account:{ equity, buyingPower:Number(account.buying_power ?? 0), dayPnl, dayPnlPct },
      breadth:{ bullish, neutral:Math.max(0,100-bullish-bearish), bearish }, signals:topTen,
      news:stories.slice(0,3).map((story) => ({ source:story.source, headline:story.headline, age:"recent", sentiment:story.score > 20 ? "positive" : story.score < -20 ? "negative" : "neutral", symbols:story.symbols })),
      execution:{ enabled:executionEnabled, ordersPlaced, bought, sold, managedPositions, managedNotional, positions },
    });
  } catch {
    return Response.json({ ...DEMO, profile,scannedAt:new Date().toISOString(), execution:emptyExecution });
  }
}
