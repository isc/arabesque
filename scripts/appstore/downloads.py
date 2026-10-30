#!/usr/bin/env python3
"""How many times Arabesque was downloaded from the App Store, day by day.

    python3 scripts/appstore/downloads.py                  # the last 30 days
    python3 scripts/appstore/downloads.py --since 2026-08-01
    python3 scripts/appstore/downloads.py --by-country

Read from Apple's daily Sales summary, the one App Store Connect's Trends page
is built on. A day with no download at all has no report, which Apple answers
with a 404, and so does a day it has not filed yet: yesterday's lands in the
course of the morning, Paris time. Daily reports go back 365 days.

TestFlight installs are not in it.
"""
import argparse
import collections
import csv
import datetime
import io
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).parent))

import asc  # noqa: E402

# Apple's product type identifiers, by their first character: 1 a first
# download, 3 a re-download by someone who had the app (another device, a
# reinstall), 7 an update. The suffix is the platform (F universal, T iPad).
KINDS = {"1": "downloads", "3": "re-downloads", "7": "updates"}


def daily_rows(vendor, app, day):
    status, text = asc.get_report(
        "/v1/salesReports?filter[frequency]=DAILY&filter[reportType]=SALES"
        f"&filter[reportSubType]=SUMMARY&filter[vendorNumber]={vendor}"
        f"&filter[reportDate]={day.isoformat()}")
    if status == 404:
        return []
    if status != 200:
        raise SystemExit(f"{day}: {status} " + "; ".join(asc.errors_of({"raw": text})))
    rows = csv.DictReader(io.StringIO(text), delimiter="\t")
    return [r for r in rows if r["Apple Identifier"] == app]


def summary(counts):
    return "  ".join(f"{kind}: {n}" for kind, n in sorted(counts.items()))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--since", type=datetime.date.fromisoformat,
                        help="first day (default: 30 days ago)")
    parser.add_argument("--by-country", action="store_true")
    args = parser.parse_args()

    until = datetime.date.today() - datetime.timedelta(days=1)
    since = args.since or until - datetime.timedelta(days=29)
    days = [since + datetime.timedelta(days=n) for n in range((until - since).days + 1)]
    vendor = asc.vendor_number()
    app = asc.app_id()

    # A report a request: a year of days is a few seconds side by side.
    with ThreadPoolExecutor(max_workers=8) as pool:
        reports = pool.map(lambda d: daily_rows(vendor, app, d), days)

    totals = collections.Counter()
    countries = collections.Counter()
    for day, rows in zip(days, reports):
        counts = collections.Counter()
        for r in rows:
            product, units = r["Product Type Identifier"], int(r["Units"])
            kind = KINDS.get(product[:1], product)
            counts[kind] += units
            if kind == "downloads":
                countries[r["Country Code"]] += units
        totals.update(counts)
        if counts:
            print(day, summary(counts))

    print(f"\n{since} → {until}:", summary(totals) or "nothing")
    if args.by_country and countries:
        print("downloads by country:", "  ".join(f"{c} {n}" for c, n in countries.most_common()))


if __name__ == "__main__":
    main()
