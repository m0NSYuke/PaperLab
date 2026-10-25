"""Free-standing idea memos (随记): one Markdown file each, not tied to a paper.

<data>/memos/<id>.md     a few `key: value` header lines between --- fences, then Markdown
<data>/memos/assets/     pasted images, linked as assets/<name> so Typora/Obsidian also show them
<data>/memos/.history/   earlier versions (at most one snapshot per memo every 10 minutes)
<data>/memos/.trash/     deleted memos, restorable
"""
import re
import time
import uuid
from pathlib import Path

from fastapi import File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import Field

from .models import Model, now
from .storage import atomic_write, data_lock, safe_path, sha256

MEMO_ID = re.compile(r"memo-[0-9a-f]{12}")
ASSET = re.compile(r"[0-9a-f]{16}\.(?:png|jpg|gif|webp)")
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}
IMAGE_MAX = 20 * 1024 * 1024
SNAPSHOT_EVERY = 600


class MemoInput(Model):
    title: str = Field(default="", max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=12)
    pinned: bool = False
    body: str = Field(default="", max_length=500_000)


class MemoSave(MemoInput):
    etag: str


def clean_tags(tags):
    seen = []
    for tag in tags:
        tag = re.sub(r"[\s,，#]+", " ", tag).strip()[:32]
        if tag and tag not in seen:
            seen.append(tag)
    return seen


def render(memo):
    line = lambda value: re.sub(r"[\r\n]+", " ", str(value)).strip()
    header = [f"title: {line(memo['title'])}", f"created: {memo['created']}", f"updated: {memo['updated']}"]
    if memo["tags"]:
        header.append(f"tags: {', '.join(line(tag) for tag in memo['tags'])}")
    if memo["pinned"]:
        header.append("pinned: true")
    return "---\n" + "\n".join(header) + "\n---\n" + memo["body"].strip() + "\n"


def parse(memo_id, raw: bytes):
    text = raw.decode("utf-8").replace("\r\n", "\n")
    match = re.match(r"---\n(.*?)\n---\n?(.*)\Z", text, re.S)
    meta, body = ({}, text) if not match else (
        dict(line.split(":", 1) for line in match[1].split("\n") if ":" in line), match[2])
    meta = {key.strip(): value.strip() for key, value in meta.items()}
    return {"id": memo_id, "title": meta.get("title", ""), "created": meta.get("created", ""),
            "updated": meta.get("updated", ""), "tags": clean_tags(meta.get("tags", "").split(",")),
            "pinned": meta.get("pinned") == "true", "body": body.strip(), "etag": sha256(raw)}


def summary(memo):
    """List entry: body text without Markdown noise, for previews and search."""
    plain = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", memo["body"])
    plain = re.sub(r"[#>*_`~|\-]+|\$+", " ", plain)
    plain = re.sub(r"\s+", " ", plain).strip()
    return {key: memo[key] for key in ("id", "title", "created", "updated", "tags", "pinned")} | {
        "excerpt": plain[:160], "search": plain[:4000], "images": len(re.findall(r"!\[[^\]]*\]\(", memo["body"])),
        "chars": len(plain)}


def register_memos(app, root: Path):
    folder = lambda *parts: safe_path(root, "memos", *parts)

    def memo_path(memo_id):
        if not MEMO_ID.fullmatch(memo_id):
            raise HTTPException(404, "随记不存在")
        return folder(f"{memo_id}.md")

    def load(memo_id):
        path = memo_path(memo_id)
        if not path.exists():
            raise HTTPException(404, "随记不存在，可能已被删除")
        return parse(memo_id, path.read_bytes())

    def write(memo, old: bytes | None = None):
        path = memo_path(memo["id"])
        if old:
            # Autosave runs often; keep one earlier version per memo per 10 minutes.
            history = folder(".history")
            latest = max(history.glob(f"{memo['id']}-*.md"), default=None, key=lambda p: p.stat().st_mtime) if history.exists() else None
            if latest is None or time.time() - latest.stat().st_mtime > SNAPSHOT_EVERY:
                atomic_write(history / f"{memo['id']}-{int(time.time())}.md", old)
        raw = render(memo).encode("utf-8")
        atomic_write(path, raw)
        return parse(memo["id"], raw)

    @app.get("/api/memos")
    def listing():
        base = folder()
        memos = [summary(parse(p.stem, p.read_bytes())) for p in base.glob("memo-*.md") if MEMO_ID.fullmatch(p.stem)] if base.exists() else []
        # Pinned first, then most recently edited.
        memos.sort(key=lambda m: m["updated"], reverse=True)
        memos.sort(key=lambda m: not m["pinned"])
        return {"memos": memos}

    @app.post("/api/memos")
    def create(body: MemoInput):
        stamp = now()
        memo = {"id": f"memo-{uuid.uuid4().hex[:12]}", "title": body.title, "created": stamp, "updated": stamp,
                "tags": clean_tags(body.tags), "pinned": body.pinned, "body": body.body}
        with data_lock(root):
            return write(memo)

    @app.get("/api/memos/{memo_id}")
    def read(memo_id: str):
        return load(memo_id)

    @app.put("/api/memos/{memo_id}")
    def save(memo_id: str, body: MemoSave):
        with data_lock(root):
            current = load(memo_id)
            if current["etag"] != body.etag:
                raise HTTPException(409, "这条随记已在其他窗口修改。为避免覆盖，请复制当前内容后刷新。")
            memo = {**current, "title": body.title, "tags": clean_tags(body.tags), "pinned": body.pinned,
                    "body": body.body, "updated": now()}
            return write(memo, memo_path(memo_id).read_bytes())

    @app.delete("/api/memos/{memo_id}")
    def remove(memo_id: str):
        with data_lock(root):
            path = memo_path(memo_id)
            if not path.exists():
                raise HTTPException(404, "随记不存在")
            atomic_write(folder(".trash", f"{memo_id}-{int(time.time())}.md"), path.read_bytes())
            path.unlink()
        return {"deleted": memo_id}

    @app.post("/api/memos/{memo_id}/restore")
    def restore(memo_id: str):
        with data_lock(root):
            path = memo_path(memo_id)
            trash = folder(".trash")
            copies = sorted(trash.glob(f"{memo_id}-*.md"), key=lambda p: p.stat().st_mtime) if trash.exists() else []
            if path.exists() or not copies:
                raise HTTPException(404, "回收站里没有这条随记")
            atomic_write(path, copies[-1].read_bytes())
            copies[-1].unlink()
            return load(memo_id)

    @app.post("/api/memos/assets")
    async def upload(file: UploadFile = File()):
        ext = IMAGE_TYPES.get(file.content_type or "")
        if not ext:
            raise HTTPException(415, "仅支持 PNG、JPEG、GIF、WebP 图片")
        raw = await file.read(IMAGE_MAX + 1)
        await file.close()
        if len(raw) > IMAGE_MAX:
            raise HTTPException(413, "图片超过 20 MB")
        name = f"{sha256(raw)[:16]}{ext}"
        path = folder("assets", name)
        if not path.exists():
            atomic_write(path, raw)
        return {"path": f"assets/{name}"}

    @app.get("/api/memos/assets/{name}")
    def asset(name: str):
        path = folder("assets", name) if ASSET.fullmatch(name) else None
        if path is None or not path.exists():
            raise HTTPException(404, "图片不存在")
        return FileResponse(path, headers={"Cache-Control": "max-age=31536000, immutable"})
