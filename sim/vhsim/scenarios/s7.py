"""Geometry helpers for the S7 improvement options (new roundabouts).

Pure functions on SUMO x/y coordinates (metres, y = north); the option definitions that use them
are in vhsim.scenarios.defs (n2 ...). Choices are recorded in sim/assumptions/S7-improvements.md.
"""
from __future__ import annotations

import math

# Ring speed of the baseline's single-lane roundabouts follows v^2 = k * r (v in m/s, r = mean
# distance of the ring nodes from the centre): 10.6 m -> 20 km/h, 18.8 m -> 27, 25.4 m -> 31.
RING_SPEED_K = 2.9


def ring_speed_ms(radius_m: float) -> float:
    """Circulating speed (m/s) for a single-lane roundabout of this radius, as in the baseline network."""
    return math.sqrt(RING_SPEED_K * radius_m)


def bearing(p0, p1) -> float:
    """Compass bearing (degrees, clockwise from north) from p0 to p1."""
    return (math.degrees(math.atan2(p1[0] - p0[0], p1[1] - p0[1])) + 360) % 360


def point_at(center, bearing_deg: float, dist: float) -> tuple[float, float]:
    r = math.radians(bearing_deg)
    return center[0] + dist * math.sin(r), center[1] + dist * math.cos(r)


def ring_layout(center, bearings, radius: float) -> list[tuple[float, float]]:
    """One ring node per leg, on the circle of `radius` round `center`, in the direction of the leg."""
    return [point_at(center, b, radius) for b in bearings]


def clockwise_order(bearings) -> list[int]:
    """Indices of the legs in the order clockwise circulation visits them (left-hand traffic:
    roundabouts run clockwise seen from above, i.e. in increasing compass bearing)."""
    return sorted(range(len(bearings)), key=lambda i: bearings[i] % 360)


def arc(center, b0: float, b1: float, radius: float, step_deg: float = 15.0) -> list[tuple[float, float]]:
    """Points on the circle from bearing b0 clockwise to b1 (both ends included)."""
    sweep = (b1 - b0) % 360 or 360
    n = max(1, int(math.ceil(sweep / step_deg)))
    return [point_at(center, b0 + sweep * i / n, radius) for i in range(n + 1)]


def circular_mean(bearings) -> float:
    x = sum(math.sin(math.radians(b)) for b in bearings)
    y = sum(math.cos(math.radians(b)) for b in bearings)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def group_legs(bearings: dict[str, float], tolerance_deg: float = 30.0) -> list[list[str]]:
    """Group edge ids whose bearings from the junction centre are within `tolerance_deg` (an inbound and
    an outbound carriageway of one road form one leg)."""
    items = sorted(bearings.items(), key=lambda kv: kv[1])
    groups: list[list[str]] = []
    for eid, b in items:
        if groups and abs(((b - circular_mean([bearings[e] for e in groups[-1]])) + 180) % 360 - 180) <= tolerance_deg:
            groups[-1].append(eid)
        else:
            groups.append([eid])
    if len(groups) > 1:       # wrap round north: merge the last group into the first if they are close
        a = circular_mean([bearings[e] for e in groups[0]])
        z = circular_mean([bearings[e] for e in groups[-1]])
        if abs(((a - z) + 180) % 360 - 180) <= tolerance_deg:
            groups[0] = groups.pop() + groups[0]
    return groups
