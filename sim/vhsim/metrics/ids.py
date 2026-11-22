"""Parse S2 vehicle ids: ``"{stratum}~{origin_zone}~{dest_category}~{dest_poi}~{seq}"``.

NOTE: DESIGN.md specifies ``|`` as the separator, but SUMO (duarouter/sumo 1.28) rejects ``|`` in vehicle
ids ("Invalid trip id ... Contains invalid characters"; ``,`` and ``;`` are rejected too). ``~`` works, so S2
must emit ``~``. The parser accepts either (one separator used consistently) so files made by either
convention can be read.

duarouter / SUMO may append a suffix to the sequence number (``.0`` for flows, ``_1``, ``#2``...);
it is kept in ``VehicleId.suffix``. Ids that do not follow the contract parse to ``None``.
"""
from __future__ import annotations

import re
from typing import NamedTuple

_RE = re.compile(r"^([^~|\s]+)([~|])([^~|\s]+)\2([^~|\s]+)\2([^~|\s]+)\2(\d+)([^~|\s]*)$")


class VehicleId(NamedTuple):
    stratum: str
    origin_zone: str
    dest_category: str
    dest_poi: str
    seq: str
    suffix: str = ""

    @property
    def seq_int(self) -> int:
        return int(self.seq)


def parse(vehicle_id: str, strict: bool = False) -> VehicleId | None:
    """Return the parsed id, or None (ValueError if ``strict``) when it is not contract-shaped."""
    m = _RE.match((vehicle_id or "").strip())
    if m:
        g = m.groups()
        return VehicleId(g[0], g[2], g[3], g[4], g[5], g[6])
    if strict:
        raise ValueError(f"not a vhsim vehicle id: {vehicle_id!r}")
    return None
