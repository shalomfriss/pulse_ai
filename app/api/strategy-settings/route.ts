import { getChatGPTUser } from "../../chatgpt-auth";
import { getPausedStrategies,setStrategyPaused,STRATEGY_IDS } from "../../../db/strategy-state";
import { accountProfile } from "../../../db/user-credentials";

export async function GET(request:Request) {
  const user=await getChatGPTUser();if (!user) return Response.json({ error:"Sign in required" },{ status:401 });
  const profile=accountProfile(new URL(request.url).searchParams.get("profile"));
  try { const paused=await getPausedStrategies(user.email,profile);return Response.json({ profile,strategies:STRATEGY_IDS.map((strategyId) => ({ strategyId,paused:paused.has(strategyId) })) }); }
  catch { return Response.json({ error:"Strategy controls are unavailable" },{ status:503 }); }
}

export async function PUT(request:Request) {
  const user=await getChatGPTUser();if (!user) return Response.json({ error:"Sign in required" },{ status:401 });
  const body=await request.json().catch(() => ({})) as { profile?:string;strategyId?:string;paused?:boolean };const profile=accountProfile(body.profile);
  if (!body.strategyId||typeof body.paused!=="boolean") return Response.json({ error:"Strategy and pause state are required" },{ status:400 });
  try { return Response.json(await setStrategyPaused(user.email,profile,body.strategyId,body.paused)); }
  catch (error) { return Response.json({ error:error instanceof Error?error.message:"Strategy control failed" },{ status:400 }); }
}
