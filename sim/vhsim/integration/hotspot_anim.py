"""Hotspot animations (S8): replay a batch run with FCD output over each hotspot, export compact JSON.

    python -m vhsim.integration.hotspot_anim plan                 # windows and replays (from the hotspot JSON)
    python -m vhsim.integration.hotspot_anim run [--workers 6]    # replay + export every planned animation

A replay is the batch run's own SUMO command (same network, routes, seed and behaviour settings, from the
first line of its sumo.log) with the batch outputs swapped for an FCD output restricted to the hotspots'
view squares (``--fcd-output.filter-shapes``) from the window start, ending at the window end. SUMO is
deterministic for a given seed and inputs, so the vehicles are the batch run's; the replay also writes a
tripinfo file and ``check_same`` compares arrivals with the batch run's.

Export (``viewer/hotspots/data/<hotspot>/<set>/<scenario>.json``): positions every second in a local
metre frame centred on the hotspot (x east, y north), quantised to ``QUANTUM`` m and delta-encoded per
track; a run of frames standing still is one ``(STOP, n)`` pair. Vehicle kind 0 car, 1 truck, 2 caravan,
3 bus; ``h`` = initial heading (degrees clockwise from north). ``queues`` = per frame, vehicles standing
still (speed < 0.1 m/s) on each listed approach's lanes. ``geometry`` = lanes (width, polyline) and
junction areas of that scenario's network inside the view, plus labels.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import re
import shlex
import subprocess
import xml.etree.ElementTree as ET
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from vhsim.integration import hotspot_defs as hd
from vhsim.integration import hotspots as hs
from vhsim.paths import DATA, REPO

QUANTUM = 0.5
STOP = 99999
KIND = {"car": 0, "truck": 1, "caravan": 2, "bus": 3}
M_PER_DEG_LAT = 110950.0
M_PER_DEG_LON_EQ = 111320.0
ANIM_OUT = REPO / "viewer" / "hotspots" / "data"
FCD_DIR = hs.CACHE / "fcd"
DROP_WITH_VALUE = {"--tripinfo-output", "--vehroute-output", "--vehroute-output.exit-times", "--statistic-output",
                   "-a", "--additional-files", "-e", "--end"}


# ---------------------------------------------------------------- replay
def replay_cmd(sumo_log: str, end: int, fcd: str, fcd_begin: int, shapes_add: str, shape_ids, tripinfo: str) -> list[str]:
    """The batch run's SUMO command (first line of its sumo.log) with FCD output instead of its outputs."""
    first = sumo_log.splitlines()[0]
    assert first.startswith("$ "), "sumo.log does not start with the command"
    args = shlex.split(first[2:])
    out, i = [args[0]], 1
    while i < len(args):
        a = args[i]
        if a in DROP_WITH_VALUE:
            i += 2
            continue
        out.append(a)
        i += 1
    out += ["-e", str(int(end)), "-a", str(shapes_add),
            "--fcd-output", str(fcd), "--fcd-output.geo", "true",
            "--fcd-output.filter-shapes", ",".join(shape_ids), "--device.fcd.begin", str(int(fcd_begin)),
            "--fcd-output.attributes", "x,y,angle,type,speed,lane",
            "--tripinfo-output", str(tripinfo)]
    return out


def m_per_deg_lon(lat: float) -> float:
    return M_PER_DEG_LON_EQ * math.cos(math.radians(lat))


def to_local(lon, lat, centre):
    return ((lon - centre[0]) * m_per_deg_lon(centre[1]), (lat - centre[1]) * M_PER_DEG_LAT)


def square_lonlat(centre, half: float) -> list[tuple[float, float]]:
    dx, dy = half / m_per_deg_lon(centre[1]), half / M_PER_DEG_LAT
    lo, la = centre
    return [(lo - dx, la - dy), (lo + dx, la - dy), (lo + dx, la + dy), (lo - dx, la + dy), (lo - dx, la - dy)]


def shapes_additional(path: Path, hotspot_ids) -> Path:
    polys = []
    for hid in hotspot_ids:
        v = hd.BY_ID[hid]["view"]
        sq = square_lonlat(v["centre"], v["half"] * 1.05)
        shape = " ".join(f"{x:.6f},{y:.6f}" for x, y in sq)
        polys.append(f'    <poly id="{hid}" type="hotspot" color="1,0,0" fill="0" geo="true" shape="{shape}"/>')
    path.write_text("<additional>\n" + "\n".join(polys) + "\n</additional>\n")
    return path


def check_same(orig_tripinfo: Path, replay_tripinfo: Path, t_from: float = 0.0) -> float:
    """Share of the replay's arrivals at or after ``t_from`` (the hour before the window) with the same arrival
    time and route length in the batch run."""
    def read(p, want=None):
        out = {}
        opener = gzip.open if str(p).endswith(".gz") else open
        with opener(p, "rb") as f:
            for _, el in ET.iterparse(f):
                if el.tag == "tripinfo":
                    i = el.get("id")
                    if (want is None and float(el.get("arrival")) >= t_from) or (want is not None and i in want):
                        out[i] = (el.get("arrival"), el.get("routeLength"))
                    el.clear()
        return out
    rep = read(replay_tripinfo)
    if not rep:
        return 0.0
    orig = read(orig_tripinfo, set(rep))
    return sum(orig.get(k) == v for k, v in rep.items()) / len(rep)


# ---------------------------------------------------------------- encoding
def encode_track(pts: list[tuple[int, int]]) -> list[int]:
    """[x0, y0, dx, dy, ...] with each run of >= 2 still frames as (STOP, n)."""
    if not pts:
        return []
    out = [pts[0][0], pts[0][1]]
    still = 0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x1 == x0 and y1 == y0:
            still += 1
            continue
        if still == 1:
            out += [0, 0]
        elif still > 1:
            out += [STOP, still]
        still = 0
        out += [x1 - x0, y1 - y0]
    if still == 1:
        out += [0, 0]
    elif still > 1:
        out += [STOP, still]
    return out


def decode_track(enc: list[int]) -> list[tuple[int, int]]:
    if not enc:
        return []
    x, y = enc[0], enc[1]
    pts = [(x, y)]
    for i in range(2, len(enc), 2):
        a, b = enc[i], enc[i + 1]
        if a == STOP:
            pts += [(x, y)] * b
        else:
            x, y = x + a, y + b
            pts.append((x, y))
    return pts


def split_on_gaps(samples):
    """samples: [(frame, ...)] sorted by frame -> lists of consecutive frames."""
    parts, cur = [], []
    for s in samples:
        if cur and s[0] != cur[-1][0] + 1:
            parts.append(cur)
            cur = []
        cur.append(s)
    if cur:
        parts.append(cur)
    return parts


def tracks_from_fcd(fcd: Path, view: dict, t0: int, t1: int, queue_lanes: dict[str, int] | None = None) -> dict:
    """Tracks of vehicles inside the view square during [t0, t1), and per-frame queue counts per approach."""
    centre, half = view["centre"], view["half"]
    frames = int(t1 - t0)
    queue_lanes = queue_lanes or {}
    nq = (max(queue_lanes.values()) + 1) if queue_lanes else 0
    queues = [[0] * frames for _ in range(nq)]
    by_veh: dict[str, list] = {}
    meta: dict[str, tuple] = {}
    t = None
    opener = gzip.open if str(fcd).endswith(".gz") else open
    with opener(fcd, "rb") as f:
        for ev, el in ET.iterparse(f, events=("start", "end")):
            if ev == "start" and el.tag == "timestep":
                t = float(el.get("time"))
            elif ev == "end" and el.tag == "vehicle":
                if t is not None and t0 <= t < t1:
                    x, y = to_local(float(el.get("x")), float(el.get("y")), centre)
                    if abs(x) <= half and abs(y) <= half:
                        fr = int(round(t - t0))
                        vid = el.get("id")
                        by_veh.setdefault(vid, []).append((fr, round(x / QUANTUM), round(y / QUANTUM),
                                                           float(el.get("angle", 0))))
                        meta.setdefault(vid, (KIND.get(el.get("type"), 0),))
                        q = queue_lanes.get(el.get("lane"))
                        if q is not None and float(el.get("speed", 1)) < 0.1:
                            queues[q][fr] += 1
                el.clear()
            elif ev == "end" and el.tag == "timestep":
                el.clear()
                if t is not None and t >= t1:
                    break
    tracks = []
    for vid, samples in by_veh.items():
        samples.sort()
        for part in split_on_gaps(samples):
            tracks.append(dict(k=meta[vid][0], f=part[0][0], h=int(round(part[0][3])) % 360,
                               p=encode_track([(s[1], s[2]) for s in part])))
    tracks.sort(key=lambda tr: tr["f"])
    return dict(t0=int(t0), frames=frames, dt=1, quantum=QUANTUM, tracks=tracks, queues=queues)


# ---------------------------------------------------------------- labels
ABBREV = [("Street", "St"), ("Road", "Rd"), ("Terrace", "Tce"), ("Parade", "Pde"), ("Avenue", "Ave"),
          ("Boulevard", "Blvd"), ("Drive", "Dr"), ("Lane", "Ln"), ("Place", "Pl"), ("Crescent", "Cres")]
STREET_WORD = re.compile(r"\b(St|Rd|Tce|Pde|Ave|Blvd|Dr|Ln|Pl|Cres)$")


def short_name(name: str) -> str:
    for long, short in ABBREV:
        if name.endswith(" " + long):
            return name[: -len(long)] + short
    return name


def street_labels(edges: dict, geo, centre, half: float, metres=None) -> list[tuple[str, float, float]]:
    """One label per named street in the view: the point on it nearest to half-way between the centre and
    the view's edge (so labels sit on the street, clear of the junction), as (short name, lon, lat)."""
    metres = metres or (lambda lon, lat: to_local(lon, lat, centre))
    best: dict[str, tuple] = {}
    for e in edges.values():
        if not e.get("name"):
            continue
        pts = e.get("shape") or [e["end"]]
        cand = list(pts) + [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(pts, pts[1:])]
        for pt in cand:
            lon, lat = geo.to_lonlat(*pt)
            x, y = metres(lon, lat)
            if abs(x) > 0.85 * half or abs(y) > 0.85 * half:
                continue
            score = abs(math.hypot(x, y) - 0.5 * half)
            if e["name"] not in best or score < best[e["name"]][0]:
                best[e["name"]] = (score, lon, lat)
    return [(short_name(n), lon, lat) for n, (sc, lon, lat) in sorted(best.items())]


def hotspot_labels(h: dict, edges: dict, geo) -> list[tuple[str, float, float]]:
    """Street labels from the network plus the hotspot's place labels (businesses, schools ...)."""
    v = h["view"]
    names = {edges[e]["name"] for e in hs.area_edges(edges, geo, h)} | set(h.get("key_streets", []))
    near = {eid: e for eid, e in edges.items() if e.get("name") in names and e["length"] > 15
            and all(abs(c) <= v["half"] for c in to_local(*geo.to_lonlat(*e["end"]), v["centre"]))}
    places = [tuple(lab) for lab in h.get("labels", ()) if not STREET_WORD.search(lab[0])]
    return street_labels(near, geo, v["centre"], v["half"]) + places


# ---------------------------------------------------------------- geometry
def geometry(net_path: Path, view: dict, labels=()) -> dict:
    """Lanes ([width, x0, y0, x1, y1, ...] quantised, internal lanes flagged) and junction polygons in the view."""
    geo = hs.NetGeo(net_path)
    centre, half = view["centre"], view["half"] * 1.15

    def loc(pt):
        lon, lat = geo.to_lonlat(*pt)
        x, y = to_local(lon, lat, centre)
        return x, y

    def inside(pts):
        return any(abs(x) <= half and abs(y) <= half for x, y in pts)

    lanes, junctions = [], []
    for _, el in ET.iterparse(str(net_path), events=("end",)):
        if el.tag == "edge":
            fn = el.get("function", "")
            if fn in ("crossing", "walkingarea"):
                el.clear()
                continue
            for ln in el.findall("lane"):
                pts = [loc(tuple(map(float, p.split(",")))) for p in ln.get("shape", "").split()]
                if len(pts) < 2 or not inside(pts):
                    continue
                if ln.get("allow") == "pedestrian":
                    continue
                w = float(ln.get("width", 3.2))
                flat = [v for x, y in pts for v in (round(x / QUANTUM), round(y / QUANTUM))]
                lanes.append([round(w, 1), 1 if fn == "internal" else 0] + flat)
            el.clear()
        elif el.tag == "junction":
            if el.get("type") != "internal" and el.get("shape"):
                pts = [loc(tuple(map(float, p.split(",")))) for p in el.get("shape").split()]
                if len(pts) >= 3 and inside(pts):
                    junctions.append([v for x, y in pts for v in (round(x / QUANTUM), round(y / QUANTUM))])
            el.clear()
    lab = []
    for text, lon, lat in labels:
        x, y = to_local(lon, lat, centre)
        lab.append([text, round(x / QUANTUM), round(y / QUANTUM)])
    return dict(lanes=lanes, junctions=junctions, labels=lab)


# ---------------------------------------------------------------- planning
def set_key(a: dict) -> str:
    return hd.period_key(a["condition"], a["year"], a["growth"])


def point_back(shape, dist: float):
    """The point ``dist`` metres back along a polyline from its end (its start if it is shorter)."""
    left = dist
    for (x0, y0), (x1, y1) in zip(reversed(shape[:-1]), reversed(shape[1:])):
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg >= left and seg > 0:
            f = left / seg
            return (x1 + (x0 - x1) * f, y1 + (y0 - y1) * f)
        left -= seg
    return tuple(shape[0])


def window_from_quarters(lanes: dict, edges: dict) -> tuple[int, str]:
    """Quarter-hour with most time stopped on the hotspot's edges, summed over the shown scenarios' seed-1
    runs (``lanes``: scenario -> lane_waits frame; ``edges``: scenario -> hotspot edge ids)."""
    tot = None
    for sc, df in lanes.items():
        q = df[df.edge.isin(edges[sc])].groupby("t").wait_s.sum()
        tot = q if tot is None else tot.add(q, fill_value=0)
    t = int(tot.idxmax())
    return t, f"busiest quarter-hour of the three runs shown together ({hhmm(t)}, seed 1)"


def window_seed1(h: dict, a: dict) -> tuple[int, str] | None:
    import pickle
    lanes, edges = {}, {}
    for sc in a["scenarios"]:
        p = hs.CACHE / f"{hs.net_for(sc)}__{set_key(a)}__s1.pkl"
        if not p.exists():
            continue
        with open(p, "rb") as f:
            lanes[sc] = pickle.load(f)["lanes"]
        _, member, _ = hs.memberships(sc)
        edges[sc] = {e for e, hids in member.items() if h["id"] in hids}
    return window_from_quarters(lanes, edges) if lanes else None


def choose_window(doc: dict, a: dict, h: dict | None = None) -> tuple[int, str]:
    """Start (s) of the 15 minutes shown: the busiest quarter-hour of the seed-1 runs shown (the animations
    are seed 1), else the peak quarter-hour of whichever shown scenario queues most (seed mean)."""
    if h is not None:
        w = window_seed1(h, a)
        if w:
            return w
    best = None
    for sc in a["scenarios"]:
        e = doc["results"].get(sc, {}).get(set_key(a), {})
        pk = e.get("peak15") or {}
        if pk.get("start") and (best is None or (pk.get("queue_veh") or 0) > best[0]):
            best = (pk.get("queue_veh") or 0, pk["start"], sc)
    if best is None:
        return 12 * 3600 + 900, "default 12:15"
    h, m = map(int, best[1].split(":"))
    return h * 3600 + m * 60, f"peak quarter-hour of {best[2]} ({best[1]})"


def plan() -> list[dict]:
    """Replays needed: one per (scenario, condition, year, growth), serving every hotspot that shows it."""
    jobs: dict[tuple, dict] = {}
    for h in hd.HOTSPOTS:
        p = hs.OUT / f"{h['id']}.json"
        if not p.exists() or not h["animate"]:
            continue
        doc = json.loads(p.read_text())
        for a in h["animate"]:
            start, why = choose_window(doc, a, h)
            for sc in a["scenarios"]:
                e = doc["results"].get(sc, {}).get(set_key(a), {})
                if e.get("jammed") or not e.get("seeds"):
                    continue
                key = (sc, a["condition"], a["year"], a["growth"])
                j = jobs.setdefault(key, dict(scenario=sc, condition=a["condition"], year=a["year"],
                                              growth=a["growth"], seed=1, windows=[]))
                j["windows"].append(dict(hotspot=h["id"], set=set_key(a), start=start, end=start + 900, why=why))
    return list(jobs.values())


def queue_approaches(h: dict, doc: dict, a: dict, scenario: str, groups: dict, member: dict, edges: dict,
                     limit: int = 5) -> list[dict]:
    """Approaches with a live queue counter: the ones queueing most in the window across the shown scenarios
    (matched by street + side), as present in this scenario's network."""
    score: dict[tuple, float] = {}
    for sc in a["scenarios"]:
        for ap in doc["results"].get(sc, {}).get(set_key(a), {}).get("approaches", []):
            if ap["street"] in ("roundabout", "access road"):
                continue
            k = (ap["street"], ap["from_side"])
            score[k] = max(score.get(k, 0), ap.get("peak15_queue_veh") or 0, (ap.get("worst15_queue_veh") or 0) * 0.5)
    chosen = [k for k, v in sorted(score.items(), key=lambda kv: -kv[1]) if v > 0][:limit]
    out = []
    for k in chosen:
        es = [e for e in member if h["id"] in member[e] and groups[e][h["id"]][:2] == k]
        if not es:
            continue
        lanes = [ln for e in es for ln in edges[e]["lanes"]]
        # counter placed at the stop line of the approach's busiest edge (the last in the list by length)
        e_main = max(es, key=lambda e: edges[e]["length"])
        back = min(25.0, 0.6 * edges[e_main]["length"])      # bubble on the approach, clear of the junction
        out.append(dict(street=k[0], from_side=k[1], label=f"{k[0]} from the {hs.SIDE.get(k[1], k[1])}",
                        edges=es, lanes=lanes, end=point_back(edges[e_main]["shape"], back)))
    return out


def replay_and_export(job: dict) -> dict:
    sc, c, y, g, seed = job["scenario"], job["condition"], job["year"], job["growth"], job["seed"]
    run = hs.RUNS / f"{hs.net_for(sc)}__{c}_{y}_{g}__s{seed}"
    FCD_DIR.mkdir(parents=True, exist_ok=True)
    tag = run.name
    fcd = FCD_DIR / f"{tag}.fcd.xml.gz"
    trip = FCD_DIR / f"{tag}.tripinfo.xml.gz"
    add = shapes_additional(FCD_DIR / f"{tag}.shapes.add.xml", sorted({w["hotspot"] for w in job["windows"]}))
    begin = min(w["start"] for w in job["windows"])
    end = max(w["end"] for w in job["windows"])
    info = dict(run=tag, begin=begin, end=end)
    cover = FCD_DIR / f"{tag}.window.json"     # written only after a complete replay
    have = json.loads(cover.read_text()) if (cover.exists() and fcd.exists()) else None
    if not have or have["begin"] > begin or have["end"] < end or not {w["hotspot"] for w in job["windows"]} <= set(have["hotspots"]):
        fcd.unlink(missing_ok=True)
        cover.unlink(missing_ok=True)
        cmd = replay_cmd((run / "sumo.log").read_text(), end, str(fcd), begin, str(add),
                         sorted({w["hotspot"] for w in job["windows"]}), str(trip))
        p = subprocess.run(cmd, capture_output=True, text=True)
        if p.returncode != 0:
            fcd.unlink(missing_ok=True)
            return {**info, "error": p.stderr[-800:]}
        cover.write_text(json.dumps(dict(begin=begin, end=end, hotspots=sorted({w["hotspot"] for w in job["windows"]}))))
    info["same_as_batch"] = round(check_same(run / "tripinfo.xml", trip, t_from=begin - 3600), 4)
    net = hs.NETWORKS / f"{hs.net_for(sc)}.net.xml"
    edges, member, groups = hs.memberships(sc)
    geo = hs.NetGeo(net)
    files = []
    for w in job["windows"]:
        h = hd.BY_ID[w["hotspot"]]
        doc = json.loads((hs.OUT / f"{h['id']}.json").read_text())
        a = next(a for a in h["animate"] if set_key(a) == w["set"])
        qa = queue_approaches(h, doc, a, sc, groups, member, edges)
        qlanes = {ln: i for i, q in enumerate(qa) for ln in q["lanes"]}
        tr = tracks_from_fcd(fcd, h["view"], w["start"], w["end"], qlanes)
        gm = geometry(net, h["view"], hotspot_labels(h, edges, geo))
        for q in qa:
            lon, lat = geo.to_lonlat(*q["end"])
            x, yy = to_local(lon, lat, h["view"]["centre"])
            q["xy"] = [round(x / QUANTUM), round(yy / QUANTUM)]
            del q["end"], q["lanes"]
        entry = doc["results"].get(sc, {}).get(w["set"], {})
        out = dict(v=1, hotspot=h["id"], title=h["short"], scenario=sc, label=hd.SCENARIO_LABEL[sc],
                   description=hd.SCENARIO_LONG[sc], condition=c, year=y, growth=g, seed=seed,
                   period_label=f"{hd.condition_label(c).capitalize()}, {hd.year_label(y, g)}",
                   window=dict(start=hhmm(w["start"]), end=hhmm(w["end"]), why=w["why"]),
                   view=dict(half=h["view"]["half"], centre=list(h["view"]["centre"])),
                   approaches=[{k: v for k, v in q.items() if k not in ("edges",)} for q in qa],
                   day=dict(stopped_veh_h=entry.get("stopped_veh_h"), seeds=len(entry.get("seeds", []))),
                   same_as_batch=info["same_as_batch"], geometry=gm, **tr)
        p = ANIM_OUT / h["id"] / w["set"] / f"{sc}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(out, separators=(",", ":")))
        files.append(dict(path=str(p.relative_to(REPO)), bytes=p.stat().st_size))
    return {**info, "files": files}


def hhmm(s: int) -> str:
    return hs.hhmm(s)


def shots_plan() -> Path:
    """viewer/hotspots/data/shots-plan.json for viewer/test/hotspot-shots.mjs: per hotspot and animated set (or
    the summer day now for hotspots without one), the view bounds, the quarter-hour shown and the pictures:
    congestion for today, the council package and the alternative, and the two difference maps."""
    items = []
    edges = hs.read_edges(hs.NETWORKS / "baseline_bays.net.xml")
    geo = hs.NetGeo(hs.NETWORKS / "baseline_bays.net.xml")
    for h in sorted(hd.HOTSPOTS, key=lambda h: h["order"]):
        p = hs.OUT / f"{h['id']}.json"
        if not p.exists():
            continue
        labels = [list(lab) for lab in hotspot_labels(h, edges, geo)]
        doc = json.loads(p.read_text())
        sets = h["animate"] or [{"condition": "summer_peak", "year": 2025, "growth": "base",
                                 "scenarios": ["baseline", "cp", h["roles"]["alternative"]]}]
        for a in sets:
            start, why = choose_window(doc, a, h)
            sq = square_lonlat(h["view"]["centre"], h["view"]["half"])
            bounds = [[min(x for x, _ in sq), min(y for _, y in sq)], [max(x for x, _ in sq), max(y for _, y in sq)]]
            today, *others = a["scenarios"]
            shots = [dict(name=f"{set_key(a)}__{sc}", a=sc) for sc in a["scenarios"]]
            shots += [dict(name=f"{set_key(a)}__diff_{sc}", a=today, b=sc) for sc in others]
            items.append(dict(id=h["id"], set=set_key(a), condition=a["condition"], year=a["year"], growth=a["growth"],
                              interval=start // 900, time=hhmm(start), why=why, bounds=bounds, shots=shots,
                              labels=labels))
    out = ANIM_OUT / "shots-plan.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dict(hotspots=items), indent=1))
    return out


def write_manifest() -> Path:
    """viewer/hotspots/data/manifest.json: hotspots, their sets and scenario files (for the player page)."""
    items = []
    for h in sorted(hd.HOTSPOTS, key=lambda h: h["order"]):
        sets = []
        for a in h["animate"]:
            sk = set_key(a)
            present = [sc for sc in a["scenarios"] if (ANIM_OUT / h["id"] / sk / f"{sc}.json").exists()]
            if present:
                sets.append(dict(key=sk, label=f"{hd.condition_label(a['condition']).capitalize()}, "
                                               f"{hd.year_label(a['year'], a['growth'])}",
                                 scenarios=[dict(id=sc, label=hd.SCENARIO_LABEL[sc],
                                                 file=f"data/{h['id']}/{sk}/{sc}.json") for sc in present]))
        doc_p = hs.OUT / f"{h['id']}.json"
        doc = json.loads(doc_p.read_text()) if doc_p.exists() else {}
        items.append(dict(id=h["id"], short=h["short"], title=h["title"], kind=h["kind"], why=h["why"],
                          junctions_used=h["junctions"], roles=h["roles"], no_fix=bool(h.get("no_fix")), sets=sets,
                          headlines=doc.get("headlines", []), chart=doc.get("chart"),
                          site_checks=doc.get("site_checks", []),
                          images=sorted(str(p.name) for p in (ANIM_OUT.parent / "img").glob(f"{h['id']}__*.png"))))
    p = ANIM_OUT / "manifest.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(dict(hotspots=items), indent=1, ensure_ascii=False))
    return p


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("plan")
    r = sub.add_parser("run")
    r.add_argument("--workers", type=int, default=6)
    r.add_argument("--only", nargs="*", help="scenario ids to replay (default all planned)")
    r.add_argument("--year", type=int, help="only replays of this demand year")
    sub.add_parser("manifest")
    sub.add_parser("shots")
    a = ap.parse_args(argv)
    if a.cmd == "shots":
        print(shots_plan())
        return
    jobs = plan()
    if a.cmd == "plan":
        print(json.dumps(jobs, indent=1))
        return
    if a.cmd == "manifest":
        print(write_manifest())
        return
    if a.only:
        jobs = [j for j in jobs if j["scenario"] in a.only]
    if a.year:
        jobs = [j for j in jobs if int(j["year"]) == a.year]
    with ProcessPoolExecutor(a.workers) as ex:
        futs = [ex.submit(replay_and_export, j) for j in jobs]
        for f in as_completed(futs):
            print(json.dumps(f.result()), flush=True)
    print(write_manifest())


if __name__ == "__main__":
    main()
