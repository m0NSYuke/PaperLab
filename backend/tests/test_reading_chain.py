import copy
import re

import pymupdf
import pytest

from app.importer import import_pdf
from app.reports import publish_report
from app.storage import paper_dir


def pdf(*pages):
    doc = pymupdf.open()
    for text in pages:
        doc.new_page().insert_text((72, 72), text)
    return doc.tobytes()


@pytest.fixture
def papers(tmp_path):
    main = import_pdf(tmp_path, pdf("Evidence on page one. The action horizon is 50.", "A second page."), "a.pdf", "Main")
    other = import_pdf(tmp_path, pdf("The baseline horizon is 30 steps."), "b.pdf", "Other")
    return tmp_path, main, other


def cite(meta, quote, page=1):
    return {"paper_id": meta.paper_id, "version": meta.version, "page": page, "quote": quote, "verification": "verified"}


def base(meta, claim_text, quote):
    return {"paper_id": meta.paper_id, "version": meta.version, "analysis_status": "ready", "overview": "Overview",
            "motivation": "Motivation", "contributions": "Contributions", "method": "Method", "mathematics": "Math",
            "training": "Training", "inference": "Inference", "experiments": [], "limitations": "Limits",
            "related_papers": [], "claims": [{"claim_id": "horizon", "section": "method", "claim_type": "paper_fact",
                "text": claim_text, "citations": [cite(meta, quote)], "evidence_status": "supported"}],
            "equations": [], "concept_links": [], "quality_checks": ["Fixture evidence checked"]}


def deep_report(meta):
    report = base(meta, "Action horizon 50", "The action horizon is 50.")
    evidence = cite(meta, "The action horizon is 50.")
    report.update({
        "schema_version": "1.3",
        "experiments": [{"name": "Horizon test", "dataset": "Fixture", "baselines": ["None"], "metric": "horizon",
                         "value": "50", "protocol": "Fixture protocol", "citations": [evidence]}],
        "equations": [{"equation_id": "eq1", "title": "Eq", "latex": "a=b", "symbols": [], "explanation": "Explain",
                       "derivation": ["Step $a=b$"], "derivation_type": "paper", "citations": [evidence],
                       "priority": "derive"}],
        "triage": {"depth": "deep", "depth_source": "user", "user_context": "这是对标论文", "role": "对标论文",
                   "paper_type": "method", "problem": "Problem", "core_change": "Change",
                   "headline_result": "Horizon reaches 50", "cost": "No training", "credibility": "Single fixture",
                   "rationale": "Baseline to beat", "claim_ids": ["horizon"]},
        "deltas": [{"delta_id": "d1", "component": "Horizon", "prior": "Shorter horizon", "change": "Horizon 50",
                    "evidence": "Horizon test", "load_bearing": "yes", "claim_ids": ["horizon"]}],
        "evidence_audit": [{"check_id": "c1", "assertion": "Horizon 50 works", "claim_ids": ["horizon"],
                            "experiments": ["Horizon test"], "strength": "strong", "fairness": "Same fixture",
                            "gaps": "No ablation"}],
        "comparisons": [{"title": "Horizon", "dimensions": ["Horizon"], "rows": [
            {"label": "This", "source": "this_paper", "cells": ["50"], "citations": [evidence]},
            {"label": "Other", "source": "unverified", "cells": ["需训练"]}]}],
    })
    return report


def test_deep_report_publishes_macro_before_micro(papers):
    root, meta, _ = papers
    published = publish_report(root, deep_report(meta))
    assert published.triage.depth == "deep" and published.equations[0].priority == "derive"
    md = (paper_dir(root, meta.paper_id, meta.version) / "report.md").read_text(encoding="utf-8")
    order = ["## 分诊卡", "## Overview", "## 改进点对照", "## 横向对比", "## Method", "## Mathematics",
             "## Experiments", "## 实验审计", "## Limitations"]
    positions = [md.index(heading) for heading in order]
    assert positions == sorted(positions)
    assert "精读（你指定）" in md and "阅读优先级：必须自己推导" in md and "未核验，仅定性" in md


def mutate(path, value):
    def apply(report):
        target = report
        for key in path[:-1]:
            target = target[key]
        if value is DELETE:
            del target[path[-1]]
        else:
            target[path[-1]] = value
    return apply


DELETE = object()
BROKEN = {
    "missing triage": (mutate(["triage"], DELETE), "requires triage"),
    "equation without priority": (mutate(["equations", 0, "priority"], DELETE), "requires priority"),
    "unknown triage claim": (mutate(["triage", "claim_ids"], ["nope"]), "unknown claim IDs"),
    "untraceable triage number": (mutate(["triage", "headline_result"], "Horizon reaches 64"), "triage.headline_result"),
    "untraceable delta number": (mutate(["deltas", 0, "prior"], "Horizon 12 before"), "deltas.d1.prior"),
    "untraceable audit number": (mutate(["evidence_audit", 0, "gaps"], "Only 3.5 runs"), "evidence_audit.c1.gaps"),
    "unknown experiment": (mutate(["evidence_audit", 0, "experiments"], ["Missing test"]), "unknown experiments"),
    "strong without experiment": (mutate(["evidence_audit", 0, "experiments"], []), "without any experiment"),
    "load bearing without evidence": (mutate(["deltas", 0, "claim_ids"], []), "without a claim or verified citation"),
    "unverified row with number": (mutate(["comparisons", 0, "rows", 1, "cells"], ["约 40"]), "must not contain numbers"),
    "cell count mismatch": (mutate(["comparisons", 0, "rows", 0, "cells"], ["50", "extra"]), "cells for 1 dimensions"),
    "this-paper row untraceable": (mutate(["comparisons", 0, "rows", 0, "cells"], ["64"]), "This.Horizon"),
    "deep without deltas": (mutate(["deltas"], []), "requires deltas"),
    "deep without audit": (mutate(["evidence_audit"], []), "requires evidence_audit"),
    "selective without focus": (mutate(["triage", "depth"], "selective"), "requires triage.focus"),
}


@pytest.mark.parametrize("name", BROKEN)
def test_inconsistent_reading_chain_never_published(papers, name):
    root, meta, _ = papers
    payload = deep_report(meta)
    change, reason = BROKEN[name]
    change(payload)
    with pytest.raises(ValueError, match=re.escape(reason)):
        publish_report(root, payload)
    assert not (paper_dir(root, meta.paper_id, meta.version) / "report.json").exists()


def other_row(other, cells, quote="The baseline horizon is 30 steps."):
    return {"label": "Other", "source": "local_report", "paper_id": other.paper_id, "version": other.version,
            "cells": cells, "citations": [cite(other, quote)]}


def test_cross_paper_row_must_match_the_other_papers_evidence(papers):
    root, meta, other = papers
    payload = deep_report(meta)
    payload["comparisons"][0]["rows"][1] = other_row(other, ["30"])
    with pytest.raises(ValueError, match="no published report"):
        publish_report(root, copy.deepcopy(payload))
    publish_report(root, base(other, "Baseline horizon 30 steps", "The baseline horizon is 30 steps."))
    assert publish_report(root, copy.deepcopy(payload)).comparisons[0].rows[1].cells == ["30"]
    wrong_value = copy.deepcopy(payload)
    wrong_value["comparisons"][0]["rows"][1] = other_row(other, ["31"])
    with pytest.raises(ValueError, match="31"):
        publish_report(root, wrong_value)
    fake_quote = copy.deepcopy(payload)
    fake_quote["comparisons"][0]["rows"][1] = other_row(other, ["30"], quote="The baseline horizon is 31 steps.")
    with pytest.raises(ValueError, match="does not match"):
        publish_report(root, fake_quote)
    misattributed = copy.deepcopy(payload)
    misattributed["comparisons"][0]["rows"][0]["citations"].append(cite(other, "The baseline horizon is 30 steps."))
    with pytest.raises(ValueError, match="not that paper's local_report row"):
        publish_report(root, misattributed)


def test_skim_report_needs_only_triage(papers):
    root, meta, _ = papers
    payload = base(meta, "Action horizon 50", "The action horizon is 50.")
    payload.update({"schema_version": "1.3", "triage": {
        "depth": "skim", "paper_type": "survey", "problem": "Problem", "core_change": "Change",
        "headline_result": "Horizon 50", "cost": "None", "credibility": "Fixture", "rationale": "Background only",
        "claim_ids": ["horizon"]}})
    published = publish_report(root, payload)
    assert published.triage.depth_source == "recommended" and published.deltas == []


def test_schema_14_requires_the_paper_outline():
    import pytest
    from app.models import OutlineItem, Report
    base = {"paper_id": "x", "version": "v1", "overview": "", "motivation": "", "contributions": "", "method": "",
            "mathematics": "", "training": "", "inference": "", "experiments": [], "limitations": "",
            "related_papers": [], "claims": [{"claim_id": "c1", "text": "t", "section": "overview",
                                             "claim_type": "inference", "citations": [], "evidence_status": "missing"}],
            "equations": [], "concept_links": [], "quality_checks": [],
            "triage": {"depth": "skim", "depth_source": "recommended", "paper_type": "method", "claim_ids": ["c1"],
                       "problem": "p", "core_change": "c", "headline_result": "h", "cost": "c", "credibility": "c", "rationale": "r"}}
    with pytest.raises(ValueError, match="outline"):
        Report.model_validate(base | {"schema_version": "1.4"})
    report = Report.model_validate(base | {"schema_version": "1.4", "outline": [
        {"title": "1 Introduction", "page": 1, "role": "问题与动机", "summary": "为什么要做", "key": True},
        {"title": "3.1 Dynamics", "page": 3, "level": 2}]})
    assert isinstance(report.outline[0], OutlineItem) and report.outline[1].level == 2
    # Older schemas stay valid without an outline.
    assert Report.model_validate(base | {"schema_version": "1.3"}).outline == []
