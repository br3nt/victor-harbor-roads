"""Run duarouter + sumo with the outputs the metrics layer needs."""
from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree as ET

from vhsim.paths import sumo_bin


class SimulationError(RuntimeError):
    """SUMO/duarouter failed, or the run is too broken (e.g. many teleports) to trust."""


@dataclass
class RunResult:
    paths: dict[str, Path]
    summary: dict[str, int | float]
    out_dir: Path = field(default=None)


def _run(cmd: list[str], log: Path) -> None:
    # VHSIM_SUMO_TIMEOUT (seconds, optional): a gridlocked run crawls for hours; give up and say so.
    limit = float(os.environ["VHSIM_SUMO_TIMEOUT"]) if os.environ.get("VHSIM_SUMO_TIMEOUT") else None
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=limit)
    except subprocess.TimeoutExpired:
        log.write_text(f"$ {' '.join(cmd)}\n--- gave up after {limit:g} s (VHSIM_SUMO_TIMEOUT): likely gridlock\n")
        raise SimulationError(f"{Path(cmd[0]).name} did not finish within {limit:g} s (likely gridlock); see {log}")
    log.write_text(f"$ {' '.join(cmd)}\n--- stdout\n{proc.stdout}\n--- stderr\n{proc.stderr}\n")
    if proc.returncode != 0:
        raise SimulationError(f"{Path(cmd[0]).name} failed (exit {proc.returncode}); see {log}\n{proc.stderr[-1500:]}")


def check_teleports(summary: dict, max_fraction: float = 0.01) -> None:
    """Raise SimulationError if teleports exceed ``max_fraction`` of inserted vehicles."""
    inserted = max(int(summary.get("inserted", 0)), 1)
    tp = int(summary.get("teleports", 0))
    if tp / inserted > max_fraction:
        raise SimulationError(
            f"{tp} teleports for {summary.get('inserted', 0)} inserted vehicles "
            f"({tp / inserted:.1%} > {max_fraction:.1%}): network is gridlocked or disconnected")


def read_statistic(path: Path) -> dict[str, int | float]:
    """Extract inserted / arrived / teleports / waiting from a sumo ``--statistic-output`` file."""
    root = ET.parse(path).getroot()
    veh = root.find("vehicles")
    trips = root.find("vehicleTripStatistics")
    tele = root.find("teleports")
    return {
        "loaded": int(veh.get("loaded", 0)) if veh is not None else 0,
        "inserted": int(veh.get("inserted", 0)) if veh is not None else 0,
        "running": int(veh.get("running", 0)) if veh is not None else 0,
        "waiting": int(veh.get("waiting", 0)) if veh is not None else 0,
        "arrived": int(trips.get("count", 0)) if trips is not None else 0,
        "teleports": int(tele.get("total", 0)) if tele is not None else 0,
    }


def simulate(net, trips, out_dir, seed: int = 1, begin: int = 0, end: int = 86400, additional=None,
             extra_args=(), max_teleport_fraction: float = 0.01, edgedata_period: int = 3600,
             time_to_teleport: int = 300, router_additional=None, router_args=()) -> RunResult:
    """Route ``trips`` on ``net`` with duarouter, then simulate with sumo.

    ``trips``: SUMO trip file with ``from``/``to`` edges or ``fromLonLat``/``toLonLat`` (the latter needs a
    geo-referenced net). Outputs in ``out_dir``: routes.rou.xml, tripinfo.xml, vehroute.xml (with exit
    times), statistic.xml, edgedata.xml, teleports.xml, plus the tool logs.

    Returns ``RunResult(paths, summary)``; ``summary`` has inserted, arrived, teleports, waiting (vehicles
    still waiting to be inserted at the end), running, loaded. Raises ``SimulationError`` if sumo fails or
    teleports exceed ``max_teleport_fraction`` of inserted vehicles.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    p = {k: out / v for k, v in dict(
        routes="routes.rou.xml", tripinfo="tripinfo.xml", vehroute="vehroute.xml", statistic="statistic.xml",
        edgedata="edgedata.xml", teleports="teleports.xml", edgedata_cfg="edgedata.add.xml",
        duarouter_log="duarouter.log", sumo_log="sumo.log").items()}
    _run([sumo_bin("duarouter"), "-n", str(net), "--route-files", str(trips), "-o", str(p["routes"]),
          "--seed", str(seed), "--ignore-errors", "false", "--no-warnings", "true",
          "--unsorted-input", "true", "--mapmatch.distance", "200", "--begin", str(begin), "--end", str(end),
          *(["--additional-files", str(router_additional)] if router_additional else []),
          *map(str, router_args)], p["duarouter_log"])
    p["edgedata_cfg"].write_text(
        '<additional><edgeData id="edgedata" file="edgedata.xml" period="%d" excludeEmpty="true"/></additional>'
        % edgedata_period)
    add = [str(p["edgedata_cfg"])] + ([str(additional)] if additional and not isinstance(additional, (list, tuple))
                                        else [str(a) for a in (additional or [])])
    cmd = [sumo_bin("sumo"), "-n", str(net), "-r", str(p["routes"]), "-a", ",".join(add),
           "--seed", str(seed), "-b", str(begin), "-e", str(end),
           "--tripinfo-output", str(p["tripinfo"]),
           "--vehroute-output", str(p["vehroute"]), "--vehroute-output.exit-times", "true",
           "--statistic-output", str(p["statistic"]),
           "--no-step-log", "true", "--duration-log.disable", "true",
           "--time-to-teleport", str(time_to_teleport), "--ignore-route-errors", "true",
           *map(str, extra_args)]
    _run(cmd, p["sumo_log"])
    # teleports are logged as warnings ("Teleporting vehicle 'id'; ..."): keep them in their own file
    lines = [ln for ln in p["sumo_log"].read_text().splitlines() if "Teleporting vehicle" in ln]
    p["teleports"].write_text("\n".join(lines) + ("\n" if lines else ""))
    summary = read_statistic(p["statistic"])
    routes_text = p["routes"].read_text()
    routed = routes_text.count("<vehicle ")
    if "<flow " not in routes_text and summary["loaded"] < routed:
        # SUMO silently drops departures it cannot load (out of order, invalid route)
        raise SimulationError(f"sumo loaded {summary['loaded']} of {routed} routed vehicles; see {p['sumo_log']}")
    summary["teleports"] = max(summary["teleports"], len(lines))
    check_teleports(summary, max_teleport_fraction)
    return RunResult(paths=p, summary=summary, out_dir=out)
