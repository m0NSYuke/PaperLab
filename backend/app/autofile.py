"""Automatic filing of imported papers into research lines and technical tags.

Runs after every import (web or CLI) for a paper that is in no line yet; nothing calls a model.
- Each line scores its keywords (`keywords` in lines.json) found in the paper's title (x3) and
  opening pages (x1, once per keyword), plus 20 x the content similarity to the line's papers
  (TF-IDF over their reports, from knowledge.Knowledge).
- The paper joins the best line, and any other line reaching 70 % of its score, as an entry with
  `auto: true` and the evidence in `why`. Below the threshold it stays unfiled for the user.
- Empty technical tags are filled from keyword rules, else from the most similar papers' tags.
- An empty paper type is taken from the report's triage, else guessed from the title (`guess_type`).
The user confirms, moves or removes auto-filed papers from the library.
"""
import re
from pathlib import Path

from .knowledge import Knowledge
from .lines import Lines, LinePaper, save_lines
from .models import Metadata
from .storage import data_lock, paper_dir, read_json, safe_path, write_json

THRESHOLD = 3.0
TOPIC_RULES = {
    "VLA": ["vision-language-action", "vla", "generalist robot policy", "视觉-语言-动作"],
    "World Model": ["world model", "world simulator", "physical world", "interactive environment", "世界模型"],
    "Diffusion / Flow Matching": ["diffusion", "flow matching", "rectified flow", "denoising"],
    "视频生成": ["video generation", "text-to-video", "video diffusion", "video generative", "视频生成"],
    "推理加速": ["speculative decoding", "acceleration", "speedup", "quantization", "sparse attention", "caching",
             "token pruning", "inference cost"],
    "LLM 推理与 RL": ["chain-of-thought", "reinforcement learning", "rlvr", "grpo", "reasoning model", "reward model"],
    "Transformer / LLM / VLM": ["large language model", "llm", "mllm", "vision-language model", "vlm", "multimodal model"],
    "具身机器人": ["robot", "manipulation", "embodied", "具身"],
    "计算机视觉": ["anomaly detection", "segmentation", "object detection", "异常检测"],
}

# Title cues for the paper type, checked in order; anything else is a method paper.
TYPE_RULES = [
    ("survey", r"\bsurvey\b|\boverview of\b|\ba review\b|systematic review|综述"),
    ("technical_report", r"technical report|\btech report\b|技术报告"),
    ("benchmark", r"bench(mark(s|ing)?)?\b|\bdatasets?\b|\barena\b|leaderboard|\bevaluation\b|\bevaluating\b|评测"),
    ("analysis", r"^(what|why|how|do|does|is|are|can|when)\b|empirical study|\brevisiting\b|\brethinking\b"
                 r"|\bunderstanding\b|\banalysis of\b|\blessons\b"),
]


def guess_type(title: str) -> str:
    low = title.lower()
    return next((kind for kind, cue in TYPE_RULES if re.search(cue, low)), "method")


def hits(keyword: str, text: str) -> int:
    """Occurrences of a keyword; Latin keywords must start at a word boundary (plurals still match)."""
    kw = keyword.lower()
    pattern = re.escape(kw) if re.search(r"[㐀-鿿]", kw) else r"(?<![a-z0-9])" + re.escape(kw)
    if len(kw) <= 4 and not re.search(r"[㐀-鿿]", kw):
        pattern += r"(?![a-z])"
    return len(re.findall(pattern, text))


def opening_text(root: Path, meta: Metadata) -> str:
    pages = paper_dir(root, meta.paper_id, meta.version, True) / "pages.json"
    if not pages.exists():
        return ""
    return " ".join(p["text"] for p in read_json(pages)["pages"][:2])


def short(title: str) -> str:
    head = re.split(r"[:：]", title)[0].strip()
    return head if len(head) <= 40 else head[:38] + "…"


def suggest(root: Path, meta: Metadata) -> dict:
    """Scores per line and suggested tags for one paper, without writing anything."""
    key = f"{meta.paper_id}/{meta.version}"
    title, text = meta.title.lower(), opening_text(root, meta).lower()
    knowledge = Knowledge(root)
    similar = {r["key"]: r for r in knowledge.related(key, k=60, text=f"{meta.title} {text}")}
    lines_path = root / "lines.json"
    lines = Lines.model_validate(read_json(lines_path)).lines if lines_path.exists() else []
    scored = []
    for line in lines:
        found = [kw for kw in line.keywords if hits(kw, title) or hits(kw, text)]
        kw_score = sum(3 if hits(kw, title) else 1 for kw in found)
        near = sorted((similar[p.key] for p in line.papers if p.key in similar and p.key != key),
                      key=lambda r: -r["similarity"])[:2]
        sim = near[0]["similarity"] if near else 0.0
        scored.append({"line": line.id, "name": line.name, "score": round(kw_score + 20 * sim, 2),
                       "keywords": found, "near": [(short(r["title"]), r["similarity"]) for r in near]})
    scored.sort(key=lambda s: -s["score"])
    topics = [t for t, kws in TOPIC_RULES.items()
              if sum(3 * hits(k, title) + min(hits(k, text), 3) for k in kws) >= 3]
    if not topics:
        # Borrow the tags shared by the closest papers.
        for r in sorted(similar.values(), key=lambda r: -r["similarity"])[:2]:
            other = r["key"].split("/")
            other_meta = read_json(paper_dir(root, other[0], other[1]) / "metadata.json")
            topics += [t for t in other_meta.get("topics", []) if t not in topics]
    from .library_admin import tag_list
    allowed = set(tag_list(root))
    return {"lines": scored, "topics": [t for t in topics if t in allowed][:3]}


def evidence(s: dict) -> str:
    parts = []
    if s["keywords"]:
        parts.append("命中关键词：" + "、".join(s["keywords"][:4]))
    near = [(t, v) for t, v in s["near"] if v >= 0.05]  # weaker similarity is noise, not evidence
    if near:
        parts.append("内容最接近：" + "、".join(f"{t}（{v:.2f}）" for t, v in near))
    return "；".join(parts) or "按内容相似度归入"


def autofile(root: Path, meta: Metadata, force: bool = False) -> dict:
    """File a paper that sits in no line yet; returns what was done. Never raises on bad data."""
    key = f"{meta.paper_id}/{meta.version}"
    result = suggest(root, meta)
    filed = []
    with data_lock(root):
        lines_path = root / "lines.json"
        if lines_path.exists():
            data = Lines.model_validate(read_json(lines_path))
            already = any(p.key == key for line in data.lines for p in line.papers)
            # `force` is the user asking for this paper explicitly; otherwise respect the switch.
            if force or (data.auto_file and not already):
                best = result["lines"][0]["score"] if result["lines"] else 0
                for s in result["lines"]:
                    if best >= THRESHOLD and s["score"] >= max(THRESHOLD, 0.7 * best):
                        line = next(l for l in data.lines if l.id == s["line"])
                        if not any(p.key == key for p in line.papers):
                            line.papers.append(LinePaper(key=key, role="自动归入", why=evidence(s), auto=True))
                            filed.append(s["line"])
                if filed:
                    save_lines(root, data)
        meta_path = safe_path(root, str(paper_dir(root, meta.paper_id, meta.version).relative_to(root)), "metadata.json")
        current = Metadata.model_validate(read_json(meta_path))
        changed = False
        if not current.topics and result["topics"]:
            current.topics, changed = result["topics"], True
        if not current.paper_type:
            report = meta_path.with_name("report.json")
            triage = read_json(report).get("triage") if report.exists() else None
            current.paper_type, changed = (triage or {}).get("paper_type") or guess_type(current.title), True
        if changed:
            write_json(meta_path, current.model_dump())
    return {"filed": filed, "topics": result["topics"], "paper_type": current.paper_type, "scores": result["lines"]}
