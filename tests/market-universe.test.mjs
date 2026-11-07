import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("current exchange directories produce a deduplicated non-test symbol list",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"pulse-universe-"));
  try{
    const nasdaq=join(directory,"nasdaqlisted.txt"),other=join(directory,"otherlisted.txt");
    await writeFile(nasdaq,"Symbol|Security Name|Test Issue|ETF\nAAPL|Apple Inc.|N|N\nZZZZ|Test Corp|Y|N\nFile Creation Time: 1027202623:00|||\n");
    await writeFile(other,"ACT Symbol|Security Name|Exchange|ETF|Test Issue\nSPY|SPDR S&P 500 ETF|P|Y|N\nFAKE|Test Issue|N|N|Y\nFile Creation Time: 1027202623:00||||\n");
    const result=spawnSync("python3",["scripts/fetch-market-universe.py","--nasdaq-file",nasdaq,"--other-file",other,"--output",directory],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    assert.equal(await readFile(join(directory,"current-symbols.txt"),"utf8"),"AAPL\nSPY\n");
    const manifest=JSON.parse(await readFile(join(directory,"current-universe.json"),"utf8"));
    assert.equal(manifest.historicalUniverseComplete,false);
    assert.equal(manifest.symbolCount,2);
    assert.deepEqual(manifest.symbols.map((item)=>[item.symbol,item.etf]),[["AAPL",false],["SPY",true]]);
  }finally{await rm(directory,{recursive:true,force:true});}
});
