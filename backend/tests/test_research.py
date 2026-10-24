import json
import os
import threading
from pathlib import Path

import pytest

from app.models import now
from app.research import ResearchInput, ResearchService
from app.skill_library import CATALOG, skill_context
from app.storage import atomic_write, paper_dir, write_json
from app.workspace import CodexJobs
from test_api import env, pdf_bytes
from test_workspace import wait_job

PROJECT = Path(__file__).resolve().parents[2]


def test_all_exposed_writing_resource_routes_exist_and_match_pinned_hashes():
    # Exercise every section/journal/language combination offered by the UI
    # against real installed assets, including the differing upstream axes.
    for skill in ("nature-writing", "nature-polishing"):
        for section in ("title", "abstract", "intro", "related-work", "method", "experiments", "discussion", "conclusion"):
            for journal in ("generic", "nature", "nature-family", "nat-comms", "nat-mach-intell"):
                for language,material in [("zh","evidence"),("en","evidence"),("en","中文材料")]:
                    context = skill_context(PROJECT,skill,section,language,journal,material)
                    assert context["resources"] and context["commit"]
    context = skill_context(PROJECT,"nature-polishing",journal="nature-family")
    assert any(r["path"].endswith("journal/generic.md") for r in context["resources"])


@pytest.fixture
def research_env(env):
    root, meta, client, prefix = env
    manifest = json.loads((PROJECT / "docs/nature-skills-installation.json").read_text(encoding="utf-8"))
    resources = {s[0] + "/SKILL.md" for s in CATALOG}
    resources.add("nature-shared/SKILL.md")
    for row in CATALOG:
        if row[4] == "web":
            resources.update(r["path"] for r in skill_context(PROJECT, row[0])["resources"])
    # Include only the selected trusted resources; no scripts are executed.
    for relative in resources:
        atomic_write(root / ".agents/skills" / relative, (PROJECT / ".agents/skills" / relative).read_bytes())
    write_json(root / "docs/nature-skills-installation.json", manifest)
    manager = CodexJobs(root, runner=lambda *args: ({"title":"测试草稿", "markdown":"【测试生成结果】证据不足处保留待补充。", "warnings":["隔离测试夹具，不代表真实 AI 调用。"], "citations":[]}, {"engine":"test-double","auth":"fixture"}))
    service = ResearchService(root, manager)
    client.app.state.research = service
    # API route closures use the original instance; swap its manager for tests.
    original = client.app.state.codex_jobs
    original.runner = manager.runner
    yield root, meta, client, service, original
    manager.pool.shutdown(wait=True)
    original.pool.shutdown(wait=True)


def body(meta, skill="nature-writing"):
    return ResearchInput(skill_id=skill, title="【隔离验收】研究草稿", instruction="根据所给材料起草，不要补造数据。",
                         material="我们冻结视觉编码器，只训练分类头。尚未完成实验，没有准确率结果。",
                         papers=[{"paper_id":meta.paper_id,"version":meta.version}])


def test_catalog_and_real_skill_resources(research_env):
    root, meta, client, service, _ = research_env
    catalog = client.get("/api/research/skills").json()
    assert catalog["enabled_count"] == 22
    assert sum(s["mode"] == "web" for s in catalog["skills"]) == 7
    proposal = next(s for s in catalog["skills"] if s["id"] == "nature-proposal-writer")
    assert proposal["name"] == "researchwrite" and proposal["mode"] == "codex"
    captured = []
    service.manager.runner = lambda job,prompt,schema,label: (captured.append(prompt) or
        {"title":"测试", "markdown":"【测试】不捏造结果", "warnings":[], "citations":[]}, {"engine":"fixture"})
    job = service.submit(body(meta))
    assert wait_job(service.manager, job)["status"] == "completed"
    assert "INSTALLED_SKILL_GUIDANCE" in captured[0] and "Author evidence comes first" in captured[0]
    assert "UNTRUSTED_RESEARCH_DATA" in captured[0]
    changed = root / ".agents/skills/nature-writing/SKILL.md"
    atomic_write(changed, "changed content")
    with pytest.raises(ValueError, match="未启用"):
        service.submit(body(meta))


def test_web_draft_durability_etag_download_and_human_preservation(research_env):
    root, meta, client, service, manager = research_env
    folder = paper_dir(root, meta.paper_id, meta.version)
    for name in ["notes.md", "qa.jsonl", "questions.jsonl", "corrections.jsonl"]:
        atomic_write(folder / name, "human-owned")
    protected = {p.name:p.read_bytes() for p in folder.iterdir() if p.is_file()}
    response = client.post("/api/research/jobs", json=body(meta).model_dump())
    assert response.status_code == 200
    job = wait_job(manager, response.json())
    assert job["status"] == "completed" and job["scope"] == "research"
    url = "/api/research/jobs/" + job["job_id"]
    initial = client.get(url + "/result").json()
    assert initial["editable"]
    edited = client.put(url + "/draft", json={"content":"我的人工修改", "etag":initial["etag"]})
    assert edited.status_code == 200 and edited.json()["human_edited"]
    assert client.put(url + "/draft", json={"content":"过期修改", "etag":initial["etag"]}).status_code == 409
    assert client.get(url + "/download").content.decode() == "我的人工修改"
    restored = ResearchService(root, manager).result(job["job_id"])
    assert restored["content"] == "我的人工修改"
    assert list((root / "research-outputs" / job["job_id"] / ".history").glob("*.md"))
    assert all((folder / name).read_bytes() == raw for name,raw in protected.items())


def test_invalid_citations_and_cancellation_do_not_publish(research_env):
    root, meta, _, service, _ = research_env
    def bad(*args):
        return {"title":"bad", "markdown":"bad", "warnings":[],
                "citations":[{"paper_id":meta.paper_id,"version":meta.version,"page":1,"quote":"Invented absent evidence"}]}, {}
    service.manager.runner = bad
    job = service.submit(body(meta, "nature-paper-xray"))
    assert wait_job(service.manager,job)["status"] == "failed"
    assert not (root / "research-outputs" / job["job_id"] / "draft.md").exists()
    entered, release = threading.Event(), threading.Event()
    def blocked(*args):
        entered.set()
        release.wait(5)
        return {"title":"test", "markdown":"cancelled", "warnings":[], "citations":[]}, {}
    service.manager.runner = blocked
    job = service.submit(body(meta))
    assert entered.wait(3)
    service.manager.cancel(job["job_id"])
    release.set()
    service.manager.pool.shutdown(wait=True)
    assert service.manager.get(job["job_id"])["status"] == "cancelled"
    assert not (root / "research-outputs" / job["job_id"] / "draft.md").exists()


def test_handoff_is_prepared_not_falsely_generated_and_guarded(research_env):
    root, meta, client, service, _ = research_env
    def forbidden(*args): raise AssertionError("Task preparation must not call a model")
    service.manager.runner = forbidden
    job = service.submit(body(meta, "nature-paper2ppt"))
    assert wait_job(service.manager,job)["status"] == "prepared"
    result = service.result(job["job_id"])
    assert not result["editable"] and "尚未完成" in result["content"]
    assert (root / "research-outputs" / job["job_id"] / "source-material.json").is_file()
    payload = body(meta).model_dump()
    assert client.post("/api/research/jobs", json=payload, headers={"Origin":"https://evil.example"}).status_code == 403
    assert client.post("/api/research/jobs", json=payload|{"command":"run anything"}).status_code == 422
    assert client.post("/api/research/jobs", json=payload|{"skill_id":"../../escape"}).status_code == 422
    assert client.post("/api/research/jobs", json=payload|{"material":" "}).status_code == 422
    assert client.post("/api/research/jobs", json=payload|{"instruction":" "}).status_code == 422
    # Papers listed in PAPERLAB_GPT_AUTHORED keep their GPT-written analysis.
    os.environ["PAPERLAB_GPT_AUTHORED"] = "local-0123456789abcdef0123"
    try:
        protected = payload | {"skill_id":"nature-paper-xray", "papers":[{"paper_id":"local-0123456789abcdef0123","version":"v1"}]}
        assert client.post("/api/research/jobs", json=protected).status_code == 422
        assert client.get("/api/automation/status").json()["gpt_authored"] == ["local-0123456789abcdef0123"]
    finally:
        del os.environ["PAPERLAB_GPT_AUTHORED"]
