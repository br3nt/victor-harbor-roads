"""R15 intersection movements: approach delay per (junction, from_edge, to_edge) from vehroute exit times.

Definitions (see assumptions/S4-metrics.md):

* For a vehicle route ``e0 e1 ... en`` with exit times ``t0 ... tn`` (SUMO ``--vehroute-output.exit-times``),
  time on edge ``ei`` is ``ti - t(i-1)``; for i = 0 the vehicle's entry time is its insertion/depart time and
  is NOT used (it is not approach delay), so the first edge of each route and the last edge (no onward
  movement) are excluded.
* Delay on approach A of movement A -> B = ``time_on(A) - length(A) / speed(A)`` with the edge's length and
  maximum lane speed from the net. Negative values (vehicles with a speed factor > 1) are kept, not clipped.
  Junction transit time is counted in the *next* edge's time (SUMO leaves the edge at the stop line), so the
  delay on A is queueing / give-way / deceleration time on A up to the stop line.
* The movement is attributed to ``junction_id`` = the net node A ends at, and to the hour band of A's exit time.
* Internal edges (``:...``) and pairs that are not adjacent in the net are ignored.

Geometry labels use bearings (degrees clockwise from north) of A's last segment and B's first segment.
``approach_dir`` is the side of the junction the vehicle arrives FROM (traffic-engineering convention: the
"northern approach" is driving south); ``heading_dir`` is the direction of travel. The turn type comes from the
signed change of bearing ``a = bearing(B first) - bearing(A last)`` wrapped to (-180, 180]:
``|a| < 30`` T (through), ``30 <= a < 150`` R, ``-150 < a <= -30`` L, ``|a| >= 150`` U.
Percentiles are numpy linear interpolation.
"""
from __future__ import annotations

import math
from xml.etree import ElementTree as ET

import numpy as np
import pandas as pd

from .bands import DEFAULT_HOUR_BANDS, band_hours

THROUGH_MAX_DEG = 30.0
UTURN_MIN_DEG = 150.0
COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
COLUMNS = ["junction_id", "from_edge", "to_edge", "hour_band", "approach_dir", "heading_dir", "turn",
           "from_name", "to_name", "n", "mean_delay", "median_delay", "p95_delay", "flow_per_hour"]
KEYS = ["junction_id", "from_edge", "to_edge", "hour_band"]


def bearing(p, q) -> float:
    """Compass bearing in degrees [0, 360), clockwise from north (+y), of the vector p -> q."""
    return math.degrees(math.atan2(q[0] - p[0], q[1] - p[1])) % 360.0


def compass(deg: float) -> str:
    """Nearest of the 8 compass points (45 degree sectors centred on N, NE, ...)."""
    return COMPASS[int(((deg % 360.0) + 22.5) // 45) % 8]


def signed_turn(bearing_in: float, bearing_out: float) -> float:
    """Change of heading wrapped to (-180, 180]; positive = clockwise (right)."""
    a = (bearing_out - bearing_in) % 360.0
    return a - 360.0 if a > 180.0 else a


def turn_type(angle: float) -> str:
    """L / T / R / U for a signed heading change (see module docstring for thresholds)."""
    if abs(angle) >= UTURN_MIN_DEG:
        return "U"
    if abs(angle) < THROUGH_MAX_DEG:
        return "T"
    return "R" if angle > 0 else "L"


def read_net_edges(net_path) -> dict:
    """Non-internal edges of a .net.xml: id -> dict(from, to, length, speed, name, first_seg, last_seg)."""
    edges = {}
    for _, el in ET.iterparse(str(net_path), events=("end",)):
        if el.tag != "edge":
            continue
        if el.get("function") in ("internal", "crossing", "walkingarea") or el.get("from") is None:
            el.clear()
            continue
        lanes = el.findall("lane")
        if lanes:
            lane = lanes[0]
            pts = [tuple(map(float, p.split(","))) for p in lane.get("shape", "").split()]
            speed = max(float(ln.get("speed", 0)) for ln in lanes)
            if len(pts) >= 2:
                edges[el.get("id")] = dict(
                    frm=el.get("from"), to=el.get("to"), length=float(lane.get("length")), speed=speed,
                    name=el.get("name", ""), first=(pts[0], pts[1]), last=(pts[-2], pts[-1]))
        el.clear()
    return edges


def labels(net_path) -> pd.DataFrame:
    """Geometry labels for every ordered pair of edges A -> B meeting at a node (whether or not connected).

    Columns: junction_id, from_edge, to_edge, approach_dir, heading_dir, turn, angle.
    """
    edges = read_net_edges(net_path)
    by_from: dict[str, list] = {}
    for eid, e in edges.items():
        by_from.setdefault(e["frm"], []).append(eid)
    rows = []
    for a, ea in edges.items():
        for b in by_from.get(ea["to"], []):
            rows.append(_label_row(a, ea, b, edges[b]))
    return pd.DataFrame(rows, columns=["junction_id", "from_edge", "to_edge", "approach_dir", "heading_dir",
                                       "turn", "angle"])


def _label_row(a, ea, b, eb):
    ba = bearing(*ea["last"])
    bb = bearing(*eb["first"])
    ang = signed_turn(ba, bb)
    return (ea["to"], a, b, compass(ba + 180.0), compass(ba), turn_type(ang), ang)


def table(vehroute_path, net_path, hour_bands: dict | None = None, include_all: bool = True,
          duration_hours: float | None = None, chunk_vehicles: int = 20000) -> pd.DataFrame:
    """Aggregate a vehroute file (with exit times) into per-movement delay statistics.

    Columns: junction_id, from_edge, to_edge, hour_band, approach_dir, heading_dir, turn, from_name, to_name,
    n, mean_delay, median_delay, p95_delay (seconds), flow_per_hour. ``flow_per_hour`` = n / hours in the band
    (assumes the simulation covers the whole band); for the ``all`` row, hours = ``duration_hours`` or the sum
    of the band lengths. Routes without exit times, partial routes and non-adjacent edge pairs are skipped.
    """
    hour_bands = DEFAULT_HOUR_BANDS if hour_bands is None else hour_bands
    edges = read_net_edges(net_path)
    ids = list(edges)
    index = {e: i for i, e in enumerate(ids)}
    free = np.array([edges[e]["length"] / edges[e]["speed"] if edges[e]["speed"] > 0 else np.nan for e in ids])
    node_ids = {n: i for i, n in enumerate({edges[e]["frm"] for e in ids} | {edges[e]["to"] for e in ids})}
    efrom = np.array([node_ids[edges[e]["frm"]] for e in ids])
    eto = np.array([node_ids[edges[e]["to"]] for e in ids])
    band_labels = list(hour_bands)
    lo = np.array([hour_bands[b][0] for b in band_labels], dtype=float)
    hi = np.array([hour_bands[b][1] for b in band_labels], dtype=float)

    parts_a, parts_b, parts_band, parts_delay = [], [], [], []

    def flush(eidx, times, lens):
        if not lens:
            return
        eidx = np.asarray(eidx, dtype=np.int64)
        times = np.asarray(times, dtype=float)
        lens = np.asarray(lens)
        ends = np.cumsum(lens)
        starts = ends - lens
        first = np.zeros(len(eidx), bool)
        first[starts] = True
        last = np.zeros(len(eidx), bool)
        last[ends - 1] = True
        k = np.nonzero(~first & ~last)[0]
        a, b = eidx[k], eidx[k + 1]
        ok = (a >= 0) & (b >= 0)
        a, b, k = a[ok], b[ok], k[ok]
        ok = eto[a] == efrom[b]
        a, b, k = a[ok], b[ok], k[ok]
        delay = (times[k] - times[k - 1]) - free[a]
        hours = (times[k] % 86400.0) / 3600.0
        bi = np.full(len(k), -1, dtype=np.int64)
        for j in range(len(band_labels)):
            bi[(hours >= lo[j]) & (hours < hi[j])] = j
        parts_a.append(a); parts_b.append(b); parts_band.append(bi); parts_delay.append(delay)

    eidx, times, lens = [], [], []
    get = index.get
    for _, veh in ET.iterparse(str(vehroute_path), events=("end",)):
        if veh.tag != "vehicle":
            continue
        route = None
        for r in veh.iter("route"):
            if r.get("exitTimes") is not None:
                route = r
        if route is not None:
            es = route.get("edges", "").split()
            ts = route.get("exitTimes").split()
            if len(es) == len(ts) and len(es) >= 3:
                eidx.extend([get(e, -1) for e in es])
                times.extend(map(float, ts))
                lens.append(len(es))
                if len(lens) >= chunk_vehicles:
                    flush(eidx, times, lens)
                    eidx, times, lens = [], [], []
        veh.clear()
    flush(eidx, times, lens)

    if not parts_a:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.DataFrame({"a": np.concatenate(parts_a), "b": np.concatenate(parts_b),
                       "band": np.concatenate(parts_band), "delay": np.concatenate(parts_delay)})
    pieces = []
    banded = df[df.band >= 0]
    pieces.append(_aggregate(banded, band_labels, {j: band_hours(hour_bands, l) for j, l in enumerate(band_labels)}))
    if include_all:
        allh = duration_hours if duration_hours else sum(band_hours(hour_bands, l) for l in band_labels)
        pieces.append(_aggregate(df.assign(band=-1), ["all"], {-1: allh}, all_mode=True))
    out = pd.concat(pieces, ignore_index=True)
    out["junction_id"] = [edges[ids[a]]["to"] for a in out.a]
    out["from_edge"] = [ids[a] for a in out.a]
    out["to_edge"] = [ids[b] for b in out.b]
    lab = [_label_row(ids[a], edges[ids[a]], ids[b], edges[ids[b]]) for a, b in zip(out.a, out.b)]
    out["approach_dir"] = [r[3] for r in lab]
    out["heading_dir"] = [r[4] for r in lab]
    out["turn"] = [r[5] for r in lab]
    out["from_name"] = [edges[ids[a]]["name"] for a in out.a]
    out["to_name"] = [edges[ids[b]]["name"] for b in out.b]
    return out[COLUMNS].sort_values(KEYS, ignore_index=True)


def _aggregate(df, labels_, hours, all_mode=False):
    g = df.groupby(["a", "b", "band"], sort=False)["delay"]
    res = g.agg(n="size", mean_delay="mean", median_delay="median")
    res["p95_delay"] = g.quantile(0.95)
    res = res.reset_index()
    res["hour_band"] = ["all" if all_mode else labels_[j] for j in res.band]
    res["flow_per_hour"] = [n / hours[j] for n, j in zip(res.n, res.band)]
    return res.drop(columns="band")
