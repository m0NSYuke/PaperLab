import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, FilePlus2, Highlighter, Trash2, X } from "lucide-react";
import type { Paper } from "../../types";
import {
  addToNotes,
  COLORS,
  removeHighlight,
  updateHighlight,
  type Highlight,
  type HlColor,
} from "./highlights";
import "./highlight.css";

export function Swatches({
  value,
  onPick,
  disabled,
}: {
  value?: HlColor;
  onPick: (c: HlColor) => void;
  disabled?: boolean;
}) {
  return (
    <div className="hl-swatches" role="radiogroup" aria-label="高亮颜色">
      {COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          aria-label={`${c.label}高亮`}
          title={`${c.label}高亮`}
          className={`hl-swatch hl-${c.id}`}
          disabled={disabled}
          onClick={() => onPick(c.id)}
        >
          {value === c.id && <Check size={12} />}
        </button>
      ))}
    </div>
  );
}

/** Excerpt text for the notes: the page, then the note when there is one. */
export const excerptBody = (h: Highlight) => `（p.${h.page}）${h.note.trim() ? ` 批注：${h.note.trim()}` : ""}`;

/**
 * Popover for an existing highlight, opened by tapping or clicking it: change
 * its color, write a note, copy it into the notes or delete it.
 */
export default function HighlightEditor({
  paper,
  item,
  at,
  onClose,
}: {
  paper: Paper;
  item: Highlight;
  at: { x: number; y: number };
  onClose: () => void;
}) {
  const [note, setNote] = useState(item.note),
    [state, setState] = useState<"" | "saving" | "saved" | "noted" | string>(""),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setNote(item.note);
    setState("");
  }, [item.highlight_id]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || getComputedStyle(el).position !== "fixed" || el.classList.contains("sheet")) return;
    const w = el.offsetWidth,
      h = el.offsetHeight,
      gap = 14;
    const left = Math.min(Math.max(8, at.x - w / 2), window.innerWidth - w - 8);
    const top = at.y + gap + h < window.innerHeight - 8 ? at.y + gap : Math.max(8, at.y - gap - h);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) void commit().then(onClose);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && void commit().then(onClose);
    // Deferred so the tap that opened the editor does not close it again.
    const t = setTimeout(() => document.addEventListener("pointerdown", away, true));
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key);
    };
  });
  const fail = (e: unknown) => setState((e as Error).message || "保存失败");
  async function commit() {
    if (note === item.note) return;
    setState("saving");
    await updateHighlight(paper, item.highlight_id, { note })
      .then(() => setState("saved"))
      .catch(fail);
  }
  const narrow = window.matchMedia("(max-width: 640px)").matches;
  return createPortal(
    <div
      ref={ref}
      className={`hl-editor${narrow ? " sheet" : ""}`}
      role="dialog"
      aria-label="编辑高亮"
    >
      <header>
        <Highlighter size={14} />
        <span className="hl-quote" title={item.text}>
          {item.text}
        </span>
        <button className="icon-button" aria-label="关闭高亮编辑" onClick={() => void commit().then(onClose)}>
          <X size={14} />
        </button>
      </header>
      <Swatches
        value={item.color}
        onPick={(color) => void updateHighlight(paper, item.highlight_id, { color }).catch(fail)}
      />
      <textarea
        aria-label="高亮批注"
        placeholder="写下批注（可选）…"
        value={note}
        rows={3}
        onChange={(e) => {
          setNote(e.target.value);
          setState("");
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void commit();
        }}
      />
      <footer>
        <small className={state && !["saving", "saved", "noted"].includes(state) ? "mt-error" : ""}>
          {state === "saving"
            ? "保存中…"
            : state === "saved"
              ? "批注已保存"
              : state === "noted"
                ? "已记入笔记「划词摘录」"
                : state || `第 ${item.page} 页`}
        </small>
        <button
          className="text-button"
          title="把原文和批注追加到本论文笔记的“划词摘录”"
          disabled={state === "noted"}
          onClick={async () => {
            try {
              await commit();
              await addToNotes(paper, item.text, excerptBody({ ...item, note }));
              setState("noted");
            } catch (e) {
              fail(e);
            }
          }}
        >
          <FilePlus2 size={13} />
          记笔记
        </button>
        <button
          className="text-button danger"
          onClick={() =>
            void removeHighlight(paper, item.highlight_id)
              .then(onClose)
              .catch(fail)
          }
        >
          <Trash2 size={13} />
          删除
        </button>
      </footer>
    </div>,
    document.body,
  );
}
