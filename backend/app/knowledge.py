"""Library-wide knowledge (知识库): local full-text search, related papers and a knowledge graph.

Nothing here calls a model or an embedding API. Text comes from published reports, notes.md,
随记 and concept cards, tokenised as lower-cased Latin words plus overlapping CJK character
pairs and ranked with BM25. The index is rebuilt only when a source file changes.

The graph is derived from what the library already states: report concept_links, related
papers and comparison rows that name another library paper, research lines (lines.json),
plus TF-IDF similarity between reports.
"""
import math
import re
import threading
from collections import Counter
from pathlib import Path

from .storage import read_json

WORD = re.compile(r"[a-z0-9]+(?:[.+\-][a-z0-9]+)*")
CJK = re.compile(r"[㐀-鿿]+")
MARKUP = re.compile(r"\$+|\*\*|`|^#+\s*|^>\s*(\[![A-Z]+\]\s*)?|\[[a-z0-9_,\- ]+\]", re.M)
REPORT_FIELDS = [("overview", "概览"), ("motivation", "动机"), ("contributions", "贡献"), ("method", "方法"),
                 ("mathematics", "数学"), ("training", "训练"), ("inference", "推理"), ("limitations", "局限")]
KINDS = {"claim": "结论", "report": "报告", "equation": "公式", "tutorial": "讲解", "note": "笔记",
         "memo": "随记", "concept": "概念"}


def tokens(text: str) -> list[str]:
    text = text.lower()
    out = WORD.findall(text)
    for run in CJK.findall(text):
        out += [run[i:i + 2] for i in range(len(run) - 1)] if len(run) > 1 else [run]
    return out


LATEX = {"times": "×", "ldots": "…", "dots": "…", "cdots": "…", "le": "≤", "leq": "≤", "ge": "≥", "geq": "≥",
         "approx": "≈", "to": "→", "rightarrow": "→", "pi": "π", "tau": "τ", "lambda": "λ", "varepsilon": "ε", "beta": "β"}


def plain(text: str) -> str:
    """Report prose without Markdown or LaTeX markup, for search snippets."""
    text = MARKUP.sub("", text)
    text = re.sub(r"\\([a-zA-Z]+)", lambda m: LATEX.get(m.group(1), ""), text)
    text = re.sub(r"[{}]|\\[,;! ]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def paragraphs(text: str) -> list[str]:
    return [p for p in (plain(x) for x in re.split(r"\n\s*\n", text)) if len(p) >= 12]


def first_page(citations) -> int | None:
    return next((c.get("page") for c in citations or [] if c.get("source_type") == "pdf" and c.get("page")), None)


class Knowledge:
    def __init__(self, root: Path):
        self.root = root
        self.lock = threading.Lock()
        self.mark = None
        self.docs: list[dict] = []
        self.papers: dict[str, dict] = {}

    # ---------- sources ----------
    def sources(self) -> list[Path]:
        r = self.root
        files = list(r.glob("papers/*/*/metadata.json")) + list(r.glob("papers/*/*/report.json")) + \
            list(r.glob("papers/*/*/notes.md")) + list(r.glob("memos/memo-*.md")) + list(r.glob("concepts/*.md"))
        if (r / "lines.json").exists():
            files.append(r / "lines.json")
        return sorted(files)

    def refresh(self):
        files = self.sources()
        mark = tuple((str(f), f.stat().st_mtime_ns, f.stat().st_size) for f in files if f.exists())
        with self.lock:
            if mark != self.mark:
                self.build()
                self.mark = mark

    def build(self):
        docs, papers = [], {}

        def add(kind, text, **where):
            if text and len(text) >= 8:
                docs.append({"kind": kind, "text": text, **where})

        for meta_path in self.root.glob("papers/*/*/metadata.json"):
            try:
                meta = read_json(meta_path)
            except (OSError, ValueError):
                continue
            key = f"{meta['paper_id']}/{meta['version']}"
            folder = meta_path.parent
            info = {"key": key, "paper_id": meta["paper_id"], "version": meta["version"], "title": meta["title"],
                    "topics": meta.get("topics", []), "reading_status": meta.get("reading_status"),
                    "analysis_status": meta.get("analysis_status"), "report": None, "body": meta["title"]}
            papers[key] = info
            where = {"paper": key, "title": meta["title"]}
            report_path = folder / "report.json"
            if report_path.exists():
                try:
                    report = read_json(report_path)
                except (OSError, ValueError):
                    report = None
                if report:
                    info["report"] = report
                    body = [meta["title"]]
                    for field, label in REPORT_FIELDS:
                        for para in paragraphs(report.get(field) or ""):
                            add("report", para, label=label, page=None, **where)
                            body.append(para)
                    for c in report.get("claims", []):
                        add("claim", plain(c.get("text", "")), label=c.get("claim_id", ""), page=first_page(c.get("citations")), **where)
                    for e in report.get("equations", []):
                        add("equation", plain(f"{e.get('title', '')}：{e.get('explanation', '')}"), label=e.get("title", ""),
                            page=first_page(e.get("citations")), **where)
                    tutorial = report.get("tutorial") or {}
                    for group in ("prerequisites", "walkthrough", "worked_examples"):
                        for unit in tutorial.get(group) or []:
                            for para in paragraphs(unit.get("body", "")):
                                add("tutorial", para, label=unit.get("title", ""), page=first_page(unit.get("citations")), **where)
                    info["body"] = "\n".join(body)
            notes = folder / "notes.md"
            if notes.exists():
                for para in paragraphs(notes.read_text(encoding="utf-8")):
                    add("note", para, label="我的笔记", page=None, **where)

        for memo in self.root.glob("memos/memo-*.md"):
            text = memo.read_text(encoding="utf-8")
            title = (re.search(r"^title:\s*(.*)$", text, re.M) or [None, ""])[1].strip() or "无标题随记"
            body = re.sub(r"^---\n.*?\n---\n", "", text, flags=re.S)
            body = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", body)
            for para in paragraphs(body):
                add("memo", para, memo=memo.stem, title=title, label="随记", page=None)

        names = self.concept_names()
        for card in self.root.glob("concepts/*.md"):
            for para in paragraphs(card.read_text(encoding="utf-8")):
                add("concept", para, concept=card.stem, title=names.get(card.stem, card.stem), label="概念卡片", page=None)

        # BM25 statistics
        for d in docs:
            d["tf"] = Counter(tokens(d["text"] + " " + d.get("title", "")))
            d["len"] = sum(d["tf"].values())
        df = Counter()
        for d in docs:
            df.update(d["tf"].keys())
        self.df, self.n = df, len(docs)
        self.avg = sum(d["len"] for d in docs) / len(docs) if docs else 1
        self.docs, self.papers = docs, papers

    def concept_names(self) -> dict[str, str]:
        path = self.root / "concepts" / "index.json"
        try:
            return {c["slug"]: c["name"] for c in read_json(path)["concepts"]} if path.exists() else {}
        except (OSError, ValueError, KeyError):
            return {}

    # ---------- search ----------
    def search(self, query: str, limit: int = 30) -> list[dict]:
        self.refresh()
        terms = list(dict.fromkeys(tokens(query)))
        if not terms:
            return []
        phrase = query.strip().lower()
        scored = []
        for d in self.docs:
            score = 0.0
            for t in terms:
                f = d["tf"].get(t)
                if f:
                    idf = math.log(1 + (self.n - self.df[t] + 0.5) / (self.df[t] + 0.5))
                    score += idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * d["len"] / self.avg))
            if score and phrase in d["text"].lower():
                score *= 1.5
            if score:
                scored.append((score, d))
        scored.sort(key=lambda x: -x[0])
        hits = []
        for score, d in scored[:limit]:
            hits.append({k: d.get(k) for k in ("kind", "paper", "memo", "concept", "title", "label", "page")}
                        | {"kind_label": KINDS[d["kind"]], "snippet": snippet(d["text"], query, terms), "score": round(score, 3)})
        return hits

    # ---------- similarity ----------
    def vectors(self) -> dict[str, dict[str, float]]:
        bags = {k: Counter(tokens(p["body"])) for k, p in self.papers.items() if p["report"]}
        df = Counter()
        for bag in bags.values():
            df.update(bag.keys())
        n = len(bags) or 1
        vecs = {}
        for key, bag in bags.items():
            v = {t: (1 + math.log(f)) * math.log(1 + n / df[t]) for t, f in bag.items() if df[t] < n}
            norm = math.sqrt(sum(x * x for x in v.values())) or 1
            vecs[key] = {t: x / norm for t, x in v.items()}
        return vecs

    def related(self, key: str, k: int = 8, text: str | None = None) -> list[dict]:
        """Library papers closest to `key` (or to `text` for a paper without a report yet)."""
        self.refresh()
        vecs = self.vectors()
        if text is not None or key not in vecs:
            bag = Counter(tokens(text or self.papers.get(key, {}).get("body", "")))
            df = Counter()
            for v in vecs.values():
                df.update(v.keys())
            n = len(vecs) or 1
            q = {t: (1 + math.log(f)) * math.log(1 + n / (df[t] + 1)) for t, f in bag.items()}
            norm = math.sqrt(sum(x * x for x in q.values())) or 1
            q = {t: x / norm for t, x in q.items()}
        else:
            q = vecs[key]
        scores = [(sum(q.get(t, 0) * x for t, x in v.items()), other) for other, v in vecs.items() if other != key]
        scores.sort(key=lambda x: -x[0])
        out = []
        for s, other in scores[:k]:
            p = self.papers[other]
            out.append({"key": other, "title": p["title"], "similarity": round(s, 3),
                        "concepts": (p["report"] or {}).get("concept_links", [])})
        return out

    # ---------- graph ----------
    def graph(self) -> dict:
        self.refresh()
        names = self.concept_names()
        nodes, edges = [], []
        titles = {self.norm_title(p["title"]): k for k, p in self.papers.items()}
        for key, p in self.papers.items():
            nodes.append({"id": f"paper:{key}", "type": "paper", "label": p["title"], "key": key,
                          "topics": p["topics"], "reading_status": p["reading_status"], "analysis_status": p["analysis_status"]})
        used = set()
        seen = set()

        def link(a, b, kind, label=""):
            sig = (a, b, kind) if kind in ("uses", "in_line") else (min(a, b), max(a, b), kind)
            if a != b and sig not in seen:
                seen.add(sig)
                edges.append({"source": a, "target": b, "type": kind, "label": label})

        for key, p in self.papers.items():
            report = p["report"] or {}
            for slug in report.get("concept_links", []):
                if slug in names:
                    used.add(slug)
                    link(f"paper:{key}", f"concept:{slug}", "uses")
            for rel in report.get("related_papers", []):
                other = self.match_title(rel.get("title", ""), titles)
                if other:
                    link(f"paper:{key}", f"paper:{other}", "relation", rel.get("relation", ""))
            for table in report.get("comparisons", []):
                for row in table.get("rows", []):
                    if row.get("source") == "local_report":
                        other = f"{row.get('paper_id')}/{row.get('version')}"
                        if other in self.papers:
                            link(f"paper:{key}", f"paper:{other}", "compares", table.get("title", ""))
        for slug in sorted(used):
            nodes.append({"id": f"concept:{slug}", "type": "concept", "label": names[slug]})
        lines_path = self.root / "lines.json"
        if lines_path.exists():
            try:
                for line in read_json(lines_path).get("lines", []):
                    nodes.append({"id": f"line:{line['id']}", "type": "line", "label": line["name"], "kind": line.get("kind")})
                    for item in line.get("papers", []):
                        if item["key"] in self.papers:
                            link(f"paper:{item['key']}", f"line:{line['id']}", "in_line", item.get("role", ""))
            except (OSError, ValueError, KeyError):
                pass
        vecs = self.vectors()
        for key in vecs:
            for item in self.related(key, k=2):
                if item["similarity"] >= 0.08:
                    link(f"paper:{key}", f"paper:{item['key']}", "similar", f"{item['similarity']:.2f}")
        return {"nodes": nodes, "edges": edges}

    @staticmethod
    def norm_title(title: str) -> str:
        title = re.sub(r"（[^）]*）|\([^)]*\)", "", title)
        return re.sub(r"[^a-z0-9㐀-鿿]+", " ", title.lower()).strip()

    def match_title(self, title: str, titles: dict[str, str]) -> str | None:
        t = self.norm_title(title)
        if len(t) < 4:
            return None
        if t in titles:
            return titles[t]
        return next((k for full, k in titles.items() if full.startswith(t) or (len(t) >= 12 and t in full)), None)


def snippet(text: str, query: str, terms: list[str], width: int = 70) -> str:
    low = text.lower()
    spots = [low.find(query.strip().lower())] + [low.find(t) for t in terms]
    at = min((i for i in spots if i >= 0), default=0)
    start = max(0, at - width)
    end = min(len(text), at + width * 2)
    return ("…" if start else "") + text[start:end] + ("…" if end < len(text) else "")


def register_knowledge(app, root: Path):
    knowledge = Knowledge(root)

    @app.get("/api/knowledge/search")
    def knowledge_search(q: str, limit: int = 30):
        return {"query": q, "hits": knowledge.search(q[:200], max(1, min(limit, 80)))}

    @app.get("/api/knowledge/graph")
    def knowledge_graph():
        return knowledge.graph()

    @app.get("/api/knowledge/related/{paper_id}/{version}")
    def knowledge_related(paper_id: str, version: str, k: int = 8):
        return {"related": knowledge.related(f"{paper_id}/{version}", max(1, min(k, 20)))}

    return knowledge
