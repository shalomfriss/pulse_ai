import { getChatGPTUser } from "../../chatgpt-auth";
import { getAllStrategyPerformance,getStrategyPerformance } from "../../../db/strategy-state";
import { accountProfile } from "../../../db/user-credentials";

export async function GET(request:Request) {
  const user=await getChatGPTUser();if (!user) return Response.json({ error:"Sign in required" },{ status:401 });
  const params=new URL(request.url).searchParams;const strategyId=params.get("strategyId") ?? "";const profile=accountProfile(params.get("profile"));
  try {
    if (params.get("all")==="1") return Response.json({ profile,histories:await getAllStrategyPerformance(user.email,profile) });
    return Response.json({ profile,strategyId,points:await getStrategyPerformance(user.email,profile,strategyId) });
  }
  catch (error) { return Response.json({ error:error instanceof Error?error.message:"Performance history is unavailable" },{ status:400 }); }
}
