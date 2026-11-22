"""Turn batch results into comparison tables and an HTML body for the knowledge base.

    python -m vhsim.integration.report --year 2025 --growth base
writes sim/data/results/report_<year>_<growth>/{summary.csv,intersections.csv,accessibility.csv,
foreshore.csv,results.html}
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import pandas as pd
import sumolib

from vhsim.paths import DATA

RESULTS = DATA / "results"
LABEL = {
    "baseline": "Today's network", "c1a": "C1a 30 km/h town centre (not Torrens/Victoria)",
    "c1b": "C1b 30 km/h incl. Torrens St", "c3": "C3 one-way loop (clockwise)", "c3b": "C3b one-way loop (anticlockwise)",
    "c4": "C4 signals at Torrens/Seaview and Torrens/Crozier", "cp": "Council package (C1a+C2+C3+C4)",
    "b3": "B3 four-lane ring road", "b4": "B4 two-lane McCracken roundabout", "b5": "B5 roundabout slip lanes",
    "bp": "Brent's package (B3+B4+B5)", "n1": "N1 Grantley Ave crossing closed",
    # S7 targeted options (sim/assumptions/S7-improvements.md)
    "n2": "N2 roundabout at Armstrong Rd / Crozier Rd", "n3": "N3 Crozier Rd flare at Armstrong Rd",
    "n4": "N4 roundabout at Hindmarsh Rd / Grantley Ave", "n5": "N5 roundabouts at Armstrong/Crozier and Armstrong/Greenhills",
    "n6": "N6 no right turn out of Granite St, Coral St, Wattle Dr", "n7": "N7 combination (N5 + N4)",
    "n8": "N8 Victoria St left-turn lanes (Oval Rd, IGA car park)",
    "n9": "N9 combination (N3 + N4)",
}
COND = {"weekday_term": "Term weekday", "summer_peak": "Summer peak day", "saturday": "Saturday", "event_nye": "New Year's Eve"}
KEY_JUNCTIONS = ["torrens_victoria_wills", "torrens_crozier", "torrens_eyre_seaview_hindmarsh", "torrens_coral",
                 "torrens_ocean", "torrens_stuart", "hindmarsh_grantley_bridge", "bay_victoria_georgemain",
                 "adelaide_hindmarsh_portelliot", "victoria_burke", "victoria_oval", "esplanade_king",
                 "coral_ocean", "albert_esplanade", "eyre_flinders_bridge", "crozier_acraman_lindsay",
                 "seaview_acraman_carlyle", "armstrong_crozier", "armstrong_welch_waggon",
                 "armstrong_greenhills", "victoria_granite", "eyre_mckinlay"]
ACC_CATS = ["supermarket", "services", "medical", "beach_foreshore", "dining", "gym", "work", "school"]
ACC_AREAS = ["Encounter Bay", "Victor Harbor", "Hayborough", "McCracken", "Hindmarsh Valley",
             "Growth area 1 (north)"]


def load(key: str):
    d = RESULTS / key
    if not (d / "network.json").exists():
        return None
    meta = json.loads((d / "network.json").read_text())
    acc = pd.read_csv(d / "accessibility.csv") if (d / "accessibility.csv").exists() else None
    mov = pd.read_csv(d / "movements.csv") if (d / "movements.csv").exists() else None
    return meta, acc, mov


def junction_defs():
    out = {}
    with open(DATA / "networks" / "junctions.csv") as f:
        for r in csv.DictReader(f):
            out[r["junction_id"]] = dict(name=r["name"], ins=set(r["in_edges"].split()),
                                         nodes=set(r["sumo_nodes"].split()))
    return out


def scenario_aliases(scenario: str) -> dict:
    """junction_id -> set of replacement SUMO node ids (e.g. new signal nodes in C4/CP)."""
    p = DATA / "networks" / "patches" / scenario / "meta" / "summary.json"
    if not p.exists():
        return {}
    out = defaultdict(set)
    for node, info in (json.loads(p.read_text()).get("junction_aliases") or {}).items():
        out[info["junction_id"]].add(node)
    return out


def approach_table(mov: pd.DataFrame, jdefs, seeds: int, scenario: str = "baseline") -> pd.DataFrame:
    """Average approach delay per named-junction approach (key: approach_edge, the original OSM edge id).

    Only movements AT the junction (its own SUMO nodes, or the scenario's replacement nodes) count. Where a
    turn bay splits the approach (X -> X.bay -> exit), the delay on X (queueing back from the bay) is added
    to the delay on X.bay, per approach. ``worst_movement_p95_s`` is the highest p95 among the approach's
    movements (not a pooled approach p95).
    """
    m = mov[mov.hour_band == "all"].copy()
    m["base_from"] = m.from_edge.str.replace(r"\.bay$", "", regex=True)
    upstream = m[m.to_edge == m.from_edge + ".bay"].set_index("from_edge")
    aliases = scenario_aliases(scenario)
    rows = []
    for jid in KEY_JUNCTIONS:
        J = jdefs.get(jid)
        if not J:
            continue
        nodes = J["nodes"] | aliases.get(jid, set())
        sub = m[m.base_from.isin(J["ins"]) & m.junction_id.isin(nodes)]
        for frm, g in sub.groupby("base_from"):
            n = g.n.sum()
            d = (g.n * g.mean_delay).sum() / n if n else None
            if d is not None and frm in upstream.index and (g.from_edge.str.endswith(".bay")).any():
                d += float(upstream.loc[frm, "mean_delay"]) if not isinstance(upstream.loc[frm, "mean_delay"], pd.Series) \
                    else float(upstream.loc[frm, "mean_delay"].iloc[0])
            name = g.from_name.iloc[0] or "unnamed"
            rows.append(dict(junction_id=jid, junction=J["name"], approach_edge=frm,
                             approach=f"{name} ({frm})", veh_per_day=round(n / seeds),
                             mean_delay_s=round(d, 1) if d is not None else None,
                             worst_movement_p95_s=round(g.p95_delay.max(), 1)))
    return pd.DataFrame(rows)


ESPLANADE_SCREENLINE = {"184389891#3", "-184389891#3"}
FLINDERS_NORTH = {"-23075179#6", "23075179#6"}


def driven_route(veh):
    """The route the vehicle actually drove (last <route> inside a routeDistribution if it rerouted)."""
    r = None
    for rr in veh.iter("route"):
        r = rr
    return r.get("edges", "").split() if r is not None else []


def foreshore(run_dirs: list[Path], net_path: Path) -> dict:
    """Foreshore exposure per day (seed mean), by vehicle type (R23a):
    esplanade_<type>: vehicles crossing the Esplanade screenline (edge 184389891#3, either direction);
    flinders_north_<type>: vehicles using the northern 128 m of Flinders Pde (Bridge Tce end);
    vkm_<type>: vehicle-km driven on all Flinders Pde + Esplanade edges.
    """
    net = sumolib.net.readNet(str(net_path))
    fore = {e.getID(): e.getLength() for e in net.getEdges() if e.getName() in ("Flinders Parade", "Esplanade")}
    out = defaultdict(float)
    for d in run_dirs:
        for _, el in ET.iterparse(str(d / "vehroute.xml")):
            if el.tag == "vehicle":
                t = el.get("type", "car")
                es = driven_route(el)
                se = set(es)
                if se & ESPLANADE_SCREENLINE:
                    out[f"esplanade_{t}"] += 1
                if se & FLINDERS_NORTH:
                    out[f"flinders_north_{t}"] += 1
                out[f"vkm_{t}"] += sum(fore.get(e, 0.0) for e in es) / 1000
                el.clear()
    k = max(len(run_dirs), 1)
    return {key: round(v / k, 1) for key, v in out.items()}


def build(year="2025", growth="base", conditions=("weekday_term", "summer_peak"), scenarios=None, suffix=""):
    """`scenarios` limits the report to those ids (default: every labelled scenario with results);
    `suffix` writes to report_<year>_<growth><suffix>/ so a partial report does not replace the main one."""
    out = RESULTS / f"report_{year}_{growth}{suffix}"
    out.mkdir(parents=True, exist_ok=True)
    jdefs = junction_defs()
    summ, inter, accs, fores = [], [], [], []
    for cond in conditions:
        base = load(f"baseline__{cond}_{year}_{growth}")
        if not base:
            continue
        for sc in (scenarios or LABEL):
            got = load(f"{sc}__{cond}_{year}_{growth}")
            if not got:
                continue
            meta, acc, mov = got
            mean = meta.get("mean", {})
            bmean = base[0].get("mean", {})
            seeds = len(meta.get("seeds", [])) or 1
            summ.append(dict(condition=cond, scenario=sc, label=LABEL.get(sc, sc), seeds=seeds,
                             mean_trip_min=mean.get("mean_trip_min"), p95_trip_min=mean.get("p95_trip_min"),
                             time_stopped_veh_h=mean.get("total_waiting_veh_h"),
                             stopped_change_pct=round(100 * (mean.get("total_waiting_veh_h", 0) / bmean["total_waiting_veh_h"] - 1), 1)
                             if bmean.get("total_waiting_veh_h") else None,
                             trip_change_s=round(60 * (mean.get("mean_trip_min", 0) - bmean.get("mean_trip_min", 0)), 1),
                             teleports=mean.get("teleports")))
            if mov is not None:
                a = approach_table(mov, jdefs, seeds, sc)
                a.insert(0, "scenario", sc); a.insert(0, "condition", cond)
                inter.append(a)
            if acc is not None:
                x = acc[(acc.hour_band == "all") & acc.dest_category.isin(ACC_CATS) & acc.origin_area.isin(ACC_AREAS)]
                x = x[["origin_area", "dest_category", "n", "median", "p95"]].copy()
                x.insert(0, "scenario", sc); x.insert(0, "condition", cond)
                accs.append(x)
            dirs = [Path(DATA / "runs" / f"{('baseline_bays' if sc == 'baseline' else sc + '_bays')}__{cond}_{year}_{growth}__s{s}")
                    for s in meta.get("seeds", [])]
            dirs = [d for d in dirs if (d / "vehroute.xml").exists()]
            if dirs:
                f = foreshore(dirs, DATA / "networks" / f"{('baseline_bays' if sc == 'baseline' else sc + '_bays')}.net.xml")
                fores.append(dict(condition=cond, scenario=sc, **f))
    S = pd.DataFrame(summ); I = pd.concat(inter) if inter else pd.DataFrame()
    A = pd.concat(accs) if accs else pd.DataFrame(); F = pd.DataFrame(fores)
    S.to_csv(out / "summary.csv", index=False); I.to_csv(out / "intersections.csv", index=False)
    A.to_csv(out / "accessibility.csv", index=False); F.to_csv(out / "foreshore.csv", index=False)
    return S, I, A, F, out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", default="2025"); ap.add_argument("--growth", default="base")
    ap.add_argument("--conditions", nargs="+", default=["weekday_term", "summer_peak"])
    ap.add_argument("--scenarios", nargs="+", help="limit to these scenario ids (baseline first)")
    ap.add_argument("--suffix", default="", help="write report_<year>_<growth><suffix>/ (e.g. _s7)")
    a = ap.parse_args()
    S, I, A, F, out = build(a.year, a.growth, tuple(a.conditions), a.scenarios, a.suffix)
    pd.set_option("display.width", 220)
    print(S.to_string(index=False)); print(F.to_string(index=False))
    print("written", out)
