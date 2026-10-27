import { Suspense, lazy, useEffect, useState } from "react";
import { BookOpen, FileText, NotebookPen } from "lucide-react";
import { api } from "../../api";
import type { KnowledgeHit, Paper } from "../../types";
import Modal from "../../components/Modal";
import { displayTitle } from "../../pages/Library";

const Markdown = lazy(() => import("../../components/Markdown"));

type Group = { id: string; title: string; kind: "paper" | "memo" | "concept"; hits: KnowledgeHit[] };

/** Highlight each query term inside a snippet, case-insensitively. */
function Marked({ text, query }: { text: string; query: string }) {
  const terms = query.split(/\s+/).filter((t) => t.length > 0).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${terms.join("|")})`, "gi"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

/**
 * Library search beyond titles: matching passages in reports, conclusions (with their PDF page),
 * notes, 随记 and concept cards, grouped by where they come from.
 */
export default function KnowledgeHits({
  query,
  papers,
  onOpen,
}: {
  query: string;
  papers: Paper[];
  onOpen: (p: Paper, focus?: "study", page?: number) => void;
}) {
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null),
    [concept, setConcept] = useState<{ title: string; text: string } | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api<{ hits: KnowledgeHit[] }>(`/api/knowledge/search?q=${encodeURIComponent(q)}&limit=40`)
        .then((r) => live && setHits(r.hits))
        .catch(() => live && setHits([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  if (!hits?.length) return null;
  const groups: Group[] = [];
  for (const h of hits) {
    const id = h.paper ? `paper:${h.paper}` : h.memo ? `memo:${h.memo}` : `concept:${h.concept}`;
    let g = groups.find((x) => x.id === id);
    if (!g) {
      g = { id, title: h.title, kind: h.paper ? "paper" : h.memo ? "memo" : "concept", hits: [] };
      groups.push(g);
    }
    if (g.hits.length < 3) g.hits.push(h);
  }
  const open = (h: KnowledgeHit) => {
    if (h.paper) {
      const p = papers.find((x) => `${x.paper_id}/${x.version}` === h.paper);
      if (p) onOpen(p, undefined, h.page ?? undefined);
    } else if (h.memo) {
      location.hash = `/memos?id=${h.memo}`;
    } else if (h.concept) {
      api<{ content: string }>(`/api/concepts/${h.concept}`)
        .then((r) => setConcept({ title: h.title, text: r.content }))
        .catch(() => {});
    }
  };
  return (
    <section className="knowledge-hits" aria-label="知识库检索结果">
      <div className="knowledge-hits-head">
        <h3>知识库中的相关内容</h3>
        <span>报告、原文结论、笔记、随记与概念卡片 · {groups.length} 处来源</span>
      </div>
      <div className="knowledge-groups">
        {groups.slice(0, 12).map((g) => (
          <div className="knowledge-group" key={g.id}>
            <div className="knowledge-source">
              {g.kind === "paper" ? <FileText size={14} /> : g.kind === "memo" ? <NotebookPen size={14} /> : <BookOpen size={14} />}
              <strong>{g.kind === "paper" ? displayTitle(g.title) : g.title}</strong>
              {g.kind !== "paper" && <em>{g.kind === "memo" ? "随记" : "概念卡片"}</em>}
            </div>
            {g.hits.map((h, i) => (
              <button className="knowledge-hit" key={i} onClick={() => open(h)}>
                <span className="knowledge-meta">
                  <b>{h.kind_label}</b>
                  {h.kind !== "concept" && h.kind !== "memo" && h.label && !/^[a-z]+_\d+$|^[a-z0-9-]+$/.test(h.label) ? ` · ${h.label}` : ""}
                  {h.page ? ` · p.${h.page}` : ""}
                </span>
                <span className="knowledge-snippet">
                  <Marked text={h.snippet} query={query} />
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {concept && (
        <Modal title="概念卡片 · 通用背景" wide onClose={() => setConcept(null)}>
          <div className="concept-content">
            <Suspense fallback={<p>正在加载…</p>}>
              <Markdown>{concept.text}</Markdown>
            </Suspense>
          </div>
        </Modal>
      )}
    </section>
  );
}
