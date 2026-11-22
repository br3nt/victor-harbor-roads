import json

import numpy as np
import pytest

from vhsim.viewer import terrain as T
from vhsim.viewer.png import decode_png, encode_png


def _const_tile(elev: float, size: int = 256) -> bytes:
    return encode_png(T.terrarium_encode(np.full((size, size), elev)))


def test_terrarium_maths():
    rgb = np.array([[[128, 0, 0], [128, 100, 128], [127, 255, 0], [0, 0, 0]]], dtype=np.uint8)
    assert T.terrarium_decode(rgb).tolist() == [[0.0, 100.5, -1.0, -32768.0]]
    e = np.array([[0.0, 100.5, 1234.875, 7.125]])
    assert (T.terrarium_decode(T.terrarium_encode(e)) == e).all()
    assert T.terrarium_encode(np.array([[100.5]])).tolist() == [[[128, 100, 128]]]
    # fractions that round up into the next metre carry into G and R
    assert T.terrarium_encode(np.array([[255.999]])).tolist() == [[[129, 0, 0]]]


def test_prepare_clamps_the_sea_floor_and_quantises_to_an_eighth_of_a_metre():
    e = np.array([[-12.3, -0.01, 1.06, 1.07, 55.4999]])
    assert T.prepare(e).tolist() == [[0.0, 0.0, 1.0, 1.125, 55.5]]


def test_tile_maths():
    assert T.lonlat_to_tile(0.0, 0.0, 1) == (1, 1)
    assert T.lonlat_to_tile(138.6175, -35.553, 12) == (3625, 2481)
    w, s, e, n = T.tile_bounds(12, 3625, 2481)
    assert w <= 138.6175 <= e and s <= -35.553 <= n
    assert e - w == pytest.approx(360 / 4096)
    tiles = T.tiles_covering((138.57, -35.598, 138.66, -35.53), 12)
    assert (3625, 2481) in tiles
    assert tiles == sorted(tiles) and len(tiles) == len(set(tiles))
    for x, y in tiles:  # every tile touches the box
        w, s, e, n = T.tile_bounds(12, x, y)
        assert w < 138.66 and e > 138.57 and s < -35.53 and n > -35.598


def test_mosaic_puts_the_four_children_in_the_right_quadrants():
    vals = {(0, 0): 10.0, (1, 0): 20.0, (0, 1): 30.0, (1, 1): -5.0}

    def fetch(z, x, y):
        assert z == 13
        return _const_tile(vals[(x - 2 * 100, y - 2 * 200)])

    e = T.mosaic(12, 100, 200, fetch)
    assert e.shape == (512, 512)
    assert e[0, 0] == 10 and e[0, 511] == 20 and e[511, 0] == 30 and e[511, 511] == -5
    assert e[255, 255] == 10 and e[256, 256] == -5


def _fake_fetch(z, x, y):
    # elevation rises west -> east within each 256 tile; the sea (negative) on the left quarter
    col = np.linspace(-40, 200, 256)
    return encode_png(T.terrarium_encode(np.tile(col, (256, 1))))


def test_build_writes_512px_tiles_and_a_tile_index(tmp_path):
    plan = [(12, (138.60, -35.56, 138.61, -35.55)), (11, (138.60, -35.56, 138.61, -35.55))]
    info = T.build(tmp_path, _fake_fetch, plan=plan)
    idx = json.loads((tmp_path / "tiles.json").read_text())
    assert idx == info
    assert idx["encoding"] == "terrarium" and idx["tileSize"] == 512
    assert idx["minzoom"] == 11 and idx["maxzoom"] == 12
    assert "Geoscience Australia" in idx["attribution"]
    assert len(idx["tiles"]) >= 2 and all(t.count("/") == 2 for t in idx["tiles"])
    w, s, e, n = idx["bounds"]
    assert w <= 138.60 and e >= 138.61 and s <= -35.56 and n >= -35.55
    for t in idx["tiles"]:
        img = decode_png((tmp_path / f"{t}.png").read_bytes())
        assert img.shape == (512, 512, 3)
        elev = T.terrarium_decode(img)
        assert elev.min() == 0.0                       # sea floor clamped
        assert (elev * 8 == np.round(elev * 8)).all()  # quantised
    # deterministic
    first = {t: (tmp_path / f"{t}.png").read_bytes() for t in idx["tiles"]}
    T.build(tmp_path, _fake_fetch, plan=plan)
    assert first == {t: (tmp_path / f"{t}.png").read_bytes() for t in idx["tiles"]}


def test_sample_elevation_reads_the_written_tiles(tmp_path):
    def fetch(z, x, y):
        return _const_tile(42.25)

    T.build(tmp_path, fetch, plan=[(12, (138.60, -35.56, 138.61, -35.55))])
    assert T.sample_elevation(tmp_path, 138.605, -35.555) == pytest.approx(42.25)
    assert T.sample_elevation(tmp_path, 138.605, -35.555, mode="max") == pytest.approx(42.25)
    assert T.sample_elevation(tmp_path, 100.0, 0.0) is None   # no tile there


def test_sample_max_mode_finds_the_top_of_a_bump(tmp_path):
    def fetch(z, x, y):
        e = np.zeros((256, 256))
        e[100, 100] = 90.0
        return encode_png(T.terrarium_encode(e))

    T.build(tmp_path, fetch, plan=[(12, (138.60, -35.56, 138.61, -35.55))])
    z, (x, y) = 12, T.tiles_covering((138.60, -35.56, 138.61, -35.55), 12)[0]
    # pixel (100, 100) of the top-left child = pixel (100, 100) of the 512 tile; its centre in lon/lat:
    lon, lat = T.pixel_to_lonlat(z, x, y, 100.5, 100.5)
    assert T.sample_elevation(tmp_path, lon + 1e-6, lat - 1e-6, mode="max") == pytest.approx(90.0)
    # half a pixel away, bilinear sampling sees about half of the bump; max mode still sees all of it
    lon2, lat2 = T.pixel_to_lonlat(z, x, y, 101.0, 100.5)
    assert T.sample_elevation(tmp_path, lon2, lat2) == pytest.approx(45.0, abs=0.5)
    assert T.sample_elevation(tmp_path, lon2, lat2, mode="max") == pytest.approx(90.0)


def test_cached_fetch_downloads_once_and_records_provenance(tmp_path):
    calls = []

    def download(url):
        calls.append(url)
        return _const_tile(1.0)

    manifest = tmp_path / "manifest.json"
    fetch = T.cached_fetcher(tmp_path / "raw", manifest, download=download)
    a = fetch(13, 7251, 4962)
    b = fetch(13, 7251, 4962)
    assert a == b and len(calls) == 1
    assert calls[0] == "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/7251/4962.png"
    assert (tmp_path / "raw" / "13" / "7251" / "4962.png").read_bytes() == a
    m = json.loads(manifest.read_text())
    entry = m["tiles"]["13/7251/4962"]
    assert entry["url"] == calls[0] and len(entry["sha256"]) == 64 and entry["retrieved"].endswith("Z")
    # a new fetcher with the same cache does not download again and keeps the record
    fetch2 = T.cached_fetcher(tmp_path / "raw", manifest, download=download)
    assert fetch2(13, 7251, 4962) == a and len(calls) == 1
    assert json.loads(manifest.read_text())["tiles"]["13/7251/4962"] == entry


def test_bilinear_sampling_across_a_tile_boundary(tmp_path):
    bbox = (138.60, -35.56, 138.61, -35.55)
    (x0, y0), = T.tiles_covering(bbox, 12)[:1]

    def fetch(z, x, y):
        return _const_tile(10.0 if x // 2 == x0 else 30.0)   # the 512 tile east of x0 is 30 m

    T.build(tmp_path, fetch, plan=[(12, bbox), (12, T.tile_bounds(12, x0 + 1, y0))])
    lon, lat = T.pixel_to_lonlat(12, x0 + 1, y0, 0.0, 100.5)   # exactly on the shared edge
    assert T.sample_elevation(tmp_path, lon, lat) == pytest.approx(20.0)
    assert T.sample_elevation(tmp_path, lon, lat, mode="max") == pytest.approx(30.0)


def test_cache_refuses_a_truncated_download(tmp_path):
    good = _const_tile(1.0)
    fetch = T.cached_fetcher(tmp_path / "raw", tmp_path / "m.json", download=lambda url: good[:40])
    with pytest.raises(ValueError):
        fetch(13, 1, 2)
    assert not (tmp_path / "raw" / "13" / "1" / "2.png").exists()
