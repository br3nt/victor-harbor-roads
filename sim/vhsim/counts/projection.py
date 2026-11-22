"""Project the 2017 turning counts (S-D19, Wed 26 Apr 2017) to a 2025 term weekday.

Each road gets a growth factor for 26 April 2017 -> mid-2025:
  * roads with a Department for Infrastructure and Transport (DIT) history (S-D02): a log-linear
    (constant % per year) least-squares fit of AADT against COUNT year (not release year), evaluated
    at 2017.32 and 2025.5 (so 2025 is an extrapolation of the last 1-2 count years);
  * council streets (no DIT counts): Estimated Resident Population (ERP) growth for the City of
    Victor Harbor, 30 Jun 2018 -> 30 Jun 2025 (S-C03) as a compound annual rate, applied for the
    same period.  ERP for 2017 is not in the archived table, so 2018 is the base year.
A movement's factor is the geometric mean of the approach road's and the destination road's
factors when both are known roads; otherwise the approach road's factor alone.  An extra
school-holiday -> term-weekday adjustment exists but is 1.0 (no evidence; flagged assumption).
"""
from __future__ import annotations

import csv
import math
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from vhsim.counts import turning
from vhsim.paths import SOURCES

T0 = 2017 + 116 / 365      # 26 April 2017
T1 = 2025.5                 # mid-2025
TERM_ADJUSTMENT = 1.0
TERM_ADJUSTMENT_BASIS = ("assumption: 1.0 (no evidence found for a school-holiday vs term-weekday difference "
                         "in this town centre; see PROJECTION.md)")
_DIT = SOURCES / "D" / "D-tv-selected-roads-by-release.csv"
_ERP_PDF = SOURCES / "C" / "S-C03-sa-erp-2025.pdf"

COLUMNS = ["intersection", "approach_road", "approach_dir", "movement", "to_road", "bin_start",
           "light", "heavy", "cycle", "factor", "factor_basis", "term_adjustment",
           "light_projected", "heavy_projected", "cycle_projected", "basis", "source"]


@dataclass(frozen=True)
class Factor:
    factor: float
    basis: str


def fit_factor(points: list[tuple[float, float]], t0: float = T0, t1: float = T1) -> float:
    """Growth factor t0 -> t1 from a least-squares line through (year, ln AADT)."""
    xs = [p[0] for p in points]
    ys = [math.log(p[1]) for p in points]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return math.exp(slope * (t1 - t0))


def dit_history(road_no: str, a: float, b: float) -> list[tuple[int, int]]:
    """(count_year, AADT) for a section across all releases, one point per count year (latest release wins)."""
    latest: dict[int, tuple[int, int]] = {}
    with open(_DIT) as fh:
        for r in csv.DictReader(fh):
            if r["road_no"].zfill(5) == road_no and abs(float(r["start_rrd"]) - a) < 1e-6 \
                    and abs(float(r["end_rrd"]) - b) < 1e-6:
                cy, rel = int(r["count_year"]), int(r["release_year"])
                if cy not in latest or rel >= latest[cy][0]:
                    latest[cy] = (rel, int(float(r["aadt"])))
    return sorted((cy, v[1]) for cy, v in latest.items())


def erp_series() -> dict[int, int]:
    """City of Victor Harbor ERP at 30 June, 2018..2025 (S-C03), read from the archived PDF."""
    txt = subprocess.run(["pdftotext", "-layout", str(_ERP_PDF), "-"], capture_output=True, text=True,
                         check=True).stdout
    line = next(ln for ln in txt.splitlines() if ln.startswith("Victor Harbor"))
    nums = [int(x.replace(",", "")) for x in re.findall(r"\d+,\d{3}", line)]
    assert len(nums) == 8
    return dict(zip(range(2018, 2026), nums))


def population_factor() -> float:
    s = erp_series()
    cagr = (s[2025] / s[2018]) ** (1 / 7)
    return cagr ** (T1 - T0)


DIT_ROADS = {   # road name -> list of (road_no, from_km, to_km)
    "Torrens Street": [("04760", 50.0, 50.38), ("04760", 50.38, 50.56)],
    "Hindmarsh Road": [("04760", 49.1, 50.0)],
    "Victoria Street": [("04793", 31.5, 32.36)],
}
COUNCIL_ROADS = ["Wills Street", "Crozier Road", "Ocean Street", "Access", "Stuart Street", "Hill Street",
                 "Coral Street", "Eyre Terrace", "Seaview Road", "Bridge Terrace", "Grantley Avenue",
                 "Car Park"]
_ALIASES = {"Hindmarsh Rd": "Hindmarsh Road"}


def road_factors() -> dict[str, Factor]:
    out: dict[str, Factor] = {}
    for road, secs in DIT_ROADS.items():
        fs, parts = [], []
        for no, a, b in secs:
            pts = dit_history(no, a, b)
            fs.append(fit_factor([(float(y), float(v)) for y, v in pts]))
            parts.append(f"{no} RRD {a:g}-{b:g} count years " + ",".join(str(y) for y, _ in pts))
        f = math.exp(sum(math.log(x) for x in fs) / len(fs))
        out[road] = Factor(f, f"S-D02 DIT AADT history, log-linear fit by count year, {T0:.2f}->{T1}: "
                              + "; ".join(parts) + (" (geometric mean of sections)" if len(fs) > 1 else ""))
    pf = population_factor()
    for road in COUNCIL_ROADS:
        out[road] = Factor(pf, f"S-C03 City of Victor Harbor ERP growth 2018-2025 as annual rate, applied {T0:.2f}->{T1} "
                               "(council street, no DIT counts)")
    return out


def _canon(name: str) -> str:
    return _ALIASES.get(name, name)


def movement_factor(approach_road: str, to_road: str, factors: dict[str, Factor]) -> Factor:
    a = _canon(approach_road)
    t = _canon(to_road)
    fa = factors[a]
    if t in factors and t != a:
        ft = factors[t]
        return Factor(math.sqrt(fa.factor * ft.factor),
                      f"geometric mean of approach road ({a}) and destination road ({t}); "
                      f"approach: {fa.basis}; destination: {ft.basis}")
    if t == a:
        return Factor(fa.factor, f"road factor for {a} (same road in and out): {fa.basis}")
    return Factor(fa.factor, f"approach road only ({a}; destination not a single known road): {fa.basis}")


def build_rows() -> list[dict]:
    records, _ = turning.parse_report()
    factors = road_factors()
    cache: dict[tuple, Factor] = {}
    rows = []
    for r in records:
        key = (r["approach_road"], r["to_road"])
        if key not in cache:
            cache[key] = movement_factor(*key, factors)
        f = cache[key]
        k = f.factor * TERM_ADJUSTMENT
        rows.append(dict(
            intersection=r["intersection"], approach_road=r["approach_road"], approach_dir=r["approach_dir"],
            movement=r["movement"], to_road=r["to_road"], bin_start=r["bin_start"], light=r["light"],
            heavy=r["heavy"], cycle=r["cycle"], factor=f"{f.factor:.4f}", factor_basis=f.basis,
            term_adjustment=f"{TERM_ADJUSTMENT:.1f}",
            light_projected=f"{r['light'] * k:.3f}", heavy_projected=f"{r['heavy'] * k:.3f}",
            cycle_projected=f"{r['cycle'] * k:.3f}", basis="projected",
            source="S-D19; S-D02; S-C03"))
    return rows


def write_csv(path: Path) -> int:
    rows = build_rows()
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return len(rows)
