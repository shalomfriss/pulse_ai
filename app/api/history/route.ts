import { getChatGPTUser } from "../../chatgpt-auth";
import { accountProfile,getUserCredentials } from "../../../db/user-credentials";
import { fetchAlpacaHistory,fetchPublicDailyHistory,HISTORY_MAX_BARS,HISTORY_TIMEFRAMES } from "../../../lib/historical-data.mjs";

export const runtime = "edge";

type RequestBody={symbol?:string;timeframe?:string;start?:string;end?:string;profile?:string};

export async function GET(){
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:"Sign in required"},{status:401});
  return Response.json({timeframes:HISTORY_TIMEFRAMES,maximumBars:HISTORY_MAX_BARS,maximumYears:10});
}

export async function POST(request:Request){
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:"Sign in required"},{status:401});
  try{
    const body=await request.json() as RequestBody;
    const dataset=body.timeframe==="1Day"
      ? await fetchPublicDailyHistory(body,{maximumBars:HISTORY_MAX_BARS})
      : await fetchAlpacaHistory(body,await getUserCredentials(user.email,accountProfile(body.profile)),{maximumBars:HISTORY_MAX_BARS});
    return Response.json(dataset);
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Historical compilation failed"},{status:400});}
}
