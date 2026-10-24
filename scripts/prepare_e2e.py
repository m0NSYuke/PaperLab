"""Copy only the public acceptance case to an isolated test workspace."""
import shutil
import sys
from pathlib import Path
import pymupdf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.paths import data_root
DATA = data_root()
TARGET = ROOT / "tmp" / "e2e-workspace"
if TARGET.exists():
    expected = ROOT.resolve() / "tmp" / "e2e-workspace"
    if TARGET.resolve() != expected or TARGET.is_symlink() or (hasattr(TARGET, "is_junction") and TARGET.is_junction()):
        raise ValueError("Refusing to replace a linked or unexpected test workspace")
    shutil.rmtree(TARGET)
TARGET.mkdir(parents=True, exist_ok=True)
for item in ["frontend/dist", "papers/2410.24164/v4", "local-assets/2410.24164/v4", "concepts"]:
    shutil.copytree((ROOT if item == "frontend/dist" else DATA) / item, TARGET / item, dirs_exist_ok=True)
# Tests start from an empty study record, independent of the user's own progress.
(TARGET / "papers/2410.24164/v4/study.json").unlink(missing_ok=True)
doc = pymupdf.open()
doc.new_page().insert_text((72, 72), "PaperLab local upload acceptance test. No generated report yet.")
doc.save(ROOT / "tmp" / "upload-fixture.pdf")
print(TARGET)
