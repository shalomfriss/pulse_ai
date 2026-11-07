import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle=await build({
  entryPoints:[new URL("../worker/index.ts",import.meta.url).pathname],bundle:true,write:false,platform:"node",format:"esm",
  plugins:[{name:"mock-worker-dependencies",setup(plugin){
    plugin.onResolve({filter:/^vinext\/server\/image-optimization$/},()=>({path:"images",namespace:"mock-worker"}));
    plugin.onResolve({filter:/^vinext\/server\/app-router-entry$/},()=>({path:"handler",namespace:"mock-worker"}));
    plugin.onResolve({filter:/rule-execution$/},()=>({path:"rules",namespace:"mock-worker"}));
    plugin.onLoad({filter:/.*/,namespace:"mock-worker"},(args)=>({
      contents:args.path==="images"
        ? 'export const handleImageOptimization=()=>new Response(); export const DEFAULT_DEVICE_SIZES=[]; export const DEFAULT_IMAGE_SIZES=[];'
        : args.path==="handler"
          ? 'export default {fetch:async()=>new Response()};'
          : 'export const runDueRuleSets=async(now)=>{globalThis.__pulseScheduledRunTime=now;return []};',
      loader:"js",
    }));
  }}],
});
const {default:worker}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("late cron invocation evaluates rules using its actual execution time",async()=>{
  const scheduledTime=Date.now()-60*60_000;
  let work;
  const before=Date.now();
  worker.scheduled({scheduledTime},{DB:{}},{waitUntil:(promise)=>{work=promise;}});
  await work;
  const observed=globalThis.__pulseScheduledRunTime;
  assert.ok(observed instanceof Date);
  assert.ok(observed.getTime()>=before&&observed.getTime()<=Date.now());
  assert.ok(observed.getTime()-scheduledTime>59*60_000);
  delete globalThis.__pulseScheduledRunTime;
});
