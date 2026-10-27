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


def test_card_brief_takes_the_bold_takeaway_and_focus():
    from app.main import report_brief
    report = {"overview": "**一句话：先让小模型试做，质量不过关才让大模型重做。** 其余说明。[sdvg-core]\n\n第二段",
              "triage": {"depth": "selective", "focus": ["式 1", "表 2"], "problem": "慢", "user_context": ""}}
    brief = report_brief(report)
    assert brief["summary"] == "先让小模型试做，质量不过关才让大模型重做。"
    assert brief["focus"] == ["式 1", "表 2"] and brief["depth"] == "selective"
    # Older reports without triage fall back to the must-read pages.
    old = {"overview": "**VisualAD 学的是两种视觉参照。** 更多。", "reading_guide": {"must_read": [{"page": 4, "label": "式(2)", "why": ""}]}}
    assert report_brief(old)["focus"] == ["p.4 式(2)"] and report_brief(None)["summary"] == ""


def test_line_ideas_capture_score_compare_and_restore(tmp_path):
    client = TestClient(create_app(tmp_path))
    spark = client.post("/api/ideas", json={"line": "cot-teaching", "title": "学生只回传困惑点"}).json()
    assert spark["status"] == "spark" and spark["scores"]["novelty"] is None
    saved = client.put(f"/api/ideas/{spark['id']}", json={
        "line": "cot-teaching", "title": "学生只回传困惑点", "status": "exploring", "body": "不传答案，只传卡住的步骤。",
        "scores": {"novelty": 4, "feasibility": 3, "impact": 4, "cost": 2}, "pros": "信号便宜", "cons": "可能没有正确性信号",
        "next_step": "先在 GSM8K 小样本上试", "papers": ["2406.14629/v3"], "etag": spark["etag"]}).json()
    assert saved["scores"]["feasibility"] == 3 and saved["etag"] != spark["etag"]
    # A stale editor cannot overwrite newer content.
    assert client.put(f"/api/ideas/{spark['id']}", json={"title": "x", "etag": spark["etag"]}).status_code == 409
    assert client.put(f"/api/ideas/{spark['id']}", json={"title": "x", "scores": {"novelty": 6}, "etag": saved["etag"]}).status_code == 422
    hits = client.get("/api/knowledge/search", params={"q": "困惑点"}).json()["hits"]
    assert hits[0]["kind"] == "idea" and hits[0]["idea"] == spark["id"] and hits[0]["line"] == "cot-teaching"
    assert client.delete(f"/api/ideas/{spark['id']}").status_code == 200
    assert client.get("/api/ideas").json()["ideas"] == []
    assert client.post(f"/api/ideas/{spark['id']}/restore").json()["title"] == "学生只回传困惑点"
    assert len(client.get("/api/ideas").json()["ideas"]) == 1
    # ideas.json is user data and goes into backups.
    import zipfile
    status = client.post("/api/backup").json()
    with zipfile.ZipFile(tmp_path / ".runtime" / "backups" / status["last"]["file"]) as archive:
        assert "ideas.json" in archive.namelist()


def test_two_libraries_sharing_a_backup_folder_keep_their_own_snapshots(tmp_path):
    from app.backup import KEEP, Backups
    shared = tmp_path / "backups"
    mine, other = tmp_path / "mine", tmp_path / "other"
    (mine / "memos").mkdir(parents=True)
    note = mine / "memos" / "memo-0123456789ab.md"
    mine_backups, other_backups = Backups(mine, shared), Backups(other, shared)
    # An empty library writes nothing.
    assert other_backups.snapshot() is None and not shared.exists()
    for i in range(KEEP + 2):
        note.write_text(f"想法 {i}", encoding="utf-8")
        assert mine_backups.snapshot()
    (other / "memos").mkdir(parents=True)
    (other / "memos" / "memo-ba9876543210.md").write_text("另一台", encoding="utf-8")
    other_backups.snapshot()
    # Rotation in one library never deletes the other's snapshots.
    assert len(mine_backups.snapshots()) == KEEP and len(other_backups.snapshots()) == 1
    assert mine_backups.latest()["file"] != other_backups.latest()["file"]
