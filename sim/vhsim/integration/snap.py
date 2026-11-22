"""Snap network-independent trip ends (fromLonLat/toLonLat) to drivable edges.

Each unique point goes to the nearest edge that allows the vehicle class and lies in the network's
largest strongly connected component for that class, searching outward (100 m steps to 2 km).
Distances are recorded so far-off points (e.g. Granite Island, beach POIs on the water) are visible.
"""
from __future__ import annotations

import csv
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import sumolib

from vhsim.network.checks import largest_scc

RADII = (100, 200, 400, 800, 1600, 2000)
VCLASS = {"car": "passenger", "caravan": "passenger", "truck": "truck"}


class Snapper:
    def __init__(self, net_path: Path):
        self.net = sumolib.net.readNet(str(net_path))
        self.ok = {vc: largest_scc(self.net, vc) for vc in set(VCLASS.values())}
        self.cache: dict[tuple, tuple[str, float]] = {}

    def edge(self, lon: float, lat: float, vclass: str = "passenger") -> tuple[str, float]:
        key = (round(lon, 6), round(lat, 6), vclass)
        if key in self.cache:
            return self.cache[key]
        x, y = self.net.convertLonLat2XY(lon, lat)
        for r in RADII:
            cands = [(d, e) for e, d in self.net.getNeighboringEdges(x, y, r)
                     if e.getID() in self.ok[vclass] and e.allows(vclass)]
            if cands:
                d, e = min(cands, key=lambda c: c[0])
                self.cache[key] = (e.getID(), d)
                return self.cache[key]
        raise ValueError(f"no drivable {vclass} edge within {RADII[-1]} m of {lon},{lat}")


    def both_ways(self, edge_id: str, vclass: str) -> list[str]:
        """The edge plus its opposite-direction twin (same road), if drivable and connected."""
        e = self.net.getEdge(edge_id)
        out = [edge_id]
        for cand in e.getFromNode().getIncoming():
            if (cand.getFromNode() == e.getToNode() and cand.getID() in self.ok[vclass]
                    and cand.allows(vclass) and cand.getName() == e.getName()):
                out.append(cand.getID())
        return out


def snap_trips_taz(trips_in: Path, net_path: Path, trips_out: Path, taz_out: Path,
                   report: Path | None = None) -> dict:
    """Like snap_trips, but each point becomes a TAZ (both directions of its nearest road) so the
    router chooses the direction of travel instead of forcing a U-turn at the next junction."""
    sn = Snapper(net_path)
    text = trips_in.read_text()
    taz: dict[str, list[str]] = {}
    dists, same, n = [], 0, 0

    def zone(lonlat: str, vc: str) -> tuple[str, float]:
        lon, lat = map(float, lonlat.split(","))
        e, d = sn.edge(lon, lat, vc)
        zid = f"z_{vc[0]}_{e}"
        if zid not in taz:
            taz[zid] = sn.both_ways(e, vc)
        return zid, d

    def sub(m):
        nonlocal same, n
        tag = m.group(0)
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', tag))
        vc = VCLASS.get(attrs.get("type", "car"), "passenger")
        fz, fd = zone(attrs["fromLonLat"], vc)
        tz, td = zone(attrs["toLonLat"], vc)
        dists.extend([fd, td]); n += 1
        if fz == tz:
            same += 1
            return ""          # origin and destination on the same road segment: no network trip
        tag = re.sub(r'\s(fromLonLat|toLonLat)="[^"]*"', "", tag)
        return tag.replace("<trip ", f'<trip fromTaz="{fz}" toTaz="{tz}" ', 1)

    out = re.sub(r"<trip\b[^>]*/>", sub, text)
    trips_out.write_text(out)
    with open(taz_out, "w") as f:
        f.write("<additional>\n")
        for zid, es in sorted(taz.items()):
            f.write(f'  <taz id="{zid}" edges="{" ".join(es)}"/>\n')
        f.write("</additional>\n")
    dists.sort()
    return {"trips": n, "dropped_same_segment": same, "zones": len(taz),
            "snap_m_median": round(dists[len(dists) // 2], 1), "snap_m_p99": round(dists[int(len(dists) * .99)], 1),
            "snap_m_max": round(dists[-1], 1), "over_400m": sum(d > 400 for d in dists)}


def snap_trips(trips_in: Path, net_path: Path, trips_out: Path, report: Path | None = None) -> dict:
    """Rewrite a trips file replacing fromLonLat/toLonLat with from/to edges. Returns stats."""
    sn = Snapper(net_path)
    text = trips_in.read_text()
    dists, same, n = [], 0, 0

    def sub(m):
        nonlocal same, n
        tag = m.group(0)
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', tag))
        vc = VCLASS.get(attrs.get("type", "car"), "passenger")
        fe, fd = sn.edge(*map(float, attrs["fromLonLat"].split(",")), vc)
        te, td = sn.edge(*map(float, attrs["toLonLat"].split(",")), vc)
        dists.extend([fd, td]); n += 1
        if fe == te:
            same += 1
        tag = re.sub(r'\s(fromLonLat|toLonLat)="[^"]*"', "", tag)
        return tag.replace("<trip ", f'<trip from="{fe}" to="{te}" ', 1)

    out = re.sub(r"<trip\b[^>]*/>", sub, text)
    trips_out.write_text(out)
    dists.sort()
    stats = {"trips": n, "same_edge": same, "points": len(sn.cache),
             "snap_m_median": round(dists[len(dists) // 2], 1) if dists else 0,
             "snap_m_p99": round(dists[int(len(dists) * 0.99)], 1) if dists else 0,
             "snap_m_max": round(dists[-1], 1) if dists else 0,
             "over_400m": sum(d > 400 for d in dists)}
    if report:
        with open(report, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["lon", "lat", "vclass", "edge", "dist_m"])
            for (lon, lat, vc), (e, d) in sorted(sn.cache.items()):
                w.writerow([lon, lat, vc, e, round(d, 1)])
    return stats
