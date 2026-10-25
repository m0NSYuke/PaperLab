import base64

from fastapi.testclient import TestClient

from app.main import create_app

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def test_memo_lifecycle_keeps_markdown_files_and_history(tmp_path):
    client = TestClient(create_app(tmp_path))
    assert client.get("/api/memos").json() == {"memos": []}
    memo = client.post("/api/memos", json={"title": "自适应动作块", "tags": ["VLA", " #动作块 ", "VLA"]}).json()
    assert memo["id"].startswith("memo-") and memo["tags"] == ["VLA", "动作块"]

    image = client.post("/api/memos/assets", files={"file": ("shot.png", PNG, "image/png")}).json()["path"]
    assert image.startswith("assets/") and client.get(f"/api/memos/{image}").content == PNG
    body = f"置信度低时缩短 $H$。\n\n![截图]({image})"
    saved = client.put(f"/api/memos/{memo['id']}", json={"title": "自适应动作块：初稿", "tags": ["VLA"], "pinned": True, "body": body, "etag": memo["etag"]}).json()
    assert saved["body"] == body and saved["pinned"] and saved["etag"] != memo["etag"]

    # The file is plain Markdown with a small header; the image link works from the memos folder.
    text = (tmp_path / "memos" / f"{memo['id']}.md").read_text(encoding="utf-8")
    assert text.startswith("---\ntitle: 自适应动作块：初稿\n") and "pinned: true" in text and f"]({image})" in text
    assert list((tmp_path / "memos" / ".history").glob(f"{memo['id']}-*.md"))

    # A stale editor (old etag) cannot overwrite newer text.
    stale = client.put(f"/api/memos/{memo['id']}", json={"title": "x", "body": "x", "etag": memo["etag"]})
    assert stale.status_code == 409
    listed = client.get("/api/memos").json()["memos"]
    assert listed[0]["title"] == "自适应动作块：初稿" and listed[0]["images"] == 1 and "截图" not in listed[0]["excerpt"]


def test_delete_goes_to_trash_and_can_be_restored(tmp_path):
    client = TestClient(create_app(tmp_path))
    memo = client.post("/api/memos", json={"title": "要删的", "body": "内容"}).json()
    assert client.delete(f"/api/memos/{memo['id']}").status_code == 200
    assert client.get(f"/api/memos/{memo['id']}").status_code == 404
    assert client.get("/api/memos").json()["memos"] == []
    restored = client.post(f"/api/memos/{memo['id']}/restore").json()
    assert restored["body"] == "内容"
    assert client.post(f"/api/memos/{memo['id']}/restore").status_code == 404


def test_memo_routes_reject_bad_ids_files_and_foreign_writes(tmp_path):
    client = TestClient(create_app(tmp_path))
    assert client.get("/api/memos/..%2Fpapers").status_code == 404
    assert client.get("/api/memos/memo-xyz").status_code == 404
    assert client.get("/api/memos/assets/../../secret.png").status_code == 404
    assert client.post("/api/memos/assets", files={"file": ("a.txt", b"hi", "text/plain")}).status_code == 415
    assert client.post("/api/memos", json={"title": "x"}, headers={"Origin": "https://evil.example"}).status_code == 403
