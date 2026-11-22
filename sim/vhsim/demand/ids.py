"""Vehicle-id contract shared with S3/S4 (see sim/DESIGN.md, "S2 demand").

    "{stratum}~{origin_zone}~{dest_category}~{dest_poi}~{seq}"

`~` replaced the original `|` because SUMO 1.28 rejects `|` in trip ids.

Conventions used by this package (documented in sim/assumptions/S2-demand.md):
- origin_zone is the trip's actual origin: a mesh-block code (``MB<code>``), a growth-area
  zone (``GA1_07``), a POI id (``poi_17``) for trips that start at a destination, or a
  gateway id (``gw_vhr``) for trips that enter from outside the study area.
- dest_category is a POI category, or ``home`` (return to a residential zone; dest_poi is
  the zone id), ``residential`` (visit to another residential zone), ``gateway`` (trip
  leaves the study area; dest_poi is the gateway id), or ``holiday_home`` / ``caravan_park`` /
  ``accommodation`` (a visitor returns to where they stay; dest_poi is the zone or POI id).
- Accessibility (R14) for residents: stratum ``res``, origin_zone a zone (``MB…``/``GA…``),
  dest_category a POI category, purpose not the NYE event. Visitors staying in holiday homes
  also start at ``MB…`` zones but carry stratum ``vis``.
"""
from __future__ import annotations

import re
from typing import NamedTuple

SEP = "~"
STRATA = ("res", "vis", "thr", "ext")
_FORBIDDEN = re.compile(r"[~|,;&<>\"'\\\s]")
_SEQ = re.compile(r"^\d{6,}$")


class TripId(NamedTuple):
    stratum: str
    origin_zone: str
    dest_category: str
    dest_poi: str
    seq: int


def _check_field(name: str, value: str) -> None:
    if not value:
        raise ValueError(f"empty id field {name!r}")
    if _FORBIDDEN.search(value):
        raise ValueError(f"id field {name}={value!r} contains a forbidden character")


def format_id(stratum: str, origin_zone: str, dest_category: str, dest_poi: str, seq: int) -> str:
    if stratum not in STRATA:
        raise ValueError(f"unknown stratum {stratum!r}")
    for name, value in (("origin_zone", origin_zone), ("dest_category", dest_category),
                        ("dest_poi", dest_poi)):
        _check_field(name, value)
    if seq < 0:
        raise ValueError("seq must be >= 0")
    return SEP.join((stratum, origin_zone, dest_category, dest_poi, f"{seq:06d}"))


def parse_id(vehicle_id: str) -> TripId:
    parts = vehicle_id.split(SEP)
    if len(parts) != 5:
        raise ValueError(f"expected 5 '{SEP}'-separated fields: {vehicle_id!r}")
    stratum, origin, cat, poi, seq = parts
    if stratum not in STRATA:
        raise ValueError(f"unknown stratum in {vehicle_id!r}")
    for name, value in (("origin_zone", origin), ("dest_category", cat), ("dest_poi", poi)):
        _check_field(name, value)
    if not _SEQ.match(seq):
        raise ValueError(f"seq must be at least 6 digits: {vehicle_id!r}")
    return TripId(stratum, origin, cat, poi, int(seq))
