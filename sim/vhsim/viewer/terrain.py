"""Terrain (elevation) tiles for the viewer map: 512-px terrarium PNGs for MapLibre ``raster-dem``.

    python -m vhsim.viewer.terrain [--out viewer/basemap/terrain] [--cache sim/data/terrain-raw]
                                   [--manifest viewer/basemap/terrain-sources.json]

Run from ``sim/``. Source: AWS Open Data "Terrain Tiles" (Mapzen / Tilezen Joerd), terrarium encoding,
``https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`` (256 px,
elevation m = R*256 + G + B/256 - 32768). Each output tile z/x/y is 512 px: a 2x2 mosaic of the four 256-px
source tiles at z+1, so it covers exactly the extent of the standard XYZ tile z/x/y. Elevations below 0 (sea
floor, from ETOPO1 bathymetry) become 0, and all values are rounded to 1/8 m before writing (smaller PNGs; 1/8 m
is far below what a hillshade can show). Raw downloads are cached (git-ignored) and each one's URL, retrieval
time and sha256 go in the manifest. See ``viewer/basemap/SOURCES.md`` for licences and attribution.

Output: ``<out>/{z}/{x}/{y}.png`` and ``<out>/tiles.json``
``{"encoding":"terrarium","tileSize":512,"minzoom","maxzoom","tiles":["z/x/y",...],"bounds":[w,s,e,n],
"attribution"}``. ``sample_elevation`` reads those tiles back (used by ``basemap.py`` for label heights).
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import math
import urllib.request
from pathlib import Path
from typing import Callable

import numpy as np

from vhsim.paths import REPO, SIM
from vhsim.viewer.png import decode_png, encode_png

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
OSM_BBOX = (138.57, -35.598, 138.66, -35.53)                       # G-01 extract (w, s, e, n)
NETWORK_BBOX = (138.208437, -35.61237, 138.693057, -35.426237)      # simulated road network
PLAN = [(12, OSM_BBOX), (11, NETWORK_BBOX), (10, NETWORK_BBOX)]    # (zoom of the 512 tile, area)
QUANTUM = 1 / 8
ATTRIBUTION = (
    '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Terrain Tiles</a> '
    "(Mapzen/Tilezen, AWS Open Data): Australia terrain data © Commonwealth of Australia "
    "(Geoscience Australia) 2017, CC BY 4.0; SRTM and GMTED2010 terrain data courtesy of the U.S. Geological "
    "Survey; ETOPO1: U.S. National Oceanic and Atmospheric Administration"
)

Fetch = Callable[[int, int, int], bytes]


# ---- terrarium encoding --------------------------------------------------------------------------------------

def terrarium_decode(rgb: np.ndarray) -> np.ndarray:
    rgb = rgb.astype(np.float64)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def terrarium_encode(elev: np.ndarray) -> np.ndarray:
    v = np.asarray(elev, dtype=np.float64) + 32768
    v = np.clip(v, 0, 65536 - 1 / 256)
    whole = np.floor(v)
    r = np.floor(whole / 256)
    g = whole - r * 256
    b = np.round((v - whole) * 256)
    carry = b >= 256              # rounding up into the next metre
    b[carry] = 0
    g[carry] += 1
    r[g >= 256] += 1
    g[g >= 256] = 0
    return np.stack([r, g, b], axis=-1).astype(np.uint8)


def prepare(elev: np.ndarray) -> np.ndarray:
    """Sea floor to 0, then round to 1/8 m."""
    e = np.maximum(np.asarray(elev, dtype=np.float64), 0.0)
    return np.round(e / QUANTUM) * QUANTUM + 0.0   # + 0.0 turns -0.0 into 0.0


# ---- tile maths (Web Mercator XYZ) ---------------------------------------------------------------------------

def _merc(lon: float, lat: float) -> tuple[float, float]:
    """Fractional position in the world square, 0..1 (x east, y south)."""
    x = (lon + 180.0) / 360.0
    s = math.radians(lat)
    y = (1.0 - math.log(math.tan(s) + 1.0 / math.cos(s)) / math.pi) / 2.0
    return x, y


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    x, y = _merc(lon, lat)
    n = 2 ** z
    return int(math.floor(x * n)), int(math.floor(y * n))


def _unmerc(x: float, y: float) -> tuple[float, float]:
    lon = x * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y))))
    return lon, lat


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    w, nlat = _unmerc(x / n, y / n)
    e, slat = _unmerc((x + 1) / n, (y + 1) / n)
    return w, slat, e, nlat


def pixel_to_lonlat(z: int, x: int, y: int, px: float, py: float, size: int = 512) -> tuple[float, float]:
    n = 2 ** z
    return _unmerc((x + px / size) / n, (y + py / size) / n)


def tiles_covering(bbox, z: int) -> list[tuple[int, int]]:
    w, s, e, n = bbox
    x0, y0 = lonlat_to_tile(w, n, z)
    x1, y1 = lonlat_to_tile(e, s, z)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


# ---- building tiles ------------------------------------------------------------------------------------------

def mosaic(z: int, x: int, y: int, fetch: Fetch) -> np.ndarray:
    """512 x 512 elevation array for tile z/x/y from its four 256-px children at z+1 (raw, not prepared)."""
    out = np.zeros((512, 512))
    for dy in (0, 1):
        for dx in (0, 1):
            img = decode_png(fetch(z + 1, 2 * x + dx, 2 * y + dy))
            if img.shape[:2] != (256, 256):
                raise ValueError(f"source tile {z + 1}/{2 * x + dx}/{2 * y + dy} is not 256 px")
            out[dy * 256:(dy + 1) * 256, dx * 256:(dx + 1) * 256] = terrarium_decode(img)
    return out


def build(out: Path, fetch: Fetch, plan=PLAN, stats: dict | None = None) -> dict:
    """Write every tile in ``plan`` and tiles.json. ``stats`` (optional) gets {"z/x/y": (source min, written max)}."""
    out = Path(out)
    names = []
    stats = {} if stats is None else stats
    bw = bs = math.inf
    be = bn = -math.inf
    for z, bbox in plan:
        for x, y in tiles_covering(bbox, z):
            raw = mosaic(z, x, y, fetch)
            elev = prepare(raw)
            p = out / str(z) / str(x) / f"{y}.png"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(encode_png(terrarium_encode(elev)))
            name = f"{z}/{x}/{y}"
            names.append(name)
            stats[name] = (float(raw.min()), float(elev.max()))
            w, s, e, n = tile_bounds(z, x, y)
            bw, bs, be, bn = min(bw, w), min(bs, s), max(be, e), max(bn, n)
    zooms = [z for z, _ in plan]
    info = {"encoding": "terrarium", "tileSize": 512, "minzoom": min(zooms), "maxzoom": max(zooms),
            "tiles": sorted(names, key=lambda t: tuple(int(v) for v in t.split("/"))),
            "bounds": [round(bw, 6), round(bs, 6), round(be, 6), round(bn, 6)],
            "attribution": ATTRIBUTION}
    (out / "tiles.json").write_text(json.dumps(info, indent=1, ensure_ascii=False) + "\n")
    return info


# ---- downloads with a cache ----------------------------------------------------------------------------------

def _http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "vhsim-terrain/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def cached_fetcher(cache: Path, manifest: Path, download: Callable[[str], bytes] = _http_get) -> Fetch:
    cache, manifest = Path(cache), Path(manifest)
    data = json.loads(manifest.read_text()) if manifest.exists() else {}
    data.setdefault("source", URL)
    data.setdefault("tiles", {})

    def fetch(z: int, x: int, y: int) -> bytes:
        key = f"{z}/{x}/{y}"
        p = cache / str(z) / str(x) / f"{y}.png"
        if p.exists():
            body = p.read_bytes()
            if key not in data["tiles"]:   # cached before a manifest existed: record what we have
                data["tiles"][key] = {"url": URL.format(z=z, x=x, y=y), "retrieved": None,
                                      "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
                _save()
            return body
        url = URL.format(z=z, x=x, y=y)
        body = download(url)
        decode_png(body)  # refuse anything that is not a readable PNG before caching it
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".part")
        tmp.write_bytes(body)
        tmp.replace(p)  # atomic: a crash never leaves a truncated tile in the cache
        when = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        data["tiles"][key] = {"url": url, "retrieved": when, "sha256": hashlib.sha256(body).hexdigest(),
                              "bytes": len(body)}
        _save()
        return body

    def _save():
        manifest.parent.mkdir(parents=True, exist_ok=True)
        ordered = dict(sorted(data["tiles"].items(), key=lambda kv: tuple(int(v) for v in kv[0].split("/"))))
        manifest.write_text(json.dumps({**data, "tiles": ordered}, indent=1) + "\n")

    return fetch


# ---- reading the written tiles back --------------------------------------------------------------------------

def sample_elevation(tiles_dir: Path, lon: float, lat: float, z: int = 12, mode: str = "bilinear") -> float | None:
    """Elevation (m) at lon/lat from the written 512-px tiles at zoom ``z``. ``mode="max"`` returns the highest
    of the four pixels around the point (for summits, which a 15 m grid flattens). None if no tile covers it."""
    tiles_dir = Path(tiles_dir)
    mx, my = _merc(lon, lat)
    size = 512 * 2 ** z
    fx, fy = mx * size - 0.5, my * size - 0.5
    i0, j0 = math.floor(fx), math.floor(fy)
    tx, ty = fx - i0, fy - j0
    cache: dict = {}

    def px(i, j):
        key = (i // 512, j // 512)
        if key not in cache:
            p = tiles_dir / str(z) / str(key[0]) / f"{key[1]}.png"
            cache[key] = terrarium_decode(decode_png(p.read_bytes())) if p.exists() else None
        t = cache[key]
        return None if t is None else float(t[j % 512, i % 512])

    pts = [(px(i0, j0), (1 - tx) * (1 - ty)), (px(i0 + 1, j0), tx * (1 - ty)),
           (px(i0, j0 + 1), (1 - tx) * ty), (px(i0 + 1, j0 + 1), tx * ty)]
    pts = [(v, w) for v, w in pts if v is not None]
    if not pts:
        return None
    if mode == "max":
        return max(v for v, _ in pts)
    wsum = sum(w for _, w in pts)
    if wsum <= 0:
        return pts[0][0]
    return sum(v * w for v, w in pts) / wsum


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=REPO / "viewer" / "basemap" / "terrain")
    ap.add_argument("--cache", type=Path, default=SIM / "data" / "terrain-raw")
    ap.add_argument("--manifest", type=Path, default=REPO / "viewer" / "basemap" / "terrain-sources.json")
    a = ap.parse_args(argv)
    stats: dict = {}
    info = build(a.out, cached_fetcher(a.cache, a.manifest), stats=stats)
    total = sum((a.out / f"{t}.png").stat().st_size for t in info["tiles"])
    for t in info["tiles"]:
        lo, hi = stats[t]
        print(f"{t}: source min {lo:.1f} m, written max {hi:.1f} m, {(a.out / f'{t}.png').stat().st_size} bytes")
    print(f"{len(info['tiles'])} tiles, {total} bytes, bounds {info['bounds']}")


if __name__ == "__main__":
    main()
