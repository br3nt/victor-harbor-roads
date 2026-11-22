"""2017 Torrens Street turning counts (Tonkin review, source S-D19, Appendix A).

Parses the report's own text extract (``pdftotext -layout`` of the PDF, form-feed = page break)
into one record per (intersection, movement, 15-minute bin), and also extracts the report's
*stated* totals so tests can reproduce them.

Movement geometry (approach side, turn type, destination road) comes from the diagram printed
on each appendix page (movement numbers 1-12 in the standard four-leg layout; N arrow points up
the page).  Approach directions are the diagram's: they are a schematic and are NOT verified
compass bearings.  Where an arrow could not be read with confidence the ``notes`` column says so.
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path

from vhsim.paths import SOURCES

SOURCE_ID = "S-D19"
TXT = SOURCES / "D" / "S-D-torrens-street-review-draft-2017.txt"
COLUMNS = ["intersection", "approach_road", "approach_dir", "movement", "to_road",
           "bin_start", "light", "heavy", "cycle", "source", "notes"]

_ROW = re.compile(r"^\s*(\d{1,2}):(\d\d)\s*-\s*\d{1,2}:\d\d\s+(.*)$")
_TIME = re.compile(r"^\d{1,2}:\d\d$")


@dataclass(frozen=True)
class Mov:
    approach_road: str
    approach_dir: str   # side of the diagram the approach arrives from
    movement: str       # L|T|R|U
    to_road: str
    notes: str = ""


def _four_leg(n: str, s: str, e: str, w: str, notes: str = "") -> dict[str, Mov]:
    """Standard Austraffic four-leg numbering: 1-3 from S, 4-6 from E, 7-9 from N, 10-12 from W;
    each triple is left, through, right; 3A/6A/9A/12A are U-turns on that approach."""
    arms = {"S": (s, [("L", w), ("T", n), ("R", e)]),
            "E": (e, [("L", s), ("T", w), ("R", n)]),
            "N": (n, [("L", e), ("T", s), ("R", w)]),
            "W": (w, [("L", n), ("T", e), ("R", s)])}
    out: dict[str, Mov] = {}
    base = {"S": 1, "E": 4, "N": 7, "W": 10}
    for d, (road, trio) in arms.items():
        for i, (turn, to) in enumerate(trio):
            out[str(base[d] + i)] = Mov(road, d, turn, to, notes)
        out[f"{base[d] + 2}A"] = Mov(road, d, "U", road, notes)
    return out


def _t_junction(notes: str) -> dict[str, Mov]:
    """Coral St: a T with Torrens St running N-S and Coral St arriving from the E."""
    tor, cor = "Torrens Street", "Coral Street"
    full = _four_leg(tor, tor, cor, "(none)", notes)
    keep = {"2", "3", "3A", "4", "6", "6A", "7", "8", "9A"}
    out = {k: v for k, v in full.items() if k in keep}
    return out


def _grantley() -> dict[str, Mov]:
    """Five-lane approaches either side of a central island (Hindmarsh Rd / Bridge Terrace).

    Movement turn types are read from the diagram arrows; destinations across the island are not
    resolvable from the schematic and are marked as such."""
    hr, bt, ga, cp = "Hindmarsh Rd", "Bridge Terrace", "Grantley Avenue", "Car Park"
    low = "turn type read from diagram arrow; destination is a schematic reading, low confidence"
    m: dict[str, Mov] = {}
    # South approaches: Hindmarsh Rd lanes 1-5, Bridge Terrace lanes 6-10 (heading north).
    m["1"] = Mov(hr, "S", "L", ga)
    m["2"] = Mov(hr, "S", "T", hr)
    m["3"] = Mov(hr, "S", "T", hr, "lane drawn with a short jog; read as through")
    m["4"] = Mov(hr, "S", "R", f"{cp}/{bt} (unresolved)", low)
    m["5"] = Mov(hr, "S", "U", hr, "arrow doubles back beside the island; read as U-turn/return")
    m["5A"] = Mov(hr, "S", "U", hr)
    m["6"] = Mov(bt, "S", "U", bt, "arrow doubles back beside the island; read as U-turn/return")
    m["7"] = Mov(bt, "S", "L", f"{ga}/{hr} (unresolved)", low)
    m["8"] = Mov(bt, "S", "T", bt, "lane drawn with a short jog; read as through")
    m["9"] = Mov(bt, "S", "T", bt)
    m["10"] = Mov(bt, "S", "R", cp)
    m["10A"] = Mov(bt, "S", "U", bt)
    # East approach (Car Park), heading west: 11,12 turn south; 13 through; 14,15 turn north.
    m["11"] = Mov(cp, "E", "L", bt)
    m["12"] = Mov(cp, "E", "L", bt)
    m["13"] = Mov(cp, "E", "T", ga)
    m["14"] = Mov(cp, "E", "R", bt)
    m["15"] = Mov(cp, "E", "R", bt)
    m["15A"] = Mov(cp, "E", "U", cp)
    # North approaches heading south: Bridge Terrace 16-20, Hindmarsh Rd 21-25.
    m["16"] = Mov(bt, "N", "L", cp)
    m["17"] = Mov(bt, "N", "T", bt)
    m["18"] = Mov(bt, "N", "T", bt, "lane drawn with a short jog; read as through")
    m["19"] = Mov(bt, "N", "R", f"{ga}/{hr} (unresolved)", low)
    m["20"] = Mov(bt, "N", "U", bt, "arrow doubles back beside the island; read as U-turn/return")
    m["20A"] = Mov(bt, "N", "U", bt)
    m["21"] = Mov(hr, "N", "U", hr, "arrow doubles back beside the island; read as U-turn/return")
    m["22"] = Mov(hr, "N", "L", f"{cp}/{bt} (unresolved)", low)
    m["23"] = Mov(hr, "N", "T", hr, "lane drawn with a short jog; read as through")
    m["24"] = Mov(hr, "N", "T", hr)
    m["25"] = Mov(hr, "N", "R", ga)
    m["25A"] = Mov(hr, "N", "U", hr)
    # West approach (Grantley Avenue), heading east: 26,27 turn north; 28 through; 29,30 turn south.
    m["26"] = Mov(ga, "W", "L", hr)
    m["27"] = Mov(ga, "W", "L", hr)
    m["28"] = Mov(ga, "W", "T", cp)
    m["29"] = Mov(ga, "W", "R", hr)
    m["30"] = Mov(ga, "W", "R", hr)
    m["30A"] = Mov(ga, "W", "U", ga)
    return m


_DIAGRAM_NOTE = "diagram orientation (N arrow up the page); schematic, not a surveyed bearing"

# name -> (survey location per report, pages (1-based in the text extract), movement map)
SITES: dict[str, dict] = {
    "Torrens/Coral": dict(
        location="Torrens Street/Coral Street", pages=[24],
        movs=_t_junction(_DIAGRAM_NOTE + "; T-junction, Coral St enters from the E")),
    "Torrens/Crozier": dict(
        location="Torrens Street/Crozier Road", pages=[25, 26],
        movs=_four_leg("Torrens Street", "Torrens Street", "Crozier Road", "Crozier Road", _DIAGRAM_NOTE)),
    "Hindmarsh/Grantley/Bridge Tce": dict(
        location="Torrens Street/Grantley Avenue/Bridge Terrace", pages=[27, 28, 29, 30],
        movs=_grantley()),
    "Torrens/Ocean": dict(
        location="Torrens Street/Ocean Street", pages=[31, 32],
        movs=_four_leg("Torrens Street", "Torrens Street", "Ocean Street", "Access", _DIAGRAM_NOTE)),
    "Torrens/Seaview/Eyre": dict(
        location="Torrens Street/Seaview Road/Eyre Terrace", pages=[33, 34],
        movs=_four_leg("Hindmarsh Road", "Torrens Street", "Eyre Terrace", "Seaview Road", _DIAGRAM_NOTE)),
    "Torrens/Stuart": dict(
        location="Torrens Street/Stuart Street", pages=[35, 36],
        movs=_four_leg("Torrens Street", "Torrens Street", "Stuart Street", "Hill Street", _DIAGRAM_NOTE)),
    "Torrens/Victoria": dict(
        location="Torrens Street/Victoria Street", pages=[37, 38],
        movs=_four_leg("Torrens Street", "Wills Street", "Victoria Street", "Victoria Street",
                       _DIAGRAM_NOTE + "; diagram labels the S arm Wills Street")),
}
# Torrens Street at Coral is drawn on both N and S arms; at Seaview/Eyre the N arm is Hindmarsh Road.
# NOTE: at Victoria the diagram labels the N arm Torrens Street and the S arm Wills Street.


def _norm(t: str) -> str:
    h, m = t.split(":")
    return f"{int(h):02d}:{m}"


def _parse_page(text: str):
    """Return (movement ids, rows, totals_row, summary_rows) for one appendix page."""
    lines = text.splitlines()
    head = next(ln for ln in lines if ln.lstrip().startswith("Time") and "Movement" in ln)
    ids = re.findall(r"Movement\s+(\d+A?)", head)
    n = len(ids)
    rows: dict[str, list[int]] = {}
    extra: dict[str, list[str]] = {}
    totals = None
    summary: dict[str, list[int]] = {}
    for ln in lines:
        m = _ROW.match(ln)
        if m:
            toks = m.group(3).split()
            nums = [int(x) for x in toks[: 4 * n]]
            assert len(nums) == 4 * n, ln
            rows[_norm(f"{m.group(1)}:{m.group(2)}")] = nums
            extra[_norm(f"{m.group(1)}:{m.group(2)}")] = toks[4 * n:]
            continue
        s = ln.split()
        if s and s[0] == "Total" and len(s) > 4 * n and all(x.isdigit() for x in s[1:]):
            totals = [int(x) for x in s[1:]]
        elif s and len(s) > 4 * n + 1 and s[0] in ("AM", "PM") and s[1] == "Peak":
            summary[s[0]] = [int(x) for x in s[2:]]
    return ids, rows, extra, totals, summary


def parse_report(txt: Path | None = None):
    """Parse Appendix A. Returns (records, stated).

    records: list of dicts with COLUMNS keys (movement counts, ints).
    stated: per intersection, the report's own printed figures:
        row_totals {bin: total of all movements}, rolling {bin: peak-hour-determination volume},
        totals_row (12 h total), am_peak, pm_peak, movement_totals {id: total}.
    """
    pages = Path(txt or TXT).read_text(encoding="utf-8").split("\f")
    records: list[dict] = []
    stated: dict[str, dict] = {}
    for name, site in SITES.items():
        mov_totals: dict[str, int] = {}
        st = dict(row_totals={}, rolling={}, totals_row=None, am_peak=None, pm_peak=None,
                  movement_totals=mov_totals)
        for pno in site["pages"]:
            text = pages[pno - 1]
            loc = re.search(r"Survey Location\s*:\s*(.*)", text).group(1).strip()
            assert loc.replace(" ", "") == site["location"].replace(" ", ""), (name, pno, loc)
            ids, rows, extra, totals, summary = _parse_page(text)
            for t, nums in rows.items():
                for k, mid in enumerate(ids):
                    light, heavy, cyc, tot = nums[4 * k: 4 * k + 4]
                    assert light + heavy + cyc == tot, (name, pno, t, mid)
                    mv = site["movs"][mid]
                    records.append(dict(
                        intersection=name, approach_road=mv.approach_road, approach_dir=mv.approach_dir,
                        movement=mv.movement, to_road=mv.to_road, bin_start=t, light=light, heavy=heavy,
                        cycle=cyc, source=SOURCE_ID,
                        notes="; ".join(x for x in (f"report movement {mid}", mv.notes) if x)))
            for k, mid in enumerate(ids):
                mov_totals[mid] = totals[4 * k + 3]
            if totals and len(totals) == 4 * len(ids) + 1:   # last page of the site
                st["totals_row"] = totals[-1]
                for t in rows:
                    ex = extra[t]
                    st["row_totals"][t] = int(ex[0])
                    # "<start> - <end> <volume>" when a peak-hour determination is printed
                    if len(ex) >= 5 and _TIME.match(ex[1]) and ex[2] == "-":
                        st["rolling"][_norm(ex[1])] = int(ex[4])
                st["am_peak"] = summary["AM"][-1]
                st["pm_peak"] = summary["PM"][-1]
        stated[name] = st
    return records, stated


def write_csv(path: Path, txt: Path | None = None) -> int:
    records, _ = parse_report(txt)
    records.sort(key=lambda r: (list(SITES).index(r["intersection"]), r["bin_start"],
                                r["approach_dir"], r["movement"], r["notes"]))
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(records)
    return len(records)


def write_stated_csv(path: Path, txt: Path | None = None) -> int:
    """The report's own printed totals next to the totals recomputed from the 15-minute bins."""
    records, stated = parse_report(txt)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    cols = ["intersection", "total_12h_stated", "total_12h_from_bins", "am_peak_stated",
            "pm_peak_stated", "busiest_hour_start", "busiest_hour_from_bins", "source"]
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, lineterminator="\n")
        w.writeheader()
        for name in SITES:
            bins: dict[str, int] = {}
            for r in records:
                if r["intersection"] == name:
                    bins[r["bin_start"]] = bins.get(r["bin_start"], 0) + r["light"] + r["heavy"] + r["cycle"]
            times = sorted(bins)
            roll = {times[i]: sum(bins[t] for t in times[i:i + 4]) for i in range(len(times) - 3)}
            st = stated[name]
            top_stated = max(st["rolling"].values())
            top_bins = max(roll.values())
            w.writerow(dict(
                intersection=name, total_12h_stated=st["totals_row"], total_12h_from_bins=sum(bins.values()),
                am_peak_stated=st["am_peak"], pm_peak_stated=st["pm_peak"],
                busiest_hour_start=min(t for t, v in st["rolling"].items() if v == top_stated),
                busiest_hour_from_bins=min(t for t, v in roll.items() if v == top_bins), source=SOURCE_ID))
    return len(SITES)
