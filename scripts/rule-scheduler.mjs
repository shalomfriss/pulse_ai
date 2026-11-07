const base=(process.env.RULE_SCHEDULER_APP_URL||"http://127.0.0.1:3000").replace(/\/$/,"");
const secret=process.env.RULE_SCHEDULER_SECRET;
if(!secret) throw new Error("RULE_SCHEDULER_SECRET is required");
let running=false;
async function tick(){
  if(running) return;
  running=true;
  try {
    const response=await fetch(`${base}/api/rule-sets/run-due`,{method:"POST",headers:{"x-rule-scheduler-token":secret},signal:AbortSignal.timeout(50_000)});
    if(!response.ok) console.error(`Rule scheduler check failed (${response.status})`);
    else {
      const payload=await response.json();
      if(payload.runs?.length) console.log(`Rule scheduler ran ${payload.runs.length} rule set(s)`);
    }
  } catch(error){console.error(`Rule scheduler check failed: ${error instanceof Error?error.message:String(error)}`);}
  finally {running=false;}
}
setTimeout(()=>{void tick();setInterval(()=>void tick(),60_000);},30_000);
