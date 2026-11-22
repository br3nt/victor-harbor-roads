"""Pre-filter the OSM extract before netconvert.

Drops OSM service ways that are not part of the public road network: private driveways,
car-park aisles, drive-throughs and service ways tagged access=private/no (assumption
A-S1-03). Everything else is copied unchanged; the source file is never modified.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from vhsim.network.config import DROP_ACCESS, DROP_SERVICE_TYPES


def drop_reason(tags: dict[str, str]) -> str | None:
    """Why a way is dropped, or None to keep it."""
    if tags.get("highway") != "service":
        return None
    service = tags.get("service")
    if service in DROP_SERVICE_TYPES:
        return f"service={service}"
    access = tags.get("access")
    if access in DROP_ACCESS:
        return f"service access={access}"
    return None


def filter_osm(src: Path, dst: Path) -> dict[str, str]:
    """Copy `src` to `dst` without the dropped ways. Returns {way_id: reason}."""
    tree = ET.parse(src)
    root = tree.getroot()
    dropped: dict[str, str] = {}
    for way in list(root.findall("way")):
        tags = {t.get("k"): t.get("v") for t in way.findall("tag")}
        reason = drop_reason(tags)
        if reason:
            dropped[way.get("id")] = reason
            root.remove(way)
    tree.write(dst, encoding="UTF-8", xml_declaration=True)
    return dropped
