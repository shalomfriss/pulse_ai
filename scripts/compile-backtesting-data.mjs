import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { compileBars } from "../lib/backtesting.mjs";
import { dailyBarCoverage, fetchPublicDailyHistory, validateHistorySymbol } from "../lib/historical-data.mjs";

const args = process.argv.slice(2);
const skipExisting = args.includes("--skip-existing");
if (skipExisting) args.splice(args.indexOf("--skip-existing"),1);
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
if (limitIndex >= 0) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  args.splice(limitIndex,2);
}
const offsetIndex = args.indexOf("--offset");
const offset = offsetIndex >= 0 ? Number(args[offsetIndex + 1]) : 0;
if (offsetIndex >= 0) {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("--offset must be a nonnegative integer");
  args.splice(offsetIndex,2);
}
const endOffsetIndex = args.indexOf("--end-offset");
const endOffset = endOffsetIndex >= 0 ? Number(args[endOffsetIndex + 1]) : Infinity;
if (endOffsetIndex >= 0) {
  if (!Number.isInteger(endOffset) || endOffset < offset) throw new Error("--end-offset must be an integer at least as large as --offset");
  args.splice(endOffsetIndex,2);
}
const delayIndex = args.indexOf("--delay-ms");
const delayMs = delayIndex >= 0 ? Number(args[delayIndex + 1]) : 0;
if (delayIndex >= 0) {
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) throw new Error("--delay-ms must be between 0 and 60000");
  args.splice(delayIndex,2);
}
const fileIndex = args.indexOf("--symbols-file");
const symbolsFile = fileIndex >= 0 ? args[fileIndex + 1] : null;
if (fileIndex >= 0 && !symbolsFile) throw new Error("--symbols-file requires a path");
if (fileIndex >= 0) args.splice(fileIndex, 2);
const symbols = new Set(args.map(validateHistorySymbol));
if (symbolsFile) {
  const lines = (await readFile(symbolsFile,"utf8")).split(/\r?\n/);
  for (const line of lines) {
    const symbol = line.trim();
    if (symbol && !symbol.startsWith("#")) symbols.add(validateHistorySymbol(symbol));
  }
}
if (!symbols.size) {
  console.error("Usage: npm run data:compile -- SPY AAPL [--symbols-file symbols.txt]");
  process.exit(2);
}

const destination = process.env.BACKTESTING_DATA_SOURCE || "backtesting_data";
if (/^https?:\/\//i.test(destination)) throw new Error("Set BACKTESTING_DATA_SOURCE to a writable directory for compilation");
const root = resolve(destination);
await mkdir(root,{recursive:true});
const end = new Date();
end.setUTCHours(0,0,0,0);
end.setUTCDate(end.getUTCDate()+1);
const start = new Date(end);
start.setUTCFullYear(start.getUTCFullYear()-20);
let succeeded = 0, failed = 0;
let skipped = 0;
let attempted = 0;
async function fetchWithRetry(symbol) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await fetchPublicDailyHistory({symbol,timeframe:"1Day",start:start.toISOString(),end:end.toISOString()});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Public daily history failed \((?:429|5\d\d)\)/.test(message) || attempt === 4) throw error;
      const delay = Math.min(2_000 * 2 ** attempt, 30_000);
      console.error(`${symbol}: ${message}; retrying in ${delay / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve,delay));
    }
  }
}
for (const symbol of [...symbols].slice(offset,endOffset)) {
  const path = join(root,`${symbol}.1Day.json`);
  let existing = null;
  try { existing = JSON.parse(await readFile(path,"utf8")); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (skipExisting && existing) { skipped += 1; continue; }
  if (attempted >= limit) break;
  attempted += 1;
  try {
    const dataset = await fetchWithRetry(symbol);
    const compiled = compileBars(dataset.bars, undefined, 1);
    const archive = {
      symbol,timeframe:"1Day",provider:dataset.provider,
      ...(dataset.providerSymbol && dataset.providerSymbol !== symbol ? { providerSymbol:dataset.providerSymbol } : {}),
      ...dailyBarCoverage(compiled.bars),
      adjusted:true,bars:compiled.bars,
    };
    if (existing?.listings || (existing?.bars?.length && (existing.coverageStart < archive.coverageStart || existing.coverageEnd > archive.coverageEnd))) {
      skipped += 1;
      console.log(`${symbol}: kept existing archive with separate listings or wider coverage`);
      continue;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary,JSON.stringify(archive));
    await rename(temporary,path);
    succeeded += 1;
    console.log(`${symbol}: ${compiled.bars.length} daily bars, ${compiled.bars[0].timestamp.slice(0,10)} to ${compiled.bars.at(-1).timestamp.slice(0,10)}${dataset.warning?` (${dataset.warning})`:""}${compiled.report.invalidRemoved?` (${compiled.report.invalidRemoved} invalid provider bar(s) removed)`:""}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error?error.message:String(error);
    console.error(`${symbol}: ${message}`);
    if (/Public daily history failed \(429\)/.test(message)) {
      console.error("Stopping after persistent rate limiting; resume with --skip-existing later.");
      break;
    }
  }
  if (delayMs) await new Promise((resolve) => setTimeout(resolve,delayMs));
}
console.log(`Compiled ${succeeded} symbol(s); ${skipped} skipped; ${failed} failed. Archive: ${root}`);
if (failed) process.exitCode = 1;
