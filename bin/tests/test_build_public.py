"""Tests for bin/build-public (the public, privacy-clean copy).

Run from the repository root:  python3 -m pytest bin/tests -q
The integration test at the end builds the real public copy (needs Ruby with the okf-html gem and the exported
viewer data); it is skipped when those are missing. Names in this file are invented: the public copy carries this
file too, so it must not hold a real private name.
"""
from __future__ import annotations

import gzip
import importlib.machinery
import importlib.util
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _load():
    loader = importlib.machinery.SourceFileLoader("build_public", str(ROOT / "bin" / "build-public"))
    spec = importlib.util.spec_from_loader("build_public", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


bp = _load()

NAMES_TSV = (
    "pattern\tkind\twho\n"
    "Alice Example\tprivate\tPrivate resident: wrote the post (S-F01). Not related to Cr Bob Example.\n"
    "alice-example\tprivate\tPrivate resident (Alice Example), in a file name.\n"
    "Carol Sample\tprivate\tPrivate resident: commented (S-F03).\n"
    "Author Person\tyou\tYou.\n"
    "page:authors-position\tyou\tYour answers.\n"
)
PSEUDONYMS_TSV = (
    "kind\tpattern\treplacement\tnote\n"
    "replace\tAlice Example\tResident 1\tPrivate resident who wrote the post (S-F01). Not a public official.\n"
    "replace\talice-example\tresident-1\t\n"
    "replace\tCarol Sample\tResident 2\tPrivate resident who commented (S-F03). Not a public official.\n"
    "forbid\tsecret.person@mailhost.example\t\tauthor's email\n"
    "forbid\tmailhost\t\tauthor's mail provider\n"
    "word\tAlice\t\tfirst name alone\n"
    "rewrite\t They share a family name with a member.\t\ta hint at who a resident is\n"
    "rewrite\t(mail at Provider)\t(private email)\tnames a mail provider\n"
)


@pytest.fixture
def private(tmp_path):
    (tmp_path / "bin").mkdir()
    (tmp_path / "bin" / "private-names.tsv").write_text(NAMES_TSV)
    (tmp_path / "bin" / "pseudonyms.tsv").write_text(PSEUDONYMS_TSV)
    return bp.load_private(tmp_path)


# --- the private lists ------------------------------------------------------------------------------------------

def test_load_private_reads_replacements_longest_first(private):
    assert private.replacements == [
        ("Alice Example", "Resident 1"), ("alice-example", "resident-1"), ("Carol Sample", "Resident 2"),
    ]
    assert private.forbidden == ["secret.person@mailhost.example", "mailhost"]
    assert private.words == ["Alice"]


def test_every_private_pattern_needs_a_pseudonym(tmp_path):
    (tmp_path / "bin").mkdir()
    (tmp_path / "bin" / "private-names.tsv").write_text(NAMES_TSV)
    (tmp_path / "bin" / "pseudonyms.tsv").write_text(PSEUDONYMS_TSV.replace("replace\tCarol Sample\tResident 2", "x\ty\tz"))
    with pytest.raises(bp.BuildError, match="Carol Sample"):
        bp.load_private(tmp_path)


def test_private_patterns_are_scanned_case_insensitively(private):
    assert {"Alice Example", "alice-example", "Carol Sample"} <= set(private.scan_terms)
    assert "mailhost" in private.scan_terms


# --- pseudonymising ---------------------------------------------------------------------------------------------

def test_pseudonymise_text_replaces_every_private_name(private):
    text = "Alice Example posted; Carol Sample replied (file S-F01-post-alice-example.webp)."
    assert bp.pseudonymise(text, private) == "Resident 1 posted; Resident 2 replied (file S-F01-post-resident-1.webp)."


def test_pseudonymise_path_renames_files(private):
    assert bp.pseudonymise_path("sources/F/S-F01-post-alice-example.webp", private) == "sources/F/S-F01-post-resident-1.webp"


def test_public_private_names_tsv_has_no_mapping(private):
    out = bp.public_private_names_tsv(private)
    assert out.splitlines()[0] == "pattern\tkind\twho"
    rows = [line.split("\t") for line in out.splitlines()[1:]]
    assert [r[0] for r in rows] == ["Resident 1", "Resident 2"]
    assert all(r[1] == "pseudonym" for r in rows)
    for real in ("Alice", "Example", "Carol", "Sample", "Bob", "Author Person"):
        assert real not in out
    assert "pseudonym" in rows[0][2].lower()


def test_is_text():
    assert bp.is_text("Grüße, plain text\n".encode())
    assert not bp.is_text(b"\x89PNG\r\n\x1a\n\x00\x00")
    assert not bp.is_text(b"\xff\xfe\xfa not utf-8")


# --- choosing files ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize("path, keep", [
    ("sim/vhsim/run.py", True),
    ("viewer/js/app.js", True),
    ("kb/0001.html", True),
    ("research/A-yoursay-sources.tsv", True),
    ("results/screenshots/a.jpg", True),
    ("game/data/raw/SOURCES.md", True),
    ("game/data/raw/G-01-victor-harbor-all.overpassql", True),
    ("game/data/raw/G-01-victor-harbor-all.osm", False),
    ("sources/A/S-A03-fact-sheet.pdf", False),
    ("sources/F/S-F01.webp", False),
    ("sources/H/S-H01-survey-receipt.json", False),
    ("kb-assets/maps/vhits-ring-road.jpg", False),
    ("site/assets/maps/vhits-ring-road.jpg", False),
    (".claude/launch.json", False),
    (".playwright-mcp/page.yml", False),
    ("publish/maps/index.html", False),
    ("tmp-notes/x.md", False),
    ("node_modules/x/index.js", False),
    ("viewer/node_modules/x/index.js", False),
    (".venv/bin/python", False),
    ("submission/draft-submission.md", False),
    ("bin/pseudonyms.tsv", False),
    ("sim/data/profiles/raw/some-third-party.pdf", False),
    ("sources/A/S-A03-fact-sheet.pdf", False),
    ("sim/data/demand/raw/S-S2-03a-tfnsw-tia-guide-pdf-pp54-55-62-text.txt", False),
    (".gitignore", False),
])
def test_exclusion_reason(path, keep):
    reason = bp.exclusion_reason(path)
    assert (reason is None) == keep, (path, reason)


def test_archived_pdfs_are_reported_as_archives():
    assert "archives" in bp.exclusion_reason("sources/A/S-A03-fact-sheet.pdf")
    assert "PDF" in bp.exclusion_reason("sim/data/profiles/raw/x.pdf")


# --- the scan ---------------------------------------------------------------------------------------------------

def _tree(tmp_path, files):
    for rel, data in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data if isinstance(data, bytes) else data.encode())
    return tmp_path


def test_scan_passes_a_clean_tree(tmp_path, private):
    t = _tree(tmp_path / "t", {"a.md": "Resident 1 posted. Call the council on (08) 8551 0500.", "b.png": b"\x89PNG\x00"})
    assert bp.scan_tree(t, private) == []


@pytest.mark.parametrize("files, expect", [
    ({"a.md": "by alice EXAMPLE"}, "alice example"),
    ({"a.json": '{"who": "Carol Sample"}'}, "carol sample"),
    ({"docs/S-F01-post-alice-example.webp": b"\x00"}, "alice-example"),
    ({"img.png": b"\x89PNG\x00tEXtAuthor secret.person@mailhost.example"}, "mailhost"),
    ({"d.bin.gz": gzip.compress(b"contact secret.person@mailhost.example")}, "mailhost"),
    ({"n.txt": "Alice said so"}, "Alice"),
    # built at run time so that this file (which the public copy carries) holds no phone number or address itself
    ({"n.txt": "ring me on 04" + "12 345 678"}, "phone"),
    ({"n.html": "<p>+61 8 " + "8555 1234</p>"}, "phone"),
    ({"n.txt": "write to someone" + "@privatemail.net"}, "email"),
])
def test_scan_finds_private_details(tmp_path, private, files, expect):
    found = bp.scan_tree(_tree(tmp_path / "t", files), private)
    assert found and any(expect.lower() in f.lower() for f in found), found


def test_scan_allows_public_business_contacts_in_osm_tags(tmp_path, private):
    osm = '<tag k="phone" v="+61 8 ' + '8552 9055"/>\n<tag k="email" v="admin@' + 'shop.com.au"/>\n'
    assert bp.scan_tree(_tree(tmp_path / "t", {"x.osm": osm}), private) == []


def test_scan_allows_government_and_reserved_example_emails(tmp_path, private):
    text = "localgov@victor.sa.gov.au, someone@example.com, a@b.example"
    assert bp.scan_tree(_tree(tmp_path / "t", {"x.md": text}), private) == []


def test_scan_ignores_long_numbers_that_are_not_phones(tmp_path, private):
    text = "sha256 0812345678901234 and 1700000000 epoch, lon 138.6234567, ids 04123456789"
    assert bp.scan_tree(_tree(tmp_path / "t", {"x.csv": text}), private) == []


# --- KB map images ----------------------------------------------------------------------------------------------

def test_map_figures_become_links_to_the_council_originals():
    html = ('<figure><img src="assets/maps/vhits-ring-road.jpg" alt="Ring road map" style="max-width:100%">'
            '<figcaption>Council’s ring road map.</figcaption></figure>')
    out = bp.replace_map_figures(html, {"vhits-ring-road.jpg": "https://council.example/500"})
    assert "<img" not in out
    assert 'href="https://council.example/500"' in out
    assert "Ring road map" in out and "<figcaption>Council’s ring road map.</figcaption>" in out


def test_map_figure_without_a_known_original_fails():
    with pytest.raises(bp.BuildError, match="other.png"):
        bp.replace_map_figures('<img src="assets/maps/other.png" alt="x">', {})


def test_map_originals_come_from_the_sources_register():
    urls = bp.map_originals(ROOT / "research")
    assert urls["vhits-ring-road.jpg"].startswith("https://yoursay.victor.sa.gov.au/")
    assert urls["vhits-growth-areas.png"].endswith("#page=2")


# --- site checks ------------------------------------------------------------------------------------------------

def test_size_check_flags_files_over_100_mb(tmp_path):
    t = tmp_path / "t"
    t.mkdir()
    big = t / "big.bin"
    with open(big, "wb") as f:
        f.truncate(101 * 1024 * 1024)
    (t / "small.txt").write_text("x")
    total, problems = bp.check_sizes(t)
    assert total >= 101 * 1024 * 1024
    assert problems == ["big.bin"]


def test_claude_check_flags_artifact_links_and_meta(tmp_path):
    t = _tree(tmp_path / "t", {
        "a.html": '<a href="https://claude.ai/artifact/abc">x</a>',
        "b.html": '<meta name="claude:viewport-fit-sides" content="cover">',
        "c.html": "<p>fine</p>",
    })
    assert sorted(bp.check_no_claude(t)) == ["a.html", "b.html"]


# --- the whole build (fixture repository, no site) --------------------------------------------------------------

def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
                        "GIT_COMMITTER_EMAIL": "t@t"})


def test_build_tree_from_a_fixture_repository(tmp_path):
    repo = tmp_path / "repo"
    files = {
        "bin/private-names.tsv": NAMES_TSV,
        "bin/pseudonyms.tsv": PSEUDONYMS_TSV,
        "bin/tool": "#!/usr/bin/env ruby\nputs 'Alice Example'\n",
        "kb/n1.html": "<p>On Alice Example's post; Carol Sample commented. They share a family name with a member.</p>",
        "research/F-sources.tsv": "id\turl\tlocal_path\nS-F01\thttps://fb.example/p\tsources/F/S-F01-alice-example.webp\n"
                                  "S-H01\t(mail at Provider)\tsources/H/x.json\n",
        "sources/F/S-F01-alice-example.webp": "binary",
        "sim/a.py": "x = 1\n",
        "submission/draft.md": "draft",
        "tracked-but-ignored/x.yml": "noise",
        ".gitignore": "tracked-but-ignored/\nsecret.txt\n",
        "secret.txt": "not tracked",
    }
    _tree(repo, files)
    _git(repo, "init", "-q")
    _git(repo, "add", "-f", ".")
    _git(repo, "rm", "-q", "--cached", "secret.txt")
    _git(repo, "commit", "-q", "-m", "fixture")
    out = tmp_path / "publish" / "public-repo"
    excluded = bp.build_tree(repo, out)
    got = sorted(str(p.relative_to(out)) for p in out.rglob("*") if p.is_file())
    assert "kb/n1.html" in got and "sim/a.py" in got and "bin/tool" in got
    assert "submission/README.md" in got and "submission/draft.md" not in got
    assert not any(g.startswith(("sources/", "tracked-but-ignored/")) or g in ("secret.txt", "bin/pseudonyms.tsv") for g in got)
    assert (out / "kb/n1.html").read_text() == "<p>On Resident 1's post; Resident 2 commented.</p>"
    assert "sources/F/S-F01-resident-1.webp" in (out / "research/F-sources.tsv").read_text()
    assert "(private email)" in (out / "research/F-sources.tsv").read_text()
    assert "Resident 1\tpseudonym" in (out / "bin/private-names.tsv").read_text()
    assert bp.scan_tree(out, bp.load_private(repo)) == []
    assert any(p.startswith("sources/") for paths in excluded.values() for p in paths)


def test_build_refuses_to_clear_a_folder_it_did_not_make(tmp_path):
    out = tmp_path / "somewhere"
    out.mkdir()
    (out / "keep.txt").write_text("x")
    with pytest.raises(bp.BuildError, match="refusing"):
        bp.prepare_out(out)


# --- integration: the real public copy --------------------------------------------------------------------------

def _can_build_site():
    from shutil import which
    data = Path(os.environ.get("VIEWER_DATA_DIR", ROOT / "sim/data/viewer"))
    gem = Path(os.environ.get("OKF_HTML_LIB", Path.home() / "Development/okf-html-gem/okf-html/lib"))
    return which("ruby") and (data / "index.json").exists() and gem.exists() and (ROOT / "bin/pseudonyms.tsv").exists()


@pytest.mark.skipif(not _can_build_site(), reason="needs ruby, the okf-html gem, viewer data and the private lists")
def test_real_build(tmp_path):
    out = tmp_path / "publish" / "public-repo"
    report = bp.build(ROOT, out, viewer_data=Path(os.environ.get("VIEWER_DATA_DIR", ROOT / "sim/data/viewer")))
    assert report["scan"] == []
    docs = out / "docs"
    for rel in ("index.html", ".nojekyll", "kb/index.html", "maps/index.html", "maps/engineer.html",
                "maps/residents/index.html", "game/index.html", "onboarding/index.html", "deck/index.html"):
        assert (docs / rel).exists(), rel
    assert "Resident 1" in (docs / "kb/private-names-review.html").read_text()
    assert not list((docs / "maps/data/runs").rglob("*.b64.txt"))
    assert list((docs / "maps/data/runs").rglob("*.bin.gz"))
    assert "../../kb/simulation-results.html" in (docs / "maps/residents/js/app.js").read_text()
    assert "../kb/simulation-results.html" in (docs / "maps/index.html").read_text()
    assert "src=\"assets/" not in "".join(p.read_text() for p in (docs / "kb").glob("*.html"))
    assert bp.check_no_claude(docs) == []
    assert bp.check_local_paths(docs) == []


# --- review fixes -----------------------------------------------------------------------------------------------

def test_scan_checks_words_phones_and_emails_inside_gzip_payloads(tmp_path, private):
    for payload, expect in [(b"Alice was here", "Alice"), (("ring 04" + "12 345 678").encode(), "phone"),
                            (("mail someone" + "@privatemail.net").encode(), "email")]:
        t = _tree(tmp_path / expect, {"d.json.gz": gzip.compress(payload)})
        found = bp.scan_tree(t, private)
        assert any(expect.lower() in f.lower() for f in found), (expect, found)


def test_private_rewrites_apply_and_report_what_they_did(private):
    applied = set()
    out = bp.pseudonymise("<li>Resident 2 (S-F03). They share a family name with a member.</li>", private, applied)
    assert out == "<li>Resident 2 (S-F03).</li>"
    assert bp.pseudonymise("x\t(mail at Provider)\ty", private, applied) == "x\t(private email)\ty"
    assert applied == {0, 1}
    bp.check_rewrites_applied(private, applied)


def test_a_rewrite_that_matches_nothing_fails_the_build(private):
    with pytest.raises(bp.BuildError, match="matched nothing"):
        bp.check_rewrites_applied(private, {1})


def test_rewrites_are_read_from_the_private_list(private):
    assert private.rewrites == [(" They share a family name with a member.", ""), ("(mail at Provider)", "(private email)")]


def test_run_meta_sources_lose_local_folders():
    meta = {"sources": ["/home/someone/work/project/sim/data/runs/b3__s1", "sim/data/runs/b3__s2"], "n_edges": 3}
    assert bp.public_meta(meta) == {"sources": ["sim/data/runs/b3__s1", "sim/data/runs/b3__s2"], "n_edges": 3}


def test_local_path_check(tmp_path):
    t = _tree(tmp_path / "t", {"a.json": '{"s": "/Users/someone/x"}', "b.html": "<p>ok</p>"})
    assert bp.check_local_paths(t) == ["a.json"]


def test_generated_gitignore_keeps_the_build_marker_out():
    assert bp.MARKER in bp.GITIGNORE.splitlines()


# --- evidence page and slides ------------------------------------------------------------------------------------

def test_stage_pages_copies_onboarding_and_deck_or_falls_back_to_placeholders(tmp_path):
    out = tmp_path / "out"
    (out / "viewer" / "onboarding" / "img").mkdir(parents=True)
    (out / "viewer" / "onboarding" / "index.html").write_text("<h1>evidence</h1>")
    (out / "viewer" / "onboarding" / "img" / "a.webp").write_bytes(b"RIFF")
    (out / "docs").mkdir()
    bp.stage_pages(out)
    assert (out / "docs/onboarding/index.html").read_text() == "<h1>evidence</h1>"
    assert (out / "docs/onboarding/img/a.webp").exists()
    assert "coming here" in (out / "docs/deck/index.html").read_text()
