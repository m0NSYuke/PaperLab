import hmac
import ipaddress
import json
import os
import re
import uuid
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .paths import APP_ROOT, data_root
from .importer import MAX_BYTES, import_arxiv, import_pdf
from .models import (Correction, CorrectionInput, Highlight, HighlightInput, HighlightPatch, ImportInput, Metadata,
                     MetadataPatch, NotesInput, Report, Study, StudyInput, now)
from .reports import read_corrections
from .storage import atomic_write, data_lock, paper_dir, read_json, safe_path, sha256, write_json
from .translate import register_translation
from .workspace import register_workspace

ROOT = data_root()
ORIGINS = {"http://127.0.0.1:8000", "http://localhost:8000", "http://127.0.0.1:5173", "http://localhost:5173"}

LOCAL_HOSTS = {"127.0.0.1", "localhost", "testserver"}
NOTE_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}
NOTE_IMAGE_MAX = 20 * 1024 * 1024
NOTE_ASSET = re.compile(r"[0-9a-f]{16}\.(?:png|jpg|gif|webp)")
LAN_COOKIE = "paperlab_lan"
LAN_DENIED = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PaperLab</title><body style="font:16px/1.6 system-ui;max-width:28em;margin:4em auto;padding:0 1em">
<h2>需要访问口令</h2><p>请用电脑上「PaperLab 局域网」窗口显示的完整链接打开（末尾带 <code>?key=</code>）。
打开一次后，本设备会记住口令。</p></body>"""


def _private_client(host: str | None) -> bool:
    try:
        return ipaddress.ip_address(host or "").is_private
    except ValueError:
        return False


def create_app(root: Path | None = None, lan_token: str | None = None, app_root: Path | None = None) -> FastAPI:
    """LAN mode (``lan_token`` or PAPERLAB_LAN_TOKEN) admits devices on the same
    private network that hold the access key; loopback use is unchanged."""
    app = FastAPI(title="PaperLab local API", version="0.1.0")
    # Production keeps code (frontend, docs, skills, .env.local) apart from paper data;
    # an explicit root such as a test workspace holds both unless app_root is given.
    root, app_root = (ROOT, app_root or APP_ROOT) if root is None else (root, app_root or root)
    lan_token = lan_token if lan_token is not None else os.environ.get("PAPERLAB_LAN_TOKEN") or None
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"] if lan_token else sorted(LOCAL_HOSTS))
    app.add_middleware(CORSMiddleware, allow_origins=sorted(ORIGINS), allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Content-Type"])

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if lan_token and request.url.hostname not in LOCAL_HOSTS:
            # Requests not addressed to localhost must come from a private-network
            # client holding the key. The key lives in a per-host cookie, so a
            # DNS-rebinding page under another name never carries it.
            if not _private_client(request.client.host if request.client else None):
                return JSONResponse({"detail": "仅允许局域网设备访问"}, status_code=403)
            key = request.query_params.get("key")
            if key is not None and hmac.compare_digest(key, lan_token):
                rest = [(k, v) for k, v in request.query_params.multi_items() if k != "key"]
                response = RedirectResponse(str(request.url.remove_query_params("key")) if rest else request.url.path, status_code=303)
                response.set_cookie(LAN_COOKIE, lan_token, max_age=180 * 86400, httponly=True, samesite="strict")
                return response
            if not hmac.compare_digest(request.cookies.get(LAN_COOKIE, ""), lan_token):
                if request.url.path.startswith("/api/"):
                    return JSONResponse({"detail": "需要访问口令，请用带 key 的局域网链接重新打开"}, status_code=401)
                return HTMLResponse(LAN_DENIED, status_code=401)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            same_origin = str(request.base_url).rstrip("/")
            if (origin is not None and origin not in ORIGINS and origin != same_origin) or request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"detail": "拒绝来自外部网页的写入请求"}, status_code=403)
            if int(request.headers.get("content-length", "0")) > MAX_BYTES + 1024 * 1024:
                return JSONResponse({"detail": "请求体过大"}, status_code=413)
        try:
            return await call_next(request)
        except (ValueError, json.JSONDecodeError) as exc:
            return JSONResponse({"detail": f"数据格式或路径无效：{str(exc)[:300]}"}, status_code=422)
        except FileNotFoundError:
            return JSONResponse({"detail": "文件不存在，请检查本地原文或元数据"}, status_code=404)
        except OSError:
            return JSONResponse({"detail": "本地文件读写失败，请检查权限和可用空间；原文件尽量保留"}, status_code=500)
        except httpx.HTTPError as exc:
            return JSONResponse({"detail": f"论文下载失败，请检查网络或 arXiv 版本：{type(exc).__name__}"}, status_code=502)

    def file_path(paper_id, version, name, assets=False):
        folder = paper_dir(root, paper_id, version, assets)
        return safe_path(root, str(folder.relative_to(root)), name)

    def get_meta(paper_id, version):
        return Metadata.model_validate(read_json(file_path(paper_id, version, "metadata.json")))

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": "0.1.0", "local_only": True, "lan": bool(lan_token)}

    @app.get("/api/papers")
    def list_papers():
        folder = safe_path(root, "papers")
        papers, warnings = [], []
        if folder.exists():
            for candidate in folder.glob("*/*/metadata.json"):
                try:
                    candidate = safe_path(root, str(candidate.relative_to(root)))
                    meta = Metadata.model_validate(read_json(candidate))
                    if candidate.parent != paper_dir(root, meta.paper_id, meta.version):
                        raise ValueError("Metadata identity differs from folder")
                    papers.append(meta.model_dump())
                except (ValueError, OSError) as exc:
                    warnings.append(f"{candidate.parent.name}: 元数据无法读取 ({type(exc).__name__})")
        papers.sort(key=lambda p: p["last_opened_at"] or p["imported_at"], reverse=True)
        return {"papers": papers, "warnings": warnings}

    @app.post("/api/import/arxiv")
    def arxiv_import(body: ImportInput):
        return import_arxiv(root, body.reference)

    @app.post("/api/import/pdf")
    async def pdf_import(file: UploadFile = File(), title: str = Form("")):
        raw = await file.read(MAX_BYTES + 1)
        await file.close()
        if len(raw) > MAX_BYTES:
            raise HTTPException(413, "PDF 超过 100 MB")
        return import_pdf(root, raw, file.filename or "paper.pdf", title)

    @app.get("/api/papers/{paper_id}/{version}")
    def paper(paper_id: str, version: str):
        return get_meta(paper_id, version)

    @app.patch("/api/papers/{paper_id}/{version}")
    def update(paper_id: str, version: str, body: MetadataPatch):
        with data_lock(root):
            meta = get_meta(paper_id, version)
            meta = Metadata.model_validate(meta.model_dump() | body.model_dump(exclude_none=True))
            write_json(file_path(paper_id, version, "metadata.json"), meta.model_dump())
        return meta

    @app.get("/api/papers/{paper_id}/{version}/pdf")
    def pdf(paper_id: str, version: str):
        get_meta(paper_id, version)
        path = file_path(paper_id, version, "paper.pdf", True)
        if not path.exists():
            raise HTTPException(404, "PDF 丢失，请从原文备份恢复 local-assets，或重新下载精确版本")
        return FileResponse(path, media_type="application/pdf", headers={"Content-Disposition": "inline"})

    @app.get("/api/papers/{paper_id}/{version}/report")
    def report(paper_id: str, version: str):
        get_meta(paper_id, version)
        path = file_path(paper_id, version, "report.json")
        if not path.exists():
            return {"report": None}
        with data_lock(root):
            return {"report": Report.model_validate(read_json(path)).model_dump()}

    @app.get("/api/papers/{paper_id}/{version}/source-index")
    def source_index(paper_id: str, version: str):
        get_meta(paper_id, version)
        return read_json(file_path(paper_id, version, "source-index.json"))

    @app.get("/api/papers/{paper_id}/{version}/notes")
    def notes(paper_id: str, version: str):
        get_meta(paper_id, version)
        path = file_path(paper_id, version, "notes.md")
        raw = path.read_bytes() if path.exists() else b""
        return {"content": raw.decode("utf-8"), "etag": sha256(raw)}

    @app.put("/api/papers/{paper_id}/{version}/notes")
    def save_notes(paper_id: str, version: str, body: NotesInput):
        with data_lock(root):
            get_meta(paper_id, version)
            path = file_path(paper_id, version, "notes.md")
            old = path.read_bytes() if path.exists() else b""
            if sha256(old) != body.etag:
                raise HTTPException(409, "笔记已在其他窗口修改。请复制当前草稿后重新加载，避免覆盖。")
            if old:
                atomic_write(file_path(paper_id, version, ".history") / f"notes-{uuid.uuid4().hex}.md", old)
            atomic_write(path, body.content)
        return {"content": body.content, "etag": sha256(body.content.encode("utf-8"))}

    # Note images live beside notes.md, so the Markdown file also renders in
    # any local editor through its relative "note-assets/<name>" links.
    @app.post("/api/papers/{paper_id}/{version}/note-assets")
    async def upload_note_asset(paper_id: str, version: str, file: UploadFile = File()):
        ext = NOTE_IMAGE_TYPES.get(file.content_type or "")
        if not ext:
            raise HTTPException(415, "仅支持 PNG、JPEG、GIF、WebP 图片")
        raw = await file.read(NOTE_IMAGE_MAX + 1)
        await file.close()
        if len(raw) > NOTE_IMAGE_MAX:
            raise HTTPException(413, "图片超过 20 MB")
        get_meta(paper_id, version)
        name = f"{sha256(raw)[:16]}{ext}"
        path = file_path(paper_id, version, f"note-assets/{name}")
        if not path.exists():
            atomic_write(path, raw)
        return {"path": f"note-assets/{name}"}

    @app.get("/api/papers/{paper_id}/{version}/note-assets/{name}")
    def note_asset(paper_id: str, version: str, name: str):
        if not NOTE_ASSET.fullmatch(name):
            raise HTTPException(404, "图片不存在")
        path = file_path(paper_id, version, f"note-assets/{name}")
        if not path.exists():
            raise HTTPException(404, "图片不存在")
        return FileResponse(path, headers={"Cache-Control": "max-age=31536000, immutable"})

    @app.get("/api/papers/{paper_id}/{version}/corrections")
    def corrections(paper_id: str, version: str):
        get_meta(paper_id, version)
        return {"corrections": read_corrections(file_path(paper_id, version, "corrections.jsonl"))}

    @app.post("/api/papers/{paper_id}/{version}/corrections")
    def save_correction(paper_id: str, version: str, body: CorrectionInput):
        with data_lock(root):
            get_meta(paper_id, version)
            record = Correction(**body.model_dump(), correction_id="corr_" + uuid.uuid4().hex)
            path = file_path(paper_id, version, "corrections.jsonl")
            old = path.read_text(encoding="utf-8") if path.exists() else ""
            read_corrections(path)
            atomic_write(path, old + record.model_dump_json() + "\n")
        return record

    def read_highlights(paper_id, version) -> list[Highlight]:
        path = file_path(paper_id, version, "highlights.json")
        return [Highlight.model_validate(h) for h in read_json(path)["highlights"]] if path.exists() else []

    def write_highlights(paper_id, version, items: list[Highlight]):
        path = file_path(paper_id, version, "highlights.json")
        write_json(path, {"schema_version": "1.0", "highlights": [h.model_dump() for h in items]})

    @app.get("/api/papers/{paper_id}/{version}/highlights")
    def highlights(paper_id: str, version: str):
        get_meta(paper_id, version)
        return {"highlights": [h.model_dump() for h in read_highlights(paper_id, version)]}

    # Highlights change one item at a time, so a phone and a desktop marking the
    # same paper never overwrite each other's work.
    @app.post("/api/papers/{paper_id}/{version}/highlights")
    def add_highlight(paper_id: str, version: str, body: HighlightInput):
        with data_lock(root):
            get_meta(paper_id, version)
            items = read_highlights(paper_id, version)
            item = Highlight(**body.model_dump(), highlight_id="hl_" + uuid.uuid4().hex,
                             page=min(r.page for r in body.rects))
            write_highlights(paper_id, version, [*items, item])
        return item

    @app.patch("/api/papers/{paper_id}/{version}/highlights/{highlight_id}")
    def edit_highlight(paper_id: str, version: str, highlight_id: str, body: HighlightPatch):
        with data_lock(root):
            get_meta(paper_id, version)
            items = read_highlights(paper_id, version)
            item = next((h for h in items if h.highlight_id == highlight_id), None)
            if item is None:
                raise HTTPException(404, "高亮不存在，可能已在其他设备删除")
            for key, value in body.model_dump(exclude_none=True).items():
                setattr(item, key, value)
            item.updated_at = now()
            write_highlights(paper_id, version, items)
        return item

    @app.delete("/api/papers/{paper_id}/{version}/highlights/{highlight_id}")
    def delete_highlight(paper_id: str, version: str, highlight_id: str):
        with data_lock(root):
            get_meta(paper_id, version)
            items = read_highlights(paper_id, version)
            rest = [h for h in items if h.highlight_id != highlight_id]
            if len(rest) != len(items):
                atomic_write(file_path(paper_id, version, ".history") / f"highlights-{uuid.uuid4().hex}.json",
                             json.dumps({"highlights": [h.model_dump() for h in items]}, ensure_ascii=False))
                write_highlights(paper_id, version, rest)
        return {"deleted": len(rest) != len(items)}

    def read_study(paper_id, version):
        path = file_path(paper_id, version, "study.json")
        raw = path.read_bytes() if path.exists() else b""
        study = Study.model_validate_json(raw) if raw else Study()
        return study, sha256(raw)

    @app.get("/api/papers/{paper_id}/{version}/study")
    def study(paper_id: str, version: str):
        get_meta(paper_id, version)
        value, etag = read_study(paper_id, version)
        return {"study": value.model_dump(), "etag": etag}

    @app.put("/api/papers/{paper_id}/{version}/study")
    def save_study(paper_id: str, version: str, body: StudyInput):
        with data_lock(root):
            get_meta(paper_id, version)
            path = file_path(paper_id, version, "study.json")
            old = path.read_bytes() if path.exists() else b""
            if sha256(old) != body.etag:
                raise HTTPException(409, "学习记录已在其他窗口修改。请刷新后再编辑，避免覆盖。")
            if old:
                atomic_write(file_path(paper_id, version, ".history") / f"study-{uuid.uuid4().hex}.json", old)
            body.study.updated_at = now()
            raw = body.study.model_dump_json(indent=2).encode("utf-8")
            atomic_write(path, raw)
        return {"study": body.study.model_dump(), "etag": sha256(raw)}

    @app.get("/api/study/overview")
    def study_overview():
        """Per-paper study summary for library cards plus every idea across papers."""
        papers, ideas = {}, []
        for item in list_papers()["papers"]:
            pid, ver = item["paper_id"], item["version"]
            try:
                value, _ = read_study(pid, ver)
            except (ValueError, OSError):
                continue
            j = value.judgment
            scores = [j.novelty, j.effectiveness, j.problem_size]
            answered = [t for t in value.tests if t.verdict != "unanswered"]
            papers[f"{pid}/{ver}"] = {
                "passes": value.passes,
                "tests_answered": len(answered),
                "tests_mastered": sum(t.verdict == "got_it" for t in answered),
                "value_score": scores[0] * scores[1] * scores[2] if all(scores) else None,
                "ideas": len(value.ideas),
            }
            ideas += [{"paper_id": pid, "version": ver, "title": item["title"], **i.model_dump()} for i in value.ideas]
        ideas.sort(key=lambda i: i["created_at"], reverse=True)
        return {"papers": papers, "ideas": ideas}

    @app.get("/api/concepts")
    def concepts():
        path = safe_path(root, "concepts", "index.json")
        return read_json(path) if path.exists() else {"schema_version": "1.0", "concepts": []}

    @app.get("/api/concepts/{slug}")
    def concept(slug: str):
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
            raise ValueError("Invalid concept slug")
        return {"content": safe_path(root, "concepts", slug + ".md").read_text(encoding="utf-8")}

    register_workspace(app, root, app_root)
    register_translation(app, root, app_root)
    from .research import register_research
    register_research(app, root)
    from .questions import register_questions
    register_questions(app, root)
    # One local production server. API routes are registered before SPA fallback.
    dist = safe_path(app_root, "frontend", "dist")
    if dist.exists():
        @app.get("/{asset_path:path}")
        def frontend(asset_path: str):
            if asset_path.startswith("api/"):
                raise HTTPException(404, "API not found")
            path = safe_path(dist, asset_path)
            if path.is_file():
                mime = {".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm"}.get(path.suffix)
                return FileResponse(path, media_type=mime)
            if "." in Path(asset_path).name:
                raise HTTPException(404, "Asset not found")
            return FileResponse(safe_path(dist, "index.html"), headers={"Cache-Control": "no-cache"})
    return app


app = create_app()
