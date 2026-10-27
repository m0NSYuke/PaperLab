"""Ideas inside research lines (Idea 区): quick sparks that are later explored, compared and chosen.

<data>/ideas.json holds every idea: {"schema_version": "1.0", "ideas": [Idea, ...]}. An idea belongs
to one research line (lines.json id, or "" while unfiled). Deleting sets `deleted_at` so the
idea can be restored; the list endpoint hides deleted ideas. Human-owned like notes: report
generation never touches this file.
"""
import uuid
from typing import Literal

from fastapi import HTTPException
from pydantic import Field

from .models import Model, now
from .storage import data_lock, read_json, safe_path, write_json

Status = Literal["spark", "exploring", "parked", "dropped", "chosen"]


def score():
    return Field(default=None, ge=1, le=5)


class IdeaScores(Model):
    novelty: int | None = score()
    feasibility: int | None = score()
    impact: int | None = score()
    cost: int | None = score()


class IdeaInput(Model):
    line: str = Field(default="", max_length=60, pattern=r"^([a-z0-9]+(?:-[a-z0-9]+)*)?$")
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=20000)
    status: Status = "spark"
    scores: IdeaScores = Field(default_factory=IdeaScores)
    pros: str = Field(default="", max_length=4000)
    cons: str = Field(default="", max_length=4000)
    next_step: str = Field(default="", max_length=1000)
    papers: list[str] = Field(default_factory=list, max_length=40)


class IdeaSave(IdeaInput):
    etag: str


class Idea(IdeaInput):
    id: str
    created_at: str
    updated_at: str
    deleted_at: str | None = None


def register_line_ideas(app, root):
    path = safe_path(root, "ideas.json")

    def load() -> list[dict]:
        return read_json(path).get("ideas", []) if path.exists() else []

    def store(ideas):
        write_json(path, {"schema_version": "1.0", "ideas": ideas})

    def find(ideas, idea_id):
        for i, idea in enumerate(ideas):
            if idea["id"] == idea_id:
                return i, idea
        raise HTTPException(404, "这个 idea 不存在")

    def view(idea):
        return Idea.model_validate(idea).model_dump() | {"etag": idea["updated_at"]}

    @app.get("/api/ideas")
    def ideas_list():
        return {"ideas": [view(i) for i in load() if not i.get("deleted_at")]}

    @app.post("/api/ideas")
    def ideas_create(body: IdeaInput):
        stamp = now()
        idea = Idea(**body.model_dump(), id=f"idea-{uuid.uuid4().hex[:10]}", created_at=stamp, updated_at=stamp).model_dump()
        with data_lock(root):
            store(load() + [idea])
        return view(idea)

    @app.put("/api/ideas/{idea_id}")
    def ideas_save(idea_id: str, body: IdeaSave):
        with data_lock(root):
            ideas = load()
            i, current = find(ideas, idea_id)
            if current["updated_at"] != body.etag:
                raise HTTPException(409, "这个 idea 已在其他窗口修改。为避免覆盖，请刷新后再改。")
            data = body.model_dump(exclude={"etag"})
            ideas[i] = Idea(**current | data | {"updated_at": now()}).model_dump()
            store(ideas)
            return view(ideas[i])

    @app.delete("/api/ideas/{idea_id}")
    def ideas_delete(idea_id: str):
        with data_lock(root):
            ideas = load()
            i, _ = find(ideas, idea_id)
            ideas[i]["deleted_at"] = now()
            store(ideas)
        return {"deleted": idea_id}

    @app.post("/api/ideas/{idea_id}/restore")
    def ideas_restore(idea_id: str):
        with data_lock(root):
            ideas = load()
            i, _ = find(ideas, idea_id)
            ideas[i]["deleted_at"] = None
            store(ideas)
            return view(ideas[i])
