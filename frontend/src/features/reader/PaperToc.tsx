import { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import Markdown from "../../components/Markdown";
import type { OutlineItem } from "../../types";
import "../report/toc.css";

type Chapter = OutlineItem & { index: number; children: (OutlineItem & { index: number })[] };

/** Level-1 sections with the level-2 sections that follow them. */
export function chaptersOf(outline: OutlineItem[]): Chapter[] {
  const chapters: Chapter[] = [];
  outline.forEach((item, index) => {
    if (item.level === 2 && chapters.length) chapters[chapters.length - 1].children.push({ ...item, index });
    else chapters.push({ ...item, index, children: [] });
  });
  return chapters;
}

/** Index in `outline` of the section being read: the last one starting at or before the page. */
export const currentIndex = (outline: OutlineItem[], page: number) =>
  outline.reduce((at, x, i) => (x.page <= page ? i : at), -1);

function Note({ item }: { item: OutlineItem }) {
  return (
    <div className="paper-toc-note">
      {(item.role || item.key) && (
        <span className="paper-toc-role">
          {item.role}
          {item.key && <b>必读</b>}
        </span>
      )}
      {item.summary && <Markdown inline>{item.summary}</Markdown>}
    </div>
  );
}

/**
 * The paper's own table of contents beside the PDF: numbered sections, subsections folded under a
 * count, and each part's role and summary folded until asked for.
 */
export default function PaperToc({
  outline,
  page,
  onJump,
  onCollapse,
}: {
  outline: OutlineItem[];
  page: number;
  onJump: (page: number) => void;
  onCollapse: () => void;
}) {
  const chapters = chaptersOf(outline);
  const here = currentIndex(outline, page);
  const hereChapter = chapters.findIndex((c) => c.index === here || c.children.some((x) => x.index === here));
  const [open, setOpen] = useState<number | null>(null),
    [notes, setNotes] = useState<Set<number>>(new Set());
  // Follow the reader: the chapter being read unfolds unless the user chose otherwise.
  useEffect(() => setOpen(null), [hereChapter]);
  useEffect(() => {
    document.querySelector(".paper-toc [aria-current='location']")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [here, open]);
  const toggleNote = (i: number) =>
    setNotes((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const noteButton = (item: OutlineItem & { index: number }) =>
    (item.summary || item.role) && (
      <button
        className={`paper-toc-note-toggle ${notes.has(item.index) ? "open" : ""}`}
        aria-label={notes.has(item.index) ? `收起说明 ${item.title}` : `展开说明 ${item.title}`}
        aria-expanded={notes.has(item.index)}
        title="这一部分讲什么"
        onClick={() => toggleNote(item.index)}
      >
        <ChevronDown size={13} />
      </button>
    );
  return (
    <nav className="paper-toc toc-panel" aria-label="论文目录">
      <div className="toc-root paper-toc-head">
        论文目录
        <button className="paper-toc-collapse" aria-label="收起论文目录" title="收起目录" onClick={onCollapse}>
          <ChevronLeft size={15} />
        </button>
      </div>
      <ol>
        {chapters.map((chapter, c) => {
          const expanded = chapter.children.length > 0 && (open === null ? c === hereChapter : open === c);
          return (
            <li key={chapter.index} className={c === hereChapter ? "here" : ""}>
              <div className="toc-chapter">
                <button
                  className="toc-chapter-link"
                  aria-current={chapter.index === here ? "location" : undefined}
                  onClick={() => onJump(chapter.page)}
                  title={`${chapter.title} · p.${chapter.page}`}
                >
                  <span>{String(c + 1).padStart(2, "0")}</span>
                  {chapter.title}
                  {chapter.key && <i className="paper-toc-key" aria-label="必读" />}
                </button>
                {noteButton(chapter)}
                {chapter.children.length > 0 && (
                  <button
                    className={`toc-toggle ${expanded ? "open" : ""}`}
                    aria-label={expanded ? `收起 ${chapter.title}` : `展开 ${chapter.title}`}
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? -1 : c)}
                  >
                    <small>{chapter.children.length}</small>
                    <ChevronRight size={13} />
                  </button>
                )}
              </div>
              {notes.has(chapter.index) && <Note item={chapter} />}
              {expanded && (
                <ul>
                  {chapter.children.map((child) => (
                    <li key={child.index}>
                      <div className="paper-toc-row">
                        <button
                          className={child.index === here ? "on" : ""}
                          aria-current={child.index === here ? "location" : undefined}
                          onClick={() => onJump(child.page)}
                          title={`${child.title} · p.${child.page}`}
                        >
                          {child.title}
                          {child.key && <i className="paper-toc-key" aria-label="必读" />}
                        </button>
                        {noteButton(child)}
                      </div>
                      {notes.has(child.index) && <Note item={child} />}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The sidebar folded to a rail: one tick per section, the current one lit. */
export function PaperTocRail({
  outline,
  page,
  onJump,
  onOpen,
}: {
  outline: OutlineItem[];
  page: number;
  onJump: (page: number) => void;
  onOpen: () => void;
}) {
  const chapters = chaptersOf(outline);
  const here = currentIndex(outline, page);
  return (
    <nav className="paper-toc-rail" aria-label="论文目录（已收起）">
      <button className="rail-open" aria-label="展开论文目录" title="展开论文目录" onClick={onOpen}>
        <ChevronRight size={14} />
      </button>
      {chapters.map((c) => {
        const on = c.index === here || c.children.some((x) => x.index === here);
        return (
          <button key={c.index} className={on ? "on" : ""} title={`${c.title} · p.${c.page}`} aria-label={c.title} onClick={() => onJump(c.page)}>
            <i />
          </button>
        );
      })}
    </nav>
  );
}
