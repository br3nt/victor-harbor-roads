"""S9 ring-road comparison (council Option 1 = C5 / C5b, Option 2 = today's ring road, its B3 and N7 variants).

    python -m vhsim.integration.s9_ring [--workers 3]

Reads finished runs straight from sim/data/runs (any seed present: `<net>__<condition>_<year>_<growth>__s<k>`, plus
the S9 extra seed `...__s3__s9`), so it uses every seed of a combination whatever batch produced it. Per run:
trip totals (tripinfo), trucks on the town centre / the existing ring road / the outer road (vehroute), vehicles a
day on the ring and outer roads and vehicle-hours stopped at the ring-road and outer-road junctions (hourly
edgeData), and trip times between the northern growth areas and the town centre (tripinfo). Writes CSVs to
sim/data/results/report_s9/ and prints the markdown tables used in sim/assumptions/S9-ring-road.md.
"""
from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
from pathlib import Path

import pandas as pd

from vhsim.paths import DATA

RUNS = DATA / "runs"
OUT = DATA / "results" / "report_s9"
NET = {"baseline": "baseline_bays"}
SCENARIOS = ("baseline", "b3", "n7", "c5", "c5b", "c5s")
LABEL = {"baseline": "Today's network (Option 2 as is)", "b3": "B3 four-lane ring road",
         "n7": "N7 ring-road junction roundabouts + Grantley", "c5": "C5 outer ring road, inner reading",
         "c5b": "C5b outer ring road, outer reading",
         "c5s": "C5s sensitivity: C5 with the ring road kept at today's limits"}
COMBOS = (("weekday_term", "2025", "base"), ("summer_peak", "2025", "base"),
          ("weekday_term", "2031", "moderate"), ("summer_peak", "2031", "moderate"),
          ("weekday_term", "2031", "high"), ("summer_peak", "2031", "high"),
          ("weekday_term", "2041", "high"))
RING_STREETS = ("Welch Road", "Armstrong Road")
OUTER_STREETS = ("Outer ring road (C5, indicative)", "Swains Crossing Road", "Hutchinson Road", "Water Reserve Road",
                 "Stock Road", "Spring Road", "Mont Rosa Road")
# junctions (baseline node ids; S7 roundabout ring edges are matched by prefix) whose approaches are summed
JUNCTIONS = {
    "Armstrong/Inman Valley rbt": {"junction_id": "armstrong_georgemain_inmanvalley"},
    "Armstrong/Crozier": {"nodes": ("598111160",), "ring": "s7_ring_armstrong_crozier"},
    "Armstrong/Greenhills": {"nodes": ("598113188",), "ring": "s7_ring_armstrong_greenhills"},
    "Armstrong/Welch/Waggon": {"junction_id": "armstrong_welch_waggon"},
    "Inman Valley/Swains Crossing (C5)": {"nodes": ("361912151",)},
    "Greenhills/Water Reserve (C5)": {"nodes": ("3414034121",)},
    "Greenhills/Hutchinson (C5)": {"nodes": ("598224260",)},
    "Hutchinson/Hindmarsh Tiers (C5)": {"nodes": ("cluster_575381206_598224639",)},
    "Hindmarsh Tiers/Victor Harbor Rd (C5)": {"nodes": ("249072929",)},
    "Mont Rosa/Victor Harbor Rd (C5b)": {"nodes": ("cluster_1388195608_575381275",)},
}
EXISTING_RING_JUNCTIONS = ("Armstrong/Inman Valley rbt", "Armstrong/Crozier", "Armstrong/Greenhills",
                           "Armstrong/Welch/Waggon")
# road sections for vehicles a day (both directions, base edge ids)
SECTIONS = {"Armstrong Rd (Greenhills Rd to Waggon Rd)": ("29282267", "-29282267"),
            "Armstrong Rd (Crozier Rd to Greenhills Rd)": ("29282260#2", "-29282260#2"),
            "Hutchinson Rd": ("115974801#1", "-115974801#1"),
            "Swains Crossing Rd": ("115732831", "-115732831")}


def net_for(scenario: str) -> str:
    return NET.get(scenario, f"{scenario}_bays")


def _reached_end(run_dir: Path, end_s: float = 23 * 3600) -> bool:
    """The hourly edgeData reached 23:00 (a run stopped early - killed or capped - can still leave teleports.xml)."""
    f = Path(run_dir) / "edgedata.xml"
    if not f.exists():
        return False
    with open(f, "rb") as fh:
        fh.seek(max(0, f.stat().st_size - 5_000_000))       # one hourly interval is under ~2 MB
        begins = re.findall(rb'<interval begin="([0-9.]+)"', fh.read())
    return bool(begins) and float(begins[-1]) >= end_s


def run_dirs(scenario: str, condition: str, year: str, growth: str) -> list[Path]:
    """Finished runs (teleports.xml is written after a run completes) of a combination, one per seed."""
    pat = re.compile(rf"^{re.escape(net_for(scenario))}__{condition}_{year}_{growth}__s(\d+)(__s9)?$")
    out = {}
    for d in sorted(RUNS.glob(f"{net_for(scenario)}__{condition}_{year}_{growth}__s*")):
        m = pat.match(d.name)
        if m and (d / "teleports.xml").exists() and (d / "tripinfo.xml").exists() and _reached_end(d):
            out.setdefault(int(m.group(1)), d)
    return [out[k] for k in sorted(out)]


@lru_cache(maxsize=None)
def _net_info(net_name: str) -> dict:
    import sumolib

    from vhsim.scenarios.area import edges_inside, load_polygon

    net = sumolib.net.readNet(str(DATA / "networks" / f"{net_name}.net.xml"))
    edges = [e for e in net.getEdges() if e.getFunction() != "internal"]
    return {"length": {e.getID(): e.getLength() for e in edges},
            "ring": {e.getID() for e in edges if e.getName() in RING_STREETS},
            "outer": {e.getID() for e in edges if e.getName() in OUTER_STREETS},
            "town": set(edges_inside(net, load_polygon()))}


@lru_cache(maxsize=None)
def _town_pois() -> frozenset:
    from shapely.geometry import Point

    from vhsim.scenarios.area import load_polygon

    poly = load_polygon()
    fc = json.loads((DATA / "zones" / "pois.geojson").read_text())
    return frozenset(f["properties"]["poi_id"] for f in fc["features"]
                     if poly.contains(Point(*f["geometry"]["coordinates"][:2])))


def _junction_edges(net) -> dict[str, set[str]]:
    """Per junction, approach edges (base ids): edges ending at one of its nodes that do not start at one (so a
    roundabout's own ring edges are not approaches)."""
    from vhsim.integration.bottlenecks import base_id, junction_nodes

    node_j = junction_nodes()
    out = {}
    for name, spec in JUNCTIONS.items():
        nodes = set(spec.get("nodes", ()))
        if "junction_id" in spec:
            nodes |= {n for n, j in node_j.items() if j == spec["junction_id"]}
        out[name] = {base_id(e.getID()) for e in net.getEdges() if e.getFunction() != "internal"
                     and e.getToNode().getID() in nodes and e.getFromNode().getID() not in nodes}
    return out


@lru_cache(maxsize=None)
def _junction_approaches(net_name: str) -> dict[str, set[str]]:
    """Approach edges per junction in the baseline (so approaches trimmed to an S7 roundabout still count) or in the
    scenario's own net (new C5 edges). An S7 roundabout's ring edges are added by prefix for waiting only."""
    import sumolib

    out = {}
    for name in dict.fromkeys(["baseline_bays", net_name]):
        for j, eds in _junction_edges(sumolib.net.readNet(str(DATA / "networks" / f"{name}.net.xml"))).items():
            out.setdefault(j, set()).update(eds)
    return out


METRICS_VERSION = 2       # bump when run_metrics changes, so cached per-run metrics are recomputed


def truck_counts(vehroute: Path, info: dict) -> dict:
    """Trucks (and truck-km) using the town centre, the existing ring road and the outer road: the last route a
    truck drove (rerouted vehicles keep their routes inside <routeDistribution>, hence iter, not findall)."""
    tr = {k: 0 for k in ("trucks", "trucks_town", "trucks_ring", "trucks_outer")}
    vkm = {k: 0.0 for k in ("vkm_town", "vkm_ring", "vkm_outer")}
    for _, el in ET.iterparse(str(vehroute)):
        if el.tag != "vehicle":
            continue
        if el.get("type") == "truck":
            routes = list(el.iter("route"))
            r = [x for x in routes if x.get("exitTimes")] or routes
            edges = r[-1].get("edges", "").split() if r else []
            tr["trucks"] += 1
            for key in ("town", "ring", "outer"):
                on = [e for e in edges if e in info[key]]
                if on:
                    tr[f"trucks_{key}"] += 1
                    vkm[f"vkm_{key}"] += sum(info["length"].get(e, 0.0) for e in on) / 1000
        el.clear()
    return tr | {k: round(v, 1) for k, v in vkm.items()}


def run_metrics(scenario: str, run_dir: Path) -> dict:
    """All S9 measures of one finished run."""
    from vhsim.integration.batch import network_totals

    run_dir = Path(run_dir)
    info = _net_info(net_for(scenario))
    out = {"run": run_dir.name, **network_totals(run_dir)}
    out |= truck_counts(run_dir / "vehroute.xml", info)
    # trips between the northern growth areas (GA1-3) and the town centre (tripinfo duration, s)
    town = _town_pois()
    ga_town, town_ga = [], []
    for _, el in ET.iterparse(str(run_dir / "tripinfo.xml")):
        if el.tag == "tripinfo":
            p = el.get("id").split("~")
            if len(p) >= 5 and p[0] == "res":
                if p[1].startswith("GA") and p[3] in town:
                    ga_town.append(float(el.get("duration")))
                elif p[3].startswith("GA") and p[1] in town:
                    town_ga.append(float(el.get("duration")))
            el.clear()
    both = sorted(ga_town + town_ga)
    out |= {"ga_town_trips": len(both),
            "ga_town_mean_s": round(sum(both) / len(both), 1) if both else None,
            "ga_town_p90_s": both[int(0.9 * (len(both) - 1))] if both else None}
    # hourly edgeData: vehicles a day on sections, vehicle-hours stopped at junction approaches
    from vhsim.integration.bottlenecks import base_id, edge_hourly

    h = edge_hourly(run_dir)
    h["approach"] = h.edge.map(base_id)
    wait = h.groupby("approach").wait_s.sum()                                   # approach + its turn bay
    veh = h[~h.edge.str.endswith(".bay")].groupby("approach").veh.sum()         # vehicles counted once
    for name, ids in SECTIONS.items():
        out[f"veh_{name}"] = int(round(sum(veh.get(i, 0) for i in ids)))
    for name, approaches in _junction_approaches(net_for(scenario)).items():
        ring = JUNCTIONS[name].get("ring")
        on_ring = wait.index.str.startswith(ring) if ring else False
        out[f"wait_veh_h_{name}"] = round(float(wait[wait.index.isin(approaches) | on_ring].sum()) / 3600, 2)
        out[f"veh_{name}"] = int(veh[veh.index.isin(approaches)].sum())
    return out


def _cached(scenario: str, run_dir: Path, cache: Path) -> dict:
    f = cache / f"{run_dir.name}.json"
    stamp = [(run_dir / "tripinfo.xml").stat().st_mtime, METRICS_VERSION]
    if f.exists():
        d = json.loads(f.read_text())
        if d.get("_stamp") == stamp:
            return d
    d = run_metrics(scenario, run_dir) | {"_stamp": stamp}
    cache.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(d))
    return d


def collect(workers: int = 3, cache: Path | None = None) -> pd.DataFrame:
    cache = Path(cache or OUT / "cache")
    jobs = [(sc, c, y, g, d) for sc in SCENARIOS for c, y, g in COMBOS for d in run_dirs(sc, c, y, g)]
    with ProcessPoolExecutor(workers) as ex:
        res = list(ex.map(_cached, [j[0] for j in jobs], [j[4] for j in jobs], [cache] * len(jobs)))
    rows = [dict(scenario=sc, condition=c, year=y, growth=g, seed=int(re.search(r"__s(\d+)", d.name).group(1)), **r)
            for (sc, c, y, g, d), r in zip(jobs, res)]
    return pd.DataFrame(rows).drop(columns=["_stamp"], errors="ignore")


def summarise(runs: pd.DataFrame) -> pd.DataFrame:
    """Seed means (and the seed range of time stopped) per scenario and combination, with changes vs today."""
    num = [c for c in runs.columns if c not in ("scenario", "condition", "year", "growth", "seed", "run")]
    g = runs.groupby(["scenario", "condition", "year", "growth"])
    s = g[num].mean()
    s["seeds"] = g.size()
    s["stopped_min"] = g.total_waiting_veh_h.min()
    s["stopped_max"] = g.total_waiting_veh_h.max()
    s = s.reset_index()
    # changes against today's network on the SAME seeds (paired), so a scenario with fewer finished seeds is not
    # compared with a mean over others
    b = runs[runs.scenario == "baseline"].set_index(["condition", "year", "growth", "seed"])
    trip, stop = [], []
    for _, r in s.iterrows():
        seeds = runs[(runs.scenario == r.scenario) & (runs.condition == r.condition) & (runs.year == r.year)
                     & (runs.growth == r.growth)].seed
        idx = [(r.condition, r.year, r.growth, k) for k in seeds if (r.condition, r.year, r.growth, k) in b.index]
        if not idx:
            trip.append(float("nan")); stop.append(float("nan")); continue
        bt, bw = b.loc[idx].mean_trip_min.mean(), b.loc[idx].total_waiting_veh_h.mean()
        mine = runs[(runs.scenario == r.scenario) & (runs.condition == r.condition) & (runs.year == r.year)
                    & (runs.growth == r.growth) & runs.seed.isin([i[3] for i in idx])]
        trip.append(round(60 * (mine.mean_trip_min.mean() - bt), 1))
        stop.append(round(100 * (mine.total_waiting_veh_h.mean() / bw - 1), 1))
    s["trip_change_s"], s["stopped_change_pct"] = trip, stop
    return s


def _cond(c, y, g):
    return f"{y} {'term weekday' if c == 'weekday_term' else 'summer peak day'}" + ("" if g == "base" else f", {g} growth")


def tables(s: pd.DataFrame) -> str:
    out = []
    for c, y, g in COMBOS:
        x = s[(s.condition == c) & (s.year == y) & (s.growth == g)].set_index("scenario")
        if x.empty:
            continue
        out += [f"\n#### {_cond(c, y, g)}\n",
                "| Scenario | Seeds | Mean trip (min) | Δ trip (s) | Time stopped (veh-h, seed range) | vs today "
                "| Ring junctions (veh-h stopped) | Outer-road junctions (veh-h) | Trucks: town centre / ring / outer "
                "| Growth areas ↔ town centre (min, trips) |",
                "|---|---|---|---|---|---|---|---|---|---|"]
        for sc in SCENARIOS:
            if sc not in x.index:
                continue
            r = x.loc[sc]
            ring = sum(r.get(f"wait_veh_h_{j}", 0) for j in EXISTING_RING_JUNCTIONS)
            outer = sum(r.get(f"wait_veh_h_{j}", 0) for j in JUNCTIONS if j not in EXISTING_RING_JUNCTIONS)
            ga = "—" if pd.isna(r.ga_town_mean_s) or not r.ga_town_trips else \
                f"{r.ga_town_mean_s / 60:.1f} ({r.ga_town_trips:.0f})"
            rng = f"{r.stopped_min:.0f}–{r.stopped_max:.0f}" if r.seeds > 1 else "1 seed"
            out.append(f"| {LABEL[sc]} | {int(r.seeds)} | {r.mean_trip_min:.2f} | {r.trip_change_s:+.1f} | "
                       f"{r.total_waiting_veh_h:.0f} ({rng}) | "
                       f"{'—' if sc == 'baseline' else f'{r.stopped_change_pct:+.0f}%'} | {ring:.1f} | {outer:.1f} | "
                       f"{r.trucks_town:.0f} / {r.trucks_ring:.0f} / {r.trucks_outer:.0f} | {ga} |")
    return "\n".join(out)


def junction_table(s: pd.DataFrame, c: str, y: str, g: str) -> str:
    x = s[(s.condition == c) & (s.year == y) & (s.growth == g)].set_index("scenario")
    lines = [f"\n#### Junction approaches, {_cond(c, y, g)}: vehicle-hours stopped a day (seconds per vehicle)\n",
             "| Junction | " + " | ".join(LABEL[sc] for sc in SCENARIOS if sc in x.index) + " |",
             "|---|" + "---|" * sum(sc in x.index for sc in SCENARIOS)]
    for j in JUNCTIONS:
        cells = []
        for sc in SCENARIOS:
            if sc not in x.index:
                continue
            w, v = x.loc[sc].get(f"wait_veh_h_{j}", 0), x.loc[sc].get(f"veh_{j}", 0)
            cells.append("—" if not v else f"{w:.1f} ({3600 * w / v:.0f})")
        if any(cl != "—" for cl in cells):
            lines.append(f"| {j} | " + " | ".join(cells) + " |")
    lines.append("\n| Vehicles a day | " + " | ".join(LABEL[sc] for sc in SCENARIOS if sc in x.index) + " |")
    lines.append("|---|" + "---|" * sum(sc in x.index for sc in SCENARIOS))
    for name in SECTIONS:
        lines.append(f"| {name} | " + " | ".join(f"{x.loc[sc].get(f'veh_{name}', 0):,.0f}" for sc in SCENARIOS
                                                 if sc in x.index) + " |")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args(argv)
    runs = collect(a.workers)
    OUT.mkdir(parents=True, exist_ok=True)
    runs.to_csv(OUT / "runs.csv", index=False)
    s = summarise(runs)
    s.to_csv(OUT / "summary.csv", index=False)
    print(tables(s))
    for c, y, g in (("summer_peak", "2025", "base"), ("weekday_term", "2041", "high")):
        print(junction_table(s, c, y, g))


if __name__ == "__main__":
    main()
