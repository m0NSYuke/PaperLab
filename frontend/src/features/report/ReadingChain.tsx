import type {Citation, Comparison, Delta, Equation, EvidenceCheck, Triage} from "../../types";
import Markdown from "../../components/Markdown";
import {Citations} from "./ReportPane";

// Schema 1.3 reading chain: triage → deltas against prior work → cross-paper comparison → evidence audit.
const DEPTH = {deep: "精读", selective: "选读", skim: "略读"};
const DEPTH_SOURCE = {user: "你指定", recommended: "AI 建议，最终由你判断"};
const PAPER_TYPE: Record<string, string> = {method: "方法", system: "系统", benchmark: "基准 / 评测", survey: "综述",
  technical_report: "技术报告", analysis: "分析", other: "其他"};
const LOAD_BEARING = {yes: "承重", partial: "部分承重", no: "非承重", untested: "未检验"};
const STRENGTH = {strong: "强", moderate: "中", weak: "弱", none: "无"};
const ROW_SOURCE = {this_paper: "本文原文", local_report: "本地报告", unverified: "未核验 · 仅定性"};
export const PRIORITY = {derive: "必须自己推导", understand: "理解即可", skip: "可跳过"};

const md = (text: string) => <Markdown inline>{text}</Markdown>;

export function TriageCard({triage}: {triage: Triage}) {
  const rows: [string, string][] = [
    ...(triage.user_context ? [["你的说明", triage.user_context] as [string, string]] : []),
    ...(triage.role ? [["在你研究中的角色", triage.role] as [string, string]] : []),
    ["论文类型", PAPER_TYPE[triage.paper_type] || triage.paper_type],
    ["要解决的问题", triage.problem], ["核心改动", triage.core_change], ["主结果", triage.headline_result],
    ["代价", triage.cost], ["可信度初判", triage.credibility], ["为什么是这个深度", triage.rationale],
    ...(triage.focus.length ? [["重点阅读", triage.focus.join("；")] as [string, string]] : []),
  ];
  return <article className="triage-card" aria-label="分诊卡">
    <div className="triage-top">
      <span className={"depth-badge " + triage.depth}>{DEPTH[triage.depth]}</span>
      <small>{DEPTH_SOURCE[triage.depth_source]}</small>
    </div>
    <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{md(v)}</dd></div>)}</dl>
    <p className="muted small">依据结论：{triage.claim_ids.join(", ")}。数值均可在这些结论或实验记录中找到。</p>
  </article>;
}

export function DeltaTable({deltas, onCitation}: {deltas: Delta[]; onCitation: (c: Citation) => void}) {
  return <div className="table-overflow"><table className="chain-table">
    <thead><tr><th>模块</th><th>前作做法</th><th>本文改动</th><th>证据</th><th>是否承重</th></tr></thead>
    <tbody>{deltas.map(d => <tr key={d.delta_id}>
      <td>{md(d.component)}</td><td>{md(d.prior)}</td><td>{md(d.change)}</td>
      <td>{md(d.evidence)}{d.citations.length > 0 && <Citations items={d.citations} onCitation={onCitation}/>}</td>
      <td><span className={"chain-badge " + d.load_bearing}>{LOAD_BEARING[d.load_bearing]}</span></td>
    </tr>)}</tbody>
  </table></div>;
}

export function ComparisonTables({comparisons, onCitation}: {comparisons: Comparison[]; onCitation: (c: Citation) => void}) {
  return <>{comparisons.map(t => <div key={t.title}>
    <h4 className="chain-title">{t.title}</h4>
    <div className="table-overflow"><table className="chain-table">
      <thead><tr><th>方法</th>{t.dimensions.map(d => <th key={d}>{d}</th>)}<th>数据来源</th></tr></thead>
      <tbody>{t.rows.map(r => <tr key={r.label} className={r.source === "unverified" ? "unverified-row" : ""}>
        <td>{md(r.label)}</td>{r.cells.map((c, i) => <td key={i}>{md(c)}</td>)}
        <td><span className={"chain-badge " + r.source}>{ROW_SOURCE[r.source]}</span>
          {r.citations.length > 0 && <Citations items={r.citations} onCitation={onCitation}/>}</td>
      </tr>)}</tbody>
    </table></div>
    {t.note && <Markdown>{t.note}</Markdown>}
  </div>)}</>;
}

export function EvidenceAudit({items}: {items: EvidenceCheck[]}) {
  return <div className="table-overflow"><table className="chain-table">
    <thead><tr><th>作者主张</th><th>支撑实验</th><th>力度</th><th>对比是否公平</th><th>缺失的实验</th></tr></thead>
    <tbody>{items.map(c => <tr key={c.check_id}>
      <td>{md(c.assertion)}</td><td>{c.experiments.join("；") || "无"}</td>
      <td><span className={"chain-badge " + c.strength}>{STRENGTH[c.strength]}</span></td>
      <td>{md(c.fairness || "—")}</td><td>{md(c.gaps || "—")}</td>
    </tr>)}</tbody>
  </table></div>;
}

/** Full derivation, closed by default so the reader can work it out first. */
export function Derivation({equation}: {equation: Equation}) {
  if (!equation.derivation.length) return null;
  const prompt = equation.priority === "derive" ? "先自己推一遍，再展开完整推导" : "展开完整推导";
  return <details className="derivation-toggle">
    <summary>{prompt} <span>{equation.derivation_type === "paper" ? "原文推导" : "辅助解释 · 非论文逐字内容"}</span></summary>
    <ol className="derivation">{equation.derivation.map((s, i) => <li key={i}><Markdown>{s}</Markdown></li>)}</ol>
  </details>;
}

export function PriorityBadge({equation}: {equation: Equation}) {
  return equation.priority ? <span className={"chain-badge " + equation.priority}>{PRIORITY[equation.priority]}</span> : null;
}
