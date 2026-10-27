import { useEffect, useRef, useState } from "react";
import { FolderInput, Wand2 } from "lucide-react";
import { api, base } from "../../api";
import type { Paper, ResearchLine } from "../../types";

/**
 * The 归类 button on a library card: tick the research lines this paper belongs to,
 * or let keyword matching file it.
 */
export default function LinePicker({
  paper,
  lines,
  onLines,
  onError,
}: {
  paper: Paper;
  lines: ResearchLine[];
  onLines: (lines: ResearchLine[]) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const key = `${paper.paper_id}/${paper.version}`;
  const member = new Set(lines.filter((l) => l.papers.some((x) => x.key === key)).map((l) => l.id));
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const toggle = async (line: ResearchLine) => {
    setBusy(true);
    setNote("");
    try {
      const r = await api<{ lines: ResearchLine[] }>(`/api/lines/${line.id}/papers/${paper.paper_id}/${paper.version}`, {
        method: member.has(line.id) ? "DELETE" : "PUT",
        ...(member.has(line.id) ? {} : { body: "{}" }),
      });
      onLines(r.lines);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const auto = async () => {
    setBusy(true);
    try {
      const r = await api<{ filed: string[] }>(`${base(paper.paper_id, paper.version)}/autofile`, { method: "POST" });
      const fresh = await api<{ lines: ResearchLine[] }>("/api/lines");
      onLines(fresh.lines);
      setNote(r.filed.length ? `已归入：${r.filed.map((id) => lines.find((l) => l.id === id)?.name ?? id).join("、")}` : "没有足够接近的研究线");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="line-picker" ref={box}>
      <button
        className={`card-brief-trigger ${open ? "active" : ""}`}
        aria-expanded={open}
        title="选择这篇论文属于哪些研究线"
        onClick={() => setOpen((o) => !o)}
      >
        <FolderInput size={14} />
        归类{member.size > 0 && <b>{member.size}</b>}
      </button>
      {open && (
        <div className="line-picker-pop" role="dialog" aria-label="归入研究线">
          <div className="brief-label">归入研究线（可多选）</div>
          {lines.length === 0 && <p className="brief-empty">还没有研究线，先在左侧「研究线」旁点 + 新建。</p>}
          {lines.map((l) => (
            <label key={l.id} className={member.has(l.id) ? "on" : ""}>
              <input type="checkbox" disabled={busy} checked={member.has(l.id)} onChange={() => void toggle(l)} />
              <span>{l.name}</span>
              {l.papers.find((x) => x.key === key)?.auto && <em>自动</em>}
            </label>
          ))}
          {lines.length > 0 && (
            <button className="line-picker-auto" disabled={busy} onClick={() => void auto()}>
              <Wand2 size={14} /> 按关键词自动归类
            </button>
          )}
          {note && <p className="brief-empty">{note}</p>}
        </div>
      )}
    </div>
  );
}
