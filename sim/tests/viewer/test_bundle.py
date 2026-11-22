import re

from vhsim.paths import DATA
from vhsim.viewer.bundle import VIEWER, bundle


def test_bundle_is_one_folder_without_symlinks(tmp_path):
    out = bundle(DATA / "viewer" / "sample", tmp_path / "b")
    assert (out / "index.html").exists() and (out / "js" / "app.js").exists() and (out / "data" / "index.json").exists()
    assert (out / "residents" / "index.html").exists() and not (out / "residents" / "screenshots").exists()
    assert not any(p.is_symlink() for p in out.rglob("*"))
    assert not (out / "node_modules").exists() and not (out / "test").exists()
    html = (out / "index.html").read_text()
    # external code only from cdnjs, with an exact version
    for url in re.findall(r'(?:src|href)="(https?://[^"]+)"', html):
        assert url.startswith("https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.0/"), url


def test_bundle_will_not_delete_a_folder_it_did_not_make(tmp_path):
    import pytest
    (tmp_path / "precious.txt").write_text("keep")
    with pytest.raises(FileExistsError):
        bundle(DATA / "viewer" / "sample", tmp_path)
    assert (tmp_path / "precious.txt").exists()
    out = bundle(DATA / "viewer" / "sample", tmp_path / "b")
    bundle(DATA / "viewer" / "sample", out)                   # re-bundling its own output is fine


def test_viewer_modules_import_only_relative_paths():
    for js in (VIEWER / "js").glob("*.js"):
        for spec in re.findall(r"^import .* from '([^']+)';", js.read_text(), re.M):
            assert spec.startswith("./"), f"{js.name}: {spec}"
