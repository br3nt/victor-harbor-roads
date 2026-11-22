"""Thin wrapper around the netconvert binary."""
from __future__ import annotations

import subprocess
from pathlib import Path

from vhsim.network import config
from vhsim.paths import sumo_bin, sumo_home


def type_files() -> str:
    """SUMO's OSM typemap followed by the Victor Harbor overrides (later definitions win)."""
    default = sumo_home() / "data" / "typemap" / "osmNetconvert.typ.xml"
    return f"{default},{config.TYPE_OVERRIDES}"


def run_netconvert(args: list[str], log: Path | None = None) -> str:
    """Run netconvert; returns its stderr (warnings). Raises on failure."""
    cmd = [sumo_bin("netconvert"), *args]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if log is not None:
        Path(log).write_text(" ".join(cmd) + "\n\n" + res.stdout + res.stderr)
    if res.returncode != 0:
        raise RuntimeError(f"netconvert failed ({res.returncode}):\n{res.stderr[-4000:]}")
    return res.stderr
