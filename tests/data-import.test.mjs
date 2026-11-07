import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir,mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("CSV import and audit preserve a one-day listing",async()=>{
  const root=await mkdtemp(join(tmpdir(),"pulse-one-day-listing-"));
  const source=join(root,"source"),output=join(root,"output");
  await mkdir(source);
  try{
    await writeFile(join(source,"NEW_day.csv"),"date,close,adj_open,adj_high,adj_low,adj_close,adj_volume\n2026-10-27,20,10,11,9,10,1000\n");
    const imported=spawnSync("python3",["scripts/import-backtesting-csv.py",source,"--output",output,"--start","2026-10-01","--end","2026-10-28"],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
    assert.equal(imported.status,0,imported.stderr);
    const archive=JSON.parse(await readFile(join(output,"NEW.1Day.json"),"utf8"));
    assert.equal(archive.bars.length,1);
    assert.equal(archive.bars[0].rawClose,20);
    const audited=spawnSync("python3",["scripts/audit-backtesting-data.py","--directory",output,"--expected-source",source],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
    assert.equal(audited.status,0,audited.stdout);
    assert.equal(JSON.parse(audited.stdout).totalBars,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("CSV import preserves a valid archive when a later source contains corrupt rows",async()=>{
  const root=await mkdtemp(join(tmpdir(),"pulse-csv-import-"));
  const source=join(root,"source"),output=join(root,"output");
  await mkdir(source);
  const csv=join(source,"SPY_day.csv"),archive=join(output,"SPY.1Day.json");
  const header="date,adj_open,adj_high,adj_low,adj_close,adj_volume\n";
  const rows="2024-01-02,100,101,99,100,1000\n2024-01-03,101,102,100,101,1200\n";
  const run=()=>spawnSync("python3",["scripts/import-backtesting-csv.py",source,"--output",output,"--start","2024-01-01","--end","2024-01-10","--replace"],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
  try{
    await writeFile(csv,header+rows);
    assert.equal(run().status,0);
    const valid=await readFile(archive,"utf8");
    await writeFile(csv,header+rows+"2024-01-04,101,99,100,101,900\n");
    const corrupt=run();
    assert.equal(corrupt.status,1);
    assert.match(corrupt.stderr,/archive was not written/);
    assert.equal(await readFile(archive,"utf8"),valid);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("CSV import skips declared event-only rows but rejects unexplained blank prices",async()=>{
  const root=await mkdtemp(join(tmpdir(),"pulse-csv-events-"));
  const source=join(root,"source"),output=join(root,"output");
  await mkdir(source);
  const csv=join(source,"SPY_day.csv"),archive=join(output,"SPY.1Day.json");
  const header="date,open,high,low,close,volume,transactions,adj_open,adj_high,adj_low,adj_close,adj_volume,dividend,split\n";
  const rows="2024-01-02,100,101,99,100,1000,20,100,101,99,100,1000,,\n2024-01-03,,,,,0,0,,,,,0,0.5,\n2024-01-04,101,102,100,101,1200,30,101,102,100,101,1200,,\n";
  const run=()=>spawnSync("python3",["scripts/import-backtesting-csv.py",source,"--output",output,"--start","2024-01-01","--end","2024-01-10","--replace"],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
  try{
    await writeFile(csv,header+rows);
    const imported=run();
    assert.equal(imported.status,0,imported.stderr);
    assert.equal(JSON.parse(imported.stdout.trim().split("\n").at(-1)).event_only_rows,1);
    const valid=await readFile(archive,"utf8");
    assert.deepEqual(JSON.parse(valid).bars.map((bar)=>bar.timestamp.slice(0,10)),["2024-01-02","2024-01-04"]);
    assert.deepEqual(JSON.parse(valid).bars.map((bar)=>bar.rawClose),[100,101]);
    await writeFile(csv,header+rows+"2024-01-05,,,,,0,0,,,,,0,,\n");
    const corrupt=run();
    assert.equal(corrupt.status,1);
    assert.match(corrupt.stderr,/archive was not written/);
    assert.equal(await readFile(archive,"utf8"),valid);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("CSV import keeps reused ticker listings separate",async()=>{
  const root=await mkdtemp(join(tmpdir(),"pulse-reused-ticker-"));
  const source=join(root,"source"),output=join(root,"output");
  await mkdir(source);
  const header="date,adj_open,adj_high,adj_low,adj_close,adj_volume\n";
  const run=()=>spawnSync("python3",["scripts/import-backtesting-csv.py",source,"--output",output,"--start","2006-01-01","--end","2023-01-01"],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
  try{
    await writeFile(join(source,"TWTR_day_delisted_2007-06-21.csv"),header+"2007-06-18,1,2,1,1.5,100\n2007-06-19,1,2,1,1.4,100\n");
    await writeFile(join(source,"TWTR_day_delisted_2022-10-31.csv"),header+"2022-10-26,50,51,49,50,1000\n2022-10-27,50,51,49,50,1000\n");
    assert.equal(run().status,0);
    const archive=JSON.parse(await readFile(join(output,"TWTR.1Day.json"),"utf8"));
    assert.equal(archive.listings.length,2);
    assert.equal(archive.listings[0].bars.at(-1).close,1.4);
    assert.equal(archive.listings[1].bars[0].close,50);
    const audit=spawnSync("python3",["scripts/audit-backtesting-data.py","--directory",output],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
    assert.equal(audit.status,0);
    const report=JSON.parse(audit.stdout);
    assert.equal(report.symbolCount,1);
    assert.equal(report.listingCount,2);
    assert.equal(report.knownDelistedCount,2);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("listing-aware import can replace a Yahoo archive that is only one day newer",async()=>{
  const root=await mkdtemp(join(tmpdir(),"pulse-import-upgrade-"));
  const source=join(root,"source"),output=join(root,"output");
  await mkdir(source);await mkdir(output);
  const archive=join(output,"SPY.1Day.json");
  const bar=(day)=>({timestamp:`${day}T14:30:00.000Z`,open:100,high:101,low:99,close:100,volume:1000});
  try{
    await writeFile(archive,JSON.stringify({symbol:"SPY",timeframe:"1Day",provider:"yahoo-chart",adjusted:true,coverageStart:"2024-01-02T00:00:00.000Z",coverageEnd:"2024-01-05T00:00:00.000Z",bars:[bar("2024-01-02"),bar("2024-01-03"),bar("2024-01-04")]}));
    await writeFile(join(source,"SPY_day.csv"),"date,adj_open,adj_high,adj_low,adj_close,adj_volume\n2024-01-02,10,11,9,10,1000\n2024-01-03,11,12,10,11,1100\n");
    const result=spawnSync("python3",["scripts/import-backtesting-csv.py",source,"--output",output,"--start","2024-01-01","--end","2024-01-10"],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    const imported=JSON.parse(await readFile(archive,"utf8"));
    assert.equal(imported.provider,"adjusted-csv-import");
    assert.equal(imported.listingId,"SPY_day");
    assert.deepEqual(imported.bars.map((item)=>item.close),[10,11]);
  }finally{await rm(root,{recursive:true,force:true});}
});
