"""Time of day: the target hourly profile and per-purpose outbound profiles fitted to it."""
from __future__ import annotations

import csv
from pathlib import Path

import numpy as np

from . import params as P
from .config import Config


def target_profile(cfg: Config, path: Path | None = None) -> tuple[np.ndarray, str]:
    """(24 shares summing to 1, label). Uses S3's hourly_profile.csv unless missing or the
    config asks for the placeholder."""
    path = path or P.HOURLY_PROFILE_CSV
    if cfg["time.target_profile"] == "observed" and path.exists():
        shares = np.zeros(24)
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                shares[int(r["hour"])] = float(r["share"])
        if shares.sum() > 0:
            return shares / shares.sum(), f"observed: {path.name} (S3; S-D19 07-18, other hours as basis column says)"
    prof = np.asarray(cfg["time.placeholder_profile"], dtype=float)
    return prof / prof.sum(), "PLACEHOLDER: config time.placeholder_profile (midday peak, S-D19 finding)"


def _lag_hist(cfg: Config, dwell_key: str, n: int = 4000) -> np.ndarray:
    """Distribution of (return hour - outbound hour), for the fit only (fixed internal seed)."""
    rng = np.random.default_rng(12345)
    mean = cfg["time.dwell_minutes"][dwell_key]
    minutes = rng.uniform(0, 60, n) + rng.uniform(0.5, 1.5, n) * mean + 10.0   # +~10 min travel
    lag = np.floor(minutes / 60).astype(int)
    return np.bincount(np.clip(lag, 0, 47), minlength=48)[:48] / n


def _implied(outbound: dict, weights: dict, lags: dict, flat: np.ndarray, flat_w: float) -> np.ndarray:
    total = flat_w * flat
    for p, o in outbound.items():
        ret = np.zeros(24)
        for lag, pr in enumerate(lags[p]):
            if pr:
                shifted = np.zeros(24)
                if lag < 24:
                    shifted[lag:] = o[:24 - lag]
                    # trips whose return falls after midnight are counted at 23h
                    shifted[23] += o[24 - lag:].sum() if lag > 0 else 0
                else:
                    shifted[23] = o.sum()
                ret += pr * shifted
        total = total + weights[p] * (o + ret) / 2   # a tour = outbound + return leg
    return total


def fit_outbound(cfg: Config, shares: dict, ext_share: float, nhb_share: float):
    """Fit outbound-departure profiles per purpose (plus 'external') so that resident trips
    (outbound + returns + NHB, which follow the target directly) match the target profile.

    Returns ({purpose: profile}, implied total profile)."""
    target, _ = target_profile(cfg)
    priors = cfg["time.purpose_profiles"]
    hb = max(0.0, 1.0 - ext_share - nhb_share)
    weights = {p: hb * s for p, s in shares.items() if s > 0}
    weights["external"] = ext_share
    outbound, lags = {}, {}
    for p in weights:
        pr = np.asarray(priors[p], dtype=float)
        outbound[p] = pr / pr.sum()
        lags[p] = _lag_hist(cfg, p)
    for _ in range(int(cfg["time.fit_iterations"])):
        implied = _implied(outbound, weights, lags, target, nhb_share)
        implied_n = implied / implied.sum()
        ratio = np.where(implied_n > 0, target / np.maximum(implied_n, 1e-12), 1.0)
        for p in outbound:
            o = outbound[p] * np.sqrt(ratio)
            outbound[p] = o / o.sum()
    implied = _implied(outbound, weights, lags, target, nhb_share)
    return outbound, implied
