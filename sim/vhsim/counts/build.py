"""Regenerate every S3 output: ``python -m vhsim.counts.build [--out DIR]`` (default sim/data)."""
from __future__ import annotations

import argparse
from pathlib import Path

from vhsim.counts import aadt, profile, projection, seasonal, turning, validation
from vhsim.paths import DATA


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=DATA, help="data root (default: sim/data)")
    out = ap.parse_args(argv).out
    n = turning.write_csv(out / "counts" / "turning_2017.csv")
    turning.write_stated_csv(out / "counts" / "turning_2017_report_totals.csv")
    print(f"turning_2017.csv: {n} rows")
    print(f"aadt.csv: {aadt.write_csv(out / 'counts' / 'aadt.csv')} sections")
    print(f"seasonal_factors.csv: {seasonal.write_csv(out / 'counts' / 'seasonal_factors.csv')} rows")
    print(f"turning_2025_projected.csv: {projection.write_csv(out / 'counts' / 'turning_2025_projected.csv')} rows")
    print(f"projection_validation.csv: {validation.write_csv(out / 'counts' / 'projection_validation.csv')} rows")
    print(f"newer_counts.csv: {validation.write_newer_csv(out / 'counts' / 'newer_counts.csv')} rows")
    print(f"hourly_profile.csv: {profile.write_csv(out / 'profiles' / 'hourly_profile.csv')} rows")


if __name__ == "__main__":
    main()
