import importlib.util
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import translate
from app.main import create_app

ROOT = Path(__file__).resolve().parents[2]
CSV = """word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
chunk,tʃʌŋk,,"n. 大块\\n[经] 定样",,2,,toefl gre,1,1,s:chunks,,
chunks,,,n. 大块（复数）,,,,,0,0,0:chunk/1:s,,
ablation,æb'leiʃən,,"n. 切除, 烧蚀",,,,,0,0,,,
"""


@pytest.fixture
def client(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("build_dictionary", ROOT / "scripts" / "build_dictionary.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    (tmp_path / "dict.csv").write_text(CSV, encoding="utf-8")
    builder.main(tmp_path / "dict.csv", tmp_path / "dict.db")
    monkeypatch.setenv("PAPERLAB_DICTIONARY", str(tmp_path / "dict.db"))
    monkeypatch.setenv("PAPERLAB_MT_MODEL", str(tmp_path / "missing.gguf"))
    monkeypatch.setenv("PAPERLAB_LLAMA_SERVER", str(tmp_path / "missing.exe"))
    return TestClient(create_app(tmp_path))


def test_lookup_prefers_glossary_and_lemmatizes(client):
    r = client.post("/api/translate/lookup", json={"text": "Ablation"}).json()
    assert r["kind"] == "word" and r["glossary"]["zh"] == "消融（实验）"
    assert r["entry"]["senses"] == ["n. 切除, 烧蚀"]
    r = client.post("/api/translate/lookup", json={"text": "chunks,"}).json()
    assert r["entry"]["word"] == "chunk" and r["entry"]["inflection_of"] == "chunk"
    assert r["entry"]["tags"] == ["TOEFL", "GRE"] and r["entry"]["senses"] == ["n. 大块", "[经] 定样"]
    r = client.post("/api/translate/lookup", json={"text": "action chunks"}).json()
    assert r["kind"] == "phrase" and r["glossary"]["zh"] == "动作块"


def test_pdf_artifacts_are_cleaned():
    assert translate.clean("perturba-\n tions with ﬁne-\ntuning") == "perturbations with finetuning"


def test_user_glossary_overrides_builtin(client, tmp_path):
    saved = client.post("/api/glossary", json={"en": "action chunk", "zh": "动作片段"})
    assert saved.status_code == 200
    assert client.post("/api/translate/lookup", json={"text": "action chunk"}).json()["glossary"]["zh"] == "动作片段"
    stored = json.loads((tmp_path / "knowledge" / "glossary" / "user-terms.json").read_text(encoding="utf-8"))
    assert stored["terms"][0]["en"] == "action chunk"
    assert client.post("/api/glossary", json={"en": "", "zh": "x"}).status_code == 422


def test_missing_model_reports_unavailable(client):
    status = client.get("/api/translate/status").json()
    assert status["dictionary"] and not status["mt"]["model_available"]
    r = client.post("/api/translate", json={"text": "The policy predicts an action chunk."})
    assert r.status_code == 503


def test_sentence_uses_terms_and_cache(client, monkeypatch):
    calls = []

    def fake_post(url, **kwargs):
        calls.append(kwargs["json"]["messages"][0]["content"])
        return httpx.Response(200, json={"choices": [{"message": {"content": "策略预测一个动作块。"}}]})

    monkeypatch.setattr(translate.LocalMT, "ensure", lambda self: None)
    # Model calls go through the proxy-free loopback client.
    monkeypatch.setattr(translate.local, "post", fake_post)
    body = {"text": "The policy predicts an\naction chunk."}
    first = client.post("/api/translate", json=body).json()
    assert first["translation"] == "策略预测一个动作块。" and not first["cached"]
    assert "action chunk 翻译成 动作块" in calls[0] and "policy 翻译成 策略" in calls[0]
    assert "The policy predicts an action chunk." in calls[0]
    second = client.post("/api/translate", json=body).json()
    assert second["cached"] and len(calls) == 1
    assert client.post("/api/translate", json={"text": "x" * 2001}).status_code == 422


def test_orphan_cleanup_only_targets_llama_server():
    # The recorded PID may be reused by an unrelated process; it must survive.
    import os
    import subprocess
    import sys
    bystander = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        translate.kill_if_llama(bystander.pid)
        assert bystander.poll() is None  # a non-llama process is left alone
    finally:
        bystander.kill()
    assert 1024 < translate.free_port() < 65536
