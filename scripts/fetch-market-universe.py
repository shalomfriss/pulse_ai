#!/usr/bin/env python3
"""Fetch the current US exchange symbol directory for archive compilation."""

import argparse
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SOURCES = {
    "nasdaq": "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
    "other": "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
}
SYMBOL = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$")


def parse_directory(content, source):
    rows = content.decode("utf-8-sig").splitlines()
    if len(rows) < 2:
        raise ValueError(f"{source} directory is empty")
    header = rows[0].split("|")
    symbol_field = "Symbol" if source == "nasdaq" else "ACT Symbol"
    required = {symbol_field, "Test Issue", "ETF", "Security Name"}
    if not required.issubset(header):
        raise ValueError(f"{source} directory has unexpected columns")
    symbols = {}
    for row in rows[1:]:
        if row.startswith("File Creation Time:") or not row.strip():
            continue
        fields = row.split("|")
        if len(fields) != len(header):
            raise ValueError(f"{source} directory has a malformed row")
        item = dict(zip(header, fields))
        symbol = item[symbol_field].strip().upper()
        if item["Test Issue"] != "N" or not SYMBOL.fullmatch(symbol):
            continue
        if symbol in symbols:
            raise ValueError(f"{source} directory repeats {symbol}")
        symbols[symbol] = {
            "symbol": symbol,
            "name": item["Security Name"].strip(),
            "exchange": "NASDAQ" if source == "nasdaq" else item["Exchange"].strip(),
            "etf": item["ETF"] == "Y",
            "source": source,
        }
    if not symbols:
        raise ValueError(f"{source} directory contains no valid securities")
    return symbols


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("backtesting_data"))
    parser.add_argument("--nasdaq-file", type=Path, help="Use a saved directory for repeatable offline imports")
    parser.add_argument("--other-file", type=Path, help="Use a saved directory for repeatable offline imports")
    args = parser.parse_args()
    listings = {}
    for source, url in SOURCES.items():
        local_file = args.nasdaq_file if source == "nasdaq" else args.other_file
        if local_file:
            content = local_file.read_bytes()
        else:
            request = urllib.request.Request(url, headers={"User-Agent": "Pulse-AI-Historical-Compiler/1.0"})
            with urllib.request.urlopen(request, timeout=30) as response:
                content = response.read()
        for symbol, item in parse_directory(content, source).items():
            if symbol in listings:
                raise ValueError(f"Current directories repeat {symbol} across exchanges")
            listings[symbol] = item
    args.output.mkdir(parents=True, exist_ok=True)
    symbols = sorted(listings)
    (args.output / "current-symbols.txt").write_text("\n".join(symbols) + "\n", encoding="utf-8")
    manifest = {
        "asOf": datetime.now(timezone.utc).isoformat(),
        "scope": "currently listed Nasdaq and other exchange securities; excludes test issues and symbols unsupported by the archive format",
        "historicalUniverseComplete": False,
        "sources": SOURCES,
        "symbolCount": len(symbols),
        "symbols": [listings[symbol] for symbol in symbols],
    }
    (args.output / "current-universe.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(symbols)} current symbols to {args.output}")


if __name__ == "__main__":
    main()
