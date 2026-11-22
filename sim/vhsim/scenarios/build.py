"""Build scenario networks: patch over the baseline, then right-turn bays, then structural checks.

    python -m vhsim.scenarios.build c1a            # one scenario
    python -m vhsim.scenarios.build all --smoke    # every scenario, each with a 30-minute smoke run

Per scenario `<name>`:
  1. the definition (vhsim.scenarios.defs) is written as patch files to
     sim/data/networks/patches/<name>/ (committed, reviewable) with a summary in meta/summary.json;
  2. vhsim.network.scenario.build applies them over the baseline plain files (original OSM edge ids)
     -> <name>.net.xml and <name>.plain/ in sim/data/runs/s6_build/<name>/; movements netconvert guesses beyond the
     definition's are removed (one rebuild);
  3. traffic-light cycles are capped (actuation may shorten phases, never lengthen the cycle);
  4. vhsim.network.turn_bays adds right-turn bays -> sim/data/networks/<name>_bays.net.xml (the
     network scenario runs use);
  5. checks: drivable (strongly connected between gateways) for passenger and truck, roundabouts
     complete; optionally a smoke simulation.
"""
from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import sumolib

from vhsim.network import config, scenario, turn_bays
from vhsim.network.checks import check_roundabouts, drivable_edges
from vhsim.scenarios.defs import SCENARIOS, SIGNAL_CYCLE_S, Baseline, compose
from vhsim.scenarios.patch import Patch

PATCHES = config.NETWORKS / "patches"
WORK_ROOT = config.DATA / "runs" / "s6_build"
SMOKE_TRIPS = 750           # over 30 minutes (1,500/h, as the baseline town-centre smoke test)
SMOKE_END_S = 1800


def extra_movements(net, wanted: dict[str, set[str]]) -> tuple[set[tuple[str, str]], dict[str, set[str]]]:
    """(movements netconvert added beyond `wanted`, movements in `wanted` it did not build)."""
    extra, missing = set(), {}
    for f, ts in wanted.items():
        if not net.hasEdge(f):
            missing[f] = set(ts)
            continue
        have = {t.getID() for t in net.getEdge(f).getOutgoing()}
        extra |= {(f, t) for t in have - ts}
        if ts - have:
            missing[f] = ts - have
    return extra, missing


def cap_cycles(tll_path: Path, signals: set[str], cycle_s: int = SIGNAL_CYCLE_S) -> dict[str, int]:
    """Make each listed tlLogic's cycle <= cycle_s even at full actuation: green phases are scaled so
    the fixed cycle fits, and each phase's maxDur is set to its duration. Returns id -> cycle."""
    tree = ET.parse(tll_path)
    out = {}
    for tl in tree.getroot().iter("tlLogic"):
        if tl.get("id") not in signals:
            continue
        phases = list(tl.iter("phase"))
        flexible = [ph for ph in phases if ph.get("maxDur")]
        fixed = sum(float(ph.get("duration")) for ph in phases if not ph.get("maxDur"))
        green = sum(float(ph.get("duration")) for ph in flexible)
        if fixed + green > cycle_s and green > 0:
            k = (cycle_s - fixed) / green
            for ph in flexible:
                ph.set("duration", str(max(int(float(ph.get("duration")) * k), int(float(ph.get("minDur", 5))))))
        for ph in flexible:
            ph.set("maxDur", ph.get("duration"))
            if float(ph.get("minDur", 0)) > float(ph.get("duration")):
                ph.set("minDur", ph.get("duration"))
        out[tl.get("id")] = int(sum(float(ph.get("duration")) for ph in phases))
        if out[tl.get("id")] > cycle_s:
            raise ValueError(f"{tl.get('id')}: cycle {out[tl.get('id')]} s > {cycle_s} s after capping (minDur floors)")
    tree.write(tll_path, encoding="UTF-8", xml_declaration=True)
    return out


def summarise(base: Baseline, patch: Patch) -> dict:
    net = base.net

    def km(ids):
        return round(sum(net.getEdge(e).getLength() for e in ids if net.hasEdge(e)) / 1000, 3)

    speed = sorted(e for e, a in patch.edges.items() if "speed" in a and net.hasEdge(e))
    widened = sorted(e for e, a in patch.edges.items() if "numLanes" in a)
    rerouted = sorted(e for e, a in patch.edges.items() if ("from" in a or "to" in a) and net.hasEdge(e))
    added = sorted(e for e in patch.edges if not net.hasEdge(e))
    by_speed: dict[str, list[str]] = {}
    for e in speed:
        by_speed.setdefault(str(round(float(patch.edges[e]["speed"]) * 3.6)), []).append(e)
    return {
        "notes": patch.notes,
        "speed_changed": {k: {"edges": len(v), "directed_km": km(v),
                              "streets": sorted({net.getEdge(e).getName() or "(unnamed)" for e in v})}
                          for k, v in sorted(by_speed.items())},
        "removed": {"edges": len(patch.edge_deletes), "directed_km": km(patch.edge_deletes),
                    "ids": sorted(patch.edge_deletes)},
        "widened": {"edges": len(widened), "directed_km": km(widened)},
        "rerouted_to_new_node": {"edges": len(rerouted), "ids": rerouted},
        "added": {"edges": len(added), "ids": added},
        "new_signals": sorted(patch.signals),
        "junction_aliases": dict(sorted(patch.junction_aliases.items())),
        "edges_touched_directed_km": km(set(patch.edges) | patch.edge_deletes),
    }


def check_net(net_path: Path) -> dict:
    from vhsim.network.build import fringe_nodes

    net = sumolib.net.readNet(str(net_path), withPrograms=True)
    fringe = fringe_nodes(net)
    edges = {e.getID() for e in net.getEdges()}
    res = {"edges": len(edges), "traffic_lights": len(net.getTrafficLights())}
    for vc in ("passenger", "truck"):
        undrivable = sorted(edges - drivable_edges(net, vc, fringe))
        res[f"undrivable_{vc}"] = undrivable
    res["roundabout_problems"] = {",".join(c.nodes[:2]): c.problems for c in check_roundabouts(net_path) if c.problems}
    res["ok"] = not res["undrivable_passenger"] and not res["undrivable_truck"] and not res["roundabout_problems"]
    return res


def build_scenario(name: str, *, base: Baseline | None = None, out_dir: Path = config.NETWORKS,
                   patches_root: Path = PATCHES, work_root: Path | None = None, smoke: bool = False,
                   smoke_dir: Path | None = None) -> dict:
    """Build `<out_dir>/<name>_bays.net.xml`; intermediates (<name>.net.xml, <name>.plain/, logs)
    go to `<work_root>/<name>/` (default sim/data/runs/s6_build, git-ignored)."""
    base = base or Baseline()
    work = Path(work_root or WORK_ROOT) / name
    work.mkdir(parents=True, exist_ok=True)
    patch = compose(name, base)
    pdir = Path(patches_root) / name
    comment = f"S6 scenario {name} (sim/SCENARIOS.md; choices in sim/assumptions/S6-scenarios.md)."
    patch.write(pdir, comment)
    kw = dict(base_dir=base.plain_dir, prefix=base.prefix, out_dir=work, plain_output=True,
              extra_args=patch.netconvert_args, log=work / "netconvert.log")
    net_path = scenario.build(name, pdir, **kw)
    removed, missing = extra_movements(sumolib.net.readNet(str(net_path)), patch.movements)
    leftover: set[tuple[str, str]] = set()
    if removed:
        patch.con_deletes |= removed
        patch.write(pdir, comment)
        net_path = scenario.build(name, pdir, **kw)
        leftover, missing = extra_movements(sumolib.net.readNet(str(net_path)), patch.movements)
    plain = work / f"{name}.plain"
    cycles = cap_cycles(plain / f"{name}.tll.xml", patch.signals) if patch.signals else {}
    bays_net = Path(out_dir) / f"{name}_bays.net.xml"
    prefs = patch.write_preferences(Path(out_dir) / f"{name}_bays.prefs.add.xml")
    bays = turn_bays.build(plain_dir=plain, prefix=name, base_net=net_path, out_net=bays_net,
                           workdir=work / "bays")
    summary = {"scenario": name, "components": [c.__name__ for c in SCENARIOS[name]],
               **summarise(base, patch), "movements_missing": {k: sorted(v) for k, v in missing.items()},
               "movements_removed_after_guess": sorted(f"{f}->{t}" for f, t in removed),
               "movements_extra": sorted(f"{f}->{t}" for f, t in leftover),
               "signal_cycles_s": cycles, "turn_bays": bays["bays"],
               "net": f"sim/data/networks/{bays_net.name}"}
    if prefs:
        summary["routing_preferences"] = {"file": f"sim/data/networks/{prefs.name}",
                                          "preferences": [list(x) for x in patch.preferences]}
    summary["checks"] = check_net(bays_net)
    # a movement the definition does not allow (e.g. a lost turn ban), or one it needs but lacks, fails the build
    summary["checks"]["ok"] = summary["checks"]["ok"] and not leftover and not missing
    if smoke:
        from vhsim.network.smoke import run_smoke

        sdir = Path(smoke_dir or config.DATA / "runs" / "s6_smoke") / name
        res = run_smoke(bays_net, sdir, n_trips=SMOKE_TRIPS, seed=7, end=SMOKE_END_S, mode="town")
        summary["smoke"] = {k: v for k, v in res.items() if k != "teleport_events"}
    meta = pdir / "meta"
    meta.mkdir(exist_ok=True)
    stable = {k: v for k, v in summary.items() if k not in ("smoke",)}
    (meta / "summary.json").write_text(json.dumps(stable, indent=1, sort_keys=True) + "\n")
    return summary


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build S6 scenario networks (patch + turn bays + checks)")
    ap.add_argument("name", help=f"one of {', '.join(SCENARIOS)} or 'all'")
    ap.add_argument("--smoke", action="store_true", help="also run a 30-minute smoke simulation")
    a = ap.parse_args(argv)
    names = list(SCENARIOS) if a.name == "all" else [a.name]
    base = Baseline()
    ok = True
    for n in names:
        s = build_scenario(n, base=base, smoke=a.smoke)
        c = s["checks"]
        line = {"scenario": n, "ok": c["ok"], "edges": c["edges"], "tls": c["traffic_lights"],
                "removed": s["removed"]["edges"], "speed": {k: v["edges"] for k, v in s["speed_changed"].items()},
                "widened": s["widened"]["edges"], "missing_movements": len(s["movements_missing"])}
        if "smoke" in s:
            line["smoke"] = {k: s["smoke"][k] for k in ("inserted", "arrived", "teleports_total", "teleports_jam")}
        ok &= c["ok"] and not s["movements_missing"]
        print(json.dumps(line))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
