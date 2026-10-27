import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Table2, Trash2 } from "lucide-react";
import { api } from "../../api";
import type { LineIdeaStatus, LineIdea, Paper, ResearchLine } from "../../types";
import { displayTitle } from "../../pages/Library";

export const IDEA_STATUS: Record<LineIdeaStatus, string> = {
  spark: "闪念",
  exploring: "探索中",
  parked: "暂缓",
  dropped: "放弃",
  chosen: "选定",
};
const DIMENSIONS = [
  ["novelty", "新意", "别人没做过、想法本身新不新"],
  ["feasibility", "可行", "现有算力、数据和时间能不能做出来"],
  ["impact", "影响", "做成了对领域或你的论文有多大用"],
  ["cost", "投入", "需要多少时间和资源，越高越贵"],
] as const;
type Dim = (typeof DIMENSIONS)[number][0];

/** 新意 + 可行 + 影响 − 投入, once all four are scored; a rough way to line ideas up, not a verdict. */
export const ideaScore = (i: LineIdea) => {
  const s = i.scores;
  return s.novelty && s.feasibility && s.impact && s.cost ? s.novelty + s.feasibility + s.impact - s.cost : null;
};

type Draft = Omit<LineIdea, "id" | "created_at" | "updated_at" | "etag">;
const draftOf = (i: LineIdea): Draft => ({
  line: i.line, title: i.title, body: i.body, status: i.status, scores: { ...i.scores },
  pros: i.pros, cons: i.cons, next_step: i.next_step, papers: [...i.papers],
});

function IdeaEditor({
  idea, lines, papers, onSaved, onDelete, onClose,
}: {
  idea: LineIdea;
  lines: ResearchLine[];
  papers: Paper[];
  onSaved: (i: LineIdea) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(idea)),
    [state, setState] = useState<"saved" | "dirty" | "saving" | "error">("saved"),
    [error, setError] = useState("");
  const etag = useRef(idea.etag), first = useRef(true);
  const line = lines.find((l) => l.id === draft.line);
  const linePapers = (line?.papers || []).map((x) => ({ ...x, paper: papers.find((p) => `${p.paper_id}/${p.version}` === x.key) }));
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState("dirty");
    if (!draft.title.trim()) return;
    const timer = setTimeout(() => {
      setState("saving");
      api<LineIdea>(`/api/ideas/${idea.id}`, { method: "PUT", body: JSON.stringify({ ...draft, etag: etag.current }) })
        .then((saved) => {
          etag.current = saved.etag;
          setState("saved");
          setError("");
          onSaved(saved);
        })
        .catch((e) => {
          setState("error");
          setError((e as Error).message);
        });
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const score = (dim: Dim, value: number) =>
    setDraft((d) => ({ ...d, scores: { ...d.scores, [dim]: d.scores[dim] === value ? null : value } }));
  return (
    <div className="idea-editor" id={`idea-${idea.id}`}>
      <div className="idea-editor-top">
        <input
          className="idea-title-input"
          aria-label="Idea 标题"
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="一句话说清这个 idea"
        />
        <span className={`idea-save ${state}`}>
          {state === "saved" ? "已保存" : state === "saving" ? "保存中…" : state === "dirty" ? (draft.title.trim() ? "待保存" : "标题不能为空") : "保存失败"}
        </span>
        <button className="icon-button" aria-label="收起" title="收起" onClick={onClose}>
          <ChevronDown size={16} />
        </button>
      </div>
      {error && <p className="error-banner">{error}</p>}
      <div className="idea-status-row" role="radiogroup" aria-label="状态">
        {(Object.keys(IDEA_STATUS) as LineIdeaStatus[]).map((s) => (
          <button key={s} role="radio" aria-checked={draft.status === s} className={`li-status ${s} ${draft.status === s ? "on" : ""}`} onClick={() => set("status", s)}>
            {IDEA_STATUS[s]}
          </button>
        ))}
      </div>
      <textarea
        className="idea-body"
        aria-label="展开写写"
        rows={4}
        value={draft.body}
        onChange={(e) => set("body", e.target.value)}
        placeholder="展开写写：要解决什么问题、大概怎么做、和哪篇论文有关……想到哪写到哪"
      />
      <div className="idea-scores">
        {DIMENSIONS.map(([dim, label, hint]) => (
          <div className="idea-score" key={dim} title={hint}>
            <span>{label}</span>
            <div role="radiogroup" aria-label={label}>
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  role="radio"
                  aria-checked={draft.scores[dim] === v}
                  aria-label={`${label} ${v} 分`}
                  className={(draft.scores[dim] || 0) >= v ? "on" : ""}
                  onClick={() => score(dim, v)}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="idea-score total">
          <span>综合</span>
          <b>{ideaScore({ ...idea, ...draft, etag: "" }) ?? "—"}</b>
        </div>
      </div>
      <div className="idea-tradeoff">
        <label>
          <span>优势</span>
          <textarea rows={3} value={draft.pros} onChange={(e) => set("pros", e.target.value)} placeholder="为什么值得做" />
        </label>
        <label>
          <span>风险与代价</span>
          <textarea rows={3} value={draft.cons} onChange={(e) => set("cons", e.target.value)} placeholder="可能失败在哪、要付出什么" />
        </label>
      </div>
      <label className="idea-next">
        <span>下一步</span>
        <input value={draft.next_step} onChange={(e) => set("next_step", e.target.value)} placeholder="最小的验证实验是什么" />
      </label>
      {linePapers.length > 0 && (
        <div className="idea-papers">
          <span>相关论文</span>
          {linePapers.map(({ key, paper }) => (
            <label key={key} className={draft.papers.includes(key) ? "on" : ""}>
              <input
                type="checkbox"
                checked={draft.papers.includes(key)}
                onChange={(e) => set("papers", e.target.checked ? [...draft.papers, key] : draft.papers.filter((k) => k !== key))}
              />
              {paper ? displayTitle(paper.title).split(/[:：]/)[0] : key}
            </label>
          ))}
        </div>
      )}
      <div className="idea-editor-foot">
        <label>
          移到研究线
          <select value={draft.line} onChange={(e) => set("line", e.target.value)}>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        <button className="text-button danger" onClick={onDelete}>
          <Trash2 size={14} /> 删除
        </button>
      </div>
    </div>
  );
}

/**
 * The Idea 区 of one research line: catch a spark in one line, then explore, score the tradeoffs
 * and compare it against the other ideas in the same line.
 */
export default function IdeaBoard({
  line, lines, papers, ideas, setIdeas, focusId,
}: {
  line: ResearchLine;
  lines: ResearchLine[];
  papers: Paper[];
  ideas: LineIdea[];
  setIdeas: React.Dispatch<React.SetStateAction<LineIdea[]>>;
  focusId?: string | null;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState<string | null>(focusId ?? null),
    [sort, setSort] = useState<"recent" | "score">("recent"),
    [compare, setCompare] = useState(false),
    [undo, setUndo] = useState<LineIdea | null>(null),
    [showDropped, setShowDropped] = useState(false);
  useEffect(() => {
    if (focusId) {
      setOpen(focusId);
      setTimeout(() => document.getElementById(`idea-${focusId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
    }
  }, [focusId]);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(timer);
  }, [undo]);
  const mine = ideas.filter((i) => i.line === line.id);
  const ordered = [...mine].sort((a, b) =>
    sort === "score" ? (ideaScore(b) ?? -99) - (ideaScore(a) ?? -99) : b.updated_at.localeCompare(a.updated_at),
  );
  const active = ordered.filter((i) => i.status !== "dropped");
  const dropped = ordered.filter((i) => i.status === "dropped");
  const add = async () => {
    const title = text.trim();
    if (!title) return;
    setBusy(true);
    try {
      const idea = await api<LineIdea>("/api/ideas", { method: "POST", body: JSON.stringify({ line: line.id, title }) });
      setIdeas((list) => [idea, ...list]);
      setText("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (idea: LineIdea) => {
    await api(`/api/ideas/${idea.id}`, { method: "DELETE" });
    setIdeas((list) => list.filter((i) => i.id !== idea.id));
    setOpen(null);
    setUndo(idea);
  };
  const restore = async () => {
    if (!undo) return;
    const idea = await api<LineIdea>(`/api/ideas/${undo.id}/restore`, { method: "POST" });
    setIdeas((list) => [idea, ...list]);
    setUndo(null);
  };
  const card = (idea: LineIdea) =>
    open === idea.id ? (
      <IdeaEditor
        key={idea.id}
        idea={idea}
        lines={lines}
        papers={papers}
        onSaved={(saved) => setIdeas((list) => list.map((i) => (i.id === saved.id ? saved : i)))}
        onDelete={() => void remove(idea)}
        onClose={() => setOpen(null)}
      />
    ) : (
      <button key={idea.id} id={`idea-${idea.id}`} className={`idea-card ${idea.status}`} onClick={() => setOpen(idea.id)}>
        <span className={`li-status ${idea.status} on`}>{IDEA_STATUS[idea.status]}</span>
        <strong>{idea.title}</strong>
        {idea.body && <p>{idea.body.slice(0, 90)}{idea.body.length > 90 ? "…" : ""}</p>}
        <span className="idea-card-meta">
          {DIMENSIONS.map(([dim, label]) => (idea.scores[dim] ? `${label} ${idea.scores[dim]}` : null)).filter(Boolean).join(" · ") || "还没评估"}
          {ideaScore(idea) !== null && <b> · 综合 {ideaScore(idea)}</b>}
          {idea.papers.length > 0 && ` · ${idea.papers.length} 篇相关`}
        </span>
      </button>
    );
  return (
    <section className="idea-board" aria-label="Idea 区">
      <div className="idea-board-head">
        <h3>
          Idea 区 <span>{mine.length}</span>
        </h3>
        <p>先记下来，不必成熟；之后再按新意、可行、影响和投入慢慢评估。</p>
        {mine.length > 1 && (
          <div className="idea-board-tools">
            <button className={sort === "recent" ? "on" : ""} onClick={() => setSort("recent")}>最近</button>
            <button className={sort === "score" ? "on" : ""} onClick={() => setSort("score")}>综合分</button>
            <button className={compare ? "on" : ""} onClick={() => setCompare((c) => !c)}>
              <Table2 size={14} /> 对比
            </button>
          </div>
        )}
      </div>
      <div className="idea-quick">
        <Plus size={16} />
        <input
          aria-label="记下一个闪念"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void add();
          }}
          placeholder="记下一个闪念，回车保存"
        />
        {text.trim() && <button className="primary" disabled={busy} onClick={() => void add()}>记下</button>}
      </div>
      {error && <p className="error-banner">{error}</p>}
      {undo && (
        <div className="idea-undo">
          已删除「{undo.title}」<button onClick={() => void restore()}>撤销</button>
        </div>
      )}
      {compare && mine.length > 1 && (
        <div className="idea-compare">
          <table>
            <thead>
              <tr>
                <th>Idea</th><th>状态</th>
                {DIMENSIONS.map(([dim, label]) => <th key={dim}>{label}</th>)}
                <th>综合</th><th>下一步</th>
              </tr>
            </thead>
            <tbody>
              {[...mine].sort((a, b) => (ideaScore(b) ?? -99) - (ideaScore(a) ?? -99)).map((i) => (
                <tr key={i.id} className={i.status} onClick={() => { setCompare(false); setOpen(i.id); }}>
                  <td>{i.title}</td>
                  <td>{IDEA_STATUS[i.status]}</td>
                  {DIMENSIONS.map(([dim]) => <td key={dim}>{i.scores[dim] ?? "—"}</td>)}
                  <td><b>{ideaScore(i) ?? "—"}</b></td>
                  <td>{i.next_step || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <small>综合 = 新意 + 可行 + 影响 − 投入，四项都打分后才计算；只是排个序，最后还要看你的判断。</small>
        </div>
      )}
      {active.length > 0 && <div className="idea-list">{active.map(card)}</div>}
      {dropped.length > 0 && (
        <div className="idea-dropped">
          <button className="text-button" onClick={() => setShowDropped((s) => !s)}>
            已放弃 {dropped.length} 个 {showDropped ? "▾" : "▸"}
          </button>
          {showDropped && <div className="idea-list">{dropped.map(card)}</div>}
        </div>
      )}
    </section>
  );
}
