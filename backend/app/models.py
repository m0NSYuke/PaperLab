from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Metadata(Model):
    schema_version: Literal["1.0"] = "1.0"
    paper_id: str
    version: str
    title: str
    authors: list[str] = []
    year: int | None = None
    source_url: str | None = None
    doi: str | None = None
    pdf_path: str | None = None
    tex_path: str | None = None
    pdf_sha256: str | None = None
    tex_sha256: str | None = None
    topics: list[str] = []
    reading_status: Literal["unread", "reading", "completed"] = "unread"
    analysis_status: Literal["not_analyzed", "analyzing", "ready", "failed", "needs_review"] = "not_analyzed"
    imported_at: str = Field(default_factory=now)
    last_opened_at: str | None = None
    page_count: int = 0
    warnings: list[str] = []


class Citation(Model):
    source_type: Literal["pdf", "external"] = "pdf"
    paper_id: str
    version: str
    page: int | None = Field(default=None, ge=1)
    section: str | None = None
    quote: str = ""
    url: str | None = None
    verification: Literal["verified", "unverified", "missing"] = "unverified"

    @model_validator(mode="after")
    def evidence_present(self):
        if self.verification == "verified" and (not self.quote.strip() or (self.source_type == "pdf" and not self.page)):
            raise ValueError("Verified citations require an exact quote and PDF page")
        return self


class Claim(Model):
    claim_id: str
    text: str
    section: Literal["overview", "method", "mathematics", "experiments", "relations"]
    claim_type: Literal["paper_fact", "paper_interpretation", "external_background", "inference", "uncertain"]
    citations: list[Citation] = []
    evidence_status: Literal["supported", "missing", "needs_review"] = "missing"

    @model_validator(mode="after")
    def supported(self):
        if self.evidence_status == "supported" and not self.citations:
            raise ValueError("Supported claim requires evidence")
        return self


class Symbol(Model):
    symbol: str
    definition: str
    shape: str | None = None


class Equation(Model):
    equation_id: str
    title: str
    latex: str
    symbols: list[Symbol]
    explanation: str
    derivation: list[str]
    derivation_type: Literal["paper", "auxiliary_explanation"] = "auxiliary_explanation"
    citations: list[Citation]
    # 1.3: derive = new and load-bearing, work it out yourself; understand = inherited/standard; skip = implementation detail.
    priority: Literal["derive", "understand", "skip"] | None = None


class Experiment(Model):
    name: str
    dataset: str
    baselines: list[str]
    metric: str
    value: str
    protocol: str
    citations: list[Citation]


class Relation(Model):
    title: str
    relation: Literal["citation", "extends", "compares_with", "shares_method"]
    explanation: str
    verified: bool = False
    url: str | None = None
    citations: list[Citation] = []


class GuideStop(Model):
    page: int = Field(ge=1)
    label: str = Field(min_length=1, max_length=300)
    why: str = Field(default="", max_length=2000)


class OutlineItem(Model):
    """One section of the paper as printed, and what it does in the paper's argument."""
    title: str = Field(min_length=1, max_length=200)
    page: int = Field(ge=1)
    level: Literal[1, 2] = 1
    role: str = Field(default="", max_length=20)
    summary: str = Field(default="", max_length=600)
    key: bool = False


class ReadingGuide(Model):
    """Three-pass reading route. first_pass = skim stops; must_read = pages the reader studies personally."""
    first_pass: list[GuideStop] = []
    must_read: list[GuideStop] = []


class SelfTestItem(Model):
    question_id: str = Field(min_length=1, max_length=100)
    level: Literal["recall", "understand", "transfer"] = "understand"
    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)
    citations: list[Citation] = []


class TeachingUnit(Model):
    unit_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1)
    citations: list[Citation] = []


class TutorialFAQ(Model):
    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)
    citations: list[Citation] = []


class Tutorial(Model):
    introduction: str
    prerequisites: list[TeachingUnit] = []
    walkthrough: list[TeachingUnit] = []
    worked_examples: list[TeachingUnit] = []
    faq: list[TutorialFAQ] = []


class Triage(Model):
    """First-pass verdict written before the deep read. A recommendation; the reader's own judgment lives in study.json."""
    depth: Literal["deep", "selective", "skim"]
    depth_source: Literal["user", "recommended"] = "recommended"
    user_context: str = Field(default="", max_length=2000)
    role: str = Field(default="", max_length=500)
    paper_type: Literal["method", "system", "benchmark", "survey", "technical_report", "analysis", "other"]
    problem: str = Field(min_length=1)
    core_change: str = Field(min_length=1)
    headline_result: str = Field(min_length=1)
    cost: str = Field(min_length=1)
    credibility: str = Field(min_length=1)
    rationale: str = Field(min_length=1)
    focus: list[str] = []
    claim_ids: list[str] = Field(min_length=1)


class Delta(Model):
    """One component: how prior work does it, what this paper changes, and whether the change carries the result."""
    delta_id: str = Field(min_length=1, max_length=100)
    component: str = Field(min_length=1, max_length=300)
    prior: str = Field(min_length=1)
    change: str = Field(min_length=1)
    evidence: str = Field(min_length=1)
    load_bearing: Literal["yes", "partial", "no", "untested"]
    claim_ids: list[str] = []
    citations: list[Citation] = []


class EvidenceCheck(Model):
    """Claim -> experiment audit: which experiments carry a claim, how strongly, and what is missing."""
    check_id: str = Field(min_length=1, max_length=100)
    assertion: str = Field(min_length=1)
    claim_ids: list[str] = Field(min_length=1)
    experiments: list[str] = []
    strength: Literal["strong", "moderate", "weak", "none"]
    fairness: str = ""
    gaps: str = ""


class ComparisonRow(Model):
    label: str = Field(min_length=1, max_length=300)
    # this_paper: values read from this paper's own PDF (including its baseline tables);
    # local_report: values from another library paper's published report; unverified: qualitative only, no numbers.
    source: Literal["this_paper", "local_report", "unverified"]
    paper_id: str | None = None
    version: str | None = None
    cells: list[str]
    citations: list[Citation] = []


class Comparison(Model):
    title: str = Field(min_length=1, max_length=300)
    dimensions: list[str] = Field(min_length=1)
    rows: list[ComparisonRow] = Field(min_length=2)
    note: str = ""


class Report(Model):
    # 1.1 adds optional reading_guide / self_test; 1.3 adds triage / deltas / evidence_audit / comparisons;
    # 1.4 requires the paper outline. Older reports stay valid unchanged.
    schema_version: Literal["1.0", "1.1", "1.2", "1.3", "1.4"] = "1.1"
    paper_id: str
    version: str
    generated_at: str = Field(default_factory=now)
    revision: int = Field(default=1, ge=1)
    analysis_status: Literal["ready", "needs_review", "failed"] = "needs_review"
    overview: str
    motivation: str
    contributions: str
    method: str
    mathematics: str
    training: str
    inference: str
    experiments: list[Experiment]
    limitations: str
    related_papers: list[Relation]
    claims: list[Claim]
    equations: list[Equation]
    concept_links: list[str]
    quality_checks: list[str]
    reading_guide: ReadingGuide | None = None
    self_test: list[SelfTestItem] = []
    tutorial: Tutorial | None = None
    triage: Triage | None = None
    deltas: list[Delta] = []
    evidence_audit: list[EvidenceCheck] = []
    comparisons: list[Comparison] = []
    outline: list[OutlineItem] = []

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [c.claim_id for c in self.claims]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate claim IDs")
        questions = [q.question_id for q in self.self_test]
        if len(questions) != len(set(questions)):
            raise ValueError("Duplicate self-test question IDs")
        if self.tutorial:
            ids = [u.unit_id for group in (self.tutorial.prerequisites, self.tutorial.walkthrough, self.tutorial.worked_examples) for u in group]
            if len(ids) != len(set(ids)):
                raise ValueError("Duplicate teaching unit IDs")
        for label, ids in [("delta", [d.delta_id for d in self.deltas]),
                           ("evidence check", [c.check_id for c in self.evidence_audit])]:
            if len(ids) != len(set(ids)):
                raise ValueError(f"Duplicate {label} IDs")
        if self.schema_version in ("1.3", "1.4"):
            self.check_reading_chain()
        if self.schema_version == "1.4" and not self.outline:
            raise ValueError("Schema 1.4 report requires the paper outline (outline)")
        return self

    def check_reading_chain(self):
        """1.3 structure: every summary-layer statement points at claims/experiments that exist in this report."""
        if not self.triage:
            raise ValueError("Schema 1.3 report requires triage")
        claims = {c.claim_id for c in self.claims}
        experiments = {e.name for e in self.experiments}
        refs = [("triage", self.triage.claim_ids)] + [(f"delta {d.delta_id}", d.claim_ids) for d in self.deltas] \
            + [(f"evidence check {c.check_id}", c.claim_ids) for c in self.evidence_audit]
        for owner, ids in refs:
            unknown = [i for i in ids if i not in claims]
            if unknown:
                raise ValueError(f"{owner} references unknown claim IDs: {', '.join(unknown)}")
        for eq in self.equations:
            if eq.priority is None:
                raise ValueError(f"Schema 1.3 equation {eq.equation_id} requires priority (derive/understand/skip)")
        for d in self.deltas:
            if d.load_bearing != "untested" and not d.claim_ids and not any(c.verification == "verified" for c in d.citations):
                raise ValueError(f"delta {d.delta_id} judges load_bearing={d.load_bearing} without a claim or verified citation")
        for c in self.evidence_audit:
            unknown = [e for e in c.experiments if e not in experiments]
            if unknown:
                raise ValueError(f"evidence check {c.check_id} references unknown experiments: {', '.join(unknown)}")
            if c.strength in ("strong", "moderate") and not c.experiments:
                raise ValueError(f"evidence check {c.check_id} rates strength={c.strength} without any experiment")
        for table in self.comparisons:
            for row in table.rows:
                if len(row.cells) != len(table.dimensions):
                    raise ValueError(f"comparison '{table.title}' row '{row.label}' has {len(row.cells)} cells for {len(table.dimensions)} dimensions")
                if row.source == "local_report" and not (row.paper_id and row.version):
                    raise ValueError(f"comparison row '{row.label}' from a local report needs paper_id and version")
                if row.source == "unverified" and any(ch.isdigit() for cell in row.cells for ch in cell):
                    raise ValueError(f"comparison row '{row.label}' is unverified and must not contain numbers")
        if self.triage.depth == "deep":
            if not self.deltas:
                raise ValueError("Deep-read report requires deltas")
            if self.experiments and not self.evidence_audit:
                raise ValueError("Deep-read report with experiments requires evidence_audit")
        if self.triage.depth == "selective" and not self.triage.focus:
            raise ValueError("Selective-read report requires triage.focus")


class CorrectionInput(Model):
    claim_id: str = Field(min_length=1, max_length=200)
    type: Literal["factual_error", "mathematical_error", "citation_error", "missing_information", "unclear_explanation", "other"]
    original_text: str = Field(max_length=100000)
    corrected_text: str = Field(min_length=1, max_length=100000)
    reason: str = Field(default="", max_length=100000)
    status: Literal["accepted", "open", "dismissed"] = "accepted"


class Correction(CorrectionInput):
    correction_id: str
    created_at: str = Field(default_factory=now)


class NotesInput(Model):
    content: str = Field(max_length=2000000)
    etag: str


HighlightColor = Literal["yellow", "green", "blue", "pink", "purple"]


class HighlightRect(Model):
    """One line box of a PDF highlight, as fractions of its page's width/height."""
    page: int = Field(ge=1)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


class HighlightInput(Model):
    text: str = Field(min_length=1, max_length=20000)
    color: HighlightColor = "yellow"
    note: str = Field(default="", max_length=20000)
    rects: list[HighlightRect] = Field(min_length=1, max_length=2000)


class HighlightPatch(Model):
    color: HighlightColor | None = None
    note: str | None = Field(default=None, max_length=20000)


class Highlight(HighlightInput):
    highlight_id: str
    page: int = Field(ge=1)
    created_at: str = Field(default_factory=now)
    updated_at: str = Field(default_factory=now)


class MetadataPatch(Model):
    reading_status: Literal["unread", "reading", "completed"] | None = None
    topics: list[str] | None = None
    title: str | None = Field(default=None, min_length=1, max_length=1000)
    last_opened_at: str | None = None


class ImportInput(Model):
    reference: str = Field(min_length=1, max_length=1000)


# Study data is human-owned (like notes): report regeneration never touches study.json.
def score():
    return Field(default=None, ge=1, le=5)


class Judgment(Model):
    """Li Mu's value lens (novelty x effectiveness x problem size) plus Levine/Hamming prompts."""
    novelty: int | None = score()
    effectiveness: int | None = score()
    problem_size: int | None = score()
    reasons: str = Field(default="", max_length=20000)
    bottleneck: str = Field(default="", max_length=20000)
    next_step: str = Field(default="", max_length=20000)


class TestAttempt(Model):
    question_id: str = Field(min_length=1, max_length=100)
    my_answer: str = Field(default="", max_length=50000)
    verdict: Literal["unanswered", "got_it", "partial", "missed"] = "unanswered"
    updated_at: str = Field(default_factory=now)


class Idea(Model):
    idea_id: str = Field(pattern=r"^idea_[a-z0-9]{6,40}$")
    text: str = Field(min_length=1, max_length=5000)
    status: Literal["new", "exploring", "parked", "dropped"] = "new"
    source: str = Field(default="", max_length=500)
    created_at: str = Field(default_factory=now)


class Study(Model):
    schema_version: Literal["1.0"] = "1.0"
    passes: list[Literal[1, 2, 3]] = []
    checked_stops: list[str] = Field(default=[], max_length=500)
    judgment: Judgment = Judgment()
    tests: list[TestAttempt] = Field(default=[], max_length=500)
    ideas: list[Idea] = Field(default=[], max_length=1000)
    updated_at: str | None = None


class StudyInput(Model):
    study: Study
    etag: str


class SourcePaper(Model):
    paper_id: str
    version: str


class ResearchInput(Model):
    skill_id: str = Field(max_length=100)
    title: str = Field(min_length=1, max_length=200)
    instruction: str = Field(min_length=1, max_length=6000)
    material: str = Field(default="", max_length=60000)
    papers: list[SourcePaper] = Field(default_factory=list, max_length=3)
    section: Literal["title", "abstract", "intro", "related-work", "method", "experiments", "discussion", "conclusion"] = "intro"
    language: Literal["zh", "en"] = "zh"
    journal: Literal["generic", "nature", "nature-family", "nat-comms", "nat-mach-intell"] = "generic"

    @field_validator("title", "instruction")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("内容不能为空")
        return value.strip()


class DraftCitation(SourcePaper):
    page: int = Field(ge=1)
    quote: str = Field(min_length=1, max_length=2000)


class DraftResult(Model):
    title: str = Field(min_length=1, max_length=300)
    markdown: str = Field(min_length=1, max_length=180000)
    warnings: list[str] = Field(max_length=40)
    citations: list[DraftCitation] = Field(max_length=100)

    @field_validator("markdown")
    @classmethod
    def substantive(cls, value):
        if not value.strip():
            raise ValueError("没有可保存的内容")
        return value


class DraftEdit(Model):
    content: str = Field(min_length=1, max_length=200000)
    etag: str = Field(pattern=r"^[a-f0-9]{64}$")
