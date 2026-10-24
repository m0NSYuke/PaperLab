"""Deterministic helpers for the Codex $paper workflow; never calls a model."""
import argparse
import json
from pathlib import Path
from .paths import APP_ROOT, data_root
from .importer import import_arxiv, import_pdf, pdf_index
from .models import Metadata, Report, Correction, ResearchInput, DraftResult, DraftEdit
from .reports import publish_report
from .storage import data_lock, paper_dir, read_json, safe_path, sha256, write_json
from .sources import prepare_sources, source_summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=data_root())
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("prepare")
    p.add_argument("reference")
    p.add_argument("--version", default="v1")
    p = commands.add_parser("publish")
    p.add_argument("report", type=Path)
    p = commands.add_parser("index")
    p.add_argument("paper_id")
    p.add_argument("--version", required=True)
    commands.add_parser("schemas")
    args = parser.parse_args()
    root = args.root.absolute()
    if args.command == "schemas":
        for name, model in [("metadata", Metadata), ("report", Report), ("correction", Correction),
                            ("research-input", ResearchInput), ("research-result", DraftResult), ("research-edit", DraftEdit)]:
            write_json(APP_ROOT / "docs" / "schemas" / f"{name}.schema.json", model.model_json_schema())
    elif args.command == "index":
        with data_lock(root):
            folder = paper_dir(root, args.paper_id, args.version)
            assets = paper_dir(root, args.paper_id, args.version, True)
            meta = Metadata.model_validate(read_json(safe_path(root, str(folder.relative_to(root)), "metadata.json")))
            raw = safe_path(root, str(assets.relative_to(root)), "paper.pdf").read_bytes()
            if sha256(raw) != meta.pdf_sha256:
                raise ValueError("PDF hash differs from pinned metadata")
            write_json(safe_path(root, str(assets.relative_to(root)), "pages.json"), pdf_index(raw))
        print("Rebuilt PDF text index; report and human data unchanged")
    elif args.command == "prepare":
        ref = args.reference
        if ref.startswith("local-"):
            meta = Metadata.model_validate(read_json(paper_dir(root, ref, args.version) / "metadata.json"))
        elif Path(ref).is_file():
            # CLI explicit file input is user-authorized. API never accepts disk paths.
            meta = import_pdf(root, Path(ref).read_bytes(), Path(ref).name)
        else:
            meta = import_arxiv(root, ref)
        bundle, source_path = prepare_sources(root, meta.paper_id, meta.version)
        meta = Metadata.model_validate(read_json(paper_dir(root, meta.paper_id, meta.version) / "metadata.json"))
        print(json.dumps({"metadata": meta.model_dump(),
                          "pages": str(paper_dir(root, meta.paper_id, meta.version, True) / "pages.json"),
                          "rap": source_summary(bundle), "rap_source": str(source_path),
                          "report_folder": str(paper_dir(root, meta.paper_id, meta.version))}, ensure_ascii=False, indent=2))
    else:
        result = publish_report(root, read_json(args.report))
        print(f"Published {result.paper_id}{result.version} revision {result.revision}: {result.analysis_status}")


if __name__ == "__main__":
    main()
