import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp,readFile,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("coverage repair narrows generated daily metadata without changing bars",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"pulse-coverage-repair-"));
  const path=join(directory,"SPY.1Day.json");
  const bars=["2024-01-02","2024-01-03"].map((day)=>({timestamp:`${day}T14:30:00.000Z`,open:100,high:101,low:99,close:100,volume:1000}));
  const record={symbol:"SPY",timeframe:"1Day",provider:"yahoo-chart",adjusted:true,coverageStart:"2024-01-01T00:00:00.000Z",coverageEnd:"2024-01-08T00:00:00.000Z",bars};
  const run=()=>spawnSync("python3",["scripts/repair-backtesting-coverage.py","--directory",directory],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
  const audit=()=>spawnSync("python3",["scripts/audit-backtesting-data.py","--directory",directory],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
  try{
    await writeFile(path,JSON.stringify(record));
    assert.equal(audit().status,1);
    const repaired=run();
    assert.equal(repaired.status,0,repaired.stdout);
    assert.equal(JSON.parse(repaired.stdout).fixed,1);
    const result=JSON.parse(await readFile(path,"utf8"));
    assert.equal(result.coverageStart,"2024-01-02T00:00:00.000Z");
    assert.equal(result.coverageEnd,"2024-01-04T00:00:00.000Z");
    assert.deepEqual(result.bars,bars);
    assert.equal(audit().status,0);
    assert.equal(JSON.parse(run().stdout).unchanged,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("coverage repair accepts a one-day archive",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"pulse-one-day-repair-"));
  const path=join(directory,"NEW.1Day.json");
  const bar={timestamp:"2026-10-27T14:30:00.000Z",open:10,high:11,low:9,close:10,volume:1000};
  try{
    await writeFile(path,JSON.stringify({symbol:"NEW",timeframe:"1Day",provider:"yahoo-chart",adjusted:true,coverageStart:"2026-10-01T00:00:00.000Z",coverageEnd:"2026-10-28T00:00:00.000Z",bars:[bar]}));
    const repaired=spawnSync("python3",["scripts/repair-backtesting-coverage.py","--directory",directory],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
    assert.equal(repaired.status,0,repaired.stdout);
    const archive=JSON.parse(await readFile(path,"utf8"));
    assert.equal(archive.coverageStart,"2026-10-27T00:00:00.000Z");
    assert.equal(archive.coverageEnd,"2026-10-28T00:00:00.000Z");
  }finally{await rm(directory,{recursive:true,force:true});}
});
