import { getChatGPTUser } from "../../chatgpt-auth";
import { accountProfile, getUserCredentials } from "../../../db/user-credentials";
import { DAY_TRADING_ELEMENTS, MAX_INTRADAY_BARS, optimizeDayTrading, runDayTradingBacktest } from "../../../lib/daytrading.mjs";
import { fetchAlpacaHistory,validateHistorySymbol } from "../../../lib/historical-data.mjs";

export const runtime = "edge";

type RequestBody={
  mode?:"backtest"|"optimize";source?:"alpaca"|"upload";symbol?:string;timeframe?:string;start?:string;end?:string;profile?:string;bars?:unknown[];
  initialCapital?:number;commission?:number;slippageBps?:number;configuration?:Record<string,unknown>;
};

const TIMEFRAMES=new Set(["1Hour","15Min","5Min"]);
const MAX_REQUEST_BYTES=35_000_000;

async function alpacaBars(body:RequestBody,email:string){
  const credentials=await getUserCredentials(email,accountProfile(body.profile));
  return fetchAlpacaHistory(body,credentials,{maximumBars:MAX_INTRADAY_BARS,timeframes:["1Hour","15Min","5Min"],defaultTimeframe:"15Min"});
}

export async function GET(){
  const user=await getChatGPTUser();if(!user)return Response.json({error:"Sign in required"},{status:401});
  return Response.json({elements:DAY_TRADING_ELEMENTS,timeframes:["1Hour","15Min","5Min"],maximumBars:MAX_INTRADAY_BARS});
}

export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return Response.json({error:"Sign in required"},{status:401});
  try{
    const contentLength=Number(request.headers.get("content-length")??0);if(contentLength>MAX_REQUEST_BYTES)throw new Error("Uploaded dataset exceeds the 35 MB request limit");
    const body=await request.json() as RequestBody;
    const dataset=body.source==="upload"?{symbol:validateHistorySymbol(body.symbol||"CSV"),timeframe:TIMEFRAMES.has(String(body.timeframe))?String(body.timeframe):"uploaded",bars:body.bars??[]}:await alpacaBars(body,user.email);
    const input={bars:dataset.bars,initialCapital:Number(body.initialCapital??25_000),commission:Number(body.commission??0),slippageBps:Number(body.slippageBps??3),configuration:body.configuration??{}};
    const result=body.mode==="optimize"?optimizeDayTrading(input):runDayTradingBacktest(input);
    return Response.json({symbol:dataset.symbol,timeframe:dataset.timeframe,mode:body.mode??"backtest",...result});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Day-trading test failed"},{status:400});}
}
