"""Smoke simulation: random trips on a network, reporting teleports (deadlocks) by location.

    python -m vhsim.network.smoke [--net sim/data/networks/baseline.net.xml] [--trips 400] [--seed 42]

Random cars (90%) and trucks (10%) over one hour, origins/destinations weighted towards the
extract's fringe so that gateway roads and the town-centre roundabouts carry through traffic.
This is a structural check of the network, not a demand model.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

import sumolib

from vhsim.network import config
from vhsim.paths import sumo_bin, sumo_tool

TELEPORT_RE = re.compile(r"Teleporting vehicle '([^']+)'; ([^,]+), lane='([^']+)'")


def _random_trips(net: Path, out: Path, n: int, seed: int, vclass: str, prefix: str, end: int) -> None:
    period = end / max(1, n)
    subprocess.run([sys.executable, str(sumo_tool("randomTrips.py")), "-n", str(net), "-o", str(out),
                    "--seed", str(seed), "--begin", "0", "--end", str(end), "--period", f"{period:.3f}",
                    "--fringe-factor", "5", "--min-distance", "500", "--vehicle-class", vclass,
                    "--prefix", prefix, "--validate", "--route-file", str(out.with_suffix(".rou.xml"))],
                   check=True, capture_output=True, text=True)


def _ring_ids(net) -> tuple[set[str], set[str]]:
    edges, nodes = set(), set()
    for rb in net.getRoundabouts():
        edges |= set(rb.getEdges())
        nodes |= set(rb.getNodes())
    return edges, nodes


def _lane_location(lane: str, ring_edges: set[str], ring_nodes: set[str], net) -> tuple[str, bool]:
    edge = lane.rsplit("_", 1)[0]
    if edge.startswith(":"):
        node = edge[1:].rsplit("_", 1)[0]
        return node, node in ring_nodes
    if edge in ring_edges:
        return edge, True
    if net.hasEdge(edge):
        to_node = net.getEdge(edge).getToNode().getID()
        return edge, to_node in ring_nodes   # queued on a roundabout approach
    return edge, False


def _town_trips(net_path: Path, out: Path, n: int, seed: int, end: int, radius_m: float = 1200.0) -> None:
    """Trips concentrated on the town centre: half town<->town, half gateway<->town (10% trucks)."""
    import random

    from vhsim.network.build import fringe_nodes
    from vhsim.network.checks import largest_scc
    from vhsim.network.places import TOWN_CENTRE, resolve_gateways

    rng = random.Random(seed)
    net = sumolib.net.readNet(str(net_path))
    inner = largest_scc(net, "passenger")
    cx, cy = net.convertLonLat2XY(*TOWN_CENTRE)
    town = sorted(e.getID() for e in net.getEdges()
                  if e.getID() in inner and e.getType() != "highway.service" and e.getLength() > 15
                  and math.dist(_midpoint(e), (cx, cy)) <= radius_m)
    gws = [g for g in resolve_gateways(net, fringe_nodes(net)) if g["in_edge"] and g["out_edge"]]
    lines = ['<routes>', '  <vType id="car" vClass="passenger"/>', '  <vType id="truck" vClass="truck"/>']
    for i, t in enumerate(sorted(rng.uniform(0, end) for _ in range(n))):
        vt = "truck" if rng.random() < 0.1 else "car"
        if rng.random() < 0.5:
            a, b = rng.sample(town, 2)
        elif rng.random() < 0.5:
            a, b = rng.choice(gws)["in_edge"], rng.choice(town)
        else:
            a, b = rng.choice(town), rng.choice(gws)["out_edge"]
        lines.append(f'  <trip id="town{i}" type="{vt}" depart="{t:.1f}" from="{a}" to="{b}"/>')
    lines.append("</routes>")
    out.write_text("\n".join(lines) + "\n")


def _midpoint(edge) -> tuple[float, float]:
    shape = edge.getShape()
    return shape[len(shape) // 2]


def run_smoke(net_path: Path, out_dir: Path, n_trips: int = 400, seed: int = 42, end: int = 3600,
              mode: str = "random") -> dict:
    net_path, out_dir = Path(net_path), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cars = out_dir / "cars.trips.xml"
    trucks = out_dir / "trucks.trips.xml"
    n_trucks = max(1, n_trips // 10)
    if mode == "town":
        _town_trips(net_path, cars, n_trips, seed, end)
        trucks.write_text("<routes/>\n")
    else:
        _random_trips(net_path, cars, n_trips - n_trucks, seed, "passenger", "car", end)
        _random_trips(net_path, trucks, n_trucks, seed + 1, "truck", "truck", end)
    stats = out_dir / "stats.xml"
    log = out_dir / "sumo.log"
    subprocess.run([sumo_bin("sumo"), "-n", str(net_path), "-r", f"{cars},{trucks}", "--seed", str(seed),
                    "--statistic-output", str(stats), "--log", str(log), "--no-step-log", "true",
                    "--end", str(end * 3), "--time-to-teleport", "300"],
                   check=True, capture_output=True, text=True)
    root = ET.parse(stats).getroot()
    veh = root.find("vehicles")
    tel = root.find("teleports")
    net = sumolib.net.readNet(str(net_path))
    ring_edges, ring_nodes = _ring_ids(net)
    events = []
    for line in log.read_text().splitlines():
        m = TELEPORT_RE.search(line)
        if m:
            where, at_rb = _lane_location(m.group(3), ring_edges, ring_nodes, net)
            events.append({"vehicle": m.group(1), "reason": m.group(2), "lane": m.group(3),
                           "location": where, "at_roundabout": at_rb})
    jam = [e for e in events if "jam" in e["reason"]]
    return {
        "trips": n_trips, "seed": seed,
        "loaded": int(veh.get("loaded")), "inserted": int(veh.get("inserted")),
        "arrived": int(veh.get("inserted")) - int(veh.get("running")),   # nobody is left running at --end
        "teleports_total": int(tel.get("total")), "teleports_jam": int(tel.get("jam")),
        "teleports_yield": int(tel.get("yield")), "teleports_wrong_lane": int(tel.get("wrongLane")),
        "teleports_jam_at_roundabouts": sum(e["at_roundabout"] for e in jam),
        "teleport_locations": dict(Counter(e["location"] for e in events)),
        "teleport_events": events,
    }


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Smoke-run random trips on a network")
    ap.add_argument("--net", type=Path, default=config.BASELINE_NET)
    ap.add_argument("--trips", type=int, default=400)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--mode", choices=["random", "town"], default="random",
                    help="random: randomTrips over the whole net; town: trips focused on the town centre")
    ap.add_argument("--out-dir", type=Path, default=config.DATA / "runs" / "smoke")
    a = ap.parse_args(argv)
    res = run_smoke(a.net, a.out_dir, a.trips, a.seed, mode=a.mode)
    print(json.dumps({k: v for k, v in res.items() if k != "teleport_events"}, indent=2))


if __name__ == "__main__":
    main()
