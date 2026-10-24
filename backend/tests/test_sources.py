import io
import json
import tarfile

import pytest

from app.importer import parse_arxiv
from app.models import Metadata
from app.sources import prepare_sources, source_bundle, source_summary
from app.storage import atomic_write, paper_dir, read_json, sha256, write_json
from app.workspace import CodexJobs, JobInput
from test_api import env, pdf_bytes, report_for
from test_workspace import wait_job


def install_source(root, meta, files):
    assets = paper_dir(root, meta.paper_id, meta.version, True)
    source = assets / "source"
    for name, content in files.items():
        atomic_write(source / name, content)
    meta.tex_path = source.relative_to(root).as_posix()
    write_json(paper_dir(root, meta.paper_id, meta.version) / "metadata.json", meta.model_dump())


def archive_bytes(files):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w:gz") as archive:
        for name, content in files.items():
            data = content.encode()
            entry = tarfile.TarInfo(name); entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))
    return raw.getvalue()


def test_recursive_graph_cycles_comments_bibliography_and_path_boundary(env):
    root, meta, client, prefix = env
    install_source(root, meta, {
        "main.tex": r"\documentclass{article}"+"\n% "+r"\input{ignored}"+"\n"+r"\input{sections/method}\bibliography{refs}\input{../../secret}",
        "sections/method.tex": r"\input{../main}"+"\nSOURCE_ONLY_FORMULA",
        "refs.bib": "@article{x,title={Evidence}}",
        "unused.tex": "UNREFERENCED_PRIVATE_CONTENT",
    })
    bundle = source_bundle(root, meta.paper_id, meta.version)
    assert [f["path"] for f in bundle["files"]] == ["main.tex", "sections/method.tex", "refs.bib"]
    assert "ignored" not in " ".join(bundle["missing_includes"])
    assert any("secret" in v for v in bundle["missing_includes"])
    assert bundle["complete"] is False
    response = client.get(prefix+"/sources")
    assert response.status_code == 200
    assert "content" not in json.dumps(response.json())
    assert "UNREFERENCED_PRIVATE_CONTENT" not in json.dumps(bundle)
    atomic_write(paper_dir(root,meta.paper_id,meta.version,True)/"source/main.tex", r"\documentclass{article}\input\dynamic")
    assert source_bundle(root,meta.paper_id,meta.version)["missing_includes"]


def test_ambiguous_entrypoint_and_explicit_budget(env):
    root, meta, _, _ = env
    install_source(root, meta, {"paper.tex":r"\documentclass{article}", "supp.tex":r"\documentclass{article}"})
    assert source_bundle(root,meta.paper_id,meta.version)["mode"] == "ambiguous"
    atomic_write(paper_dir(root,meta.paper_id,meta.version,True)/"source/main.tex", r"\documentclass{article}"+"X"*200)
    result = source_bundle(root,meta.paper_id,meta.version,max_chars=30)
    assert result["entrypoint"] == "main.tex" and result["truncated"] and not result["complete"]
    assert len(result["files"][0]["content"]) == 30


def test_pdf_only_does_not_guess_arxiv_or_change_human_data(env,monkeypatch):
    root,meta,client,prefix=env
    folder=paper_dir(root,meta.paper_id,meta.version)
    protected={"notes.md":"human", "study.json":"{}", "qa.jsonl":"", "corrections.jsonl":"", "report.json":"existing"}
    for name,text in protected.items(): atomic_write(folder/name,text)
    monkeypatch.setattr("app.sources.fetch",lambda *args:pytest.fail("Local PDF must not fetch a guessed arXiv ID"))
    value,path=prepare_sources(root,meta.paper_id,meta.version)
    assert value["mode"]=="pdf_only" and path.exists()
    manager=CodexJobs(root)
    monkeypatch.setattr(manager,"status",lambda:{"logged_in":False,"message":"not logged in"})
    task=manager.submit(meta.paper_id,meta.version,JobInput(kind="prepare_sources"))
    assert wait_job(manager,task)["status"]=="completed"
    manager.pool.shutdown()
    for name,text in protected.items(): assert (folder/name).read_text()==text


def test_recover_exact_source_and_reuse_archive(env,monkeypatch):
    root,_,_,_=env
    pid,version="2501.12345","v2"
    folder=paper_dir(root,pid,version)
    raw=archive_bytes({"main.tex":r"\documentclass{article}\input{method}\bibliography{refs}",
                       "method.tex":"CORE", "main.bbl":"COMPILED_REFERENCE"})
    meta=Metadata(paper_id=pid,version=version,title="fixture",source_url="https://arxiv.org/abs/2501.12345v2")
    write_json(folder/"metadata.json",meta.model_dump())
    calls=[]
    def fetch(url): calls.append(url); return raw
    monkeypatch.setattr("app.sources.fetch",fetch)
    value,_=prepare_sources(root,pid,version)
    assert calls==["https://arxiv.org/src/2501.12345v2"]
    assert value["complete"] and value["missing_includes"]==[]
    assert [f["path"] for f in value["files"]]==["main.tex","method.tex","main.bbl"]
    prepare_sources(root,pid,version)
    assert len(calls)==1
    assert read_json(folder/"metadata.json")["tex_sha256"]==sha256(raw)
    atomic_write(paper_dir(root,pid,version,True)/"source.tar.gz",b"tampered")
    with pytest.raises(ValueError,match="SHA-256"):source_bundle(root,pid,version)


def test_wrong_version_and_unavailable_source_do_not_publish(env,monkeypatch):
    import httpx
    root,_,_,_=env
    pid,version="2501.12345","v2"
    meta=Metadata(paper_id=pid,version=version,title="fixture",source_url="https://arxiv.org/abs/2501.12345v3")
    write_json(paper_dir(root,pid,version)/"metadata.json",meta.model_dump())
    with pytest.raises(ValueError,match="身份"):prepare_sources(root,pid,version)
    meta.source_url="https://arxiv.org/abs/2501.12345v2"
    write_json(paper_dir(root,pid,version)/"metadata.json",meta.model_dump())
    def failed(*args):raise httpx.ConnectError("offline")
    monkeypatch.setattr("app.sources.fetch",failed)
    bundle,_=prepare_sources(root,pid,version)
    assert bundle["mode"]=="pdf_only" and bundle["warnings"]
    assert not (paper_dir(root,pid,version)/"report.json").exists()


def test_analysis_receives_source_and_still_enforces_pdf_quotes(env):
    root,meta,_,_=env
    install_source(root,meta,{"main.tex":r"\documentclass{article}\input{method}","method.tex":"SOURCE_ONLY_FORMULA"})
    pagefile=paper_dir(root,meta.paper_id,meta.version,True)/"pages.json"
    pages=read_json(pagefile);pages["limited"]=False;write_json(pagefile,pages)
    captured=[]
    def runner(job,prompt,*args):
        data=json.loads(prompt.split("UNTRUSTED_PAPER_DATA:\n")[1])
        assert any("SOURCE_ONLY_FORMULA" in f["content"] for f in data["rap_sources"]["files"])
        captured.append(data)
        return report_for(meta),{"engine":"test-double"}
    manager=CodexJobs(root,runner=runner)
    task=manager.submit(meta.paper_id,meta.version,JobInput(kind="analyze"))
    assert wait_job(manager,task)["status"]=="completed"
    assert captured and read_json(paper_dir(root,meta.paper_id,meta.version)/"report.json")["quality_checks"][-1].startswith("RAP")
    manager.pool.shutdown()
    def forged(*args):
        payload=report_for(meta);payload["claims"][0]["citations"][0]["quote"]="SOURCE_ONLY_FORMULA"
        return payload,{}
    manager=CodexJobs(root,runner=forged)
    task=manager.submit(meta.paper_id,meta.version,JobInput(kind="analyze"))
    assert wait_job(manager,task)["status"]=="failed"
    assert read_json(paper_dir(root,meta.paper_id,meta.version)/"report.json")["revision"]==1
    manager.pool.shutdown()


def test_src_url_is_normalized_to_exact_identity():
    assert parse_arxiv("https://arxiv.org/src/2501.12345v2")==("2501.12345","v2")
