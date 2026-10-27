"""Research lines (研究线): papers grouped by the idea or direction they serve, in reading order.

<data>/lines.json can be edited by hand:
{"schema_version": "1.0", "lines": [{"id": "cot-teaching", "name": "...", "kind": "idea",
  "question": "the idea in one or two sentences", "status": "构思中",
  "keywords": ["chain-of-thought", "teacher"],
  "papers": [{"key": "2406.14629/v3", "role": "最接近的前作", "why": "what to take from it"}]}]}
A paper may sit in several lines; topics stay as technical tags. `keywords` steer automatic
filing of new imports (autofile.py), which adds entries with `"auto": true` until the user
confirms, moves or removes them through the endpoints below.
"""
from typing import Literal

from fastapi import HTTPException
from pydantic import Field

from .models import Model
from .storage import data_lock, read_json, safe_path, write_json


class LinePaper(Model):
    key: str = Field(pattern=r"^[A-Za-z0-9._-]+/v\d+$")
    role: str = Field(default="", max_length=40)
    why: str = Field(default="", max_length=600)
    auto: bool = False


class Line(Model):
    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=60)
    kind: Literal["idea", "direction"] = "direction"
    question: str = Field(default="", max_length=1200)
    status: str = Field(default="", max_length=20)
    keywords: list[str] = Field(default_factory=list, max_length=60)
    papers: list[LinePaper] = []


class Lines(Model):
    schema_version: Literal["1.0"] = "1.0"
    lines: list[Line] = []


class MembershipInput(Model):
    role: str | None = Field(default=None, max_length=40)
    why: str | None = Field(default=None, max_length=600)


def save_lines(root, data: Lines):
    # Keep the hand-editable file short: leave out fields that still have their default.
    write_json(safe_path(root, "lines.json"), {"schema_version": "1.0"} | data.model_dump(exclude_defaults=True))


def register_lines(app, root):
    path = safe_path(root, "lines.json")

    def load() -> Lines:
        return Lines.model_validate(read_json(path)) if path.exists() else Lines()

    def line_of(data: Lines, line_id: str) -> Line:
        line = next((l for l in data.lines if l.id == line_id), None)
        if not line:
            raise HTTPException(404, "研究线不存在")
        return line

    @app.get("/api/lines")
    def lines():
        return load()

    @app.put("/api/lines/{line_id}/papers/{paper_id}/{version}")
    def line_paper_set(line_id: str, paper_id: str, version: str, body: MembershipInput):
        """Add a paper to a line, or confirm an automatic entry (it stops being `auto`)."""
        key = f"{paper_id}/{version}"
        with data_lock(root):
            data = load()
            line = line_of(data, line_id)
            entry = next((p for p in line.papers if p.key == key), None)
            if entry is None:
                entry = LinePaper(key=key)
                line.papers.append(entry)
            entry.auto = False
            if entry.role == "自动归入":
                entry.role = ""
            if body.role is not None:
                entry.role = body.role
            if body.why is not None:
                entry.why = body.why
            save_lines(root, data)
        return load()

    @app.delete("/api/lines/{line_id}/papers/{paper_id}/{version}")
    def line_paper_remove(line_id: str, paper_id: str, version: str):
        key = f"{paper_id}/{version}"
        with data_lock(root):
            data = load()
            line = line_of(data, line_id)
            line.papers = [p for p in line.papers if p.key != key]
            save_lines(root, data)
        return load()
