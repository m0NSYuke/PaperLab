import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { GraphEdge, GraphNode, Paper } from "../../types";
import { displayTitle } from "../../pages/Library";

type Placed = GraphNode & { x: number; y: number };
const EDGE: Record<GraphEdge["type"], { label: string; length: number }> = {
  in_line: { label: "所属研究线", length: 120 },
  uses: { label: "用到的概念", length: 150 },
  relation: { label: "报告中的关联研究", length: 170 },
  compares: { label: "报告中的横向对比", length: 170 },
  similar: { label: "内容相近", length: 190 },
};
const RELATION: Record<string, string> = { extends: "扩展", compares_with: "对比", shares_method: "同类方法", citation: "引用" };

/** Short label for a paper node: the part before the colon, at most a few words. */
const shortTitle = (title: string) => {
  const head = displayTitle(title).split(/[:：]/)[0].trim();
  return head.length > 26 ? head.slice(0, 24) + "…" : head;
};

/** A plain force-directed layout, run once: repulsion between all nodes, springs along edges, pull to centre. */
function layout(nodes: GraphNode[], edges: GraphEdge[]): Placed[] {
  const n = nodes.length;
  // Start each kind on its own ring, evenly spaced, so research lines begin far apart.
  const count = (type: string) => nodes.filter((x) => x.type === type).length;
  const seen: Record<string, number> = {};
  const pos = nodes.map((node) => {
    const k = (seen[node.type] = (seen[node.type] ?? -1) + 1);
    const ring = node.type === "line" ? 230 : node.type === "paper" ? 160 : 380;
    const angle = (k / Math.max(count(node.type), 1)) * Math.PI * 2 + (node.type === "paper" ? 0.4 : 0);
    return { x: Math.cos(angle) * ring, y: Math.sin(angle) * ring, vx: 0, vy: 0 };
  });
  // Research-line pills are wide; they push harder so their labels never overlap.
  const weight = nodes.map((node) => (node.type === "line" ? 4 : 1));
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const springs = edges
    .map((e) => [index.get(e.source), index.get(e.target), EDGE[e.type].length] as const)
    .filter(([a, b]) => a !== undefined && b !== undefined) as [number, number, number][];
  for (let step = 0; step < 450; step++) {
    const heat = 1 - step / 450;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        const d2 = Math.max(dx * dx + dy * dy, 30);
        const f = (7000 * weight[i] * weight[j]) / d2;
        pos[i].vx += dx * f / Math.sqrt(d2); pos[i].vy += dy * f / Math.sqrt(d2);
        pos[j].vx -= dx * f / Math.sqrt(d2); pos[j].vy -= dy * f / Math.sqrt(d2);
      }
    for (const [a, b, length] of springs) {
      const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - length) * 0.03;
      pos[a].vx += (dx / d) * f; pos[a].vy += (dy / d) * f;
      pos[b].vx -= (dx / d) * f; pos[b].vy -= (dy / d) * f;
    }
    for (const p of pos) {
      p.vx -= p.x * 0.012; p.vy -= p.y * 0.012;
      p.x += p.vx * heat; p.y += p.vy * heat;
      p.vx *= 0.55; p.vy *= 0.55;
    }
  }
  // Widen to the stage's landscape shape.
  return nodes.map((node, i) => ({ ...node, x: pos[i].x * 1.45, y: pos[i].y }));
}

/**
 * The library as a graph: papers, the concept cards they use and the research lines they serve,
 * with the relations their reports name and content similarity. Built without any model call.
 */
export default function KnowledgeGraph({ papers, onOpen }: { papers: Paper[]; onOpen: (p: Paper) => void }) {
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null),
    [error, setError] = useState(""),
    [hover, setHover] = useState<string | null>(null),
    [hidden, setHidden] = useState<Set<GraphEdge["type"]>>(new Set(["similar", "uses"]));
  useEffect(() => {
    api<{ nodes: GraphNode[]; edges: GraphEdge[] }>("/api/knowledge/graph").then(setData, (e) => setError((e as Error).message));
  }, []);
  // Lay out only what is shown, so hidden concept hubs do not pull every paper to the centre.
  const edges = useMemo(() => (data ? data.edges.filter((e) => !hidden.has(e.type)) : []), [data, hidden]);
  const visible = useMemo(() => {
    if (!data) return [];
    const shown = data.nodes.filter((node) => node.type !== "concept" || !hidden.has("uses"));
    return layout(shown, edges);
  }, [data, edges, hidden]);
  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="empty-state">正在构建知识图谱…</div>;
  const byId = new Map(visible.map((node) => [node.id, node]));
  const neighbours = new Set<string>();
  if (hover) {
    neighbours.add(hover);
    for (const e of edges) {
      if (e.source === hover) neighbours.add(e.target);
      if (e.target === hover) neighbours.add(e.source);
    }
  }
  const xs = visible.map((node) => node.x), ys = visible.map((node) => node.y);
  const pad = 70;
  const box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2];
  const focus = hover ? byId.get(hover) : null;
  const links = focus ? edges.filter((e) => e.source === focus.id || e.target === focus.id) : [];
  const toggle = (t: GraphEdge["type"]) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  const openNode = (node: Placed) => {
    const p = papers.find((x) => `${x.paper_id}/${x.version}` === node.key);
    if (p) onOpen(p);
  };
  return (
    <section className="knowledge-graph">
      <div className="graph-toolbar">
        {(Object.keys(EDGE) as GraphEdge["type"][]).map((t) => (
          <button key={t} className={`graph-chip edge-${t} ${hidden.has(t) ? "off" : ""}`} onClick={() => toggle(t)} aria-pressed={!hidden.has(t)}>
            <i />
            {EDGE[t].label}
          </button>
        ))}
        <span className="graph-hint">悬停看连接，点击论文进入阅读</span>
      </div>
      <div className="graph-stage">
        <svg viewBox={box.join(" ")} role="img" aria-label="论文、概念与研究线的关系图">
          {edges.map((e, i) => {
            const a = byId.get(e.source), b = byId.get(e.target);
            if (!a || !b) return null;
            const lit = !hover || (neighbours.has(e.source) && neighbours.has(e.target) && (e.source === hover || e.target === hover));
            return <line key={i} className={`graph-edge edge-${e.type} ${lit ? "" : "dim"}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
          {visible.map((node) => {
            const dim = hover && !neighbours.has(node.id);
            return (
              <g
                key={node.id}
                className={`graph-node node-${node.type} ${node.kind === "idea" ? "idea" : ""} ${node.analysis_status === "ready" ? "ready" : ""} ${dim ? "dim" : ""}`}
                transform={`translate(${node.x},${node.y})`}
                onMouseEnter={() => setHover(node.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => node.type === "paper" && openNode(node)}
              >
                {node.type === "line" ? (
                  <>
                    <rect x={-node.label.length * 7 - 10} y={-14} width={node.label.length * 14 + 20} height={28} rx={14} />
                    <text textAnchor="middle" dy="5">{node.label}</text>
                  </>
                ) : node.type === "paper" ? (
                  <>
                    <circle r={8} />
                    <text textAnchor="middle" dy="22">{shortTitle(node.label)}</text>
                  </>
                ) : (
                  <>
                    <rect x={-4} y={-4} width={8} height={8} transform="rotate(45)" />
                    <text textAnchor="middle" dy="17">{node.label}</text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
        {focus && (
          <aside className="graph-detail">
            <strong>{focus.type === "paper" ? displayTitle(focus.label) : focus.label}</strong>
            <span>{focus.type === "paper" ? "论文" : focus.type === "line" ? (focus.kind === "idea" ? "Idea 研究线" : "方向研究线") : "概念卡片"} · {links.length} 条连接</span>
            <ul>
              {links.slice(0, 12).map((e, i) => {
                const other = byId.get(e.source === focus.id ? e.target : e.source);
                if (!other) return null;
                const note = e.type === "relation" ? RELATION[e.label] || e.label : e.type === "in_line" ? e.label : e.type === "similar" ? `相似度 ${e.label}` : "";
                return (
                  <li key={i}>
                    <em>{EDGE[e.type].label}</em>
                    {other.type === "paper" ? shortTitle(other.label) : other.label}
                    {note && <small> · {note}</small>}
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>
    </section>
  );
}
