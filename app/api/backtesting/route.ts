import { getChatGPTUser } from "../../chatgpt-auth";
import { accountProfile, getUserCredentials } from "../../../db/user-credentials";
import { MAX_BARS, runBacktest, strategyCatalog } from "../../../lib/backtesting.mjs";
import { fetchAlpacaHistory,HISTORY_TIMEFRAMES,validateHistorySymbol } from "../../../lib/historical-data.mjs";

export const runtime = "edge";

type RequestBody = {
  source?:"alpaca"|"upload";
  symbol?:string;
  timeframe?:string;
  start?:string;
  end?:string;
  profile?:string;
  bars?:unknown[];
  strategy?:string;
  initialCapital?:number;
  commission?:number;
  slippageBps?:number;
  parameters?:Record<string,number>;
};

const TIMEFRAMES = new Set(HISTORY_TIMEFRAMES);
const MAX_REQUEST_BYTES = 40_000_000;

async function alpacaBars(body:RequestBody,email:string) {
  const credentials=await getUserCredentials(email,accountProfile(body.profile));
  return fetchAlpacaHistory(body,credentials,{maximumBars:MAX_BARS,defaultTimeframe:"1Day"});
}

export async function GET() {
  const user=await getChatGPTUser();
  if (!user) return Response.json({ error:"Sign in required" },{ status:401 });
  return Response.json({ strategies:strategyCatalog,timeframes:HISTORY_TIMEFRAMES,maximumYears:10,maximumBars:MAX_BARS,localCache:true });
}

export async function POST(request:Request) {
  const user=await getChatGPTUser();
  if (!user) return Response.json({ error:"Sign in required" },{ status:401 });
  try {
    const contentLength=Number(request.headers.get("content-length")??0);
    if (contentLength>MAX_REQUEST_BYTES) throw new Error("Uploaded dataset exceeds the 40 MB request limit");
    const body=await request.json() as RequestBody;
    const dataset=body.source==="upload"
      ? { symbol:validateHistorySymbol(body.symbol||"CSV"),timeframe:TIMEFRAMES.has(String(body.timeframe))?String(body.timeframe):"uploaded",bars:body.bars??[] }
      : await alpacaBars(body,user.email);
    const result=runBacktest({
      bars:dataset.bars,
      strategy:String(body.strategy??"buy-hold"),
      initialCapital:Number(body.initialCapital??10_000),
      commission:Number(body.commission??0),
      slippageBps:Number(body.slippageBps??5),
      parameters:body.parameters??{},
      timeframe:dataset.timeframe,
    });
    return Response.json({ symbol:dataset.symbol,timeframe:dataset.timeframe,...result });
  } catch (error) {
    return Response.json({ error:error instanceof Error?error.message:"Backtest failed" },{ status:400 });
  }
}
