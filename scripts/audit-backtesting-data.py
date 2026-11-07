#!/usr/bin/env python3
"""Audit compiled daily archives without claiming an unknown universe is complete."""

import argparse
import json
import math
import os
import re
import tempfile
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

SYMBOL = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$")
DAILY_FILE = re.compile(r"^([A-Z][A-Z0-9.-]{0,9})_day(?:_delisted_[^/]*)?\.csv(?:\.gz)?$", re.IGNORECASE)


def source_listings(source):
    if source.is_dir():
        names = (path.name for path in source.rglob("*") if path.is_file())
    elif source.suffix.lower() == ".zip":
        with zipfile.ZipFile(source) as archive:
            names = [Path(name).name for name in archive.namelist()]
    else:
        raise ValueError("Expected source must be an extracted directory or ZIP file")
    listings = set()
    for name in names:
        match = DAILY_FILE.fullmatch(name)
        if match:
            listings.add((match.group(1).upper(), re.sub(r"\.csv(?:\.gz)?$", "", name, flags=re.IGNORECASE)))
    if not listings:
        raise ValueError("Expected source contains no adjusted daily CSV filenames")
    return listings


def inventory_listings(path):
    inventory = json.loads(path.read_text(encoding="utf-8"))
    if inventory.get("version") != 1 or inventory.get("completed") is not True or inventory.get("errors") != 0:
        raise ValueError("Expected import inventory is incomplete or invalid")
    try:
        start, end = datetime.fromisoformat(inventory["start"]), datetime.fromisoformat(inventory["end"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("Expected import inventory has invalid dates") from error
    if start >= end or not isinstance(inventory.get("source"), str) or not inventory["source"] or not isinstance(inventory.get("outsideRangeCount"), int) or isinstance(inventory["outsideRangeCount"], bool) or inventory["outsideRangeCount"] < 0:
        raise ValueError("Expected import inventory has invalid metadata")
    rows = inventory.get("inRangeListings")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Expected import inventory has no listing array")
    if not isinstance(inventory.get("sourceFileCount"), int) or isinstance(inventory["sourceFileCount"], bool) or inventory["sourceFileCount"] != len(rows) + inventory["outsideRangeCount"]:
        raise ValueError("Expected import inventory has an inconsistent file count")
    listings = set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("symbol"), str) or not SYMBOL.fullmatch(row["symbol"]) or not isinstance(row.get("listingId"), str) or not row["listingId"] or not isinstance(row.get("bars"), int) or isinstance(row["bars"], bool) or row["bars"] < 1 or not isinstance(row.get("first"), str) or not isinstance(row.get("last"), str) or row["first"] > row["last"]:
            raise ValueError("Expected import inventory contains an invalid listing")
        try:
            first, last = datetime.fromisoformat(row["first"]).date(), datetime.fromisoformat(row["last"]).date()
        except ValueError as error:
            raise ValueError("Expected import inventory has invalid listing dates") from error
        if first < start.date() or last > end.date():
            raise ValueError("Expected import inventory has listings outside its selected range")
        key = row["symbol"], row["listingId"]
        if key in listings:
            raise ValueError("Expected import inventory contains a duplicate listing")
        listings.add(key)
    return inventory, listings


def inspect_segment(record):
    bars = record.get("bars")
    if not isinstance(bars, list) or not bars:
        raise ValueError("no bars")
    previous = ""
    previous_day = ""
    years = {}
    raw_close_bars = 0
    for index, bar in enumerate(bars, 1):
        if not isinstance(bar, dict):
            raise ValueError(f"bar {index} is not an object")
        timestamp = bar.get("timestamp", "")
        if not isinstance(timestamp, str) or timestamp <= previous:
            raise ValueError("bars are not in unique chronological order")
        try:
            parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError(f"bar {index} has an invalid timestamp") from error
        if parsed.tzinfo is None or timestamp[:10] == previous_day:
            raise ValueError(f"bar {index} has an invalid or duplicate trading date")
        values = [bar.get(field) for field in ("open", "high", "low", "close", "volume")]
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in values):
            raise ValueError(f"bar {index} has a non-finite OHLCV value")
        opened, high, low, close, volume = values
        if not (0 < low <= opened <= high and low <= close <= high and 0 <= volume < 1e18 and high < 1e12):
            raise ValueError(f"bar {index} has invalid adjusted OHLCV")
        raw_close = bar.get("rawClose")
        if raw_close is not None and (isinstance(raw_close, bool) or not isinstance(raw_close, (int, float)) or not math.isfinite(raw_close) or not 0 < raw_close < 1e12):
            raise ValueError(f"bar {index} has an invalid raw close")
        if raw_close is not None:
            raw_close_bars += 1
        year = timestamp[:4]
        years[year] = years.get(year, 0) + 1
        previous = timestamp
        previous_day = timestamp[:10]
    coverage_start, coverage_end = record.get("coverageStart"), record.get("coverageEnd")
    try:
        start_date = datetime.fromisoformat(coverage_start.replace("Z", "+00:00"))
        end_date = datetime.fromisoformat(coverage_end.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as error:
        raise ValueError("coverage dates are invalid") from error
    if start_date.tzinfo is None or end_date.tzinfo is None or start_date >= end_date or coverage_start > bars[0]["timestamp"] or coverage_end <= bars[-1]["timestamp"]:
        raise ValueError("coverage metadata excludes bars")
    return len(bars), bars[0]["timestamp"][:10], bars[-1]["timestamp"][:10], record.get("delisted") is True, record.get("inactive") is True, years, raw_close_bars


def inspect(path):
    with path.open(encoding="utf-8") as handle:
        record = json.load(handle)
    symbol = path.name.removesuffix(".1Day.json")
    if not SYMBOL.fullmatch(symbol) or record.get("symbol") != symbol or record.get("timeframe") != "1Day":
        raise ValueError("symbol or timeframe does not match filename")
    if record.get("adjusted") is not True:
        raise ValueError("adjusted=true is missing")
    listings = record.get("listings")
    if listings is None:
        listing_id = record.get("listingId")
        if listing_id is not None and (not isinstance(listing_id, str) or not listing_id):
            raise ValueError("listing identity is invalid")
        if record.get("provider") == "adjusted-csv-import" and listing_id is None:
            raise ValueError("imported listing identity is missing")
        count, first, last, delisted, inactive, years, raw_close_bars = inspect_segment(record)
        if record.get("provider") == "yahoo-chart":
            expected_start = f"{first}T00:00:00.000Z"
            expected_end = f"{(datetime.fromisoformat(last) + timedelta(days=1)).date().isoformat()}T00:00:00.000Z"
            if record.get("coverageStart") != expected_start or record.get("coverageEnd") != expected_end:
                raise ValueError("generated daily coverage does not match actual bar dates; run repair-backtesting-coverage.py")
        details = {listing_id: {"bars": count, "first": first, "last": last}} if listing_id else {}
        return symbol, count, first, last, int(delisted), int(inactive), 1, [listing_id] if listing_id else [], years, {year: 1 for year in years}, details, raw_close_bars, record.get("provider")
    if not isinstance(listings, list) or len(listings) < 2 or record.get("bars"):
        raise ValueError("multi-listing archive has an invalid listing structure")
    identities = set()
    previous_end = ""
    summaries = []
    for listing in listings:
        if not isinstance(listing, dict) or not isinstance(listing.get("listingId"), str) or not listing["listingId"] or listing["listingId"] in identities:
            raise ValueError("listing identity is missing or duplicated")
        identities.add(listing["listingId"])
        summary = inspect_segment(listing)
        if previous_end and listing["coverageStart"] < previous_end:
            raise ValueError("listing histories overlap")
        previous_end = listing["coverageEnd"]
        summaries.append(summary)
    if record.get("coverageStart") != listings[0]["coverageStart"] or record.get("coverageEnd") != max(item["coverageEnd"] for item in listings):
        raise ValueError("multi-listing coverage metadata is inconsistent")
    bars_by_year, series_by_year = {}, {}
    for summary in summaries:
        for year, count in summary[5].items():
            bars_by_year[year] = bars_by_year.get(year, 0) + count
            series_by_year[year] = series_by_year.get(year, 0) + 1
    details = {listing["listingId"]: {"bars": summary[0], "first": summary[1], "last": summary[2]} for listing, summary in zip(listings, summaries)}
    return symbol, sum(item[0] for item in summaries), summaries[0][1], summaries[-1][2], sum(item[3] for item in summaries), sum(item[4] for item in summaries), len(listings), [item["listingId"] for item in listings], bars_by_year, series_by_year, details, sum(item[6] for item in summaries), record.get("provider")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path(os.getenv("BACKTESTING_DATA_SOURCE", "backtesting_data")))
    parser.add_argument("--expected-symbols", type=Path, help="One required symbol per line, including delisted symbols")
    parser.add_argument("--expected-universe", type=Path, help="Current-universe JSON with security names and ETF flags for missing-symbol classification")
    expected_group = parser.add_mutually_exclusive_group()
    expected_group.add_argument("--expected-source", type=Path, help="ZIP or directory of per-listing adjusted daily CSV filenames to verify after import")
    expected_group.add_argument("--expected-inventory", type=Path, help="Exact in-range listing inventory written by import-backtesting-csv.py")
    parser.add_argument("--missing-output", type=Path, help="Write every missing expected symbol to a retry list")
    args = parser.parse_args()
    if args.missing_output and not args.expected_symbols:
        parser.error("--missing-output requires --expected-symbols")
    if args.missing_output and args.missing_output.resolve() == args.expected_symbols.resolve():
        parser.error("Missing output must differ from the expected symbol list")
    if args.expected_universe and not args.expected_symbols:
        parser.error("--expected-universe requires --expected-symbols")
    found, errors = {}, []
    for path in sorted(args.directory.glob("*.1Day.json")):
        try:
            symbol, count, first, last, delisted, inactive, listings, listing_ids, bars_by_year, series_by_year, listing_details, raw_close_bars, provider = inspect(path)
            found[symbol] = {"bars": count, "first": first, "last": last, "delisted": delisted, "inactive": inactive, "listings": listings, "listingIds": listing_ids, "barsByYear": bars_by_year, "seriesByYear": series_by_year, "listingDetails": listing_details, "rawCloseBars": raw_close_bars, "provider": provider}
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            errors.append(f"{path.name}: {error}")
    expected = None
    if args.expected_symbols:
        expected = {line.strip().upper() for line in args.expected_symbols.read_text().splitlines() if line.strip() and not line.strip().startswith("#")}
    missing = sorted(expected - found.keys()) if expected is not None else []
    missing_by_type = {}
    if args.expected_universe:
        try:
            universe = json.loads(args.expected_universe.read_text(encoding="utf-8"))
            securities = {item["symbol"]: item for item in universe["symbols"]}
            if not isinstance(universe["symbols"], list) or any(symbol not in securities for symbol in expected):
                raise ValueError("Universe metadata does not cover the expected symbol list")
            for symbol in missing:
                item = securities[symbol]
                name = item["name"].lower()
                kind = "ETF" if item["etf"] else "warrant" if "warrant" in name else "right" if "right" in name else "unit" if "unit" in name else "other"
                missing_by_type[kind] = missing_by_type.get(kind, 0) + 1
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            parser.error(f"Could not classify expected universe: {error}")
    if args.missing_output:
        args.missing_output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=args.missing_output.parent, prefix=f".{args.missing_output.name}.", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write("\n".join(missing) + ("\n" if missing else ""))
        os.replace(temporary, args.missing_output)
    try:
        inventory, expected_listings = inventory_listings(args.expected_inventory) if args.expected_inventory else (None, source_listings(args.expected_source) if args.expected_source else None)
    except (OSError, ValueError, TypeError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        parser.error(str(error))
    found_listings = {(symbol, listing_id) for symbol, item in found.items() for listing_id in item["listingIds"]}
    missing_listings = sorted(expected_listings - found_listings) if expected_listings is not None else []
    short_listings = []
    if inventory:
        for row in inventory["inRangeListings"]:
            actual = found.get(row["symbol"], {}).get("listingDetails", {}).get(row["listingId"])
            if actual and (actual["bars"] < row["bars"] or actual["first"] > row["first"] or actual["last"] < row["last"]):
                short_listings.append({"symbol": row["symbol"], "listingId": row["listingId"], "expectedBars": row["bars"], "actualBars": actual["bars"]})
    bars_by_year, series_by_year = {}, {}
    for item in found.values():
        for year, count in item["barsByYear"].items():
            bars_by_year[year] = bars_by_year.get(year, 0) + count
        for year, count in item["seriesByYear"].items():
            series_by_year[year] = series_by_year.get(year, 0) + count
    report = {
        "directory": str(args.directory.resolve()),
        "symbolCount": len(found),
        "knownDelistedCount": sum(item["delisted"] for item in found.values()),
        "inactiveListingCount": sum(item["inactive"] for item in found.values()),
        "listingCount": sum(item["listings"] for item in found.values()),
        "totalBars": sum(item["bars"] for item in found.values()),
        "rawCloseBars": sum(item["rawCloseBars"] for item in found.values()),
        "yahooBarCount": sum(item["bars"] for item in found.values() if item["provider"] == "yahoo-chart"),
        "yahooRawCloseBars": sum(item["rawCloseBars"] for item in found.values() if item["provider"] == "yahoo-chart"),
        "yahooSymbolsMissingRawClose": sorted(symbol for symbol, item in found.items() if item["provider"] == "yahoo-chart" and item["rawCloseBars"] < item["bars"]),
        "earliestBar": min((item["first"] for item in found.values()), default=None),
        "latestBar": max((item["last"] for item in found.values()), default=None),
        "barsByYear": dict(sorted(bars_by_year.items())),
        "seriesWithBarsByYear": dict(sorted(series_by_year.items())),
        "expectedListProvided": expected is not None,
        "expectedSymbolCount": len(expected) if expected is not None else None,
        "missingExpectedSymbols": missing[:50],
        "missingExpectedCount": len(missing),
        "expectedUniverseProvided": args.expected_universe is not None,
        "missingExpectedByType": dict(sorted(missing_by_type.items())),
        "expectedSourceProvided": args.expected_source is not None,
        "expectedInventoryProvided": inventory is not None,
        "expectedInventoryStart": inventory["start"] if inventory else None,
        "expectedInventoryEnd": inventory["end"] if inventory else None,
        "expectedInventoryOutsideRangeCount": inventory["outsideRangeCount"] if inventory else None,
        "expectedListingCount": len(expected_listings) if expected_listings is not None else None,
        "missingExpectedListings": [{"symbol": symbol, "listingId": listing_id} for symbol, listing_id in missing_listings[:50]],
        "missingExpectedListingCount": len(missing_listings),
        "shortExpectedListings": short_listings[:50],
        "shortExpectedListingCount": len(short_listings),
        "invalidArchives": errors[:50],
        "invalidArchiveCount": len(errors),
    }
    print(json.dumps(report, indent=2))
    return 1 if errors or missing or missing_listings or short_listings or not found else 0


if __name__ == "__main__":
    raise SystemExit(main())
