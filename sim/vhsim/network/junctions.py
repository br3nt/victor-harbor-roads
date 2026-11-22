"""Named town-centre intersections -> junctions.csv.

The list of intersections and their control type as OSM shows it comes from the knowledge
base (research/E-network.md table E20b, derived from S-E01). Each is located in the SUMO
network by the streets that meet there, near its approximate position, and its control type
is read back from the built network.
"""
from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field
from pathlib import Path

import sumolib


@dataclass(frozen=True)
class JunctionSpec:
    junction_id: str
    name: str
    streets: tuple[str, ...]          # all must touch the junction
    lat: float
    lon: float
    expected: str                     # control type per OSM / E20b
    also: tuple[str, ...] = field(default=())   # streets joining at a node a few metres away


R = "roundabout"
P = "priority"
SPECS: list[JunctionSpec] = [
    JunctionSpec("torrens_victoria_wills", "Torrens St / Victoria St / Wills St",
                 ("Torrens Street", "Victoria Street", "Wills Street"), -35.5560, 138.6207, R),
    JunctionSpec("torrens_crozier", "Torrens St / Crozier Rd", ("Torrens Street", "Crozier Road"), -35.5545, 138.6208, R),
    JunctionSpec("torrens_eyre_seaview_hindmarsh", "Torrens St / Eyre Tce / Seaview Rd / Hindmarsh Rd",
                 ("Torrens Street", "Eyre Terrace", "Seaview Road", "Hindmarsh Road"), -35.5516, 138.6230, R),
    JunctionSpec("bay_victoria_georgemain", "Bay Rd / Victoria St / George Main Rd",
                 ("Bay Road", "Victoria Street", "George Main Road"), -35.5573, 138.6119, R),
    JunctionSpec("esplanade_king", "Esplanade / King St", ("Esplanade", "King Street"), -35.5572, 138.6189, R),
    JunctionSpec("adelaide_hindmarsh_portelliot", "Adelaide Rd / Hindmarsh Rd / Port Elliot Rd (McCracken)",
                 ("Adelaide Road", "Hindmarsh Road", "Port Elliot Road"), -35.5365, 138.6391, R),
    JunctionSpec("crozier_canterbury", "Crozier Rd / Canterbury Rd", ("Crozier Road", "Canterbury Road"),
                 -35.5495, 138.6110, R),
    JunctionSpec("canterbury_greenhills", "Canterbury Rd / Greenhills Rd", ("Canterbury Road", "Greenhills Road"),
                 -35.5441, 138.6141, R),
    JunctionSpec("torrens_coral", "Torrens St / Coral St", ("Torrens Street", "Coral Street"), -35.5539, 138.6212, P),
    JunctionSpec("torrens_hill", "Torrens St / Hill St", ("Torrens Street", "Hill Street"), -35.5529, 138.6221, P),
    JunctionSpec("torrens_ocean", "Torrens St / Ocean St", ("Torrens Street", "Ocean Street"), -35.5521, 138.6227, P),
    JunctionSpec("torrens_stuart", "Torrens St / Stuart St", ("Torrens Street", "Stuart Street"), -35.5531, 138.6219, P),
    JunctionSpec("hindmarsh_cornhill", "Hindmarsh Rd / Cornhill Rd", ("Hindmarsh Road", "Cornhill Road"),
                 -35.5505, 138.6239, P),
    JunctionSpec("hindmarsh_grantley_bridge", "Hindmarsh Rd / Grantley Ave / Bridge Tce",
                 ("Hindmarsh Road", "Grantley Avenue"), -35.5494, 138.6247, P, also=("Bridge Terrace",)),
    JunctionSpec("victoria_crozier", "Victoria St / Crozier Rd", ("Victoria Street", "Crozier Road"),
                 -35.5555, 138.6222, P),
    JunctionSpec("victoria_burke", "Victoria St / Burke St", ("Victoria Street", "Burke Street"), -35.5563, 138.6195, P),
    JunctionSpec("victoria_king", "Victoria St / King St", ("Victoria Street", "King Street"), -35.5567, 138.6185, P),
    JunctionSpec("victoria_granite", "Victoria St / Granite St", ("Victoria Street", "Granite Street"),
                 -35.5571, 138.6172, P),
    JunctionSpec("victoria_island", "Victoria St / Island St", ("Victoria Street", "Island Street"),
                 -35.5573, 138.6167, P),
    JunctionSpec("victoria_oval", "Victoria St / Oval Rd", ("Victoria Street", "Oval Road"), -35.5576, 138.6155, P),
    JunctionSpec("coral_stuart", "Coral St / Stuart St", ("Coral Street", "Stuart Street"), -35.5539, 138.6221, P),
    JunctionSpec("coral_ocean", "Coral St / Ocean St", ("Coral Street", "Ocean Street"), -35.5539, 138.6230, P),
    JunctionSpec("coral_mckinlay_railway", "Coral St / McKinlay St / Railway Tce",
                 ("Coral Street", "McKinlay Street", "Railway Terrace"), -35.5538, 138.6237, P),
    JunctionSpec("coral_flinders", "Coral St / Flinders Pde", ("Coral Street", "Flinders Parade"), -35.5538, 138.6247, P),
    JunctionSpec("albert_ocean", "Albert Pl / Ocean St", ("Albert Place", "Ocean Street"), -35.5557, 138.6231, P),
    JunctionSpec("albert_railway", "Albert Pl / Railway Tce", ("Albert Place", "Railway Terrace"), -35.5559, 138.6232, P),
    JunctionSpec("albert_esplanade", "Albert Pl / Esplanade", ("Albert Place", "Esplanade"), -35.5567, 138.6232, P),
    JunctionSpec("eyre_flinders_bridge", "Eyre Tce / Flinders Pde / Bridge Tce",
                 ("Eyre Terrace", "Flinders Parade", "Bridge Terrace"), -35.5526, 138.6244, P),
    JunctionSpec("eyre_mckinlay", "Eyre Tce / McKinlay St", ("Eyre Terrace", "McKinlay Street"), -35.5519, 138.6234, P),
    JunctionSpec("flinders_graniteisland", "Flinders Pde / Granite Island Rd", ("Flinders Parade", "Granite Island Road"),
                 -35.5567, 138.6248, P),
    JunctionSpec("crozier_stuart", "Crozier Rd / Stuart St", ("Crozier Road", "Stuart Street"), -35.5552, 138.6221, P),
    JunctionSpec("crozier_acraman_lindsay", "Crozier Rd / Acraman St / Lindsay St",
                 ("Crozier Road", "Acraman Street", "Lindsay Street"), -35.5534, 138.6186, P),
    JunctionSpec("seaview_acraman_carlyle", "Seaview Rd / Acraman St / Carlyle St",
                 ("Seaview Road", "Acraman Street", "Carlyle Street"), -35.5503, 138.6209, P),
    # Ring road (Armstrong Rd / Welch Rd; see site/ring-road-history.html). Positions from S-E01.
    JunctionSpec("armstrong_georgemain_inmanvalley", "Armstrong Rd / George Main Rd / Inman Valley Rd",
                 ("Armstrong Road", "George Main Road", "Inman Valley Road"), -35.5567, 138.5996, R),
    JunctionSpec("armstrong_crozier", "Armstrong Rd / Crozier Rd", ("Armstrong Road", "Crozier Road"),
                 -35.5484, 138.6091, P),
    JunctionSpec("armstrong_greenhills", "Armstrong Rd / Greenhills Rd", ("Armstrong Road", "Greenhills Road"),
                 -35.5400, 138.6087, P),
    JunctionSpec("armstrong_welch_waggon", "Armstrong Rd / Welch Rd / Waggon Rd",
                 ("Armstrong Road", "Welch Road", "Waggon Road"), -35.5231, 138.6187, P),
]

COLUMNS = ["junction_id", "name", "control", "lon", "lat", "legs", "sumo_nodes", "in_edges", "out_edges",
           "major_road", "control_osm", "source"]
SEARCH_RADIUS_M = 150.0
CLUSTER_RADIUS_M = 40.0


def _names(node) -> set[str]:
    return {e.getName() for e in node.getIncoming() + node.getOutgoing() if e.getName()}


def _dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _locate(net, spec: JunctionSpec, ring_of: dict[str, int], rings: list[set[str]]) -> set[str] | None:
    xy = net.convertLonLat2XY(spec.lon, spec.lat)
    want = set(spec.streets)
    if spec.expected == R or any(_dist(net.getNode(n).getCoord(), xy) < 30 for n in ring_of):
        best = None
        for i, nodes in enumerate(rings):
            c = _centroid(net, nodes)
            d = _dist(c, xy)
            names = set().union(*(_names(net.getNode(n)) for n in nodes))
            if d < 60 and want <= names and (best is None or d < best[0]):
                best = (d, nodes)
        if best:
            return set(best[1])
    cands = []
    for n in net.getNodes():
        d = _dist(n.getCoord(), xy)
        if d <= SEARCH_RADIUS_M and want <= _names(n):
            cands.append((d, n))
    if not cands:
        return None
    _, core = min(cands, key=lambda t: t[0])
    chosen = {core.getID()}
    extra = want | set(spec.also)
    for n in net.getNodes():
        if n.getID() in chosen or n.getID() in ring_of:
            continue
        if _dist(n.getCoord(), core.getCoord()) <= CLUSTER_RADIUS_M:
            names = _names(n)
            if len(names & want) >= 2 or names & set(spec.also):
                chosen.add(n.getID())
    return chosen


def _centroid(net, nodes) -> tuple[float, float]:
    pts = [net.getNode(n).getCoord() for n in nodes]
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def _bearing(c, p) -> float:
    return math.degrees(math.atan2(p[0] - c[0], p[1] - c[1])) % 360


def _point_along(shape, dist: float):
    """Point `dist` metres along a polyline (clamped)."""
    acc = 0.0
    for a, b in zip(shape, shape[1:]):
        seg = _dist(a, b)
        if acc + seg >= dist and seg > 0:
            t = (dist - acc) / seg
            return a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])
        acc += seg
    return shape[-1]


def describe(net, nodes: set[str]) -> dict:
    ins, outs = [], []
    for nid in nodes:
        node = net.getNode(nid)
        for e in node.getIncoming():
            if e.getFromNode().getID() not in nodes and not e.isSpecial():
                ins.append(e)
        for e in node.getOutgoing():
            if e.getToNode().getID() not in nodes and not e.isSpecial():
                outs.append(e)
    c = _centroid(net, nodes)
    arms = []
    for e in ins:
        shape = e.getShape()
        rev = list(reversed(shape))
        arms.append((e.getName() or "", _bearing(c, _point_along(rev, 30.0))))
    for e in outs:
        arms.append((e.getName() or "", _bearing(c, _point_along(e.getShape(), 30.0))))
    legs: list[tuple[str, float]] = []
    for name, b in arms:
        if not any(n == name and min(abs(b - lb), 360 - abs(b - lb)) < 45 for n, lb in legs):
            legs.append((name, b))
    top = max((e.getPriority() for e in ins + outs), default=0)
    major = sorted({e.getName() for e in ins + outs if e.getPriority() == top and e.getName()})
    return {"in_edges": sorted(e.getID() for e in ins), "out_edges": sorted(e.getID() for e in outs),
            "legs": len(legs), "major_road": " / ".join(major), "centroid": c}


def control_type(net, nodes: set[str], ring_nodes: set[str]) -> str:
    if nodes & ring_nodes:
        return R
    types = sorted({net.getNode(n).getType() for n in nodes})
    mapped = {"priority_stop": "stop", "allway_stop": "all_way_stop", "traffic_light": "traffic_light",
              "traffic_light_right_on_red": "traffic_light"}
    return "+".join(sorted({mapped.get(t, t) for t in types}))


def build_table(net) -> list[dict]:
    rings = [set(rb.getNodes()) for rb in net.getRoundabouts()]
    ring_of = {n: i for i, nodes in enumerate(rings) for n in nodes}
    rows = []
    for spec in SPECS:
        nodes = _locate(net, spec, ring_of, rings)
        if not nodes:
            rows.append({"junction_id": spec.junction_id, "name": spec.name, "control": "NOT_FOUND",
                         "control_osm": spec.expected, "source": "S-E01"})
            continue
        d = describe(net, nodes)
        lon, lat = net.convertXY2LonLat(*d["centroid"])
        ctrl = control_type(net, nodes, set(ring_of))
        rows.append({
            "junction_id": spec.junction_id, "name": spec.name, "control": ctrl,
            "lon": round(lon, 6), "lat": round(lat, 6), "legs": d["legs"],
            "sumo_nodes": " ".join(sorted(nodes)), "in_edges": " ".join(d["in_edges"]),
            "out_edges": " ".join(d["out_edges"]),
            "major_road": "" if ctrl == R else d["major_road"], "control_osm": spec.expected, "source": "S-E01",
        })
    return rows


def write_junctions(net_path: Path, out_csv: Path) -> list[dict]:
    net = sumolib.net.readNet(str(net_path))
    rows = build_table(net)
    with open(out_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in COLUMNS})
    return rows
