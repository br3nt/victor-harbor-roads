from vhsim.counts import build


def test_build_writes_all_outputs(tmp_path):
    build.main(["--out", str(tmp_path)])
    for rel in ["counts/turning_2017.csv", "counts/turning_2017_report_totals.csv", "counts/aadt.csv",
                "counts/seasonal_factors.csv", "profiles/hourly_profile.csv",
                "counts/turning_2025_projected.csv", "counts/projection_validation.csv",
                "counts/newer_counts.csv"]:
        assert (tmp_path / rel).stat().st_size > 100, rel


def test_build_is_deterministic(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    build.main(["--out", str(a)])
    build.main(["--out", str(b)])
    for f in a.rglob("*.csv"):
        assert f.read_bytes() == (b / f.relative_to(a)).read_bytes()
