import { runDueRuleSets } from "../../../../lib/rule-execution";

export const runtime="edge";

export async function POST(request:Request){
  const secret=process.env.RULE_SCHEDULER_SECRET;
  if(!secret) return Response.json({error:"Rule scheduler is not configured"},{status:503});
  if(request.headers.get("x-rule-scheduler-token")!==secret) return Response.json({error:"Unauthorized"},{status:401});
  try {return Response.json({checkedAt:new Date().toISOString(),runs:await runDueRuleSets()});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Rule scheduler failed"},{status:503});}
}
