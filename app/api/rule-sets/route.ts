import { getChatGPTUser } from "../../chatgpt-auth";
import { accountProfile } from "../../../db/user-credentials";
import { createRuleSet,deleteRuleSet,getRuleSet,listRuleRuns,listRuleSets,updateRuleSet } from "../../../db/rule-sets";

export const runtime="edge";

export async function GET(request:Request){
  const user=await getChatGPTUser();
  if(!user) return Response.json({error:"Sign in required"},{status:401});
  const url=new URL(request.url),id=url.searchParams.get("id");
  try {
    if(id){const ruleSet=await getRuleSet(user.email,id);return ruleSet?Response.json({ruleSet,runs:await listRuleRuns(id)}):Response.json({error:"Rule set not found"},{status:404});}
    return Response.json({ruleSets:await listRuleSets(user.email,accountProfile(url.searchParams.get("profile")))});
  }
  catch(error){return Response.json({error:error instanceof Error?error.message:"Could not load rule sets"},{status:503});}
}

export async function POST(request:Request){
  const user=await getChatGPTUser();
  if(!user) return Response.json({error:"Sign in required"},{status:401});
  const body=await request.json().catch(()=>({})) as {profile?:unknown;prompt?:unknown;spec?:unknown};
  try {
    if(typeof body.prompt!=="string") throw new Error("Source instructions are required");
    const ruleSet=await createRuleSet(user.email,accountProfile(body.profile),body.prompt.trim(),body.spec);
    return Response.json({ruleSet},{status:201});
  } catch(error){return Response.json({error:error instanceof Error?error.message:"Could not save rule set"},{status:400});}
}

export async function PUT(request:Request){
  const user=await getChatGPTUser();
  if(!user) return Response.json({error:"Sign in required"},{status:401});
  const body=await request.json().catch(()=>({})) as {id?:unknown;enabled?:unknown;spec?:unknown};
  if(typeof body.id!=="string"||!/^[a-f0-9-]{36}$/i.test(body.id)) return Response.json({error:"Valid rule set ID required"},{status:400});
  try {
    const ruleSet=await updateRuleSet(user.email,body.id,{enabled:body.enabled as boolean|undefined,spec:body.spec});
    return Response.json({ruleSet});
  } catch(error){return Response.json({error:error instanceof Error?error.message:"Could not update rule set"},{status:400});}
}

export async function DELETE(request:Request){
  const user=await getChatGPTUser();
  if(!user) return Response.json({error:"Sign in required"},{status:401});
  const id=new URL(request.url).searchParams.get("id")??"";
  if(!/^[a-f0-9-]{36}$/i.test(id)) return Response.json({error:"Valid rule set ID required"},{status:400});
  try {await deleteRuleSet(user.email,id);return Response.json({deleted:true});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Could not delete rule set"},{status:400});}
}
