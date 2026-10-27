"""Library housekeeping: the technical-tag list and deleting papers to a recoverable trash.

Tags: <data>/tags.json {"tags": [...]} is the user's list; until it exists the built-in
DEFAULT_TAGS apply. Tags used by any paper always show, so a paper is never left with an
invisible tag. Deleting a tag removes it from every paper; renaming merges into an existing tag.
Tag names travel in request bodies because several contain "/".

Papers: deleting moves papers/<id>/<v> and local-assets/<id>/<v> to <data>/.trash/<trash_id>/
together with the research-line entries it held, so restore puts everything back. Nothing is
ever removed for good by the app.
"""
import json
import os
import re
import shutil
import time

from fastapi import HTTPException
from pydantic import Field

from .models import Metadata, Model, now
from .storage import data_lock, paper_dir, read_json, safe_path, write_json

DEFAULT_TAGS = ["VLA", "World Model", "Diffusion / Flow Matching", "视频生成", "推理加速", "LLM 推理与 RL",
                "Transformer / LLM / VLM", "具身机器人", "计算机视觉"]
TRASH_ID = re.compile(r"[A-Za-z0-9._-]+-v\d+-\d+")


class TagInput(Model):
    name: str = Field(min_length=1, max_length=40)


class TagRename(Model):
    old: str = Field(min_length=1, max_length=40)
    new: str = Field(min_length=1, max_length=40)


def tag_list(root) -> list[str]:
    path = safe_path(root, "tags.json")
    return read_json(path).get("tags", []) if path.exists() else list(DEFAULT_TAGS)


def all_metadata(root):
    for meta_path in root.glob("papers/*/*/metadata.json"):
        try:
            yield meta_path, Metadata.model_validate(read_json(meta_path))
        except (ValueError, OSError):
            continue


def register_library_admin(app, root):
    def save_tags(tags):
        write_json(safe_path(root, "tags.json"), {"schema_version": "1.0", "tags": tags})

    def tags_view():
        counts: dict[str, int] = {}
        for _, meta in all_metadata(root):
            for t in meta.topics:
                counts[t] = counts.get(t, 0) + 1
        names = tag_list(root)
        names += [t for t in counts if t not in names]
        return {"tags": [{"name": t, "count": counts.get(t, 0)} for t in names]}

    def retag(change):
        """Apply `change(topics) -> topics` to every paper; returns how many papers changed."""
        changed = 0
        for meta_path, meta in all_metadata(root):
            topics = change(list(meta.topics))
            if topics != meta.topics:
                meta.topics = topics
                write_json(meta_path, meta.model_dump())
                changed += 1
        return changed

    @app.get("/api/tags")
    def tags_get():
        return tags_view()

    @app.post("/api/tags")
    def tags_add(body: TagInput):
        name = body.name.strip()
        with data_lock(root):
            tags = tag_list(root)
            if name not in tags:
                save_tags(tags + [name])
        return tags_view()

    @app.post("/api/tags/delete")
    def tags_delete(body: TagInput):
        name = body.name
        with data_lock(root):
            save_tags([t for t in tag_list(root) if t != name])
            changed = retag(lambda topics: [t for t in topics if t != name])
        return tags_view() | {"papers_changed": changed}

    @app.post("/api/tags/rename")
    def tags_rename(body: TagRename):
        old, new = body.old, body.new.strip()
        with data_lock(root):
            tags = tag_list(root)
            renamed = [new if t == old else t for t in tags]
            if old not in tags:
                renamed.append(new)
            save_tags(list(dict.fromkeys(renamed)))  # renaming onto an existing tag merges them
            changed = retag(lambda topics: list(dict.fromkeys(new if t == old else t for t in topics)))
        return tags_view() | {"papers_changed": changed}

    @app.delete("/api/papers/{paper_id}/{version}")
    def paper_delete(paper_id: str, version: str):
        key = f"{paper_id}/{version}"
        folder = paper_dir(root, paper_id, version)
        if not (folder / "metadata.json").exists():
            raise HTTPException(404, "论文不存在")
        trash_id = f"{paper_id}-{version}-{int(time.time() * 1000)}"
        trash = safe_path(root, ".trash", trash_id)
        from .lines import Lines, save_lines
        with data_lock(root):
            trash.mkdir(parents=True)
            shutil.move(str(folder), str(trash / "papers"))
            assets = paper_dir(root, paper_id, version, True)
            if assets.exists():
                shutil.move(str(assets), str(trash / "local-assets"))
            held = []
            lines_path = safe_path(root, "lines.json")
            if lines_path.exists():
                data = Lines.model_validate(read_json(lines_path))
                for line in data.lines:
                    for i, entry in enumerate(line.papers):
                        if entry.key == key:
                            held.append({"line": line.id, "index": i, "entry": entry.model_dump()})
                    line.papers = [p for p in line.papers if p.key != key]
                if held:
                    save_lines(root, data)
            write_json(trash / "deleted.json", {"key": key, "deleted_at": now(), "lines": held})
        return {"deleted": key, "trash_id": trash_id}

    @app.post("/api/papers/restore/{trash_id}")
    def paper_restore(trash_id: str):
        if not TRASH_ID.fullmatch(trash_id):
            raise HTTPException(404, "回收站里没有这篇论文")
        trash = safe_path(root, ".trash", trash_id)
        if not (trash / "deleted.json").exists():
            raise HTTPException(404, "回收站里没有这篇论文")
        record = read_json(trash / "deleted.json")
        paper_id, version = record["key"].split("/")
        folder = paper_dir(root, paper_id, version)
        from .lines import LinePaper, Lines, save_lines
        with data_lock(root):
            if folder.exists():
                raise HTTPException(409, "这篇论文已经在文献库里了（可能重新导入过）")
            folder.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(trash / "papers"), str(folder))
            if (trash / "local-assets").exists():
                assets = paper_dir(root, paper_id, version, True)
                assets.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(trash / "local-assets"), str(assets))
            lines_path = safe_path(root, "lines.json")
            if record["lines"] and lines_path.exists():
                data = Lines.model_validate(read_json(lines_path))
                for held in record["lines"]:
                    line = next((l for l in data.lines if l.id == held["line"]), None)
                    if line and not any(p.key == record["key"] for p in line.papers):
                        line.papers.insert(min(held["index"], len(line.papers)), LinePaper(**held["entry"]))
                save_lines(root, data)
            (trash / "deleted.json").unlink()
            os.rmdir(trash)
        return Metadata.model_validate(read_json(folder / "metadata.json")).model_dump()
