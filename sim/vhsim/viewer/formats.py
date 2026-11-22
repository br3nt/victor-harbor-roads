"""Binary layouts of ``lanes.bin.gz`` and ``edge_times.bin.gz`` (documented in ``meta.json`` and S5-viewer.md).

Both files are gzip-compressed, little-endian, **interval-major** planes: plane[t * n + i] is the value of
lane/edge ``i`` (the order of ``network.json`` ``lanes``/``edges``) in interval ``t``. Each plane starts on a
4-byte boundary so the browser can view it as a typed array without copying. Decoding is
``value = raw * scale`` unless ``raw == missing``.
"""
from __future__ import annotations

import gzip
from pathlib import Path

import numpy as np

LANE_PLANES = (
    # name, dtype, scale, missing (None = never missing), unit, description
    ("waiting_s", "uint16", 2.0, None, "s",
     "total time vehicles spent halted (speed < 0.1 m/s) on the lane in the interval, summed over vehicles; "
     "2 s steps, capped at 131070 s (about 145 vehicles halted for all of a 15-minute interval)"),
    ("vehicles", "uint16", 1.0, None, "vehicles",
     "vehicles entering the lane during the interval, including lane changes onto it (entered + departed + "
     "laneChangedTo), so a vehicle can count on two lanes of one road"),
    ("speed_ratio", "uint8", 1 / 254, 255, "ratio",
     "time-weighted mean speed / lane speed limit, capped at 1; 255 = no vehicles in the interval"),
    ("density", "uint8", 1.0, 255, "vehicles/km",
     "mean vehicles per km of lane, capped at 254; 255 = no vehicles in the interval"),
)
EDGE_TIME_SCALE = 0.1          # deciseconds
EDGE_TIME_IMPASSABLE = 65535
EDGE_TIME_CAP = 65534


def _write(path: Path, chunks: list[bytes]) -> None:
    data = b"".join(chunks)
    Path(path).write_bytes(gzip.compress(data, compresslevel=9, mtime=0) if str(path).endswith(".gz") else data)


def _read(path: Path) -> bytes:
    raw = Path(path).read_bytes()
    return gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw


def _pad(b: bytes) -> bytes:
    return b + b"\0" * (-len(b) % 4)


def write_lanes(path, m: dict[str, np.ndarray]) -> dict:
    """Quantise lane measures (arrays [T, N], NaN = no data) into ``path``; return the layout for meta.json."""
    planes, chunks, offset = [], [], 0
    for name, dtype, scale, missing, unit, desc in LANE_PLANES:
        a = np.asarray(m[name], dtype=float)
        hi = 254 if dtype == "uint8" else 65535
        q = np.clip(np.rint(np.nan_to_num(a, nan=0.0) / scale), 0, hi)
        if missing is not None:
            q[np.isnan(a)] = missing
        b = _pad(q.astype("<" + {"uint8": "u1", "uint16": "u2"}[dtype]).tobytes())
        planes.append({"name": name, "dtype": dtype, "offset": offset, "scale": scale, "missing": missing,
                       "unit": unit, "description": desc})
        chunks.append(b)
        offset += len(b)
    _write(path, chunks)
    return {"path": Path(path).name, "encoding": "gzip" if str(path).endswith(".gz") else "raw",
            "byte_order": "little", "order": "interval-major", "bytes": offset, "planes": planes}


def read_lanes(path, layout: dict, n_intervals: int, n_lanes: int) -> dict[str, np.ndarray]:
    data = _read(path)
    out = {}
    for p in layout["planes"]:
        dt = np.dtype("<" + {"uint8": "u1", "uint16": "u2"}[p["dtype"]])
        q = np.frombuffer(data, dtype=dt, count=n_intervals * n_lanes, offset=p["offset"]).reshape(n_intervals, n_lanes)
        v = q.astype(float) * p["scale"]
        if p["missing"] is not None:
            v[q == p["missing"]] = np.nan
        out[p["name"]] = v
    return out


def write_edge_times(path, tt: np.ndarray) -> dict:
    """Edge travel times [T, E] in seconds (inf = impassable) -> uint16 deciseconds."""
    a = np.asarray(tt, dtype=float)
    q = np.clip(np.rint(np.where(np.isfinite(a), a, 0) / EDGE_TIME_SCALE), 1, EDGE_TIME_CAP)
    q[~np.isfinite(a)] = EDGE_TIME_IMPASSABLE
    b = _pad(q.astype("<u2").tobytes())
    _write(path, [b])
    return {"path": Path(path).name, "encoding": "gzip" if str(path).endswith(".gz") else "raw",
            "byte_order": "little", "order": "interval-major", "bytes": len(b),
            "planes": [{"name": "travel_time_s", "dtype": "uint16", "offset": 0, "scale": EDGE_TIME_SCALE,
                        "missing": EDGE_TIME_IMPASSABLE, "unit": "s",
                        "description": "mean time to traverse the edge for vehicles in the interval (SUMO edgeData "
                                       "traveltime); free-flow time (length / speed limit) when no vehicles; "
                                       "capped at 6553.4 s; 65535 = impassable"}]}


def read_edge_times(path, layout: dict, n_intervals: int, n_edges: int) -> np.ndarray:
    p = layout["planes"][0]
    q = np.frombuffer(_read(path), dtype="<u2", count=n_intervals * n_edges, offset=p["offset"])
    v = q.astype(float).reshape(n_intervals, n_edges) * p["scale"]
    v[q.reshape(n_intervals, n_edges) == p["missing"]] = np.inf
    return v
