"""Where the delay is: vehicle-hours stopped per junction approach and per hotspot, by hour (S7).

    python -m vhsim.integration.bottlenecks diagnose --scenario baseline --condition summer_peak \
        --year 2025 --growth base [--seeds 1 2 3] [--top 30]
    python -m vhsim.integration.bottlenecks hotspots --scenarios baseline cp bp n2 ... \
        --condition summer_peak --year 2025 --growth base

Reads each run's hourly edgeData (`edgedata.xml`, period 3600 s: waitingTime = vehicle-seconds at
< 0.1 m/s on the edge, entered + departed = vehicles) and averages over seeds. Waiting on an edge is
charged to the junction at its downstream end (the queue discharges there), so a queue that spills
back past an upstream junction is partly charged to that junction too; the hotspot groups below
collect a bottleneck's whole queue. A turn bay `<id>.bay` (A-INT-01, or an S7 flare) is merged
into its approach `<id>`. Outputs go to sim/data/results/s7_diagnosis/.
"""
from __future__ import annotations

import argparse
import csv
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd

from vhsim.paths import DATA

RUNS = DATA / "runs"
OUT = DATA / "results" / "s7_diagnosis"
NETWORK_NAME = {"baseline": "baseline_bays"}

# Hotspots found by the 2025 summer / 2041 high-growth diagnosis (sim/assumptions/S7-improvements.md):
# baseline node ids whose approaches form one bottleneck, plus the id prefix of any S7 ring edges there.
HOTSPOTS: dict[str, dict] = {
    "Armstrong Rd / Crozier Rd": {"nodes": ["598111160"], "ring": "s7_ring_armstrong_crozier"},
    "Armstrong Rd / Greenhills Rd": {"nodes": ["598113188"], "ring": "s7_ring_armstrong_greenhills"},
    "Hindmarsh Rd / Grantley Ave / Bridge Tce": {"nodes": ["1948692238", "1948692242"],
                                                 "ring": "s7_ring_hindmarsh_grantley"},
    "Victoria St, Bay Rd to Torrens St (side streets, accesses)": {"street": "Victoria Street",
                                                                    "lon": (138.6125, 138.6200)},
    "Hindmarsh Rd side streets (Wattle Dr ... Rupara Ave)": {
        "nodes": ["1842609660", "287006238", "537638825", "535091796", "571781795", "537636673", "575502889"]},
    "Torrens St / Coral St": {"nodes": ["cluster_1842610056_249072518"]},
    "Torrens/Seaview/Eyre roundabout + Eyre Tce/McKinlay St": {"junctions": ["torrens_eyre_seaview_hindmarsh",
                                                                              "eyre_mckinlay"]},
    "Torrens St / Crozier Rd roundabout": {"junctions": ["torrens_crozier"]},
    "Crozier Rd / Burke St": {"nodes": ["531006823"]},
    "Bay Rd / Victoria St / George Main Rd roundabout": {"junctions": ["bay_victoria_georgemain"]},
    "McCracken roundabout": {"junctions": ["adelaide_hindmarsh_portelliot"]},
}


def net_for(scenario: str) -> str:
    return NETWORK_NAME.get(scenario, f"{scenario}_bays")


def base_id(eid: str) -> str:
    return eid[:-4] if eid.endswith(".bay") else eid


def edge_hourly(run_dir: Path) -> pd.DataFrame:
    """edge, hour, wait_s (vehicle-seconds stopped), loss_s (time loss), veh (entered + departed)."""
    rows, hour = [], 0
    for ev, el in ET.iterparse(str(Path(run_dir) / "edgedata.xml"), events=("start", "end")):
        if ev == "start" and el.tag == "interval":
            hour = int(float(el.get("begin")) // 3600)
        elif ev == "end" and el.tag == "edge":
            rows.append((el.get("id"), hour, float(el.get("waitingTime", 0)), float(el.get("timeLoss", 0)),
                         float(el.get("entered", 0)) + float(el.get("departed", 0))))
            el.clear()
    return pd.DataFrame(rows, columns=["edge", "hour", "wait_s", "loss_s", "veh"])


def seed_mean(run_dirs: list[Path]) -> pd.DataFrame:
    frames = [edge_hourly(d) for d in run_dirs]
    df = pd.concat(frames).groupby(["edge", "hour"], as_index=False)[["wait_s", "loss_s", "veh"]].sum()
    df[["wait_s", "loss_s", "veh"]] /= len(frames)
    return df


def junction_nodes(junctions_csv: Path = DATA / "networks" / "junctions.csv") -> dict[str, str]:
    """SUMO node id -> named junction id."""
    out = {}
    with open(junctions_csv) as f:
        for r in csv.DictReader(f):
            for n in r["sumo_nodes"].split():
                out[n] = r["junction_id"]
    return out


def edge_labels(net, node_junction: dict[str, str] | None = None) -> pd.DataFrame:
    """Per edge: approach (base id), street, node (downstream), junction (named id or node id),
    node_streets (names meeting at the node), lon/lat of the node."""
    node_junction = node_junction or {}
    rows = []
    for e in net.getEdges():
        if e.getFunction() == "internal":
            continue
        node = e.getToNode()
        x, y = node.getCoord()
        try:
            lon, lat = net.convertXY2LonLat(x, y)
        except Exception:      # nets without a projection (tests)
            lon, lat = x, y
        names = sorted({a.getName() for a in node.getIncoming() + node.getOutgoing() if a.getName()})
        rows.append(dict(edge=e.getID(), approach=base_id(e.getID()), street=e.getName(), node=node.getID(),
                         junction=node_junction.get(node.getID(), node.getID()), node_streets=" / ".join(names),
                         lon=round(lon, 6), lat=round(lat, 6)))
    return pd.DataFrame(rows)


def approaches(hourly: pd.DataFrame, labels: pd.DataFrame) -> pd.DataFrame:
    """Vehicle-hours stopped per (junction, approach), with vehicles/day (on the approach itself, not its
    bay), seconds stopped per vehicle and the worst hour. Sorted by vehicle-hours stopped."""
    lab = labels.set_index("edge")
    h = hourly[hourly.edge.isin(lab.index)].copy()
    bay_of = {e: base_id(e) for e in h.edge.unique()}
    h["approach"] = h.edge.map(bay_of)
    # charge the approach (and its bay) to the junction at the bay's end, i.e. the approach's real junction
    end_edge = {a: (f"{a}.bay" if f"{a}.bay" in lab.index else a) for a in h.approach.unique()}
    h["junction"] = h.approach.map(lambda a: lab.loc[end_edge[a], "junction"])
    h["node_streets"] = h.approach.map(lambda a: lab.loc[end_edge[a], "node_streets"])
    h["street"] = h.approach.map(lambda a: lab.loc[a, "street"] if a in lab.index else "")
    g = h.groupby(["junction", "node_streets", "approach", "street"], as_index=False).agg(wait_s=("wait_s", "sum"))
    veh = h[~h.edge.str.endswith(".bay")].groupby("approach").veh.sum()
    g["veh_per_day"] = g.approach.map(veh).fillna(0).round()
    g["wait_veh_h"] = (g.wait_s / 3600).round(2)
    g["wait_s_per_veh"] = (g.wait_s / g.veh_per_day.where(g.veh_per_day > 0)).round(1)
    by_hour = h.groupby(["approach", "hour"]).wait_s.sum().reset_index()
    worst = by_hour.sort_values("wait_s").groupby("approach").tail(1).set_index("approach")
    g["peak_hour"] = g.approach.map(worst.hour)
    g["peak_hour_wait_veh_h"] = g.approach.map(worst.wait_s / 3600).round(2)
    return g.drop(columns="wait_s").sort_values("wait_veh_h", ascending=False).reset_index(drop=True)


def hotspot_members(name: str, labels: pd.DataFrame, spec: dict | None = None) -> set[str]:
    """Edge ids (any scenario) belonging to a hotspot: edges whose base id ends at one of its baseline
    nodes / named junctions (looked up in `labels`, which should be the BASELINE's), plus ring edges."""
    spec = spec or HOTSPOTS[name]
    sel = pd.Series(False, index=labels.index)
    if "nodes" in spec:
        sel |= labels.node.isin(spec["nodes"])
    if "junctions" in spec:
        sel |= labels.junction.isin(spec["junctions"])
    if "street" in spec:
        lo, hi = spec["lon"]
        on = labels.node_streets.str.contains(spec["street"], regex=False) & labels.lon.between(lo, hi)
        sel |= on
    return set(labels.loc[sel, "approach"])


def hotspot_wait(hourly: pd.DataFrame, members: set[str], ring_prefix: str | None = None) -> pd.Series:
    """Vehicle-hours stopped per hour on a hotspot's edges (approaches, their bays, ring edges)."""
    base = hourly.edge.map(base_id)
    sel = base.isin(members)
    if ring_prefix:
        sel |= hourly.edge.str.startswith(ring_prefix)
    return hourly[sel].groupby("hour").wait_s.sum() / 3600


def run_dirs(scenario: str, condition: str, year, growth: str, seeds) -> list[Path]:
    dirs = [RUNS / f"{net_for(scenario)}__{condition}_{year}_{growth}__s{s}" for s in seeds]
    return [d for d in dirs if (d / "edgedata.xml").exists() and (d / "tripinfo.xml").exists()]


def _labels_for(scenario: str):
    import sumolib

    import json

    net = sumolib.net.readNet(str(DATA / "networks" / f"{net_for(scenario)}.net.xml"))
    nodes = junction_nodes()
    summary = DATA / "networks" / "patches" / scenario / "meta" / "summary.json"
    if summary.exists():      # new nodes of rebuilt junctions (S6 signals, S7 ring nodes) -> named junction
        for nid, info in (json.loads(summary.read_text()).get("junction_aliases") or {}).items():
            nodes.setdefault(nid, info["junction_id"])
    return edge_labels(net, nodes)


def diagnose(scenario, condition, year, growth, seeds=(1, 2, 3), top=30) -> tuple[pd.DataFrame, pd.Series]:
    dirs = run_dirs(scenario, condition, year, growth, seeds)
    hourly = seed_mean(dirs)
    tab = approaches(hourly, _labels_for(scenario))
    tab.insert(0, "seeds", len(dirs))
    by_hour = (hourly.groupby("hour").wait_s.sum() / 3600).round(1)
    OUT.mkdir(parents=True, exist_ok=True)
    key = f"{scenario}__{condition}_{year}_{growth}"
    tab.head(top).to_csv(OUT / f"{key}__approaches.csv", index=False)
    by_hour.rename("wait_veh_h").to_csv(OUT / f"{key}__by_hour.csv")
    return tab, by_hour


def hotspots(scenarios, condition, year, growth, seeds=(1, 2, 3)) -> pd.DataFrame:
    """Vehicle-hours stopped per hotspot (seed mean) for each scenario, plus the network total from edgeData."""
    labels = _labels_for("baseline")
    members = {n: hotspot_members(n, labels) for n in HOTSPOTS}
    rows = []
    for sc in scenarios:
        dirs = run_dirs(sc, condition, year, growth, seeds)
        if not dirs:
            continue
        hourly = seed_mean(dirs)
        row = dict(scenario=sc, condition=condition, year=year, growth=growth, seeds=len(dirs),
                   network_wait_veh_h=round(hourly.wait_s.sum() / 3600, 1))
        for n, spec in HOTSPOTS.items():
            row[n] = round(float(hotspot_wait(hourly, members[n], spec.get("ring")).sum()), 1)
        rows.append(row)
    df = pd.DataFrame(rows)
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT / f"hotspots__{condition}_{year}_{growth}.csv", index=False)
    return df


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("diagnose")
    d.add_argument("--scenario", default="baseline")
    h = sub.add_parser("hotspots")
    h.add_argument("--scenarios", nargs="+", required=True)
    for p in (d, h):
        p.add_argument("--condition", default="summer_peak")
        p.add_argument("--year", default="2025")
        p.add_argument("--growth", default="base")
        p.add_argument("--seeds", nargs="+", type=int, default=[1, 2, 3])
    d.add_argument("--top", type=int, default=30)
    a = ap.parse_args(argv)
    pd.set_option("display.width", 250)
    pd.set_option("display.max_colwidth", 50)
    if a.cmd == "diagnose":
        tab, by_hour = diagnose(a.scenario, a.condition, a.year, a.growth, a.seeds, a.top)
        print(tab.head(a.top).to_string(index=False))
        print("vehicle-hours stopped by hour:", by_hour.to_dict())
    else:
        print(hotspots(a.scenarios, a.condition, a.year, a.growth, a.seeds).T.to_string())


if __name__ == "__main__":
    main()
