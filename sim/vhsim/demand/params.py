"""Fixed inputs of the demand model: file locations and the study area.

Every model PARAMETER (rates, shares, profiles, weights, splits, growth) lives in the config
file sim/data/demand/config/default.json (see vhsim.demand.config), each with value, unit,
basis and note. Only paths and the study-area geometry are here.
"""
from __future__ import annotations

from vhsim.paths import DATA, SIM, SOURCES

# ---------------------------------------------------------------- files
MB_COUNTS_CSV = SOURCES / "C" / "S-C30-victor-harbor-lga-mesh-blocks-2021.csv"      # S-C30
MB_POLYGONS = DATA / "zones" / "raw" / "S-S2-01-abs-asgs2021-mb-envelope.geojson"   # S-S2-01
LGA_POLYGON = DATA / "zones" / "raw" / "S-S2-02-abs-asgs2021-lga48050.geojson"      # S-S2-02
POI_GEOJSON = SOURCES / "E" / "S-E03-poi.geojson"                                  # S-E03
# S-S1-01 (S1's extract extended north to -35.46) when present, else the original S-E01.
OSM_NORTH = DATA / "networks" / "raw" / "S-S1-01-overpass-victor-harbor-north.osm"   # S-S1-01
OSM_SOUTH = SOURCES / "E" / "S-E01-overpass-victor-harbor.osm"                      # S-E01
OSM_EXTRACT = OSM_NORTH if OSM_NORTH.exists() else OSM_SOUTH
DIT_AADT_CSV = SOURCES / "D" / "D-tv-selected-roads-by-release.csv"               # S-D02
COUNTS_AADT_CSV = DATA / "counts" / "aadt.csv"                                     # S3 output
HOURLY_PROFILE_CSV = DATA / "profiles" / "hourly_profile.csv"                      # S3 output
ZONES_DIR = DATA / "zones"
DEMAND_DIR = DATA / "demand"
ASSUMPTIONS_MD = SIM / "assumptions" / "S2-demand.md"

# ---------------------------------------------------------------- study area
# The OSM extract's <bounds>: the network S1 builds cannot extend usefully beyond it.
# S-S1-01 reaches -35.46 (northern growth areas, Hutchinson Rd, Hindmarsh Tiers Rd); S-E01 stopped at -35.52.
NORTH_EXTENDED = OSM_EXTRACT == OSM_NORTH
STUDY_BBOX = (138.55, -35.60, 138.67, -35.46 if NORTH_EXTENDED else -35.52)   # lon_min, lat_min, lon_max, lat_max
# Gateways are placed this far inside the bbox (degrees) so they snap to an edge in the network.
GATEWAY_INSET_DEG = 0.002

CONDITIONS = ("weekday_term", "saturday", "summer_peak", "event_nye")
GROWTHS = ("base", "moderate", "high")
