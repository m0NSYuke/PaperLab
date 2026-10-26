import {useState} from "react";
import {ArrowRight, BookOpen, ExternalLink} from "lucide-react";
import type {Citation, Claim, Correction, Report, ReportBlock} from "../../types";
import Markdown from "../../components/Markdown";
import {Citations} from "./ReportPane";
import {findExplanations, reportBlocks} from "./reading";
import {ComparisonTables, DeltaTable, EvidenceAudit, PriorityBadge} from "./ReadingChain";
import {ClaimCard, EquationCard, ExperimentCard, RelationCard} from "./ReportParts";

type Chapter = {id: string; title: string; hint: string; body: React.ReactNode};

const CLAIM_GROUPS: [string, string][] = [
  ["overview", "问题与贡献"], ["method", "方法"], ["mathematics", "数学"], ["experiments", "实验"], ["relations", "关联研究"],
];

/** Step 2: the whole paper as one ordered read, macro before micro, ending in its sources. */
export default function GuidedReport({report,onAsk,onCitation,onTab,onFlag,corrections,onConcept}:{
  report:Report;onAsk:(block:ReportBlock)=>void;onCitation:(c:Citation)=>void;onTab:(tab:string)=>void;
  onFlag:(claim:Claim)=>void;corrections:Map<string,Correction>;onConcept:(slug:string)=>void;
}) {
  const [query,setQuery]=useState("");
  const blocks=reportBlocks(report),results=findExplanations(report,query);
  const pick=(...ids:string[])=>blocks.filter(b=>ids.includes(b.id));
  const unit=(u:{unit_id:string;title:string;body:string;citations:Citation[]}):ReportBlock=>({id:"tutorial-"+u.unit_id,title:u.title,body:u.body,citations:u.citations,section:"guide"});
  const jump=(id:string)=>document.getElementById("chapter-"+id)?.scrollIntoView({block:"start",behavior:"smooth"});
  const section=(block:ReportBlock)=><section className="lesson-section" id={"lesson-"+block.id} key={block.id}>
    <div className="lesson-heading"><h4>{block.title}</h4><button className="text-button" onClick={()=>onAsk(block)} aria-label={"没读懂："+block.title}>这段没懂，记个问题</button></div>
    <Markdown>{block.body}</Markdown>
    {block.citations.length>0&&<details className="lesson-evidence"><summary>查看这部分的原文依据</summary><Citations items={block.citations} onCitation={onCitation}/></details>}
  </section>;
  const tutorial=report.tutorial;
  const faq=tutorial?.faq.length?tutorial.faq:[];
  const claimsIn=(group:string)=>report.claims.filter(c=>c.section===group);
  // One reading path, macro before micro: background → problem and deltas → method → training/inference → maths → example → evidence → doubts → limits → context → sources.
  const chapters=([
    tutorial?.prerequisites.length?{id:"background",title:"背景知识",hint:"先补齐读这篇论文要用到的概念",body:tutorial.prerequisites.map(u=>section(unit(u)))}:null,
    {id:"problem",title:"问题与动机",hint:"论文要解决什么、为什么现有做法不够、新在哪里",body:<>
      {pick("overview","motivation","contributions").map(section)}
      {!!report.deltas?.length&&<section className="lesson-section"><h4>改进点对照</h4><DeltaTable deltas={report.deltas} onCitation={onCitation}/></section>}
      {!!report.comparisons?.length&&<section className="lesson-section"><h4>横向对比</h4><ComparisonTables comparisons={report.comparisons} onCitation={onCitation}/></section>}
    </>},
    {id:"method",title:"方法逐步走",hint:"跟着一条输入走完整个模型",body:<>
      {tutorial?.walkthrough.length?tutorial.walkthrough.map(u=>section(unit(u))):pick("method").map(section)}
      {tutorial?.walkthrough.length?<details><summary>原报告方法描述</summary>{pick("method").map(b=>section({...b,id:"method-source"}))}</details>:null}
    </>},
    {id:"training",title:"训练与推理",hint:"模型怎么学，部署时怎么用",body:pick("training","inference").map(section)},
    {id:"math",title:"公式与推导",hint:"先看直觉，再逐条拆公式；推导折叠着，先自己推再展开对照",body:<>
      {pick("mathematics").map(section)}
      {report.equations.map(e=><details className="lesson-formula" key={e.equation_id}>
        <summary>{e.title} <PriorityBadge equation={e}/></summary>
        <EquationCard eq={e} correction={corrections.get(e.equation_id)} onFlag={onFlag} onCitation={onCitation}
          onAsk={()=>onAsk(blocks.find(b=>b.id===e.equation_id)||{id:e.equation_id,title:e.title,section:"mathematics",body:e.explanation,citations:e.citations})}/>
      </details>)}
    </>},
    tutorial?.worked_examples.length?{id:"example",title:"用例子走通",hint:"小数字手算，确认自己真的懂了",body:tutorial.worked_examples.map(u=>section(unit(u)))}:null,
    {id:"experiments",title:"实验证明了什么",hint:"先看每条结论由哪些实验撑着，再看具体实验",body:<>
      {!!report.evidence_audit?.length&&<section className="lesson-section"><h4>实验审计</h4><EvidenceAudit items={report.evidence_audit}/></section>}
      {report.experiments.length
        ?report.experiments.map((exp,i)=><ExperimentCard key={i} exp={exp} index={i} onCitation={onCitation}/>)
        :<p className="muted">当前报告没有结构化实验结果。</p>}
    </>},
    faq.length?{id:"faq",title:"常见疑问",hint:"读完容易误解的地方",body:
      faq.map((q,i)=><details key={i}><summary>{q.question}</summary><Markdown>{q.answer}</Markdown><Citations items={q.citations} onCitation={onCitation}/><button className="text-button" onClick={()=>onAsk({id:"faq-"+i,title:q.question,body:q.answer,citations:q.citations,section:"guide"})}>这个回答仍没讲明白</button></details>)}:null,
    {id:"limits",title:"局限与待核实",hint:"原文疑点、适用边界与复现限制",body:pick("limitations").map(section)},
    {id:"relations",title:"关联研究",hint:"它站在谁的肩膀上，和库里哪些论文有关",body:<>
      {report.related_papers.length?report.related_papers.map((r,i)=><RelationCard key={i} relation={r} onCitation={onCitation}/>):<p className="muted">报告没有列出关联研究。</p>}
      {report.concept_links.length>0&&<div className="concept-links">
        <h3>关联概念卡片</h3>
        {report.concept_links.map(c=><button key={c} onClick={()=>onConcept(c)}><BookOpen size={14}/>{c.replaceAll("-"," ")}<ExternalLink size={12}/></button>)}
      </div>}
    </>},
    {id:"sources",title:"附：结论与原文证据",hint:"报告里每条关键结论及其原文出处；发现问题就在这里标记纠错",body:<>
      {CLAIM_GROUPS.map(([group,label])=>claimsIn(group).length>0&&<details className="claims-section" key={group}>
        <summary>{label} <span>{claimsIn(group).length}</span></summary>
        {claimsIn(group).map(c=><ClaimCard key={c.claim_id} claim={c} correction={corrections.get(c.claim_id)} onFlag={onFlag} onCitation={onCitation}/>)}
      </details>)}
      <details className="quality-checks">
        <summary>质量检查与边界</summary>
        <ul>{report.quality_checks.map((q,i)=><li key={i}>{q}</li>)}</ul>
        <small>生成时间：{new Date(report.generated_at).toLocaleString("zh-CN")}</small>
      </details>
    </>},
  ] as (Chapter|null)[]).filter((c):c is Chapter=>c!==null);
  return <div className="guided-report">
    <div className="section-eyebrow">STEP 2 · 按顺序读懂</div>
    <h2 className="section-title">把论文讲明白</h2>
    <p className="section-intro">从上往下读：先补背景，再看问题、方法、公式和实验，最后是局限与出处。不懂的地方先在下面查报告，仍不清楚再记下问题。</p>
    <label className="field-label">先在报告中找解释
      <input aria-label="查找报告解释" placeholder="如：DCS、温度、flow matching、少样本" value={query} onChange={e=>setQuery(e.target.value)}/>
    </label>
    {query.trim().length>=2&&<div className="lesson-search" role="region" aria-label="报告查找结果">
      <p className="muted small">{results.length?"以下内容来自当前已保存报告，没有调用新的 AI。":"报告里没有匹配的解释，可以把具体疑问记下来再问 GPT。"}</p>
      {results.map(b=><details key={b.id}><summary>{b.title}</summary><Markdown>{b.body}</Markdown><button className="secondary" onClick={()=>onAsk(b)}>还不理解，追问这一段</button></details>)}
    </div>}
    <nav className="lesson-toc" aria-label="精读目录">
      {chapters.map((c,i)=><button key={c.id} onClick={()=>jump(c.id)}><span>{String(i+1).padStart(2,"0")}</span>{c.title}</button>)}
    </nav>
    {tutorial&&<div className="tutorial-intro"><Markdown>{tutorial.introduction}</Markdown></div>}
    {chapters.map((c,i)=><section className="lesson-chapter" id={"chapter-"+c.id} key={c.id}>
      <h3 className="chapter-title"><span>{String(i+1).padStart(2,"0")}</span>{c.title}</h3>
      <p className="chapter-hint">{c.hint}</p>
      {c.body}
    </section>)}
    <div className="next-step">
      <button className="primary" onClick={()=>onTab("study")}>读完了，去自测 <ArrowRight size={15}/></button>
      <span>用自己的话回答自测题，再给这篇论文打分、记下想法</span>
    </div>
  </div>;
}
