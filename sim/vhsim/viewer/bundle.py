"""Copy the viewer app and one data folder into a single self-contained folder (for publishing).

    python -m vhsim.viewer.bundle --data sim/data/viewer/sample --out dist/viewer-sample

The folder has ``index.html``, ``css/``, ``js/`` and ``data/`` (no symlinks), so any static host works.
MapLibre GL JS still loads from cdnjs. Its stylesheet is copied in from ``viewer/node_modules`` (same pinned
version) when present, for hosts that only allow external scripts; otherwise the cdnjs link stays.
"""
from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

from vhsim.paths import REPO

VIEWER = REPO / "viewer"
MAPLIBRE_VERSION = "5.6.0"
MARKER = ".viewer-bundle"


def bundle(data: Path, out: Path, viewer: Path = VIEWER) -> Path:
    data, out = Path(data), Path(out)
    if not (data / "index.json").exists():
        raise FileNotFoundError(f"{data}/index.json missing (run python -m vhsim.viewer.export first)")
    if out.exists():
        if not (out / MARKER).exists() and any(out.iterdir()):
            raise FileExistsError(f"{out} exists and is not a viewer bundle; choose an empty or new folder")
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / MARKER).write_text("made by python -m vhsim.viewer.bundle; the folder is replaced on the next bundle\n")
    for d in ("css", "js"):
        shutil.copytree(viewer / d, out / d)
    shutil.copytree(viewer / "residents", out / "residents", ignore=shutil.ignore_patterns("screenshots", ".DS_Store"))
    shutil.copytree(data, out / "data", symlinks=False, ignore=shutil.ignore_patterns(".DS_Store"))
    html = (viewer / "index.html").read_text()
    css = viewer / "node_modules" / "maplibre-gl" / "dist" / "maplibre-gl.css"
    if css.exists():
        shutil.copy(css, out / "css" / "maplibre-gl.css")
        html = re.sub(r'<link rel="stylesheet" href="https://cdnjs[^"]+maplibre-gl\.css">',
                      '<link rel="stylesheet" href="css/maplibre-gl.css">', html)
    (out / "index.html").write_text(html)
    if css.exists():
        rp = out / "residents" / "index.html"
        rp.write_text(re.sub(r'<link rel="stylesheet" href="https://cdnjs[^"]+maplibre-gl\.css">',
                             '<link rel="stylesheet" href="../css/maplibre-gl.css">', rp.read_text()))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m vhsim.viewer.bundle", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="viewer data folder with index.json")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    out = bundle(Path(a.data), Path(a.out))
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"viewer bundle in {out} ({size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
