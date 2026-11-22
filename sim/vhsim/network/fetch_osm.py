"""Fetch the supplementary OSM extract S-S1-01 (network extended north to -35.46).

    python -m vhsim.network.fetch_osm            # downloads from the Overpass API

Same tag filters as S-E01 (sources/E/query1.overpassql), bbox south -35.60, west 138.55,
north -35.46, east 138.67. Saves the extract, its query and a SOURCES.tsv row (id, url, query,
OSM data timestamp, retrieved_at, sha256) under sim/data/networks/raw/. The build uses this
extract instead of S-E01 when it is present (it contains S-E01's whole bbox).
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import re
import urllib.parse
import urllib.request
from pathlib import Path

from vhsim.network import config

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
SOURCES_COLUMNS = ["id", "title", "url", "query_file", "osm_data_timestamp", "retrieved_at", "sha256", "file"]


def make_query(template: str, bbox: tuple[float, float, float, float]) -> str:
    """S-E01's query with its [bbox:...] setting replaced (south, west, north, east)."""
    s, w, n, e = bbox
    new, count = re.subn(r"\[bbox:[^\]]*\]", f"[bbox:{s:.2f},{w:.2f},{n:.2f},{e:.2f}]", template)
    if count != 1:
        raise ValueError("query template must contain exactly one [bbox:...] setting")
    return new


def osm_timestamp(osm_path: Path) -> str:
    """The Overpass data timestamp (<meta osm_base=...>) of an extract."""
    with open(osm_path, encoding="utf-8") as f:
        head = f.read(4000)
    m = re.search(r'<meta[^>]*osm_base="([^"]+)"', head)
    return m.group(1) if m else ""


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def register(osm_path: Path, query_path: Path, sources_tsv: Path, retrieved_at: str,
             source_id: str = config.OSM_SUPPLEMENT_ID, url: str = OVERPASS_URL) -> dict:
    """Add (or replace) the extract's row in SOURCES.tsv."""
    row = {"id": source_id,
           "title": "OSM extract, Victor Harbor network extended north (bbox -35.60,138.55,-35.46,138.67)",
           "url": url, "query_file": query_path.name, "osm_data_timestamp": osm_timestamp(osm_path),
           "retrieved_at": retrieved_at, "sha256": sha256(osm_path), "file": osm_path.name}
    rows = []
    if sources_tsv.exists():
        with open(sources_tsv, newline="") as f:
            rows = [r for r in csv.DictReader(f, delimiter="\t") if r["id"] != source_id]
    rows.append(row)
    with open(sources_tsv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=SOURCES_COLUMNS, delimiter="\t")
        w.writeheader()
        w.writerows(rows)
    return row


def fetch(out_dir: Path = config.OSM_SUPPLEMENT.parent, bbox=config.SUPPLEMENT_BBOX) -> dict:
    template = (config.OSM_FILE.parent / "query1.overpassql").read_text()
    query = make_query(template, bbox)
    out_dir.mkdir(parents=True, exist_ok=True)
    query_path = out_dir / f"{config.OSM_SUPPLEMENT_ID}.overpassql"
    query_path.write_text(query)
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data, headers={"User-Agent": "vhsim-network-build"})
    osm_path = out_dir / config.OSM_SUPPLEMENT.name
    with urllib.request.urlopen(req, timeout=300) as resp, open(osm_path, "wb") as f:
        while chunk := resp.read(1 << 20):
            f.write(chunk)
    now = dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")
    return register(osm_path, query_path, out_dir / "SOURCES.tsv", now)


def main(argv: list[str] | None = None) -> None:
    argparse.ArgumentParser(description=__doc__.splitlines()[0]).parse_args(argv)
    print(fetch())


if __name__ == "__main__":
    main()
