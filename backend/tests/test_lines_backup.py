import json
import zipfile

from fastapi.testclient import TestClient

from app.main import create_app


def test_lines_are_optional_and_validated(tmp_path):
    client = TestClient(create_app(tmp_path))
    assert client.get("/api/lines").json() == {"schema_version": "1.0", "lines": []}
    (tmp_path / "lines.json").write_text(json.dumps({"lines": [{
        "id": "cot-teaching", "name": "无答案 CoT 互教", "kind": "idea", "question": "不给答案能否互相变强？",
        "papers": [{"key": "2406.14629/v3", "role": "最接近的前作", "why": "每轮都用了标签"}]}]}, ensure_ascii=False), encoding="utf-8")
    line = client.get("/api/lines").json()["lines"][0]
    assert line["kind"] == "idea" and line["papers"][0]["key"] == "2406.14629/v3"
    (tmp_path / "lines.json").write_text('{"lines": [{"id": "Bad Id", "name": "x"}]}', encoding="utf-8")
    assert client.get("/api/lines").status_code == 422


def test_backup_snapshots_user_data_and_skips_when_unchanged(tmp_path):
    client = TestClient(create_app(tmp_path))
    notes = tmp_path / "papers" / "2406.14629" / "v3" / "notes.md"
    notes.parent.mkdir(parents=True)
    notes.write_text("我的笔记", encoding="utf-8")
    (tmp_path / "memos").mkdir()
    (tmp_path / "memos" / "memo-0123456789ab.md").write_text("---\ntitle: 想法\n---\n", encoding="utf-8")
    (tmp_path / "local-assets" / "2406.14629" / "v3").mkdir(parents=True)
    (tmp_path / "local-assets" / "2406.14629" / "v3" / "paper.pdf").write_bytes(b"%PDF arxiv copy")
    (tmp_path / "local-assets" / "local-abc" / "v1").mkdir(parents=True)
    (tmp_path / "local-assets" / "local-abc" / "v1" / "paper.pdf").write_bytes(b"%PDF only copy")

    status = client.get("/api/backup").json()
    assert status["auto"] is False and status["last"] is None
    first = client.post("/api/backup").json()
    assert first["count"] == 1 and first["error"] == ""
    with zipfile.ZipFile(tmp_path / ".runtime" / "backups" / first["last"]["file"]) as archive:
        names = set(archive.namelist())
        assert archive.read("papers/2406.14629/v3/notes.md").decode("utf-8") == "我的笔记"
    # Notes, memos and imported local PDFs are kept; re-downloadable arXiv PDFs are not.
    assert {"memos/memo-0123456789ab.md", "local-assets/local-abc/v1/paper.pdf"} <= names
    assert "local-assets/2406.14629/v3/paper.pdf" not in names

    assert client.post("/api/backup").json()["count"] == 1  # nothing changed, no new zip
    notes.write_text("我的笔记，补一句", encoding="utf-8")
    second = client.post("/api/backup").json()
    assert second["count"] == 2 and second["last"]["file"] != first["last"]["file"]
