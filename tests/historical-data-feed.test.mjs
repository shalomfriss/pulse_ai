import assert from "node:assert/strict";
import test from "node:test";
import { fetchAlpacaHistory } from "../lib/historical-data.mjs";

test("daily history can use delayed SIP bars while other callers retain IEX", async () => {
  const originalFetch = globalThis.fetch;
  const feeds = [],adjustments=[];
  globalThis.fetch = async (url) => {
    const query=new URL(url).searchParams;
    feeds.push(query.get("feed"));
    adjustments.push(query.get("adjustment"));
    return Response.json({ bars: [
      { t: "2024-01-02T05:00:00Z", o: 100, h: 101, l: 99, c: 100, v: 1000 },
      { t: "2024-01-03T05:00:00Z", o: 101, h: 102, l: 100, c: 101, v: 1100 },
    ] });
  };
  const request = { symbol: "SPY", timeframe: "1Day", start: "2024-01-01", end: "2024-01-10" };
  const credentials = { keyId: "test", secretKey: "test" };
  try {
    assert.equal((await fetchAlpacaHistory(request, credentials, { feed: "sip" })).provider, "alpaca-sip");
    assert.equal((await fetchAlpacaHistory(request, credentials)).provider, "alpaca-iex");
    assert.equal((await fetchAlpacaHistory(request, credentials, { feed:"sip",adjustment:"raw" })).adjustment,"raw");
    assert.deepEqual(feeds, ["sip", "iex", "sip"]);
    assert.deepEqual(adjustments,["all","all","raw"]);
    await assert.rejects(fetchAlpacaHistory(request, credentials, { feed: "unknown" }), /supported Alpaca market data feed/);
    await assert.rejects(fetchAlpacaHistory(request, credentials, { adjustment: "unknown" }), /supported Alpaca price adjustment/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
