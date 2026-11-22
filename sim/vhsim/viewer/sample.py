"""Build the viewer's sample data: a rough town-centre network, synthetic demand, a test variant.

    python -m vhsim.viewer.sample [--out sim/data/viewer/sample] [--work sim/data/runs/viewer-sample]

NOT RESULTS. The network is a quick netconvert of the Victor Harbor OSM extract (S-E01) clipped to the town
centre (no DIT speed limits, no S1 fixes); the demand is synthetic (shape of the S3 hourly profile, made-up
volumes and purposes); the "test_variant" (Victoria Street one-way, Esplanade 40 km/h) exists only to give
the before/after views a visible difference. Everything is marked ``synthetic`` in meta.json and in the UI.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
import sumolib

from vhsim.paths import DATA, SOURCES, sumo_bin
from vhsim.viewer.additional import viewer_additional
from vhsim.viewer.export import export, load_points, load_zones

BBOX = (138.598, -35.568, 138.640, -35.540)
CENTRE = (138.6215, -35.5525)         # Ocean St / Coral St area
BEGIN, END = 5 * 3600, 24 * 3600       # exported window (5 am to midnight)
NOTE = ("Sample data for testing the viewer: rough OSM conversion of town-centre streets, synthetic demand. "
        "Not simulation results.")

RUNS = [
    # scenario, network, condition, year, growth, demand factor
    ("baseline", "sample_baseline", "weekday_term", 2025, "base", 1.0),
    ("test_variant", "sample_variant", "weekday_term", 2025, "base", 1.0),
    ("baseline", "sample_baseline", "weekday_term", 2041, "high", 1.3),
    ("test_variant", "sample_variant", "weekday_term", 2041, "high", 1.3),
    ("baseline", "sample_baseline", "summer_peak", 2025, "base", 1.0),
]
SCENARIO_BOOKMARKS = {
    "weekday_term": ["08:30=School drop-off", "15:00=School pick-up"],
    "summer_peak": ["10:00=Beach traffic builds"],
}
DAILY_TRIPS = 15000


def build_baseline(work: Path) -> Path:
    net = work / "sample_baseline.net.xml"
    subprocess.run([sumo_bin("netconvert"), "--osm-files", str(SOURCES / "E/S-E01-overpass-victor-harbor.osm"),
                    "-o", str(net), "--geometry.remove", "--roundabouts.guess", "--ramps.guess", "--junctions.join",
                    "--tls.guess-signals", "false", "--tls.discard-simple", "--keep-edges.by-vclass", "passenger",
                    "--remove-edges.isolated", "--output.street-names",
                    "--keep-edges.in-geo-boundary", ",".join(map(str, BBOX)), "--keep-edges.components", "1",
                    "--lefthand", "--no-turnarounds.except-deadend", "--no-warnings"],
                   check=True, capture_output=True)
    return net


def build_variant(base: Path, work: Path) -> Path:
    """Victoria Street one-way (keep the north/east-bound edges), Esplanade 40 km/h."""
    net = sumolib.net.readNet(str(base))
    lines = []
    for e in net.getEdges():
        nm = e.getName()
        if nm == "Victoria Street":
            (x0, y0), (x1, y1) = e.getShape()[0], e.getShape()[-1]
            b = (math.degrees(math.atan2(x1 - x0, y1 - y0)) + 360) % 360
            if 135 <= b < 315:                           # south/west-bound half
                lines.append(f'<delete id="{e.getID()}"/>')
        elif nm == "Esplanade":
            lines.append(f'<edge id="{e.getID()}" speed="{40 / 3.6:.2f}"/>')
    patch = work / "variant.edg.xml"
    patch.write_text("<edges>\n" + "\n".join(lines) + "\n</edges>\n")
    out = work / "sample_variant.net.xml"
    subprocess.run([sumo_bin("netconvert"), "-s", str(base), "-e", str(patch), "-o", str(out), "--lefthand",
                    "--keep-edges.components", "1", "--no-warnings"], check=True, capture_output=True)
    return out


def _profile() -> np.ndarray:
    p = DATA / "profiles" / "hourly_profile.csv"
    if p.exists():
        with open(p) as fh:
            s = np.array([float(r["share"]) for r in csv.DictReader(fh)])
    else:   # double-peak placeholder
        s = np.array([.003, .002, .002, .002, .004, .01, .03, .06, .09, .07, .065, .07, .075, .07, .07, .08,
                      .085, .07, .045, .03, .025, .02, .012, .006])
    return s / s.sum()


def _usable_edges(base: Path, variant: Path):
    """Edges present in both nets, drivable by cars, in the variant's main strongly connected part."""
    vb = sumolib.net.readNet(str(variant))
    ids_b = {e.getID() for e in sumolib.net.readNet(str(base)).getEdges()}
    # strongly connected: reachable from and to a central edge
    edges = [e for e in vb.getEdges() if e.allows("passenger") and e.getID() in ids_b]
    centre_xy = vb.convertLonLat2XY(*CENTRE)
    seed = min(edges, key=lambda e: math.dist(e.getShape()[len(e.getShape()) // 2], centre_xy))

    def reach(start, forward=True):
        seen, stack = {start.getID()}, [start]
        while stack:
            e = stack.pop()
            nxt = e.getOutgoing() if forward else e.getIncoming()
            for f in nxt:
                if f.getID() not in seen and f.allows("passenger"):
                    seen.add(f.getID())
                    stack.append(f)
        return seen

    keep = reach(seed) & reach(seed, False)
    out = []
    for e in edges:
        if e.getID() not in keep or e.getLength() < 20:
            continue
        sh = e.getShape()
        lon, lat = vb.convertXY2LonLat(*sh[len(sh) // 2])
        out.append({"id": e.getID(), "type": e.getType(), "lon": lon, "lat": lat, "length": e.getLength(),
                    "from_deg": len(e.getFromNode().getIncoming()), "name": e.getName()})
    return out


def _near(edges, lon, lat, k=3):
    c = math.cos(math.radians(lat))
    return sorted(edges, key=lambda e: ((e["lon"] - lon) * c) ** 2 + (e["lat"] - lat) ** 2)[:k]


def make_trips(path: Path, edges, pois, condition: str, factor: float, seed: int) -> int:
    rng = np.random.default_rng(seed)
    prof = _profile()
    res = [e for e in edges if e["type"] == "highway.residential"]
    res_w = np.array([e["length"] for e in res])
    res_w /= res_w.sum()
    c = math.cos(math.radians(CENTRE[1]))
    centre = [e for e in edges if math.hypot((e["lon"] - CENTRE[0]) * c, e["lat"] - CENTRE[1]) * 111_320 < 450]
    gate = [e for e in edges if e["from_deg"] <= 1 and e["type"] in ("highway.trunk", "highway.primary",
                                                                      "highway.secondary")]
    beach = [e for e in edges if e["name"] in ("Esplanade", "Flinders Parade", "Coral Street")]
    schools = [p for p in pois if "school" in p.get("category", "")]
    shops = [p for p in pois if p.get("category", "").startswith(("supermarket", "shop", "food"))]

    def cell(e):
        return f"cell{int((e['lat'] - BBOX[1]) / 0.0054)}{int((e['lon'] - BBOX[0]) / 0.0066)}"

    trips = []

    def add(t, o, d, stratum, cat, poi):
        if o["id"] != d["id"]:
            trips.append((t, o, d, stratum, cat, poi))

    n = int(DAILY_TRIPS * factor)
    hours = rng.choice(24, size=n, p=prof)
    for h in hours:
        t = h * 3600 + rng.uniform(0, 3600)
        if t < BEGIN or t > END - 1800:
            continue
        r = rng.random()
        if r < 0.15 and len(gate) >= 2:
            a, b = rng.choice(len(gate), 2, replace=False)
            add(t, gate[a], gate[b], "thr", "through", "none")
            continue
        home = res[rng.choice(len(res), p=res_w)]
        go_out = rng.random() < (0.7 if h < 12 else 0.3)
        if condition == "summer_peak" and 9 <= h < 17 and rng.random() < 0.35:
            dest, cat, poi = beach[rng.integers(len(beach))], "beach_foreshore", "foreshore"
            stratum = "vis"
        elif shops and rng.random() < 0.4:
            p = shops[rng.integers(len(shops))]
            dest, cat, poi = _near(edges, p["lon"], p["lat"], 1)[0], "shops", p["poi_id"].replace("/", "_")
            stratum = "res"
        else:
            dest, cat, poi = centre[rng.integers(len(centre))], "work", "centre"
            stratum = "res"
        o, d = (home, dest) if go_out else (dest, home)
        add(t, o, d, stratum, cat, poi)
    if condition == "weekday_term" and schools:
        for p in schools:
            near = _near(edges, p["lon"], p["lat"], 3)
            for k in range(int(250 * factor)):
                home = res[rng.choice(len(res), p=res_w)]
                s = near[k % len(near)]
                pid = p["poi_id"].replace("/", "_")
                add(8 * 3600 + 15 * 60 + rng.uniform(0, 1800), home, s, "res", "school", pid)
                add(8 * 3600 + 35 * 60 + rng.uniform(0, 1500), s, home, "res", "school", pid)
                add(14 * 3600 + 50 * 60 + rng.uniform(0, 1200), home, s, "res", "school", pid)
                add(15 * 3600 + 5 * 60 + rng.uniform(0, 1200), s, home, "res", "school", pid)
    trips.sort(key=lambda x: x[0])
    body = []
    for i, (t, o, d, stratum, cat, poi) in enumerate(trips):
        vt = "truck" if rng.random() < 0.03 else "car"
        body.append(f'  <trip id="{stratum}~{cell(o)}~{cat}~{poi}~{i:06d}" depart="{t:.1f}" from="{o["id"]}" '
                    f'to="{d["id"]}" type="{vt}"/>')
    path.write_text('<routes>\n  <vType id="car" vClass="passenger"/>\n'
                    '  <vType id="truck" vClass="truck" length="9" maxSpeed="27"/>\n' + "\n".join(body) +
                    "\n</routes>\n")
    return len(trips)


def sample_zones() -> list[dict]:
    """Test zones: a 3 x 3 grid of cells over the clip (stand-in for S2 residential zones)."""
    zones = []
    w, s, e, n = BBOX
    for r in range(3):
        for c in range(3):
            x0, x1 = w + (e - w) * c / 3, w + (e - w) * (c + 1) / 3
            y0, y1 = s + (n - s) * r / 3, s + (n - s) * (r + 1) / 3
            zones.append({"zone_id": f"test_cell_{r}{c}", "name": f"Test cell {'SMN'[r]}{'WCE'[c]}",
                          "polygon": [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], "source": "synthetic"})
    return zones


def sample_places() -> tuple[list[dict], list[dict]]:
    """Places and zones inside the clip: S2's pois.geojson / residential_zones.geojson when present, else the
    S-E03 OSM places and a 3 x 3 grid of test cells."""
    w, s, e, n = BBOX
    inside = lambda lon, lat: w < lon < e and s < lat < n   # noqa: E731
    s2_pois, s2_zones = DATA / "zones" / "pois.geojson", DATA / "zones" / "residential_zones.geojson"
    if s2_pois.exists():
        pois = [p for p in load_points(s2_pois) if inside(p["lon"], p["lat"])]
    else:
        pois = [dict(p, source="S-E03") for p in load_points(SOURCES / "E/S-E03-poi.geojson")
                if p.get("name") and inside(p["lon"], p["lat"])]
    if s2_zones.exists():
        from shapely.geometry import shape

        zones = [z for z in load_zones(s2_zones) if inside(*shape(z["geometry"]).centroid.coords[0])]
    else:
        zones = sample_zones()
    return pois, zones


def main(argv=None):
    from vhsim.metrics.run import simulate

    ap = argparse.ArgumentParser(prog="python -m vhsim.viewer.sample", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(DATA / "viewer" / "sample"))
    ap.add_argument("--work", default=str(DATA / "runs" / "viewer-sample"))
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args(argv)
    out, work = Path(a.out), Path(a.work)
    work.mkdir(parents=True, exist_ok=True)
    if out.exists():
        shutil.rmtree(out)
    base = build_baseline(work)
    variant = build_variant(base, work)
    nets = {"sample_baseline": base, "sample_variant": variant}
    edges = _usable_edges(base, variant)
    pois, zones = sample_places()
    for scenario, netname, condition, year, growth, factor in RUNS:
        tag = f"{scenario}_{condition}_{year}_{growth}"
        rd = work / tag
        rd.mkdir(exist_ok=True)
        demand_seed = a.seed + (0 if condition == "weekday_term" else 1) + (0 if year == 2025 else 2)
        ntrips = make_trips(rd / "trips.xml", edges, pois, condition, factor, demand_seed)
        add = viewer_additional(rd / "viewer.add.xml")
        res = simulate(nets[netname], rd / "trips.xml", rd, seed=a.seed, begin=0, end=END + 3600, additional=add,
                       max_teleport_fraction=0.03)
        print(f"{tag}: {ntrips} trips, {res.summary}")
        export(nets[netname], [rd], out, scenario, condition, year, growth, seed=a.seed, network_name=netname,
               begin=BEGIN, end=END, bookmarks=SCENARIO_BOOKMARKS.get(condition, []), pois=pois, zones=zones,
               label=f"{'Baseline' if scenario == 'baseline' else 'Test variant'} · "
                     f"{condition.replace('_', ' ')} · {year} {growth}",
               notes=NOTE, synthetic=True)
    # the sample must not carry absolute paths of this machine
    for m in out.glob("runs/*/meta.json"):
        meta = json.loads(m.read_text())
        meta["sources"] = [Path(p).name for p in meta["sources"]]
        meta["created"] = "sample"
        m.write_text(json.dumps(meta, indent=1))
    total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"sample written to {out}: {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
