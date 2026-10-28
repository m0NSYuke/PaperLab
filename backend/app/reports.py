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
    """Citations into this report's own paper. Comparison rows may also cite other library papers (foreign_citations)."""
    for collection in (report.claims, report.equations, report.experiments, report.related_papers, report.self_test,
                       report.deltas):
        for item in collection:
            yield from item.citations
    if report.tutorial:
        for group in (report.tutorial.prerequisites, report.tutorial.walkthrough,
                      report.tutorial.worked_examples, report.tutorial.faq):
            for item in group:
                yield from item.citations
    for table in report.comparisons:
        for row in table.rows:
            yield from (c for c in row.citations if (c.paper_id, c.version) == (report.paper_id, report.version))


def foreign_citations(report: Report):
    for table in report.comparisons:
        for row in table.rows:
            for c in row.citations:
                if (c.paper_id, c.version) != (report.paper_id, report.version):
                    yield row, c


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
                 "analysis_status", "schema_version", "relation", "derivation_type", "level",
                 "depth", "depth_source", "user_context", "paper_type", "load_bearing", "strength", "priority",
                 "source"}


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


def read_pages(root: Path, paper_id: str, version: str) -> list:
    pages_path = paper_dir(root, paper_id, version, True) / "pages.json"
    pages_path = safe_path(root, str(pages_path.relative_to(root)))
    return read_json(pages_path)["pages"] if pages_path.exists() else []


# Numbers in the summary layers (triage, deltas, audit, comparisons) must be traceable to the evidence layer.
# arXiv IDs and calendar years are identifiers, not results; single digits are too common to trace reliably.
NUMBER_SKIP = re.compile(r"\b\d{4}\.\d{4,5}(?:v\d+)?\b|(?<![\d.])(?:19|20)\d{2}(?![\d.])")
NUMBER = re.compile(r"\d+(?:\.\d+)?")


def numbers(text: str) -> set[str]:
    return {n for n in NUMBER.findall(NUMBER_SKIP.sub(" ", text)) if "." in n or len(n) >= 2}


def evidence_numbers(report: Report) -> set[str]:
    """Numbers stated in claims, experiments and verified quotes of this report."""
    texts = [c.text for c in report.claims]
    for e in report.experiments:
        texts += [e.name, e.dataset, e.metric, e.value, e.protocol, *e.baselines]
    texts += [c.quote for c in all_citations(report) if c.verification == "verified"]
    return set().union(*(numbers(t) for t in texts)) if texts else set()


def untraceable(text: str, known: set[str]) -> list[str]:
    return sorted(numbers(text) - known)


def local_report(root: Path, paper_id: str, version: str) -> Report:
    path = paper_dir(root, paper_id, version) / "report.json"
    path = safe_path(root, str(path.relative_to(root)))
    if not path.exists():
        raise ValueError(f"Comparison row cites {paper_id} {version}, which has no published report in the library")
    return Report.model_validate(read_json(path))


def validate_reading_chain(root: Path, report: Report):
    """Every number in the summary layers must appear in the evidence it points to; foreign quotes must match their PDF."""
    known = evidence_numbers(report)
    problems = []
    def check(where: str, text: str, pool: set[str]):
        missing = untraceable(text, pool)
        if missing:
            problems.append(f"{where} 「{', '.join(missing)}」")
    if report.triage:
        t = report.triage
        for field in ("role", "problem", "core_change", "headline_result", "cost", "credibility", "rationale"):
            check(f"triage.{field}", getattr(t, field), known)
        for i, item in enumerate(t.focus):
            check(f"triage.focus[{i}]", item, known)
    for d in report.deltas:
        for field in ("component", "prior", "change", "evidence"):
            check(f"deltas.{d.delta_id}.{field}", getattr(d, field), known)
    for c in report.evidence_audit:
        for field in ("assertion", "fairness", "gaps"):
            check(f"evidence_audit.{c.check_id}.{field}", getattr(c, field), known)
    foreign_pages = {}
    for row, c in foreign_citations(report):
        if row.source != "local_report" or (c.paper_id, c.version) != (row.paper_id, row.version):
            raise ValueError(f"Comparison row '{row.label}' cites {c.paper_id} {c.version} but is not that paper's local_report row")
        if c.source_type != "pdf":
            continue
        key = (c.paper_id, c.version)
        if key not in foreign_pages:
            foreign_pages[key] = read_pages(root, *key)
        pages = foreign_pages[key]
        if c.page and c.page > len(pages):
            raise ValueError(f"Comparison citation page out of range for {c.paper_id}: {c.page}")
        if c.verification == "verified" and (not pages or normalize(c.quote) not in normalize(pages[c.page - 1]["text"])):
            raise ValueError(f"Comparison quote does not match {c.paper_id} PDF page {c.page}: {c.quote[:80]}")
    pools = []
    for table in report.comparisons:
        for row in table.rows:
            quotes = set().union(*(numbers(c.quote) for c in row.citations if c.verification == "verified")) if row.citations else set()
            if row.source == "this_paper":
                pool = known | quotes
            elif row.source == "local_report":
                pool = evidence_numbers(local_report(root, row.paper_id, row.version)) | quotes
            else:
                pool = set()
            pools.append(pool)
            for i, cell in enumerate(row.cells):
                check(f"comparisons「{table.title}」.{row.label}.{table.dimensions[i]}", cell, pool)
        check(f"comparisons「{table.title}」.note", table.note, known.union(*pools) if pools else known)
    if problems:
        raise ValueError(f"{len(problems)} summary statement(s) contain numbers not found in the cited evidence "
                         f"(claims, experiments or verified quotes): " + "; ".join(problems[:8]))


def validate_evidence(root: Path, report: Report, meta: Metadata):
    pages = read_pages(root, report.paper_id, report.version)
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
    for item in report.outline:
        if item.page > meta.page_count:
            raise ValueError(f"Outline page out of range: {item.title} p.{item.page}")
    if report.reading_guide:
        for stop in report.reading_guide.first_pass + report.reading_guide.must_read:
            if stop.page > meta.page_count:
                raise ValueError(f"Reading guide page out of range: {stop.page}")
    if report.analysis_status == "ready":
        for claim in report.claims:
            if claim.claim_type == "paper_fact" and not any(c.verification == "verified" for c in claim.citations):
                raise ValueError(f"Ready report contains unsupported paper fact: {claim.claim_id}")
    validate_reading_chain(root, report)


DEPTH = {"deep": "精读", "selective": "选读", "skim": "略读"}
DEPTH_SOURCE = {"user": "你指定", "recommended": "AI 建议，最终由你判断"}
PAPER_TYPE = {"method": "方法", "system": "系统", "benchmark": "基准 / 评测", "survey": "综述",
              "technical_report": "技术报告", "analysis": "分析", "other": "其他"}
LOAD_BEARING = {"yes": "承重", "partial": "部分承重", "no": "非承重", "untested": "未检验"}
STRENGTH = {"strong": "强", "moderate": "中", "weak": "弱", "none": "无"}
PRIORITY = {"derive": "必须自己推导", "understand": "理解即可", "skip": "可跳过"}
ROW_SOURCE = {"this_paper": "本文原文", "local_report": "本地报告", "unverified": "未核验，仅定性"}


def cell(text: str) -> str:
    return " ".join(text.split()).replace("|", "\\|") or "—"


def table(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(cell(h) for h in header) + " |", "|" + " --- |" * len(header)]
    return "\n".join(lines + ["| " + " | ".join(cell(c) for c in row) + " |" for row in rows])


def render_reading_chain_top(report: Report) -> list[str]:
    """Triage first, then the macro picture: problem, deltas against prior work, cross-paper comparison."""
    chunks = []
    if report.triage:
        t = report.triage
        chunks += ["## 分诊卡", table(["项目", "内容"], [
            ["阅读深度", f"{DEPTH[t.depth]}（{DEPTH_SOURCE[t.depth_source]}）"],
            *([["你的说明", t.user_context]] if t.user_context else []),
            *([["在你研究中的角色", t.role]] if t.role else []),
            ["论文类型", PAPER_TYPE[t.paper_type]], ["要解决的问题", t.problem], ["核心改动", t.core_change],
            ["主结果", t.headline_result], ["代价", t.cost], ["可信度初判", t.credibility], ["深度理由", t.rationale],
            *([["重点阅读", "；".join(t.focus)]] if t.focus else []),
            ["依据结论", ", ".join(t.claim_ids)]])]
    for field, label in [("overview", "Overview"), ("motivation", "Motivation"), ("contributions", "Contributions")]:
        chunks.extend([f"## {label}", getattr(report, field)])
    if report.deltas:
        chunks += ["## 改进点对照", table(["模块", "前作做法", "本文改动", "证据", "是否承重"],
                                    [[d.component, d.prior, d.change, d.evidence, LOAD_BEARING[d.load_bearing]]
                                     for d in report.deltas])]
    if report.comparisons:
        chunks += ["## 横向对比"]
        for t in report.comparisons:
            chunks += [f"### {t.title}", table(["方法", *t.dimensions, "数据来源"],
                                               [[r.label, *r.cells, ROW_SOURCE[r.source]] for r in t.rows])]
            if t.note:
                chunks.append(t.note)
    return chunks


def render_markdown(report: Report, title: str) -> str:
    chunks = [f"# {title}", f"版本 {report.version} · 报告 revision {report.revision} · {report.generated_at}"]
    chunks += render_reading_chain_top(report)
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
    for field, label in [("method", "Method"), ("training", "Training"), ("inference", "Inference"),
                         ("mathematics", "Mathematics")]:
        chunks.extend([f"## {label}", getattr(report, field)])
    for eq in report.equations:
        chunks += [f"### {eq.title} ({eq.equation_id})", f"$$\n{eq.latex}\n$$",
                   *([f"阅读优先级：{PRIORITY[eq.priority]}"] if eq.priority else []), eq.explanation,
                   "\n".join(f"- ${s.symbol}$: {s.definition}" + (f" [{s.shape}]" if s.shape else "") for s in eq.symbols),
                   f"推导类型：{eq.derivation_type}", "\n".join(f"{i+1}. {s}" for i, s in enumerate(eq.derivation))]
    chunks += ["## Experiments"]
    for item in report.experiments:
        chunks += [f"### {item.name}", f"数据：{item.dataset}\n\n基线：{', '.join(item.baselines)}\n\n指标：{item.metric}\n\n结果：{item.value}\n\n协议：{item.protocol}"]
    if report.evidence_audit:
        chunks += ["## 实验审计", table(["作者主张", "支撑实验", "支撑力度", "对比是否公平", "缺失的实验", "依据结论"],
                                    [[c.assertion, "；".join(c.experiments) or "无", STRENGTH[c.strength],
                                      c.fairness, c.gaps, ", ".join(c.claim_ids)] for c in report.evidence_audit])]
    chunks.extend(["## Limitations", report.limitations])
    chunks += ["## Relations"]
    chunks += [f"- {r.title} ({r.relation}; verified={r.verified}): {r.explanation}" for r in report.related_papers]
    chunks += ["## Claims and evidence"]
    for c in report.claims:
        chunks += [f"### {c.claim_id} [{c.claim_type}; {c.evidence_status}]", c.text]
        chunks += [f"> p.{x.page or '?'} / {x.section or ''} ({x.verification}): {x.quote}" for x in c.citations]
    chunks += ["## Equation, experiment and relation sources"]
    for collection in (report.equations, report.experiments, report.related_papers, report.deltas):
        for item in collection:
            label = getattr(item, "title", None) or getattr(item, "name", None) or getattr(item, "component", "")
            chunks += [f"- {label}: p.{c.page or '?'} ({c.verification}) {c.quote}" for c in item.citations]
    for t in report.comparisons:
        for row in t.rows:
            chunks += [f"- {t.title} / {row.label}: {c.paper_id} {c.version} p.{c.page or '?'} ({c.verification}) {c.quote}"
                       for c in row.citations]
    if report.outline:
        chunks += ["## Paper outline"]
        chunks += ["\n".join(("  " if x.level == 2 else "") + f"- p.{x.page} {x.title}" + (f"【{x.role}】" if x.role else "")
                             + ("（必读）" if x.key else "") + (f"：{x.summary}" if x.summary else "") for x in report.outline)]
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
        if report.triage and not meta.paper_type:
            meta.paper_type = report.triage.paper_type
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
