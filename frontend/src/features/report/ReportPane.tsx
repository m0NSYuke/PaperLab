import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BookOpen,
  CheckCheck,
  Copy,
  ExternalLink,
  Flag,
  RefreshCw,
  Terminal,
  Link2,
  MoreHorizontal,
} from "lucide-react";
import Markdown from "../../components/Markdown";
import { copyText, paperCommand } from "../../api";
import type { Citation, Claim, Correction, Paper, Report } from "../../types";
import type { ReportBlock } from "../../types";
import GuidedReport from "./GuidedReport";
import ReportToc from "./ReportToc";
import {ComparisonTables, DeltaTable, Derivation, EvidenceAudit, PriorityBadge, TriageCard} from "./ReadingChain";
import {reportBlocks} from "./reading";
export const TABS = [
  ["overview", "Overview", "概览"],
  ["method", "Method", "方法"],
  ["mathematics", "Mathematics", "数学"],
  ["experiments", "Experiments", "实验"],
  ["relations", "Relations", "关联"],
  ["study", "Study", "学习"],
  ["notes", "Notes", "笔记"],
  ["guide", "完整讲解", "完整讲解"],
];
const claimTypes: Record<string, string> = {
  paper_fact: "论文事实",
  paper_interpretation: "辅助解释",
  external_background: "外部背景",
  inference: "分析推断",
  uncertain: "待核实",
};
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
}) {
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const claims = report?.claims.filter((c) => c.section === tab) || [];
  const relevant = report ? reportBlocks(report).filter(b=>tab==="overview"?["overview","motivation","contributions"].includes(b.id):tab==="method"?["method","training","inference"].includes(b.id):b.section===tab) : [];
  const currentBlock: ReportBlock = {id:tab,title:TABS.find(t=>t[0]===tab)?.[2]||tab,section:tab,body:relevant.map(b=>b.title+"\n\n"+b.body).join("\n\n"),citations:relevant.flatMap(b=>b.citations)};
  const tabsRef = useRef<HTMLElement>(null);
  const ordered = [TABS[TABS.length - 1], ...TABS.slice(0, -1)];
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
          study
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
            {tab === "guide" && <GuidedReport report={report} onAsk={onAsk} onCitation={onCitation} onTab={onTab}/>}
            {tab !== "guide" && <div className="lesson-entry"><button className="text-button" onClick={()=>onTab("guide")}>按完整讲解连续阅读</button><button className="text-button" onClick={()=>onAsk(currentBlock)}>这一节没读懂</button></div>}
            {tab === "overview" && (
              <>
                <div className="section-eyebrow">01 / PAPER SNAPSHOT</div>
                <h2 className="section-title">先理解问题，再深入方法</h2>
                {report.triage && <TriageCard triage={report.triage} />}
                <Markdown>{report.overview}</Markdown>
                <h3 className="report-subheading">研究动机</h3>
                <Markdown>{report.motivation}</Markdown>
                <h3 className="report-subheading">核心贡献</h3>
                <Markdown>{report.contributions}</Markdown>
                {!!report.deltas?.length && <>
                  <h3 className="report-subheading">改进点对照</h3>
                  <DeltaTable deltas={report.deltas} onCitation={onCitation} />
                </>}
                {!!report.comparisons?.length && <>
                  <h3 className="report-subheading">横向对比</h3>
                  <ComparisonTables comparisons={report.comparisons} onCitation={onCitation} />
                </>}
                <h3 className="report-subheading">局限与阅读建议</h3>
                <Markdown>{report.limitations}</Markdown>
              </>
            )}
            {tab === "method" && (
              <>
                <div className="section-eyebrow">02 / FROM INPUT TO ACTION</div>
                <h2 className="section-title">架构与计算流程</h2>
                <Markdown>{report.method}</Markdown>
                <h3 className="report-subheading">Training Pipeline</h3>
                <Markdown>{report.training}</Markdown>
                <h3 className="report-subheading">Inference Pipeline</h3>
                <Markdown>{report.inference}</Markdown>
              </>
            )}
            {tab === "mathematics" && (
              <>
                <div className="section-eyebrow">03 / THE MATHEMATICS</div>
                <h2 className="section-title">公式背后的原理</h2>
                <Markdown>{report.mathematics}</Markdown>
                {report.equations.map((eq) => (
                  <article className="equation-card" key={eq.equation_id}>
                    <div className="equation-heading">
                      <span>FORMULA {eq.equation_id}</span>
                      <button
                        className="text-button"
                        onClick={() =>
                          onFlag({
                            claim_id: eq.equation_id,
                            text: eq.explanation,
                            section: "mathematics",
                            claim_type: "paper_interpretation",
                            citations: eq.citations,
                            evidence_status: "supported",
                          })
                        }
                      >
                        <Flag size={12} />
                        标记问题
                      </button>
                    </div>
                    <h3>{eq.title} <PriorityBadge equation={eq} /></h3>
                    <button className="text-button" onClick={()=>onAsk({id:eq.equation_id,title:eq.title,section:"mathematics",body:"$$\n"+eq.latex+"\n$$\n\n"+eq.explanation+"\n\n"+eq.symbols.map(s=>s.symbol+"："+s.definition).join("\n")+"\n\n"+eq.derivation.join("\n"),citations:eq.citations})}>这条公式没懂，追问细节</button>
                    <Markdown>{`$$\n${eq.latex}\n$$`}</Markdown>
                    <Markdown>{eq.explanation}</Markdown>
                    <div className="table-overflow">
                      <table>
                        <thead>
                          <tr>
                            <th>符号</th>
                            <th>定义</th>
                            <th>维度</th>
                          </tr>
                        </thead>
                        <tbody>
                          {eq.symbols.map((s) => (
                            <tr key={s.symbol}>
                              <td>
                                <Markdown>{`$${s.symbol}$`}</Markdown>
                              </td>
                              <td>{s.definition}</td>
                              <td>{s.shape ? <Markdown inline>{/[\\^_]/.test(s.shape) ? `$${s.shape}$` : s.shape}</Markdown> : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Derivation equation={eq} />
                    <Citations items={eq.citations} onCitation={onCitation} />
                    {latest.get(eq.equation_id) && (
                      <div className="human-correction">
                        <strong>
                          人工纠错 · {latest.get(eq.equation_id)?.status}
                        </strong>
                        <Markdown>
                          {latest.get(eq.equation_id)!.corrected_text}
                        </Markdown>
                      </div>
                    )}
                  </article>
                ))}
              </>
            )}
            {tab === "experiments" && (
              <>
                <div className="section-eyebrow">
                  04 / EVIDENCE & EVALUATION
                </div>
                <h2 className="section-title">实验与复现线索</h2>
                <p className="section-intro">
                  保留原始数值和评测协议。图中的柱高不当作精确数字；未披露的信息明确保留缺失。
                </p>
                {!!report.evidence_audit?.length && <>
                  <h3 className="report-subheading">实验审计：主张由哪些实验支撑</h3>
                  <EvidenceAudit items={report.evidence_audit} />
                </>}
                {report.experiments.map((exp, i) => (
                  <article className="experiment-card" key={i}>
                    <div className="experiment-number">
                      EXPERIMENT {String(i + 1).padStart(2, "0")}
                    </div>
                    <h3>{exp.name}</h3>
                    <dl>
                      <dt>Dataset / Setup</dt>
                      <dd>{exp.dataset}</dd>
                      <dt>Baselines</dt>
                      <dd>{exp.baselines.join(" · ") || "不适用"}</dd>
                      <dt>Metric</dt>
                      <dd>{exp.metric}</dd>
                      <dt>Results</dt>
                      <dd>
                        <Markdown>{exp.value}</Markdown>
                      </dd>
                      <dt>Protocol</dt>
                      <dd>
                        <Markdown>{exp.protocol}</Markdown>
                      </dd>
                    </dl>
                    <Citations items={exp.citations} onCitation={onCitation} />
                  </article>
                ))}
              </>
            )}
            {tab === "relations" && (
              <>
                <div className="section-eyebrow">05 / RESEARCH IN CONTEXT</div>
                <h2 className="section-title">与相关研究的联系</h2>
                {report.related_papers.map((r, i) => (
                  <article className="relation-card" key={i}>
                    <div>
                      <span className="relation-type">{r.relation}</span>
                      <small>
                        {r.verified ? "原文支持" : "分析性解释 · 待核验"}
                      </small>
                    </div>
                    <h3>
                      {r.title}
                      {r.url && (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`打开 ${r.title}`}
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </h3>
                    <Markdown>{r.explanation}</Markdown>
                    <Citations items={r.citations} onCitation={onCitation} />
                  </article>
                ))}
              </>
            )}
            {claims.length > 0 && (
              <div className="claims-section">
                <h3>
                  关键结论与原文证据 <span>{claims.length}</span>
                </h3>
                {claims.map((claim) => {
                  const correction = latest.get(claim.claim_id);
                  return (
                    <article className="claim" key={claim.claim_id}>
                      <div className="claim-top">
                        <span className={`claim-type ${claim.claim_type}`}>
                          {claimTypes[claim.claim_type]}
                        </span>
                        <span className="claim-id">{claim.claim_id}</span>
                        <button
                          className="text-button"
                          onClick={() => onFlag(claim)}
                          aria-label={`纠错 ${claim.claim_id}`}
                        >
                          <Flag size={12} />
                          标记问题
                        </button>
                      </div>
                      <Markdown>{claim.text}</Markdown>
                      <Citations
                        items={claim.citations}
                        onCitation={onCitation}
                      />
                      {claim.evidence_status === "missing" && (
                        <span className="unverified">此结论的证据尚待补充</span>
                      )}
                      {correction && (
                        <div className="human-correction">
                          <strong>
                            人工
                            {correction.status === "accepted"
                              ? "已确认修正"
                              : correction.status === "dismissed"
                                ? "已撤回修正"
                                : "待处理问题"}
                          </strong>
                          <Markdown>{correction.corrected_text}</Markdown>
                          {correction.reason && (
                            <p>原因：{correction.reason}</p>
                          )}
                          <button
                            className="text-button"
                            onClick={() => onFlag(claim)}
                          >
                            追加纠错事件
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {report.concept_links.length > 0 && (
              <div className="concept-links">
                <h3>关联概念卡片</h3>
                {report.concept_links.map((c) => (
                  <button key={c} onClick={() => onConcept(c)}>
                    <BookOpen size={14} />
                    {c.replaceAll("-", " ")}
                    <ArrowIcon />
                  </button>
                ))}
              </div>
            )}
            <details className="quality-checks">
              <summary>质量检查与边界</summary>
              <ul>
                {report.quality_checks.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
              <small>
                生成时间：
                {new Date(report.generated_at).toLocaleString("zh-CN")}
              </small>
            </details>
          </>
        )}
      </div>
      <ReportToc scroll={scrollEl} watch={tab + (report?.revision ?? "")} />
    </section>
  );
}
function ArrowIcon() {
  return <ExternalLink size={12} />;
}
