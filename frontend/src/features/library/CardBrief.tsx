import { useState } from "react";
import { Compass } from "lucide-react";
import { api, base } from "../../api";
import type { Paper, ResearchLine } from "../../types";

type Brief = { summary: string; problem: string; focus: string[]; depth: string | null; context: string };
const DEPTH: Record<string, string> = { deep: "建议精读", selective: "建议选读", skim: "建议略读" };
const cache = new Map<string, Promise<Brief>>();

/** Library card hover: why this paper is in the library, what it says in one line, and where to focus. */
export default function CardBrief({ paper, lines }: { paper: Paper; lines: ResearchLine[] }) {
  const key = `${paper.paper_id}/${paper.version}`;
  const [brief, setBrief] = useState<Brief | null>(null),
    [hover, setHover] = useState(false),
    [pinned, setPinned] = useState(false),
    [failed, setFailed] = useState(false);
  const load = () => {
    if (!cache.has(key)) {
      const request = api<Brief>(`${base(paper.paper_id, paper.version)}/brief`);
      request.catch(() => cache.delete(key));
      cache.set(key, request);
    }
    cache.get(key)!.then(setBrief, () => setFailed(true));
  };
  // The reasons come from research lines (lines.json); a paper may serve several.
  const reasons = lines.flatMap((l) => l.papers.filter((x) => x.key === key).map((x) => ({ line: l, ...x })));
  const open = hover || pinned;
  return (
    <div
      className="card-brief"
      onMouseEnter={() => {
        setHover(true);
        load();
      }}
      onMouseLeave={() => setHover(false)}
    >
      <button
        className={`card-brief-trigger ${open ? "active" : ""}`}
        aria-expanded={open}
        title="为什么读这篇（点击可固定）"
        onFocus={() => {
          setHover(true);
          load();
        }}
        onBlur={() => {
          setHover(false);
          setPinned(false);
        }}
        onClick={() => setPinned((p) => !p)}
      >
        <Compass size={14} />
        为什么读
      </button>
      {open && (
        <div className="card-brief-pop" role="tooltip">
          <div className="brief-label">为什么读这篇</div>
          {reasons.length ? (
            reasons.map((r) => (
              <div className="brief-why" key={r.line.id}>
                <span>
                  {r.line.name} · <b>{r.role}</b>
                </span>
                <p>{r.why}</p>
              </div>
            ))
          ) : brief?.context ? (
            <p>{brief.context}</p>
          ) : (
            <p className="brief-empty">还没记下阅读动机：把它加进 lines.json 的某条研究线，这里就会显示。</p>
          )}
          {failed ? (
            <p className="brief-empty">报告摘要读取失败</p>
          ) : !brief ? (
            <p className="brief-empty">正在读取报告…</p>
          ) : brief.summary ? (
            <>
              <div className="brief-label">一句话</div>
              <p>{brief.summary}</p>
            </>
          ) : (
            <p className="brief-empty">还没有报告</p>
          )}
          {!!brief?.focus.length && (
            <>
              <div className="brief-label">
                {brief.depth && DEPTH[brief.depth] ? `${DEPTH[brief.depth]} · 重点读` : "重点读"}
              </div>
              <ul>
                {brief.focus.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
