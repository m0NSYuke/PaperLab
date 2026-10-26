import {useState} from "react";
import type {Citation, Report, ReportBlock} from "../../types";
import Markdown from "../../components/Markdown";
import {Citations} from "./ReportPane";
import {equationBody, findExplanations, reportBlocks} from "./reading";
import {ComparisonTables, DeltaTable, Derivation, EvidenceAudit, PriorityBadge, TriageCard} from "./ReadingChain";

type Chapter = {id: string; title: string; hint: string; body: React.ReactNode};

export default function GuidedReport({report,onAsk,onCitation,onTab}:{
  report:Report;onAsk:(block:ReportBlock)=>void;onCitation:(c:Citation)=>void;onTab:(tab:string)=>void;
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
  const faq=tutorial?.faq.length?tutorial.faq:(report.self_test||[]);
  // One reading path, macro before micro: triage → background → problem and deltas → method → training/inference → maths → example → evidence → doubts → limits.
  const chapters=([
    report.triage?{id:"triage",title:"定位与分诊",hint:"先判断这篇值得读多深、重点在哪",body:<TriageCard triage={report.triage}/>}:null,
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
    {id:"math",title:"公式与推导",hint:"先看直觉，再逐条拆公式",body:<>
      {pick("mathematics").map(section)}
      {report.equations.length>0&&<>
        <p className="muted">展开一组公式，先看符号和解释；完整推导单独折叠，可以先自己推再展开对照。</p>
        {report.equations.map(e=><details className="lesson-formula" key={e.equation_id}><summary>{e.title} <PriorityBadge equation={e}/></summary>
          {section({...blocks.find(b=>b.id===e.equation_id)!,body:equationBody(e,false)})}
          <Derivation equation={e}/>
        </details>)}
        <button className="secondary" onClick={()=>onTab("mathematics")}>查看全部符号表与逐步推导</button>
      </>}
    </>},
    tutorial?.worked_examples.length?{id:"example",title:"用例子走通",hint:"小数字手算，确认自己真的懂了",body:tutorial.worked_examples.map(u=>section(unit(u)))}:null,
    {id:"experiments",title:"实验证明了什么",hint:"每个实验支持哪条结论，边界在哪",body:<>
      {!!report.evidence_audit?.length&&<section className="lesson-section"><h4>实验审计</h4><EvidenceAudit items={report.evidence_audit}/></section>}
      {report.experiments.length
        ?pick(...report.experiments.map((_,i)=>"experiment-"+i)).map(b=><details key={b.id}><summary>{b.title}</summary>{section(b)}</details>)
        :<p className="muted">当前报告没有结构化实验结果。</p>}
    </>},
    {id:"faq",title:"常见疑问",hint:"先查已有解释，不计入 Study 的自测成绩",body:faq.length
      ?faq.map((q,i)=><details key={i}><summary>{q.question}</summary><Markdown>{q.answer}</Markdown><Citations items={q.citations} onCitation={onCitation}/><button className="text-button" onClick={()=>onAsk({id:"faq-"+i,title:q.question,body:q.answer,citations:q.citations,section:"guide"})}>这个回答仍没讲明白</button></details>)
      :<p className="muted">这份报告还没有预先写好的问答；可以从具体段落记下问题。</p>},
    {id:"limits",title:"局限与待核实",hint:"原文疑点、适用边界与复现限制",body:pick("limitations").map(section)},
  ] as (Chapter|null)[]).filter((c):c is Chapter=>c!==null);
  return <div className="guided-report">
    <div className="section-eyebrow">READ → UNDERSTAND → ASK</div>
    <h2 className="section-title">先把论文讲明白</h2>
    <p className="section-intro">按章节顺序读：先补背景，再看问题、方法、公式和实验。不懂的地方先查报告，仍不清楚再集中问 GPT。</p>
    <label className="field-label">先在报告中找解释
      <input aria-label="查找报告解释" placeholder="如：DCS、温度、flow matching、少样本" value={query} onChange={e=>setQuery(e.target.value)}/>
    </label>
    {query.trim().length>=2&&<div className="lesson-search" role="region" aria-label="报告查找结果">
      <p className="muted small">{results.length?"以下内容来自当前已保存报告，没有调用新的 AI。":"报告里没有匹配的解释，可以把具体疑问记下来再问 GPT。"}</p>
      {results.map(b=><details key={b.id}><summary>{b.title}</summary><Markdown>{b.body}</Markdown><button className="secondary" onClick={()=>onAsk(b)}>还不理解，追问这一段</button></details>)}
    </div>}
    <nav className="lesson-toc" aria-label="完整讲解目录">
      {chapters.map((c,i)=><button key={c.id} onClick={()=>jump(c.id)}><span>{String(i+1).padStart(2,"0")}</span>{c.title}</button>)}
    </nav>
    {tutorial&&<div className="tutorial-intro"><Markdown>{tutorial.introduction}</Markdown></div>}
    {!tutorial?.prerequisites.length&&<p className="muted small">当前按原报告内容组织完整讲解；没有另外生成背景知识或改写研究结论。</p>}
    {chapters.map((c,i)=><section className="lesson-chapter" id={"chapter-"+c.id} key={c.id}>
      <h3 className="chapter-title"><span>{String(i+1).padStart(2,"0")}</span>{c.title}</h3>
      <p className="chapter-hint">{c.hint}</p>
      {c.body}
    </section>)}
  </div>;
}
