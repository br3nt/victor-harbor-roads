"""Build the baseline Victor Harbor SUMO network.

    python -m vhsim.network.build [--out-dir DIR] [--keep-work]

Pipeline:
  0. pre-filter the OSM extract (S-E01): drop private/driveway/car-park-aisle service ways;
  1. netconvert OSM import (pass 1) with config.NETCONVERT_OSM_OPTIONS and vh.typ.xml;
  2. per-edge speeds (DIT S-D05 > OSM maxspeed > default; roundabout radius cap) and the car
     network's largest strongly connected component;
  3. netconvert pass 2: speed patch + removal of edges outside that component, written as the
     plain files (baseline.plain/) that scenario patches are applied to;
  4. baseline.net.xml built from the plain files exactly like a scenario with no patches;
  5. edge_attributes.csv, junctions.csv and build_report.json.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import tempfile
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

import sumolib

from vhsim.network import config
from vhsim.network.checks import boundary_uturns, drivable_edges
from vhsim.network.netconvert import run_netconvert, type_files
from vhsim.network.osmfilter import filter_osm
from vhsim.network.restrictions import banned_movements, violations
from vhsim.network.speeds import (choose_speed, load_dit_sections, match_section, ring_radius_m,
                                  roundabout_speed_kmh)

EDGE_COLUMNS = ["edge_id", "street_name", "speed_kmh", "lanes", "oneway", "speed_source", "lanes_source",
                "highway", "length_m", "legal_speed_kmh", "osm_maxspeed", "dit_section", "osm_way"]


def import_osm(osm: Path, out_net: Path, log: Path | None = None) -> str:
    """Pass 1: OSM -> SUMO net with the project's import options and type overrides."""
    return run_netconvert(["--osm-files", str(osm), "--type-files", type_files(),
                           *config.NETCONVERT_OSM_OPTIONS, "-o", str(out_net)], log)


@dataclass
class EdgeAttr:
    edge_id: str
    street_name: str
    speed_kmh: float
    lanes: int
    oneway: bool
    speed_source: str
    lanes_source: str
    highway: str
    length_m: float
    legal_speed_kmh: float
    osm_maxspeed: str
    dit_section: str
    osm_way: str


def _is_oneway(edge) -> bool:
    a, b = edge.getFromNode(), edge.getToNode()
    return not any(o.getToNode() is a for o in b.getOutgoing())


def edge_attributes(net, sections, keep: set[str]) -> list[EdgeAttr]:
    ring_radius: dict[str, float] = {}
    for rb in net.getRoundabouts():
        radius = ring_radius_m([net.getNode(n).getCoord() for n in rb.getNodes()])
        for e in rb.getEdges():
            ring_radius[e] = radius
    rows = []
    for e in net.getEdges():
        if e.getID() not in keep:
            continue
        params = e.getParams()
        highway = params.get("highway") or e.getType().replace("highway.", "")
        shape = e.getShape()
        dit = match_section(shape, e.getName(), highway, sections)
        legal, src = choose_speed(e.getType(), params.get("maxspeed"), dit)
        speed = float(legal)
        if e.getID() in ring_radius:
            capped = roundabout_speed_kmh(ring_radius[e.getID()], legal)
            if capped < legal:
                speed, src = capped, "roundabout"
        osm_lanes = any(k in params for k in ("lanes", "lanes:forward", "lanes:backward"))
        orig = e.getLanes()[0].getParam("origId") or ""
        rows.append(EdgeAttr(
            edge_id=e.getID(), street_name=e.getName() or "", speed_kmh=speed, lanes=e.getLaneNumber(),
            oneway=_is_oneway(e), speed_source=src, lanes_source="OSM" if osm_lanes else "default",
            highway=highway, length_m=round(e.getLength(), 1), legal_speed_kmh=float(legal),
            osm_maxspeed=params.get("maxspeed", ""), dit_section=dit.label if dit else "", osm_way=orig))
    return rows


def write_speed_patch(rows: list[EdgeAttr], path: Path) -> None:
    lines = ["<edges>"]
    for r in rows:
        lines.append(f'    <edge id="{r.edge_id}" speed="{r.speed_kmh / 3.6:.2f}"/>')
    lines.append("</edges>")
    path.write_text("\n".join(lines) + "\n")


def write_edge_attributes(rows: list[EdgeAttr], net, path: Path) -> None:
    """Rows for the edges present in the final net, with its lane counts and speeds.

    Edges added by the sourced fixes (vhsim/network/fixes/) carry their source in `osm_way`."""
    known = {r.edge_id for r in rows}
    extra = []
    for e in net.getEdges():
        if e.getID() not in known:
            sp = round(e.getSpeed() * 3.6, 1)
            extra.append(EdgeAttr(
                edge_id=e.getID(), street_name=e.getName() or "", speed_kmh=sp, lanes=e.getLaneNumber(),
                oneway=_is_oneway(e), speed_source="default", lanes_source="default",
                highway=e.getType().replace("highway.", ""), length_m=round(e.getLength(), 1),
                legal_speed_kmh=sp, osm_maxspeed="", dit_section="",
                osm_way=f"fix: {e.getParam('source') or 'vhsim/network/fixes'}"))
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(EDGE_COLUMNS)
        for r in sorted(rows + extra, key=lambda r: r.edge_id):
            if not net.hasEdge(r.edge_id):
                continue
            e = net.getEdge(r.edge_id)
            d = asdict(r)
            d["lanes"] = e.getLaneNumber()
            d["speed_kmh"] = round(e.getSpeed() * 3.6, 1)
            d["oneway"] = "yes" if r.oneway else "no"
            w.writerow([d[c] for c in EDGE_COLUMNS])


def fringe_nodes(net, bbox: tuple[float, float, float, float] | None = None) -> set[str]:
    """Nodes outside the extract bbox: where the extract's roads leave the modelled area."""
    south, west, north, east = bbox or config.active_extract().bbox
    out = set()
    for n in net.getNodes():
        lon, lat = net.convertXY2LonLat(*n.getCoord())
        if not (south <= lat <= north and west <= lon <= east):
            out.add(n.getID())
    return out


def _warning_summary(stderr: str) -> dict[str, int]:
    """Warning counts keyed by the first words of each message type."""
    def key(msg: str) -> str:
        return " ".join(re.sub(r"'[^']*'|\d+(\.\d+)?", "%", msg).split()[:6])

    single: Counter[str] = Counter()
    totals: dict[str, int] = {}
    for line in stderr.splitlines():
        if not line.startswith("Warning: "):
            continue
        m = re.match(r"Warning: (\d+) total messages of type: (.*)", line)
        if m:
            totals[key(m.group(2))] = int(m.group(1))
        else:
            single[key(line[9:])] += 1
    for k, v in totals.items():
        single[k] = v
    return dict(sorted(single.items()))


PLAIN_HEADER = ("<!-- Victor Harbor baseline (plain XML). Generated by `python -m vhsim.network.build` "
                "from S-E01 (OSM) and S-D05 (DIT speed limits); do not edit by hand, patch via vhsim.network.scenario. -->")


def normalise_plain(plain_dir: Path) -> None:
    """Replace netconvert's timestamped header (with temporary paths) by a fixed one; drop the .netccfg."""
    for p in Path(plain_dir).iterdir():
        if p.suffix != ".xml":
            p.unlink()
            continue
        text = p.read_text()
        text = re.sub(r"<!-- generated on .*?-->", PLAIN_HEADER, text, count=1, flags=re.S)
        p.write_text(text)


def network_stats(net) -> dict:
    edges = [e for e in net.getEdges() if not e.isSpecial()]
    km = sum(e.getLength() for e in edges) / 1000
    pairs = 0.0
    for e in edges:
        if not _is_oneway(e):
            pairs += e.getLength()
    centreline_km = km - pairs / 2 / 1000
    return {
        "edges": len(edges),
        "junctions": len(net.getNodes()),
        "roundabouts": len(net.getRoundabouts()),
        "lane_km": round(sum(e.getLength() * e.getLaneNumber() for e in edges) / 1000, 1),
        "directed_edge_km": round(km, 1),
        "road_km_centreline": round(centreline_km, 1),
        "traffic_lights": len(net.getTrafficLights()),
    }


def build(out_dir: Path = config.NETWORKS, dit: Path = config.DIT_STATE_ROADS, keep_work: bool = False,
          extract: config.Extract | None = None) -> dict:
    """Build everything into `out_dir` from the active OSM extract (S-S1-01 if fetched, else S-E01).

    Returns the build report (also written as JSON)."""
    from vhsim.network import junctions, places, scenario

    extract = extract or config.active_extract()
    osm = extract.path
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="vhsim-net-"))
    try:
        filtered = work / "filtered.osm"
        dropped = filter_osm(Path(osm), filtered)
        raw = work / "raw.net.xml"
        warn1 = import_osm(filtered, raw, log=work / "pass1.log")

        net = sumolib.net.readNet(str(raw))
        sections = load_dit_sections(Path(dit), net.convertLonLat2XY)
        fringe = fringe_nodes(net, extract.bbox)
        keep = drivable_edges(net, "passenger", fringe)
        removed = sorted(e.getID() for e in net.getEdges() if e.getID() not in keep)
        uturns = boundary_uturns(net, "passenger", fringe)
        rows = edge_attributes(net, sections, keep)
        patch = work / "speeds.edg.xml"
        write_speed_patch(rows, patch)
        (work / "remove.txt").write_text("\n".join(removed) + "\n")
        con_patch = work / "uturns.con.xml"
        banned, unresolved = banned_movements(Path(osm), net)
        lost = violations(net, banned)
        # lanes must be given or netconvert ignores the extra connection on a loaded net;
        # U-turns go from the median-side (highest-index) lane to the median-side lane
        con_patch.write_text("<connections>\n" + "".join(
            f'    <connection from="{a}" to="{b}" fromLane="{net.getEdge(a).getLaneNumber() - 1}" '
            f'toLane="{net.getEdge(b).getLaneNumber() - 1}"/>\n' for a, b in uturns) + "".join(
            f'    <delete from="{f}" to="{t}"/>  <!-- OSM restriction {rel} -->\n' for rel, f, t in lost)
            + "</connections>\n")

        plain_dir = out_dir / config.BASELINE_PLAIN_DIR.name
        if plain_dir.exists():
            shutil.rmtree(plain_dir)
        plain_dir.mkdir()
        warn2 = run_netconvert(["--sumo-net-file", str(raw),
                                "--edge-files", f"{patch},{config.FIXES_DIR / 'baseline.edg.xml'}",
                                "--connection-files", f"{con_patch},{config.FIXES_DIR / 'baseline.con.xml'}",
                                "--remove-edges.input-file", str(work / "remove.txt"),
                                *config.NETCONVERT_PATCH_OPTIONS,
                                "--plain-output-prefix", str(plain_dir / config.PLAIN_PREFIX),
                                "-o", str(work / "pass2.net.xml")], log=work / "pass2.log")
        normalise_plain(plain_dir)
        baseline = scenario.build("baseline", None, base_dir=plain_dir, out_dir=out_dir,
                                  log=work / "baseline.log")

        final = sumolib.net.readNet(str(baseline))
        write_edge_attributes(rows, final, out_dir / "edge_attributes.csv")
        jrows = junctions.write_junctions(baseline, out_dir / "junctions.csv")
        grows = places.write_gateway_edges(final, fringe_nodes(final, extract.bbox), out_dir / "gateway_edges.csv",
                                            places.gateways_for(extract.source_id))

        removed_named = Counter(net.getEdge(e).getName() or "(unnamed)" for e in removed)
        report = {
            "sources": {extract.source_id: extract.path.name, config.DIT_SOURCE_ID: config.DIT_STATE_ROADS.name},
            "extract_bbox": list(extract.bbox),
            "stats": network_stats(final),
            "osm_ways_dropped": dict(sorted(Counter(dropped.values()).items())),
            "edges_removed_outside_car_scc": len(removed),
            "boundary_uturns_added": [f"{a} -> {b}" for a, b in uturns],
            "osm_restrictions_mapped": len(banned),
            "osm_restrictions_unresolved": unresolved,
            "osm_restrictions_reapplied": [f"{rel}: {f} -> {t}" for rel, f, t in lost],
            "edges_removed_by_street": dict(sorted(removed_named.items())),
            "speed_source_counts": dict(sorted(Counter(r.speed_source for r in rows if final.hasEdge(r.edge_id)).items())),
            "lanes_source_counts": dict(sorted(Counter(r.lanes_source for r in rows if final.hasEdge(r.edge_id)).items())),
            "named_junctions": len(jrows),
            "named_junctions_not_found": [r["junction_id"] for r in jrows if r["control"] == "NOT_FOUND"],
            "gateways_unresolved": [r["gateway"] for r in grows if not (r["in_edge"] and r["out_edge"])],
            "netconvert_warnings_pass1": _warning_summary(warn1),
            "netconvert_warnings_pass2": _warning_summary(warn2),
        }
        (out_dir / "build_report.json").write_text(json.dumps(report, indent=2) + "\n")
        if keep_work:
            report["work_dir"] = str(work)
        return report
    finally:
        if not keep_work:
            shutil.rmtree(work, ignore_errors=True)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Build the baseline Victor Harbor SUMO network")
    ap.add_argument("--out-dir", type=Path, default=config.NETWORKS)
    ap.add_argument("--keep-work", action="store_true", help="keep the intermediate files and logs")
    a = ap.parse_args(argv)
    report = build(a.out_dir, keep_work=a.keep_work)
    print(json.dumps(report["stats"], indent=2))
    if a.keep_work:
        print("work dir:", report["work_dir"])


if __name__ == "__main__":
    main()
