"""Demand-model configuration: one JSON file, every parameter with value, unit, basis and note.

File layout (sim/data/demand/config/default.json):

    {"parameters": {"<dotted.key>": {"value": ..., "unit": "...", "basis": "S-C01" | "assumption",
                                      "note": "...", "sensitivity": "low|medium|high"}, ...}}

Overrides ("key=value", value parsed as JSON, else taken as a string) may address a top-level
key or a sub-key inside a dict value: ``purpose.shares.weekday_term.work=0.2``.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

from vhsim.paths import DATA

DEFAULT_CONFIG = DATA / "demand" / "config" / "default.json"


class ConfigError(ValueError):
    pass


class Config:
    def __init__(self, params: dict, source: Path | None = None, overrides: list[str] | None = None):
        self._p = params
        self.source = source
        self.overrides = list(overrides or [])

    # ------------------------------------------------------------------ io
    @classmethod
    def load(cls, path: Path | str | None = None) -> "Config":
        path = Path(path) if path else DEFAULT_CONFIG
        with open(path) as f:
            data = json.load(f)
        params = data["parameters"]
        for k, e in params.items():
            if not isinstance(e, dict) or "value" not in e:
                raise ConfigError(f"{path}: entry {k!r} has no 'value'")
        return cls(params, path)

    def dump(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump({"parameters": self._p}, f, indent=1, ensure_ascii=False)
            f.write("\n")

    def to_dict(self) -> dict:
        return copy.deepcopy(self._p)

    # ------------------------------------------------------------------ access
    def keys(self):
        return list(self._p)

    def entry(self, key: str) -> dict:
        return self._p[key]

    def __getitem__(self, key: str):
        if key in self._p:
            return self._p[key]["value"]
        top, sub = _split_key(self._p, key)
        v = self._p[top]["value"]
        for part in sub:
            if not isinstance(v, dict) or part not in v:
                raise ConfigError(f"unknown config key {key!r}")
            v = v[part]
        return v

    def get(self, key: str, default=None):
        return self._p[key]["value"] if key in self._p else default

    def basis(self, key: str) -> str:
        return self._p[key]["basis"]

    # ------------------------------------------------------------------ overrides
    def with_overrides(self, overrides: list[str] | None) -> "Config":
        params = copy.deepcopy(self._p)
        for ov in overrides or []:
            if "=" not in ov:
                raise ConfigError(f"override {ov!r} is not key=value")
            key, raw = ov.split("=", 1)
            key = key.strip()
            try:
                value = json.loads(raw)
            except json.JSONDecodeError:
                value = raw
            top, sub = _split_key(params, key)
            if not sub:
                params[top]["value"] = value
                continue
            target = params[top]["value"]
            for part in sub[:-1]:
                if not isinstance(target, dict) or part not in target:
                    raise ConfigError(f"override {ov!r}: no sub-key {part!r}")
                target = target[part]
            if not isinstance(target, dict) or sub[-1] not in target:
                raise ConfigError(f"override {ov!r}: no sub-key {sub[-1]!r}")
            target[sub[-1]] = value
        return Config(params, self.source, self.overrides + list(overrides or []))


def _split_key(params: dict, key: str):
    """Longest prefix of `key` that is a parameter name; the rest are sub-keys."""
    parts = key.split(".")
    for i in range(len(parts), 0, -1):
        top = ".".join(parts[:i])
        if top in params:
            return top, parts[i:]
    raise ConfigError(f"unknown config key {key!r}")
