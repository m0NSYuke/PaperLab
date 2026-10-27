import json

from fastapi.testclient import TestClient

from app.main import create_app


def paper(root, pid, topics):
    folder = root / "papers" / pid / "v1"
    folder.mkdir(parents=True)
    (folder / "metadata.json").write_text(json.dumps({
        "schema_version": "1.0", "paper_id": pid, "version": "v1", "title": f"Paper {pid}", "topics": topics,
        "reading_status": "unread", "analysis_status": "not_analyzed", "imported_at": "2026-10-27T00:00:00+00:00",
        "page_count": 1}), encoding="utf-8")
    (folder / "notes.md").write_text("我的笔记", encoding="utf-8")
    assets = root / "local-assets" / pid / "v1"
    assets.mkdir(parents=True)
    (assets / "paper.pdf").write_bytes(b"%PDF")


def names(view):
    return {t["name"]: t["count"] for t in view["tags"]}


def test_tags_can_be_added_renamed_and_deleted_everywhere(tmp_path):
    paper(tmp_path, "2501.00001", ["VLA", "自定义"])
    paper(tmp_path, "2501.00002", ["VLA"])
    client = TestClient(create_app(tmp_path))
    tags = names(client.get("/api/tags").json())
    assert tags["VLA"] == 2 and tags["自定义"] == 1 and tags["视频生成"] == 0  # built-ins until the user edits
    assert "触觉" in names(client.post("/api/tags", json={"name": "触觉"}).json())
    renamed = client.post("/api/tags/rename", json={"old": "VLA", "new": "视觉-语言-动作"}).json()
    assert renamed["papers_changed"] == 2 and names(renamed)["视觉-语言-动作"] == 2 and "VLA" not in names(renamed)
    # Renaming onto an existing tag merges, without duplicates on a paper.
    merged = client.post("/api/tags/rename", json={"old": "自定义", "new": "视觉-语言-动作"}).json()
    meta = json.loads((tmp_path / "papers/2501.00001/v1/metadata.json").read_text(encoding="utf-8"))
    assert meta["topics"] == ["视觉-语言-动作"] and names(merged)["视觉-语言-动作"] == 2
    gone = client.post("/api/tags/delete", json={"name": "视觉-语言-动作"}).json()
    assert gone["papers_changed"] == 2 and "视觉-语言-动作" not in names(gone)
    # Tag names with "/" work because they travel in the body.
    assert "Diffusion / Flow Matching" not in names(client.post("/api/tags/delete", json={"name": "Diffusion / Flow Matching"}).json())


def test_deleting_a_paper_goes_to_trash_and_restore_puts_it_back_in_its_lines(tmp_path):
    paper(tmp_path, "2501.00003", [])
    paper(tmp_path, "2501.00004", [])
    (tmp_path / "lines.json").write_text(json.dumps({"lines": [{"id": "demo", "name": "演示", "papers": [
        {"key": "2501.00004/v1", "role": "第一篇"}, {"key": "2501.00003/v1", "role": "基线", "why": "对比用"}]}]},
        ensure_ascii=False), encoding="utf-8")
    client = TestClient(create_app(tmp_path))
    deleted = client.delete("/api/papers/2501.00003/v1").json()
    assert [p["paper_id"] for p in client.get("/api/papers").json()["papers"]] == ["2501.00004"]
    assert not (tmp_path / "papers/2501.00003").exists() or not any((tmp_path / "papers/2501.00003").iterdir())
    assert [p["key"] for p in client.get("/api/lines").json()["lines"][0]["papers"]] == ["2501.00004/v1"]
    trash = tmp_path / ".trash" / deleted["trash_id"]
    assert (trash / "papers" / "notes.md").read_text(encoding="utf-8") == "我的笔记"
    restored = client.post(f"/api/papers/restore/{deleted['trash_id']}").json()
    assert restored["paper_id"] == "2501.00003" and (tmp_path / "local-assets/2501.00003/v1/paper.pdf").exists()
    entry = client.get("/api/lines").json()["lines"][0]["papers"][1]
    assert entry["key"] == "2501.00003/v1" and entry["role"] == "基线" and not trash.exists()
    assert client.post("/api/papers/restore/nonexistent-v1-1").status_code == 404
    assert client.delete("/api/papers/2501.09999/v1").status_code == 404
