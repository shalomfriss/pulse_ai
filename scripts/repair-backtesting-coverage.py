#!/usr/bin/env python3
"""Set generated Yahoo daily archive coverage to the dates of its actual bars."""

import argparse
import json
import os
import tempfile
from datetime import date, timedelta
from pathlib import Path


def coverage(bars):
    if not isinstance(bars, list) or not bars:
        raise ValueError("archive has no bars")
    try:
        first = date.fromisoformat(bars[0]["timestamp"][:10])
        last = date.fromisoformat(bars[-1]["timestamp"][:10])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("archive has invalid bar dates") from error
    if first > last:
        raise ValueError("archive bars are reversed")
    return f"{first.isoformat()}T00:00:00.000Z", f"{(last + timedelta(days=1)).isoformat()}T00:00:00.000Z"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path(os.getenv("BACKTESTING_DATA_SOURCE", "backtesting_data")))
    args = parser.parse_args()
    fixed = unchanged = skipped = errors = 0
    for path in sorted(args.directory.glob("*.1Day.json")):
        try:
            with path.open(encoding="utf-8") as handle:
                record = json.load(handle)
            if record.get("provider") != "yahoo-chart" or record.get("listings") is not None:
                skipped += 1
                continue
            start, end = coverage(record.get("bars"))
            if record.get("coverageStart") == start and record.get("coverageEnd") == end:
                unchanged += 1
                continue
            record["coverageStart"], record["coverageEnd"] = start, end
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=f".{path.stem}.", suffix=".tmp", delete=False) as handle:
                temporary = Path(handle.name)
                json.dump(record, handle, separators=(",", ":"), allow_nan=False)
            os.replace(temporary, path)
            fixed += 1
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
            errors += 1
            print(f"ERROR {path.name}: {error}")
    print(json.dumps({"fixed": fixed, "unchanged": unchanged, "skipped": skipped, "errors": errors}, sort_keys=True))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
