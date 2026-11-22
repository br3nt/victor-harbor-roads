"""Hour bands shared by the accessibility and movements tables (see assumptions/S4-metrics.md)."""
from __future__ import annotations

# label -> (start_hour inclusive, end_hour exclusive), applied to the simulation clock
# (seconds since midnight, mod 24 h so multi-day runs fold onto the clock).
DEFAULT_HOUR_BANDS: dict[str, tuple[int, int]] = {
    "00-06": (0, 6),
    "06-09": (6, 9),
    "09-15": (9, 15),
    "15-18": (15, 18),
    "18-24": (18, 24),
}


def band_of(t_seconds: float, hour_bands: dict[str, tuple[int, int]]) -> str | None:
    h = (t_seconds % 86400) / 3600.0
    for label, (lo, hi) in hour_bands.items():
        if lo <= h < hi:
            return label
    return None


def band_hours(hour_bands: dict[str, tuple[int, int]], label: str) -> float:
    lo, hi = hour_bands[label]
    return float(hi - lo)
