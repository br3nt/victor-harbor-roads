"""Summer peak factor for Victor Harbor Rd.

DIT (S-D18, media release 24 Oct 2024): "More than 11,000 vehicles travel along these sections of
Victor Harbor Road each day during the peak holiday period in summer" (the sections at Hindmarsh
Tiers Rd / Virgin Rd and at Brookman Rd).  AADT for Victor Harbor Rd (04760) in the 2026 release
(S-D02) is 7,700 (RRD 28.26-43.21) and 8,400 (43.21-45.6).  Factor = peak / AADT; it is a LOWER
bound because DIT says "more than", and the release does not say which AADT section the 11,000
refers to, so both are used as the range.
"""
from __future__ import annotations

import csv
from pathlib import Path

PEAK_VPD = 11000
AADT_LOW, AADT_HIGH = 7700, 8400     # checked against aadt.csv in tests
COLUMNS = ["factor_id", "description", "summer_peak_vpd", "aadt_low", "aadt_high",
           "factor_min", "factor_max", "basis", "source", "notes"]


def build_rows() -> list[dict]:
    return [
        dict(factor_id="summer_peak_victor_harbor_rd",
             description="Peak holiday period (summer) daily volume / AADT, Victor Harbor Rd north of town",
             summer_peak_vpd=PEAK_VPD, aadt_low=AADT_LOW, aadt_high=AADT_HIGH,
             factor_min=f"{PEAK_VPD / AADT_HIGH:.3f}", factor_max=f"{PEAK_VPD / AADT_LOW:.3f}",
             basis="observed_lower_bound", source="S-D18; S-D02",
             notes=("DIT states 'more than 11,000' so both factors are lower bounds; which AADT section the figure "
                    "refers to is not stated; direction split and day of week not stated; AADT is a both-direction "
                    "annual mean. Applies to Victor Harbor Rd only; no factor exists for the town centre.")),
        dict(factor_id="parking_2015_cbd",
             description="Town-centre parking occupancy, summer vs typical weekday (supporting evidence only)",
             summer_peak_vpd="", aadt_low="", aadt_high="", factor_min="", factor_max="",
             basis="supporting_only", source="S-D21 s7.2",
             notes=("Report text: core CBD occupancy 'consistently more than 80%' on Wed 2 Dec 2015 (typical weekday) "
                    "AND on Wed 30 Dec 2015 (peak summer); on 30 Dec the whole CBD incl. Flinders Pde was 'at or near "
                    "capacity for much of the day' (2 Dec: outside the core parking was readily available). So the core "
                    "was already above 80% on a typical day: this shows the summer peak widens the busy area, not a "
                    "ratio. The '26-29%' figures sometimes quoted are not core CBD occupancy (the 26% on 30 Dec is a "
                    "single overflow car park at Coles). No traffic factor is derived from this.")),
    ]


def write_csv(path: Path) -> int:
    rows = build_rows()
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return len(rows)
