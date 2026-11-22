import numpy as np
import pytest

from vhsim.demand import profiles as PR
from vhsim.demand.config import Config

CFG = Config.load()


def test_observed_profile_from_s3_is_used_when_present():
    prof, label = PR.target_profile(CFG)
    assert label.startswith("observed")
    assert prof.shape == (24,) and prof.sum() == pytest.approx(1.0)
    assert prof.argmax() in (11, 12, 13)          # midday peak (S-D19)


def test_placeholder_when_missing(tmp_path):
    prof, label = PR.target_profile(CFG, path=tmp_path / "missing.csv")
    assert "PLACEHOLDER" in label
    assert prof.argmax() == 12


def test_placeholder_when_configured():
    prof, label = PR.target_profile(CFG.with_overrides(["time.target_profile=placeholder"]))
    assert "PLACEHOLDER" in label


def test_fit_reproduces_target_shape_for_resident_mix():
    shares = CFG["purpose.shares.weekday_term"]
    fitted, implied = PR.fit_outbound(CFG, shares, ext_share=0.1, nhb_share=0.15)
    target, _ = PR.target_profile(CFG)
    # total variation distance over the day hours where purposes can reach
    tv = 0.5 * np.abs(implied[5:24] / implied.sum() - target[5:24] / target[5:24].sum()).sum()
    assert tv < 0.05
    for p, prof in fitted.items():
        assert prof.sum() == pytest.approx(1.0)


def test_unfitted_differs_more_than_fitted():
    shares = CFG["purpose.shares.weekday_term"]
    target, _ = PR.target_profile(CFG)
    _, raw = PR.fit_outbound(CFG.with_overrides(["time.fit_iterations=0"]), shares, 0.1, 0.15)
    _, fit = PR.fit_outbound(CFG, shares, 0.1, 0.15)
    def tv(x):
        return 0.5 * np.abs(x / x.sum() - target / target.sum()).sum()
    assert tv(fit) < tv(raw)
