"""Compare a simulation run with the 2017 turning counts (S-D19) and DIT daily volumes (S-D02).

Turning counts: each counted movement (intersection, approach road + side, turn L/T/R/U) is mapped
to a network movement (in-edge -> out-edge of the named junction in junctions.csv). A simulated
vehicle makes the movement when its route enters the junction on the in-edge and leaves on the
out-edge, possibly via internal ring edges of a roundabout. Time = exit time from the in-edge.

Fit: GEH = sqrt(2 (M - C)^2 / (M + C)) on hourly volumes (traffic-engineering convention: < 5 good,
5-10 investigate, > 10 poor). The 2017 counts were a school-holiday Wednesday (S-D19); compare them
with the weekday run knowing that.
"""
from __future__ import annotations

import csv
import math
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import pandas as pd
import sumolib

from vhsim.metrics.movements import bearing, compass, signed_turn, turn_type
from vhsim.paths import DATA

COUNT_TO_JUNCTION = {
    "Torrens/Victoria": "torrens_victoria_wills",
    "Torrens/Crozier": "torrens_crozier",
    "Torrens/Coral": "torrens_coral",
    "Torrens/Stuart": "torrens_stuart",
    "Torrens/Ocean": "torrens_ocean",
    "Torrens/Seaview/Eyre": "torrens_eyre_seaview_hindmarsh",
    "Hindmarsh/Grantley/Bridge Tce": "hindmarsh_grantley_bridge",
}
_SUFFIX = re.compile(r"\b(street|st|road|rd|terrace|tce|avenue|ave|place|pl|parade|pde)\b\.?", re.I)


def norm(name: str) -> str:
    return _SUFFIX.sub("", (name or "").split("(")[0].split("/")[0]).strip().lower()


def geh(m: float, c: float) -> float:
    return math.sqrt(2 * (m - c) ** 2 / (m + c)) if (m + c) > 0 else 0.0


def four_way(deg: float) -> str:
    return "NESW"[int(((deg % 360) + 45) // 90) % 4]


class JunctionMap:
    def __init__(self, net_path: Path, junctions_csv: Path = DATA / "networks" / "junctions.csv"):
        self.net = sumolib.net.readNet(str(net_path))
        self.j = {}
        with open(junctions_csv) as f:
            for r in csv.DictReader(f):
                self.j[r["junction_id"]] = dict(nodes=set(r["sumo_nodes"].split()),
                                                ins=r["in_edges"].split(), outs=r["out_edges"].split())

    def _edge(self, eid):
        return self.net.getEdge(eid)

    def candidates(self, jid: str):
        """[(in_edge, out_edge, approach_side4, turn, in_name, out_name)] for every pair at junction."""
        J = self.j[jid]
        rows = []
        for a in J["ins"]:
            ea = self._edge(a)
            sa = ea.getShape()
            ba = bearing(sa[-2], sa[-1])
            for b in J["outs"]:
                eb = self._edge(b)
                sb = eb.getShape()
                bb = bearing(sb[0], sb[1])
                if a.lstrip("-") == b.lstrip("-"):
                    t = "U"
                else:
                    t = turn_type(signed_turn(ba, bb))
                rows.append((a, b, four_way(ba + 180), t, ea.getName(), eb.getName(), (ba + 180) % 360))
        return rows

    def map_counts(self, counts: pd.DataFrame) -> pd.DataFrame:
        """Add in_edge/out_edge/match columns to the count movements (one row per counted movement)."""
        g = counts.groupby(["intersection", "approach_road", "approach_dir", "movement", "to_road"],
                           as_index=False)[["light", "heavy"]].sum()
        out = []
        for _, r in g.iterrows():
            jid = COUNT_TO_JUNCTION.get(r.intersection)
            best, why = None, "no junction"
            if jid:
                cands = self.candidates(jid)
                ok = [c for c in cands if norm(c[4]) == norm(r.approach_road) and c[3] == r.movement]
                if not ok:
                    why = "no in-edge with that name and turn"
                else:
                    want = {"N": 0, "E": 90, "S": 180, "W": 270}.get(r.approach_dir)
                    named = [c for c in ok if norm(c[5]) == norm(r.to_road)] or ok
                    if want is not None:   # closest approach bearing (report diagrams are schematic)
                        named.sort(key=lambda c: abs((c[6] - want + 180) % 360 - 180))
                    best = named[0]
                    why = "ok" if len({(c[0], c[1]) for c in named}) == 1 else f"closest of {len(named)}"
            out.append({**r.to_dict(), "junction_id": jid, "in_edge": best[0] if best else None,
                        "out_edge": best[1] if best else None, "match": why})
        df = pd.DataFrame(out)
        df["veh"] = df.light + df.heavy
        dup = df.dropna(subset=["in_edge"]).duplicated(["junction_id", "in_edge", "out_edge"], keep=False)
        for (_, grp) in df[dup.reindex(df.index, fill_value=False)].groupby(["junction_id", "in_edge", "out_edge"]):
            # keep the row whose approach side best matches; the rest are on a carriageway the junction
            # definition does not include
            keep = grp.index[0] if grp.match.iloc[0] == "ok" else grp.veh.idxmax()
            for i in grp.index:
                if i != keep:
                    df.loc[i, ["in_edge", "out_edge"]] = None
                    df.loc[i, "match"] = "duplicate network movement (other carriageway not in junction)"
        return df.drop(columns="veh")

    def simulated(self, vehroute: Path, bin_s: int = 3600) -> pd.DataFrame:
        """Simulated movement counts per junction/in/out edge and hour from a vehroute file."""
        ins = {a: jid for jid, J in self.j.items() for a in J["ins"]}
        outs = {jid: set(J["outs"]) for jid, J in self.j.items()}
        nodes = {jid: J["nodes"] for jid, J in self.j.items()}
        cnt = defaultdict(int)
        for _, el in ET.iterparse(str(vehroute), events=("end",)):
            if el.tag != "vehicle":
                continue
            r = None
            for rr in el.iter("route"):
                if rr.get("exitTimes"):
                    r = rr
            if r is not None:
                es = r.get("edges").split()
                ts = list(map(float, r.get("exitTimes").split()))
                for i, e in enumerate(es[:-1]):
                    jid = ins.get(e)
                    if jid is None:
                        continue
                    for k in range(i + 1, min(i + 10, len(es))):
                        if es[k] in outs[jid]:
                            cnt[(jid, e, es[k], int(ts[i] // bin_s))] += 1
                            break
                        if self._edge(es[k]).getToNode().getID() not in nodes[jid]:
                            break
            el.clear()
        return pd.DataFrame([dict(junction_id=j, in_edge=a, out_edge=b, bin=h, sim=n)
                             for (j, a, b, h), n in cnt.items()])


def compare_turning(run_dir: Path, net_path: Path, counts_csv: Path = DATA / "counts" / "turning_2017.csv",
                    hours=(7, 19)) -> dict:
    """Return tables comparing a run with the 2017 counts: per movement (07-19 total) and per
    junction-hour, with GEH."""
    jm = JunctionMap(net_path)
    counts = pd.read_csv(counts_csv)
    counts["hour"] = counts.bin_start.str.slice(0, 2).astype(int)
    counts["veh"] = counts.light + counts.heavy
    mapped = jm.map_counts(counts)
    sim = jm.simulated(run_dir / "vehroute.xml")
    sim = sim[(sim.bin >= hours[0]) & (sim.bin < hours[1])]
    mov_sim = sim.groupby(["junction_id", "in_edge", "out_edge"], as_index=False).sim.sum()
    mov = mapped.merge(mov_sim, on=["junction_id", "in_edge", "out_edge"], how="left").fillna({"sim": 0})
    mov["obs"] = mov.light + mov.heavy
    mov["geh_12h_hourly_mean"] = [geh(s / 12, o / 12) for s, o in zip(mov.sim, mov.obs)]
    # junction totals per hour (all counted movements)
    ch = counts.assign(junction_id=counts.intersection.map(COUNT_TO_JUNCTION)).groupby(
        ["junction_id", "hour"], as_index=False).veh.sum().rename(columns={"veh": "obs", "hour": "bin"})
    keys = set(map(tuple, mapped.dropna(subset=["in_edge"])[["junction_id", "in_edge", "out_edge"]].values))
    sim_c = sim[[tuple(x) in keys for x in sim[["junction_id", "in_edge", "out_edge"]].values]]
    sh = sim_c.groupby(["junction_id", "bin"], as_index=False).sim.sum()
    jh = ch.merge(sh, on=["junction_id", "bin"], how="left").fillna({"sim": 0})
    jh["geh"] = [geh(s, o) for s, o in zip(jh.sim, jh.obs)]
    return {"movements": mov, "junction_hours": jh}


def summarise(tables: dict) -> str:
    mov, jh = tables["movements"], tables["junction_hours"]
    big = mov[mov.obs >= 500]
    lines = [f"movements >= 500/12h: {len(big)}, GEH<5 (hourly mean): {(big.geh_12h_hourly_mean < 5).sum()}",
             f"junction-hours: {len(jh)}, GEH<5: {(jh.geh < 5).sum()} ({(jh.geh < 5).mean():.0%})",
             f"total 07-19 counted {int(mov.obs.sum())} simulated {int(mov.sim.sum())} "
             f"(ratio {mov.sim.sum() / max(mov.obs.sum(), 1):.2f})",
             f"unmatched movements: {int((mov.in_edge.isna()).sum())} carrying {int(mov[mov.in_edge.isna()].obs.sum())} veh"]
    by_j = jh.groupby("junction_id")[["obs", "sim"]].sum()
    by_j["ratio"] = (by_j.sim / by_j.obs).round(2)
    lines.append(by_j.to_string())
    return "\n".join(lines)
