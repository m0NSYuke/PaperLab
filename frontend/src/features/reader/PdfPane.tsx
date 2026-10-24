import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import {
  EventBus,
  PDFViewer,
  PDFLinkService,
  PDFFindController,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
  FileWarning,
  X,
} from "lucide-react";
import { api, base } from "../../api";
import HighlightEditor from "../highlight/HighlightEditor";
import { hitTest, paintPage, useHighlights } from "../highlight/highlights";
import { attachPinchZoom, MAX_ZOOM, MIN_ZOOM } from "./pinchZoom";
import { alignContent, fitContent, measureContent, type ContentBox } from "./contentFit";
import "./workspace.css";
import type { Citation, Paper, ReadingState } from "../../types";
GlobalWorkerOptions.workerSrc = workerUrl;
const DEFAULT_SPLIT = 57;
type Outline = { title: string; dest: unknown; items: Outline[] };
export default function PdfPane({
  paper,
  state,
  onState,
  citation,
  onPage,
  onSelection,
  visible = true,
  toolbarSlot,
  outlineSlot,
  searchOpen,
  onSearchOpen,
}: {
  paper: Paper;
  state: ReadingState;
  onState: (s: Partial<ReadingState>) => void;
  citation: { value: Citation; nonce: number; navigate?: boolean } | null;
  onPage: (p: number) => void;
  onSelection: (s: string) => void;
  visible?: boolean;
  /** The reader bar hosts page and zoom controls (portal keeps state here). */
  toolbarSlot: HTMLElement | null;
  /** The reader sidebar hosts the PDF outline. */
  outlineSlot: HTMLElement | null;
  searchOpen: boolean;
  onSearchOpen: (open: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    viewerRef = useRef<HTMLDivElement>(null);
  const instance = useRef<{
    viewer: PDFViewer;
    bus: EventBus;
    link: PDFLinkService;
  } | null>(null);
  const current = useRef(state);
  current.current = state;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const appliedCitation = useRef<number | null>(null);
  const restored = useRef(false);
  // "content-width" fits the printed area, not the paper, to the pane.
  const contentBox = useRef<ContentBox | null>(null);
  const fitMode = useRef(false);
  const applyFit = () => {
    const viewer = instance.current?.viewer;
    if (!viewer?.pagesCount || !container.current?.clientWidth) return;
    fitMode.current = true;
    if (contentBox.current) fitContent(viewer, container.current, contentBox.current, MIN_ZOOM, MAX_ZOOM);
    else viewer.currentScaleValue = "page-width";
  };
  const setScale = (value: string) => {
    if (value === "content-width") return applyFit();
    fitMode.current = false;
    if (instance.current) instance.current.viewer.currentScaleValue = value;
  };
  const highlights = useHighlights(paper);
  const [editing, setEditing] = useState<{ id: string; x: number; y: number } | null>(null);
  const paintState = useRef({ highlights, active: editing?.id });
  paintState.current = { highlights, active: editing?.id };
  const [page, setPage] = useState(state.page),
    [count, setCount] = useState(paper.page_count),
    [query, setQuery] = useState(""),
    [outline, setOutline] = useState<Outline[]>([]),
    [zoomLabel, setZoomLabel] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [ready, setReady] = useState(false),
    [matches, setMatches] = useState("");
  useEffect(() => {
    let canceled = false;
    let task: ReturnType<typeof getDocument> | undefined;
    const bus = new EventBus(),
      link = new PDFLinkService({ eventBus: bus }),
      find = new PDFFindController({ eventBus: bus, linkService: link });
    const viewer = new PDFViewer({
      container: container.current!,
      viewer: viewerRef.current!,
      eventBus: bus,
      linkService: link,
      findController: find,
      textLayerMode: 1,
      removePageBorders: true,
    });
    link.setViewer(viewer);
    instance.current = { viewer, bus, link };
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let lastWidth = 0;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const width = container.current?.clientWidth || 0;
        if (canceled || !visibleRef.current || !width || !viewer.pagesCount) return;
        const scale = viewer.currentScaleValue;
        if (fitMode.current) {
          applyFit();
        } else if (["page-width", "page-fit", "auto"].includes(scale)) {
          viewer.currentScaleValue = scale;
        } else if (lastWidth && Math.abs(width - lastWidth) > 4) {
          // A manual zoom stays the same size relative to the pane, so
          // widening or narrowing the pane does not leave the page tiny.
          viewer.currentScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewer.currentScale * (width / lastWidth)));
        }
        lastWidth = width;
      }, 120);
    });
    resizeObserver.observe(container.current!);
    const detachPinch = attachPinchZoom(
      container.current!,
      () => (canceled ? null : viewer),
      () => (fitMode.current = false),
      applyFit,
    );
    // PDF.js drops unknown page children when it re-renders a page (zoom,
    // scrolling far away), so highlights are repainted after every render.
    const repaint = ({ pageNumber }: { pageNumber: number }) => {
      const div = viewerRef.current?.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
      if (div) paintPage(div, paintState.current.highlights, paintState.current.active);
    };
    bus.on("pagerendered", repaint);
    bus.on("textlayerrendered", repaint);
    bus.on("pagesinit", () => {
      if (canceled) return;
      // A focus-reading layout keeps the PDF mounted but hidden. PDF.js
      // cannot measure or scroll pages until its pane has a visible box.
      setReady(true);
    });
    bus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
      if (canceled) return;
      setPage(pageNumber);
      onState({ page: pageNumber });
      onPage(pageNumber);
    });
    bus.on("scalechanging", () => {
      if (canceled) return;
      onState({ scale: fitMode.current ? "content-width" : viewer.currentScaleValue });
      setZoomLabel(`${Math.round(viewer.currentScale * 100)}%`);
    });
    bus.on(
      "updatefindmatchescount",
      ({
        matchesCount,
      }: {
        matchesCount: { current: number; total: number };
      }) => setMatches(`${matchesCount.current} / ${matchesCount.total}`),
    );
    bus.on(
      "updatefindcontrolstate",
      ({ state: findState }: { state: number }) => {
        if (findState === 1) {
          setMatches("0 / 0");
          setNotice("未匹配到原句；已保留页面定位。可尝试较短关键词。");
        } else if (findState === 0) setNotice("已匹配原文，高亮结果见 PDF。");
      },
    );
    const load = async () => {
      try {
        await api<Paper>(base(paper.paper_id, paper.version));
        if (canceled) return;
        task = getDocument({
          url: `${base(paper.paper_id, paper.version)}/pdf`,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
        });
        const doc = await task.promise;
        if (canceled) return;
        viewer.setDocument(doc);
        link.setDocument(doc);
        setCount(doc.numPages);
        void measureContent(doc)
          .then((box) => {
            if (canceled) return;
            contentBox.current = box;
            if (fitMode.current) applyFit();
          })
          .catch(() => {});
        setOutline(((await doc.getOutline()) || []) as Outline[]);
      } catch (e) {
        if (!canceled) setError((e as Error).message);
      }
    };
    void load();
    return () => {
      canceled = true;
      resizeObserver.disconnect();
      detachPinch();
      clearTimeout(resizeTimer);
      instance.current = null;
      viewer.setDocument(null);
      void task?.destroy();
    };
  }, [paper.paper_id, paper.version]);
  useEffect(() => {
    viewerRef.current
      ?.querySelectorAll<HTMLElement>(".page[data-page-number]")
      .forEach((div) => paintPage(div, highlights, editing?.id));
  }, [highlights, editing?.id, ready]);
  useEffect(() => {
    if (!visible || !ready || !instance.current || !container.current?.clientWidth) return;
    const viewer = instance.current.viewer;
    // A paper opens with its text filling the pane: a zoom saved on another
    // screen size would show the page too small or too large.
    const saved = current.current.scale;
    setScale(restored.current || saved === "page-fit" ? saved : "content-width");
    restored.current = true;
    viewer.currentPageNumber = Math.min(current.current.page, viewer.pagesCount);
    if (fitMode.current && contentBox.current && container.current)
      alignContent(viewer, container.current, contentBox.current);
  }, [visible, ready]);
  useEffect(() => {
    if (!citation || !visible || !ready || !instance.current || appliedCitation.current === citation.nonce) return;
    const c = citation.value;
    if (c.paper_id !== paper.paper_id || c.version !== paper.version) {
      setNotice("引用属于其他论文版本，请先打开对应版本。");
      return;
    }
    appliedCitation.current = citation.nonce;
    if (c.page) instance.current.viewer.currentPageNumber = c.page;
    if (citation.navigate) {
      // Plain page navigation (reading route, shortcuts): no quote search.
      setNotice("");
      return;
    }
    setQuery(c.quote);
    if (c.quote) onSearchOpen(true);
    setNotice(c.quote ? "正在匹配原文…" : "出处未提供原句，仅定位页面。");
    if (c.quote)
      instance.current.bus.dispatch("find", {
        source: instance.current,
        type: "",
        query: c.quote,
        phraseSearch: true,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: false,
      });
  }, [citation, ready, visible]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (searchOpen)
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('[aria-label="搜索 PDF 原文"]')?.focus(),
      );
  }, [searchOpen]);
  function jump(value: number) {
    if (instance.current && ready) {
      instance.current.viewer.currentPageNumber = Math.max(
        1,
        Math.min(count, value),
      );
    }
  }
  function search(next = false) {
    if (!query.trim() || !instance.current) return;
    setNotice("正在搜索…");
    instance.current.bus.dispatch("find", {
      source: instance.current,
      type: next ? "again" : "",
      query,
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: false,
    });
  }
  function zoom(delta: number) {
    if (instance.current && ready) {
      fitMode.current = false;
      instance.current.viewer.currentScale = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, instance.current.viewer.currentScale + delta),
      );
    }
  }
  function renderOutline(items: Outline[]): React.ReactNode {
    return items.map((item, i) => (
      <div key={i}>
        <button
          onClick={() => {
            void instance.current?.link.goToDestination(item.dest as string);
          }}
        >
          {item.title}
        </button>
        {item.items?.length > 0 && (
          <div className="outline-nested">{renderOutline(item.items)}</div>
        )}
      </div>
    ));
  }
  const controls = (
    <div className="pdf-controls" role="group" aria-label="原文控制">
      <div className="page-controls">
        <button
          className="icon-button"
          aria-label="上一页"
          title="上一页 ["
          onClick={() => jump(page - 1)}
          disabled={!ready || page === 1}
        >
          <ChevronLeft size={16} />
        </button>
        <input
          aria-label="PDF 页码"
          type="number"
          min={1}
          max={count}
          value={page}
          onChange={(e) => setPage(Number(e.target.value))}
          onBlur={() => jump(page)}
          onKeyDown={(e) => {
            if (e.key === "Enter") jump(page);
          }}
        />
        <span>/ {count || "—"}</span>
        <button
          className="icon-button"
          aria-label="下一页"
          title="下一页 ]"
          onClick={() => jump(page + 1)}
          disabled={!ready || page === count}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <span className="bar-divider" />
      <div className="zoom-controls">
        <button className="icon-button" aria-label="缩小" onClick={() => zoom(-0.1)}>
          <Minus size={15} />
        </button>
        <button
          className="text-button fit"
          title={zoomLabel ? `当前 ${zoomLabel}，点击让正文铺满（去掉页边空白）` : "让正文铺满（去掉页边空白）"}
          onClick={() => ready && applyFit()}
        >
          {state.scale === "content-width" || state.scale === "page-width" || !zoomLabel ? "适宽" : zoomLabel}
        </button>
        <button className="icon-button" aria-label="放大" onClick={() => zoom(0.1)}>
          <Plus size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="恢复初始比例"
          title="恢复初始比例：分栏宽度和缩放回到默认"
          onClick={() => {
            onState({ split: DEFAULT_SPLIT });
            // Refit once the pane has its default width again.
            setTimeout(() => ready && applyFit(), 420);
          }}
        >
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
  );
  return (
    <section className="pdf-pane" aria-label="原始 PDF 阅读器">
      {toolbarSlot && createPortal(controls, toolbarSlot)}
      {outlineSlot &&
        createPortal(
          <div className="pdf-outline">
            {outline.length ? (
              renderOutline(outline)
            ) : (
              <p>此 PDF 未提供书签目录。可用页码、阅读路线或 Ctrl K 跳转。</p>
            )}
          </div>,
          outlineSlot,
        )}
      {searchOpen && (
        <form
          className="find-bar"
          onSubmit={(e) => {
            e.preventDefault();
            search(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onSearchOpen(false);
          }}
        >
          <Search size={15} />
          <input
            aria-label="搜索 PDF 原文"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索原文…"
          />
          <span>{matches}</span>
          <button type="submit">查找</button>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭搜索"
            onClick={() => onSearchOpen(false)}
          >
            <X size={14} />
          </button>
        </form>
      )}
      {notice && (
        <div className="pdf-notice" role="status">
          {notice}
        </div>
      )}
      <div className="pdf-body">
        {error && (
          <div className="pdf-error">
            <FileWarning size={28} />
            <h3>原文暂不可用</h3>
            <p>{error}</p>
          </div>
        )}
        <div
          className="pdf-container"
          ref={container}
          onMouseUp={() => {
            const s = window.getSelection()?.toString().trim();
            if (s) onSelection(s);
          }}
          onClick={(e) => {
            // A plain click or tap on a highlight opens its editor; the
            // highlights sit under the text layer, so test the point here.
            if (!window.getSelection()?.isCollapsed) return;
            const page = (e.target as Element).closest<HTMLElement>(".page[data-page-number]");
            if (!page) return;
            const r = page.getBoundingClientRect();
            const hit = hitTest(
              highlights,
              Number(page.dataset.pageNumber),
              (e.clientX - r.left) / r.width,
              (e.clientY - r.top) / r.height,
            );
            if (hit) setEditing({ id: hit.highlight_id, x: e.clientX, y: e.clientY });
          }}
        >
          <div className="pdfViewer" ref={viewerRef} />
        </div>
        {editing && highlights.some((h) => h.highlight_id === editing.id) && (
          <HighlightEditor
            paper={paper}
            item={highlights.find((h) => h.highlight_id === editing.id)!}
            at={editing}
            onClose={() => setEditing((cur) => (cur?.id === editing.id ? null : cur))}
          />
        )}
        {!ready && !error && (
          <div className="pdf-loading">
            <span className="loading-dots">
              <i />
              <i />
              <i />
            </span>
            正在渲染本地 PDF…
          </div>
        )}
      </div>
    </section>
  );
}
