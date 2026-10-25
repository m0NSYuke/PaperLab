import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  FilePlus2,
  Highlighter,
  Languages,
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import { api, copyText, readLocal, writeLocal } from "../../api";
import type { Paper } from "../../types";
import { Swatches } from "../highlight/HighlightEditor";
import { addHighlight, addToNotes, captureSelection, updateHighlight, type Draft, type HlColor } from "../highlight/highlights";
import "./translate.css";

type Term = { en: string; zh: string; domain: string; source?: string };
type Entry = {
  word: string;
  query: string;
  phonetic: string;
  senses: string[];
  tags: string[];
  collins: number;
  oxford: boolean;
  inflection_of: string | null;
};
type Lookup = {
  text: string;
  kind: "word" | "phrase" | "sentence";
  glossary: Term | null;
  related_terms: Term[];
  entry: Entry | null;
};
type MT = {
  translation: string;
  cached: boolean;
  engine: string;
  terms: Term[];
  ms: number;
};
type Rect = { left: number; top: number; right: number; bottom: number };
type Card = {
  text: string;
  /** Selection rectangle in viewport coordinates; the floating card never covers it. */
  anchor: Rect;
  lookup?: Lookup;
  mt?: MT;
  mtState: "idle" | "loading" | "warming" | "done" | "error";
  error?: string;
  /** False when translation is off and the card only offers highlighting. */
  translate: boolean;
  /** Page geometry of a PDF selection, kept so it can still be highlighted after the selection is gone. */
  mark?: Draft;
};
const latinRatio = (s: string) => {
  const chars = s.replace(/\s/g, "");
  return chars.length ? (chars.match(/[A-Za-z]/g)?.length || 0) / chars.length : 0;
};
/** Inside these regions a selection is English paper text worth translating. */
const ZONES = ".textLayer, .markdown, .q-text";
const MAX_H = 460,
  EDGE = 8;
/** Touch selections carry drag handles below the text, so the card keeps further away. */
let GAP = 10;
const bestOf = ({ mt, lookup }: Card) =>
  mt?.translation || lookup?.glossary?.zh || lookup?.entry?.senses[0]?.replace(/^[a-z]+\.\s*/, "") || "";
/**
 * Where the floating card goes for a selection: below or above a short
 * selection, beside a multi-line one, and otherwise on whichever side has the
 * most room, scrolling inside the card instead of covering the text.
 */
function place(r: Rect, h: number, w: number) {
  const vw = window.innerWidth,
    vh = window.innerHeight;
  const below = vh - r.bottom - GAP - EDGE,
    above = r.top - GAP - EDGE,
    right = vw - r.right - GAP - EDGE,
    left = r.left - GAP - EDGE;
  const centerX = Math.min(Math.max(EDGE, (r.left + r.right) / 2 - w / 2), vw - w - EDGE);
  const sideY = Math.min(Math.max(EDGE, r.top), Math.max(EDGE, vh - h - EDGE));
  const vertical = () =>
    below >= h
      ? { left: centerX, top: r.bottom + GAP, maxHeight: below }
      : above >= h
        ? { left: centerX, top: r.top - GAP - h, maxHeight: above }
        : null;
  const side = () =>
    right >= w
      ? { left: r.right + GAP, top: sideY, maxHeight: vh - 2 * EDGE }
      : left >= w
        ? { left: r.left - GAP - w, top: sideY, maxHeight: vh - 2 * EDGE }
        : null;
  const fit = r.bottom - r.top > 40 ? side() || vertical() : vertical() || side();
  if (fit) return fit;
  return below >= above
    ? { left: centerX, top: r.bottom + GAP, maxHeight: Math.max(120, below) }
    : {
        left: centerX,
        top: Math.max(EDGE, r.top - GAP - Math.min(h, above)),
        maxHeight: Math.max(120, above),
      };
}

type Saved = { text: string; zh: string };
type Marked = { id: string; color: HlColor; note: string; saved: string };
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export default function SelectionTranslator({
  enabled,
  marking = false,
  paper,
  onAsk,
}: {
  enabled: boolean;
  /** Offer highlighting for selections in the PDF, even with translation off. */
  marking?: boolean;
  paper?: Paper;
  onAsk: (text: string) => void;
}) {
  const [card, setCard] = useState<Card | null>(null),
    [copied, setCopied] = useState(false),
    [saving, setSaving] = useState<null | { zh: string; done?: boolean; error?: string }>(null),
    [docked, setDocked] = useState<boolean>(() => readLocal("paperlab.translatorDocked", false)),
    [collapsed, setCollapsed] = useState(false),
    [dragged, setDragged] = useState<{ left: number; top: number } | null>(null),
    [history, setHistory] = useState<Saved[]>(() => readLocal("paperlab.translatorHistory", [])),
    [dockWidth, setDockWidth] = useState<number>(() => readLocal("paperlab.translatorDockWidth", 360)),
    [noted, setNoted] = useState<null | "saving" | "done" | string>(null),
    [marked, setMarked] = useState<Marked | null>(null),
    [markError, setMarkError] = useState("");
  const cardRef = useRef<HTMLDivElement>(null),
    /** The selected passage, kept after the selection itself is gone, so the card can follow it. */
    rangeRef = useRef<Range | null>(null),
    seq = useRef(0),
    dockedRef = useRef(docked),
    draggedRef = useRef(dragged);
  const textRef = useRef<string | null>(null),
    enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  textRef.current = card?.text ?? null;
  dockedRef.current = docked;
  draggedRef.current = dragged;
  useEffect(() => writeLocal("paperlab.translatorDocked", docked), [docked]);
  useEffect(() => writeLocal("paperlab.translatorHistory", history), [history]);
  useEffect(() => writeLocal("paperlab.translatorDockWidth", dockWidth), [dockWidth]);
  const close = useCallback(() => {
    seq.current++;
    rangeRef.current = null;
    setCard(null);
    setSaving(null);
    setCopied(false);
    setNoted(null);
    setDragged(null);
    setMarked(null);
    setMarkError("");
  }, []);
  const run = useCallback(async (text: string, id: number) => {
    const lookup = await api<Lookup>("/api/translate/lookup", {
      method: "POST",
      body: JSON.stringify({ text }),
    }).catch(() => null);
    if (id !== seq.current) return;
    const words = text.split(/\s+/).length;
    const knownWord = lookup && (lookup.glossary || lookup.entry);
    // A single known word or term is answered by the dictionary alone; anything
    // longer (or unknown) also goes to the local translation model.
    const needsMT = !(words === 1 && knownWord) && !(words <= 3 && lookup?.glossary);
    setCard((c) => c && { ...c, lookup: lookup || undefined, mtState: needsMT ? "loading" : "idle" });
    if (!needsMT) return;
    const warm = setTimeout(() => {
      if (id === seq.current)
        setCard((c) => c && c.mtState === "loading" ? { ...c, mtState: "warming" } : c);
    }, 1800);
    try {
      const mt = await api<MT>("/api/translate", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      if (id === seq.current) setCard((c) => c && { ...c, mt, mtState: "done" });
    } catch (e) {
      if (id === seq.current)
        setCard((c) => c && { ...c, mtState: "error", error: (e as Error).message });
    } finally {
      clearTimeout(warm);
    }
  }, []);
  const active = enabled || (marking && !!paper);
  useEffect(() => {
    // Load the local model while the reader opens, not on the first selection.
    if (enabled) void api("/api/translate/warm", { method: "POST" }).catch(() => null);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) close();
  }, [enabled, close]);
  useEffect(() => {
    if (!active) {
      close();
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    // Phones and tablets select by long-press and handle drags, which fire no
    // mouseup; there the card follows selectionchange once the handles settle.
    let touch = window.matchMedia("(pointer: coarse)").matches;
    const check = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const sel = window.getSelection();
        const raw = sel?.toString() || "";
        const text = raw.replace(/\s+/g, " ").trim();
        if (!sel || sel.rangeCount === 0 || !text || text === textRef.current) return;
        const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
        if (!node || node.closest("textarea, input, .translator-card, .hl-editor")) return;
        const translate =
          enabledRef.current && !!node.closest(ZONES) && text.length <= 2000 && latinRatio(text) >= 0.5;
        const mark = marking ? captureSelection(sel) || undefined : undefined;
        if (!translate && !mark) return;
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        const id = ++seq.current;
        rangeRef.current = sel.getRangeAt(0).cloneRange();
        GAP = touch ? 30 : 10;
        setCopied(false);
        setSaving(null);
        setNoted(null);
        setMarked(null);
        setMarkError("");
        setCollapsed(false);
        setCard({
          text,
          anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          mtState: "idle",
          translate,
          mark,
        });
        if (translate) void run(text, id);
      }, delay);
    };
    const onUp = (e: MouseEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      check(140);
    };
    const onPointer = (e: PointerEvent) => {
      touch = e.pointerType !== "mouse";
    };
    const onSelection = () => {
      if (touch) check(450);
    };
    // A docked or dragged card stays put until it is closed; a new selection
    // replaces its contents in place.
    const sticky = () => dockedRef.current || draggedRef.current !== null;
    const onDown = (e: MouseEvent) => {
      if (!cardRef.current?.contains(e.target as Node) && !sticky()) close();
    };
    // Scrolling keeps the translation while its passage is on screen (a floating
    // card follows it) and closes it, in every mode, once the passage scrolls away.
    let follow = 0;
    const onScroll = (e: Event) => {
      if (!textRef.current || cardRef.current?.contains(e.target as Node)) return;
      const scroller = e.target instanceof Element ? e.target : null;
      cancelAnimationFrame(follow);
      follow = requestAnimationFrame(() => {
        const range = rangeRef.current;
        // Scrolling some other pane leaves this passage where it was.
        if (!range || (scroller && !scroller.contains(range.commonAncestorContainer))) return;
        const r = range.getBoundingClientRect();
        // Bounds of the pane that scrolled: a passage hidden under its edge counts as gone.
        const view = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
        const visible = (r.width > 0 || r.height > 0) && r.bottom > view.top && r.top < view.bottom;
        if (!visible) {
          window.getSelection()?.removeAllRanges(); // so a later mouseup cannot bring it back
          close();
        } else if (!sticky()) {
          setCard((c) => c && { ...c, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
        }
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      // D toggles docking, like the reader’s other single-key shortcuts.
      if (e.key === "d" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        setDocked((d) => !d);
        setDragged(null);
        setCollapsed(false);
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(follow);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [active, marking, run, close]);
  // Place the floating card from its real content height, so it grows away
  // from the selection rather than over it.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !card) return;
    if (docked) {
      el.style.left = el.style.maxHeight = "";
      return;
    }
    if (dragged) {
      el.style.left = `${dragged.left}px`;
      el.style.top = `${dragged.top}px`;
      el.style.maxHeight = `${Math.min(MAX_H, Math.max(120, window.innerHeight - dragged.top - EDGE))}px`;
      return;
    }
    const p = place(card.anchor, Math.min(el.scrollHeight, MAX_H), el.offsetWidth);
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
    el.style.maxHeight = `${Math.min(MAX_H, p.maxHeight)}px`;
  });
  const startDrag = (e: React.PointerEvent) => {
    const el = cardRef.current;
    if (docked || !el || (e.target as Element).closest("button")) return;
    e.preventDefault();
    const box = el.getBoundingClientRect(),
      dx = e.clientX - box.left,
      dy = e.clientY - box.top;
    const move = (ev: PointerEvent) =>
      setDragged({
        left: Math.min(Math.max(EDGE, ev.clientX - dx), window.innerWidth - box.width - EDGE),
        top: Math.min(Math.max(EDGE, ev.clientY - dy), window.innerHeight - 60),
      });
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  const best = card ? bestOf(card) : "";
  // Recent translations, listed in the docked panel so earlier sentences stay at hand.
  useEffect(() => {
    if (card && best && card.mtState !== "loading" && card.mtState !== "warming")
      setHistory((h) => [{ text: card.text, zh: best }, ...h.filter((x) => x.text !== card.text)].slice(0, 30));
  }, [card?.text, card?.mtState, best]);
  const reopen = (text: string) => {
    if (!card) return;
    const id = ++seq.current;
    setCopied(false);
    setSaving(null);
    setNoted(null);
    setMarked(null);
    setMarkError("");
    setCard({ text, anchor: card.anchor, mtState: "idle", translate: true });
    void run(text, id);
  };
  const startResize = (e: React.PointerEvent, fromLeft: boolean) => {
    e.preventDefault();
    const x0 = e.clientX,
      w0 = dockWidth;
    const move = (ev: PointerEvent) =>
      setDockWidth(Math.round(Math.min(Math.max(300, w0 + (fromLeft ? x0 - ev.clientX : ev.clientX - x0)), Math.min(720, window.innerWidth - 80))));
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  const mark = async (color: HlColor) => {
    if (!card?.mark || !paper) return;
    setMarkError("");
    try {
      if (marked) {
        await updateHighlight(paper, marked.id, { color });
        setMarked({ ...marked, color });
      } else {
        const made = await addHighlight(paper, card.mark, color);
        setMarked({ id: made.highlight_id, color, note: "", saved: "" });
        // Drop the selection so the new highlight shows through.
        window.getSelection()?.removeAllRanges();
      }
    } catch (e) {
      setMarkError((e as Error).message || "高亮保存失败");
    }
  };
  // A note typed into the card is saved shortly after typing stops.
  useEffect(() => {
    if (!marked || !paper || marked.note === marked.saved) return;
    const t = setTimeout(() => {
      const { id, note } = marked;
      updateHighlight(paper, id, { note })
        .then(() => setMarked((m) => (m && m.id === id ? { ...m, saved: note } : m)))
        .catch((e) => setMarkError((e as Error).message || "批注保存失败"));
    }, 600);
    return () => clearTimeout(t);
  }, [marked?.note]);
  if (!card) return null;
  const { lookup, mt } = card;
  const short = card.text.split(/\s+/).length <= 6;
  // Dock on the side away from the selection so the text being read stays visible.
  const dockLeft = (card.anchor.left + card.anchor.right) / 2 > window.innerWidth / 2;
  const dockTop =
    Math.max(EDGE, document.querySelector(".reader-body")?.getBoundingClientRect().top ?? 64) + EDGE;
  return (
    <div
      ref={cardRef}
      className={[
        "translator-card",
        !docked && card.text.length > 160 && "wide",
        docked && (dockLeft ? "docked dock-left" : "docked dock-right"),
        collapsed && "collapsed",
        dragged && "dragged",
      ]
        .filter(Boolean)
        .join(" ")}
      style={docked ? { top: dockTop, width: dockWidth } : undefined}
      role="dialog"
      aria-label="划词翻译"
    >
      {docked && (
        <div
          className="dock-resizer"
          role="separator"
          aria-label="调整翻译面板宽度"
          title="拖动调整宽度，双击恢复默认"
          onPointerDown={(e) => startResize(e, !dockLeft)}
          onDoubleClick={() => setDockWidth(360)}
        />
      )}
      <header onPointerDown={startDrag} title={docked ? undefined : "拖动这里可把卡片移开"}>
        <Languages size={14} />
        <span className="translator-source">{card.text}</span>
        {docked && (
          <button
            className="icon-button"
            aria-label={collapsed ? "展开翻译" : "折叠翻译"}
            title={collapsed ? "展开" : "折叠，只留标题栏"}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        )}
        <button
          className="icon-button"
          aria-label={docked ? "改为浮动卡片" : "停靠到侧边"}
          aria-pressed={docked}
          title={docked ? "改回跟随选区的浮动卡片（D）" : "停靠到侧边：不遮挡原文，划新句子时原地更新（D）"}
          onClick={() => {
            setDocked((d) => !d);
            setDragged(null);
            setCollapsed(false);
          }}
        >
          {docked ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
        </button>
        <button className="icon-button" aria-label="关闭翻译" onClick={close}>
          <X size={14} />
        </button>
      </header>
      <div className="translator-body" hidden={collapsed}>
      {lookup?.glossary && (
        <div className="glossary-hit">
          <span className="chip clay">{lookup.glossary.source === "user" ? "我的术语" : "学术术语"}</span>
          <strong>{lookup.glossary.zh}</strong>
          <small>{lookup.glossary.domain}</small>
        </div>
      )}
      {lookup?.entry && (
        <div className="dict-entry">
          <div className="dict-head">
            <strong>{lookup.entry.word}</strong>
            {lookup.entry.phonetic && <span>/{lookup.entry.phonetic}/</span>}
            {lookup.entry.collins > 0 && (
              <span className="stars" title={`柯林斯 ${lookup.entry.collins} 星`}>
                {"★".repeat(lookup.entry.collins)}
              </span>
            )}
            {lookup.entry.inflection_of && <small>原形</small>}
          </div>
          <ul>
            {lookup.entry.senses.slice(0, 4).map((s, i) => {
              const m = s.match(/^([a-z]+\.|\[[^\]]+\])\s*(.*)$/);
              return (
                <li key={i}>
                  {m && <em>{m[1]}</em>}
                  {m ? m[2] : s}
                </li>
              );
            })}
          </ul>
          {lookup.entry.tags.length > 0 && (
            <div className="dict-tags">
              {lookup.entry.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {card.mtState !== "idle" && (
        <div className="mt-result" aria-live="polite">
          {card.mtState === "done" && mt ? (
            <p>{mt.translation}</p>
          ) : card.mtState === "error" ? (
            <p className="mt-error">
              {card.error}{" "}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setCard((c) => c && { ...c, mtState: "loading", error: undefined });
                  void run(card.text, seq.current);
                }}
              >
                重试
              </button>
            </p>
          ) : (
            <div className="mt-loading">
              <i />
              <i />
              <i />
              <span>
                {card.mtState === "warming"
                  ? "正在把本地模型载入显卡（通常几秒）…"
                  : "本地模型翻译中…"}
              </span>
            </div>
          )}
        </div>
      )}
      {mt && mt.terms.length > 0 && (
        <div className="mt-terms" title="这些术语按术语库统一译法">
          {mt.terms.slice(0, 6).map((t) => (
            <span key={t.en} className="chip">
              {t.en} → {t.zh}
            </span>
          ))}
        </div>
      )}
      {card.mark && paper && (
        <div className="hl-row">
          <span>
            <Highlighter size={13} />
            {marked ? "已高亮" : "高亮"}
          </span>
          <Swatches value={marked?.color} onPick={(color) => void mark(color)} />
          {marked && (
            <textarea
              aria-label="高亮批注"
              placeholder="写批注（可选，自动保存）"
              rows={2}
              value={marked.note}
              onChange={(e) => setMarked({ ...marked, note: e.target.value })}
            />
          )}
          {markError && <small className="mt-error">{markError}</small>}
        </div>
      )}
      {saving && !saving.done && (
        <form
          className="term-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/glossary", {
                method: "POST",
                body: JSON.stringify({ en: card.text, zh: saving.zh }),
              });
              setSaving({ ...saving, done: true });
            } catch (err) {
              setSaving({ ...saving, error: (err as Error).message });
            }
          }}
        >
          <input
            autoFocus
            aria-label="术语译法"
            value={saving.zh}
            onChange={(e) => setSaving({ zh: e.target.value })}
          />
          <button className="primary" disabled={!saving.zh.trim()}>
            保存
          </button>
          {saving.error && <small className="mt-error">{saving.error}</small>}
        </form>
      )}
      <footer>
        <span className="engine">
          {mt ? (
            <>
              <Cpu size={12} />
              {mt.engine} · 本地{mt.cached ? " · 缓存" : ` · ${(mt.ms / 1000).toFixed(1)}s`}
            </>
          ) : lookup?.entry || lookup?.glossary ? (
            "离线词典 · 术语库"
          ) : (
            ""
          )}
        </span>
        {best && (
          <button
            className="text-button"
            onClick={async () => {
              await copyText(best).catch(() => {});
              setCopied(true);
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "已复制" : "复制"}
          </button>
        )}
        {short && card.translate && (
          <button
            className="text-button"
            onClick={() => setSaving({ zh: lookup?.glossary?.zh || best })}
            disabled={saving?.done}
          >
            {saving?.done ? <Check size={13} /> : <BookmarkPlus size={13} />}
            {saving?.done ? "已加入术语表" : "加入术语表"}
          </button>
        )}
        {paper && best && (
          <button
            className="text-button"
            title={typeof noted === "string" && noted !== "saving" && noted !== "done" ? noted : "把原文和译文追加到本论文笔记的“划词摘录”"}
            disabled={noted === "saving" || noted === "done"}
            onClick={async () => {
              setNoted("saving");
              try {
                await addToNotes(paper, card.text, best);
                setNoted("done");
              } catch (err) {
                setNoted((err as Error).message || "保存失败");
              }
            }}
          >
            {noted === "done" ? <Check size={13} /> : <FilePlus2 size={13} />}
            {noted === "done" ? "已记入笔记" : noted === "saving" ? "保存中…" : noted ? "重试记笔记" : "记笔记"}
          </button>
        )}
        <button
          className="text-button"
          onClick={() => {
            const text = card.text;
            close();
            onAsk(text);
          }}
        >
          <MessageSquareText size={13} />
          提问
        </button>
      </footer>
      {docked && history.length > 1 && (
        <section className="translator-history" aria-label="最近划词">
          <h4>最近划词</h4>
          {history
            .filter((h) => h.text !== card.text)
            .map((h) => (
              <button key={h.text} onClick={() => reopen(h.text)} title={h.text}>
                <span>{h.text}</span>
                <small>{h.zh}</small>
              </button>
            ))}
        </section>
      )}
      </div>
    </div>
  );
}
