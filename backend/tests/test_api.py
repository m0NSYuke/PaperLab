import io
import json
import tarfile
from pathlib import Path

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.importer import extract_source, import_pdf, parse_arxiv
from app.main import create_app
from app.models import Citation, Report
from app.reports import publish_report
from app.storage import atomic_write, paper_dir, read_json, safe_path, sha256


@pytest.fixture
def pdf_bytes():
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Evidence on page one. The action horizon is 50.")
    doc.new_page().insert_text((72, 72), "A second page with supporting evidence.")
    return doc.tobytes()


@pytest.fixture
def env(tmp_path, pdf_bytes):
    meta = import_pdf(tmp_path, pdf_bytes, "example.pdf", "A real PDF fixture")
    client = TestClient(create_app(tmp_path))
    return tmp_path, meta, client, f"/api/papers/{meta.paper_id}/{meta.version}"


def report_for(meta):
    citation = {"paper_id": meta.paper_id, "version": meta.version, "page": 1,
                "quote": "The action horizon is 50.", "verification": "verified"}
    return {"paper_id": meta.paper_id, "version": meta.version, "analysis_status": "ready", "overview": "Overview",
            "motivation": "Motivation", "contributions": "Contributions", "method": "Method", "mathematics": "Math",
            "training": "Training", "inference": "Inference", "experiments": [], "limitations": "Limits",
            "related_papers": [], "claims": [{"claim_id": "horizon", "section": "method", "claim_type": "paper_fact",
                "text": "Action horizon 50", "citations": [citation], "evidence_status": "supported"}],
            "equations": [], "concept_links": [], "quality_checks": ["Fixture evidence checked"]}


def test_import_list_pdf_and_schema(env, pdf_bytes):
    root, meta, client, prefix = env
    assert client.get("/api/health").json()["local_only"]
    assert client.get("/api/papers").json()["papers"][0]["title"] == "A real PDF fixture"
    assert client.get(prefix + "/pdf").content == pdf_bytes
    assert meta.pdf_sha256 == sha256(pdf_bytes)
    assert meta.page_count == 2
    assert client.get(prefix + "/report").json() == {"report": None}
    assert client.get(prefix + "/source-index").json()["schema_version"] == "1.0"


def test_upload_valid_and_invalid(env, pdf_bytes):
    _, _, client, _ = env
    response = client.post("/api/import/pdf", files={"file": ("paper.pdf", pdf_bytes, "application/pdf")})
    assert response.status_code == 200
    assert client.post("/api/import/pdf", files={"file": ("bad.pdf", b"not a pdf")}).status_code == 422


def test_notes_persist_across_server_restart_and_conflicts(env):
    root, _, client, prefix = env
    initial = client.get(prefix + "/notes").json()
    result = client.put(prefix + "/notes", json={"content": "# 我的理解\n\n$A_t$", "etag": initial["etag"]})
    assert result.status_code == 200
    restarted = TestClient(create_app(root))
    assert restarted.get(prefix + "/notes").json()["content"] == "# 我的理解\n\n$A_t$"
    assert client.put(prefix + "/notes", json={"content": "stale", "etag": initial["etag"]}).status_code == 409
    assert restarted.get(prefix + "/notes").json() == result.json()


def test_note_images_are_stored_beside_notes(env):
    root, _, client, prefix = env
    png = b"\x89PNG\r\n\x1a\n" + b"pixels"
    saved = client.post(prefix + "/note-assets", files={"file": ("shot.png", png, "image/png")})
    assert saved.status_code == 200
    path = saved.json()["path"]
    assert path.startswith("note-assets/") and path.endswith(".png")
    assert client.get(f"{prefix}/{path}").content == png
    assert client.post(prefix + "/note-assets", files={"file": ("x.svg", b"<svg/>", "image/svg+xml")}).status_code == 415
    assert client.get(prefix + "/note-assets/..%2Fnotes.md").status_code == 404


def test_corrections_append_and_regeneration_protects_human_data(env):
    root, meta, client, prefix = env
    payload = report_for(meta)
    publish_report(root, payload)
    notes = client.get(prefix + "/notes").json()
    client.put(prefix + "/notes", json={"content": "Private human notes", "etag": notes["etag"]})
    correction = {"claim_id": "horizon", "type": "mathematical_error", "original_text": "Action horizon 50",
                  "corrected_text": "My human-confirmed explanation", "reason": "Test human preservation"}
    assert client.post(prefix + "/corrections", json=correction).status_code == 200
    before = (paper_dir(root, meta.paper_id, meta.version) / "corrections.jsonl").read_bytes()
    result = publish_report(root, payload)
    assert result.revision == 2
    assert result.analysis_status == "needs_review"
    assert result.claims[0].evidence_status == "needs_review"
    assert (paper_dir(root, meta.paper_id, meta.version) / "corrections.jsonl").read_bytes() == before
    assert client.get(prefix + "/notes").json()["content"] == "Private human notes"
    correction["status"] = "dismissed"
    client.post(prefix + "/corrections", json=correction)
    assert len(client.get(prefix + "/corrections").json()["corrections"]) == 2
    assert publish_report(root, payload).analysis_status == "ready"


@pytest.mark.parametrize("tamper", ["quote", "page", "version", "unsupported"])
def test_fabricated_citation_never_published(env, tamper):
    root, meta, _, _ = env
    payload = report_for(meta)
    first = publish_report(root, payload)
    previous = (paper_dir(root, meta.paper_id, meta.version) / "report.json").read_bytes()
    c = payload["claims"][0]["citations"][0]
    if tamper == "quote": c["quote"] = "Invented evidence"
    if tamper == "page": c["page"] = 4
    if tamper == "version": c["version"] = "v99"
    if tamper == "unsupported": payload["claims"][0]["citations"] = []
    with pytest.raises(ValueError): publish_report(root, payload)
    assert (paper_dir(root, meta.paper_id, meta.version) / "report.json").read_bytes() == previous


@pytest.mark.parametrize("prose", ["τ=.25 时 A^τ=(0.5,2.5)", "权重 W_cls 与 \\alpha"])
def test_unreadable_notation_never_published(env, prose):
    root, meta, _, _ = env
    payload = report_for(meta)
    payload["mathematics"] = prose
    with pytest.raises(ValueError, match="notation"):
        publish_report(root, payload)
    payload["mathematics"] = "$\\tau=0.25$ 时 $A^{\\tau}=(0.5,\\,2.5)$；版本 v1.2 与 paper_id 不受影响"
    assert publish_report(root, payload).mathematics.startswith("$")


def test_wrong_origin_host_and_body_limit(env):
    _, _, client, prefix = env
    assert client.patch(prefix, json={"reading_status": "completed"}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.patch(prefix, json={"reading_status": "completed"}, headers={"Origin": "null"}).status_code == 403
    assert client.patch(prefix, json={"reading_status": "completed"}, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert client.patch(prefix, json={"reading_status": "completed"}, headers={"Origin": "http://127.0.0.1:8000"}).status_code == 200
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
    assert client.post("/api/import/arxiv", content=b"{}", headers={"Content-Length": str(200 * 1024 * 1024)}).status_code == 413


def test_invalid_json_missing_pdf_and_corrupt_metadata_are_recoverable(env):
    root, meta, client, prefix = env
    atomic_write(paper_dir(root, meta.paper_id, meta.version) / "report.json", "{bad json")
    assert client.get(prefix + "/report").status_code == 422
    (paper_dir(root, meta.paper_id, meta.version, True) / "paper.pdf").unlink()
    assert client.get(prefix + "/pdf").status_code == 404
    atomic_write(paper_dir(root, meta.paper_id, meta.version) / "metadata.json", "{}")
    listing = client.get("/api/papers").json()
    assert listing["papers"] == []
    assert listing["warnings"]


@pytest.mark.parametrize("value,expected", [("2410.24164", ("2410.24164", None)), ("2410.24164v4", ("2410.24164", "v4")),
    ("https://arxiv.org/pdf/2410.24164v4.pdf", ("2410.24164", "v4")), ("https://arxiv.org/abs/2410.24164", ("2410.24164", None)),
    ("math/0312530v1", ("math/0312530", "v1"))])
def test_arxiv_parser(value, expected):
    assert parse_arxiv(value) == expected


@pytest.mark.parametrize("value", ["https://evil.example/2410.24164", "../../notes", "2410.24164v0", "file:///etc/passwd", "https://arxiv.org/abs/2410.24164?redirect=evil"])
def test_invalid_arxiv(value):
    with pytest.raises(ValueError): parse_arxiv(value)


def test_path_traversal_and_symlinks(tmp_path):
    with pytest.raises(ValueError): safe_path(tmp_path, "..", "outside")
    with pytest.raises(ValueError): paper_dir(tmp_path, "..", "v1")
    with pytest.raises(ValueError): paper_dir(tmp_path, "2410.24164", "v1/../../")
    # Windows without developer mode may forbid creating symlinks.
    target = tmp_path / "real"
    target.mkdir()
    link = tmp_path / "link"
    try: link.symlink_to(target, target_is_directory=True)
    except OSError: pytest.skip("OS does not permit symlink creation")
    with pytest.raises(ValueError): safe_path(tmp_path, "link", "note.md")


def test_source_archive_does_not_extract_traversal_or_links(tmp_path):
    def archive(name, kind=tarfile.REGTYPE):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
            info = tarfile.TarInfo(name)
            info.type = kind
            info.size = 3 if kind == tarfile.REGTYPE else 0
            info.linkname = "outside"
            tar.addfile(info, io.BytesIO(b"abc") if info.size else None)
        return buffer.getvalue()
    with pytest.raises(ValueError): extract_source(archive("../outside.tex"), tmp_path)
    assert extract_source(archive("link.tex", tarfile.SYMTYPE), tmp_path) == 0
    assert not (tmp_path / "link.tex").exists()
    assert extract_source(archive("safe/main.tex"), tmp_path) == 1
    assert (tmp_path / "safe" / "main.tex").read_text() == "abc"


def test_save_failure_keeps_previous_notes(env, monkeypatch):
    _, _, client, prefix = env
    notes = client.get(prefix + "/notes").json()
    client.put(prefix + "/notes", json={"content": "old", "etag": notes["etag"]})
    def fail(*args, **kwargs): raise OSError("disk full")
    monkeypatch.setattr("app.main.atomic_write", fail)
    current = client.get(prefix + "/notes").json()
    assert client.put(prefix + "/notes", json={"content": "new", "etag": current["etag"]}).status_code == 500
    assert client.get(prefix + "/notes").json()["content"] == "old"


def test_pinned_arxiv_import_latest_missing_source_and_repair(tmp_path, monkeypatch):
    from app.importer import import_arxiv
    calls = []
    def mock_fetch(url, limit=100*1024*1024):
        calls.append(url)
        if "/abs/" in url:
            return b'<meta name="citation_title" content="Pinned paper"><meta name="citation_author" content="Author"><meta name="citation_date" content="2024/10/31">[v1] [v4]'
        if "/src/" in url:
            import httpx
            raise httpx.ConnectError("No source available")
        doc = pymupdf.open()
        doc.new_page().insert_text((72,72), "arXiv:2410.24164v4. The exact pinned acceptance version.")
        return doc.tobytes()
    monkeypatch.setattr("app.importer.fetch", mock_fetch)
    meta = import_arxiv(tmp_path, "2410.24164")
    assert meta.version == "v4" and meta.warnings
    assert "https://arxiv.org/pdf/2410.24164v4" in calls
    with pytest.raises(ValueError): import_arxiv(tmp_path, "2410.24164v99")
    before = len(calls)
    assert import_arxiv(tmp_path, "2410.24164v4").pdf_sha256 == meta.pdf_sha256
    assert len(calls) == before  # Existing version is immutable and works offline.


def test_reimport_restores_missing_pdf_without_overwriting_human_files(env, pdf_bytes):
    from app.importer import pdf_index, store_import
    root, meta, _, _ = env
    assets = paper_dir(root, meta.paper_id, meta.version, True)
    folder = paper_dir(root, meta.paper_id, meta.version)
    atomic_write(folder / "notes.md", "Human notes")
    (assets / "paper.pdf").unlink()
    store_import(root, meta, pdf_bytes, pdf_index(pdf_bytes))
    assert (assets / "paper.pdf").read_bytes() == pdf_bytes
    assert (folder / "notes.md").read_text() == "Human notes"
    changed = pymupdf.open()
    changed.new_page().insert_text((72,72), "Changed content")
    with pytest.raises(ValueError): store_import(root, meta, changed.tobytes(), pdf_index(changed.tobytes()))


def test_production_mjs_mime_and_static_traversal(tmp_path):
    dist = tmp_path / "frontend" / "dist"
    atomic_write(dist / "index.html", "<main>PaperLab</main>")
    atomic_write(dist / "assets" / "worker.mjs", "export const value = 1;")
    client = TestClient(create_app(tmp_path))
    assert "javascript" in client.get("/assets/worker.mjs").headers["content-type"]
    assert client.get("/assets/%2e%2e/%2e%2e/%2e%2e/secret").status_code in {404,422}


def test_report_replacement_rolls_back_on_failure(env, monkeypatch):
    import app.reports as reports
    root, meta, _, _ = env
    payload = report_for(meta)
    publish_report(root, payload)
    folder = paper_dir(root, meta.paper_id, meta.version)
    names = ["report.json", "report.md", "source-index.json", "metadata.json"]
    before = {name: (folder / name).read_bytes() for name in names}
    original = reports.atomic_write
    calls = 0
    def fail_once(path, data):
        nonlocal calls
        calls += 1
        if calls == 2: raise OSError("Simulated interrupted replacement")
        original(path, data)
    monkeypatch.setattr(reports, "atomic_write", fail_once)
    with pytest.raises(OSError): publish_report(root, payload)
    assert all((folder / name).read_bytes() == before[name] for name in names)


def test_windows_transient_file_sharing_retry_preserves_old_file(tmp_path, monkeypatch):
    import app.storage as storage
    path = tmp_path / "notes.md"
    atomic_write(path, "old human notes")
    replace = storage.os.replace
    calls = 0
    def transient(src, dst):
        nonlocal calls
        calls += 1
        if calls <= 2:
            assert path.read_text() == "old human notes"
            raise PermissionError("Windows sharing violation")
        replace(src, dst)
    monkeypatch.setattr(storage.os, "replace", transient)
    monkeypatch.setattr(storage.time, "sleep", lambda _: None)
    atomic_write(path, "new saved notes")
    assert calls == 3 and path.read_text() == "new saved notes"
    def permanent(*args): raise PermissionError("Permanent permission failure")
    monkeypatch.setattr(storage.os, "replace", permanent)
    with pytest.raises(PermissionError): atomic_write(path, "must not replace")
    assert path.read_text() == "new saved notes"
    assert not list(tmp_path.glob("*.tmp"))


def test_report_v11_reading_guide_and_self_test(env):
    root, meta, client, prefix = env
    payload = report_for(meta)
    citation = payload["claims"][0]["citations"][0]
    payload["reading_guide"] = {"first_pass": [{"page": 1, "label": "Abstract", "why": "problem"}],
                                "must_read": [{"page": 2, "label": "Method"}]}
    payload["self_test"] = [{"question_id": "q1", "level": "recall", "question": "Horizon?", "answer": "50",
                             "citations": [citation]}]
    report = publish_report(root, payload)
    assert report.schema_version == "1.1" and report.self_test[0].answer == "50"
    body = client.get(prefix + "/report").json()["report"]
    assert body["reading_guide"]["must_read"][0]["page"] == 2
    assert "## Self test" in (paper_dir(root, meta.paper_id, meta.version) / "report.md").read_text(encoding="utf-8")
    bad = report_for(meta)
    bad["reading_guide"] = {"first_pass": [{"page": 9, "label": "Out of range"}]}
    with pytest.raises(ValueError, match="Reading guide page"):
        publish_report(root, bad)
    fake = report_for(meta)
    fake["self_test"] = [{"question_id": "q1", "question": "Q", "answer": "A",
                          "citations": [dict(citation, quote="not on the page")]}]
    with pytest.raises(ValueError, match="Citation quote"):
        publish_report(root, fake)


def test_report_v10_still_valid(env):
    _, meta, _, _ = env
    payload = report_for(meta) | {"schema_version": "1.0"}
    assert Report.model_validate(payload).reading_guide is None


def test_study_roundtrip_conflict_and_overview(env):
    root, meta, client, prefix = env
    first = client.get(prefix + "/study").json()
    assert first["study"]["passes"] == [] and first["etag"] == sha256(b"")
    study = first["study"] | {"passes": [1], "judgment": {"novelty": 4, "effectiveness": 3, "problem_size": 5},
                              "tests": [{"question_id": "q1", "my_answer": "50", "verdict": "got_it"}],
                              "ideas": [{"idea_id": "idea_abc123", "text": "Try shorter chunks"}]}
    saved = client.put(prefix + "/study", json={"study": study, "etag": first["etag"]})
    assert saved.status_code == 200
    stale = client.put(prefix + "/study", json={"study": study, "etag": first["etag"]})
    assert stale.status_code == 409
    overview = client.get("/api/study/overview").json()
    summary = overview["papers"][f"{meta.paper_id}/{meta.version}"]
    assert summary == {"passes": [1], "tests_answered": 1, "tests_mastered": 1, "value_score": 60, "ideas": 1}
    assert overview["ideas"][0]["text"] == "Try shorter chunks"
    # Report regeneration must not touch human study data.
    publish_report(root, report_for(meta))
    assert client.get(prefix + "/study").json()["etag"] == saved.json()["etag"]
    bad = study | {"judgment": {"novelty": 9}}
    assert client.put(prefix + "/study", json={"study": bad, "etag": saved.json()["etag"]}).status_code == 422


def test_highlights_add_edit_delete(env):
    root, meta, client, prefix = env
    assert client.get(prefix + "/highlights").json() == {"highlights": []}
    rect = {"page": 2, "x": 0.1, "y": 0.2, "w": 0.5, "h": 0.02}
    made = client.post(prefix + "/highlights", json={"text": "supporting evidence", "color": "green",
                                                     "rects": [rect, {**rect, "page": 1}]}).json()
    assert made["page"] == 1 and made["highlight_id"].startswith("hl_") and made["note"] == ""
    hid = made["highlight_id"]
    edited = client.patch(f"{prefix}/highlights/{hid}", json={"note": "关键证据", "color": "pink"}).json()
    assert (edited["note"], edited["color"]) == ("关键证据", "pink")
    assert client.get(prefix + "/highlights").json()["highlights"][0]["note"] == "关键证据"
    assert client.post(prefix + "/highlights", json={"text": "x", "color": "red", "rects": [rect]}).status_code == 422
    assert client.post(prefix + "/highlights", json={"text": "x", "rects": [{**rect, "w": 2}]}).status_code == 422
    assert client.patch(f"{prefix}/highlights/hl_missing", json={"note": "x"}).status_code == 404
    assert client.delete(f"{prefix}/highlights/{hid}").json() == {"deleted": True}
    assert client.get(prefix + "/highlights").json() == {"highlights": []}
    assert list((paper_dir(root, meta.paper_id, meta.version) / ".history").glob("highlights-*.json"))
