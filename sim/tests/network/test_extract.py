"""Supplementary OSM extract S-S1-01: query, registration and source selection (fast, offline)."""
import csv

import pytest

from vhsim.network import config
from vhsim.network.fetch_osm import make_query, osm_timestamp, register


def test_query_keeps_s_e01_filters_and_sets_the_northern_bbox():
    template = (config.OSM_FILE.parent / "query1.overpassql").read_text()
    q = make_query(template, (-35.60, 138.55, -35.46, 138.67))
    assert "[bbox:-35.60,138.55,-35.46,138.67]" in q
    assert q.replace("[bbox:-35.60,138.55,-35.46,138.67]", "") == template.replace(
        "[bbox:-35.60,138.55,-35.52,138.67]", "")


def test_query_needs_one_bbox():
    with pytest.raises(ValueError):
        make_query("way[highway];", (-35.6, 138.55, -35.46, 138.67))


def test_register_writes_a_sources_row(tmp_path):
    osm = tmp_path / "x.osm"
    osm.write_text('<?xml version="1.0"?><osm><meta osm_base="2026-11-21T03:00:00Z"/></osm>')
    q = tmp_path / "x.overpassql"
    q.write_text("q")
    tsv = tmp_path / "SOURCES.tsv"
    register(osm, q, tsv, "2026-11-21T14:00:00+10:30")
    register(osm, q, tsv, "2026-11-21T15:00:00+10:30")      # re-fetch replaces the row
    rows = list(csv.DictReader(open(tsv), delimiter="\t"))
    assert len(rows) == 1
    r = rows[0]
    assert r["id"] == "S-S1-01" and r["osm_data_timestamp"] == "2026-11-21T03:00:00Z"
    assert r["retrieved_at"] == "2026-11-21T15:00:00+10:30" and len(r["sha256"]) == 64
    assert osm_timestamp(osm) == "2026-11-21T03:00:00Z"


def test_build_uses_the_supplement_when_present(tmp_path, monkeypatch):
    sup = tmp_path / "sup.osm"
    monkeypatch.setattr(config, "OSM_SUPPLEMENT", sup)
    src = config.active_extract()
    assert (src.path, src.source_id, src.bbox) == (config.OSM_FILE, "S-E01", config.EXTRACT_BBOX)
    sup.write_text("<osm/>")
    src = config.active_extract()
    assert (src.path, src.source_id, src.bbox) == (sup, "S-S1-01", config.SUPPLEMENT_BBOX)
