"""Hotspot evidence (S8): waits, queues, vehicles, time stopped and travel time through each hotspot.

    python -m vhsim.integration.hotspots extract [--workers 6]   # one pass per run, cached
    python -m vhsim.integration.hotspots build                    # sim/data/results/hotspots/<id>.json

Method (sim/assumptions/S8-hotspots.md):
* A hotspot's edges are those whose stop line lies in one of its measuring circles (``hotspot_defs``), in the
  network of the scenario measured, so rebuilt junctions are measured on the same ground.
* Approach wait (s per vehicle) = for each vehicle, the sum over the approach's edges inside the hotspot of
  (time on edge - length / speed limit), from vehroute exit times, as the R15 approach delay (A-INT I2). The
  edge a vehicle starts on is not counted. Approaches are grouped by street name and the side the traffic
  comes from (a turn bay joins its approach), per measuring circle.
* Queues: laneData (15-minute) waitingTime / 900 s = vehicles standing still on average in that quarter-hour;
  metres = vehicles x QUEUE_SPACING_M. The peak 15 minutes is the quarter-hour with most time stopped over
  the whole hotspot (seed mean).
* Time stopped (vehicle-hours/day) = laneData waitingTime on the hotspot's lanes / 3600 (as the S7 edgeData
  figures, no internal lanes).
* Travel time through = from entering the first hotspot edge (exit time of the edge before) to leaving the
  last one, for vehicles that enter from outside and leave again; delay = that minus free-flow time.
Seeds are pooled: per-vehicle statistics over all seeds' vehicles, per-day totals divided by the seed count.
"""
from __future__ import annotations

import argparse
import functools
import json
import math
import pickle
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

from vhsim.integration import hotspot_defs as hd
from vhsim.metrics.movements import bearing, compass
from vhsim.paths import DATA, MAIN_CHECKOUT

RUNS = DATA / "runs"
NETWORKS = DATA / "networks"
OUT = DATA / "results" / "hotspots"
CACHE = OUT / "cache"
QUEUE_SPACING_M = 7.5          # a queued car (4.6 m) plus its gap (2.5 m), rounded up for the truck/caravan share
TELEPORT_LIMIT = 0.05          # as vhsim.integration.batch (max_teleport_fraction)
INTERVAL = 900
NETWORK_NAME = {"baseline": "baseline_bays"}


def net_for(scenario: str) -> str:
    return NETWORK_NAME.get(scenario, f"{scenario}_bays")


# ---------------------------------------------------------------- network geometry
class NetGeo:
    """lon/lat <-> network x/y for a SUMO net (its <location>); projParameter "!" means x/y are lon/lat."""

    def __init__(self, net_path):
        loc = None
        for _, el in ET.iterparse(str(net_path), events=("start",)):
            if el.tag == "location":
                loc = el.attrib
                break
            if el.tag == "edge":
                break
        loc = loc or {"netOffset": "0,0", "projParameter": "!"}
        self.ox, self.oy = map(float, loc["netOffset"].split(","))
        proj = loc.get("projParameter", "!")
        self._proj = None
        if proj != "!":
            import pyproj
            self._proj = pyproj.Proj(proj)

    def to_xy(self, lon, lat):
        if self._proj is None:
            return float(lon), float(lat)
        x, y = self._proj(lon, lat)
        return x + self.ox, y + self.oy

    def to_lonlat(self, x, y):
        if self._proj is None:
            return float(x), float(y)
        lon, lat = self._proj(x - self.ox, y - self.oy, inverse=True)
        return lon, lat


def read_edges(net_path) -> dict:
    """Non-internal edges: id -> dict(name, frm, to, length, speed, free, end (x, y) of lane 0's stop line,
    last (segment), lanes [ids], roundabout (bool))."""
    edges, ring = {}, set()
    for _, el in ET.iterparse(str(net_path), events=("end",)):
        if el.tag == "roundabout":
            ring |= set(el.get("edges", "").split())
        if el.tag != "edge":
            continue
        if el.get("function") in ("internal", "crossing", "walkingarea") or el.get("from") is None:
            el.clear()
            continue
        lanes = el.findall("lane")
        if lanes:
            pts = [tuple(map(float, p.split(","))) for p in lanes[0].get("shape", "").split()]
            speed = max(float(ln.get("speed", 0)) for ln in lanes)
            length = float(lanes[0].get("length"))
            if len(pts) >= 2:
                edges[el.get("id")] = dict(
                    id=el.get("id"), name=el.get("name", ""), frm=el.get("from"), to=el.get("to"),
                    length=length, speed=speed, free=length / speed if speed > 0 else 0.0, end=pts[-1],
                    last=(pts[-2], pts[-1]), shape=pts, lanes=[ln.get("id") for ln in lanes], roundabout=False)
        el.clear()
    for e in ring:
        if e in edges:
            edges[e]["roundabout"] = True
    for eid, e in edges.items():           # S7 ring edges are roundabouts too
        if eid.startswith("s7_ring"):
            e["roundabout"] = True
    return edges


def _metres(geo: NetGeo, lon, lat):
    return geo.to_xy(lon, lat)


def circle_of(edge: dict, geo: NetGeo, circles) -> int | None:
    """Index of the first measuring circle containing the edge's stop line, else None."""
    x, y = edge["end"]
    for i, c in enumerate(circles):
        cx, cy = _metres(geo, c[0], c[1])
        if math.hypot(x - cx, y - cy) <= c[2]:
            return i
    return None


def area_edges(edges: dict, geo: NetGeo, spec: dict) -> set[str]:
    """Edge ids of a hotspot: stop line inside a circle, or ending at a node on ``street`` within ``lon``."""
    out = set()
    if spec.get("circles"):
        out |= {eid for eid, e in edges.items() if circle_of(e, geo, spec["circles"]) is not None}
    st = spec.get("street")
    if st:
        nodes = {e["to"] for e in edges.values() if e["name"] == st["name"]} | \
                {e["frm"] for e in edges.values() if e["name"] == st["name"]}
        lo, hi = st["lon"]
        for eid, e in edges.items():
            if e["to"] in nodes and lo <= geo.to_lonlat(*e["end"])[0] <= hi:
                out.add(eid)
    return out


def approach_group(edge: dict) -> tuple[str, str]:
    """(street label, side the traffic comes from: compass point opposite the direction of travel)."""
    side = compass(bearing(*edge["last"]) + 180.0)
    if edge["roundabout"]:
        return ("roundabout", side)
    return (edge["name"] or "access road", side)


def stop_line_edges(edges: dict, edge_set: set[str]) -> dict[str, str]:
    """edge -> the edge whose stop line it queues for: follow a member edge into the next one while the node
    between them has no other way out and the street continues (an approach split into an upstream piece and
    a turn bay or flare is one approach). ``edges`` must hold the whole network (for the ways out)."""
    out: dict[str, list[str]] = {}
    for eid, e in edges.items():
        out.setdefault(e["frm"], []).append(eid)
    res = {}
    for e in edge_set:
        cur, seen = e, {e}
        while True:
            nxt = out.get(edges[cur]["to"], [])
            if len(nxt) != 1 or nxt[0] not in edge_set or nxt[0] in seen:
                break
            n = nxt[0]
            if edges[n]["name"] != edges[cur]["name"] or edges[n]["roundabout"] != edges[cur]["roundabout"]:
                break
            cur = n
            seen.add(n)
        res[e] = cur
    return res


def approach_groups(edges: dict, edge_set: set[str]) -> dict[str, tuple[str, str]]:
    """edge -> (street, side) of the approach it belongs to, named by its stop-line edge."""
    return {e: approach_group(edges[f]) for e, f in stop_line_edges(edges, edge_set).items()}


# ---------------------------------------------------------------- one pass over a run
def traversals(vehroute, edges: dict, member: dict[str, list[str]]):
    """Per-vehicle traversals of member edges and passes through each hotspot.

    ``member``: edge id -> hotspot ids. Returns (trav, passes):
    trav: veh, vtype, edge, t_exit, delay (s; the vehicle's first edge is skipped);
    passes: hid, veh, vtype, t_in, t_out, free (vehicles that enter a hotspot from outside and leave it).
    """
    tv, tt, te, tx, td = [], [], [], [], []
    ph, pv, pt, pi, po, pf = [], [], [], [], [], []
    for _, veh in ET.iterparse(str(vehroute), events=("end",)):
        if veh.tag != "vehicle":
            continue
        route = None
        for r in veh.iter("route"):
            if r.get("exitTimes") is not None:
                route = r
        if route is None:
            veh.clear()
            continue
        es = route.get("edges", "").split()
        ts = route.get("exitTimes").split()
        if len(es) != len(ts):
            veh.clear()
            continue
        vid, vtype = veh.get("id"), veh.get("type", "car")
        times = [float(t) for t in ts]
        open_runs: dict[str, list] = {}         # hid -> [start index, free sum]
        for i, eid in enumerate(es):
            hids = member.get(eid, ())
            if hids and i > 0 and eid in edges:
                tv.append(vid); tt.append(vtype); te.append(eid); tx.append(times[i])
                td.append(times[i] - times[i - 1] - edges[eid]["free"])
            for h in list(open_runs):
                if h not in hids:                # left hotspot h after edge i-1
                    start, free = open_runs.pop(h)
                    if start > 0:
                        ph.append(h); pv.append(vid); pt.append(vtype)
                        pi.append(times[start - 1]); po.append(times[i - 1]); pf.append(free)
            for h in hids:
                f = edges[eid]["free"] if eid in edges else 0.0
                if h in open_runs:
                    open_runs[h][1] += f
                else:
                    open_runs[h] = [i, f]
        veh.clear()
    trav = pd.DataFrame({"veh": tv, "vtype": tt, "edge": te, "t_exit": tx, "delay": td})
    passes = pd.DataFrame({"hid": ph, "veh": pv, "vtype": pt, "t_in": pi, "t_out": po, "free": pf})
    return trav, passes


def lane_waits(lanedata, edge_set: set[str]) -> pd.DataFrame:
    """edge, t (interval begin, s), wait_s (vehicle-seconds stopped, summed over the edge's lanes)."""
    rows, t = [], 0.0
    for ev, el in ET.iterparse(str(lanedata), events=("start", "end")):
        if ev == "start" and el.tag == "interval":
            t = float(el.get("begin"))
        elif ev == "end" and el.tag == "edge":
            eid = el.get("id")
            if eid in edge_set:
                w = sum(float(ln.get("waitingTime", 0)) for ln in el.findall("lane"))
                rows.append((eid, t, w))
            el.clear()
    df = pd.DataFrame(rows, columns=["edge", "t", "wait_s"])
    return df.groupby(["edge", "t"], as_index=False).wait_s.sum()


def hhmm(seconds: float) -> str:
    s = int(seconds) % 86400
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}"


def _r(x, nd=1):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), nd)


def summarise(edge_set: set[str], edges: dict, travs: list[pd.DataFrame], lanes: list[pd.DataFrame],
              passes: pd.DataFrame, hid: str, groups: dict[str, tuple] | None = None) -> dict:
    """Hotspot statistics pooled over seeds (``travs``/``lanes`` carry a ``seed`` column, one frame per seed).

    ``groups``: edge -> approach key (default: ``approach_group``)."""
    n = max(len(travs), 1)
    groups = groups or approach_groups(edges, {e for e in edge_set if e in edges})
    trav = pd.concat(travs, ignore_index=True) if travs else pd.DataFrame(columns=["veh", "vtype", "edge", "t_exit", "delay", "seed"])
    trav = trav[trav.edge.isin(edge_set)].copy()
    trav["g"] = trav.edge.map(groups)
    lane = pd.concat(lanes, ignore_index=True) if lanes else pd.DataFrame(columns=["edge", "t", "wait_s", "seed"])
    lane = lane[lane.edge.isin(edge_set)].copy()
    lane["g"] = lane.edge.map(groups)
    # seed-mean quarter-hour totals
    per_t = lane.groupby("t").wait_s.sum() / n
    peak_t = float(per_t.idxmax()) if len(per_t) and per_t.max() > 0 else None
    hourly = [0.0] * 26                     # the simulated day runs to 26:00 (02:00 next morning)
    for t, w in per_t.items():
        hourly[min(int(t // 3600), 25)] += w / 3600
    gq = lane.groupby(["g", "t"]).wait_s.sum() / n / INTERVAL          # mean vehicles stopped
    approaches = []
    pv = trav.groupby(["g", "seed", "veh"], as_index=False).agg(wait=("delay", "sum"), vtype=("vtype", "first"),
                                                                 t=("t_exit", "max"))
    for g, d in pv.groupby("g"):
        q = gq.loc[g] if g in gq.index.get_level_values(0) else pd.Series(dtype=float)
        in_peak = d[(d.t >= peak_t) & (d.t < peak_t + INTERVAL)] if peak_t is not None else d.iloc[0:0]
        stopped = lane[lane.g == g].wait_s.sum() / n / 3600
        approaches.append(dict(
            street=g[0], from_side=g[1], site=g[2] if len(g) > 2 else "",
            edges=sorted({e for e, gg in groups.items() if gg == g}),
            veh_per_day=round(len(d) / n), trucks_per_day=_r((d.vtype == "truck").sum() / n),
            caravans_per_day=_r((d.vtype == "caravan").sum() / n), buses_per_day=_r((d.vtype == "bus").sum() / n),
            mean_wait_s=_r(d.wait.mean()), p95_wait_s=_r(np.percentile(d.wait, 95)) if len(d) else None,
            peak15_mean_wait_s=_r(in_peak.wait.mean()) if len(in_peak) else None,
            stopped_veh_h=_r(stopped, 2),
            peak15_queue_veh=_r(q.get(peak_t, 0.0), 2) if peak_t is not None else 0.0,
            peak15_queue_m=_r(q.get(peak_t, 0.0) * QUEUE_SPACING_M) if peak_t is not None else 0.0,
            worst15_queue_veh=_r(q.max(), 2) if len(q) else 0.0,
            worst15_start=hhmm(q.idxmax()) if len(q) and q.max() > 0 else None))
    approaches.sort(key=lambda a: (-(a["stopped_veh_h"] or 0), -a["veh_per_day"]))
    p = passes[passes.hid == hid] if len(passes) else passes
    dur = (p.t_out - p.t_in) if len(p) else pd.Series(dtype=float)
    pk = p[(p.t_in >= peak_t) & (p.t_in < peak_t + INTERVAL)] if (len(p) and peak_t is not None) else p.iloc[0:0]
    through = dict(n_per_day=round(len(p) / n), mean_s=_r(dur.mean()) if len(p) else None,
                   p95_s=_r(np.percentile(dur, 95)) if len(p) else None,
                   mean_delay_s=_r((dur - p.free).mean()) if len(p) else None,
                   peak15_mean_s=_r((pk.t_out - pk.t_in).mean()) if len(pk) else None,
                   peak15_mean_delay_s=_r((pk.t_out - pk.t_in - pk.free).mean()) if len(pk) else None)
    veh_day = len(pv.drop_duplicates(["seed", "veh"])) / n if len(pv) else 0
    allw = pv.wait if len(pv) else pd.Series(dtype=float)
    return dict(
        vehicles_per_day=round(veh_day), stopped_veh_h=_r(lane.wait_s.sum() / n / 3600, 2),
        mean_wait_s=_r(allw.mean()) if len(allw) else None,
        peak15=dict(start=hhmm(peak_t) if peak_t is not None else None,
                    queue_veh=_r(per_t.max() / INTERVAL, 2) if len(per_t) else 0.0,
                    queue_m=_r(per_t.max() / INTERVAL * QUEUE_SPACING_M) if len(per_t) else 0.0),
        through=through, hourly_stopped_veh_h=[round(h, 2) for h in hourly],
        approaches=[a for a in approaches if a["veh_per_day"] >= 20 or (a["stopped_veh_h"] or 0) >= 0.05])


# ---------------------------------------------------------------- runs
def find_runs(scenario: str, condition: str, year, growth: str, root: Path = RUNS) -> list[tuple[int, Path]]:
    pat = re.compile(rf"^{re.escape(net_for(scenario))}__{condition}_{year}_{growth}__s(\d+)$")
    out = []
    for d in Path(root).iterdir() if Path(root).exists() else []:
        m = pat.match(d.name)
        if m and d.is_dir():
            out.append((int(m.group(1)), d))
    return sorted(out)


def run_status(run_dir: Path) -> tuple[str, str]:
    """('ok', '') or ('jammed', why): hit the time cap, stopped by hand, or over the teleport limit."""
    log = run_dir / "sumo.log"
    if not log.exists():
        return ("jammed", "run stopped before the end of the day (no SUMO log; A-INT-05)")
    if "gave up after" in log.read_text(errors="ignore")[-2000:]:
        return ("jammed", "hit the VHSIM_SUMO_TIMEOUT cap (likely gridlock)")
    st = run_dir / "statistic.xml"
    if not st.exists():
        return ("jammed", "no statistic output")
    from vhsim.metrics.run import read_statistic
    try:
        s = read_statistic(st)
    except ET.ParseError:
        return ("jammed", "statistic output incomplete")
    if s["teleports"] / max(s["inserted"], 1) > TELEPORT_LIMIT:
        return ("jammed", f"{s['teleports']} teleports for {s['inserted']} vehicles (over the batch's 5% limit)")
    return ("ok", "")


@functools.lru_cache(maxsize=None)
def memberships(scenario: str) -> tuple[dict, dict, dict]:
    """(edges, member edge -> [hotspot ids], group edge -> {hid: key}) for a scenario's network."""
    net = NETWORKS / f"{net_for(scenario)}.net.xml"
    edges = read_edges(net)
    geo = NetGeo(net)
    member: dict[str, list] = {}
    groups: dict[str, dict] = {}
    for h in hd.HOTSPOTS:
        es = area_edges(edges, geo, h)
        final = stop_line_edges(edges, es)
        for e in es:
            f = edges[final[e]]
            member.setdefault(e, []).append(h["id"])
            ci = circle_of(f, geo, h["circles"]) if h.get("circles") else None
            site = _site_name(h, ci, f, geo)
            groups.setdefault(e, {})[h["id"]] = (*approach_group(f), site)
    return edges, member, groups


def _site_name(h: dict, ci: int | None, edge: dict, geo: NetGeo) -> str:
    if h.get("sites"):
        for s in h["sites"]:
            if circle_of(edge, geo, [s["circle"]]) is not None:
                return s["id"]
    names = h.get("site_names") or []
    return names[ci] if ci is not None and ci < len(names) else ""


def extract_one(scenario: str, condition: str, year, growth: str, seed: int, run_dir: str) -> dict:
    """Cache one run's traversals / passes / lane waits for every hotspot's edges."""
    run_dir = Path(run_dir)
    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / f"{run_dir.name}.pkl"
    status, why = run_status(run_dir)
    info = dict(scenario=scenario, condition=condition, year=year, growth=growth, seed=seed, run=run_dir.name,
                status=status, why=why)
    if status != "ok":
        return info
    if out.exists() and out.stat().st_mtime > (run_dir / "vehroute.xml").stat().st_mtime:
        return {**info, "cache": str(out)}
    edges, member, groups = memberships(scenario)
    trav, passes = traversals(run_dir / "vehroute.xml", edges, member)
    lanes = lane_waits(run_dir / "viewer_lanedata.xml", set(member))
    with open(out, "wb") as f:
        pickle.dump(dict(trav=trav, passes=passes, lanes=lanes), f)
    return {**info, "cache": str(out)}


def all_jobs():
    jobs = []
    for sc in hd.SCENARIOS:
        for (c, y, g) in hd.PERIODS:
            for seed, d in find_runs(sc, c, y, g):
                jobs.append((sc, c, y, g, seed, str(d)))
    return jobs


def extract(workers: int = 6) -> list[dict]:
    jobs = all_jobs()
    res = []
    with ProcessPoolExecutor(workers) as ex:
        futs = [ex.submit(extract_one, *j) for j in jobs]
        for f in as_completed(futs):
            r = f.result()
            res.append(r)
            print(json.dumps({k: r[k] for k in ("run", "status", "why")}), flush=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / "index.json").write_text(json.dumps(sorted(res, key=lambda r: r["run"]), indent=1))
    return res


# ---------------------------------------------------------------- build JSON
def build(index: list[dict] | None = None) -> dict:
    index = index or json.loads((CACHE / "index.json").read_text())
    by_combo: dict[tuple, list] = {}
    for r in index:
        by_combo.setdefault((r["scenario"], r["condition"], str(r["year"]), r["growth"]), []).append(r)
    nets = {sc: memberships(sc) for sc in {r["scenario"] for r in index}}
    results = {h["id"]: {} for h in hd.HOTSPOTS}
    for (sc, c, y, g), runs in sorted(by_combo.items()):
        ok = [r for r in runs if r["status"] == "ok"]
        jam = [r for r in runs if r["status"] != "ok"]
        loaded = []
        for r in ok:
            with open(r["cache"], "rb") as f:
                loaded.append((r["seed"], pickle.load(f)))
        edges, member, groups = nets[sc]
        for h in hd.HOTSPOTS:
            hid = h["id"]
            es = {e for e, hs_ in member.items() if hid in hs_}
            entry = dict(seeds=[r["seed"] for r in ok], jammed=bool(jam) and not ok, partial=bool(jam) and bool(ok),
                         jammed_seeds=[dict(seed=r["seed"], why=r["why"]) for r in jam])
            if loaded:
                entry.update(summarise(es, edges, [d["trav"].assign(seed=s) for s, d in loaded],
                                       [d["lanes"].assign(seed=s) for s, d in loaded],
                                       pd.concat([d["passes"].assign(seed=s) for s, d in loaded], ignore_index=True),
                                       hid, groups={e: groups[e][hid] for e in es}))
            results[hid].setdefault(sc, {})[hd.period_key(c, y, g)] = entry
    OUT.mkdir(parents=True, exist_ok=True)
    written = {}
    for h in hd.HOTSPOTS:
        doc = hotspot_doc(h, results[h["id"]])
        p = OUT / f"{h['id']}.json"
        p.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
        written[h["id"]] = doc
    (OUT / "index.json").write_text(json.dumps(overview(written), indent=1, ensure_ascii=False))
    pd.DataFrame(chart_rows(written)).to_csv(OUT / "chart_waits.csv", index=False)
    return written


def _site_label(h: dict, site: str) -> str:
    for s in h.get("sites") or []:
        if s["id"] == site:
            return s["name"]
    return site


SIDE = {"N": "north", "NE": "north-east", "E": "east", "SE": "south-east", "S": "south", "SW": "south-west",
        "W": "west", "NW": "north-west"}


def approach_label(a: dict, h: dict) -> str:
    street = a["street"]
    lab = f"{street} from the {SIDE.get(a['from_side'], a['from_side'])}" if street not in ("roundabout",) else \
        f"inside the roundabout (from the {SIDE.get(a['from_side'], a['from_side'])})"
    site = _site_label(h, a.get("site", ""))
    return f"{lab} ({site})" if site else lab


EXTRA_SCENARIOS = ["n9", "n7"]      # shown for every hotspot besides its roles: the two best options overall
TOP_APPROACHES = 10
MIN_VEH_FOR_WORST = 30            # a "worst approach" needs at least this many vehicles a day


PER_SITE = 4


def trim_approaches(approaches: list[dict]) -> list[dict]:
    """The TOP_APPROACHES with most time stopped, plus each other site's top PER_SITE (order kept), no edge lists."""
    keep, per_site = [], {}
    for i, a in enumerate(approaches):
        site = a.get("site", "")
        per_site[site] = per_site.get(site, 0) + 1
        if i < TOP_APPROACHES or per_site[site] <= PER_SITE:
            keep.append({k: v for k, v in a.items() if k != "edges"})
    return keep


def hotspot_scenarios(h: dict) -> list[str]:
    out = [s for s in h["roles"].values() if s]
    for s in EXTRA_SCENARIOS + h.get("extra", []):
        if s not in out:
            out.append(s)
    return out


def _sites(h: dict) -> list[tuple[str, str]]:
    if h.get("sites"):
        return [(s["id"], s["name"]) for s in h["sites"]]
    if h.get("site_names"):
        return [(n, n) for n in h["site_names"]]
    return [("", h["short"])]


def site_checks(h: dict, res: dict, periods=("summer_peak_2025_base", "summer_peak_2031_high", "weekday_term_2025_base",
                                             "weekday_term_2031_high")) -> list[dict]:
    """Per site of the hotspot, per period and role scenario: the busy approach (>= MIN_VEH_FOR_WORST a day)
    with the longest mean wait."""
    out = []
    for sid, name in _sites(h):
        per = {}
        for p in periods:
            row = {}
            for sc in [s for s in h["roles"].values() if s]:
                e = res.get(sc, {}).get(p)
                if not e:
                    continue
                if e.get("jammed"):
                    row[sc] = {"jammed": True}
                    continue
                cands = [a for a in e.get("approaches", []) if a.get("site", "") == sid
                         and a["veh_per_day"] >= MIN_VEH_FOR_WORST and a.get("mean_wait_s") is not None]
                if cands:
                    w = max(cands, key=lambda a: a["mean_wait_s"])
                    row[sc] = dict(approach=w.get("label", w["street"]), mean_wait_s=w["mean_wait_s"],
                                   p95_wait_s=w.get("p95_wait_s"), veh_per_day=w["veh_per_day"])
            if row:
                per[p] = row
        out.append(dict(site=sid, name=name, periods=per))
    return out


def hotspot_doc(h: dict, res: dict) -> dict:
    keep = hotspot_scenarios(h)
    res = {sc: v for sc, v in res.items() if sc in keep}
    periods = [dict(key=hd.period_key(c, y, g), condition=c, year=y, growth=g,
                    label=f"{hd.condition_label(c).capitalize()}, {hd.year_label(y, g)}") for (c, y, g) in hd.PERIODS]
    for sc in res.values():
        for e in sc.values():
            if "approaches" in e:
                e["approaches"] = trim_approaches(e["approaches"])
            for a in e.get("approaches", []):
                a["label"] = approach_label(a, h)
    doc = dict(id=h["id"], title=h["title"], short=h["short"], kind=h["kind"], why=h["why"],
               junctions_used=h["junctions"], circles=h.get("circles"), street=h.get("street"),
               roles=h["roles"], scenario_labels={s: hd.SCENARIO_LABEL[s] for s in res},
               scenario_descriptions={s: hd.SCENARIO_LONG[s] for s in res}, periods=periods,
               units=dict(wait="seconds per vehicle (time on the approach minus free-flow time)",
                          queue="vehicles standing still, mean over the quarter-hour; metres at 7.5 m a vehicle",
                          stopped="vehicle-hours per day standing still on the hotspot's lanes",
                          through="seconds from entering to leaving the hotspot area"),
               results=res)
    doc["chart"] = chart_data(doc, h)
    doc["headlines"] = headlines(doc, h)
    doc["site_checks"] = site_checks(h, res)
    return doc


def _roles_in_order(h: dict) -> list[tuple[str, str]]:
    r = h["roles"]
    out = [("today", r["today"]), ("council", r["council"])]
    if r.get("component"):
        out.append(("component", r["component"]))
    out.append(("brent", r["brent"]))
    if r.get("alternative_now"):
        out.append(("alternative_now", r["alternative_now"]))
    if r.get("alternative"):
        out.append(("alternative", r["alternative"]))
    return out


def key_approach(doc: dict, h: dict, period: str = "summer_peak_2025_base") -> dict | None:
    """The approach of one of the hotspot's key streets with most time stopped today (summer, now)."""
    base = doc["results"].get("baseline", {}).get(period, {})
    if h.get("key"):                     # fixed key approach (street, side)
        cands = [a for a in base.get("approaches", []) if (a["street"], a["from_side"]) == tuple(h["key"])]
        if cands:
            return cands[0]
    cands = [a for a in base.get("approaches", []) if a["street"] in h.get("key_streets", [])]
    return max(cands, key=lambda a: (a["stopped_veh_h"] or 0, a["mean_wait_s"] or 0)) if cands else None


def find_approach(entry: dict, ref: dict) -> dict | None:
    for a in entry.get("approaches", []):
        if a["street"] == ref["street"] and a["from_side"] == ref["from_side"] and a.get("site", "") == ref.get("site", ""):
            return a
    for a in entry.get("approaches", []):        # rebuilt junction: same street and side anywhere in the hotspot
        if a["street"] == ref["street"] and a["from_side"] == ref["from_side"]:
            return a
    return None


def chart_data(doc: dict, h: dict) -> dict:
    """Wait on the key approach and hotspot time stopped, per role, now vs 2031 (both growths) vs 2041 high."""
    periods = ["summer_peak_2025_base", "summer_peak_2031_moderate", "summer_peak_2031_high",
               "weekday_term_2025_base", "weekday_term_2031_moderate", "weekday_term_2031_high",
               "weekday_term_2041_high"]
    ka = key_approach(doc, h)
    series = []
    for role, sc in _roles_in_order(h):
        row = dict(role=role, scenario=sc, label=hd.SCENARIO_LABEL[sc], key_wait_s={}, stopped_veh_h={},
                   mean_wait_s={}, jammed=[])
        for p in periods:
            e = doc["results"].get(sc, {}).get(p)
            if not e:
                continue
            if e.get("jammed"):
                row["jammed"].append(p)
                continue
            if "stopped_veh_h" not in e:
                continue
            row["stopped_veh_h"][p] = e["stopped_veh_h"]
            row["mean_wait_s"][p] = e["mean_wait_s"]
            if ka:
                a = find_approach(e, ka)
                row["key_wait_s"][p] = a["mean_wait_s"] if a else None
        series.append(row)
    return dict(key_approach=ka["label"] if ka else None, periods=periods,
                period_labels={p: next(x["label"] for x in doc["periods"] if x["key"] == p) for p in periods},
                series=series)


def headlines(doc: dict, h: dict) -> list[str]:
    """Plain-language comparisons on the key approach (mean wait) and the hotspot's time stopped."""
    out = []
    ka = key_approach(doc, h)
    res = doc["results"]
    for p, plab in [("summer_peak_2025_base", "summer peak day, now (2025 data)"),
                    ("summer_peak_2031_high", "summer peak day, 2031 (in about 5 years), high growth"),
                    ("weekday_term_2025_base", "term weekday, now (2025 data)"),
                    ("weekday_term_2041_high", "term weekday, 2041 (in about 15 years), high growth")]:
        base = res.get("baseline", {}).get(p)
        if not base or "stopped_veh_h" not in base:
            continue
        parts = []
        for role, sc in _roles_in_order(h)[1:]:
            e = res.get(sc, {}).get(p)
            if not e:
                continue
            if e.get("jammed"):
                parts.append(f"{hd.SCENARIO_LABEL[sc]}: run jammed")
                continue
            if "stopped_veh_h" not in e:
                continue
            bit = f"{hd.SCENARIO_LABEL[sc]} {e['stopped_veh_h']:.1f}"
            if ka:
                a = find_approach(e, ka)
                if a and a["mean_wait_s"] is not None:
                    bit += f" ({a['mean_wait_s']:.0f} s)"
            parts.append(bit)
        lead = f"{plab.capitalize()}: time stopped here {base['stopped_veh_h']:.1f} vehicle-hours a day on today's network"
        if ka:
            a = find_approach(base, ka)
            if a and a["mean_wait_s"] is not None:
                lead += f"; {ka['label']} waits {a['mean_wait_s']:.0f} s a vehicle"
        out.append(lead + ". " + "; ".join(parts) + ".")
        if h.get("flow_headline") and ka:
            def flow(e):
                a = find_approach(e, ka) if e and not e.get("jammed") else None
                return (f"{a['veh_per_day']:,} vehicles a day ({a['trucks_per_day']:.0f} trucks, "
                        f"{a['caravans_per_day']:.0f} caravans)") if a else ("run jammed" if e and e.get("jammed") else "–")
            bits = [f"{hd.SCENARIO_LABEL[sc]} {flow(res.get(sc, {}).get(p))}" for role, sc in _roles_in_order(h)[1:]
                    if res.get(sc, {}).get(p)]
            out.append(f"{plab.capitalize()}: {ka['label']} carries {flow(base)} on today's network; " + "; ".join(bits) + ".")
    return out


def chart_rows(docs: dict) -> list[dict]:
    """One row per hotspot x role scenario x period: key-approach wait and time stopped (for charting)."""
    rows = []
    for hid, d in docs.items():
        c = d["chart"]
        for s in c["series"]:
            for p in c["periods"]:
                if p not in s["stopped_veh_h"] and p not in s["jammed"]:
                    continue
                rows.append(dict(hotspot=hid, hotspot_name=d["short"], key_approach=c["key_approach"], role=s["role"],
                                 scenario=s["scenario"], scenario_label=s["label"], period=p,
                                 period_label=c["period_labels"][p], key_wait_s=s["key_wait_s"].get(p),
                                 stopped_veh_h=s["stopped_veh_h"].get(p), jammed=p in s["jammed"]))
    return rows


def overview(docs: dict) -> dict:
    return dict(hotspots=[dict(id=d["id"], short=d["short"], title=d["title"], kind=d["kind"],
                               key_approach=d["chart"]["key_approach"], headlines=d["headlines"][:2])
                          for d in sorted(docs.values(), key=lambda d: hd.BY_ID[d["id"]]["order"])])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract")
    e.add_argument("--workers", type=int, default=6)
    sub.add_parser("build")
    a = ap.parse_args(argv)
    if a.cmd == "extract":
        extract(a.workers)
    else:
        build()


if __name__ == "__main__":
    main()
