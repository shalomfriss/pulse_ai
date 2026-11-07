import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("archive audit rejects malformed prices and dates before reporting market coverage",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"pulse-archive-audit-"));
  const path=join(directory,"SPY.1Day.json");
  const bars=["2024-01-02","2024-01-03"].map((day)=>({timestamp:`${day}T00:00:00.000Z`,open:100,high:101,low:99,close:100,volume:1000}));
  const record={symbol:"SPY",timeframe:"1Day",adjusted:true,inactive:true,coverageStart:"2024-01-02T00:00:00.000Z",coverageEnd:"2024-01-04T00:00:00.000Z",bars};
  const audit=()=>spawnSync("python3",["scripts/audit-backtesting-data.py","--directory",directory],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
  try{
    await writeFile(path,JSON.stringify(record));
    const valid=audit();
    assert.equal(valid.status,0);
    assert.deepEqual(JSON.parse(valid.stdout).barsByYear,{"2024":2});
    assert.equal(JSON.parse(valid.stdout).inactiveListingCount,1);
    assert.equal(JSON.parse(valid.stdout).knownDelistedCount,0);
    assert.deepEqual(JSON.parse(valid.stdout).seriesWithBarsByYear,{"2024":1});
    const expected=join(directory,"expected.txt"),missing=join(directory,"missing.txt"),universe=join(directory,"universe.json");
    await writeFile(expected,"SPY\nQQQ\n");
    await writeFile(universe,JSON.stringify({symbols:[{symbol:"SPY",name:"SPDR S&P 500 ETF",etf:true},{symbol:"QQQ",name:"Invesco QQQ ETF",etf:true}]}));
    const inventory=spawnSync("python3",["scripts/audit-backtesting-data.py","--directory",directory,"--expected-symbols",expected,"--expected-universe",universe,"--missing-output",missing],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
    assert.equal(inventory.status,1);
    assert.equal(JSON.parse(inventory.stdout).missingExpectedCount,1);
    assert.deepEqual(JSON.parse(inventory.stdout).missingExpectedByType,{ETF:1});
    assert.equal(await readFile(missing,"utf8"),"QQQ\n");
    record.bars[1].high=98;
    await writeFile(path,JSON.stringify(record));
    const invalidPrice=audit();
    assert.equal(invalidPrice.status,1);
    assert.match(invalidPrice.stdout,/invalid adjusted OHLCV/);
    record.bars[1].high=101;
    record.bars[1].timestamp="2024-99-03T00:00:00.000Z";
    await writeFile(path,JSON.stringify(record));
    const invalidDate=audit();
    assert.equal(invalidDate.status,1);
    assert.match(invalidDate.stdout,/invalid timestamp/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("archive audit checks each imported listing against its source inventory",async()=>{
  const root=await mkdtemp(join(tmpdir(),"pulse-listing-audit-"));
  const source=join(root,"source"),directory=join(root,"output");
  const {mkdir}=await import("node:fs/promises");
  try{
    await mkdir(source);
    const csv="date,adj_open,adj_high,adj_low,adj_close,adj_volume\n2024-01-02,10,11,9,10,1000\n2024-01-03,11,12,10,11,1100\n";
    await writeFile(join(source,"AAA_day.csv"),csv);
    await writeFile(join(source,"BBB_day_delisted_2024-01-04.csv"),csv);
    const imported=spawnSync("python3",["scripts/import-backtesting-csv.py",source,"--output",directory,"--start","2024-01-01","--end","2024-01-31"],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
    assert.equal(imported.status,0,imported.stderr);
    const audit=()=>spawnSync("python3",["scripts/audit-backtesting-data.py","--directory",directory,"--expected-source",source],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
    const complete=audit();
    assert.equal(complete.status,0,complete.stdout);
    assert.equal(JSON.parse(complete.stdout).expectedListingCount,2);
    assert.equal(JSON.parse(complete.stdout).knownDelistedCount,1);
    assert.equal(JSON.parse(complete.stdout).inactiveListingCount,0);
    assert.deepEqual(JSON.parse(complete.stdout).barsByYear,{"2024":4});
    assert.deepEqual(JSON.parse(complete.stdout).seriesWithBarsByYear,{"2024":2});
    await rm(join(directory,"BBB.1Day.json"));
    const incomplete=audit();
    assert.equal(incomplete.status,1);
    assert.deepEqual(JSON.parse(incomplete.stdout).missingExpectedListings,[{symbol:"BBB",listingId:"BBB_day_delisted_2024-01-04"}]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("in-range import inventory distinguishes old-only files and detects shortened listings",async()=>{
  const root=await mkdtemp(join(tmpdir(),"pulse-import-inventory-"));
  const source=join(root,"source"),directory=join(root,"output"),inventoryPath=join(root,"inventory.json");
  const {mkdir}=await import("node:fs/promises");
  const header="date,adj_open,adj_high,adj_low,adj_close,adj_volume\n";
  const row=(day)=>`${day},10,11,9,10,1000\n`;
  const run=(script,args)=>spawnSync("python3",[script,...args],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
  try{
    await mkdir(source);
    await writeFile(join(source,"AAA_day.csv"),header+row("2024-01-02")+row("2024-01-03"));
    await writeFile(join(source,"BBB_day_delisted_2024-01-05.csv"),header+row("2024-01-04"));
    await writeFile(join(source,"OLD_day_delisted_2001-01-04.csv"),header+row("2001-01-03"));
    const imported=run("scripts/import-backtesting-csv.py",[source,"--output",directory,"--start","2024-01-01","--end","2024-01-31","--inventory-output",inventoryPath]);
    assert.equal(imported.status,0,imported.stderr);
    const inventory=JSON.parse(await readFile(inventoryPath,"utf8"));
    assert.equal(inventory.completed,true);
    assert.equal(inventory.sourceFileCount,3);
    assert.equal(inventory.outsideRangeCount,1);
    assert.deepEqual(inventory.inRangeListings.map((item)=>item.symbol),["AAA","BBB"]);
    const audit=()=>run("scripts/audit-backtesting-data.py",["--directory",directory,"--expected-inventory",inventoryPath]);
    const complete=audit();
    assert.equal(complete.status,0,complete.stdout);
    assert.equal(JSON.parse(complete.stdout).expectedListingCount,2);
    assert.equal(JSON.parse(complete.stdout).expectedInventoryOutsideRangeCount,1);
    const aaaPath=join(directory,"AAA.1Day.json"),aaa=JSON.parse(await readFile(aaaPath,"utf8"));
    aaa.bars.pop();
    aaa.coverageEnd="2024-01-03T00:00:00.000Z";
    await writeFile(aaaPath,JSON.stringify(aaa));
    const short=audit();
    assert.equal(short.status,1);
    assert.equal(JSON.parse(short.stdout).shortExpectedListingCount,1);
    inventory.completed=false;
    await writeFile(inventoryPath,JSON.stringify(inventory));
    const incomplete=audit();
    assert.equal(incomplete.status,2);
    assert.match(incomplete.stderr,/incomplete or invalid/);
  }finally{await rm(root,{recursive:true,force:true});}
});
