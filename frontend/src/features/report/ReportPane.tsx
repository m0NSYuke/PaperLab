import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CheckCheck,
  Copy,
  RefreshCw,
  Terminal,
  Link2,
  MoreHorizontal,
} from "lucide-react";
import { copyText, paperCommand } from "../../api";
import type { Citation, Claim, Correction, Paper, Report } from "../../types";
import type { ReportBlock } from "../../types";
import GuidedReport from "./GuidedReport";
import ReportToc from "./ReportToc";
import SkimView from "./SkimView";
/** Four steps in reading order: decide, understand, check yourself, write it down. */
export const TABS = [
  ["skim", "速览", "第 1 步：值不值得读、读哪里"],
  ["read", "精读", "第 2 步：按顺序把论文读懂"],
  ["study", "自测与思考", "第 3 步：检验自己学到了什么"],
  ["notes", "笔记", "第 4 步：记下自己的理解"],
];
/** Reader state saved under the old eight-tab layout maps onto the four steps. */
export function normalizeTab(tab: string) {
  if (TABS.some((t) => t[0] === tab)) return tab;
  return tab === "overview" ? "skim" : "read";
}
export function Citations({
  items,
  onCitation,
}: {
  items: Citation[];
  onCitation: (c: Citation) => void;
}) {
  return (
    <div className="citations">
      {items.length ? (
        items.map((c, i) => (
          <button
            key={i}
            className={`citation ${c.verification}`}
            title={c.quote || "未提供原句"}
            onClick={() => onCitation(c)}
          >
            <Link2 size={12} />
            {c.source_type === "pdf" ? `原文 p.${c.page || "?"}` : "外部资料"}
            {c.section && <span>· {c.section}</span>}
            {c.verification !== "verified" && " · 待核验"}
          </button>
        ))
      ) : (
        <span className="unverified">尚未提供可核验出处</span>
      )}
    </div>
  );
}
export default function ReportPane({
  paper,
  report,
  error,
  tab,
  onTab,
  onCitation,
  corrections,
  onFlag,
  onReload,
  onConcept,
  notes,
  study,
  onAsk,
  onJump,
}: {
  paper: Paper;
  report: Report | null;
  error: string;
  tab: string;
  onTab: (t: string) => void;
  onCitation: (c: Citation) => void;
  corrections: Correction[];
  onFlag: (claim: Claim) => void;
  onReload: () => void;
  onConcept: (slug: string) => void;
  notes: React.ReactNode;
  study: React.ReactNode;
  onAsk: (block: ReportBlock) => void;
  onJump: (page: number) => void;
}) {
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const tabsRef = useRef<HTMLElement>(null);
  const ordered = TABS;
  // Tabs that do not fit the pane move into a "…" menu instead of being clipped.
  const tabWidths = useRef(new Map<string, number>());
  const [navWidth, setNavWidth] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  useLayoutEffect(() => {
    const nav = tabsRef.current;
    if (!nav) return;
    const measure = () => {
      nav.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => {
        if (b.offsetWidth) tabWidths.current.set(b.dataset.tab!, b.offsetWidth + 2);
      });
      setNavWidth(nav.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);
  const overflow = (() => {
    const width = (key: string) => tabWidths.current.get(key) || 0;
    const total = ordered.reduce((sum, [key]) => sum + width(key), 0);
    if (!navWidth || total <= navWidth) return new Set<string>();
    const room = navWidth - 40; // the "…" button
    const shown: string[] = [];
    let used = 0;
    for (const [key] of ordered) {
      if (used + width(key) > room) break;
      shown.push(key);
      used += width(key);
    }
    // The active tab always stays visible, replacing the last ones that fit.
    if (!shown.includes(tab)) {
      while (shown.length && used + width(tab) > room) used -= width(shown.pop()!);
      shown.push(tab);
    }
    return new Set(ordered.map(([key]) => key).filter((key) => !shown.includes(key)));
  })();
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const down = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [moreOpen]);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<React.CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    const nav = tabsRef.current;
    const active = nav?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (!nav || !active) return;
    setIndicator({ width: active.offsetWidth, transform: `translateX(${active.offsetLeft}px)`, opacity: 1 });
  }, [tab, navWidth, overflow.size]);
  const latest = new Map<string, Correction>();
  corrections.forEach((c) => latest.set(c.claim_id, c));
  const copyCommand = async () => {
    try {
      await copyText(paperCommand(paper));
      setCopied(true);
      setCopyError("");
    } catch (e) {
      setCopyError((e as Error).message);
    }
  };
  return (
    <section className="report-pane">
      <header className="report-header">
        <nav className="report-tabs" aria-label="报告章节" ref={tabsRef}>
          <span className="tab-indicator" aria-hidden="true" style={indicator} />
          {ordered.map(([key, label, zh]) => (
            <button
              key={key}
              data-tab={key}
              hidden={overflow.has(key)}
              className={tab === key ? "active" : ""}
              onClick={() => onTab(key)}
              title={`${zh} · 快捷键 ${TABS.findIndex((t) => t[0] === key) + 1}`}
            >
              <span className="tab-step">{TABS.findIndex((t) => t[0] === key) + 1}</span>
              {label}
              {key === "notes" && <span className="tab-dot" />}
            </button>
          ))}
        </nav>
        {overflow.size > 0 && (
          <div className="menu-wrap" ref={moreRef}>
            <button
              className={`icon-button ${moreOpen ? "on" : ""}`}
              aria-label="更多章节"
              aria-expanded={moreOpen}
              title="更多章节"
              onClick={() => setMoreOpen((o) => !o)}
            >
              <MoreHorizontal size={16} />
            </button>
            {moreOpen && (
              <div className="menu" role="menu">
                {ordered
                  .filter(([key]) => overflow.has(key))
                  .map(([key, label, zh]) => (
                    <button
                      key={key}
                      role="menuitem"
                      onClick={() => {
                        onTab(key);
                        setMoreOpen(false);
                      }}
                    >
                      {label}
                      <small>{zh}</small>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
        <button
          className="icon-button"
          aria-label="刷新报告"
          title="读取 Codex 新生成的报告"
          onClick={onReload}
        >
          <RefreshCw size={15} />
        </button>
      </header>
      <div className="report-scroll" key={tab} ref={setScrollEl}>
        {tab === "notes" ? (
          notes
        ) : tab === "study" ? (
          <>
            {study}
            <div className="next-step">
              <button className="secondary" onClick={() => onTab("notes")}>写下自己的理解</button>
              <span>把这次读懂的东西用自己的话记进笔记</span>
            </div>
          </>
        ) : error ? (
          <div className="error-banner" role="alert">
            报告无法读取：{error}
            <button onClick={onReload}>重试</button>
          </div>
        ) : !report ? (
          <div className="report-empty">
            <span className="empty-icon">
              <Terminal size={28} />
            </span>
            <h2>尚未生成 AI 分析报告</h2>
            <p>
              原文已准备好，你可以先开始阅读。
              <br />
              在此项目的 Codex 中运行以下命令：
            </p>
            <div className="command-line">
              <code>{paperCommand(paper)}</code>
              <button
                aria-label="复制分析命令"
                className="icon-button"
                onClick={() => void copyCommand()}
              >
                {copied ? <CheckCheck size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <p>报告写入后，此页面会自动检测；也可以点击右上角刷新。</p>
            {copyError && <p role="alert">{copyError}</p>}
          </div>
        ) : (
          <>
            <div className="report-meta">
              <span className={`analysis-badge ${report.analysis_status}`}>
                <span />
                {report.analysis_status === "needs_review"
                  ? "存在待复核内容"
                  : "报告已生成"}
              </span>
              <span>
                rev.{report.revision} · {paper.version}
              </span>
            </div>
            {report.analysis_status === "needs_review" && (
              <div className="warning-banner">
                报告含待核验内容或人工纠错冲突；请结合原文和纠错记录阅读。
              </div>
            )}
            {tab === "skim" && <SkimView report={report} onJump={onJump} onTab={onTab} />}
            {tab === "read" && (
              <GuidedReport report={report} onAsk={onAsk} onCitation={onCitation} onTab={onTab}
                onFlag={onFlag} corrections={latest} onConcept={onConcept} />
            )}
          </>
        )}
      </div>
      <ReportToc scroll={scrollEl} watch={tab + (report?.revision ?? "")} />
    </section>
  );
}
