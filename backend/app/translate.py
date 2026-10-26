"""Offline selection translation: dictionary + academic glossary + local MT model.

Short selections are looked up in ECDICT and the academic glossary (instant).
Sentences go to a local Tencent Hy-MT2 model served by llama.cpp's llama-server,
started on first use, bound to 127.0.0.1 with a per-launch API key, and stopped
after an idle period so the GPU is free while you are not translating.
Nothing leaves the machine and no subscription quota is used.
"""
import atexit
import hashlib
import json
import os
import re
import secrets
import socket
import sqlite3
import subprocess
import threading
import time
import unicodedata
from pathlib import Path

import httpx
from fastapi import HTTPException
from pydantic import Field

from .models import Model, now
from .paths import env_file_values
from .storage import atomic_write, data_lock, read_json, safe_path

DATA = Path(__file__).parent / "data" / "academic_terms.json"
IDLE_SECONDS = 15 * 60
LOAD_SECONDS = 120
# Loopback calls must never go through HTTP(S)_PROXY: a shell with a proxy but no
# NO_PROXY would send the health check to the proxy, which never answers.
local = httpx.Client(trust_env=False)
MAX_CHARS = 2000
TAGS = {"zk": "中考", "gk": "高考", "cet4": "CET-4", "cet6": "CET-6", "ky": "考研", "toefl": "TOEFL",
        "ielts": "IELTS", "gre": "GRE"}


def local_config(root: Path) -> dict:
    """Machine-specific paths: environment first, then the git-ignored .env.local file."""
    values = env_file_values(root)
    get = lambda key, default: os.environ.get(key) or values.get(key) or default
    # Defaults point into the git-ignored models/ folder next to the app; see .env.example.
    models = root / "models"
    return {"model": Path(get("PAPERLAB_MT_MODEL", models / "Hy-MT2-7B-Q4_K_M.gguf")),
            "server": Path(get("PAPERLAB_LLAMA_SERVER", models / "llama.cpp" / "llama-server.exe")),
            "dictionary": Path(get("PAPERLAB_DICTIONARY", models / "ecdict.db")),
            "gpu_layers": get("PAPERLAB_MT_GPU_LAYERS", "99")}


def clean(text: str) -> str:
    """Undo PDF text-layer artefacts: ligatures, hyphenated line breaks, hard wraps."""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    return re.sub(r"\s+", " ", text).strip()


class Term(Model):
    en: str = Field(min_length=1, max_length=200)
    zh: str = Field(min_length=1, max_length=200)
    domain: str = Field(default="我的术语", max_length=40)
    note: str = Field(default="", max_length=500)


class LookupInput(Model):
    text: str = Field(min_length=1, max_length=MAX_CHARS)


class TranslateInput(Model):
    text: str = Field(min_length=1, max_length=MAX_CHARS)


class Glossary:
    def __init__(self, root: Path):
        self.root = root
        self.builtin = read_json(DATA)["terms"]

    def user_path(self):
        return safe_path(self.root, "knowledge", "glossary", "user-terms.json")

    def user(self):
        path = self.user_path()
        return read_json(path)["terms"] if path.exists() else []

    def terms(self):
        # Personal entries override built-in ones with the same English key.
        merged = {t["en"].lower(): {**t, "source": "builtin"} for t in self.builtin}
        merged.update({t["en"].lower(): {**t, "source": "user"} for t in self.user()})
        return merged

    def add(self, term: Term):
        with data_lock(self.root):
            items = [t for t in self.user() if t["en"].lower() != term.en.strip().lower()]
            items.append({**term.model_dump(), "en": term.en.strip(), "zh": term.zh.strip(), "added_at": now()})
            atomic_write(self.user_path(), json.dumps({"schema_version": "1.0", "terms": items},
                                                      ensure_ascii=False, indent=2) + "\n")
        return items[-1]

    def matches(self, text: str, limit=24):
        """Glossary terms occurring in text (whole words, simple plural), longest first."""
        lowered, found = text.lower(), []
        for key, term in sorted(self.terms().items(), key=lambda kv: -len(kv[0])):
            if re.search(r"(?<![\w-])" + re.escape(key) + r"(?:s|es)?(?![\w-])", lowered):
                if not any(key in f["en"].lower() for f in found):
                    found.append(term)
            if len(found) >= limit:
                break
        return found


class Dictionary:
    def __init__(self, path: Path):
        self.path = path

    def available(self):
        return self.path.exists()

    def _row(self, db, key):
        return db.execute("select word, phonetic, translation, tag, collins, oxford, exchange from words where key=?",
                          (key,)).fetchone()

    def lookup(self, word: str):
        if not self.available():
            return None
        key = word.strip().strip(".,;:!?()[]{}\"'“”‘’").lower()
        if not key:
            return None
        with sqlite3.connect(f"file:{self.path}?mode=ro", uri=True) as db:
            row = self._row(db, key)
            base = None
            if row and row[6]:
                lemma = dict(p.split(":", 1) for p in row[6].split("/") if ":" in p).get("0")
                if lemma and lemma != key:
                    base = self._row(db, lemma)
            if not row:
                for suffix, repl in (("ies", "y"), ("es", ""), ("s", ""), ("ing", ""), ("ing", "e"), ("ed", ""),
                                     ("ed", "e"), ("ly", "")):
                    if key.endswith(suffix) and len(key) > len(suffix) + 2:
                        row = self._row(db, key[: -len(suffix)] + repl)
                        if row:
                            break
        if not row:
            return None
        pick = base or row
        return {"word": pick[0], "query": word.strip(), "phonetic": pick[1], "senses": [s for s in pick[2].split("\n") if s],
                "tags": [TAGS[t] for t in (pick[3] or "").split() if t in TAGS], "collins": pick[4], "oxford": bool(pick[5]),
                "inflection_of": pick[0] if base else None}


def free_port() -> int:
    """A fresh loopback port per launch, so two PaperLab instances never answer each other."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def kill_if_llama(pid: int):
    """Terminate a recorded model process only if it is still a llama-server."""
    try:
        if os.name == "nt":
            # Bytes, not text: when no process matches, tasklist prints a localized message in the
            # console code page (GBK on Chinese Windows), which is not valid UTF-8 under `-X utf8`.
            out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"], capture_output=True,
                                 timeout=10, creationflags=subprocess.CREATE_NO_WINDOW).stdout
            if b"llama-server" in out.lower():
                subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, timeout=10,
                               creationflags=subprocess.CREATE_NO_WINDOW)
        elif "llama-server" in Path(f"/proc/{pid}/cmdline").read_bytes().decode(errors="replace"):
            os.kill(pid, 15)
    except (OSError, subprocess.SubprocessError):
        pass


class LocalMT:
    """Lazily started llama-server hosting the Hy-MT2 translation model."""

    def __init__(self, root: Path, app_root: Path | None = None):
        self.root = root
        self.app_root = app_root or root
        self.lock = threading.RLock()
        self.process: subprocess.Popen | None = None
        self.key = ""
        self.port = 0
        self.state = "stopped"
        self.error = ""
        self.last_used = 0.0
        self.cache_path = safe_path(root, ".runtime", "mt-cache.sqlite")
        # Records the running model so a later backend can clean up one it left behind.
        self.pid_path = safe_path(root, ".runtime", "mt-server.json")
        threading.Thread(target=self._reaper, daemon=True).start()
        atexit.register(self.stop)

    def config(self):
        return local_config(self.app_root)

    def status(self):
        cfg = self.config()
        running = self.process is not None and self.process.poll() is None
        return {"model": cfg["model"].name, "model_available": cfg["model"].exists(),
                "runtime_available": cfg["server"].exists(), "state": self.state if running or self.state == "error" else "stopped",
                "error": self.error}

    def _reaper(self):
        while True:
            time.sleep(30)
            with self.lock:
                if self.process and self.process.poll() is None and time.time() - self.last_used > IDLE_SECONDS:
                    self.stop()

    def stop(self):
        with self.lock:
            if self.process and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(10)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                # Only our own record is removed; an orphan's record is handled in ensure().
                self.pid_path.unlink(missing_ok=True)
            self.process, self.state = None, "stopped"

    def ensure(self):
        with self.lock:
            if self.process and self.process.poll() is None and self.state == "ready":
                return
            cfg = self.config()
            if not cfg["model"].exists() or not cfg["server"].exists():
                raise HTTPException(503, "本地翻译模型或 llama.cpp 运行时不存在，请检查 .env.local 中的路径")
            self.stop()
            if self.pid_path.exists():
                # A previous backend died without stopping its model (e.g. killed process).
                try:
                    kill_if_llama(int(json.loads(self.pid_path.read_text(encoding="utf-8"))["pid"]))
                except (ValueError, KeyError, OSError):
                    pass
                self.pid_path.unlink(missing_ok=True)
            self.key = secrets.token_urlsafe(24)
            self.port = free_port()
            self.state, self.error = "loading", ""
            log = safe_path(self.root, ".runtime", "mt-server.log")
            log.parent.mkdir(exist_ok=True)
            flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            self.process = subprocess.Popen(
                [str(cfg["server"]), "-m", str(cfg["model"]), "--host", "127.0.0.1", "--port", str(self.port),
                 "--api-key", self.key, "-ngl", str(cfg["gpu_layers"]), "-c", "4096", "-np", "1", "--no-webui"],
                stdout=log.open("ab"), stderr=subprocess.STDOUT, cwd=str(cfg["server"].parent), creationflags=flags)
            atomic_write(self.pid_path, json.dumps({"pid": self.process.pid, "port": self.port}))
            deadline = time.time() + LOAD_SECONDS
            while time.time() < deadline:
                if self.process.poll() is not None:
                    self.state, self.error = "error", "模型进程启动失败，详见 .runtime/mt-server.log"
                    raise HTTPException(503, self.error)
                try:
                    if local.get(f"http://127.0.0.1:{self.port}/health", timeout=2).status_code == 200:
                        self.state = "ready"
                        return
                except httpx.HTTPError:
                    pass
                time.sleep(0.5)
            self.stop()
            self.state, self.error = "error", f"模型加载超时（{LOAD_SECONDS} 秒），详见 .runtime/mt-server.log"
            raise HTTPException(503, self.error)

    def warm(self):
        """Load the model in the background so the first selection does not wait for it."""
        def load():
            with self.lock:
                try:
                    self.ensure()
                    self.last_used = time.time()
                except HTTPException:
                    pass
        cfg = self.config()
        if cfg["model"].exists() and cfg["server"].exists() and self.state != "loading":
            threading.Thread(target=load, daemon=True).start()
        return self.status()

    def _cache(self):
        self.cache_path.parent.mkdir(exist_ok=True)
        db = sqlite3.connect(self.cache_path)
        db.execute("create table if not exists mt (key text primary key, translation text, created text)")
        return db

    def translate(self, text: str, terms: list[dict]):
        model = self.config()["model"].name
        prompt = ""
        if terms:
            # Glossary notes like 「动作专家（模块）」 help a reader but should not leak into prose.
            plain = lambda zh: re.sub(r"（[^）]*）|\([^)]*\)", "", zh).strip() or zh
            prompt += "参考下面的翻译：\n" + "\n".join(f"{t['en']} 翻译成 {plain(t['zh'])}" for t in terms) + "\n"
        prompt += ("将以下文本翻译为中文，译文要符合学术论文的表达习惯，术语规范，公式符号与引用编号保持原样，"
                   "注意只需要输出翻译后的结果，不要额外解释：\n\n" + text)
        key = hashlib.sha256(f"{model}\n{prompt}".encode()).hexdigest()
        with self._cache() as db:
            hit = db.execute("select translation from mt where key=?", (key,)).fetchone()
        if hit:
            return hit[0], True
        with self.lock:
            self.ensure()
            self.last_used = time.time()
            # Recommended decoding settings from the Hy-MT2 model card (no system prompt).
            response = local.post(f"http://127.0.0.1:{self.port}/v1/chat/completions", timeout=120,
                                  headers={"Authorization": f"Bearer {self.key}"},
                                  json={"messages": [{"role": "user", "content": prompt}], "temperature": 0.7,
                                        "top_p": 0.6, "top_k": 20, "repeat_penalty": 1.05,
                                        "max_tokens": min(2048, len(text) * 3 + 64)})
            self.last_used = time.time()
        if response.status_code != 200:
            raise HTTPException(502, f"本地模型返回错误 {response.status_code}")
        translation = response.json()["choices"][0]["message"]["content"].strip()
        with self._cache() as db:
            db.execute("insert or replace into mt values (?,?,?)", (key, translation, now()))
        return translation, False


def register_translation(app, root: Path, app_root: Path | None = None):
    app_root = app_root or root
    glossary, mt = Glossary(root), LocalMT(root, app_root)
    dictionary = lambda: Dictionary(local_config(app_root)["dictionary"])

    @app.get("/api/translate/status")
    def translate_status():
        return {"dictionary": dictionary().available(), "glossary_terms": len(glossary.terms()), "mt": mt.status()}

    @app.post("/api/translate/lookup")
    def lookup(body: LookupInput):
        text = clean(body.text)
        words = text.split()
        hits = glossary.matches(text, limit=6)
        terms = glossary.terms()
        exact = terms.get(text.lower()) or terms.get(re.sub(r"(?<=\w)s$", "", text.lower()))
        entry = dictionary().lookup(text) if len(words) <= 3 else None
        return {"text": text, "kind": "word" if len(words) == 1 else "phrase" if len(words) <= 4 else "sentence",
                "glossary": exact, "related_terms": [h for h in hits if not exact or h["en"].lower() != exact["en"].lower()], "entry": entry}

    @app.post("/api/translate")
    def translate(body: TranslateInput):
        text = clean(body.text)
        terms = glossary.matches(text)
        started = time.time()
        translation, cached = mt.translate(text, terms)
        return {"translation": translation, "cached": cached, "engine": mt.config()["model"].stem,
                "terms": terms, "ms": round((time.time() - started) * 1000)}

    @app.post("/api/translate/warm")
    def warm_model():
        return mt.warm()

    @app.post("/api/translate/stop")
    def stop_model():
        mt.stop()
        return mt.status()

    @app.get("/api/glossary")
    def get_glossary():
        return {"terms": sorted(glossary.terms().values(), key=lambda t: t["en"].lower())}

    @app.post("/api/glossary")
    def add_term(body: Term):
        return glossary.add(body)

    return mt
