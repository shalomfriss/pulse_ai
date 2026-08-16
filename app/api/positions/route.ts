import { getChatGPTUser } from "../../chatgpt-auth";
import { accountProfile, alpacaTradingBaseUrl, getUserCredentials } from "../../../db/user-credentials";
import { recordStrategyPerformance } from "../../../db/strategy-state";

const CATEGORIES = [
  { id:"momentum",code:"mom",name:"Medium-term momentum",allocation:1000 },
  { id:"quality-value",code:"qv",name:"Quality + value",allocation:1000 },
  { id:"earnings-drift",code:"earn",name:"Earnings-surprise drift",allocation:1000 },
  { id:"short-reversal",code:"rev",name:"Short-term reversal",allocation:1000 },
  { id:"news-catalyst",code:"news",name:"News-catalyst momentum",allocation:1000 },
  { id:"intraday",code:"scalp",name:"Intraday momentum",allocation:1000 },
  { id:"opening-range",code:"orb",name:"Opening-range breakout",allocation:1000 },
  { id:"vwap",code:"vwap",name:"VWAP reclaim / rejection",allocation:1000 },
  { id:"gap",code:"gap",name:"Gap continuation / fade",allocation:1000 },
  { id:"squeeze",code:"squeeze",name:"Volatility-squeeze breakout",allocation:1000 },
  { id:"closing",code:"close",name:"Closing-session momentum",allocation:1000 },
  { id:"order-flow",code:"flow",name:"Order-flow imbalance",allocation:1000 },
  { id:"medallion",code:"medal",name:"Medallion",allocation:1000 },
] as const;

type AlpacaPosition = {
  symbol:string;qty:string;market_value:string;cost_basis:string;avg_entry_price:string;
  current_price:string;unrealized_pl:string;unrealized_plpc:string;change_today:string;
  unrealized_intraday_pl:string;unrealized_intraday_plpc:string;
};
type AlpacaOrder = { symbol:string;side:"buy"|"sell";status:string;filled_qty:string;filled_avg_price?:string;filled_at?:string;client_order_id:string };
type PositionRow = {
  symbol:string;qty:number;marketValue:number;costBasis:number;avgEntryPrice:number;
  currentPrice:number;unrealizedPnl:number;unrealizedPnlPct:number;dayChangePct:number;dayPnl:number;
};

function netQuantities(orders:AlpacaOrder[],prefix:string) {
  const quantities = new Map<string,number>();
  for (const order of orders.filter((item) => item.client_order_id?.startsWith(prefix))) {
    const filled = Number(order.filled_qty || 0);
    const signed = order.side === "buy" ? filled : -filled;
    quantities.set(order.symbol,(quantities.get(order.symbol) ?? 0)+signed);
  }
  return quantities;
}

function realizedProfitLoss(orders:AlpacaOrder[],prefix:string) {
  const state=new Map<string,{ qty:number;average:number }>();let realized=0;
  const fills=orders.filter((order) => order.client_order_id?.startsWith(prefix)&&Number(order.filled_qty)>0&&Number(order.filled_avg_price)>0).sort((a,b) => (a.filled_at??"").localeCompare(b.filled_at??""));
  for (const order of fills) {
    const price=Number(order.filled_avg_price);const signed=Number(order.filled_qty)*(order.side==="buy"?1:-1);const current=state.get(order.symbol)??{ qty:0,average:0 };
    if (!current.qty||Math.sign(current.qty)===Math.sign(signed)) { const total=Math.abs(current.qty)+Math.abs(signed);current.average=total?(Math.abs(current.qty)*current.average+Math.abs(signed)*price)/total:0;current.qty+=signed; }
    else { const closing=Math.min(Math.abs(current.qty),Math.abs(signed));const multiplier=/^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(order.symbol)?100:1;realized+=(current.qty>0?price-current.average:current.average-price)*closing*multiplier;const next=current.qty+signed;if (!next) current.average=0;else if (Math.sign(next)!==Math.sign(current.qty)) current.average=price;current.qty=next; }
    state.set(order.symbol,current);
  }
  return realized;
}

function demoResponse() {
  const positions:PositionRow[] = [
    { symbol:"NVDA",qty:.57,marketValue:100,costBasis:96,avgEntryPrice:168.42,currentPrice:175.44,unrealizedPnl:4,unrealizedPnlPct:4.17,dayChangePct:2.1,dayPnl:2.06 },
    { symbol:"PLTR",qty:.68,marketValue:100,costBasis:101,avgEntryPrice:148.53,currentPrice:147.06,unrealizedPnl:-1,unrealizedPnlPct:-.99,dayChangePct:.8,dayPnl:.79 },
  ];
  const categories = CATEGORIES.map((category,index) => ({
    ...category,marketValue:index < 2 ? 100 : 0,costBasis:index < 2 ? (index ? 101 : 96) : 0,
    unrealizedPnl:index < 2 ? (index ? -1 : 4) : 0,positionCount:index < 2 ? 1 : 0,
    dayPnl:index < 2 ? (index ? .79 : 2.06) : 0,returnPct:index < 2 ? (index ? -.99 : 4.17) : 0,realizedPnl:0,totalPnl:index < 2 ? (index ? -1 : 4) : 0,
    positions:index < 2 ? [positions[index]] : [],
  }));
  return { mode:"demo",asOf:new Date().toISOString(),summary:{ equity:100000,cash:99800,buyingPower:199600,totalMarketValue:200,totalCostBasis:197,totalUnrealizedPnl:3,positionCount:2 },categories };
}

export async function POST(request:Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error:"Sign in required" },{ status:401 });
  const profile=accountProfile(new URL(request.url).searchParams.get("profile"));const tradingBase=alpacaTradingBaseUrl(profile);
  const credentials = await getUserCredentials(user.email,profile).catch(() => null);
  const key = credentials?.keyId;
  const secret = credentials?.secretKey;
  if (!key || !secret) return Response.json(demoResponse());
  const headers = { "APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret };
  try {
    const [positionsResponse,ordersResponse,accountResponse] = await Promise.all([
      fetch(`${tradingBase}/v2/positions`,{ headers }),
      fetch(`${tradingBase}/v2/orders?status=all&limit=500&direction=desc&nested=false`,{ headers }),
      fetch(`${tradingBase}/v2/account`,{ headers }),
    ]);
    if (![positionsResponse,ordersResponse,accountResponse].every((response) => response.ok)) throw new Error("Alpaca positions unavailable");
    const actual = await positionsResponse.json() as AlpacaPosition[];
    const orders = await ordersResponse.json() as AlpacaOrder[];
    const account = await accountResponse.json() as Record<string,string>;
    const accountEquity=Math.max(0,Number(account.equity||0));
    const strategyAllocation=profile==="live"?Math.min(100,accountEquity)/CATEGORIES.length:1000;
    const claims = CATEGORIES.map((category) => ({ category,quantities:netQuantities(orders,`pulse-s-${category.code}-`) }));
    const legacy = netQuantities(orders,"pulse-top10-");
    const grouped = new Map<string,PositionRow[]>();
    for (const category of CATEGORIES) grouped.set(category.id,[]);
    grouped.set("legacy",[]);
    grouped.set("unassigned",[]);

    for (const position of actual) {
      const actualQty = Number(position.qty || 0);
      const actualMarketValue = Number(position.market_value || 0);
      const actualCostBasis = Number(position.cost_basis || 0);
      const currentPrice = Number(position.current_price || 0);
      const requested:{ id:string;qty:number }[] = claims.map(({ category,quantities }) => ({ id:category.id,qty:quantities.get(position.symbol) ?? 0 }));
      requested.push({ id:"legacy",qty:legacy.get(position.symbol) ?? 0 });
      const compatible = requested.filter((item) => Math.sign(item.qty) === Math.sign(actualQty));
      const totalRequested = compatible.reduce((sum,item) => sum+Math.abs(item.qty),0);
      const actualAbsolute = Math.abs(actualQty);
      const scale = totalRequested > actualAbsolute && totalRequested > 0 ? actualAbsolute/totalRequested : 1;
      let attributedQty = 0;

      for (const claim of compatible) {
        const qty = claim.qty*scale;
        if (Math.abs(qty) <= .000001) continue;
        attributedQty += qty;
        const fraction = actualAbsolute ? Math.abs(qty)/actualAbsolute : 0;
        const marketValue = Math.abs(actualMarketValue)*fraction;
        const costBasis = Math.abs(actualCostBasis)*fraction;
        grouped.get(claim.id)?.push({
          symbol:position.symbol,qty,marketValue,costBasis,avgEntryPrice:Number(position.avg_entry_price || 0),currentPrice,
          unrealizedPnl:Number(position.unrealized_pl || 0)*fraction,unrealizedPnlPct:Number(position.unrealized_plpc || 0)*100,
          dayChangePct:Number(position.change_today || 0)*100,dayPnl:Number(position.unrealized_intraday_pl || 0)*fraction,
        });
      }

      const remainder = actualQty-attributedQty;
      if (Math.abs(remainder) > .000001) {
        const fraction = actualQty ? Math.abs(remainder/actualQty) : 1;
        const marketValue = Math.abs(actualMarketValue)*fraction;
        const costBasis = Math.abs(actualCostBasis)*fraction;
        grouped.get("unassigned")?.push({
          symbol:position.symbol,qty:remainder,marketValue,costBasis,avgEntryPrice:Number(position.avg_entry_price || 0),currentPrice,
          unrealizedPnl:Number(position.unrealized_pl || 0)*fraction,unrealizedPnlPct:Number(position.unrealized_plpc || 0)*100,
          dayChangePct:Number(position.change_today || 0)*100,dayPnl:Number(position.unrealized_intraday_pl || 0)*fraction,
        });
      }
    }

    const categoryMeta = [
      ...CATEGORIES.map((category) => ({ ...category,allocation:strategyAllocation })),
      { id:"legacy",code:"legacy",name:"Legacy top-10 agent",allocation:profile==="live"?0:1000 },
      { id:"unassigned",code:"manual",name:"Unassigned / manual",allocation:0 },
    ];
    const categories = categoryMeta.map((category) => {
      const positions = grouped.get(category.id) ?? [];
      const costBasis = positions.reduce((sum,item) => sum+item.costBasis,0);
      const unrealizedPnl = positions.reduce((sum,item) => sum+item.unrealizedPnl,0);
      const realizedPnl=realizedProfitLoss(orders,category.id==="legacy"?"pulse-top10-":`pulse-s-${category.code}-`);
      return {
        ...category,positions,positionCount:positions.length,
        marketValue:positions.reduce((sum,item) => sum+item.marketValue,0),
        costBasis,unrealizedPnl,realizedPnl,totalPnl:realizedPnl+unrealizedPnl,returnPct:category.allocation ? (realizedPnl+unrealizedPnl)/category.allocation*100 : 0,
        dayPnl:positions.reduce((sum,item) => sum+item.dayPnl,0),
      };
    });
    await recordStrategyPerformance(user.email,profile,categories.filter((category) => CATEGORIES.some((item) => item.id===category.id)).map((category) => ({ strategyId:category.id,equity:category.allocation+category.totalPnl,totalPnl:category.totalPnl,realizedPnl:category.realizedPnl,unrealizedPnl:category.unrealizedPnl }))).catch(() => undefined);
    return Response.json({
      mode:"live",profile,asOf:new Date().toISOString(),
      summary:{
        equity:Number(account.equity || 0),cash:Number(account.cash || 0),buyingPower:Number(account.buying_power || 0),
        totalMarketValue:actual.reduce((sum,item) => sum+Number(item.market_value || 0),0),
        totalCostBasis:actual.reduce((sum,item) => sum+Number(item.cost_basis || 0),0),
        totalUnrealizedPnl:actual.reduce((sum,item) => sum+Number(item.unrealized_pl || 0),0),positionCount:actual.length,
      },
      categories,
    });
  } catch {
    return Response.json(demoResponse());
  }
}
