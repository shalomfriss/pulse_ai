#!/usr/bin/env python3
"""Import adjusted per-security daily CSV files into Pulse AI's local archive."""

import argparse
import csv
import gzip
import io
import json
import math
import os
import re
import sys
import tempfile
import zipfile
from datetime import date, timedelta
from pathlib import Path

SYMBOL = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$")
DAILY_FILE = re.compile(r"^([A-Z][A-Z0-9.-]{0,9})_day(?:_delisted_[^/]*)?\.csv(?:\.gz)?$", re.IGNORECASE)
FIELDS = ("adj_open", "adj_high", "adj_low", "adj_close", "adj_volume")


def source_files(source):
    if source.is_dir():
        for path in sorted(source.rglob("*.csv")):
            if DAILY_FILE.fullmatch(path.name):
                yield path.name, path.open("r", encoding="utf-8-sig", newline="")
        for path in sorted(source.rglob("*.csv.gz")):
            if DAILY_FILE.fullmatch(path.name):
                yield path.name, gzip.open(path, "rt", encoding="utf-8-sig", newline="")
    elif source.suffix.lower() == ".zip":
        with zipfile.ZipFile(source) as archive:
            for item in sorted(archive.namelist()):
                if DAILY_FILE.fullmatch(Path(item).name):
                    yield Path(item).name, io.TextIOWrapper(archive.open(item), encoding="utf-8-sig", newline="")
    else:
        raise ValueError("Source must be an extracted archive directory or a ZIP file")


def event_only_row(row):
    dividend = str(row.get("dividend") or "").strip()
    split = str(row.get("split") or "").strip()
    if not (dividend or split):
        return False
    if dividend:
        try:
            amount = float(dividend)
            if not math.isfinite(amount) or amount <= 0:
                return False
        except ValueError:
            return False
    if split and not re.fullmatch(r"\d+:\d+", split):
        return False
    if any(str(row.get(field) or "").strip() for field in ("open", "high", "low", "close", "vwap", "adj_open", "adj_high", "adj_low", "adj_close", "adj_vwap")):
        return False
    for field in ("volume", "transactions", "adj_volume"):
        value = str(row.get(field) or "").strip()
        if value:
            try:
                number = float(value)
                if not math.isfinite(number) or number != 0:
                    return False
            except ValueError:
                return False
    return True


def load_bars(handle, first, last):
    reader = csv.DictReader(handle)
    if not reader.fieldnames or any(field not in reader.fieldnames for field in ("date", *FIELDS)):
        raise ValueError("CSV requires date and adjusted OHLCV columns")
    bars = {}
    invalid = 0
    event_only = 0
    for row in reader:
        try:
            day = date.fromisoformat(row["date"])
            if day < first or day > last:
                continue
            if event_only_row(row):
                event_only += 1
                continue
            values = [float(row[field]) for field in FIELDS]
            opened, high, low, close, volume = values
            if not (0 < low <= opened <= high and low <= close <= high and 0 <= volume < 1e18 and high < 1e12):
                raise ValueError("invalid adjusted OHLCV")
            raw_close = float(row["close"]) if "close" in reader.fieldnames else None
            if raw_close is not None and not (0 < raw_close < 1e12):
                raise ValueError("invalid raw close")
            if day.isoformat() in bars:
                raise ValueError(f"duplicate daily bar for {day.isoformat()}")
            bars[day.isoformat()] = {
                "timestamp": f"{day.isoformat()}T00:00:00.000Z",
                "open": opened, "high": high, "low": low, "close": close, "volume": volume,
                **({"rawClose": raw_close} if raw_close is not None else {}),
            }
        except (ValueError, TypeError, KeyError, OverflowError):
            invalid += 1
    return [bars[key] for key in sorted(bars)], invalid, event_only


def write_archive(output, symbol, bars, replace, delisted, source_name):
    target = output / f"{symbol}.1Day.json"
    listing = {
        "listingId": re.sub(r"\.csv(?:\.gz)?$", "", source_name, flags=re.IGNORECASE),
        "delisted": delisted,
        "coverageStart": bars[0]["timestamp"],
        "coverageEnd": f"{(date.fromisoformat(bars[-1]['timestamp'][:10]) + timedelta(days=1)).isoformat()}T00:00:00.000Z",
        "bars": bars,
    }
    listings = [listing]
    if target.exists():
        with target.open(encoding="utf-8") as handle:
            existing = json.load(handle)
        if existing.get("provider") == "adjusted-csv-import":
            old_listings = existing.get("listings") or [existing]
            if any(not item.get("listingId") for item in old_listings):
                if not replace:
                    raise ValueError("existing imported archive has no listing identity; use --replace to rebuild it")
                old_listings = []
            listings = [item for item in old_listings if item["listingId"] != listing["listingId"]]
            previous = next((item for item in old_listings if item["listingId"] == listing["listingId"]), None)
            if previous and not replace and (listing["coverageStart"] > previous["coverageStart"] or listing["coverageEnd"] < previous["coverageEnd"]):
                return False, "existing listing has wider coverage"
            listings.append(listing)
        elif not replace:
            old = existing.get("bars") or []
            starts_later = old and bars[0]["timestamp"] > old[0]["timestamp"]
            ends_earlier = old and bars[-1]["timestamp"] < old[-1]["timestamp"]
            recent_enough = old and (date.fromisoformat(old[-1]["timestamp"][:10]) - date.fromisoformat(bars[-1]["timestamp"][:10])).days <= 7
            if old and (starts_later or (ends_earlier and (existing.get("provider") != "yahoo-chart" or not recent_enough))):
                return False, "existing archive has wider coverage"
    listings.sort(key=lambda item: item["coverageStart"])
    for previous, current in zip(listings, listings[1:]):
        if previous["coverageEnd"] > current["coverageStart"]:
            raise ValueError(f"listing histories overlap for {symbol}; resolve security identity before import")
    record = {"symbol": symbol, "timeframe": "1Day", "provider": "adjusted-csv-import", "adjusted": True}
    if len(listings) == 1:
        record.update(listings[0])
    else:
        record.update({"coverageStart": listings[0]["coverageStart"], "coverageEnd": max(item["coverageEnd"] for item in listings), "listings": listings})
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output, prefix=f".{symbol}.", suffix=".tmp", delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(record, handle, separators=(",", ":"), allow_nan=False)
    os.replace(temporary, target)
    return True, "imported"


def main():
    def local_path(value):
        if value.lower().startswith(("http://", "https://")):
            raise argparse.ArgumentTypeError("output must be a writable local or mounted directory")
        return Path(value)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Extracted archive directory or ZIP containing *_day.csv files")
    parser.add_argument("--output", type=local_path)
    parser.add_argument("--start", type=date.fromisoformat)
    parser.add_argument("--end", type=date.fromisoformat, default=date.today())
    parser.add_argument("--replace", action="store_true", help="Replace wider existing archives with this source")
    parser.add_argument("--inventory-output", type=Path, help="Write the exact in-range source listing inventory for a later audit")
    args = parser.parse_args()
    if args.output is None:
        try:
            args.output = local_path(os.getenv("BACKTESTING_DATA_SOURCE", "backtesting_data"))
        except argparse.ArgumentTypeError as error:
            parser.error(str(error))
    try:
        first = args.start or args.end.replace(year=args.end.year - 20)
    except ValueError:
        first = args.end.replace(year=args.end.year - 20, day=28)
    if first >= args.end:
        parser.error("Start must be before end")
    if args.inventory_output and args.inventory_output.resolve() == args.source.resolve():
        parser.error("Inventory output must differ from the source archive")
    args.output.mkdir(parents=True, exist_ok=True)
    counts = {"imported": 0, "skipped": 0, "invalid_rows": 0, "event_only_rows": 0, "errors": 0}
    seen_files = set()
    in_range_listings = []
    outside_range = 0
    for name, handle in source_files(args.source):
        match = DAILY_FILE.fullmatch(name)
        symbol = match.group(1).upper() if match else ""
        if not SYMBOL.fullmatch(symbol):
            counts["skipped"] += 1
            print(f"SKIP {name}: unsupported symbol", file=sys.stderr)
            handle.close()
            continue
        if name.lower() in seen_files:
            counts["errors"] += 1
            print(f"ERROR {name}: duplicate source filename", file=sys.stderr)
            handle.close()
            continue
        seen_files.add(name.lower())
        try:
            with handle:
                bars, invalid, event_only = load_bars(handle, first, args.end)
            counts["invalid_rows"] += invalid
            counts["event_only_rows"] += event_only
            if invalid:
                raise ValueError(f"{invalid} invalid adjusted row(s); archive was not written")
            if not bars:
                counts["skipped"] += 1
                outside_range += 1
                continue
            in_range_listings.append({"symbol": symbol, "listingId": re.sub(r"\.csv(?:\.gz)?$", "", name, flags=re.IGNORECASE), "bars": len(bars), "first": bars[0]["timestamp"][:10], "last": bars[-1]["timestamp"][:10]})
            imported, reason = write_archive(args.output, symbol, bars, args.replace, "_day_delisted_" in name.lower(), name)
            counts["imported" if imported else "skipped"] += 1
            print(f"{symbol}: {reason}, {len(bars)} adjusted daily bars, {bars[0]['timestamp'][:10]} to {bars[-1]['timestamp'][:10]}")
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
            counts["errors"] += 1
            print(f"ERROR {name}: {error}", file=sys.stderr)
    if args.inventory_output:
        inventory = {"version": 1, "source": str(args.source.resolve()), "start": first.isoformat(), "end": args.end.isoformat(),
                     "sourceFileCount": len(seen_files), "outsideRangeCount": outside_range, "inRangeListings": sorted(in_range_listings, key=lambda item: (item["symbol"], item["listingId"])),
                     "completed": counts["errors"] == 0, "errors": counts["errors"]}
        args.inventory_output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=args.inventory_output.parent, prefix=f".{args.inventory_output.name}.", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(inventory, handle, separators=(",", ":"), allow_nan=False)
        os.replace(temporary, args.inventory_output)
    print(json.dumps(counts, sort_keys=True))
    if counts["errors"]:
        return 1
    if not counts["imported"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
