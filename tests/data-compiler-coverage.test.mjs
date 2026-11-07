import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("daily compiler coverage follows validated bars after rejecting a provider row",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"pulse-daily-compiler-"));
  const preload=join(directory,"mock-fetch.mjs");
  const days=["2024-01-02","2024-01-03","2024-01-04"];
  const payload={chart:{result:[{
    timestamp:days.map((day)=>Date.parse(`${day}T14:30:00.000Z`)/1000),
    indicators:{quote:[{open:[0,10,11],high:[11,12,13],low:[9,9,10],close:[10,11,12],volume:[100,200,300]}],adjclose:[{adjclose:[10,11,12]}]},
  }]}};
  try{
    await writeFile(preload,`globalThis.fetch=async()=>Response.json(${JSON.stringify(payload)});\n`);
    const run=spawnSync(process.execPath,["--import",preload,"scripts/compile-backtesting-data.mjs","SPY","--limit","1"],{
      cwd:new URL("../",import.meta.url),encoding:"utf8",env:{...process.env,BACKTESTING_DATA_SOURCE:directory},
    });
    assert.equal(run.status,0,run.stderr||run.stdout);
    const record=JSON.parse(await readFile(join(directory,"SPY.1Day.json"),"utf8"));
    assert.equal(record.coverageStart,"2024-01-03T00:00:00.000Z");
    assert.equal(record.coverageEnd,"2024-01-05T00:00:00.000Z");
    assert.equal(record.bars.length,2);
    assert.match(run.stdout,/1 invalid provider bar\(s\) removed/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
