#!/usr/bin/env node
/** Fill missing current US exchange archives from adjusted Alpaca SIP daily bars. */
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { START, apiJson, archiveFromAlpaca, atomicJson } from "./compile-alpaca-inactive.mjs";

function options(argv) {
  const result = { output: "backtesting_data", symbolsFile: "backtesting_data/missing-symbols.txt", limit: Infinity, intervalMs: 400 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--output" && value) result.output = value;
    else if (argv[index] === "--symbols-file" && value) result.symbolsFile = value;
    else if (argv[index] === "--limit" && value) result.limit = Number(value);
    else if (argv[index] === "--interval-ms" && value) result.intervalMs = Number(value);
    else if (argv[index].startsWith("--")) throw new Error(`Unknown or incomplete option: ${argv[index]}`);
    else continue;
    index += 1;
  }
  if (!(result.limit > 0) || !(result.intervalMs >= 350)) throw new Error("Limit must be positive and interval must be at least 350 ms");
  return result;
}

async function main() {
  const { output, symbolsFile, limit, intervalMs } = options(process.argv.slice(2));
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secretKey = process.env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secretKey) throw new Error("Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY");
  const headers = { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey };
  const directory = resolve(output);
  await mkdir(directory, { recursive: true });
  const wanted = [...new Set((await readFile(resolve(symbolsFile), "utf8")).split(/\r?\n/).map((value) => value.trim().toUpperCase()).filter(Boolean))];
  const existing = new Set((await readdir(directory)).filter((name) => name.endsWith(".1Day.json")));
  const assets = await apiJson("https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity", headers);
  if (!Array.isArray(assets)) throw new Error("Alpaca active asset response is invalid");
  const bySymbol = new Map();
  for (const asset of assets) {
    if (asset.exchange === "OTC") continue;
    if (!bySymbol.has(asset.symbol)) bySymbol.set(asset.symbol, []);
    bySymbol.get(asset.symbol).push(asset);
  }
  const manifestPath = join(directory, "alpaca-current-gap-manifest.json");
  let manifest = { source: "Alpaca active US equity assets and adjusted SIP daily bars", start: START, processed: {}, updatedAt: "" };
  try {
    const previous = JSON.parse(await readFile(manifestPath, "utf8"));
    if (previous?.source === manifest.source && previous?.start === START && previous.processed) manifest = previous;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const end = new Date(Date.now() - 30 * 60_000).toISOString();
  let requested = 0, imported = 0, empty = 0, unavailable = 0, failed = 0;
  console.log(`Current missing symbols: ${wanted.length}; already archived: ${wanted.filter((symbol) => existing.has(`${symbol}.1Day.json`)).length}`);
  for (const symbol of wanted) {
    if (existing.has(`${symbol}.1Day.json`)) continue;
    if (requested >= limit) break;
    requested += 1;
    const matches = bySymbol.get(symbol) ?? [];
    if (matches.length !== 1 || matches[0].status !== "active") {
      unavailable += 1;
      manifest.processed[symbol] = { status: "asset_unavailable", matches: matches.length };
    } else {
      try {
        const query = new URLSearchParams({ timeframe: "1Day", start: START, end,
          limit: "10000", adjustment: "all", feed: "sip", sort: "asc" });
        const payload = await apiJson(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?${query}`, headers);
        if (payload.next_page_token) throw new Error("Alpaca returned an unexpected second page");
        const archive = archiveFromAlpaca(matches[0], payload.bars ?? [], { inactive: false });
        if (archive) {
          await atomicJson(join(directory, `${symbol}.1Day.json`), archive);
          existing.add(`${symbol}.1Day.json`);
          imported += 1;
          manifest.processed[symbol] = { status: "imported", bars: archive.bars.length,
            first: archive.bars[0].timestamp.slice(0, 10), last: archive.bars.at(-1).timestamp.slice(0, 10) };
        } else {
          empty += 1;
          manifest.processed[symbol] = { status: "no_bars" };
        }
      } catch (error) {
        failed += 1;
        manifest.processed[symbol] = { status: "error", reason: error.message.slice(0, 120) };
      }
      await new Promise((done) => setTimeout(done, intervalMs));
    }
    if (requested % 25 === 0) {
      manifest.updatedAt = new Date().toISOString();
      await atomicJson(manifestPath, manifest);
      console.log(`Processed ${requested}: imported ${imported}, no bars ${empty}, unavailable ${unavailable}, errors ${failed}`);
    }
  }
  manifest.updatedAt = new Date().toISOString();
  await atomicJson(manifestPath, manifest);
  console.log(`Finished: requested ${requested}, imported ${imported}, no bars ${empty}, unavailable ${unavailable}, errors ${failed}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
