"""Read SUMO laneData / edgeData and turn them into per-interval arrays aligned with ``network.json``."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np

LANE_ATTRS = ("sampledSeconds", "speed", "speedRelative", "waitingTime", "entered", "departed", "laneChangedTo",
              "density", "laneDensity")
EDGE_ATTRS = ("sampledSeconds", "traveltime", "speed", "speedRelative", "waitingTime", "timeLoss")


@dataclass
class MeanData:
    period: float
    begins: list[float] = field(default_factory=list)
    #: one dict per interval: element id -> {attr: float}
    values: list[dict[str, dict[str, float]]] = field(default_factory=list)


def read_meandata(path, level: str = "lane") -> MeanData:
    """Stream a SUMO meandata file. ``level``: ``lane`` (laneData) or ``edge`` (edgeData)."""
    attrs = LANE_ATTRS if level == "lane" else EDGE_ATTRS
    md = MeanData(period=0.0)
    cur = None
    for ev, el in ET.iterparse(str(path), events=("start", "end")):
        if ev == "start" and el.tag == "interval":
            b, e = float(el.get("begin")), float(el.get("end"))
            md.begins.append(b)
            md.period = md.period or (e - b)
            cur = {}
            md.values.append(cur)
        elif ev == "end" and el.tag == level and cur is not None:
            cur[el.get("id")] = {a: float(el.get(a)) for a in attrs if el.get(a) is not None}
            el.clear()
        elif ev == "end" and el.tag == "interval":
            el.clear()
    return md


def _slots(md: MeanData, begin: float, n_intervals: int):
    for b, vals in zip(md.begins, md.values):
        k = int(round((b - begin) / md.period)) if md.period else 0
        if 0 <= k < n_intervals:
            yield k, vals


def free_flow_times(nj) -> np.ndarray:
    e = nj["edges"]
    return np.array(e["length"], float) / np.maximum(np.array(e["speed_kmh"], float) / 3.6, 0.1)


def edge_times(nj, ed: MeanData, begin: float, n_intervals: int) -> np.ndarray:
    """[T, E] seconds: SUMO ``traveltime`` where vehicles were on the edge, free-flow time elsewhere.

    Never below half the free-flow time (guards against a single fast sample on a short edge)."""
    ff = free_flow_times(nj)
    tt = np.tile(ff, (n_intervals, 1))
    idx = {eid: i for i, eid in enumerate(nj["edges"]["id"])}
    length = np.array(nj["edges"]["length"], float)
    for k, vals in _slots(ed, begin, n_intervals):
        for eid, a in vals.items():
            i = idx.get(eid)
            if i is None or a.get("sampledSeconds", 0) <= 0:
                continue
            t = a.get("traveltime")
            if t is None or t <= 0:
                t = length[i] / max(a.get("speed", 0.0), 0.1)
            tt[k, i] = max(t, 0.5 * ff[i])
    return tt


def lane_measures(nj, ld: MeanData, begin: float, n_intervals: int) -> dict[str, np.ndarray]:
    lanes = nj["lanes"]
    n = len(lanes["id"])
    idx = {lid: i for i, lid in enumerate(lanes["id"])}
    limit = np.array(lanes["speed_kmh"], float) / 3.6
    out = {"speed_ratio": np.full((n_intervals, n), np.nan), "waiting_s": np.zeros((n_intervals, n)),
           "vehicles": np.zeros((n_intervals, n)), "density": np.full((n_intervals, n), np.nan)}
    for k, vals in _slots(ld, begin, n_intervals):
        for lid, a in vals.items():
            i = idx.get(lid)
            if i is None or a.get("sampledSeconds", 0) <= 0:
                continue
            r = a.get("speedRelative")
            if r is None:
                r = a.get("speed", 0.0) / max(limit[i], 0.1)
            out["speed_ratio"][k, i] = min(r, 1.0)
            out["waiting_s"][k, i] = a.get("waitingTime", 0.0)
            out["vehicles"][k, i] = a.get("entered", 0) + a.get("departed", 0) + a.get("laneChangedTo", 0)
            out["density"][k, i] = a.get("laneDensity", a.get("density", 0.0))
    return out


def network_series(nj, ed: MeanData, begin: float, n_intervals: int) -> dict[str, list[float]]:
    """Network-wide per-interval totals used for the timeline and bookmarks."""
    delay = np.zeros(n_intervals)
    wait = np.zeros(n_intervals)
    veh = np.zeros(n_intervals)
    sr_num = np.zeros(n_intervals)
    known = set(nj["edges"]["id"])
    for k, vals in _slots(ed, begin, n_intervals):
        for eid, a in vals.items():
            if eid not in known:
                continue
            s = a.get("sampledSeconds", 0.0)
            delay[k] += a.get("timeLoss", 0.0)
            wait[k] += a.get("waitingTime", 0.0)
            veh[k] += s
            sr_num[k] += s * min(a.get("speedRelative", 1.0), 1.0)
    period = ed.period or 900
    with np.errstate(invalid="ignore", divide="ignore"):
        ratio = np.where(veh > 0, sr_num / np.where(veh > 0, veh, 1), np.nan)
    return {
        "delay_veh_h": [round(float(x) / 3600, 3) for x in delay],
        "waiting_veh_h": [round(float(x) / 3600, 3) for x in wait],
        "vehicles_mean": [round(float(x) / period, 2) for x in veh],
        "speed_ratio_mean": [None if np.isnan(x) else round(float(x), 3) for x in ratio],
    }


def edge_halted(nj, ed: MeanData, begin: float, n_intervals: int) -> np.ndarray:
    """[T, E] mean number of halted vehicles per lane (waitingTime / period / lanes)."""
    idx = {eid: i for i, eid in enumerate(nj["edges"]["id"])}
    nl = np.array([max(len(x), 1) for x in nj["edges"]["lanes"]], float)
    out = np.zeros((n_intervals, len(idx)))
    for k, vals in _slots(ed, begin, n_intervals):
        for eid, a in vals.items():
            i = idx.get(eid)
            if i is not None:
                out[k, i] = a.get("waitingTime", 0.0) / (ed.period or 900) / nl[i]
    return out


def read_run(run_dir: Path):
    """(lane MeanData, edge MeanData) of a run directory made with ``viewer_additional``."""
    from vhsim.viewer.additional import EDGEDATA_FILE, LANEDATA_FILE

    run_dir = Path(run_dir)
    lp, ep = run_dir / LANEDATA_FILE, run_dir / EDGEDATA_FILE
    for p in (lp, ep):
        if not p.exists():
            raise FileNotFoundError(f"{p} missing: run simulate(..., additional=viewer_additional(out_dir / "
                                    f"'viewer.add.xml')) so SUMO writes lane/edge data every 900 s")
    return read_meandata(lp, "lane"), read_meandata(ep, "edge")
