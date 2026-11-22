"""A scenario's changes to the baseline, as data, written out as netconvert plain-XML patches.

Components (C1a, C3, C4, ...) each return a `Patch`; packages merge them. Merge rules: a deleted
edge stays deleted (its other changes are dropped), two speed changes on one edge keep the lower
speed, any other attribute takes the later component's value.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from xml.sax.saxutils import quoteattr


@dataclass
class Patch:
    edges: dict[str, dict[str, str]] = field(default_factory=dict)       # edge id -> attributes to set
    edge_deletes: set[str] = field(default_factory=set)
    nodes: dict[str, dict[str, str]] = field(default_factory=dict)       # node id -> attributes (new or update)
    con_deletes: set[tuple[str, str]] = field(default_factory=set)        # (from, to) movements to remove
    con_adds: set[tuple[str, str]] = field(default_factory=set)           # (from, to) movements to add, kerb lane to kerb lane
    netconvert_options: dict[str, str] = field(default_factory=dict)      # e.g. {"--tls.cycle.time": "90"}
    signals: set[str] = field(default_factory=set)                        # node ids that become traffic lights
    notes: list[str] = field(default_factory=list)                        # what each component did
    # movements (from edge -> to edges) that edges whose connections netconvert recomputes must keep,
    # and no more: the build removes any extra movement netconvert guesses
    movements: dict[str, set[str]] = field(default_factory=dict)
    # new node / edge id -> {"junction_id": named junction (junctions.csv), "replaces": [baseline ids]},
    # so metrics can match scenario movements to the baseline's at rebuilt junctions
    junction_aliases: dict[str, dict] = field(default_factory=dict)
    # S7: roundabout declarations (ring nodes, ring edges), <split> children per edge (netconvert edge
    # splits, e.g. a flared approach) and lane-specific connections (from, to, fromLane, toLane)
    roundabouts: list[tuple[tuple[str, ...], tuple[str, ...]]] = field(default_factory=list)
    splits: dict[str, list[dict[str, str]]] = field(default_factory=dict)
    con_lane_adds: set[tuple[str, str, int, int]] = field(default_factory=set)
    # S9: routing preferences (routingType, vClasses, priority): SUMO divides an edge's routing cost by
    # `priority` for those vClasses on edges of that routingType (written next to the net, loaded by runs)
    preferences: list[tuple[str, str, float]] = field(default_factory=list)

    def set_edge(self, eid: str, **attrs: str) -> None:
        cur = self.edges.setdefault(eid, {})
        for k, v in attrs.items():
            if k == "speed" and "speed" in cur:
                v = min(float(v), float(cur["speed"]))
                v = f"{v:.2f}"
            cur[k] = str(v)

    def merge(self, other: "Patch") -> "Patch":
        out = Patch()
        for p in (self, other):
            for eid, attrs in p.edges.items():
                out.set_edge(eid, **attrs)
            out.edge_deletes |= p.edge_deletes
            for nid, attrs in p.nodes.items():
                out.nodes.setdefault(nid, {}).update(attrs)
            out.con_deletes |= p.con_deletes
            out.con_adds |= p.con_adds
            for k, v in p.netconvert_options.items():
                out.netconvert_options.setdefault(k, v)
            out.signals |= p.signals
            out.notes += p.notes
            for f, ts in p.movements.items():
                out.movements.setdefault(f, set()).update(ts)
            for k, v in p.junction_aliases.items():
                out.junction_aliases[k] = v
            out.roundabouts += [r for r in p.roundabouts if r not in out.roundabouts]
            for k, v in p.splits.items():
                if k in out.splits and out.splits[k] != list(v):
                    raise ValueError(f"conflicting splits of edge {k}")
                out.splits[k] = list(v)
            out.con_lane_adds |= p.con_lane_adds
            out.preferences += [x for x in p.preferences if x not in out.preferences]
            for k, v in p.netconvert_options.items():
                if out.netconvert_options[k] != v:
                    raise ValueError(f"conflicting netconvert option {k}: {out.netconvert_options[k]} vs {v}")
        for eid in out.edge_deletes:
            out.edges.pop(eid, None)
            out.movements.pop(eid, None)
        out.movements = {f: ts - out.edge_deletes for f, ts in out.movements.items()}
        out.con_deletes = {(f, t) for f, t in out.con_deletes
                           if f not in out.edge_deletes and t not in out.edge_deletes}
        out.con_adds = {(f, t) for f, t in out.con_adds
                        if f not in out.edge_deletes and t not in out.edge_deletes}
        out.con_lane_adds = {c for c in out.con_lane_adds
                             if c[0] not in out.edge_deletes and c[1] not in out.edge_deletes}
        out.roundabouts = [r for r in out.roundabouts if not set(r[1]) & out.edge_deletes]
        for eid in out.edge_deletes:
            out.splits.pop(eid, None)
        return out

    @property
    def netconvert_args(self) -> list[str]:
        return [x for k, v in sorted(self.netconvert_options.items()) for x in (k, v)]

    def write(self, patch_dir: Path, comment: str = "") -> list[Path]:
        """Write the patch files into `patch_dir` (old *.xml patch files there are removed first)."""
        patch_dir = Path(patch_dir)
        patch_dir.mkdir(parents=True, exist_ok=True)
        for old in patch_dir.glob("*.xml"):
            old.unlink()
        head = f"<!-- {comment} Generated by vhsim.scenarios; do not edit by hand. -->\n" if comment else ""
        written = []
        if self.nodes:
            lines = [f"    <node id={quoteattr(n)}{_attrs(a)}/>" for n, a in sorted(self.nodes.items())]
            written.append(_write(patch_dir / "s6.nod.xml", head, "nodes", lines))
        if self.edges or self.edge_deletes or self.roundabouts:
            lines = [f"    <delete id={quoteattr(e)}/>" for e in sorted(self.edge_deletes)]
            for e, a in sorted(self.edges.items()):
                splits = "".join(f"<split{_attrs(s)}/>" for s in self.splits.get(e, []))
                lines.append(f"    <edge id={quoteattr(e)}{_attrs(a)}>{splits}</edge>" if splits
                             else f"    <edge id={quoteattr(e)}{_attrs(a)}/>")
            lines += [f"    <roundabout nodes={quoteattr(' '.join(n))} edges={quoteattr(' '.join(r))}/>"
                      for n, r in self.roundabouts]
            written.append(_write(patch_dir / "s6.edg.xml", head, "edges", lines))
        if self.con_deletes or self.con_adds or self.con_lane_adds:
            lines = [f"    <delete from={quoteattr(f)} to={quoteattr(t)}/>" for f, t in sorted(self.con_deletes)]
            lines += [f"    <connection from={quoteattr(f)} to={quoteattr(t)} fromLane=\"0\" toLane=\"0\"/>"
                      for f, t in sorted(self.con_adds)]
            lines += [f"    <connection from={quoteattr(f)} to={quoteattr(t)} fromLane=\"{a}\" toLane=\"{b}\"/>"
                      for f, t, a, b in sorted(self.con_lane_adds)]
            written.append(_write(patch_dir / "s6.con.xml", head, "connections", lines))
        return written

    def write_preferences(self, path: Path) -> Path | None:
        """SUMO additional file with the routing preferences (None, and any old file removed, if there are none)."""
        path = Path(path)
        if not self.preferences:
            path.unlink(missing_ok=True)
            return None
        lines = [f"    <preference routingType={quoteattr(rt)} vClasses={quoteattr(vc)} priority=\"{pr:g}\"/>"
                 for rt, vc, pr in self.preferences]
        return _write(path, "<!-- Routing preferences (vhsim.scenarios); loaded by duarouter and sumo. -->\n",
                      "additional", lines)


def _attrs(a: dict[str, str]) -> str:
    order = ["from", "to", "name", "speed", "numLanes", "priority", "type", "shape", "x", "y", "tlType",
             "pos", "lanes", "idBefore", "idAfter"]
    keys = sorted(a, key=lambda k: (order.index(k) if k in order else len(order), k))
    return "".join(f" {k}={quoteattr(str(a[k]))}" for k in keys)


def _write(path: Path, head: str, root: str, lines: list[str]) -> Path:
    path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + head + f"<{root}>\n" + "\n".join(lines)
                    + f"\n</{root}>\n")
    return path
