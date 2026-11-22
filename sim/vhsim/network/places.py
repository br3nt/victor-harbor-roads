"""Gateways, suburb sample points and the town-centre point used to check connectivity.

Gateways are where the extract's roads leave the modelled area. Each resolves to an
inbound edge (starting at a fringe node) and an outbound edge (ending at one) of the named
road nearest the given point. The points are approximate positions read off the network;
they are not data and are listed in sim/assumptions/S1-network.md (A-S1-07).
"""
from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Gateway:
    gateway_id: str
    road: str            # OSM street name of the edges at the extract boundary
    lon: float
    lat: float
    note: str = ""


_SOUTH_AND_WEST = [
    Gateway("port_elliot_rd_east", "Port Elliot Road", 138.6705, -35.5318, "B37 to Port Elliot / Goolwa"),
    Gateway("inman_valley_rd_west", "Inman Valley Road", 138.5281, -35.5016, "B37 west (Inman Valley, Yankalilla)"),
    Gateway("waitpinga_rd_southwest", "Waitpinga Road", 138.4929, -35.6124, "Waitpinga / Newland Head"),
]

# Gateways of the S-E01 extract (north edge -35.52).
GATEWAYS_S_E01: list[Gateway] = [
    Gateway("victor_harbor_rd_north", "Victor Harbor Road", 138.6340, -35.5194,
            "A13 to Adelaide; S-E01 ends at the Waterport Rd junction"),
    Gateway("hindmarsh_tiers_rd", "Victor Harbor Road", 138.6340, -35.5194,
            "Hindmarsh Tiers Rd joins Victor Harbor Rd at about -35.4986, 138.6289 (S-D05), north of the "
            "S-E01 extract, so its traffic enters on the Victor Harbor Rd north gateway"),
    *_SOUTH_AND_WEST,
    Gateway("welch_rd_north", "Welch Road", 138.6231, -35.5199,
            "ring road: S-E01 stops ~north of Waggon Rd, before Welch Rd meets Victor Harbor Rd"),
    Gateway("greenhills_rd_north", "Greenhills Road", 138.5816, -35.5004, "Greenhills Rd to Hindmarsh Valley"),
    Gateway("waterport_rd_east", "Waterport Road", 138.6874, -35.5187, "Waterport Rd towards Hindmarsh Valley"),
]

# Gateways of the extended extract S-S1-01 (north edge -35.46). The two State roads cross the
# north edge where the DIT centrelines [S-D05] do; ways crossing the bbox come back whole, so
# the resolver takes the fringe edge of that name nearest the point.
GATEWAYS_S_S1_01: list[Gateway] = [
    Gateway("victor_harbor_rd_north", "Victor Harbor Road", 138.6459, -35.4600, "A13 to Adelaide"),
    Gateway("hindmarsh_tiers_rd", "Hindmarsh Tiers Road", 138.6056, -35.4600, "Hindmarsh Tiers Rd (04790) to Myponga"),
    *_SOUTH_AND_WEST,
    Gateway("greenhills_rd_north", "Greenhills Road", 138.5816, -35.4600, "Greenhills Rd to Hindmarsh Valley"),
    Gateway("waterport_rd_east", "Waterport Road", 138.6874, -35.5187, "Waterport Rd towards Hindmarsh Valley"),
]
REQUIRED_GATEWAYS = ["victor_harbor_rd_north", "hindmarsh_tiers_rd", "port_elliot_rd_east",
                     "inman_valley_rd_west", "waitpinga_rd_southwest"]


def gateways_for(source_id: str) -> list[Gateway]:
    return GATEWAYS_S_S1_01 if source_id == "S-S1-01" else GATEWAYS_S_E01


GATEWAYS = GATEWAYS_S_E01   # backwards-compatible default

# Town-centre point (Coral St between Torrens St and Ocean St) and one residential street per suburb.
TOWN_CENTRE = (138.6225, -35.5539)
SUBURB_POINTS: dict[str, tuple[float, float]] = {
    "Victor Harbor": (138.6150, -35.5470),      # James Avenue
    "Encounter Bay": (138.6000, -35.5730),      # Ridgeway Street
    "Hayborough": (138.6440, -35.5340),         # Sorrento Parade
    "McCracken": (138.6300, -35.5300),          # Coromandel Drive area
    "Hindmarsh Valley": (138.6400, -35.5230),   # Waterport Road (the suburb's part inside S-E01)
}

GATEWAY_COLUMNS = ["gateway", "road", "in_edge", "out_edge", "lon", "lat", "note"]


def _nearest(net, edges, lon, lat, end: str):
    """Edge whose `end` node ('from' or 'to') is closest to lon/lat."""
    x, y = net.convertLonLat2XY(lon, lat)

    def dist(e):
        cx, cy = (e.getFromNode() if end == "from" else e.getToNode()).getCoord()
        return math.hypot(cx - x, cy - y)
    return min(edges, key=dist) if edges else None


def resolve_gateways(net, fringe: set[str], gateways: list[Gateway] | None = None) -> list[dict]:
    if gateways is None:
        from vhsim.network.config import active_extract
        gateways = gateways_for(active_extract().source_id)
    rows = []
    for g in gateways:
        named = [e for e in net.getEdges() if e.getName() == g.road]
        ins = [e for e in named if e.getFromNode().getID() in fringe]
        outs = [e for e in named if e.getToNode().getID() in fringe]
        ein = _nearest(net, ins, g.lon, g.lat, "from")
        eout = _nearest(net, outs, g.lon, g.lat, "to")
        rows.append({"gateway": g.gateway_id, "road": g.road, "in_edge": ein.getID() if ein else "",
                     "out_edge": eout.getID() if eout else "", "lon": g.lon, "lat": g.lat, "note": g.note})
    return rows


def write_gateway_edges(net, fringe: set[str], path: Path, gateways: list[Gateway] | None = None) -> list[dict]:
    rows = resolve_gateways(net, fringe, gateways)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=GATEWAY_COLUMNS)
        w.writeheader()
        w.writerows(rows)
    return rows
