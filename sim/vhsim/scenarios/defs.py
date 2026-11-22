"""Scenario definitions (sim/SCENARIOS.md) as patches over the baseline network.

Each component takes the `Baseline` and returns a `Patch`; `SCENARIOS` maps a scenario name to
its components (packages merge several). Every choice that is not in a source is recorded in
sim/assumptions/S6-scenarios.md.
"""
from __future__ import annotations

import csv
import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

import sumolib

from vhsim.network import config
from vhsim.scenarios.area import TOWN_CENTRE, edges_inside, load_polygon
from vhsim.scenarios.patch import Patch

FREIGHT_STREETS = {"Torrens Street", "Victoria Street"}        # DIT freight / strategic routes (S-D08, S-D22)
ARTERIAL_LINK_TYPES = {"highway.trunk", "highway.trunk_link", "highway.primary", "highway.primary_link"}
SHARED_ZONE_STREETS = ("Ocean Street", "Albert Place", "Railway Terrace")
SIGNAL_SITES = ("torrens_eyre_seaview_hindmarsh", "torrens_crozier")
SIGNAL_CYCLE_S = 90
RING_ROAD = ("Welch Road", "Armstrong Road")
B4_SITE = "adelaide_hindmarsh_portelliot"
B4_ENTRIES = ("Adelaide Road", "Hindmarsh Road")
B4_ENTRY_MIN_M = 100.0
N1_SITE = "hindmarsh_grantley_bridge"
SLIP_TYPE = "highway.trunk_link"      # a link type, so A-INT-01 adds no turn bay to slip lanes


def kmh(v: float) -> str:
    return f"{v / 3.6:.2f}"


@dataclass
class Baseline:
    net_path: Path = config.BASELINE_NET
    plain_dir: Path = config.BASELINE_PLAIN_DIR
    prefix: str = config.PLAIN_PREFIX
    junctions_csv: Path = config.NETWORKS / "junctions.csv"
    area_path: Path = TOWN_CENTRE

    @cached_property
    def net(self):
        if not Path(self.net_path).exists():
            raise FileNotFoundError(f"{self.net_path} missing: run python -m vhsim.network.build")
        return sumolib.net.readNet(str(self.net_path))

    @cached_property
    def shapes(self) -> dict[str, str]:
        root = ET.parse(Path(self.plain_dir) / f"{self.prefix}.edg.xml").getroot()
        return {e.get("id"): e.get("shape") for e in root.iter("edge") if e.get("shape")}

    @cached_property
    def junctions(self) -> dict[str, dict]:
        with open(self.junctions_csv, newline="") as f:
            return {r["junction_id"]: r for r in csv.DictReader(f)}

    @cached_property
    def town_centre(self):
        return load_polygon(self.area_path)

    @cached_property
    def inside_town_centre(self) -> list[str]:
        return edges_inside(self.net, self.town_centre)

    def bearing(self, edge) -> float:
        """Compass bearing (degrees) from the edge's start to its end."""
        (x0, y0), (x1, y1) = edge.getFromNode().getCoord(), edge.getToNode().getCoord()
        return (math.degrees(math.atan2(x1 - x0, y1 - y0)) + 360) % 360

    def roundabout_at(self, junction_id: str):
        nodes = set(self.junctions[junction_id]["sumo_nodes"].split())
        for rb in self.net.getRoundabouts():
            if set(rb.getNodes()) & nodes:
                return rb
        raise KeyError(f"no roundabout at {junction_id}")


# ---- helpers ------------------------------------------------------------------------------------

def speed_limit(base: Baseline, edge_ids, limit_kmh: float, label: str) -> Patch:
    """Lower the speed of the given edges to `limit_kmh` (edges already at or below it are untouched)."""
    p = Patch()
    changed = []
    for eid in edge_ids:
        if base.net.getEdge(eid).getSpeed() * 3.6 > limit_kmh + 0.5:
            p.set_edge(eid, speed=kmh(limit_kmh))
            changed.append(eid)
    p.notes.append(f"{label}: {len(changed)} edges to {limit_kmh:g} km/h")
    return p


def _drivable(succ: dict[str, list[str]], sources: set[str], sinks: set[str]) -> set[str]:
    """Largest strongly connected component plus entry/exit chains to the extract boundary
    (as vhsim.network.checks.drivable_edges, on an explicit successor graph)."""
    pred: dict[str, list[str]] = {}
    for v, ws in succ.items():
        for w in ws:
            pred.setdefault(w, []).append(v)

    def reach(starts, graph):
        seen, todo = set(starts), list(starts)
        while todo:
            for w in graph.get(todo.pop(), ()):
                if w not in seen:
                    seen.add(w)
                    todo.append(w)
        return seen

    # Kosaraju: finishing order on succ, then components on pred
    order, seen = [], set()
    for root in succ:
        if root in seen:
            continue
        seen.add(root)
        stack = [(root, iter(succ[root]))]
        while stack:
            v, it = stack[-1]
            nxt = next((w for w in it if w not in seen), None)
            if nxt is None:
                stack.pop()
                order.append(v)
            else:
                seen.add(nxt)
                stack.append((nxt, iter(succ.get(nxt, ()))))
    comp: dict[str, int] = {}
    for root in reversed(order):
        if root in comp:
            continue
        comp[root] = root_id = len(comp)
        todo = [root]
        while todo:
            for w in pred.get(todo.pop(), ()):
                if w not in comp:
                    comp[w] = root_id
                    todo.append(w)
    sizes: dict[int, int] = {}
    for c in comp.values():
        sizes[c] = sizes.get(c, 0) + 1
    big = max(sizes, key=sizes.get)
    inner = {v for v, c in comp.items() if c == big}
    entry = reach(sources & set(succ), succ) & reach(inner, pred)
    exit_ = reach(inner, succ) & reach(sinks & set(succ), pred)
    return inner | entry | exit_


def orphaned_by(base: Baseline, deleted: set[str], vclass: str = "passenger") -> set[str]:
    """Edges that were drivable in the baseline but no longer are once `deleted` is removed (car-park
    stubs and median links whose only access was a removed carriageway)."""
    from vhsim.network.build import fringe_nodes

    fringe = fringe_nodes(base.net)
    edges = [e for e in base.net.getEdges() if e.allows(vclass) and not e.isSpecial()]

    def graph(skip):
        return {e.getID(): [t.getID() for t, conns in e.getOutgoing().items() if t.getID() not in skip
                            and any(c.getFromLane().allows(vclass) and c.getToLane().allows(vclass) for c in conns)]
                for e in edges if e.getID() not in skip}

    sources = {e.getID() for e in edges if e.getFromNode().getID() in fringe}
    sinks = {e.getID() for e in edges if e.getToNode().getID() in fringe}
    before = _drivable(graph(set()), sources, sinks)
    after = _drivable(graph(set(deleted)), sources, sinks)
    return before - set(deleted) - after


def baseline_movements(base: Baseline, eid: str) -> set[str]:
    return {t.getID() for t in base.net.getEdge(eid).getOutgoing()}


# ---- C1 / C2: speed limits -----------------------------------------------------------------------

def c1_edges(base: Baseline, include_torrens: bool) -> list[str]:
    """Town-centre edges under the C1 limit. Victoria St (and any primary road) is always excluded;
    Torrens St and its trunk links (median crossings, roundabout rings) only in C1a."""
    out = []
    for eid in base.inside_town_centre:
        e = base.net.getEdge(eid)
        name, typ = e.getName(), e.getType()
        if name == "Victoria Street" or typ in ("highway.primary", "highway.primary_link"):
            continue
        if not include_torrens and (name == "Torrens Street" or typ in ARTERIAL_LINK_TYPES):
            continue
        out.append(eid)
    return out


def c1a(base: Baseline) -> Patch:
    return speed_limit(base, c1_edges(base, include_torrens=False), 30, "C1a 30 km/h town centre (not Torrens/Victoria St)")


def c1b(base: Baseline) -> Patch:
    return speed_limit(base, c1_edges(base, include_torrens=True), 30, "C1b 30 km/h town centre incl. Torrens St")


def c2_edges(base: Baseline) -> list[str]:
    return [eid for eid in base.inside_town_centre if base.net.getEdge(eid).getName() in SHARED_ZONE_STREETS]


def c2(base: Baseline) -> Patch:
    return speed_limit(base, c2_edges(base), 20, "C2 20 km/h shared zones (Ocean St, Albert Pl, Railway Tce)")


# ---- C3: one-way outer loop -----------------------------------------------------------------------

def _heading(bearing: float) -> tuple[float, float]:
    """(east, north) components of a bearing."""
    r = math.radians(bearing)
    return math.sin(r), math.cos(r)


def loop_legs(base: Baseline, clockwise: bool = True) -> dict[str, list[str]]:
    """Per loop street, the edges that run AGAINST the loop direction (to be removed).

    Clockwise: Torrens St north-east, Eyre Tce south-east, Flinders Pde south, Esplanade west.
    Torrens St: every Torrens St edge (it runs only from Victoria St to the Seaview roundabout);
    the others: their edges inside the town-centre area (Esplanade: east of Albert Pl)."""
    sign = 1 if clockwise else -1
    keep_dir = {                             # unit test on (east, north) of the KEPT direction
        "Torrens Street": lambda ex, no: sign * no > 0,     # north(-east)
        "Eyre Terrace": lambda ex, no: sign * no < 0,       # south(-east)
        "Flinders Parade": lambda ex, no: sign * no < 0,    # south
        "Esplanade": lambda ex, no: sign * ex < 0,          # west
    }
    inside = set(base.inside_town_centre)
    out: dict[str, list[str]] = {k: [] for k in keep_dir}
    for e in base.net.getEdges():
        name = e.getName()
        if name not in keep_dir or (name != "Torrens Street" and e.getID() not in inside):
            continue
        if not keep_dir[name](*_heading(base.bearing(e))):
            out[name].append(e.getID())
    return {k: sorted(v) for k, v in out.items()}


def c3(base: Baseline, clockwise: bool = True) -> Patch:
    legs = loop_legs(base, clockwise)
    against = {e for v in legs.values() for e in v}
    orphans = orphaned_by(base, against)
    p = Patch(edge_deletes=against | orphans)
    p.notes.append(f"C3{'' if clockwise else 'b'} one-way loop ({'clockwise' if clockwise else 'anticlockwise'}): "
                   + "; ".join(f"{k}: {len(v)} edges removed" for k, v in legs.items())
                   + f"; {len(orphans)} edges left without access removed ({', '.join(sorted(orphans))})")
    return p


def c3b(base: Baseline) -> Patch:
    return c3(base, clockwise=False)


# ---- C4: roundabouts -> signals -------------------------------------------------------------------

def _shape_points(shape: str | None) -> list[tuple[float, float]]:
    return [tuple(map(float, p.split(","))) for p in shape.split()] if shape else []


def _fmt_shape(pts) -> str:
    return " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)


def ring_movements(base: Baseline, rb) -> dict[str, set[str]]:
    """approach edge -> exit edges reachable by driving round the roundabout (baseline)."""
    ring = set(rb.getEdges())
    nodes = set(rb.getNodes())
    out = {}
    for nid in nodes:
        for a in base.net.getNode(nid).getIncoming():
            if a.getID() in ring:
                continue
            exits, seen, todo = set(), set(), [a]
            while todo:
                e = todo.pop()
                for t in e.getOutgoing():
                    if t.getID() in ring:
                        if t.getID() not in seen:
                            seen.add(t.getID())
                            todo.append(t)
                    elif e.getID() in ring:
                        exits.add(t.getID())
            out[a.getID()] = exits
    return out


def signalise_roundabout(base: Baseline, junction_id: str, cycle_s: int = SIGNAL_CYCLE_S) -> Patch:
    """Replace a roundabout by one actuated traffic-light node on the existing approach lanes."""
    rb = base.roundabout_at(junction_id)
    ring = set(rb.getEdges())
    ring_nodes = [base.net.getNode(n) for n in rb.getNodes()]
    xs = [n.getCoord()[0] for n in ring_nodes]
    ys = [n.getCoord()[1] for n in ring_nodes]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    radius = max(math.dist((cx, cy), n.getCoord()) for n in ring_nodes)
    nid = f"s6_signal_{junction_id}"
    p = Patch(edge_deletes=set(ring), signals={nid})
    p.nodes[nid] = {"x": f"{cx:.2f}", "y": f"{cy:.2f}", "type": "traffic_light", "tlType": "actuated"}
    p.netconvert_options = {"--tls.default-type": "actuated", "--tls.cycle.time": str(cycle_s)}
    near = radius + 2.0
    for node in ring_nodes:
        for e in node.getIncoming():
            if e.getID() in ring:
                continue
            pts = _shape_points(base.shapes.get(e.getID())) or [e.getFromNode().getCoord(), node.getCoord()]
            while len(pts) > 1 and math.dist(pts[-1], (cx, cy)) < near:
                pts.pop()
            p.set_edge(e.getID(), to=nid, shape=_fmt_shape(pts + [(cx, cy)]))
        for e in node.getOutgoing():
            if e.getID() in ring:
                continue
            pts = _shape_points(base.shapes.get(e.getID())) or [node.getCoord(), e.getToNode().getCoord()]
            while len(pts) > 1 and math.dist(pts[0], (cx, cy)) < near:
                pts.pop(0)
            p.set_edge(e.getID(), **{"from": nid, "shape": _fmt_shape([(cx, cy)] + pts)})
    p.movements = ring_movements(base, rb)
    p.junction_aliases[nid] = {"junction_id": junction_id, "kind": "signal node",
                               "replaces": sorted(rb.getNodes()) + sorted(ring)}
    p.notes.append(f"C4 {junction_id}: roundabout ({len(ring)} ring edges, {len(ring_nodes)} nodes) replaced by "
                   f"actuated signal {nid}; {len(p.movements)} approaches keep their movements")
    return p


def c4(base: Baseline) -> Patch:
    p = Patch()
    for site in SIGNAL_SITES:
        p = p.merge(signalise_roundabout(base, site))
    return p


# ---- B3 / B4: capacity ----------------------------------------------------------------------------

def widen(base: Baseline, edge_ids, lanes: int = 2) -> Patch:
    p = Patch()
    for eid in edge_ids:
        if base.net.getEdge(eid).getLaneNumber() < lanes:
            p.set_edge(eid, numLanes=str(lanes))
            p.movements[eid] = baseline_movements(base, eid)
    return p


def b3(base: Baseline) -> Patch:
    ids = sorted(e.getID() for e in base.net.getEdges() if e.getName() in RING_ROAD)
    p = widen(base, ids)
    km = sum(base.net.getEdge(e).getLength() for e in p.edges) / 1000
    p.notes.append(f"B3 four-lane ring route: {len(p.edges)} Welch Rd / Armstrong Rd edges ({km:.1f} directed km) to 2 lanes")
    return p


def _entry_chain(base: Baseline, approach, ring_nodes: set[str], min_m: float) -> list[str]:
    """The approach edge and its same-street predecessors, back to at least `min_m` from the ring."""
    chain, total, e = [], 0.0, approach
    while e is not None:
        chain.append(e.getID())
        total += e.getLength()
        if total >= min_m:
            break
        preds = [x for x in e.getIncoming() if x.getName() == approach.getName()
                 and x.getFromNode().getID() not in ring_nodes and x.getID() not in chain
                 and x.getLaneNumber() == 1 and abs(((base.bearing(x) - base.bearing(e) + 180) % 360) - 180) < 60]
        e = preds[0] if len(preds) == 1 else None
    return chain


def b4(base: Baseline) -> Patch:
    rb = base.roundabout_at(B4_SITE)
    ring_nodes = set(rb.getNodes())
    entries = []
    for nid in ring_nodes:
        for a in base.net.getNode(nid).getIncoming():
            if a.getID() not in rb.getEdges() and a.getName() in B4_ENTRIES:
                entries += _entry_chain(base, a, ring_nodes, B4_ENTRY_MIN_M)
    p = widen(base, list(rb.getEdges()) + entries)
    entry_m = sum(base.net.getEdge(e).getLength() for e in entries)
    p.notes.append(f"B4 two-lane McCracken roundabout: {len(rb.getEdges())} ring edges and {len(entries)} entry edges "
                   f"({entry_m:.0f} m on Adelaide Rd + Hindmarsh Rd) to 2 lanes")
    return p


# ---- B5: left-turn slip lanes ---------------------------------------------------------------------

def _turn_angle(base: Baseline, a, x) -> float:
    """Signed change of heading from approach `a` to exit `x` (degrees, negative = left)."""
    return ((base.bearing(x) - base.bearing(a) + 180) % 360) - 180


def left_turns(base: Baseline, rb) -> list[tuple[str, str]]:
    """(approach, exit) pairs of a roundabout whose movement is a left turn (heading change -150..-30
    degrees, left-hand traffic) and exists today."""
    out = []
    for a, exits in sorted(ring_movements(base, rb).items()):
        ea = base.net.getEdge(a)
        cands = [(abs(_turn_angle(base, ea, base.net.getEdge(x)) + 90), x) for x in exits
                 if -150 <= _turn_angle(base, ea, base.net.getEdge(x)) <= -30]
        if cands:
            out.append((a, min(cands)[1]))
    return out


TURNAROUND = {"t", "T"}


def slip_feeders(approach) -> list[str]:
    """Edges that feed the approach other than by a U-turn."""
    return sorted(u.getID() for u in approach.getIncoming()
                  if any(c.getDirection() not in TURNAROUND for c in u.getOutgoing().get(approach, [])))


def slip_onward(exit_) -> list[str]:
    """Edges the exit continues to other than by a U-turn."""
    return sorted(d.getID() for d, conns in exit_.getOutgoing().items()
                  if any(c.getDirection() not in TURNAROUND for c in conns))


def slip_lanes(base: Baseline, junction_id: str) -> Patch:
    """A one-lane left-turn bypass per left-turn movement: a new edge from the approach's upstream
    node to the exit's downstream node, giving way where it rejoins. Its limit is the approach
    road's posted limit (a slip lane is signed as part of the road); runs route on free-flow costs,
    in which the roundabout's yield delay is nearly absent, so a slower slip would carry nothing."""
    rb = base.roundabout_at(junction_id)
    ring_nodes = [base.net.getNode(n) for n in rb.getNodes()]
    cx = sum(n.getCoord()[0] for n in ring_nodes) / len(ring_nodes)
    cy = sum(n.getCoord()[1] for n in ring_nodes) / len(ring_nodes)
    near = max(math.dist((cx, cy), n.getCoord()) for n in ring_nodes) + 2.0
    p = Patch()
    for a, x in left_turns(base, rb):
        ea, ex = base.net.getEdge(a), base.net.getEdge(x)
        pa = _shape_points(base.shapes.get(a)) or [ea.getFromNode().getCoord(), ea.getToNode().getCoord()]
        px = _shape_points(base.shapes.get(x)) or [ex.getFromNode().getCoord(), ex.getToNode().getCoord()]
        before = [q for q in pa if math.dist(q, (cx, cy)) >= near] or pa[:1]
        after = [q for q in px if math.dist(q, (cx, cy)) >= near] or px[-1:]
        # keep the slip outside the ring: an arc point on the bisector, 5 m beyond the ring
        (bx, by), (ax, ay) = before[-1], after[0]
        mx, my = (bx + ax) / 2 - cx, (by + ay) / 2 - cy
        norm = math.hypot(mx, my) or 1.0
        arc = (cx + mx / norm * (near + 5), cy + my / norm * (near + 5))
        pts = before + [arc] + after
        sid = f"s6_slip_{a}_{x}"
        p.set_edge(sid, **{"from": ea.getFromNode().getID(), "to": ex.getToNode().getID(),
                           "speed": f"{ea.getSpeed():.2f}", "priority": "1", "type": SLIP_TYPE,
                           "name": f"{ea.getName()} slip lane".strip(), "shape": _fmt_shape(pts)})
        feeders, onward = slip_feeders(ea), slip_onward(ex)
        p.con_adds |= {(u, sid) for u in feeders} | {(sid, d) for d in onward}
        p.movements[sid] = set(onward)
        p.junction_aliases[sid] = {"junction_id": junction_id, "kind": "left-turn slip lane",
                                   "replaces": [a, x]}
    p.notes.append(f"B5 {junction_id}: {len(p.edges)} left-turn slip lanes ({', '.join(sorted(p.edges))})")
    return p


def b5(base: Baseline) -> Patch:
    p = Patch()
    for site in SIGNAL_SITES:
        p = p.merge(slip_lanes(base, site))
    return p


# ---- N1: Grantley Ave rail crossing ---------------------------------------------------------------

def n1(base: Baseline) -> Patch:
    """Close the Grantley Ave rail crossing to motor vehicles: remove the short link (OSM way 184390360,
    level-crossing node 1948692262) that carries Grantley Ave across the railway from Hindmarsh Rd to
    Bridge Tce, i.e. the edges joining the junction's two nodes."""
    nodes = set(base.junctions[N1_SITE]["sumo_nodes"].split())
    link = {e.getID() for e in base.net.getEdges()
            if e.getFromNode().getID() in nodes and e.getToNode().getID() in nodes}
    orphans = orphaned_by(base, link)
    p = Patch(edge_deletes=link | orphans)
    m = sum(base.net.getEdge(e).getLength() for e in link)
    p.notes.append(f"N1 Grantley Ave rail crossing closed: {len(link)} edges removed ({m:.0f} m directed: "
                   f"{', '.join(sorted(link))}), {len(orphans)} left without access")
    return p


# ---- S7 improvement options (N2-N6; sim/assumptions/S7-improvements.md) -------------------------

N2_NODE = "598111160"            # Armstrong Rd / Crozier Rd (junctions.csv armstrong_crozier), give-way T today
N2_RADIUS_M = 20.0
N3_APPROACH = "39946279"         # Crozier Rd approach to Armstrong Rd (195 m, one lane)
N3_FLARE_M = 40.0
N4_NODE = "1948692238"           # Hindmarsh Rd / Grantley Ave / rail-crossing link (hindmarsh_grantley_bridge)
N4_RADIUS_M = 12.0
N4_SHIFT_M = 8.0                 # centre moved away from the rail crossing so the link to Bridge Tce keeps ~13 m
N4_CROSSING_IN = "-184390360#1"
N5_NODE = "598113188"            # Armstrong Rd / Greenhills Rd (armstrong_greenhills), give-way T today
N5_RADIUS_M = 15.0               # the next Armstrong Rd node north is 29.6 m away: 20 m would leave a 9 m stub
N8_LEFT_TURN_LANES = ("173449383#0", "173449383#3")   # Victoria St eastbound into Oval Rd / the IGA car park
N8_LANE_M = 40.0
NO_RIGHT_OUT = {                 # side-street approach -> street name (N6)
    "42530572#1": "Granite Street",     # onto Victoria St (victoria_granite)
    "60269602#2": "Coral Street",       # onto Torrens St (torrens_coral)
    "-43152356#0": "Wattle Drive",      # onto Hindmarsh Rd
}


def _junction_of(base: Baseline, node_id: str) -> str:
    for jid, row in base.junctions.items():
        if node_id in row["sumo_nodes"].split():
            return jid
    return node_id


def roundabout(base: Baseline, node_id: str, site: str, radius: float, shift_from: str | None = None,
               shift_m: float = 0.0) -> Patch:
    """Replace a priority junction by a single-lane roundabout: one ring node per leg on a circle of
    `radius` (optionally with the centre moved `shift_m` away from edge `shift_from`), ring edges running
    clockwise (left-hand traffic), approach/exit edges trimmed to the circle and joined to their leg's
    ring node. Ring speed and type follow the baseline's roundabouts (vhsim.scenarios.s7)."""
    from vhsim.scenarios import s7

    node = base.net.getNode(node_id)
    c = node.getCoord()
    if shift_from:
        e = base.net.getEdge(shift_from)
        far = e.getFromNode().getCoord() if e.getToNode().getID() == node_id else e.getToNode().getCoord()
        c = s7.point_at(c, (s7.bearing(c, far) + 180) % 360, shift_m)
    ins = [e for e in node.getIncoming() if e.getFunction() != "internal"]
    outs = [e for e in node.getOutgoing() if e.getFunction() != "internal"]

    def pts_of(e):
        return _shape_points(base.shapes.get(e.getID())) or [e.getFromNode().getCoord(), e.getToNode().getCoord()]

    def far_point(e, incoming):
        pts = pts_of(e)
        seq = pts[::-1] if incoming else pts           # walk away from the junction
        for q in seq:
            if math.dist(q, c) >= radius + 5:
                return q
        return seq[-1]

    bearings = {e.getID(): s7.bearing(c, far_point(e, True)) for e in ins}
    bearings |= {e.getID(): s7.bearing(c, far_point(e, False)) for e in outs}
    legs = s7.group_legs(bearings)
    leg_b = [s7.circular_mean([bearings[e] for e in g]) for g in legs]
    order = s7.clockwise_order(leg_b)
    ring_xy = s7.ring_layout(c, leg_b, radius)
    rnodes = [f"s7_rb_{site}_{i}" for i in range(len(legs))]
    major = max(ins + outs, key=lambda e: e.getPriority())
    p = Patch()
    jid = _junction_of(base, node_id)
    for i, nid in enumerate(rnodes):
        p.nodes[nid] = {"x": f"{ring_xy[i][0]:.2f}", "y": f"{ring_xy[i][1]:.2f}"}
        p.junction_aliases[nid] = {"junction_id": jid, "kind": "roundabout ring node", "replaces": [node_id]}
    ring_ids = []
    for k, i in enumerate(order):
        j = order[(k + 1) % len(order)]
        rid = f"s7_ring_{site}_{i}_{j}"
        ring_ids.append(rid)
        p.set_edge(rid, **{"from": rnodes[i], "to": rnodes[j],
                           "speed": f"{s7.ring_speed_ms(radius):.2f}", "priority": str(major.getPriority()),
                           "type": major.getType(), "shape": _fmt_shape(s7.arc(c, leg_b[i], leg_b[j], radius))})
    near = radius + 1.0
    for e in ins + outs:
        far = e.getFromNode() if e in ins else e.getToNode()
        if math.dist(far.getCoord(), c) < near + 1.0:
            raise ValueError(f"{site}: leg {e.getID()} ends {math.dist(far.getCoord(), c):.1f} m from the centre, "
                             f"inside a {radius:g} m ring; use a smaller radius")
    leg_of = {e: k for k, g in enumerate(legs) for e in g}
    for e in ins:
        pts = pts_of(e)
        while len(pts) > 1 and math.dist(pts[-1], c) < near:
            pts.pop()
        p.set_edge(e.getID(), to=rnodes[leg_of[e.getID()]], shape=_fmt_shape(pts + [ring_xy[leg_of[e.getID()]]]))
    for e in outs:
        pts = pts_of(e)
        while len(pts) > 1 and math.dist(pts[0], c) < near:
            pts.pop(0)
        p.set_edge(e.getID(), **{"from": rnodes[leg_of[e.getID()]],
                                 "shape": _fmt_shape([ring_xy[leg_of[e.getID()]]] + pts)})
    # the old junction's base connections are dropped by vhsim.network.scenario (edges with a new end
    # node); netconvert computes the ring's
    p.roundabouts.append((tuple(rnodes[i] for i in order), tuple(ring_ids)))
    p.notes.append(f"{site}: priority junction {node_id} ({jid}) -> single-lane roundabout, radius {radius:g} m, "
                   f"{len(legs)} legs, ring {s7.ring_speed_ms(radius) * 3.6:.0f} km/h"
                   + (f", centre moved {shift_m:g} m away from {shift_from}" if shift_from else ""))
    return p


def flare(base: Baseline, approach: str, length_m: float, site: str, left_turn_lane: bool = False) -> Patch:
    """Give a one-lane approach two lanes for its last `length_m` (at most half the edge). Default (a
    side-road flare): kerb lane (0) for left turns and straight on, median lane (1) for right turns and
    U-turns. `left_turn_lane`: kerb lane for the left turn only, median lane for everything else (a
    left-turn deceleration lane on an arterial). The flared end is a new edge `<approach>.bay` (the A-INT-01
    naming, so the R15 tables add the upstream queue)."""
    e = base.net.getEdge(approach)
    L = round(min(length_m, 0.5 * e.getLength()), 1)
    bay = f"{approach}.bay"
    p = Patch()
    p.set_edge(approach, numLanes="2")
    p.splits[approach] = [{"pos": "0", "lanes": "0", "idBefore": f"{approach}.x", "idAfter": approach},
                          {"pos": f"-{L}", "lanes": "0 1", "idBefore": approach, "idAfter": bay}]
    p.con_lane_adds |= {(approach, bay, 0, 0), (approach, bay, 0, 1)}
    for t, conns in e.getOutgoing().items():
        for cn in conns:
            if left_turn_lane:
                lane = 0 if cn.getDirection() in ("l", "L") else 1
            else:
                lane = 1 if cn.getDirection() in ("r", "R", "t", "T") else 0
            p.con_lane_adds.add((bay, t.getID(), lane, cn.getToLane().getIndex()))
    p.movements[approach] = {bay}
    p.movements[bay] = baseline_movements(base, approach)
    p.notes.append(f"{site}: {e.getName()} approach {approach} flared to 2 lanes for its last {L:g} m "
                   + ("(left-turn kerb lane, straight/right median lane)" if left_turn_lane
                      else "(left/straight kerb lane, right/U median lane)"))
    return p


def no_right_out(base: Baseline, approach: str) -> Patch:
    """Ban the right turn(s) out of a side-street approach (a 'no right turn' sign; left and straight stay)."""
    e = base.net.getEdge(approach)
    rights = {t.getID() for t, conns in e.getOutgoing().items() if any(c.getDirection() in ("r", "R") for c in conns)}
    if not rights:
        raise ValueError(f"{approach} has no right turn to ban")
    p = Patch(con_deletes={(approach, t) for t in rights})
    p.movements[approach] = baseline_movements(base, approach) - rights
    p.notes.append(f"no right turn out of {e.getName()} ({approach} -> {', '.join(sorted(rights))})")
    return p


def n2(base: Baseline) -> Patch:
    return roundabout(base, N2_NODE, "armstrong_crozier", N2_RADIUS_M)


def n3(base: Baseline) -> Patch:
    return flare(base, N3_APPROACH, N3_FLARE_M, "armstrong_crozier")


def n4(base: Baseline) -> Patch:
    return roundabout(base, N4_NODE, "hindmarsh_grantley", N4_RADIUS_M, shift_from=N4_CROSSING_IN, shift_m=N4_SHIFT_M)


def n5_greenhills(base: Baseline) -> Patch:
    return roundabout(base, N5_NODE, "armstrong_greenhills", N5_RADIUS_M)


def n6(base: Baseline) -> Patch:
    p = Patch()
    for a in sorted(NO_RIGHT_OUT):
        p = p.merge(no_right_out(base, a))
    return p


def n8(base: Baseline) -> Patch:
    p = Patch()
    for a in N8_LEFT_TURN_LANES:
        p = p.merge(flare(base, a, N8_LANE_M, "victoria_st", left_turn_lane=True))
    return p


SCENARIOS: dict[str, tuple] = {
    "c1a": (c1a,),
    "c1b": (c1b,),
    "c2": (c2,),
    "c3": (c3,),
    "c3b": (c3b,),
    "c4": (c4,),
    "cp": (c1a, c2, c3, c4),
    "b3": (b3,),
    "b4": (b4,),
    "b5": (b5,),
    "bp": (b3, b4, b5),
    "n1": (n1,),
    # S7 (sim/assumptions/S7-improvements.md)
    "n2": (n2,),
    "n3": (n3,),
    "n4": (n4,),
    "n5": (n2, n5_greenhills),
    "n6": (n6,),
    "n7": (n2, n5_greenhills, n4),
    "n8": (n8,),
    "n9": (n3, n4),
}


def compose(name: str, base: Baseline) -> Patch:
    p = Patch()
    for component in SCENARIOS[name]:
        p = p.merge(component(base))
    return p
