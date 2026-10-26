"""Research lines (研究线): papers grouped by the idea or direction they serve, in reading order.

<data>/lines.json is hand-edited and read-only to the app:
{"schema_version": "1.0", "lines": [{"id": "cot-teaching", "name": "...", "kind": "idea",
  "question": "the idea in one or two sentences", "status": "构思中",
  "papers": [{"key": "2406.14629/v3", "role": "最接近的前作", "why": "what to take from it"}]}]}
A paper may sit in several lines; topics stay as technical tags.
"""
from typing import Literal

from pydantic import Field

from .models import Model
from .storage import read_json, safe_path


class LinePaper(Model):
    key: str = Field(pattern=r"^[A-Za-z0-9._-]+/v\d+$")
    role: str = Field(default="", max_length=40)
    why: str = Field(default="", max_length=600)


class Line(Model):
    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=60)
    kind: Literal["idea", "direction"] = "direction"
    question: str = Field(default="", max_length=1200)
    status: str = Field(default="", max_length=20)
    papers: list[LinePaper] = []


class Lines(Model):
    schema_version: Literal["1.0"] = "1.0"
    lines: list[Line] = []


def register_lines(app, root):
    @app.get("/api/lines")
    def lines():
        path = safe_path(root, "lines.json")
        return Lines.model_validate(read_json(path)) if path.exists() else Lines()
