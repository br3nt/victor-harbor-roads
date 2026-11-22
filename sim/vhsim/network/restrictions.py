"""OSM turn restrictions (S-E01) mapped onto the SUMO network.

netconvert applies OSM restriction relations, but `--junctions.join` can absorb the `to` way
of a restriction into a joined junction (e.g. the short median openings on Victoria Street);
the restriction is then lost and a plain U-turn appears instead. This module maps every
restriction onto net edges so the build can delete banned connections that slipped through.

Mapping: the `from` edge is the edge of the from-way ending nearest the via node. Targets are
the edges of the to-way leaving that junction; if the to-way was absorbed, they are the edges
leaving the junction at the to-way's far end (closer to that end than to the via node).
`no_*` bans the targets; `only_*` bans every other movement of the from edge.
"""
from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Restriction:
    rel_id: str
    kind: str
    from_way: str
    via_nodes: tuple[str, ...]
    via_ways: tuple[str, ...]
    to_way: str


def parse_restrictions(osm: Path) -> list[Restriction]:
    out = []
    for rel in ET.parse(osm).getroot().iter("relation"):
        tags = {t.get("k"): t.get("v") for t in rel.findall("tag")}
        if tags.get("type") != "restriction" or "restriction" not in tags:
            continue
        frm = [m.get("ref") for m in rel.findall("member") if m.get("role") == "from" and m.get("type") == "way"]
        to = [m.get("ref") for m in rel.findall("member") if m.get("role") == "to" and m.get("type") == "way"]
        vn = tuple(m.get("ref") for m in rel.findall("member") if m.get("role") == "via" and m.get("type") == "node")
        vw = tuple(m.get("ref") for m in rel.findall("member") if m.get("role") == "via" and m.get("type") == "way")
        if len(frm) == 1 and len(to) == 1:
            out.append(Restriction(rel.get("id"), tags["restriction"], frm[0], vn, vw, to[0]))
    return out


def _way_nodes(osm: Path) -> tuple[dict[str, list[str]], dict[str, tuple[float, float]]]:
    root = ET.parse(osm).getroot()
    nodes = {n.get("id"): (float(n.get("lon")), float(n.get("lat"))) for n in root.iter("node")}
    ways = {w.get("id"): [nd.get("ref") for nd in w.findall("nd")] for w in root.iter("way")}
    return ways, nodes


def _edges_by_way(net) -> dict[str, list]:
    out: dict[str, list] = {}
    for e in net.getEdges():
        orig = e.getLanes()[0].getParam("origId") or e.getID().lstrip("-").split("#")[0]
        for w in orig.split():
            out.setdefault(w, []).append(e)
    return out


def _d(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def banned_movements(osm: Path, net) -> tuple[dict[str, set[tuple[str, str]]], list[str]]:
    """{relation id: {(from_edge, to_edge)}} plus the ids that could not be mapped."""
    ways, nodes = _way_nodes(osm)
    by_way = _edges_by_way(net)
    banned: dict[str, set[tuple[str, str]]] = {}
    unresolved: list[str] = []
    for r in parse_restrictions(osm):
        via = None
        if r.via_nodes:
            via = r.via_nodes[0]
        elif r.via_ways and r.via_ways[0] in ways and r.from_way in ways:
            vw, fw = ways[r.via_ways[0]], ways[r.from_way]
            shared = [n for n in (vw[0], vw[-1]) if n in (fw[0], fw[-1])]
            via = shared[0] if shared else None
        if via is None or via not in nodes or r.from_way not in by_way:
            unresolved.append(r.rel_id)
            continue
        vxy = net.convertLonLat2XY(*nodes[via])
        cands = [e for e in by_way[r.from_way] if _d(e.getToNode().getCoord(), vxy) < 40]
        if not cands:
            unresolved.append(r.rel_id)
            continue
        frm = min(cands, key=lambda e: _d(e.getToNode().getCoord(), vxy))
        junction = frm.getToNode()
        outgoing = list(frm.getOutgoing().keys())
        targets = [e for e in by_way.get(r.to_way, []) if e.getFromNode() is junction]
        if not targets:
            if r.via_ways:     # via way not absorbed into the junction: leave to netconvert
                unresolved.append(r.rel_id)
                continue
            tw = ways.get(r.to_way, [])
            far = tw[-1] if tw and tw[0] == via else tw[0] if tw and tw[-1] == via else None
            if far is None or far not in nodes:
                unresolved.append(r.rel_id)
                continue
            fxy = net.convertLonLat2XY(*nodes[far])
            targets = [e for e in junction.getOutgoing()
                       if _d(e.getShape()[0], fxy) < _d(e.getShape()[0], vxy) and _d(e.getShape()[0], fxy) < 40]
        if not targets:
            unresolved.append(r.rel_id)
            continue
        if r.kind.startswith("only_"):
            pairs = {(frm.getID(), o.getID()) for o in outgoing if o not in targets}
        else:
            pairs = {(frm.getID(), t.getID()) for t in targets}
        banned[r.rel_id] = pairs
    return banned, unresolved


def violations(net, banned: dict[str, set[tuple[str, str]]]) -> list[tuple[str, str, str]]:
    """(relation, from_edge, to_edge) for banned movements that exist in the net."""
    out = []
    for rel, pairs in sorted(banned.items()):
        for f, t in sorted(pairs):
            if net.hasEdge(f) and net.hasEdge(t) and net.getEdge(t) in net.getEdge(f).getOutgoing():
                out.append((rel, f, t))
    return out
