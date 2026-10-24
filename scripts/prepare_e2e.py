"""Build an isolated browser-test workspace around the bundled demo paper.

The workspace never contains the user's own papers. Set PAPERLAB_E2E_ARXIV to an
imported arXiv paper with LaTeX sources (e.g. "2410.24164/v4") to also copy it from
the data directory and run the optional RAP source test against it.
"""
import json
import os
import shutil
import sys
from pathlib import Path
import pymupdf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))
from app.paths import data_root
from make_demo import create
TARGET = ROOT / "tmp" / "e2e-workspace"
if TARGET.exists():
    expected = ROOT.resolve() / "tmp" / "e2e-workspace"
    if TARGET.resolve() != expected or TARGET.is_symlink() or (hasattr(TARGET, "is_junction") and TARGET.is_junction()):
        raise ValueError("Refusing to replace a linked or unexpected test workspace")
    shutil.rmtree(TARGET)
TARGET.mkdir(parents=True, exist_ok=True)
shutil.copytree(ROOT / "frontend/dist", TARGET / "frontend/dist")
meta, _ = create(TARGET)
fixture = {"paper_id": meta.paper_id, "version": meta.version}
if arxiv := os.environ.get("PAPERLAB_E2E_ARXIV", "").strip():
    paper_id, version = arxiv.split("/")
    for item in ["papers", "local-assets"]:
        shutil.copytree(data_root() / item / paper_id / version, TARGET / item / paper_id / version)
    # Tests start from an empty study record, independent of the user's own progress.
    (TARGET / "papers" / paper_id / version / "study.json").unlink(missing_ok=True)
    fixture["rap"] = {"paper_id": paper_id, "version": version}
(TARGET / "e2e-fixture.json").write_text(json.dumps(fixture, indent=2), encoding="utf-8")
doc = pymupdf.open()
doc.new_page().insert_text((72, 72), "PaperLab local upload acceptance test. No generated report yet.")
doc.save(ROOT / "tmp" / "upload-fixture.pdf")
print(TARGET)
