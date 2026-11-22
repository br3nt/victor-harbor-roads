import pytest

from vhsim.demand.geo import dist_km, in_bbox, map_px_to_lonlat


def test_dist_km_one_degree_lat():
    assert dist_km(138.6, -35.5, 138.6, -36.5) == pytest.approx(110.9, rel=0.01)


def test_dist_km_lon_scales_with_cos_lat():
    assert dist_km(138.0, -35.55, 139.0, -35.55) == pytest.approx(90.7, rel=0.01)


def test_in_bbox():
    assert in_bbox(138.6, -35.55, (138.55, -35.6, 138.67, -35.52))
    assert not in_bbox(138.7, -35.55, (138.55, -35.6, 138.67, -35.52))


def test_growth_map_georeference_control_points():
    # The three control points used for the fit (see assumptions A-S2-24) reproduce within ~150 m.
    for px, py, lon, lat in [(480, 700, 138.6230, -35.5517), (591, 588, 138.6391, -35.5365),
                             (555, 466, 138.6346, -35.5191)]:
        glon, glat = map_px_to_lonlat(px, py)
        assert dist_km(glon, glat, lon, lat) < 0.15
