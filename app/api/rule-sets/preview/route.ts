import { getChatGPTUser } from "../../../chatgpt-auth";
import { getRuleSet } from "../../../../db/rule-sets";
import { previewRuleSet } from "../../../../lib/rule-execution";

export const runtime="edge";

export async function GET(request:Request){
  const user=await getChatGPTUser();
  if(!user) return Response.json({error:"Sign in required"},{status:401});
  const id=new URL(request.url).searchParams.get("id");
  if(!id) return Response.json({error:"Choose a saved rule set"},{status:400});
  try{
    const ruleSet=await getRuleSet(user.email,id);
    if(!ruleSet) return Response.json({error:"Rule set not found"},{status:404});
    if(ruleSet.requiresReview) return Response.json({error:"Reparse and inspect this older price-threshold set before previewing it"},{status:409});
    return Response.json({preview:await previewRuleSet({...ruleSet,email:user.email})});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Could not preview rule set"},{status:503});
  }
}
