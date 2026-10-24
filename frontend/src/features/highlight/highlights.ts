import { useEffect, useSyncExternalStore } from "react";
import { api, base } from "../../api";
import type { Paper } from "../../types";

export type HlColor = "yellow" | "green" | "blue" | "pink" | "purple";
export const COLORS: { id: HlColor; label: string }[] = [
  { id: "yellow", label: "黄色" },
  { id: "green", label: "绿色" },
  { id: "blue", label: "蓝色" },
  { id: "pink", label: "粉色" },
  { id: "purple", label: "紫色" },
];
/** One line box, as fractions of its page, so it survives zoom and other screen sizes. */
export type HlRect = { page: number; x: number; y: number; w: number; h: number };
export type Highlight = {
  highlight_id: string;
  text: string;
  color: HlColor;
  note: string;
  rects: HlRect[];
  page: number;
  created_at: string;
  updated_at: string;
};
/** A PDF selection captured as page geometry, ready to become a highlight. */
export type Draft = { text: string; rects: HlRect[] };

// One shared list for the open paper: the PDF overlay, the selection card and
// the notes tab all read and change the same highlights.
let key = "";
let items: Highlight[] = [];
const listeners = new Set<() => void>();
const emit = (next: Highlight[]) => {
  items = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const keyOf = (p: Paper) => `${p.paper_id}/${p.version}`;
const url = (p: Paper) => `${base(p.paper_id, p.version)}/highlights`;

export function useHighlights(paper: Paper) {
  useEffect(() => {
    const k = keyOf(paper);
    if (k !== key) {
      key = k;
      emit([]);
    }
    void api<{ highlights: Highlight[] }>(url(paper))
      .then((r) => key === k && emit(r.highlights))
      .catch(() => {});
  }, [paper.paper_id, paper.version]);
  return useSyncExternalStore(subscribe, () => items);
}
export const highlightById = (id: string | undefined) => items.find((h) => h.highlight_id === id);

export async function addHighlight(paper: Paper, draft: Draft, color: HlColor) {
  const made = await api<Highlight>(url(paper), {
    method: "POST",
    body: JSON.stringify({ text: draft.text, rects: draft.rects, color }),
  });
  if (key === keyOf(paper)) emit([...items, made]);
  return made;
}
export async function updateHighlight(paper: Paper, id: string, patch: { color?: HlColor; note?: string }) {
  const next = await api<Highlight>(`${url(paper)}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (key === keyOf(paper)) emit(items.map((h) => (h.highlight_id === id ? next : h)));
  return next;
}
export async function removeHighlight(paper: Paper, id: string) {
  await api(`${url(paper)}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (key === keyOf(paper)) emit(items.filter((h) => h.highlight_id !== id));
}

/**
 * Turn a selection in the PDF text layer into per-line boxes on each page.
 * Text nodes are measured one by one (whole-element rects would double up),
 * then boxes on the same line are merged so a highlight reads as one band.
 */
export function captureSelection(sel: Selection | null): Draft | null {
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const scope = common instanceof Element ? common : common.parentElement;
  if (!scope?.closest(".pdfViewer") && !scope?.querySelector(".textLayer")) return null;
  const nodes: Text[] = [];
  if (common instanceof Text) nodes.push(common);
  else {
    const walk = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (range.intersectsNode(n)) nodes.push(n as Text);
  }
  const byPage = new Map<Element, DOMRect[]>();
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent?.closest(".textLayer") || parent.closest(".endOfContent") || !node.data.trim()) continue;
    const page = parent.closest(".page");
    if (!page) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    const boxes = [...part.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    if (boxes.length) byPage.set(page, [...(byPage.get(page) || []), ...boxes]);
  }
  const rects: HlRect[] = [];
  for (const [page, boxes] of byPage) {
    const pr = page.getBoundingClientRect();
    const pageNo = Number((page as HTMLElement).dataset.pageNumber);
    if (!pageNo || !pr.width || !pr.height) continue;
    const lines: { l: number; t: number; r: number; b: number }[] = [];
    for (const b of [...boxes].sort((a, c) => a.top - c.top || a.left - c.left)) {
      const h = b.bottom - b.top;
      const line = lines.find((x) => {
        const overlap = Math.min(x.b, b.bottom) - Math.max(x.t, b.top);
        return overlap > 0.5 * Math.min(h, x.b - x.t) && b.left - x.r < h * 1.5 && x.l - b.right < h * 1.5;
      });
      if (line) {
        line.l = Math.min(line.l, b.left);
        line.r = Math.max(line.r, b.right);
        line.t = Math.min(line.t, b.top);
        line.b = Math.max(line.b, b.bottom);
      } else lines.push({ l: b.left, t: b.top, r: b.right, b: b.bottom });
    }
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    for (const x of lines) {
      const left = clamp((x.l - pr.left) / pr.width),
        top = clamp((x.t - pr.top) / pr.height);
      const w = clamp((x.r - pr.left) / pr.width) - left,
        h = clamp((x.b - pr.top) / pr.height) - top;
      if (w > 0.001 && h > 0.001) rects.push({ page: pageNo, x: left, y: top, w, h });
    }
  }
  const text = sel.toString().replace(/\s+/g, " ").trim();
  return rects.length && text ? { text, rects } : null;
}

/** Draw a page's highlights beneath its text layer, so selecting text over them still works. */
export function paintPage(page: HTMLElement, all: Highlight[], active?: string) {
  const pageNo = Number(page.dataset.pageNumber);
  let layer = page.querySelector<HTMLDivElement>(":scope > .hl-layer");
  const mine = all.filter((h) => h.rects.some((r) => r.page === pageNo));
  if (!mine.length) {
    layer?.remove();
    return;
  }
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "hl-layer";
    layer.setAttribute("aria-hidden", "true");
  }
  // PDF.js rebuilds a page's children when it re-renders; keep the layer just under the text.
  const text = page.querySelector(":scope > .textLayer");
  if (layer.parentElement !== page || layer.nextElementSibling !== text)
    text ? page.insertBefore(layer, text) : page.append(layer);
  layer.replaceChildren(
    ...mine.flatMap((h) => {
      const rs = h.rects.filter((r) => r.page === pageNo);
      return rs.map((r, i) => {
        const el = document.createElement("div");
        el.className = `hl hl-${h.color}${h.highlight_id === active ? " active" : ""}${h.note && i === rs.length - 1 ? " has-note" : ""}`;
        el.style.cssText = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;
        return el;
      });
    }),
  );
}

/** The topmost highlight under a point on a page, with a little slack for fingers. */
export function hitTest(all: Highlight[], pageNo: number, x: number, y: number, slack = 0.004) {
  for (let i = all.length - 1; i >= 0; i--)
    if (
      all[i].rects.some(
        (r) => r.page === pageNo && x >= r.x - slack && x <= r.x + r.w + slack && y >= r.y - slack && y <= r.y + r.h + slack,
      )
    )
      return all[i];
  return undefined;
}

/** Append an excerpt under the notes' 「划词摘录」 heading, keeping the server's etag check. */
export async function addToNotes(paper: Paper, quote: string, body: string) {
  const notesUrl = `${base(paper.paper_id, paper.version)}/notes`;
  const note = await api<{ content: string; etag: string }>(notesUrl);
  const heading = "## 划词摘录";
  const entry = `> ${quote}\n\n${body}\n`;
  const content = note.content.includes(heading)
    ? `${note.content.trimEnd()}\n\n${entry}`
    : `${note.content.trimEnd()}${note.content.trim() ? "\n\n" : ""}${heading}\n\n${entry}`;
  await api(notesUrl, { method: "PUT", body: JSON.stringify({ content, etag: note.etag }) });
}
