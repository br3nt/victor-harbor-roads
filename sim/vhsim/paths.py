"""Single source of truth for project paths and SUMO binaries.

Archived research sources live in the MAIN checkout (some are git-ignored and absent
from worktrees), so SOURCES resolves to the main checkout unless VHSIM_SOURCES is set.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

SIM = Path(__file__).resolve().parents[1]          # .../sim
REPO = SIM.parent                                   # this checkout (may be a worktree)
MAIN_CHECKOUT = Path(os.environ.get("VHSIM_MAIN", "/Users/brent/Development/victor-traffic-simulation"))
SOURCES = Path(os.environ.get("VHSIM_SOURCES", MAIN_CHECKOUT / "sources"))
DATA = SIM / "data"


def sumo_home() -> Path:
    import sumo  # eclipse-sumo wheel

    return Path(sumo.SUMO_HOME)


def sumo_bin(name: str) -> str:
    """Path to a SUMO binary (sumo, netconvert, duarouter, netgenerate, ...)."""
    found = shutil.which(name)
    if found:
        return found
    candidate = sumo_home() / "bin" / name
    if candidate.exists():
        return str(candidate)
    raise FileNotFoundError(f"SUMO binary {name!r} not found; activate the project .venv")


def sumo_tool(relpath: str) -> Path:
    """Path to a SUMO python tool script, e.g. 'routeSampler.py'."""
    return sumo_home() / "tools" / relpath
