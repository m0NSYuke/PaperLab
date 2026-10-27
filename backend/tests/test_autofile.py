import json

from fastapi.testclient import TestClient

from app.autofile import autofile, hits
from app.main import create_app
from app.models import Metadata


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def add_paper(root, pid, title, first_page, report=None):
    write(root / "papers" / pid / "v1" / "metadata.json", {
        "schema_version": "1.0", "paper_id": pid, "version": "v1", "title": title, "topics": [],
        "reading_status": "unread", "analysis_status": "ready" if report else "not_analyzed",
        "imported_at": "2026-10-27T00:00:00+00:00", "page_count": 1})
    write(root / "local-assets" / pid / "v1" / "pages.json", {"pages": [{"page": 1, "text": first_page}]})
    if report:
        write(root / "papers" / pid / "v1" / "report.json", {"overview": report, "claims": []})
    return Metadata.model_validate(json.loads((root / "papers" / pid / "v1" / "metadata.json").read_text(encoding="utf-8")))


def lines(root):
    return json.loads((root / "lines.json").read_text(encoding="utf-8"))["lines"]


def test_new_import_joins_the_matching_line_and_gets_tags(tmp_path):
    add_paper(tmp_path, "2402.15391", "Genie: Generative Interactive Environments", "world model from videos",
              "**Genie 只看游戏视频学出可操控的世界模型。** latent action world model")
    add_paper(tmp_path, "2604.17397", "Speculative Decoding for Autoregressive Video Generation", "draft model",
              "**SDVG 用小模型草稿加速视频生成。** speculative decoding speedup video")
    write(tmp_path / "lines.json", {"lines": [
        {"id": "embodied", "name": "具身与世界模型", "keywords": ["world model", "world simulator", "robot"],
         "papers": [{"key": "2402.15391/v1", "role": "来源"}]},
        {"id": "video-speed", "name": "视频加速", "keywords": ["speculative decoding", "speedup"],
         "papers": [{"key": "2604.17397/v1", "role": "基线"}]}]})
    sora = add_paper(tmp_path, "2402.17177", "Video generation models as world simulators",
                     "Sora is a text-to-video model that can serve as a world simulator of the physical world.")
    result = autofile(tmp_path, sora)
    assert result["filed"] == ["embodied"]
    entry = next(p for p in lines(tmp_path)[0]["papers"] if p["key"] == "2402.17177/v1")
    assert entry["auto"] is True and entry["role"] == "自动归入" and "world simulator" in entry["why"]
    meta = json.loads((tmp_path / "papers/2402.17177/v1/metadata.json").read_text(encoding="utf-8"))
    assert "World Model" in meta["topics"] and "视频生成" in meta["topics"]
    # Filing again does not duplicate, and an unrelated paper stays unfiled.
    assert autofile(tmp_path, sora)["filed"] == []
    other = add_paper(tmp_path, "2501.00009", "Protein folding with graph networks", "molecules and proteins")
    assert autofile(tmp_path, other)["filed"] == []

    client = TestClient(create_app(tmp_path))
    # Confirming clears the auto flag and the placeholder role; moving and removing edit lines.json.
    confirmed = client.put("/api/lines/embodied/papers/2402.17177/v1", json={}).json()
    entry = next(p for p in confirmed["lines"][0]["papers"] if p["key"] == "2402.17177/v1")
    assert not entry.get("auto") and entry["role"] == ""
    client.put("/api/lines/video-speed/papers/2501.00009/v1", json={"role": "旁支"})
    assert {"key": "2501.00009/v1", "role": "旁支", "why": "", "auto": False} in client.get("/api/lines").json()["lines"][1]["papers"]
    client.delete("/api/lines/video-speed/papers/2501.00009/v1")
    assert all(p["key"] != "2501.00009/v1" for p in lines(tmp_path)[1]["papers"])
    # The saved file stays compact and hand-editable.
    raw = (tmp_path / "lines.json").read_text(encoding="utf-8")
    assert '"auto": false' not in raw and '"keywords"' in raw


def test_keyword_matching_respects_word_starts():
    assert hits("world simulator", "as world simulators of") == 1
    assert hits("vla", "openvla and vla models") == 1
    assert hits("robot", "robotic arms") == 1 and hits("rl", "world") == 0
