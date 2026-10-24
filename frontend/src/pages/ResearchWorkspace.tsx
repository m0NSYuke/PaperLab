import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {ArrowRight, BookOpen, CheckCheck, Copy, Download, FileText, FlaskConical, Layers3, LoaderCircle, PencilLine, Play, RefreshCw, Save, Search, Square} from "lucide-react";
import {api, copyText, readLocal, writeLocal} from "../api";
import type {Paper} from "../types";
import type {ResearchJob, ResearchResult, ResearchSkill} from "../features/research/types";
import Markdown from "../components/Markdown";
import {useCommands} from "../components/CommandPalette";

const categories: Record<string,string> = {all:"全部",reading:"阅读理解",writing:"论文写作",discovery:"文献研究",presentation:"图表与汇报",review:"审稿与研究计划"};
const states: Record<string,string> = {queued:"排队中",running:"正在处理",completed:"草稿就绪",failed:"未完成",cancelled:"已取消",prepared:"任务包待执行"};
const sections: Record<string,string> = {title:"标题",abstract:"摘要",intro:"引言","related-work":"相关工作",method:"方法",experiments:"实验结果",discussion:"讨论",conclusion:"结论"};
const initial = {skill_id:"nature-writing",title:"",instruction:"",material:"",section:"intro",language:"zh",journal:"generic",paper_keys:[] as string[]};
type Form = typeof initial;
const jobEndpoint = (id:string)=>"/api/research/jobs/"+id;
export default function ResearchWorkspace({mode,requestedSkill,requestedJob,sourcePaper,onDirtyChange}:{
  mode:"work"|"skills"|"outputs"; requestedSkill?:string; requestedJob?:string; sourcePaper?:string;
  onDirtyChange:(dirty:boolean)=>void;
}) {
  const [skills,setSkills]=useState<ResearchSkill[]>([]),[papers,setPapers]=useState<Paper[]>([]),[jobs,setJobs]=useState<ResearchJob[]>([]);
  const [form,setForm]=useState<Form>(()=>({...initial,...readLocal("paperlab.research.form",initial)}));
  const [query,setQuery]=useState(""),[category,setCategory]=useState("all");
  const [connection,setConnection]=useState<{logged_in:boolean;message:string;gpt_authored?:string[]}|null>(null);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
  const [activeId,setActiveId]=useState<string|null>(null),[result,setResult]=useState<ResearchResult|null>(null);
  const [content,setContent]=useState(""),[editing,setEditing]=useState(false),[dirty,setDirty]=useState(false),[saveMessage,setSaveMessage]=useState("");
  const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
  const loadedId=useRef<string|null>(null);
  const requestedId=useRef(0);
  const skill=skills.find(s=>s.id===form.skill_id);
  const active=jobs.find(j=>j.job_id===activeId);
  const xray=form.skill_id==="nature-paper-xray";
  const protectedSource=xray&&form.paper_keys.some(key=>connection?.gpt_authored?.includes(key.split("/")[0]));
  const update=(change:Partial<Form>)=>{setForm(f=>({...f,...change}));setError("");};
  useEffect(()=>{writeLocal("paperlab.research.form",form);},[form]);
  useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false);},[dirty,onDirtyChange]);
  useEffect(()=>{
    const prevent=(event:BeforeUnloadEvent)=>{if(dirtyRef.current){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",prevent);return()=>window.removeEventListener("beforeunload",prevent);
  },[]);
  const load=useCallback(async()=>{
    const value=await api<{jobs:ResearchJob[]}>("/api/research/jobs");setJobs(value.jobs);return value.jobs;
  },[]);
  useEffect(()=>{
    void Promise.all([
      api<{skills:ResearchSkill[]}>("/api/research/skills").then(r=>setSkills(r.skills)),
      api<{papers:Paper[]}>("/api/papers").then(r=>setPapers(r.papers)),
      api<NonNullable<typeof connection>>("/api/automation/status").then(setConnection),
      load(),
    ]).catch(e=>setError(e.message));
    const timer=setInterval(()=>void load().catch(e=>setError(e.message)),2500);
    return()=>clearInterval(timer);
  },[load]);
  useEffect(()=>{
    if(requestedSkill)setForm(f=>({...f,skill_id:requestedSkill}));
    if(sourcePaper)setForm(f=>({...f,paper_keys:[sourcePaper]}));
  },[requestedSkill,sourcePaper]);
  const openResult=useCallback(async(id:string)=>{
    const nonce=++requestedId.current;
    const value=await api<ResearchResult>(jobEndpoint(id)+"/result");
    if(nonce!==requestedId.current)return;
    setResult(value);setContent(value.content);setDirty(false);setEditing(false);setSaveMessage("");loadedId.current=id;
  },[]);
  useEffect(()=>{
    if(requestedJob){setActiveId(requestedJob);setResult(null);loadedId.current=null;}
  },[requestedJob]);
  useEffect(()=>{
    if(activeId&&active&&["completed","prepared"].includes(active.status)&&loadedId.current!==activeId&&!dirtyRef.current){
      void openResult(activeId).catch(e=>setError(e.message));
    }
  },[activeId,active?.status,openResult]);
  const chooseJob=(job:ResearchJob)=>{location.hash="/research?job="+job.job_id;};
  const start=async()=>{
    setBusy(true);setError("");setCopied(false);
    try{
      if(dirty)throw new Error("请先保存当前成果的修改，再创建任务。");
      const job=await api<ResearchJob>("/api/research/jobs",{method:"POST",body:JSON.stringify({
        skill_id:form.skill_id,title:form.title.trim()||skill?.title,instruction:form.instruction.trim(),
        material:form.material,section:form.section,language:["nature-writing","nature-polishing"].includes(form.skill_id)?form.language:"zh",journal:form.journal,
        papers:form.paper_keys.map(key=>{const [paper_id,version]=key.split("/");return {paper_id,version};}),
      })});
      setActiveId(job.job_id);setResult(null);setEditing(false);loadedId.current=null;await load();
      location.hash="/research?job="+job.job_id;
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const save=async()=>{
    if(!activeId||!result)return;
    setBusy(true);setError("");
    try{
      const value=await api<ResearchResult>(jobEndpoint(activeId)+"/draft",{method:"PUT",body:JSON.stringify({content,etag:result.etag})});
      setResult(value);setDirty(false);setSaveMessage("修改已保存，之前的版本仍保留");await load();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const copy=async(text:string)=>{try{await copyText(text);setCopied(true);}catch(e){setError((e as Error).message);}};
  const commands=useMemo(()=>({commands:[{id:"research-skills",group:"科研工作台",label:"浏览 Nature Skills",keywords:"skills 技能",run:()=>{location.hash="/skills";}},
    {id:"research-outputs",group:"科研工作台",label:"打开成果库",keywords:"成果 drafts history",run:()=>{location.hash="/outputs";}}]}),[]);
  useCommands(commands);
  const showSkills=mode==="skills",showOutputs=mode==="outputs";
  const filtered=skills.filter(s=>(category==="all"||s.category===category)&&(!query||(s.title+s.summary+s.name).toLowerCase().includes(query.toLowerCase())));
  const usable=skills.filter(s=>s.enabled).length;
  const resultView=<section className="research-result" aria-label="任务成果">
    <div className="result-topline"><div><span className="eyebrow">YOUR RESEARCH, IN PROGRESS</span><h2>{result?.job.title||active?.title||"把材料变成可审阅的草稿"}</h2></div>
      {active&&<span className={"job-state state-"+active.status}>{states[active.status]}</span>}
    </div>
    {!active&&!result?<div className="research-empty"><PencilLine size={40} strokeWidth={1}/><h3>从一段材料开始</h3><p>选一个任务，提供真实的结果、草稿或论文。生成的内容会留在这里，你可以修改、保存、下载。</p><ul><li>先提供证据，再组织论证</li><li>保留不知道和待核实的部分</li><li>所有新结果独立保存，便于回看</li></ul></div>:null}
    {active&&!result&&<div className="research-empty" role="status">{["queued","running"].includes(active.status)?<LoaderCircle className="spin" size={32}/>:<FileText size={32}/>}<h3>{active.message}</h3>
      <p>{active.skill_title} · {new Date(active.created_at).toLocaleString("zh-CN")}</p>
      {["queued","running"].includes(active.status)&&<button className="secondary" onClick={()=>void api(jobEndpoint(active.job_id)+"/cancel",{method:"POST"}).then(load).catch(e=>setError(e.message))}><Square size={14}/>取消任务</button>}
      {active.status==="failed"&&<button className="secondary" onClick={()=>update({skill_id:active.skill_id})}>重新准备任务</button>}
    </div>}
    {result&&<>
      <div className="result-actions">
        {result.editable&&<button className="secondary" onClick={()=>setEditing(!editing)}>{editing?<BookOpen size={15}/>:<PencilLine size={15}/>} {editing?"阅读预览":"编辑草稿"}</button>}
        {result.editable&&<button className="primary" disabled={!dirty||busy} onClick={()=>void save()}><Save size={15}/>保存修改</button>}
        <button className="secondary" onClick={()=>void copy(result.editable?content:result.job.handoff_prompt||content)}>{copied?<CheckCheck size={15}/>:<Copy size={15}/>} {copied?"已复制":result.editable?"复制内容":"复制给 Codex 执行"}</button>
        <a className="secondary" href={jobEndpoint(result.job.job_id)+"/download"} onClick={e=>{if(dirty){e.preventDefault();setError("请先保存修改，再下载最新内容。");}}}><Download size={15}/>{result.editable?"下载 Markdown":"下载任务说明"}</a>
      </div>
      <p className="result-provenance">{result.editable?"Codex 生成的可编辑草稿 · 使用 ChatGPT 登录":"完整技能任务包 · 尚未执行模型、检索或文件制作"}{dirty?" · 有未保存修改":""}{result.human_edited?" · 你已编辑":""}</p>
      {saveMessage&&<p role="status" className="success-text">{saveMessage}</p>}
      {result.warnings.length>0&&<details className="result-warnings"><summary>使用前需要核对 · {result.warnings.length}</summary><ul>{result.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
      {editing?<textarea className="draft-editor" aria-label="编辑成果草稿" value={content} onChange={e=>{setContent(e.target.value);setDirty(true);setSaveMessage("");}}/>:<article className="research-prose"><Markdown>{content}</Markdown></article>}
      {result.citations.length>0&&<details className="result-citations"><summary>查看原始草稿的引用依据 · {result.citations.length}</summary><p className="muted small">以下引句已与生成时的 PDF 文字核对。人工编辑后，请重新确认它们仍支撑当前表述。</p>{result.citations.map((c,i)=><blockquote key={i}><a href={"#/paper/"+encodeURIComponent(c.paper_id)+"/"+c.version}>{c.paper_id} · {c.version} · PDF p.{c.page}</a><p>{c.quote}</p></blockquote>)}</details>}
    </>}
  </section>;
  return <main className={"research-page "+(showSkills?"catalog-page":showOutputs?"outputs-page":"studio-page")}>
    <div className="workspace-page-heading"><div><span className="eyebrow">PAPERLAB / NATURE SKILLS</span><h1>{showSkills?"找到适合这一步的工具":showOutputs?"每一步研究，都有迹可循":"从读懂，到写清楚"}</h1><p>{showSkills?"22 个科研技能，按眼前的任务选择。":showOutputs?"保存的解读、草稿与待执行任务，集中放在这里。":"先把问题讲明白，再把证据写成文章。"}</p></div><span className="workspace-enabled"><span className="live-dot"/>{skills.length?usable+" 项技能已启用":"正在读取技能…"}</span></div>
    {error&&<div className="error-banner" role="alert">{error}<button className="text-button" onClick={()=>setError("")}>收起</button></div>}
    {showSkills?<>
      <div className="catalog-tools"><label className="catalog-search"><Search size={17}/><input aria-label="搜索科研技能" placeholder="搜索任务，如：润色、PPT、参考文献" value={query} onChange={e=>setQuery(e.target.value)}/></label><span>{filtered.length} 项任务</span></div>
      <nav className="skill-filters" aria-label="技能分类">{Object.entries(categories).map(([id,label])=><button key={id} aria-pressed={category===id} onClick={()=>setCategory(id)}>{label}</button>)}</nav>
      <div className="skill-grid">{filtered.map(s=><a className={"skill-card "+(!s.enabled?"unavailable":"")} key={s.id} href={"#/research?skill="+s.id}><div><span className="skill-category">{categories[s.category]}</span><span className={"skill-mode "+s.mode}>{!s.enabled?"安装需检查":s.mode==="web"?"网页内生成":"在 Codex 中完成"}</span></div><h2>{s.title}<ArrowRight size={18}/></h2><p>{s.summary}</p><small>{s.mode==="web"?"提交材料，结果保存在成果库":s.requirement}</small></a>)}</div>
      {!filtered.length&&<div className="empty-state">{skills.length?"没有匹配的技能，换个词或分类试试。":"正在载入技能目录…"}</div>}
    </>:showOutputs?<>
      <div className="outputs-toolbar"><span>{jobs.length} 个任务 · {jobs.filter(j=>j.status==="completed").length} 份可编辑草稿</span><a className="primary" href="#/writing"><PencilLine size={15}/>开始新任务</a><button className="icon-button" aria-label="刷新成果库" onClick={()=>void load().catch(e=>setError(e.message))}><RefreshCw size={17}/></button></div>
      {!jobs.length?<div className="research-empty"><Layers3 size={40}/><h2>第一份成果，从这里开始</h2><p>生成详细解读或写作草稿后，会自动保存在此。</p></div>:<div className="output-grid">{jobs.map(j=><a className="output-card" href={"#/research?job="+j.job_id} key={j.job_id}><span className={"job-state state-"+j.status}>{states[j.status]}</span><h2>{j.title}</h2><p>{j.skill_title}</p><small>{new Date(j.created_at).toLocaleString("zh-CN")}</small><ArrowRight size={17}/></a>)}</div>}
    </>:<div className="studio-layout">
      <aside className="research-intake">
        <label className="field-label">这次要做什么<select aria-label="选择科研任务" value={form.skill_id} onChange={e=>update({skill_id:e.target.value,...(e.target.value==="nature-paper-xray"?{paper_keys:form.paper_keys.slice(0,1)}:{})})}>{skills.map(s=><option disabled={!s.enabled} value={s.id} key={s.id}>{s.title}{s.mode==="codex"?" · Codex 完整流程":""}</option>)}</select></label>
        <p className="task-description">{skill?.summary||"正在读取已安装技能…"}</p>
        {skill?.mode==="codex"&&<div className="task-route-note"><FlaskConical size={17}/><p>{skill.requirement} 先保存材料和来源，再把准备好的任务交给 Codex。</p></div>}
        <label className="field-label">任务名称<input aria-label="任务名称" placeholder={skill?.title||"给这次任务起个名字"} value={form.title} maxLength={200} onChange={e=>update({title:e.target.value})}/></label>
        <label className="field-label">具体要求<textarea aria-label="科研任务要求" rows={3} maxLength={6000} placeholder={form.skill_id==="nature-paper-xray"?"讲清设计动机，用小例子解释关键公式，最后整理常见疑问。":"说明要处理哪部分、保留什么，以及希望得到怎样的结果。"} value={form.instruction} onChange={e=>update({instruction:e.target.value})}/></label>
        <label className="field-label">你的材料<textarea aria-label="科研任务材料" rows={9} maxLength={60000} placeholder={form.skill_id==="nature-paper-xray"?"可选：你的背景、阅读目标或特别想弄懂的地方。":"粘贴真实结果、草稿、实验记录或已确认事实。缺失的信息会保留为待补充。"} value={form.material} onChange={e=>update({material:e.target.value})}/></label>
        {skill?.mode==="web"&&!["nature-writing","nature-polishing"].includes(form.skill_id)&&<p className="muted small">成果使用中文，原文引句保留来源语言。</p>}
        <details className="source-picker" open={xray}><summary>关联文献 · {form.paper_keys.length} / {xray?1:3}</summary>
          <p className="muted small">会读取所选固定版本的 PDF 原生文本。图件和扫描页仍需对照原文。</p>
          {!papers.length&&<a href="#/">先导入一篇论文 <ArrowRight size={14}/></a>}
          {papers.map(p=>{const key=p.paper_id+"/"+p.version;return <label key={key}><input type="checkbox" aria-label={"关联文献："+p.title} checked={form.paper_keys.includes(key)} disabled={!xray&&form.paper_keys.length>=3&&!form.paper_keys.includes(key)} onChange={e=>update({paper_keys:e.target.checked?(xray?[key]:[...form.paper_keys,key]):form.paper_keys.filter(k=>k!==key)})}/><span>{p.title}<small>{p.version} · {p.page_count} 页</small></span></label>;})}
        </details>
        {protectedSource&&<p className="task-route-note">这篇论文已约定由 GPT 撰写分析。请继续阅读已有报告，或在原 GPT 会话中补充。</p>}
        {(form.skill_id==="nature-writing"||form.skill_id==="nature-polishing")&&<div className="writing-options"><label className="field-label">章节<select aria-label="写作章节" value={form.section} onChange={e=>update({section:e.target.value})}>{Object.entries(sections).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label><label className="field-label">语言<select aria-label="成果语言" value={form.language} onChange={e=>update({language:e.target.value})}><option value="zh">中文</option><option value="en">English</option></select></label><label className="field-label journal-option">目标期刊<select aria-label="目标期刊" value={form.journal} onChange={e=>update({journal:e.target.value})}><option value="generic">通用学术写作</option><option value="nature">Nature</option><option value="nat-comms">Nature Communications</option><option value="nat-mach-intell">Nature Machine Intelligence</option><option value="nature-family">其他 Nature Portfolio</option></select></label></div>}
        <button className="primary run-research" disabled={busy||!skill?.enabled||!form.instruction.trim()||(xray&&(!form.paper_keys.length||protectedSource))||(skill?.mode==="web"&&(!connection?.logged_in||(!xray&&!form.material.trim())))} onClick={()=>void start()}>{busy?<LoaderCircle size={17} className="spin"/>:<Play size={16}/>} {busy?"正在提交":skill?.mode==="codex"?"准备完整技能任务":"开始生成草稿"}</button>
        <p className="research-connection" role="status"><span className={connection?.logged_in?"live-dot":"offline-dot"}/>{connection?.logged_in?"使用现有 ChatGPT 登录与 Codex 订阅额度":connection?.message||"正在检查本机 Codex 登录…"}</p>
        <details className="recent-research"><summary>最近任务 · {jobs.length}</summary>{jobs.slice(0,12).map(j=><button key={j.job_id} onClick={()=>chooseJob(j)}><span>{j.title}</span><small>{states[j.status]}</small></button>)}</details>
      </aside>
      {resultView}
    </div>}
  </main>;
}
