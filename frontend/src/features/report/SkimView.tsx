import { ArrowRight } from "lucide-react";
import Markdown from "../../components/Markdown";
import type { GuideStop, Report } from "../../types";
import { TriageCard } from "./ReadingChain";

function Stops({ title, hint, stops, onJump }: { title: string; hint: string; stops: GuideStop[]; onJump: (page: number) => void }) {
  if (!stops.length) return null;
  return (
    <section className="skim-stops">
      <h3>{title}</h3>
      <p className="muted small">{hint}</p>
      <ol>
        {stops.map((s, i) => (
          <li key={`${s.page}-${i}`}>
            <button onClick={() => onJump(s.page)} title={`跳到原文第 ${s.page} 页`}>
              <span className="skim-page">p.{s.page}</span>
              <span>
                <strong>{s.label}</strong>
                <small>{s.why}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Step 1: decide whether the paper deserves a deep read and where to look first. */
export default function SkimView({ report, onJump, onTab }: { report: Report; onJump: (page: number) => void; onTab: (tab: string) => void }) {
  const guide = report.reading_guide;
  return (
    <div className="skim-view">
      <div className="section-eyebrow">STEP 1 · 约 2 分钟</div>
      <h2 className="section-title">值不值得读，重点在哪</h2>
      {report.triage ? (
        <TriageCard triage={report.triage} />
      ) : (
        <>
          <Markdown>{report.overview}</Markdown>
          <h3 className="report-subheading">核心贡献</h3>
          <Markdown>{report.contributions}</Markdown>
          <p className="muted small">这份报告是旧格式，还没有「快速判断」；重新运行 /paper 会补上。</p>
        </>
      )}
      <Stops
        title="第一遍：先看原文这几处"
        hint="摘要、主图、主结果与局限；看完就能判断要不要精读。"
        stops={guide?.first_pass || []}
        onJump={onJump}
      />
      <Stops
        title="精读时必须亲自看的页"
        hint="公式、关键设计与数据配方，别只看讲解。"
        stops={guide?.must_read || []}
        onJump={onJump}
      />
      <div className="next-step">
        <button className="primary" onClick={() => onTab("read")}>
          开始精读 <ArrowRight size={15} />
        </button>
        <span>按「背景 → 问题 → 方法 → 公式 → 实验 → 局限」的顺序把论文读懂</span>
      </div>
    </div>
  );
}
