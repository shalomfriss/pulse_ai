import { getChatGPTUser } from "../../chatgpt-auth";
import { accountProfile, alpacaTradingBaseUrl, getUserCredentials } from "../../../db/user-credentials";

const STRATEGIES = [
  { code:"mom",name:"Medium-term momentum" },
  { code:"qv",name:"Quality + value" },
  { code:"earn",name:"Earnings-surprise drift" },
  { code:"rev",name:"Short-term reversal" },
  { code:"news",name:"News-catalyst momentum" },
  { code:"scalp",name:"Intraday momentum" },
  { code:"orb",name:"Opening-range breakout" },
  { code:"vwap",name:"VWAP reclaim / rejection" },
  { code:"gap",name:"Gap continuation / fade" },
  { code:"squeeze",name:"Volatility-squeeze breakout" },
  { code:"close",name:"Closing-session momentum" },
  { code:"flow",name:"Order-flow imbalance" },
  { code:"medal",name:"Medallion" },
] as const;

type AlpacaOrder = {
  id:string;symbol:string;side:"buy"|"sell";status:string;type:string;
  filled_qty:string;filled_avg_price?:string;filled_at?:string;submitted_at:string;
  client_order_id:string;
};

function strategyFor(clientOrderId:string) {
  if (clientOrderId.startsWith("pulse-top10-")) return { code:"legacy",name:"Legacy top-10 agent" };
  const match = STRATEGIES.find((strategy) => clientOrderId.startsWith(`pulse-s-${strategy.code}-`));
  return match ?? { code:"manual",name:"Unassigned / manual" };
}

function demoResponse() {
  const now=Date.now();
  return { mode:"demo",asOf:new Date().toISOString(),transactions:[
    { id:"demo-1",symbol:"NVDA",side:"buy",status:"filled",qty:.57,price:168.42,total:96,filledAt:new Date(now-18*60_000).toISOString(),strategyCode:"mom",strategyName:"Medium-term momentum" },
    { id:"demo-2",symbol:"PLTR",side:"buy",status:"filled",qty:.68,price:148.53,total:101,filledAt:new Date(now-47*60_000).toISOString(),strategyCode:"qv",strategyName:"Quality + value" },
    { id:"demo-3",symbol:"AMD",side:"sell",status:"filled",qty:.62,price:161.29,total:100,filledAt:new Date(now-2.4*60*60_000).toISOString(),strategyCode:"news",strategyName:"News-catalyst momentum" },
  ] };
}

export async function GET(request:Request) {
  const user=await getChatGPTUser();
  if (!user) return Response.json({ error:"Sign in required" },{ status:401 });
  const profile=accountProfile(new URL(request.url).searchParams.get("profile"));const tradingBase=alpacaTradingBaseUrl(profile);
  const credentials=await getUserCredentials(user.email,profile).catch(() => null);
  if (!credentials?.keyId || !credentials.secretKey) return Response.json(demoResponse());
  const headers={ "APCA-API-KEY-ID":credentials.keyId,"APCA-API-SECRET-KEY":credentials.secretKey };
  try {
    const response=await fetch(`${tradingBase}/v2/orders?status=all&limit=500&direction=desc&nested=false`,{ headers });
    if (!response.ok) throw new Error("Alpaca transaction history unavailable");
    const orders=await response.json() as AlpacaOrder[];
    const transactions=orders
      .filter((order) => Number(order.filled_qty)>0)
      .map((order) => {
        const strategy=strategyFor(order.client_order_id ?? "");
        const qty=Number(order.filled_qty || 0);const price=Number(order.filled_avg_price || 0);
        const multiplier=/^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(order.symbol)?100:1;
        return { id:order.id,symbol:order.symbol,side:order.side,status:order.status,qty,price,total:qty*price*multiplier,filledAt:order.filled_at ?? order.submitted_at,strategyCode:strategy.code,strategyName:strategy.name };
      });
    return Response.json({ mode:"live",profile,asOf:new Date().toISOString(),transactions });
  } catch {
    return Response.json(demoResponse());
  }
}
