"""Human-owned reading questions, independently retained across report updates."""
import uuid
from typing import Literal

from pydantic import Field

from .models import Model, Metadata, now
from .storage import atomic_write, data_lock, paper_dir, read_json, safe_path


class QuestionInput(Model):
    question: str = Field(min_length=1, max_length=30000)
    context: str = Field(default="", max_length=60000)
    section: str = Field(default="", max_length=300)
    page: int = Field(ge=1)
    report_revision: int | None = Field(default=None, ge=1)


class QuestionRecord(QuestionInput):
    schema_version: Literal["1.0"] = "1.0"
    question_id: str = Field(pattern=r"^q_[a-f0-9]{32}$")
    created_at: str = Field(default_factory=now)
    updated_at: str = Field(default_factory=now)
    resolved: bool = False


class QuestionStatus(Model):
    resolved: bool


def path_for(root, pid, version):
    folder = paper_dir(root, pid, version)
    Metadata.model_validate(read_json(folder / "metadata.json"))
    return safe_path(root, str(folder.relative_to(root)), "questions.jsonl")


def read_questions(root, pid, version):
    path = path_for(root, pid, version)
    latest = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                item = QuestionRecord.model_validate_json(line)
                latest[item.question_id] = item
    return list(latest.values())


def append_record(root, pid, version, record):
    path = path_for(root, pid, version)
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    atomic_write(path, old + record.model_dump_json() + "\n")
    return record


def save_question(root, pid, version, body):
    with data_lock(root):
        meta = Metadata.model_validate(read_json(paper_dir(root, pid, version)/"metadata.json"))
        if body.page > meta.page_count:
            raise ValueError("问题来源页码超出范围")
        read_questions(root, pid, version)
        return append_record(root, pid, version, QuestionRecord(
            **body.model_dump(), question_id="q_"+uuid.uuid4().hex))


def register_questions(app, root):
    @app.get("/api/papers/{pid}/{version}/questions")
    def listing(pid: str, version: str):
        return {"questions":read_questions(root, pid, version)}

    @app.post("/api/papers/{pid}/{version}/questions")
    def create(pid: str, version: str, body: QuestionInput):
        return save_question(root, pid, version, body)

    @app.patch("/api/papers/{pid}/{version}/questions/{question_id}")
    def status(pid: str, version: str, question_id: str, body: QuestionStatus):
        from fastapi import HTTPException
        with data_lock(root):
            record = next((q for q in read_questions(root, pid, version) if q.question_id == question_id), None)
            if record is None:
                raise HTTPException(404, "问题不存在")
            record.resolved = body.resolved
            record.updated_at = now()
            return append_record(root, pid, version, record)
