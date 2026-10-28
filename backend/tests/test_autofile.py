import json

from fastapi.testclient import TestClient

from app.autofile import autofile, guess_type, hits
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


def test_paper_types_come_from_the_report_else_the_title_and_stay_editable(tmp_path):
    assert guess_type("VGI-Bench: Probing Visual Intelligence") == "benchmark"
    assert guess_type("A Survey on World Models") == "survey"
    assert guess_type("DeepSeek-V3 Technical Report") == "technical_report"
    assert guess_type("What Drives Interactive Improvement from Feedback?") == "analysis"
    assert guess_type("Latent Action Pretraining from Videos") == "method"
    plain = add_paper(tmp_path, "2501.00001", "VideoPhy-2: A Physical Commonsense Evaluation", "")
    assert autofile(tmp_path, plain)["paper_type"] == "benchmark"
    triaged = add_paper(tmp_path, "2501.00002", "Small Models Struggle to Learn", "", "**x**")
    report = tmp_path / "papers/2501.00002/v1/report.json"
    write(report, json.loads(report.read_text(encoding="utf-8")) | {"triage": {"paper_type": "analysis"}})
    assert autofile(tmp_path, triaged)["paper_type"] == "analysis"
    client = TestClient(create_app(tmp_path))
    assert client.patch("/api/papers/2501.00002/v1", json={"paper_type": "survey"}).json()["paper_type"] == "survey"
    assert client.patch("/api/papers/2501.00002/v1", json={"paper_type": "poster"}).status_code == 422
    # A type the user chose is never overwritten by filing again.
    assert autofile(tmp_path, triaged, force=True)["paper_type"] == "survey"


def test_keyword_matching_respects_word_starts():
    assert hits("world simulator", "as world simulators of") == 1
    assert hits("vla", "openvla and vla models") == 1
    assert hits("robot", "robotic arms") == 1 and hits("rl", "world") == 0


def test_create_edit_and_delete_a_line_refiles_unfiled_papers(tmp_path):
    add_paper(tmp_path, "2501.00010", "Diffusion Policy for Dexterous Hands", "dexterous manipulation with diffusion policy")
    client = TestClient(create_app(tmp_path))
    assert client.get("/api/lines").json()["lines"] == []
    made = client.post("/api/lines", json={"name": "灵巧手操作", "kind": "idea", "question": "灵巧手怎样学会精细操作？",
                                           "keywords": ["dexterous, diffusion policy", "灵巧手", "Dexterous"]}).json()
    line = made["lines"][0]
    assert made["filed"] == 1 and line["id"].startswith("line-") and line["keywords"] == ["dexterous", "diffusion policy", "灵巧手"]
    assert line["papers"][0]["key"] == "2501.00010/v1" and line["papers"][0]["auto"] is True
    english = client.post("/api/lines", json={"name": "World Models", "keywords": []}).json()
    assert english["id"] == "world-models" and english["filed"] == 0
    edited = client.patch(f"/api/lines/{line['id']}", json={"name": "灵巧手", "kind": "direction", "keywords": ["dexterous"]}).json()
    assert edited["lines"][0]["name"] == "灵巧手" and edited["lines"][0]["kind"] == "direction"
    # A line that still holds ideas cannot be deleted; an empty one can, and its papers become unfiled.
    idea = client.post("/api/ideas", json={"line": line["id"], "title": "触觉反馈"}).json()
    assert client.delete(f"/api/lines/{line['id']}").status_code == 409
    client.delete(f"/api/ideas/{idea['id']}")
    after = client.delete(f"/api/lines/{line['id']}").json()
    assert [l["id"] for l in after["lines"]] == ["world-models"]


def test_auto_filing_can_be_switched_off_and_papers_filed_by_hand(tmp_path):
    write(tmp_path / "lines.json", {"lines": [{"id": "embodied", "name": "具身", "keywords": ["robot"]},
                                              {"id": "video", "name": "视频", "keywords": ["video"]}]})
    client = TestClient(create_app(tmp_path))
    assert client.get("/api/lines").json()["auto_file"] is True
    assert client.put("/api/lines/auto-file", json={"enabled": False}).json()["auto_file"] is False
    robot = add_paper(tmp_path, "2501.00020", "Robot learning from video", "a robot learns from video")
    assert autofile(tmp_path, robot)["filed"] == []  # switched off: stays unfiled
    # Filing one paper explicitly still works, and a paper can sit in several lines by hand.
    assert sorted(client.post("/api/papers/2501.00020/v1/autofile").json()["filed"]) == ["embodied", "video"]
    client.delete("/api/lines/video/papers/2501.00020/v1")
    client.put("/api/lines/video/papers/2501.00020/v1", json={})
    data = client.get("/api/lines").json()
    assert all(any(p["key"] == "2501.00020/v1" for p in l["papers"]) for l in data["lines"])
    assert '"auto_file": false' in (tmp_path / "lines.json").read_text(encoding="utf-8")
