import type {Equation, Report, ReportBlock} from "../../types";

/** Formula, explanation and symbols; the derivation is optional so readers can try it before revealing it. */
export function equationBody(e: Equation, withDerivation = true) {
  return ["$$\n"+e.latex+"\n$$",e.explanation,...e.symbols.map(s=>"$"+s.symbol+"$："+s.definition+(s.shape ? "（"+(/[\^_]/.test(s.shape) ? "$"+s.shape+"$" : s.shape)+"）":"")),...(withDerivation ? e.derivation : [])].join("\n\n");
}

export function reportBlocks(report: Report): ReportBlock[] {
  const sections = [
    ["overview", "这篇论文在解决什么"], ["motivation", "为什么需要这个方法"],
    ["contributions", "新意与已有工作"], ["method", "方法一步步怎么运行"],
    ["training", "模型怎么训练"], ["inference", "一条输入如何得到结果"],
    ["mathematics", "数学直觉与推导"], ["limitations", "适用边界与待核实内容"],
  ];
  const blocks: ReportBlock[] = sections.map(([id,title]) => ({
    id, title, section:id, body:report[id as keyof Report] as string,
    citations:report.claims.filter(c => c.section === (["training","inference"].includes(id) ? "method" : ["motivation","contributions","limitations"].includes(id) ? "overview" : id)).flatMap(c=>c.citations),
  }));
  blocks.push(...report.equations.map(e => ({
    id:e.equation_id,title:e.title,section:"mathematics",
    body:equationBody(e),
    citations:e.citations,
  })));
  const t=report.triage;
  if (t) blocks.push({id:"triage",title:"分诊卡",section:"overview",citations:[],
    body:[t.user_context,t.role,t.problem,t.core_change,t.headline_result,t.cost,t.credibility,t.rationale,...t.focus].filter(Boolean).join("\n\n")});
  blocks.push(...(report.deltas||[]).map(d=>({id:"delta-"+d.delta_id,title:"改进点："+d.component,section:"overview",
    body:"前作做法："+d.prior+"\n\n本文改动："+d.change+"\n\n证据："+d.evidence,citations:d.citations})));
  blocks.push(...(report.comparisons||[]).map((c,i)=>({id:"comparison-"+i,title:"横向对比："+c.title,section:"overview",
    body:c.rows.map(r=>r.label+"："+r.cells.map((v,j)=>c.dimensions[j]+" "+v).join("；")).join("\n\n")+(c.note ? "\n\n"+c.note : ""),
    citations:c.rows.flatMap(r=>r.citations)})));
  blocks.push(...(report.evidence_audit||[]).map(c=>({id:"audit-"+c.check_id,title:"实验审计："+c.assertion,section:"experiments",
    body:"支撑实验："+(c.experiments.join("；")||"无")+"\n\n对比是否公平："+(c.fairness||"—")+"\n\n缺失的实验："+(c.gaps||"—"),citations:[]})));
  blocks.push(...report.experiments.map((e,i)=>({
    id:"experiment-"+i,title:e.name,section:"experiments",
    body:"数据与设置："+e.dataset+"\n\n比较对象："+e.baselines.join("、")+"\n\n指标："+e.metric+"\n\n结果："+e.value+"\n\n协议："+e.protocol,
    citations:e.citations,
  })));
  blocks.push(...report.related_papers.map((r,i)=>({id:"relation-"+i,title:r.title,section:"relations",body:r.explanation,citations:r.citations})));
  if (report.tutorial) {
    for (const group of [report.tutorial.prerequisites,report.tutorial.walkthrough,report.tutorial.worked_examples])
      blocks.push(...group.map(u=>({id:"tutorial-"+u.unit_id,title:u.title,section:"guide",body:u.body,citations:u.citations})));
    blocks.push(...report.tutorial.faq.map((q,i)=>({id:"faq-"+i,title:q.question,section:"guide",body:q.answer,citations:q.citations})));
  }
  blocks.push(...(report.self_test||[]).map(q=>({id:q.question_id,title:q.question,section:"study",body:q.answer,citations:q.citations})));
  return blocks.filter(b=>b.body.trim());
}

export function findExplanations(report: Report, query: string) {
  const phrase=query.trim().toLowerCase();
  if (phrase.length<2) return [];
  const terms=phrase.match(/[a-z0-9_+-]{2,}|[\u4e00-\u9fff]{2,}/g)||[];
  const tokens=[...new Set(terms.flatMap(t=>/[\u4e00-\u9fff]/.test(t)&&t.length>3 ? Array.from({length:t.length-1},(_,i)=>t.slice(i,i+2)) : [t]))];
  return reportBlocks(report).map(block=>{
    const title=block.title.toLowerCase(),body=block.body.toLowerCase();
    const score=(title.includes(phrase)?12:0)+(body.includes(phrase)?4:0)+tokens.reduce((s,t)=>s+(title.includes(t)?3:0)+(body.includes(t)?1:0),0);
    return {block,score};
  }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,5).map(r=>r.block);
}

export function blockContext(block: ReportBlock) {
  const body=block.body.length>18000?block.body.slice(0,18000)+"\n[这段解释较长，此处截取前18000字符]":block.body;
  return "我没有读懂报告中的「"+block.title+"」。以下是已生成报告的解释，不是论文逐字原文：\n\n"+body+
    "\n\n报告所附来源（请对照原文核实）：\n"+block.citations.map(c=>"PDF p."+(c.page||"未知")+" "+(c.section||"")+"\n"+c.quote).join("\n\n");
}
