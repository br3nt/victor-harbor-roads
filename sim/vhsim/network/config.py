"""Inputs, outputs and fixed choices for the S1 baseline network.

Every non-sourced choice here is listed in sim/assumptions/S1-network.md.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from vhsim.paths import DATA, SOURCES

OSM_SOURCE_ID = "S-E01"
OSM_FILE = SOURCES / "E" / "S-E01-overpass-victor-harbor.osm"
# Overpass query bbox of S-E01 (sources/E/query1.overpassql): south, west, north, east.
# Ways crossing it were returned whole, so nodes outside it are the ends of the extract.
EXTRACT_BBOX = (-35.60, 138.55, -35.52, 138.67)

# Supplementary extract extending the network north (growth areas, Hindmarsh Tiers Rd, the ring
# road's Welch Rd / Victor Harbor Rd end). Fetched by `python -m vhsim.network.fetch_osm`; when
# present the build uses it instead of S-E01 (its bbox contains S-E01's).
OSM_SUPPLEMENT_ID = "S-S1-01"
SUPPLEMENT_BBOX = (-35.60, 138.55, -35.46, 138.67)
OSM_SUPPLEMENT = DATA / "networks" / "raw" / "S-S1-01-overpass-victor-harbor-north.osm"


@dataclass(frozen=True)
class Extract:
    path: Path
    source_id: str
    bbox: tuple[float, float, float, float]


def active_extract() -> Extract:
    """The OSM extract the build uses: S-S1-01 if it has been fetched, else S-E01."""
    if OSM_SUPPLEMENT.exists():
        return Extract(OSM_SUPPLEMENT, OSM_SUPPLEMENT_ID, SUPPLEMENT_BBOX)
    return Extract(OSM_FILE, OSM_SOURCE_ID, EXTRACT_BBOX)

DIT_SOURCE_ID = "S-D05"
DIT_STATE_ROADS = SOURCES / "D" / "D-state-maintained-roads-vh-area.geojson"

NETWORKS = DATA / "networks"
BASELINE_NET = NETWORKS / "baseline.net.xml"
BASELINE_PLAIN_DIR = NETWORKS / "baseline.plain"
PLAIN_PREFIX = "baseline"

PACKAGE_DIR = Path(__file__).resolve().parent
TYPE_OVERRIDES = PACKAGE_DIR / "vh.typ.xml"
FIXES_DIR = PACKAGE_DIR / "fixes"       # sourced corrections to OSM applied in build pass 2

# Vehicle classes the model must carry (DESIGN.md S1).
VCLASSES = ("passenger", "truck", "trailer", "delivery", "bus")

# Speeds (km/h) when neither DIT (S-D05) nor OSM maxspeed gives one.
DEFAULT_SPEED_KMH = 50          # SA default urban limit (assumption A-S1-01)
SERVICE_SPEED_KMH = 20          # car-park / access lanes (assumption A-S1-02)

# OSM service ways dropped before import (assumption A-S1-03).
DROP_SERVICE_TYPES = {"driveway", "parking_aisle", "drive-through", "emergency_access"}
DROP_ACCESS = {"private", "no"}

# netconvert options for the OSM import (pass 1). Reasons in VALIDATION.md / assumptions.
NETCONVERT_OSM_OPTIONS = [
    "--lefthand", "true",                     # Australia drives on the left
    "--geometry.remove", "true",
    "--roundabouts.guess", "true",
    "--junctions.join", "true",
    "--tls.guess", "false",
    "--tls.guess-signals", "false",
    "--tls.discard-loaded", "true",           # the 3 OSM signal nodes are pedestrian crossings only
    "--osm.turn-lanes", "true",
    "--output.street-names", "true",
    "--output.original-names", "true",
    "--keep-edges.by-vclass", ",".join(VCLASSES),
    "--remove-edges.isolated", "true",
    "--osm.all-attributes", "true",
    "--osm.extra-attributes", "highway,maxspeed,lanes,lanes:forward,lanes:backward,oneway,ref,junction,service",
]

# Pass 2 (patch over the pass-1 net) and scenario builds.
NETCONVERT_PATCH_OPTIONS = [
    "--lefthand", "true",
]
