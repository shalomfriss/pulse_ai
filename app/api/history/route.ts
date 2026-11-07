import { getChatGPTUser } from "../../chatgpt-auth";
import { accountProfile,getUserCredentials } from "../../../db/user-credentials";
import { fetchAlpacaHistory,fetchPublicDailyHistory,HISTORY_MAX_BARS,HISTORY_TIMEFRAMES,normalizeHistoryRequest } from "../../../lib/historical-data.mjs";
import { fetchConfiguredHistory } from "../../../lib/configured-history.mjs";

export const runtime = "edge";

type RequestBody={symbol?:string;timeframe?:string;start?:string;end?:string;profile?:string};

export async function GET(){
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:"Sign in required"},{status:401});
  return Response.json({timeframes:HISTORY_TIMEFRAMES,maximumBars:HISTORY_MAX_BARS,maximumYears:20,configuredSource:Boolean(process.env.BACKTESTING_DATA_SOURCE),strictDaily:process.env.BACKTESTING_DATA_STRICT_DAILY==="true"});
}

export async function POST(request:Request){
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:"Sign in required"},{status:401});
  try{
    const body=await request.json() as RequestBody;
    const normalized=normalizeHistoryRequest(body);
    const configured=await fetchConfiguredHistory(body,process.env.BACKTESTING_DATA_SOURCE,{maximumBars:HISTORY_MAX_BARS,authToken:process.env.BACKTESTING_DATA_AUTH_TOKEN});
    if(!configured&&normalized.timeframe==="1Day"&&process.env.BACKTESTING_DATA_STRICT_DAILY==="true"){
      if(!process.env.BACKTESTING_DATA_SOURCE) return Response.json({error:"BACKTESTING_DATA_SOURCE is required for strict daily archive mode"},{status:503});
      return Response.json({error:`Configured daily archive has no file for ${normalized.symbol}`},{status:404});
    }
    const dataset=configured ?? (normalized.timeframe==="1Day"
      ? await fetchPublicDailyHistory(body,{maximumBars:HISTORY_MAX_BARS})
      : await fetchAlpacaHistory(body,await getUserCredentials(user.email,accountProfile(body.profile)),{maximumBars:HISTORY_MAX_BARS}));
    return Response.json(dataset);
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Historical compilation failed"},{status:400});}
}
