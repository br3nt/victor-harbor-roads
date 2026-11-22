from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def s6_base(tmp_path_factory):
    """The baseline net rebuilt from the committed plain files (what scenario patches apply to)."""
    from vhsim.network import config, scenario
    from vhsim.scenarios.defs import Baseline

    out = tmp_path_factory.mktemp("s6_base")
    net = scenario.build("baseline", None, out_dir=out)
    return Baseline(net_path=net, plain_dir=config.BASELINE_PLAIN_DIR)


@pytest.fixture(scope="session")
def baseline_bays(s6_base, tmp_path_factory):
    import sumolib

    from vhsim.network import config, turn_bays

    out = tmp_path_factory.mktemp("s6_base_bays")
    net = out / "baseline_bays.net.xml"
    turn_bays.build(plain_dir=config.BASELINE_PLAIN_DIR, prefix="baseline", base_net=s6_base.net_path,
                    out_net=net, workdir=out / "work")
    return sumolib.net.readNet(str(net))


@pytest.fixture(scope="session")
def built(s6_base, tmp_path_factory):
    """built(name) -> (summary, sumolib net of <name>_bays.net.xml), each scenario built once."""
    import sumolib

    from vhsim.scenarios.build import build_scenario

    root = tmp_path_factory.mktemp("s6_nets")
    cache = {}

    def get(name: str):
        if name not in cache:
            s = build_scenario(name, base=s6_base, out_dir=root, patches_root=root / "patches", work_root=root / "work")
            net = sumolib.net.readNet(str(root / f"{name}_bays.net.xml"), withPrograms=True)
            cache[name] = (s, net, root)
        return cache[name]

    return get
