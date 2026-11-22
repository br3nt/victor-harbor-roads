"""R14 accessibility table: travel-time distributions per (origin_area, dest_category, hour_band).

Travel time is the tripinfo ``duration`` (arrival - actual departure), optionally plus
``departDelay`` (time waiting to be inserted). The hour band is taken from the actual departure
time. Percentiles use ``numpy.percentile`` with its default **linear interpolation** (type 7:
position ``p/100 * (n-1)`` between sorted samples). Histograms use the fixed ``HIST_BINS`` so
runs/scenarios can be compared bin by bin; bins are ``[lo, hi)``, last bin open-ended.
"""
from __future__ import annotations

from collections import defaultdict
from xml.etree import ElementTree as ET

import numpy as np
import pandas as pd

from .bands import DEFAULT_HOUR_BANDS, band_of
from .ids import parse

HIST_BINS = [0, 60, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 3600, float("inf")]
DEFAULT_STRATA = ("res", "vis")
UNMAPPED = "unmapped"
COLUMNS = ["origin_area", "dest_category", "hour_band", "n", "mean", "median", "p95", "p99", "hist"]
KEYS = ["origin_area", "dest_category", "hour_band"]


def table(tripinfo_path, zone_to_area: dict, hour_bands: dict | None = None, strata=DEFAULT_STRATA,
          include_all: bool = True, include_depart_delay: bool = False) -> pd.DataFrame:
    """Aggregate a SUMO tripinfo file into the accessibility table.

    Columns: origin_area, dest_category, hour_band, n, mean, median, p95, p99 (seconds; numpy linear
    percentiles) and ``hist`` (list of counts per ``HIST_BINS`` bin). ``include_all`` adds an
    ``all`` hour_band row over every departure. Zones missing from ``zone_to_area`` go to
    area ``"unmapped"``; ids not matching the S2 contract or in other strata are skipped.
    """
    hour_bands = DEFAULT_HOUR_BANDS if hour_bands is None else hour_bands
    strata = set(strata)
    groups: dict[tuple, list] = defaultdict(list)
    for _, elem in ET.iterparse(str(tripinfo_path), events=("end",)):
        if elem.tag != "tripinfo":
            continue
        vid = parse(elem.get("id", ""))
        if vid is not None and vid.stratum in strata:
            dur = float(elem.get("duration"))
            if include_depart_delay:
                dur += max(float(elem.get("departDelay", 0) or 0), 0.0)
            area = zone_to_area.get(vid.origin_zone, UNMAPPED)
            band = band_of(float(elem.get("depart")), hour_bands)
            if band is not None:
                groups[(area, vid.dest_category, band)].append(dur)
            if include_all:
                groups[(area, vid.dest_category, "all")].append(dur)
        elem.clear()
    rows = []
    edges = np.array(HIST_BINS, dtype=float)
    for (area, cat, band), vals in groups.items():
        a = np.asarray(vals, dtype=float)
        p50, p95, p99 = np.percentile(a, [50, 95, 99])
        idx = np.searchsorted(edges, a, side="right") - 1
        hist = np.bincount(idx, minlength=len(edges) - 1).tolist()
        rows.append((area, cat, band, len(a), float(a.mean()), float(p50), float(p95), float(p99), hist))
    df = pd.DataFrame(rows, columns=COLUMNS)
    return df.sort_values(KEYS, ignore_index=True)
