#!/usr/bin/env node
/** Add inactive US exchange listings available from Alpaca's adjusted SIP history. */
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
export const START = "2016-01-01T00:00:00.000Z";

function options(argv) {
  const result = { output: "backtesting_data", currentSymbols: "backtesting_data/current-symbols.txt", limit: Infinity, intervalMs: 400 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--output" && value) result.output = value;
    else if (argv[index] === "--current-symbols" && value) result.currentSymbols = value;
    else if (argv[index] === "--limit" && value) result.limit = Number(value);
    else if (argv[index] === "--interval-ms" && value) result.intervalMs = Number(value);
    else if (argv[index].startsWith("--")) throw new Error(`Unknown or incomplete option: ${argv[index]}`);
    else continue;
    index += 1;
  }
  if (!(result.limit > 0) || !(result.intervalMs >= 350)) throw new Error("Limit must be positive and interval must be at least 350 ms");
  return result;
}

export async function apiJson(url, headers) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 4) throw new Error(`Alpaca API failed (${response.status})`);
      const retryAfter = Number(response.headers.get("retry-after"));
      await new Promise((done) => setTimeout(done, Math.max(Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0, 2_000 * (attempt + 1))));
      continue;
    }
    if (!response.ok) throw new Error(`Alpaca API failed (${response.status})`);
    return response.json();
  }
}

function dayAfter(timestamp) {
  const day = timestamp.slice(0, 10);
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString();
}

export function archiveFromAlpaca(asset, sourceBars, { inactive = true } = {}) {
  if (!SYMBOL.test(asset.symbol) || !asset.id || !Array.isArray(sourceBars)) throw new Error("Invalid Alpaca asset or bars");
  const bars = sourceBars.map((bar) => ({
    timestamp: new Date(bar.t).toISOString(), open: bar.o, high: bar.h,
    low: bar.l, close: bar.c, volume: bar.v,
  }));
  if (bars.length === 0) return null;
  let previous = "";
  for (const bar of bars) {
    const { timestamp, open, high, low, close, volume } = bar;
    if (timestamp.slice(0, 10) <= previous ||
        [open, high, low, close, volume].some((value) => typeof value !== "number" || !Number.isFinite(value)) ||
        !(0 < low && low <= open && open <= high && low <= close && close <= high && volume >= 0)) {
      throw new Error(`Invalid adjusted bar for ${asset.symbol}`);
    }
    previous = timestamp.slice(0, 10);
  }
  return {
    symbol: asset.symbol, timeframe: "1Day", provider: "alpaca-sip", adjusted: true,
    listingId: `alpaca-asset-${asset.id}`, ...(inactive ? { inactive: true } : {}), sourceStatus: inactive ? "inactive" : "active",
    exchange: asset.exchange, coverageStart: bars[0].timestamp,
    coverageEnd: dayAfter(bars.at(-1).timestamp), bars,
  };
}

export async function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, path);
}

async function main() {
  const { output, currentSymbols, limit, intervalMs } = options(process.argv.slice(2));
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secretKey = process.env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secretKey) throw new Error("Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY");
  const headers = { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey };
  const directory = resolve(output);
  await mkdir(directory, { recursive: true });
  const current = new Set((await readFile(resolve(currentSymbols), "utf8")).split(/\r?\n/).filter(Boolean));
  const existing = new Set((await readdir(directory)).filter((name) => name.endsWith(".1Day.json")));
  const manifestPath = join(directory, "alpaca-inactive-manifest.json");
  let manifest = { source: "Alpaca inactive US equity assets and adjusted SIP daily bars", start: START, processed: {}, updatedAt: "" };
  try {
    const previous = JSON.parse(await readFile(manifestPath, "utf8"));
    if (previous?.source === manifest.source && previous?.start === START && previous.processed) manifest = previous;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const assets = await apiJson("https://paper-api.alpaca.markets/v2/assets?status=inactive&asset_class=us_equity", headers);
  if (!Array.isArray(assets)) throw new Error("Alpaca inactive asset response is invalid");
  const counts = new Map();
  for (const asset of assets) if (asset.exchange !== "OTC" && SYMBOL.test(asset.symbol)) counts.set(asset.symbol, (counts.get(asset.symbol) ?? 0) + 1);
  const eligible = assets.filter((asset) => asset.exchange !== "OTC" && SYMBOL.test(asset.symbol) &&
    counts.get(asset.symbol) === 1 && !current.has(asset.symbol) && !existing.has(`${asset.symbol}.1Day.json`));
  // Basic Alpaca accounts may query historical SIP bars but cannot request the latest 15 minutes.
  const end = new Date(Date.now() - 30 * 60_000).toISOString();
  let requested = 0, imported = 0, empty = 0, failed = 0;
  console.log(`Eligible inactive listings: ${eligible.length}; prior results: ${Object.keys(manifest.processed).length}`);
  for (const asset of eligible) {
    if (manifest.processed[asset.id]?.status === "no_bars") continue;
    if (requested >= limit) break;
    requested += 1;
    try {
      const query = new URLSearchParams({ timeframe: "1Day", start: START, end,
        limit: "10000", adjustment: "all", feed: "sip", sort: "asc" });
      const payload = await apiJson(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(asset.symbol)}/bars?${query}`, headers);
      if (payload.next_page_token) throw new Error("Alpaca returned an unexpected second page");
      const archive = archiveFromAlpaca(asset, payload.bars ?? []);
      if (archive) {
        await atomicJson(join(directory, `${asset.symbol}.1Day.json`), archive);
        imported += 1;
        manifest.processed[asset.id] = { symbol: asset.symbol, status: "imported", bars: archive.bars.length,
          first: archive.bars[0].timestamp.slice(0, 10), last: archive.bars.at(-1).timestamp.slice(0, 10) };
      } else {
        empty += 1;
        manifest.processed[asset.id] = { symbol: asset.symbol, status: "no_bars" };
      }
    } catch (error) {
      failed += 1;
      manifest.processed[asset.id] = { symbol: asset.symbol, status: "error", reason: error.message.slice(0, 120) };
    }
    if (requested % 25 === 0) {
      manifest.updatedAt = new Date().toISOString();
      await atomicJson(manifestPath, manifest);
      console.log(`Processed ${requested}: imported ${imported}, no bars ${empty}, errors ${failed}`);
    }
    await new Promise((done) => setTimeout(done, intervalMs));
  }
  manifest.updatedAt = new Date().toISOString();
  await atomicJson(manifestPath, manifest);
  console.log(`Finished this pass: requested ${requested}, imported ${imported}, no bars ${empty}, errors ${failed}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
