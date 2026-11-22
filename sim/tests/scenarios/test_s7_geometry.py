"""S7 roundabout geometry helpers (fast)."""
import math

import pytest

from vhsim.scenarios.s7 import clockwise_order, ring_layout, ring_speed_ms


def test_ring_nodes_sit_on_the_circle_in_the_direction_of_each_leg():
    nodes = ring_layout((100.0, 200.0), [0.0, 90.0, 210.0], radius=20.0)
    assert len(nodes) == 3
    for (x, y), bearing in zip(nodes, [0.0, 90.0, 210.0]):
        assert math.dist((x, y), (100.0, 200.0)) == pytest.approx(20.0)
        assert (math.degrees(math.atan2(x - 100.0, y - 200.0)) + 360) % 360 == pytest.approx(bearing)


def test_clockwise_order_for_left_hand_traffic():
    # compass bearings grow clockwise, so clockwise circulation visits the legs in increasing bearing
    assert clockwise_order([270.0, 10.0, 120.0]) == [1, 2, 0]


def test_ring_speed_matches_the_baseline_roundabouts():
    # baseline single-lane roundabouts: radius 10.6 m -> 20 km/h, 18.8 m -> 27 km/h, 25.4 m -> 31 km/h
    for r, kmh in ((10.6, 20), (18.8, 27), (25.4, 31)):
        assert ring_speed_ms(r) * 3.6 == pytest.approx(kmh, abs=1.0)
