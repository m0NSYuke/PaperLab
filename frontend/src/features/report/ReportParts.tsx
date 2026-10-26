import { ExternalLink, Flag } from "lucide-react";
import Markdown from "../../components/Markdown";
import type { Citation, Claim, Correction, Equation, Report } from "../../types";

type Experiment = Report["experiments"][number];
type RelatedPaper = Report["related_papers"][number];
import { Citations } from "./ReportPane";
import { Derivation, PriorityBadge } from "./ReadingChain";

export const claimTypes: Record<string, string> = {
  paper_fact: "论文事实",
  paper_interpretation: "辅助解释",
  external_background: "外部背景",
  inference: "分析推断",
  uncertain: "待核实",
};

function CorrectionNote({ correction, onFlag }: { correction?: Correction; onFlag?: () => void }) {
  if (!correction) return null;
  return (
    <div className="human-correction">
      <strong>
        人工
        {correction.status === "accepted" ? "已确认修正" : correction.status === "dismissed" ? "已撤回修正" : "待处理问题"}
      </strong>
      <Markdown>{correction.corrected_text}</Markdown>
      {correction.reason && <p>原因：{correction.reason}</p>}
      {onFlag && (
        <button className="text-button" onClick={onFlag}>
          追加纠错事件
        </button>
      )}
    </div>
  );
}

/** One formula with its symbol table, collapsed derivation, sources and any human correction. */
export function EquationCard({
  eq,
  correction,
  onFlag,
  onAsk,
  onCitation,
}: {
  eq: Equation;
  correction?: Correction;
  onFlag: (claim: Claim) => void;
  onAsk: () => void;
  onCitation: (c: Citation) => void;
}) {
  return (
    <article className="equation-card">
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
      <h3>
        {eq.title} <PriorityBadge equation={eq} />
      </h3>
      <button className="text-button" onClick={onAsk}>
        这条公式没懂，追问细节
      </button>
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
      <CorrectionNote correction={correction} />
    </article>
  );
}

export function ExperimentCard({ exp, index, onCitation }: { exp: Experiment; index: number; onCitation: (c: Citation) => void }) {
  return (
    <article className="experiment-card">
      <div className="experiment-number">EXPERIMENT {String(index + 1).padStart(2, "0")}</div>
      <h3>{exp.name}</h3>
      <dl>
        <dt>数据与设置</dt>
        <dd>{exp.dataset}</dd>
        <dt>比较对象</dt>
        <dd>{exp.baselines.join(" · ") || "不适用"}</dd>
        <dt>指标</dt>
        <dd>{exp.metric}</dd>
        <dt>结果</dt>
        <dd>
          <Markdown>{exp.value}</Markdown>
        </dd>
        <dt>评测协议</dt>
        <dd>
          <Markdown>{exp.protocol}</Markdown>
        </dd>
      </dl>
      <Citations items={exp.citations} onCitation={onCitation} />
    </article>
  );
}

export function RelationCard({ relation, onCitation }: { relation: RelatedPaper; onCitation: (c: Citation) => void }) {
  return (
    <article className="relation-card">
      <div>
        <span className="relation-type">{relation.relation}</span>
        <small>{relation.verified ? "原文支持" : "分析性解释 · 待核验"}</small>
      </div>
      <h3>
        {relation.title}
        {relation.url && (
          <a href={relation.url} target="_blank" rel="noreferrer" aria-label={`打开 ${relation.title}`}>
            <ExternalLink size={14} />
          </a>
        )}
      </h3>
      <Markdown>{relation.explanation}</Markdown>
      <Citations items={relation.citations} onCitation={onCitation} />
    </article>
  );
}

/** A report claim with its sources; flagging it starts a human correction. */
export function ClaimCard({
  claim,
  correction,
  onFlag,
  onCitation,
}: {
  claim: Claim;
  correction?: Correction;
  onFlag: (claim: Claim) => void;
  onCitation: (c: Citation) => void;
}) {
  return (
    <article className="claim">
      <div className="claim-top">
        <span className={`claim-type ${claim.claim_type}`}>{claimTypes[claim.claim_type]}</span>
        <span className="claim-id">{claim.claim_id}</span>
        <button className="text-button" onClick={() => onFlag(claim)} aria-label={`纠错 ${claim.claim_id}`}>
          <Flag size={12} />
          标记问题
        </button>
      </div>
      <Markdown>{claim.text}</Markdown>
      <Citations items={claim.citations} onCitation={onCitation} />
      {claim.evidence_status === "missing" && <span className="unverified">此结论的证据尚待补充</span>}
      <CorrectionNote correction={correction} onFlag={() => onFlag(claim)} />
    </article>
  );
}
