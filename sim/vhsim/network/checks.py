"""Structural checks on a SUMO network: roundabouts and car connectivity."""
from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

import sumolib

from vhsim.network.speeds import ring_radius_m

YIELD_STATES = {"m", "s", "w"}   # minor link, stop, wait (all-way stop)


@dataclass
class RoundaboutCheck:
    nodes: list[str]
    edges: list[str]
    lon: float
    lat: float
    radius_m: float
    approaches: int
    clockwise: bool
    problems: list[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return not self.problems


def _connection_states(net_path: Path) -> dict[tuple[str, str], set[str]]:
    states: dict[tuple[str, str], set[str]] = {}
    for c in ET.parse(net_path).getroot().iter("connection"):
        f = c.get("from")
        if f.startswith(":"):
            continue
        states.setdefault((f, c.get("to")), set()).add(c.get("state"))
    return states


def _cycle_order(edges: list, problems: list[str]) -> list:
    by_from = {}
    for e in edges:
        by_from.setdefault(e.getFromNode().getID(), []).append(e)
    if any(len(v) > 1 for v in by_from.values()):
        problems.append("ring has a node with two outgoing ring edges")
        return edges
    order = [edges[0]]
    seen = {edges[0].getID()}
    while True:
        nxt = by_from.get(order[-1].getToNode().getID())
        if not nxt:
            problems.append("ring edges do not form a closed cycle")
            return order
        e = nxt[0]
        if e.getID() in seen:
            if e is not order[0]:
                problems.append("ring edges do not form a single cycle")
            break
        order.append(e)
        seen.add(e.getID())
    if len(order) != len(edges):
        problems.append("ring edges do not form a single closed cycle")
    return order


def check_roundabouts(net_path: Path) -> list[RoundaboutCheck]:
    """Check every <roundabout> in the net.

    A roundabout is complete when its ring edges form one closed directed cycle, it circulates
    clockwise (left-hand traffic), every ring->ring link has priority ('M'), every entry link
    yields ('m'/'s'/'w'), its nodes are not signalised and it has at least one approach.
    """
    net_path = Path(net_path)
    net = sumolib.net.readNet(str(net_path))
    lefthand = ET.parse(net_path).getroot().get("lefthand") == "true"
    states = _connection_states(net_path)
    out = []
    for rb in net.getRoundabouts():
        problems: list[str] = []
        edges = [net.getEdge(e) for e in rb.getEdges() if net.hasEdge(e)]
        if len(edges) != len(rb.getEdges()):
            problems.append("roundabout lists edges missing from the net")
        if not edges:
            continue
        order = _cycle_order(edges, problems)
        pts = [e.getFromNode().getCoord() for e in order]
        area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1])) / 2
        clockwise = area < 0
        if lefthand and not clockwise:
            problems.append("ring circulates anticlockwise in a left-hand network")
        ring_ids = {e.getID() for e in edges}
        ring_nodes = {e.getFromNode().getID() for e in edges} | {e.getToNode().getID() for e in edges}
        approaches = set()
        for nid in ring_nodes:
            node = net.getNode(nid)
            if node.getType() not in ("priority", "priority_stop"):
                problems.append(f"ring node {nid} has type {node.getType()}")
            for inc in node.getIncoming():
                if inc.getID() in ring_ids or inc.isSpecial():
                    continue
                approaches.add(inc.getID())
                for out_e in inc.getOutgoing():
                    if out_e.getID() in ring_ids:
                        st = states.get((inc.getID(), out_e.getID()), set())
                        if not st <= YIELD_STATES:
                            problems.append(f"entry {inc.getID()}->{out_e.getID()} does not yield ({''.join(sorted(st))})")
        for e in edges:
            for out_e in e.getOutgoing():
                if out_e.getID() in ring_ids:
                    st = states.get((e.getID(), out_e.getID()), set())
                    if st != {"M"}:
                        problems.append(f"circulating {e.getID()}->{out_e.getID()} lacks priority ({''.join(sorted(st))})")
        if not approaches:
            problems.append("no approaches")
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        lon, lat = net.convertXY2LonLat(sum(xs) / len(xs), sum(ys) / len(ys)) if net.hasGeoProj() else (
            sum(xs) / len(xs), sum(ys) / len(ys))
        out.append(RoundaboutCheck(
            nodes=sorted(ring_nodes), edges=[e.getID() for e in order], lon=lon, lat=lat,
            radius_m=ring_radius_m(pts), approaches=len(approaches),
            clockwise=clockwise, problems=problems))
    return out


def _car_successors(edge, vclass: str):
    for to_edge, conns in edge.getOutgoing().items():
        if any(c.getFromLane().allows(vclass) and c.getToLane().allows(vclass) for c in conns):
            yield to_edge


def strongly_connected_components(net, vclass: str) -> list[set[str]]:
    """Edge-level SCCs of the network for one vehicle class (iterative Tarjan)."""
    edges = [e for e in net.getEdges() if e.allows(vclass) and not e.isSpecial()]
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    comps: list[set[str]] = []
    counter = 0
    succ = {e.getID(): [t.getID() for t in _car_successors(e, vclass)] for e in edges}
    for start in succ:
        if start in index:
            continue
        work = [(start, 0)]
        while work:
            v, i = work.pop()
            if i == 0:
                index[v] = low[v] = counter
                counter += 1
                stack.append(v)
                on_stack.add(v)
            recurse = False
            nbrs = succ.get(v, [])
            for j in range(i, len(nbrs)):
                w = nbrs[j]
                if w not in succ:
                    continue
                if w not in index:
                    work.append((v, j + 1))
                    work.append((w, 0))
                    recurse = True
                    break
                if w in on_stack:
                    low[v] = min(low[v], index[w])
            if recurse:
                continue
            if low[v] == index[v]:
                comp = set()
                while True:
                    w = stack.pop()
                    on_stack.discard(w)
                    comp.add(w)
                    if w == v:
                        break
                comps.append(comp)
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[v])
    return comps


def largest_scc(net, vclass: str = "passenger") -> set[str]:
    comps = strongly_connected_components(net, vclass)
    return max(comps, key=len) if comps else set()


def _reach(starts: set[str], succ: dict[str, list[str]]) -> set[str]:
    seen = set(starts)
    todo = list(starts)
    while todo:
        v = todo.pop()
        for w in succ.get(v, ()):
            if w not in seen:
                seen.add(w)
                todo.append(w)
    return seen


def drivable_edges(net, vclass: str, fringe_nodes: set[str]) -> set[str]:
    """Edges a vehicle of `vclass` can use for real trips.

    The largest strongly connected component, plus one-way chains that link it to the edge of
    the extract: chains entering from a fringe node that reach the component (gateway entry
    carriageways) and chains leaving the component that reach a fringe node (gateway exits).
    A vehicle entering at any gateway can then reach every kept edge, and every kept edge can
    reach every gateway exit.
    """
    inner = largest_scc(net, vclass)
    edges = [e for e in net.getEdges() if e.allows(vclass) and not e.isSpecial()]
    succ = {e.getID(): [t.getID() for t in _car_successors(e, vclass)] for e in edges}
    pred: dict[str, list[str]] = {}
    for v, ws in succ.items():
        for w in ws:
            pred.setdefault(w, []).append(v)
    sources = {e.getID() for e in edges if e.getFromNode().getID() in fringe_nodes}
    sinks = {e.getID() for e in edges if e.getToNode().getID() in fringe_nodes}
    entry = _reach(sources, succ) & _reach(inner, pred)
    exit_ = _reach(inner, succ) & _reach(sinks, pred)
    return inner | entry | exit_


def boundary_uturns(net, vclass: str, fringe_nodes: set[str]) -> list[tuple[str, str]]:
    """U-turns that would put two-way roads near the extract boundary back into the inner network.

    Where a two-way road splits into one-way carriageways just before the extract ends,
    netconvert builds no turnaround at the split (a geometry-like node), so its two halves
    become an exit-only and an entry-only chain. For each such edge pair (an edge outside the
    largest SCC whose exact reverse also lies outside it, joined at a non-fringe node without a
    connection), return (edge, reverse): allowing that U-turn stands in for the turning
    opportunities beyond the extract (assumption A-S1-08).
    """
    inner = largest_scc(net, vclass)
    chain = drivable_edges(net, vclass, fringe_nodes) - inner
    edges = [e for e in net.getEdges() if e.allows(vclass) and not e.isSpecial()]
    pred: dict[str, list[str]] = {}
    for e in edges:
        for t in _car_successors(e, vclass):
            pred.setdefault(t.getID(), []).append(e.getID())
    reaches_inner = _reach(inner, pred)
    out = []
    for eid in chain:
        if eid in reaches_inner:          # entry chains already lead into the network
            continue
        e = net.getEdge(eid)
        x = e.getToNode()
        if x.getID() in fringe_nodes:
            continue
        for r in x.getOutgoing():
            if (r.getID() in chain and r.getID() in reaches_inner and r.getToNode() is e.getFromNode()
                    and r.allows(vclass) and r not in e.getOutgoing()):
                out.append((eid, r.getID()))
    return sorted(out)
