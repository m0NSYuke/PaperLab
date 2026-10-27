import json

from fastapi.testclient import TestClient

from app.knowledge import plain, tokens
from app.main import create_app


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data if isinstance(data, str) else json.dumps(data, ensure_ascii=False), encoding="utf-8")


def paper(root, pid, title, overview, claims=(), concepts=(), related=()):
    folder = root / "papers" / pid / "v1"
    write(folder / "metadata.json", {"schema_version": "1.0", "paper_id": pid, "version": "v1", "title": title,
                                     "topics": [], "reading_status": "unread", "analysis_status": "ready",
                                     "imported_at": "2026-10-26T00:00:00+00:00", "page_count": 9})
    write(folder / "report.json", {"overview": overview, "concept_links": list(concepts), "related_papers": list(related),
                                   "claims": [{"claim_id": f"c{i}", "text": t, "citations": [{"source_type": "pdf", "page": i + 3}]}
                                              for i, t in enumerate(claims)]})


def test_search_finds_report_claims_notes_memos_and_concepts(tmp_path):
    paper(tmp_path, "2501.00001", "Speculative Video Decoding", "**草稿模型先生成视频块，目标模型再验证。**",
          claims=["草稿块被整块接受或拒绝，接受率决定加速比。"], concepts=["speculative-decoding"])
    paper(tmp_path, "2501.00002", "Rule Rewards for Reasoning", "**只奖励最终答案，模型学会长推理。**",
          claims=["使用神经奖励模型时出现奖励黑客。"],
          related=[{"title": "Speculative Video Decoding（库中）", "relation": "compares_with"}])
    write(tmp_path / "papers" / "2501.00001" / "v1" / "notes.md", "我的想法：草稿长度应该按内容自适应调整。")
    write(tmp_path / "memos" / "memo-0123456789ab.md", "---\ntitle: 互教闭环\n---\n老师只给推理链不给答案，学生反馈后再迭代。")
    write(tmp_path / "concepts" / "index.json", {"concepts": [{"slug": "speculative-decoding", "name": "投机解码"}]})
    write(tmp_path / "concepts" / "speculative-decoding.md", "# 投机解码\n\n小模型先猜，大模型一次性批量验证草稿。")
    write(tmp_path / "lines.json", {"lines": [{"id": "video", "name": "视频加速", "kind": "idea",
                                              "papers": [{"key": "2501.00001/v1", "role": "基线", "why": ""}]}]})
    client = TestClient(create_app(tmp_path))

    hits = client.get("/api/knowledge/search", params={"q": "奖励黑客"}).json()["hits"]
    assert hits[0]["paper"] == "2501.00002/v1" and hits[0]["kind"] == "claim" and hits[0]["page"] == 3
    kinds = {h["kind"] for h in client.get("/api/knowledge/search", params={"q": "草稿"}).json()["hits"]}
    assert {"claim", "report", "note", "concept"} <= kinds
    memo = client.get("/api/knowledge/search", params={"q": "推理链"}).json()["hits"][0]
    assert memo["memo"] == "memo-0123456789ab" and memo["title"] == "互教闭环"
    assert client.get("/api/knowledge/search", params={"q": "  "}).json()["hits"] == []

    graph = client.get("/api/knowledge/graph").json()
    edges = {(e["source"], e["target"], e["type"]) for e in graph["edges"]}
    assert ("paper:2501.00001/v1", "concept:speculative-decoding", "uses") in edges
    assert ("paper:2501.00001/v1", "line:video", "in_line") in edges
    # A related paper named by title (with a 库中 suffix) becomes a paper–paper edge.
    assert ("paper:2501.00002/v1", "paper:2501.00001/v1", "relation") in edges
    related = client.get("/api/knowledge/related/2501.00001/v1").json()["related"]
    assert related[0]["key"] == "2501.00002/v1"

    # A new note is searchable without restarting: the index notices changed files.
    write(tmp_path / "papers" / "2501.00002" / "v1" / "notes.md", "复现时注意温度设置为零点七。")
    assert client.get("/api/knowledge/search", params={"q": "温度设置"}).json()["hits"][0]["kind"] == "note"


def test_tokens_and_plain_text():
    assert tokens("KV cache 投机解码") == ["kv", "cache", "投机", "机解", "解码"]
    assert plain(r"在 $64\times8$ 张 **H800** [sdvg-core]") == "在 64×8 张 H800"
