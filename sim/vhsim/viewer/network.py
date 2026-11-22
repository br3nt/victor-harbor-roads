"""SUMO net -> ``networks/<name>.json`` for the viewer (columnar, lon/lat)."""
from __future__ import annotations

import hashlib
import math
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
import sumolib

#: gap (in lane widths) between the centre line and the inner lane of each direction when drawing
SLOT_GAP = 0.15
#: a zone with no road inside borrows the nearest road sections within this distance of its centroid
ZONE_NEAREST_MAX_M = 300
#: vehicle class used for routing and for "routable"
ROUTING_VCLASS = "passenger"


def bearing_deg(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Compass bearing (0 = north, 90 = east) from point 1 to point 2 (equirectangular; fine at town scale)."""
    dx = (lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    dy = lat2 - lat1
    return (math.degrees(math.atan2(dx, dy)) + 360) % 360


def is_lefthand(net_path) -> bool:
    for _, el in ET.iterparse(str(net_path), events=("start",)):
        return el.get("lefthand", "false").lower() in ("true", "1")
    return False


def _lonlat(net, shape, prec):
    out = []
    for x, y in shape:
        lon, lat = net.convertXY2LonLat(x, y)
        out += [round(lon, prec), round(lat, prec)]
    return out


def lane_slot(n_lanes: int, index: int, two_way: bool, lefthand: bool) -> float:
    """Signed offset of lane ``index`` from the drawn line, in lane widths (MapLibre ``line-offset`` sign:
    positive = right of the direction of travel). Two-way roads: each direction sits on its driving side
    (left in left-hand traffic), the kerb lane (index 0) outermost. One-way roads: centred on the line."""
    side = -1.0 if lefthand else 1.0
    if two_way:
        return side * (SLOT_GAP + (n_lanes - 1 - index) + 0.5)
    return side * ((n_lanes - 1) / 2 - index) if n_lanes > 1 else 0.0


def edge_slot(n_lanes: int, two_way: bool, lefthand: bool) -> float:
    """Offset (lane widths) of the single line drawn per direction in the travel-time view."""
    if not two_way:
        return 0.0
    return (-1.0 if lefthand else 1.0) * (SLOT_GAP + n_lanes / 2)


def _polygon(zone):
    from shapely.geometry import Polygon, shape

    if "geometry" in zone and zone["geometry"]:
        return shape(zone["geometry"])
    return Polygon(zone["polygon"])


def network_json(net_path, name: str, pois: list[dict] | None = None, zones: list[dict] | None = None,
                 junction_names: dict[str, str] | None = None, precision: int = 6) -> dict:
    """Read a geo-referenced SUMO net and return the viewer's network document.

    ``pois``: dicts with ``poi_id, category, name, lon, lat``; each is snapped to the nearest node that a
    car can drive into. ``zones``: dicts with ``zone_id, name`` and either a GeoJSON ``geometry`` or a
    ``polygon`` ring of [lon, lat]; each lists the routable edges whose midpoint lies inside.
    ``junction_names``: optional node id -> name (e.g. from S1 ``junctions.csv``).
    """
    net = sumolib.net.readNet(str(net_path), withInternal=True)
    if not net.hasGeoProj():
        raise ValueError(f"{net_path} has no geo projection; build it with netconvert --proj.utm (or from OSM)")
    lefthand = is_lefthand(net_path)
    prec = precision
    edges = [e for e in net.getEdges(withInternal=False) if e.getFunction() in ("", "normal")]
    node_objs = {}
    for e in edges:
        for n in (e.getFromNode(), e.getToNode()):
            node_objs.setdefault(n.getID(), n)
    node_ids = list(node_objs)
    node_idx = {nid: i for i, nid in enumerate(node_ids)}
    edge_idx = {e.getID(): i for i, e in enumerate(edges)}
    pairs = {(e.getFromNode().getID(), e.getToNode().getID()) for e in edges}

    nodes = {"id": [], "lon": [], "lat": [], "name": [], "type": []}
    for nid in node_ids:
        n = node_objs[nid]
        lon, lat = net.convertXY2LonLat(*n.getCoord())
        nodes["id"].append(nid)
        nodes["lon"].append(round(lon, prec))
        nodes["lat"].append(round(lat, prec))
        nodes["name"].append((junction_names or {}).get(nid))
        nodes["type"].append(n.getType())

    ecols = {k: [] for k in ("id", "from", "to", "length", "speed_kmh", "name", "lanes", "shape", "routable",
                             "next", "via_s", "bearing", "slot")}
    lcols = {k: [] for k in ("id", "edge", "index", "bearing", "name", "speed_kmh", "length", "slot", "shape")}
    for ei, e in enumerate(edges):
        a, b = e.getFromNode().getID(), e.getToNode().getID()
        two_way = (b, a) in pairs
        shape = _lonlat(net, e.getRawShape(), prec)
        if len(shape) < 4:
            shape = _lonlat(net, e.getShape(), prec)
        lanes = e.getLanes()
        nm = e.getName() or ""
        ecols["id"].append(e.getID())
        ecols["from"].append(node_idx[a])
        ecols["to"].append(node_idx[b])
        ecols["length"].append(round(e.getLength(), 2))
        ecols["speed_kmh"].append(round(e.getSpeed() * 3.6, 1))
        ecols["name"].append(nm)
        ecols["shape"].append(shape)
        ecols["routable"].append(1 if e.allows(ROUTING_VCLASS) else 0)
        ecols["bearing"].append(round(bearing_deg(shape[0], shape[1], shape[-2], shape[-1]), 1))
        ecols["slot"].append(edge_slot(len(lanes), two_way, lefthand))
        best: dict[int, float] = {}
        if e.allows(ROUTING_VCLASS):
            for to_edge, conns in e.getOutgoing().items():
                j = edge_idx.get(to_edge.getID())
                if j is None or not to_edge.allows(ROUTING_VCLASS):
                    continue
                for c in conns:
                    if not (c.getFromLane().allows(ROUTING_VCLASS) and c.getToLane().allows(ROUTING_VCLASS)):
                        continue
                    via = c.getViaLaneID()
                    t = 0.0
                    if via:
                        vl = net.getLane(via)
                        t = vl.getLength() / max(vl.getSpeed(), 0.1)
                    best[j] = min(best.get(j, math.inf), t)
        ecols["next"].append(sorted(best))
        ecols["via_s"].append([round(best[j], 2) for j in sorted(best)])
        lane_ids = []
        for ln in lanes:
            li = len(lcols["id"])
            lane_ids.append(li)
            ls = _lonlat(net, ln.getShape(), prec)
            lcols["id"].append(ln.getID())
            lcols["edge"].append(ei)
            lcols["index"].append(ln.getIndex())
            lcols["bearing"].append(round(bearing_deg(ls[0], ls[1], ls[-2], ls[-1]), 1))
            lcols["name"].append(nm)
            lcols["speed_kmh"].append(round(ln.getSpeed() * 3.6, 1))
            lcols["length"].append(round(ln.getLength(), 2))
            lcols["slot"].append(lane_slot(len(lanes), ln.getIndex(), two_way, lefthand))
            lcols["shape"].append(ls)
        ecols["lanes"].append(lane_ids)

    lons, lats = np.array(nodes["lon"]), np.array(nodes["lat"])
    doc = {
        "version": 1,
        "name": name,
        "lefthand": lefthand,
        "bbox": [float(lons.min()), float(lats.min()), float(lons.max()), float(lats.max())],
        "projection": str(getattr(net, "_location", {}).get("projParameter", "")),
        "routing_vclass": ROUTING_VCLASS,
        "nodes": nodes,
        "edges": ecols,
        "lanes": lcols,
        "pois": [],
        "zones": [],
    }
    # identifies the lane/edge order the run binaries are aligned with
    doc["hash"] = hashlib.sha1(("\n".join(ecols["id"]) + "\0" + "\n".join(lcols["id"])).encode()).hexdigest()[:16]
    doc["pois"] = _snap_pois(doc, pois or [])
    doc["zones"] = _zones(doc, zones or [], prec)
    return doc


def _enterable_nodes(doc) -> np.ndarray:
    e = doc["edges"]
    ok = np.zeros(len(doc["nodes"]["id"]), bool)
    for to, r in zip(e["to"], e["routable"]):
        if r:
            ok[to] = True
    return ok


def _snap_pois(doc, pois):
    lon, lat = np.array(doc["nodes"]["lon"]), np.array(doc["nodes"]["lat"])
    ok = _enterable_nodes(doc)
    if not ok.any():
        return []
    k = math.cos(math.radians(float(lat.mean())))
    out = []
    for p in pois:
        d2 = ((lon - p["lon"]) * k) ** 2 + (lat - p["lat"]) ** 2
        d2[~ok] = np.inf
        i = int(np.argmin(d2))
        out.append({"id": str(p.get("poi_id", p.get("id"))), "category": p.get("category", ""),
                    "name": p.get("name") or "", "lon": round(float(p["lon"]), 6), "lat": round(float(p["lat"]), 6),
                    "node": i, "snap_m": round(math.sqrt(float(d2[i])) * 111_320, 1),
                    **({"source": p["source"]} if p.get("source") else {})})
    return out


def _zones(doc, zones, prec):
    from shapely.geometry import Point, mapping
    from shapely.prepared import prep

    e = doc["edges"]
    mids = []
    for s in e["shape"]:
        n = len(s) // 2
        m = n // 2
        if n % 2 == 1:
            mids.append(Point(s[2 * m], s[2 * m + 1]))
        else:
            mids.append(Point((s[2 * m - 2] + s[2 * m]) / 2, (s[2 * m - 1] + s[2 * m + 1]) / 2))
    routable = [i for i in range(len(mids)) if e["routable"][i]]
    mx = np.array([mids[i].x for i in routable]) if routable else np.zeros(0)
    my = np.array([mids[i].y for i in routable]) if routable else np.zeros(0)
    out = []
    for z in zones:
        poly = _polygon(z)
        pp = prep(poly)
        inside = [i for i in routable if pp.contains(mids[i])]
        nearest = False
        if not inside and routable:
            # small blocks (mesh blocks) often hold no road midpoint: use the 3 closest road sections
            c = poly.centroid
            k = math.cos(math.radians(c.y))
            d2 = ((mx - c.x) * k) ** 2 + (my - c.y) ** 2
            inside = [routable[j] for j in np.argsort(d2)[:3] if math.sqrt(d2[j]) * 111_320 <= ZONE_NEAREST_MAX_M]
            nearest = True
        geom = mapping(poly.simplify(0.00002))
        zid = str(z.get("zone_id", z.get("id")))
        name = z.get("name") or (f"{z['suburb']} {zid}" if z.get("suburb") else zid)
        out.append({"id": zid, "name": name, "geometry": _round_geom(geom, prec), "edges": sorted(inside),
                    "edges_nearest": nearest,
                    **{k2: z[k2] for k2 in ("suburb", "dwellings", "persons", "source") if k2 in z}})
    return out


def _round_geom(g, prec):
    def r(c):
        if isinstance(c[0], (int, float)):
            return [round(float(c[0]), prec), round(float(c[1]), prec)]
        return [r(x) for x in c]
    return {"type": g["type"], "coordinates": r(list(g["coordinates"]))}
