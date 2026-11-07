import assert from "node:assert/strict";
import test from "node:test";
import { archiveFromAlpaca } from "../scripts/compile-alpaca-inactive.mjs";

const asset = { symbol: "TWTR", id: "asset-123", exchange: "NYSE" };
const bars = [
  { t: "2022-10-26T04:00:00Z", o: 53, h: 54, l: 52, c: 53.5, v: 1000 },
  { t: "2022-10-27T04:00:00Z", o: 53.5, h: 54, l: 53, c: 53.7, v: 1100 },
];

test("inactive archive preserves listing identity and excludes later dates", () => {
  const archive = archiveFromAlpaca(asset, bars);
  assert.equal(archive.listingId, "alpaca-asset-asset-123");
  assert.equal(archive.inactive, true);
  assert.equal(archive.delisted, undefined);
  assert.equal(archive.sourceStatus, "inactive");
  assert.equal(archive.adjusted, true);
  assert.equal(archive.coverageStart, "2022-10-26T04:00:00.000Z");
  assert.equal(archive.coverageEnd, "2022-10-28T00:00:00.000Z");
});

test("inactive archive rejects duplicate trading dates and malformed adjusted bars", () => {
  assert.throws(() => archiveFromAlpaca(asset, [bars[0], bars[0]]), /Invalid adjusted bar/);
  assert.throws(() => archiveFromAlpaca(asset, [bars[0], { ...bars[1], l: 55 }]), /Invalid adjusted bar/);
});

test("current archive records the active listing without claiming a delisting", () => {
  const archive = archiveFromAlpaca({ ...asset, status: "active" }, bars, { inactive: false });
  assert.equal(archive.sourceStatus, "active");
  assert.equal(archive.inactive, undefined);
  assert.equal(archive.delisted, undefined);
  assert.equal(archive.listingId, "alpaca-asset-asset-123");
});

test("a listing with one trading day remains available for backtesting", () => {
  const archive = archiveFromAlpaca({ ...asset, status: "active" }, [bars[0]], { inactive: false });
  assert.equal(archive.bars.length, 1);
  assert.equal(archive.coverageStart, "2022-10-26T04:00:00.000Z");
  assert.equal(archive.coverageEnd, "2022-10-27T00:00:00.000Z");
  assert.equal(archiveFromAlpaca(asset, []), null);
});
