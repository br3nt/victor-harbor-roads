from vhsim.demand import assumptions as A
from vhsim.demand.config import Config
from vhsim.demand.params import ASSUMPTIONS_MD


def test_generated_table_lists_every_assumption():
    cfg = Config.load()
    table = A.table(cfg)
    for k in cfg.keys():
        if cfg.basis(k).startswith("assumption"):
            assert f"`{k}`" in table, k


def test_assumptions_file_is_in_sync_with_config():
    text = ASSUMPTIONS_MD.read_text()
    assert A.BEGIN in text and A.END in text
    assert A.render(text, Config.load()) == text, "run: python -m vhsim.demand.assumptions"
