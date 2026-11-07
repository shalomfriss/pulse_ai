import { getChatGPTUser } from "../../../chatgpt-auth";
import { RULE_SPEC_SCHEMA,validateRuleSpec } from "../../../../lib/rule-spec.mjs";

export const runtime="edge";

export async function POST(request:Request) {
  const user=await getChatGPTUser();
  if(!user) return Response.json({error:"Sign in required"},{status:401});
  const body=await request.json().catch(()=>({})) as {prompt?:unknown};
  const prompt=typeof body.prompt==="string"?body.prompt.trim():"";
  if(prompt.length<15||prompt.length>3000) return Response.json({error:"Describe the rule in 15–3,000 characters"},{status:400});
  const key=process.env.OPENAI_API_KEY;
  if(!key) return Response.json({error:"Rule parsing requires OPENAI_API_KEY on the server"},{status:503});
  try {
    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},
      signal:AbortSignal.timeout(45_000),
      body:JSON.stringify({
        model:process.env.OPENAI_RULE_MODEL||"gpt-4o-mini",
        store:false,
        instructions:"Translate the user's stock-trading instructions into the exact rule schema. Supported conditions are the last completed raw, as-traded daily close above/below a fixed USD price, or fast SMA crossing above/below slow SMA on completed split-and-dividend-adjusted daily closes. When the user says only 'close' with a fixed dollar threshold, use raw close. If the user explicitly requests an adjusted close for a fixed dollar threshold, or an unadjusted close for an SMA, mark the request unsupported; never silently change the requested price basis. Schedules are weekday times between 9:30 AM and 3:55 PM America/New_York. Buy uses a fixed USD notional; sell closes the entire position in the requested symbol. Never invent a ticker, amount, condition, or schedule. If any part cannot be represented, set unsupportedReason to a clear explanation and rules to an empty array. Set unused condition numbers to 0. A schedule omitted by the user is unsupported. Do not execute orders.",
        input:prompt,
        text:{format:{type:"json_schema",name:"trading_rule_set",strict:true,schema:RULE_SPEC_SCHEMA}},
      }),
    });
    const payload=await response.json() as {status?:string;error?:{message?:string};output?:{type?:string;content?:{type?:string;text?:string;refusal?:string}[]}[]};
    if(!response.ok) throw new Error(payload.error?.message||`AI parser returned ${response.status}`);
    if(payload.status!=="completed") throw new Error("AI parser did not complete");
    const content=payload.output?.flatMap((item)=>item.content??[])??[];
    const refusal=content.find((item)=>item.type==="refusal")?.refusal;
    if(refusal) throw new Error(refusal);
    const output=content.find((item)=>item.type==="output_text")?.text;
    if(!output) throw new Error("AI parser returned no rule set");
    const spec={...validateRuleSpec(JSON.parse(output)),semanticsVersion:2};
    return Response.json({spec,prompt});
  } catch(error) {
    return Response.json({error:error instanceof Error?error.message:"Rule parsing failed"},{status:422});
  }
}
