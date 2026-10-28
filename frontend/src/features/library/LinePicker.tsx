import { useEffect, useRef, useState } from "react";
import { FolderInput, Trash2, Wand2 } from "lucide-react";
import { api, base } from "../../api";
import type { Paper, ResearchLine, TagView } from "../../types";
import { PAPER_TYPES, typeOf } from "./paperTypes";

/**
 * The 归类 button on a library card: tick the research lines and technical tags this paper
 * belongs to, let keyword matching file it, or delete the paper (to the recoverable trash).
 */
export default function LinePicker({
  paper,
  lines,
  tags,
  onLines,
  onPaper,
  onTags,
  onDelete,
  onError,
}: {
  paper: Paper;
  lines: ResearchLine[];
  tags: TagView[];
  onLines: (lines: ResearchLine[]) => void;
  onPaper: (paper: Paper) => void;
  onTags: (tags: TagView[]) => void;
  onDelete: (paper: Paper) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [newTag, setNewTag] = useState("");
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
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggleLine = (line: ResearchLine) =>
    run(async () => {
      setNote("");
      const r = await api<{ lines: ResearchLine[] }>(`/api/lines/${line.id}/papers/${paper.paper_id}/${paper.version}`, {
        method: member.has(line.id) ? "DELETE" : "PUT",
        ...(member.has(line.id) ? {} : { body: "{}" }),
      });
      onLines(r.lines);
    });
  const setTopics = (topics: string[]) =>
    run(async () => {
      onPaper(await api<Paper>(base(paper.paper_id, paper.version), { method: "PATCH", body: JSON.stringify({ topics }) }));
    });
  const setType = (paper_type: string) =>
    run(async () => {
      onPaper(await api<Paper>(base(paper.paper_id, paper.version), { method: "PATCH", body: JSON.stringify({ paper_type }) }));
    });
  const addTag = () => {
    const name = newTag.trim();
    if (!name) return;
    setNewTag("");
    void run(async () => {
      onTags((await api<{ tags: TagView[] }>("/api/tags", { method: "POST", body: JSON.stringify({ name }) })).tags);
      if (!paper.topics.includes(name)) {
        onPaper(await api<Paper>(base(paper.paper_id, paper.version), { method: "PATCH", body: JSON.stringify({ topics: [...paper.topics, name] }) }));
      }
    });
  };
  const auto = () =>
    run(async () => {
      const r = await api<{ filed: string[] }>(`${base(paper.paper_id, paper.version)}/autofile`, { method: "POST" });
      onLines((await api<{ lines: ResearchLine[] }>("/api/lines")).lines);
      onPaper(await api<Paper>(base(paper.paper_id, paper.version)));
      setNote(r.filed.length ? `已归入：${r.filed.map((id) => lines.find((l) => l.id === id)?.name ?? id).join("、")}` : "没有足够接近的研究线");
    });
  return (
    <div className="line-picker" ref={box}>
      <button
        className={`card-brief-trigger ${open ? "active" : ""}`}
        aria-expanded={open}
        title="研究线、技术标签与删除"
        onClick={() => setOpen((o) => !o)}
      >
        <FolderInput size={14} />
        归类{member.size > 0 && <b>{member.size}</b>}
      </button>
      {open && (
        <div className="line-picker-pop" role="dialog" aria-label="归类">
          <div className="brief-label">研究线（可多选）</div>
          {lines.length === 0 && <p className="brief-empty">还没有研究线，先在左侧「研究线」旁点 + 新建。</p>}
          {lines.map((l) => (
            <label key={l.id} className={member.has(l.id) ? "on" : ""}>
              <input type="checkbox" disabled={busy} checked={member.has(l.id)} onChange={() => void toggleLine(l)} />
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
          <div className="brief-label picker-section">论文类型</div>
          <div className="picker-tags picker-types">
            {PAPER_TYPES.map(([k, zh]) => (
              <label key={k} className={typeOf(paper) === k ? "on" : ""}>
                <input type="radio" name={`type-${key}`} disabled={busy} checked={typeOf(paper) === k} onChange={() => void setType(k)} />
                {zh}
              </label>
            ))}
          </div>
          <div className="brief-label picker-section">技术标签</div>
          <div className="picker-tags">
            {tags.map((t) => (
              <label key={t.name} className={paper.topics.includes(t.name) ? "on" : ""}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={paper.topics.includes(t.name)}
                  onChange={(e) =>
                    void setTopics(e.target.checked ? [...paper.topics, t.name] : paper.topics.filter((x) => x !== t.name))
                  }
                />
                {t.name}
              </label>
            ))}
          </div>
          <input
            className="picker-new-tag"
            aria-label="新标签"
            value={newTag}
            maxLength={40}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) addTag();
            }}
            placeholder="新标签，回车添加并打上"
          />
          <button className="picker-delete" disabled={busy} onClick={() => onDelete(paper)}>
            <Trash2 size={14} /> 从文献库删除
          </button>
        </div>
      )}
    </div>
  );
}
