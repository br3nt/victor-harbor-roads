"""Hourly share of daily traffic (0-23).

Hours 07-18: shape of the summed 2017 turning counts (S-D19), scaled so they occupy the same
share of the day that hours 07-18 occupy in the reference table.  Hours 00-06 and 19-23: percentages
from the reference weekday table (S-S3-01, Delaware DOT factor group 8) - an ASSUMPTION, since no
Victor Harbor or South Australian 24-hour profile was found.
"""
from __future__ import annotations

import csv
from pathlib import Path

from vhsim.counts import turning

# Delaware DOT, Annual Average Hourly Distribution By Factor Group for Weekdays 2024, group 8,
# percent of daily traffic by hour 0..23 (transcribed from the table image on PDF page 2).
REF_GROUP8_PCT = [0.26, 0.16, 0.14, 0.13, 0.25, 0.75, 2.42, 5.23, 6.25, 6.61, 6.83, 7.43,
                  7.89, 7.59, 7.65, 8.14, 8.16, 7.49, 5.47, 4.02, 3.09, 2.13, 1.26, 0.65]
COLUMNS = ["hour", "share", "basis", "source", "notes"]
OBSERVED = range(7, 19)


def build_rows() -> list[dict]:
    ref_total = sum(REF_GROUP8_PCT)
    ref = [p / ref_total for p in REF_GROUP8_PCT]     # renormalise (transcribed table sums to ~100)
    recs, _ = turning.parse_report()
    per_hour = {h: 0 for h in OBSERVED}
    for r in recs:
        per_hour[int(r["bin_start"][:2])] += r["light"] + r["heavy"] + r["cycle"]
    day_share = sum(ref[h] for h in OBSERVED)       # share of the day the observed hours occupy
    n_obs = sum(per_hour.values())
    rows = []
    for h in range(24):
        if h in OBSERVED:
            rows.append(dict(hour=h, share=day_share * per_hour[h] / n_obs, basis="observed",
                             source="S-D19 (shape); S-S3-01 (share of day held by hours 07-18)",
                             notes="sum of all movements at 7 intersections, Wed 26 Apr 2017 (school holidays)"))
        else:
            rows.append(dict(hour=h, share=ref[h], basis="assumed", source="S-S3-01",
                             notes="Delaware DOT weekday factor group 8; US reference, see S3-counts.md"))
    return rows


def write_csv(path: Path) -> int:
    rows = build_rows()
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        for r in rows:
            r = dict(r, share=f"{r['share']:.6f}")
            w.writerow(r)
    return len(rows)
