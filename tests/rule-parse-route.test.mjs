import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle=await build({
  entryPoints:[new URL("../app/api/rule-sets/parse/route.ts",import.meta.url).pathname],bundle:true,write:false,platform:"node",format:"esm",
  plugins:[{name:"mock-auth",setup(plugin){
    plugin.onResolve({filter:/^\.\.\/\.\.\/\.\.\/chatgpt-auth$/},()=>({path:"auth",namespace:"mock-auth"}));
    plugin.onLoad({filter:/.*/,namespace:"mock-auth"},()=>({contents:'export const getChatGPTUser=async()=>({email:"test@example.com"});',loader:"js"}));
  }}],
});
const {POST}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const prompt="Every weekday at 9:35 New York time, buy $100 of SPY if yesterday's close is above $500.";
const spec={name:"SPY close rule",unsupportedReason:"",schedule:{hour:9,minute:35},rules:[{symbol:"SPY",condition:{type:"close_above",threshold:500,fast:0,slow:0},action:"buy",notionalUsd:100}]};

test("AI rule route requests strict structured output and validates the returned rule",async()=>{
  const originalFetch=globalThis.fetch,originalKey=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY="test-key";
  let sent;
  globalThis.fetch=async(url,init)=>{
    sent={url,init,body:JSON.parse(init.body)};
    return Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(spec)}]}]});
  };
  try{
    const response=await POST(new Request("http://localhost/api/rule-sets/parse",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt})}));
    assert.equal(response.status,200);
    assert.equal(sent.url,"https://api.openai.com/v1/responses");
    assert.equal(sent.init.headers.authorization,"Bearer test-key");
    assert.equal(sent.body.store,false);
    assert.equal(sent.body.input,prompt);
    assert.equal(sent.body.text.format.type,"json_schema");
    assert.equal(sent.body.text.format.strict,true);
    assert.equal(sent.body.text.format.schema.additionalProperties,false);
    assert.match(sent.body.instructions,/raw, as-traded daily close above\/below a fixed USD price/);
    assert.match(sent.body.instructions,/adjusted close for a fixed dollar threshold.*unsupported/);
    assert.match(sent.body.instructions,/unadjusted close for an SMA.*unsupported/);
    assert.deepEqual((await response.json()).spec,{...spec,semanticsVersion:2});
  }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;}
});

test("AI rule route rejects a structurally valid but unsupported trade",async()=>{
  const originalFetch=globalThis.fetch,originalKey=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY="test-key";
  globalThis.fetch=async()=>Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({...spec,rules:[{...spec.rules[0],notionalUsd:1_000_000}]})}]}]});
  try{
    const response=await POST(new Request("http://localhost/api/rule-sets/parse",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt})}));
    assert.equal(response.status,422);
    assert.match((await response.json()).error,/invalid trade amount/);
  }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;}
});
