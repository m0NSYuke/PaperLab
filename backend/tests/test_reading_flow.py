import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.reports import publish_report
from app.storage import paper_dir
from test_api import env, pdf_bytes, report_for


def test_question_snapshots_persist_and_survive_report_publication(env):
    root,meta,client,prefix=env
    payload=dict(question="为什么这里要解耦？",context="报告旧解释与原文出处",section="DCS",page=1,report_revision=1)
    first=client.post(prefix+"/questions",json=payload)
    assert first.status_code==200
    qid=first.json()["question_id"]
    assert not first.json()["resolved"]
    before=(paper_dir(root,meta.paper_id,meta.version)/"questions.jsonl").read_bytes()
    publish_report(root,report_for(meta))
    publish_report(root,report_for(meta))
    assert (paper_dir(root,meta.paper_id,meta.version)/"questions.jsonl").read_bytes()==before
    restarted=TestClient(create_app(root))
    questions=restarted.get(prefix+"/questions").json()["questions"]
    assert questions[0]["report_revision"]==1 and questions[0]["context"]==payload["context"]
    assert restarted.patch(prefix+"/questions/"+qid,json={"resolved":True}).json()["resolved"]
    assert len(restarted.get(prefix+"/questions").json()["questions"])==1
    assert restarted.patch(prefix+"/questions/"+qid,json={"resolved":False}).json()["resolved"] is False
    assert restarted.patch(prefix+"/questions/q_unknown",json={"resolved":True}).status_code==404
    assert client.post(prefix+"/questions",json=payload,headers={"Origin":"https://evil.example"}).status_code==403
    assert client.post(prefix+"/questions",json=payload|{"page":999}).status_code==422
    assert client.post(prefix+"/questions",json=payload|{"question":""}).status_code==422


def tutorial_report(meta):
    report=report_for(meta)
    report["schema_version"]="1.2"
    cite=report["claims"][0]["citations"][0]
    report["tutorial"]={
        "introduction":"【测试教学结构】先理解动作时域。",
        "prerequisites":[{"unit_id":"term-horizon","title":"时域","body":"教学定义，不是新增实验。","citations":[cite]}],
        "walkthrough":[{"unit_id":"walk-input","title":"输入到输出","body":"按原文讲解。","citations":[cite]}],
        "worked_examples":[{"unit_id":"example","title":"教学例子","body":"假设每步0.1秒，示例非作者实测。","citations":[]}],
        "faq":[{"question":"时域是多少？","answer":"原文为50。","citations":[cite]}],
    }
    return report


def test_tutorial_schema_sources_and_markdown(env):
    root,meta,_,_=env
    result=publish_report(root,tutorial_report(meta))
    assert result.schema_version=="1.2"
    md=(paper_dir(root,meta.paper_id,meta.version)/"report.md").read_text(encoding="utf-8")
    assert "输入到输出" in md and "时域是多少？" in md
    for group in ["prerequisites","walkthrough","faq"]:
        payload=tutorial_report(meta)
        payload["tutorial"][group][0]["citations"][0]["quote"]="Invented citation not in PDF"
        with pytest.raises(ValueError,match="quote"):publish_report(root,payload)
    payload=tutorial_report(meta)
    payload["tutorial"]["worked_examples"][0]["unit_id"]="walk-input"
    with pytest.raises(ValueError,match="Duplicate teaching"):publish_report(root,payload)
    # Existing 1.0/1.1 files remain publishable with no tutorial.
    for version in ["1.0","1.1"]:
        payload=report_for(meta)|{"schema_version":version}
        assert publish_report(root,payload).tutorial is None
