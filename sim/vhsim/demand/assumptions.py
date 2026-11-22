"""Regenerate the parameter tables in sim/assumptions/S2-demand.md from the config.

    python -m vhsim.demand.assumptions [--config path]

Only the block between the BEGIN/END markers is rewritten; the method notes around it are
hand-written.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import Config
from .params import ASSUMPTIONS_MD

BEGIN = "<!-- BEGIN generated: python -m vhsim.demand.assumptions -->"
END = "<!-- END generated -->"


def _fmt(v) -> str:
    s = json.dumps(v, ensure_ascii=False)
    if len(s) > 160:
        s = s[:157] + "..."
    return s.replace("|", "\\|")


def table(cfg: Config) -> str:
    lines = ["### Assumptions (basis = assumption)", "",
             "| key | value | unit | sensitivity | reason / note |", "|---|---|---|---|---|"]
    for k in cfg.keys():
        e = cfg.entry(k)
        if e["basis"].startswith("assumption"):
            extra = f" (also: {e['basis'][len('assumption;'):].strip()})" if ";" in e["basis"] else ""
            lines.append(f"| `{k}` | {_fmt(e['value'])} | {e['unit']} | {e.get('sensitivity', '')} | "
                         f"{e['note']}{extra} |")
    lines += ["", "### Sourced parameters (for reference; not assumptions)", "",
              "| key | value | unit | source | note |", "|---|---|---|---|---|"]
    for k in cfg.keys():
        e = cfg.entry(k)
        if not e["basis"].startswith("assumption"):
            lines.append(f"| `{k}` | {_fmt(e['value'])} | {e['unit']} | {e['basis']} | {e['note']} |")
    return "\n".join(lines)


def render(text: str, cfg: Config) -> str:
    head, rest = text.split(BEGIN, 1)
    _, tail = rest.split(END, 1)
    return f"{head}{BEGIN}\n{table(cfg)}\n{END}{tail}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m vhsim.demand.assumptions")
    ap.add_argument("--config", type=Path, default=None)
    a = ap.parse_args(sys.argv[1:] if argv is None else argv)
    text = ASSUMPTIONS_MD.read_text()
    ASSUMPTIONS_MD.write_text(render(text, Config.load(a.config)))
    print(f"updated {ASSUMPTIONS_MD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
