import json
import re
import unicodedata
from pathlib import Path

from .models import Metadata, Report, now
from .storage import atomic_write, data_lock, paper_dir, read_json, safe_path, write_json


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold()
    text = re.sub(r"-\s*\n\s*", "", text)
    return re.sub(r"\s+", " ", text).strip()


def all_citations(report: Report):
    for collection in (report.claims, report.equations, report.experiments, report.related_papers, report.self_test):
        for item in collection:
            yield from item.citations
    if report.tutorial:
        for group in (report.tutorial.prerequisites, report.tutorial.walkthrough,
                      report.tutorial.worked_examples, report.tutorial.faq):
            for item in group:
                yield from item.citations


# Readable notation: maths belongs inside $...$ / $$...$$ so the reader renders it.
# These patterns catch ASCII maths left in prose, which the browser shows verbatim.
MATH_SPANS = re.compile(r"\$\$.+?\$\$|\$[^$\n]+\$|```.+?```|`[^`\n]*`", re.S)
NOTATION_RULES = [
    (re.compile(r"[\w)\]}Ͱ-Ͽ']\^[\w({Ͱ-Ͽ\-]"), "上下标 ^ 写在 $...$ 外"),
    (re.compile(r"(?<![\w.])\.\d"), "小数缺少前导 0（如 .25 应写 0.25）"),
    (re.compile(r"\\[A-Za-z]+"), "LaTeX 命令写在 $...$ 外"),
    (re.compile(r"(?<![\w])[A-Za-zͰ-Ͽ]_[\w{Ͱ-Ͽ]"), "下标 _ 写在 $...$ 外"),
]
# Fields that hold LaTeX, verbatim PDF quotes or identifiers rather than reader-facing prose.
NOTATION_SKIP = {"latex", "symbol", "citations", "url", "paper_id", "version", "generated_at",
                 "concept_links", "quality_checks", "section", "claim_type", "evidence_status",
                 "analysis_status", "schema_version", "relation", "derivation_type", "level"}


def notation_problems(value, path: str = "report"):
    """Yield (field path, snippet, rule) for maths or numbers a reader cannot read as rendered."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key not in NOTATION_SKIP and not key.endswith("_id"):
                yield from notation_problems(item, f"{path}.{key}")
    elif isinstance(value, list):
        for i, item in enumerate(value):
            yield from notation_problems(item, f"{path}[{i}]")
    elif isinstance(value, str):
        prose = MATH_SPANS.sub(" ", value)
        for pattern, rule in NOTATION_RULES:
            for match in pattern.finditer(prose):
                start = max(0, match.start() - 12)
                yield path, prose[start:match.end() + 12].strip(), rule


def validate_notation(report: Report):
    problems = list(notation_problems(report.model_dump()))
    if problems:
        shown = "; ".join(f"{p} 「{s}」 {r}" for p, s, r in problems[:6])
        raise ValueError(f"Report has {len(problems)} unreadable notation issue(s); "
                         f"put formulas in $...$ and write decimals with a leading 0: {shown}")


def validate_evidence(root: Path, report: Report, meta: Metadata):
    pages_path = paper_dir(root, report.paper_id, report.version, True) / "pages.json"
    pages_path = safe_path(root, str(pages_path.relative_to(root)))
    pages = read_json(pages_path)["pages"] if pages_path.exists() else []
    for citation in all_citations(report):
        if citation.source_type != "pdf":
            continue
        if (citation.paper_id, citation.version) != (report.paper_id, report.version):
            raise ValueError("Citation identity differs from report")
        if citation.page and citation.page > meta.page_count:
            raise ValueError("Citation PDF page out of range")
        if citation.verification == "verified":
            if not pages or normalize(citation.quote) not in normalize(pages[citation.page - 1]["text"]):
                raise ValueError(f"Citation quote does not match PDF page {citation.page}: {citation.quote[:80]}")
    if report.reading_guide:
        for stop in report.reading_guide.first_pass + report.reading_guide.must_read:
            if stop.page > meta.page_count:
                raise ValueError(f"Reading guide page out of range: {stop.page}")
    if report.analysis_status == "ready":
        for claim in report.claims:
            if claim.claim_type == "paper_fact" and not any(c.verification == "verified" for c in claim.citations):
                raise ValueError(f"Ready report contains unsupported paper fact: {claim.claim_id}")


def render_markdown(report: Report, title: str) -> str:
    chunks = [f"# {title}", f"版本 {report.version} · 报告 revision {report.revision} · {report.generated_at}"]
    if report.tutorial:
        chunks += ["## 完整讲解", report.tutorial.introduction]
        for label, items in [("前置知识", report.tutorial.prerequisites), ("一步步读懂方法", report.tutorial.walkthrough),
                             ("带数值的教学例子", report.tutorial.worked_examples)]:
            chunks += [f"### {label}"]
            for item in items:
                chunks += [f"#### {item.title}", item.body]
                chunks += [f"> p.{c.page or '?'} ({c.verification}): {c.quote}" for c in item.citations]
        chunks += ["### 常见疑问"]
        for item in report.tutorial.faq:
            chunks += [f"#### {item.question}", item.answer]
            chunks += [f"> p.{c.page or '?'} ({c.verification}): {c.quote}" for c in item.citations]
    for field, label in [("overview", "Overview"), ("motivation", "Motivation"), ("contributions", "Contributions"),
                         ("method", "Method"), ("mathematics", "Mathematics"), ("training", "Training"),
                         ("inference", "Inference"), ("limitations", "Limitations")]:
        chunks.extend([f"## {label}", getattr(report, field)])
    for eq in report.equations:
        chunks += [f"### {eq.title} ({eq.equation_id})", f"$$\n{eq.latex}\n$$", eq.explanation,
                   "\n".join(f"- ${s.symbol}$: {s.definition}" + (f" [{s.shape}]" if s.shape else "") for s in eq.symbols),
                   f"推导类型：{eq.derivation_type}", "\n".join(f"{i+1}. {s}" for i, s in enumerate(eq.derivation))]
    chunks += ["## Experiments"]
    for item in report.experiments:
        chunks += [f"### {item.name}", f"数据：{item.dataset}\n\n基线：{', '.join(item.baselines)}\n\n指标：{item.metric}\n\n结果：{item.value}\n\n协议：{item.protocol}"]
    chunks += ["## Relations"]
    chunks += [f"- {r.title} ({r.relation}; verified={r.verified}): {r.explanation}" for r in report.related_papers]
    chunks += ["## Claims and evidence"]
    for c in report.claims:
        chunks += [f"### {c.claim_id} [{c.claim_type}; {c.evidence_status}]", c.text]
        chunks += [f"> p.{x.page or '?'} / {x.section or ''} ({x.verification}): {x.quote}" for x in c.citations]
    chunks += ["## Equation, experiment and relation sources"]
    for collection in (report.equations, report.experiments, report.related_papers):
        for item in collection:
            label = getattr(item, "title", getattr(item, "name", ""))
            chunks += [f"- {label}: p.{c.page or '?'} ({c.verification}) {c.quote}" for c in item.citations]
    if report.reading_guide:
        chunks += ["## Reading guide"]
        for label, stops in [("第一遍：快速浏览", report.reading_guide.first_pass), ("必须亲读", report.reading_guide.must_read)]:
            chunks += [f"### {label}", "\n".join(f"- p.{x.page} {x.label}" + (f"：{x.why}" if x.why else "")
                                                  for x in stops) or "（无）"]
    if report.self_test:
        chunks += ["## Self test"]
        for q in report.self_test:
            chunks += [f"### {q.question_id} [{q.level}]", q.question, f"参考答案：{q.answer}"]
    chunks += ["## Concepts", "\n".join(f"- [{c}](../../../concepts/{c}.md)" for c in report.concept_links),
               "## Quality checks", "\n".join(f"- {q}" for q in report.quality_checks)]
    return "\n\n".join(chunks) + "\n"


def publish_report(root: Path, payload: dict) -> Report:
    report = Report.model_validate(payload)
    validate_notation(report)
    folder =paper_dir(root, report.paper_id, report.version)
    path = lambda name: safe_path(root, str(folder.relative_to(root)), name)
    with data_lock(root):
        meta = Metadata.model_validate(read_json(path("metadata.json")))
        validate_evidence(root, report, meta)
        old = read_json(path("report.json")) if path("report.json").exists() else None
        report.revision = (old.get("revision", 0) if old else 0) + 1
        report.generated_at = now()
        corrections = read_corrections(path("corrections.jsonl"))
        latest = {x["claim_id"]: x for x in corrections}
        accepted = {k: x for k, x in latest.items() if x["status"] == "accepted"}
        new_claims = {c.claim_id: c for c in report.claims}
        conflicts = []
        for claim_id, correction in accepted.items():
            if claim_id not in new_claims or new_claims[claim_id].text != correction["corrected_text"]:
                conflicts.append(claim_id)
                if claim_id in new_claims:
                    new_claims[claim_id].evidence_status = "needs_review"
        if conflicts:
            report.analysis_status = "needs_review"
            report.quality_checks.append("人工纠错保留；以下结论需复核：" + ", ".join(conflicts))
        md = render_markdown(report, meta.title)
        index = {"schema_version": "1.0", "paper_id": report.paper_id, "version": report.version,
                 "pdf_sha256": meta.pdf_sha256, "page_count": meta.page_count,
                 "citations": [c.model_dump() for c in all_citations(report)]}
        meta.analysis_status = report.analysis_status
        outputs = {"report.md": md, "source-index.json": json.dumps(index, ensure_ascii=False, indent=2),
                   "metadata.json": meta.model_dump_json(indent=2), "report.json": report.model_dump_json(indent=2)}
        originals = {name: path(name).read_bytes() if path(name).exists() else None for name in outputs}
        if old:
            history = path(".history") / f"revision-{old.get('revision', 1)}-{now().replace(':', '-')}.json"
            write_json(history, old)
        try:
            # Every individual replacement is atomic. On ordinary errors restore all old outputs.
            # report.json is the commit marker and is replaced last.
            for name, content in outputs.items():
                atomic_write(path(name), content)
        except OSError:
            for name, content in originals.items():
                if content is not None:
                    atomic_write(path(name), content)
                elif path(name).exists():
                    path(name).unlink()
            raise
    return report


def read_corrections(path: Path):
    from .models import Correction
    if not path.exists():
        return []
    return [Correction.model_validate_json(line).model_dump() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
