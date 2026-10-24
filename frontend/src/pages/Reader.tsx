import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Check,
  Languages,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Search,
  BookOpen,
  CheckCheck,
  Copy,
  ExternalLink,
  Flag,
  MessageSquareText,
  Save,
  Settings2,
} from "lucide-react";
import { api, base, copyText, readLocal, writeLocal } from "../api";
import type {
  Citation,
  Claim,
  Correction,
  GuideStop,
  Paper,
  ReadingState,
  Report,
  ReportBlock,
  SavedQuestion,
} from "../types";
import PdfPane from "../features/reader/PdfPane";
import CodexWorkbench from "../features/reader/CodexWorkbench";
import ReportPane, { TABS } from "../features/report/ReportPane";
import Notes from "../features/notes/Notes";
import StudyPane from "../features/study/StudyPane";
import { useCommands, type CommandSource } from "../components/CommandPalette";
import Modal from "../components/Modal";
import Markdown from "../components/Markdown";
import {blockContext, reportBlocks} from "../features/report/reading";
import "../features/report/reading.css";
import "../features/reader/reader-shell.css";
import { displayTitle, readingLabel } from "./Library";
import SelectionTranslator from "../features/translate/SelectionTranslator";
import { PAPER_TONES, setPaperTone, usePaperTone } from "../paperTone";
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
const DEFAULT: ReadingState = {
  page: 1,
  scale: "content-width",
  split: 57,
  tab: "guide",
};
export default function Reader({
  paper: initial,
  onBack,
  onDirtyChange,
}: {
  paper: Paper;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const paperTone = usePaperTone();
  const [paper, setPaper] = useState(initial),
    [report, setReport] = useState<Report | null>(null),
    [reportError, setReportError] = useState(""),
    [error, setError] = useState(""),
    [corrections, setCorrections] = useState<Correction[]>([]);
  const key = `paperlab.reader.${paper.paper_id}.${paper.version}`;
  const [state, setState] = useState<ReadingState>(() => ({
      ...DEFAULT,
      ...readLocal(key, DEFAULT),
    })),
    [citation, setCitation] = useState<{
      value: Citation;
      nonce: number;
      navigate?: boolean;
    } | null>(null),
    [selection, setSelection] = useState(""),
    [question, setQuestion] = useState(false),
    [workbench, setWorkbench] = useState(false),
    [flag, setFlag] = useState<Claim | null>(null),
    [concept, setConcept] = useState<string | null>(null),
    [conceptText, setConceptText] = useState(""),
    [conceptError, setConceptError] = useState(""),
    [edit, setEdit] = useState(false),
    [notesDirty, setNotesDirty] = useState(false);
  const [askSeed,setAskSeed]=useState<ReportBlock|null>(null);
  const [view,setView]=useState<"split"|"report"|"pdf">(()=>window.innerWidth<900?"report":"split");
  const [searchOpen, setSearchOpen] = useState(false),
    [sidebarOpen, setSidebarOpen] = useState(false),
    [sidebarTab, setSidebarTab] = useState<"outline" | "route">("outline"),
    [focus, setFocus] = useState(false),
    [resizing, setResizing] = useState(false),
    [translateOn, setTranslateOn] = useState<boolean>(() => readLocal("paperlab.translateOnSelect", true)),
    [toolbarEl, setToolbarEl] = useState<HTMLElement | null>(null),
    [outlineEl, setOutlineEl] = useState<HTMLElement | null>(null);
  useEffect(() => writeLocal("paperlab.translateOnSelect", translateOn), [translateOn]);
  const askBlock=(block:ReportBlock)=>{setAskSeed(block);setQuestion(true);};
  const splitRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const notesDirtyRef = useRef(notesDirty);
  notesDirtyRef.current = notesDirty;
  const onState = useCallback(
    (change: Partial<ReadingState>) => setState((s) => ({ ...s, ...change })),
    [],
  );
  useEffect(() => {
    onDirtyChange(notesDirty);
    return () => onDirtyChange(false);
  }, [notesDirty, onDirtyChange]);
  const load = useCallback(async () => {
    try {
      const r = await api<{ report: Report | null }>(
        `${base(paper.paper_id, paper.version)}/report`,
      );
      setReport(r.report);
      setReportError("");
    } catch (e) {
      setReportError((e as Error).message);
    }
  }, [paper.paper_id, paper.version]);
  const loadCorrections = useCallback(async () => {
    try {
      const r = await api<{ corrections: Correction[] }>(
        `${base(paper.paper_id, paper.version)}/corrections`,
      );
      setCorrections(r.corrections);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [paper.paper_id, paper.version]);
  useEffect(() => {
    void load();
    void loadCorrections();
    void api<Paper>(base(paper.paper_id, paper.version), {
      method: "PATCH",
      body: JSON.stringify({
        last_opened_at: new Date().toISOString(),
        ...(paper.reading_status === "unread"
          ? { reading_status: "reading" }
          : {}),
      }),
    })
      .then(setPaper)
      .catch((e) => setError(e.message));
    const interval = setInterval(() => {
      void load();
    }, 10000);
    return () => clearInterval(interval);
  }, [load, loadCorrections]);
  useEffect(() => {
    writeLocal(key, state);
  }, [key, state]);
  useEffect(() => {
    if (!concept) return;
    let canceled = false;
    setConceptText("");
    setConceptError("");
    void api<{ content: string }>(`/api/concepts/${concept}`)
      .then((c) => {
        if (!canceled) setConceptText(c.content);
      })
      .catch((e) => {
        if (!canceled) setConceptError(e.message);
      });
    return () => {
      canceled = true;
    };
  }, [concept]);
  const tabChange = (tab: string) => {
    if (
      notesDirtyRef.current &&
      tab !== "notes" &&
      !window.confirm("笔记尚未保存。确定离开笔记标签？")
    )
      return;
    onState({ tab });
  };
  const back = () => {
    if (
      notesDirtyRef.current &&
      !window.confirm("笔记尚未保存。确定返回文献库？")
    )
      return;
    onBack();
  };
  const updateStatus = async (status: Paper["reading_status"]) => {
    try {
      const p = await api<Paper>(base(paper.paper_id, paper.version), {
        method: "PATCH",
        body: JSON.stringify({ reading_status: status }),
      });
      setPaper(p);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const jump = (c: Citation) => {
    if (c.source_type === "external") {
      if (c.url && /^https?:\/\//.test(c.url))
        window.open(c.url, "_blank", "noopener,noreferrer");
      else setError("该外部引用尚未提供有效链接。");
      return;
    }
    if(window.innerWidth<900) setView("pdf"); else if(view==="report") setView("split");
    setCitation({ value: c, nonce: Date.now() });
  };
  const goPage = useCallback(
    (page: number) => {
      setView(previous => window.innerWidth<900 ? "pdf" : previous === "report" ? "split" : previous);
      setCitation({
        value: {
          source_type: "pdf",
          paper_id: paper.paper_id,
          version: paper.version,
          page: Math.max(1, Math.min(paper.page_count || page, page)),
          section: null,
          quote: "",
          url: null,
          verification: "unverified",
        },
        nonce: Date.now(),
        navigate: true,
      });
    },
    [paper.paper_id, paper.version, paper.page_count],
  );
  const focusSearch = () => {
    setView((v) => (window.innerWidth < 900 ? "pdf" : v === "report" ? "split" : v));
    setSearchOpen(true);
    requestAnimationFrame(() => document
      .querySelector<HTMLInputElement>('[aria-label="搜索 PDF 原文"]')
      ?.focus());
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (e.key === "Escape" && focus && !isTyping(e.target)) {
        setFocus(false);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector("dialog[open], .palette")) return;
      if (e.key === "f") {
        setFocus((f) => !f);
        return;
      }
      if (e.key === "t") {
        setTranslateOn((t) => !t);
        return;
      }
      const index = Number(e.key);
      if (index >= 1 && index <= TABS.length) tabChange(TABS[index - 1][0]);
      else if (e.key === "[") goPage(stateRef.current.page - 1);
      else if (e.key === "]") goPage(stateRef.current.page + 1);
      else if (e.key === "/") {
        e.preventDefault();
        focusSearch();
      } else if (e.key === "a") ask();
      else return;
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const commands = useMemo<CommandSource>(
    () => ({
      commands: [
        ...TABS.map(([key, label, zh], i) => ({
          id: `tab-${key}`,
          group: "报告",
          label: `${label} · ${zh}`,
          hint: String(i + 1),
          keywords: key,
          run: () => tabChange(key),
        })),
        {
          id: "prev",
          group: "原文",
          label: "上一页",
          hint: "[",
          keywords: "previous page",
          run: () => goPage(stateRef.current.page - 1),
        },
        {
          id: "next",
          group: "原文",
          label: "下一页",
          hint: "]",
          keywords: "next page",
          run: () => goPage(stateRef.current.page + 1),
        },
        {
          id: "search",
          group: "原文",
          label: "搜索原文",
          hint: "/",
          keywords: "find search",
          run: focusSearch,
        },
        ...[
          ...(report?.reading_guide?.first_pass || []).map(
            (s) => ["第一遍", s] as const,
          ),
          ...(report?.reading_guide?.must_read || []).map(
            (s) => ["必须亲读", s] as const,
          ),
        ].map(([kind, s], i) => ({
          id: `stop-${i}`,
          group: "阅读路线",
          label: `${kind} · p.${s.page} ${s.label}`,
          keywords: s.why,
          run: () => goPage(s.page),
        })),
        {
          id: "ask",
          group: "学习",
          label: "带着上下文提问",
          hint: "A",
          keywords: "ask claude chatgpt kimi deepseek 提问",
          run: () => ask(),
        },
        ...(report?.concept_links || []).map((c) => ({
          id: `concept-${c}`,
          group: "概念卡片",
          label: c.replaceAll("-", " "),
          keywords: "concept 概念",
          run: () => setConcept(c),
        })),
        ...(
          Object.entries(readingLabel) as [Paper["reading_status"], string][]
        ).map(([value, label]) => ({
          id: `status-${value}`,
          group: "阅读状态",
          label: `标记为「${label}」`,
          keywords: "status",
          run: () => void updateStatus(value),
        })),
      ],
      dynamic: (q: string) => {
        const n = Number(q.replace(/^p\.?\s*/i, ""));
        return Number.isInteger(n) && n >= 1 && n <= paper.page_count
          ? [
              {
                id: "goto",
                group: "原文",
                label: `跳到第 ${n} 页`,
                run: () => goPage(n),
              },
            ]
          : [];
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report, paper.page_count, goPage],
  );
  useCommands(commands);
  const resize = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = e.clientX,
      startSplit = state.split,
      width = splitRef.current?.getBoundingClientRect().width || 1000;
    const el = e.currentTarget;
    const move = (event: Event) => {
      const x = (event as PointerEvent).clientX;
      onState({
        split: Math.max(
          35,
          Math.min(70, startSplit + ((x - start) / width) * 100),
        ),
      });
    };
    const stop = () => {
      setResizing(false);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", stop);
    };
    setResizing(true);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", stop, { once: true });
  };
  const select = () => {
    const text = window.getSelection()?.toString().trim();
    if (text && text.length < 30000) setSelection(text);
  };
  const ask = () => {
    setAskSeed(null);
    const text = window.getSelection()?.toString().trim();
    if (text) setSelection(text);
    else if(!selection&&report) setAskSeed(reportBlocks(report).find(b=>b.id===state.tab)||null);
    setQuestion(true);
  };
  const shown = focus ? (view === "report" ? "report" : "pdf") : view;
  const progress = paper.page_count ? (state.page / paper.page_count) * 100 : 0;
  const views = [
    ["report", "讲解", "只看讲解"],
    ["split", "对照", "原文与讲解并排"],
    ["pdf", "原文", "只看原文（隐藏讲解栏）"],
  ] as const;
  const routeGroups: [string, GuideStop[] | undefined][] = [
    ["第一遍 · 快速浏览", report?.reading_guide?.first_pass],
    ["第三遍 · 必须亲读", report?.reading_guide?.must_read],
  ];
  return (
    <div className="reader-layout" data-view={shown} data-focus={focus || undefined}>
      {focus && <div className="focus-reveal" aria-hidden="true" />}
      <header className="reader-bar">
        <div className="bar-group bar-left">
          <a
            className="brand reader-home"
            href="#/"
            aria-label="返回文献库"
            title="返回文献库"
            onClick={(e) => {
              e.preventDefault();
              back();
            }}
          >
            <ArrowLeft size={17} />
          </a>
          <button
            className={`icon-button ${sidebarOpen ? "on" : ""}`}
            aria-label="论文目录"
            aria-pressed={sidebarOpen}
            title="目录与阅读路线"
            onClick={() => setSidebarOpen((o) => !o)}
          >
            <PanelLeft size={17} />
          </button>
          <div className="reader-title" title={displayTitle(paper.title)}>
            <h1>
              <span className={`status-dot ${paper.reading_status}`} />
              {displayTitle(paper.title)}
            </h1>
            <small>
              {paper.year || "本地文献"} · {paper.paper_id} · {paper.version}
            </small>
          </div>
        </div>
        <div className="bar-group bar-center" ref={setToolbarEl} />
        <div className="bar-group bar-right">
          <button
            className={`icon-button ${searchOpen ? "on" : ""}`}
            aria-label="搜索原文"
            aria-pressed={searchOpen}
            title="搜索原文（Ctrl F 或 /）"
            onClick={() => (searchOpen ? setSearchOpen(false) : focusSearch())}
          >
            <Search size={16} />
          </button>
          <button
            className={`pill-toggle ${translateOn ? "on" : ""}`}
            aria-pressed={translateOn}
            aria-label="划词翻译"
            title="选中英文即翻译：单词查离线词典，句子用本地模型（快捷键 T）"
            onClick={() => setTranslateOn((t: boolean) => !t)}
          >
            <Languages size={15} />
            <span>划词</span>
          </button>
          <div className="seg" role="group" aria-label="阅读布局">
            {views.map(([key, label, title]) => (
              <button
                key={key}
                aria-pressed={view === key}
                title={title}
                onClick={() => {
                  setFocus(false);
                  setView(key);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="ask-button" onClick={ask} title="带着上下文提问（A）">
            <MessageSquareText size={15} />
            <span>带着上下文提问</span>
          </button>
          <button
            className="icon-button"
            aria-label="Codex 工作台"
            title="Codex 工作台：生成报告、整页翻译、GPT 问答记录"
            onClick={() => setWorkbench(true)}
          >
            <Bot size={17} />
          </button>
          <MoreMenu>
            <button
              role="menuitem"
              onClick={() => {
                setAskSeed(null);
                setQuestion(true);
              }}
            >
              查看待追问问题
            </button>
            <a
              role="menuitem"
              href={"#/research?skill=nature-paper-xray&paper=" + encodeURIComponent(paper.paper_id + "/" + paper.version)}
            >
              深度解读
              <ArrowUpRight size={13} />
            </a>
            <a
              role="menuitem"
              href={"#/writing?skill=nature-writing&paper=" + encodeURIComponent(paper.paper_id + "/" + paper.version)}
            >
              带入写作台
              <ArrowUpRight size={13} />
            </a>
            <button role="menuitem" aria-label="编辑论文信息" onClick={() => setEdit(true)}>
              编辑标题与分类
            </button>
            <hr />
            <small>阅读状态</small>
            {(Object.entries(readingLabel) as [Paper["reading_status"], string][]).map(([value, label]) => (
              <button
                role="menuitemradio"
                aria-checked={paper.reading_status === value}
                key={value}
                onClick={() => void updateStatus(value)}
              >
                {label}
                {paper.reading_status === value && <Check size={14} />}
              </button>
            ))}
            <hr />
            <small>纸张背景</small>
            {PAPER_TONES.map(([value, label]) => (
              <button
                role="menuitemradio"
                aria-checked={paperTone === value}
                key={value}
                onClick={() => setPaperTone(value)}
              >
                {label}
                {paperTone === value && <Check size={14} />}
              </button>
            ))}
            <hr />
            <small>F 专注 · T 划词 · D 停靠翻译 · [ ] 翻页 · 1–8 标签 · Ctrl K 命令</small>
          </MoreMenu>
          <span className="bar-divider" />
          <button
            className={`icon-button ${focus ? "on" : ""}`}
            aria-label={focus ? "退出专注阅读" : "专注阅读"}
            title={focus ? "退出专注（Esc）" : "专注阅读：只留论文（F）"}
            onClick={() => setFocus((f) => !f)}
          >
            {focus ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            className={`icon-button ${view !== "pdf" ? "on" : ""}`}
            aria-label={view === "pdf" ? "展开讲解栏" : "收起讲解栏"}
            title={view === "pdf" ? "展开讲解栏" : "收起讲解栏，论文占满宽度"}
            onClick={() => {
              setFocus(false);
              setView(view === "pdf" ? "split" : "pdf");
            }}
          >
            <PanelRight size={17} />
          </button>
        </div>
      </header>
      <div className="reader-progress" aria-hidden="true">
        <i style={{ width: `${progress}%` }} />
      </div>
      {error && (
        <div className="error-banner reader-error" role="alert">
          {error}
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
      {paper.warnings.map((w) => (
        <div className="warning-banner reader-error" key={w}>
          {w}
        </div>
      ))}
      <div className="reader-body">
        <aside
          className={`reader-sidebar ${sidebarOpen && !focus ? "open" : ""}`}
          aria-hidden={!sidebarOpen}
        >
          <div className="sidebar-tabs" role="tablist">
            <button role="tab" aria-selected={sidebarTab === "outline"} onClick={() => setSidebarTab("outline")}>
              目录
            </button>
            <button role="tab" aria-selected={sidebarTab === "route"} onClick={() => setSidebarTab("route")}>
              阅读路线
            </button>
          </div>
          <div className="sidebar-scroll" ref={setOutlineEl} hidden={sidebarTab !== "outline"} />
          {sidebarTab === "route" && (
            <div className="sidebar-scroll route-list">
              {routeGroups.map(([title, stops]) => (
                <section key={title}>
                  <h4>{title}</h4>
                  {stops?.length ? (
                    stops.map((stop) => (
                      <button
                        key={stop.page + stop.label}
                        onClick={() => goPage(stop.page)}
                        className={state.page === stop.page ? "here" : ""}
                      >
                        <span>p.{stop.page}</span>
                        <strong>{stop.label}</strong>
                        {stop.why && <small>{stop.why}</small>}
                      </button>
                    ))
                  ) : (
                    <p>报告尚未提供阅读路线。</p>
                  )}
                </section>
              ))}
            </div>
          )}
        </aside>
        <div
          className={"reader-split view-" + shown + (resizing ? " resizing" : "")}
          ref={splitRef}
          style={{ "--split": `${state.split}%` } as React.CSSProperties}
          onMouseUp={select}
        >
          <PdfPane
            visible={shown !== "report"}
            paper={paper}
            state={state}
            onState={onState}
            citation={citation}
            onPage={() => {}}
            onSelection={setSelection}
            toolbarSlot={toolbarEl}
            outlineSlot={outlineEl}
            searchOpen={searchOpen}
            onSearchOpen={setSearchOpen}
          />
          <div
            className="splitter"
            role="separator"
            aria-label="调整原文与报告分栏"
            aria-valuenow={Math.round(state.split)}
            aria-valuemin={35}
            aria-valuemax={70}
            tabIndex={0}
            title="拖动调整分栏，双击恢复默认"
            onPointerDown={resize}
            onDoubleClick={() => onState({ split: 57 })}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft")
                onState({ split: Math.max(35, state.split - 2) });
              if (e.key === "ArrowRight")
                onState({ split: Math.min(70, state.split + 2) });
            }}
          >
            <span />
          </div>
          <ReportPane
            paper={paper}
            report={report}
            error={reportError}
            tab={state.tab}
            onTab={tabChange}
            onCitation={jump}
            corrections={corrections}
            onFlag={setFlag}
            onAsk={askBlock}
            onReload={() => {
              void load();
              void loadCorrections();
            }}
            onConcept={setConcept}
            study={
              <StudyPane
                paper={paper}
                report={report}
                onJump={goPage}
                onTab={tabChange}
                onCitation={jump}
                selection={selection}
              />
            }
            notes={
              <Notes
                paper={paper}
                corrections={corrections}
                onDirty={setNotesDirty}
                onConcept={setConcept}
                onJump={goPage}
              />
            }
          />
        </div>
      </div>
      <SelectionTranslator
        enabled={translateOn}
        marking
        paper={paper}
        onAsk={(text) => {
          setSelection(text);
          setAskSeed(null);
          setQuestion(true);
        }}
      />
      {question && (
        <QuestionDialog
          paper={paper}
          page={state.page}
          section={TABS.find((t) => t[0] === state.tab)?.[1] || state.tab}
          selection={selection}
          report={report}
          seed={askSeed}
          onClose={() => setQuestion(false)}
        />
      )}
      {workbench && (
        <CodexWorkbench
          paper={paper}
          page={state.page}
          onClose={() => setWorkbench(false)}
          onReport={() => void load()}
          onAsk={() => {
            writeLocal("paperlab.askTarget", "chatgpt");
            setWorkbench(false);
            setAskSeed(null);
            setQuestion(true);
          }}
        />
      )}
      {flag && (
        <CorrectionDialog
          paper={paper}
          claim={flag}
          onClose={() => setFlag(null)}
          onSaved={() => {
            setFlag(null);
            void loadCorrections();
          }}
        />
      )}
      {concept && (
        <Modal
          title="概念卡片 · 通用背景"
          wide
          onClose={() => setConcept(null)}
        >
          {conceptError ? (
            <p className="error-banner">{conceptError}</p>
          ) : conceptText ? (
            <div className="concept-content">
              <Markdown>{conceptText}</Markdown>
            </div>
          ) : (
            <p>正在读取概念卡片…</p>
          )}
        </Modal>
      )}
      {edit && (
        <MetadataDialog
          paper={paper}
          onClose={() => setEdit(false)}
          onSaved={(p) => {
            setPaper(p);
            setEdit(false);
          }}
        />
      )}
    </div>
  );
}
function MoreMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button
        className={`icon-button ${open ? "on" : ""}`}
        aria-label="更多操作"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div
          className="menu"
          role="menu"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button, a")) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
const TARGETS = [
  ["claude", "Claude", "https://claude.ai/new"],
  ["chatgpt", "ChatGPT", "https://chatgpt.com/"],
  ["kimi", "Kimi", "https://www.kimi.com/"],
  ["deepseek", "DeepSeek", "https://chat.deepseek.com/"],
] as const;
/** Each mode changes how the assistant should respond, not just the question text. */
const MODES: Record<string, string> = {
  解释这段内容:
    "请按算法导师的方式讲解：\n1. 这段内容在解决什么问题？\n2. 需要哪些数学基础？\n3. 逐步解释关键原理。\n4. 作者为什么这样设计？\n5. 与相关方法有什么区别？",
  解释数学公式:
    "请逐个定义符号并给出张量维度，再一步步推导，每一步说明用了什么性质。最后用一个小的数值例子验证直觉。",
  "为什么这样设计？":
    "请列出作者可能考虑过的 2–3 个替代方案，比较各自的代价，说明论文的选择在什么条件下最合理、什么条件下会失效。",
  与相关方法比较:
    "请用表格对比这段方法与最相关的 2–3 个方法：输入输出、训练目标、推理方式、优缺点。不确定的单元格写“不确定”。",
  苏格拉底式考我:
    "不要直接给答案。请一次只问我一个问题，引导我自己推出这段内容的关键点；我答错时指出错在哪，再追问。",
  "费曼检查（我先讲）":
    "下面“我的问题”里是我用自己的话写的解释。请像严格的审稿人一样挑错：哪里不准确、哪里跳步、漏了什么前提？最后给出一版更准确的讲法。",
};
function QuestionDialog({
  paper,
  page,
  section,
  selection,
  report,
  seed,
  onClose,
}: {
  paper: Paper;
  page: number;
  section: string;
  selection: string;
  report: Report | null;
  seed: ReportBlock | null;
  onClose: () => void;
}) {
  const [kind, setKind] = useState("解释这段内容"),
    [target, setTarget] = useState<string>(() =>
      readLocal("paperlab.askTarget", "chatgpt"),
    ),
    [question, setQuestion] = useState(seed ? "请从直觉和一个具体例子解释「"+seed.title+"」，再说明关键步骤。" : ""),
    [selected, setSelected] = useState(seed ? blockContext(seed) : selection),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  const [answer, setAnswer] = useState(""),
    [records, setRecords] = useState<
      {
        qa_id: string;
        question: string;
        answer: string;
        page: number;
        provider: string;
        created_at: string;
      }[]
    >([]),
    [savingQA, setSavingQA] = useState(false),
    [savedQA, setSavedQA] = useState(false);
  const [drafts,setDrafts]=useState<SavedQuestion[]>([]);
  const [savedDraft,setSavedDraft]=useState(false);
  const [draftBusy,setDraftBusy]=useState(false);
  const [selectedDraft,setSelectedDraft]=useState<SavedQuestion|null>(null);
  const contextPage=selectedDraft?.page||seed?.citations.find(c=>c.source_type==="pdf"&&c.page)?.page||page;
  const contextSection=selectedDraft?.section||seed?.title||section;
  const [originalRevision]=useState(report?.revision||null);
  const loadDrafts=async()=>setDrafts((await api<{questions:SavedQuestion[]}>(base(paper.paper_id,paper.version)+"/questions")).questions);
  const loadQA = async () => {
    const r = await api<{ records: typeof records }>(
      `${base(paper.paper_id, paper.version)}/qa`,
    );
    setRecords(r.records);
  };
  useEffect(() => {
    void loadQA().catch((e) => setError(e.message));
    void loadDrafts().catch((e)=>setError(e.message));
  }, [paper.paper_id, paper.version]);
  const site = TARGETS.find((t) => t[0] === target) || TARGETS[0];
  const text = `我正在阅读论文：
Title: ${displayTitle(paper.title)}
arXiv / Local ID: ${paper.paper_id}${paper.version}
URL: ${paper.source_url || "本地 PDF，无公开链接"}
Version: ${paper.version}
Section: ${contextSection}
Page: ${contextPage}（引用来源或当前 PDF 页序号，请再次核对）
Report revision: ${selectedDraft?.report_revision||originalRevision||"暂无报告"}

选中内容：
${selected || "[请粘贴原文、公式或描述问题]"}

我的问题：
${question || kind}

${MODES[kind]}

请区分论文事实、辅助推导与推断；重要结论尽量依据原论文，如果无法访问该版本原文，请明确说明。`;
  const copy = async () => {
    try {
      await copyText(text);
      setCopied(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const saveQA = async () => {
    setSavingQA(true);
    setError("");
    try {
      await api(`${base(paper.paper_id, paper.version)}/qa`, {
        method: "POST",
        body: JSON.stringify({
          question: question || kind,
          context: text,
          answer,
          page: contextPage,
          provider: target,
        }),
      });
      await loadQA();
      setSavedQA(true);
      setAnswer("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingQA(false);
    }
  };
  const saveDraft=async()=>{
    setDraftBusy(true);setError("");
    try {
      await api(base(paper.paper_id,paper.version)+"/questions",{method:"POST",body:JSON.stringify({question:question||kind,context:selected.slice(0,58000),section:contextSection,page:contextPage,report_revision:selectedDraft?.report_revision||originalRevision})});
      await loadDrafts();setSavedDraft(true);onClose();
    }catch(e){setError((e as Error).message);}finally{setDraftBusy(false);}
  };
  const resolve=async(d:SavedQuestion)=>{
    try{await api(base(paper.paper_id,paper.version)+"/questions/"+d.question_id,{method:"PATCH",body:JSON.stringify({resolved:!d.resolved})});await loadDrafts();}catch(e){setError((e as Error).message);}
  };
  const batchText="请逐项回答我读论文时积累的问题，不要跳过；先给直觉，再给例子，必要时补推导。以下是报告解释的快照，并非全部都是作者原句。请区分事实与辅助解释。\n论文："+paper.title+"\nID / version："+paper.paper_id+" "+paper.version+"\n\n"+
    drafts.filter(d=>!d.resolved).map((d,i)=>(i+1)+". "+d.question+"\n来源："+d.section+" / PDF p."+d.page+" / report rev."+d.report_revision+"\n"+d.context).join("\n\n---\n\n");
  return (
    <Modal title="带着上下文提问" wide onClose={onClose}>
      <p className="muted">
        先把没懂的地方记下来，读完后一次集中问。段落解释、公式和来源会一起带上；
        外部 AI 仍由你粘贴发送，不会自动读取回答。
      </p>
      {!paper.source_url&&<p className="muted small">这篇是本地 PDF，GPT 无法通过本机链接读取原文。需要核对全文时，请在 GPT 中附上原 PDF；这里会带上报告解释和出处摘录。</p>}
      {selectedDraft&&selectedDraft.report_revision!==report?.revision&&<p className="warning-banner">这条问题来自旧版报告，保留原始上下文，请对照当前版本。</p>}
      <div className="target-switch" role="radiogroup" aria-label="提问对象">
        {TARGETS.map(([key, label]) => (
          <button
            key={key}
            role="radio"
            aria-checked={target === key}
            className={target === key ? "active" : ""}
            onClick={() => {
              setTarget(key);
              writeLocal("paperlab.askTarget", key);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="question-kinds">
        {Object.keys(MODES).map((k) => (
          <button
            className={kind === k ? "active" : ""}
            key={k}
            onClick={() => {
              setKind(k);
              setCopied(false);
            }}
          >
            {k}
          </button>
        ))}
      </div>
      <label className="field-label">
        选中内容 / LaTeX（可手动修正）
        <textarea
          aria-label="提问选中内容"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setSavedDraft(false);
            setCopied(false);
          }}
          rows={4}
        />
      </label>
      <label className="field-label">
        {kind === "费曼检查（我先讲）"
          ? "先用你自己的话讲一遍"
          : "补充你的问题"}
        <input
          aria-label="补充问题"
          placeholder={kind}
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setSavedDraft(false);
            setCopied(false);
          }}
        />
      </label>
      <details className="question-preview">
        <summary>查看完整提问上下文</summary>
        <textarea aria-label="完整提问上下文" readOnly value={text} rows={8} />
      </details>
      {error && <div className="error-banner">{error}</div>}
      <div className="modal-actions">
        <button className="secondary" onClick={()=>void saveDraft()} disabled={draftBusy}>{savedDraft?"问题已保存":"先记下来，继续阅读"}</button>
        <a
          className="secondary"
          href={site[2]}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} />
          打开 {site[1]}
        </a>
        <button className="primary" onClick={() => void copy()}>
          {copied ? <CheckCheck size={16} /> : <Copy size={16} />}{" "}
          {copied ? "已复制问题" : "复制提问上下文"}
        </button>
        <a className="secondary" href={site[2]} target="_blank" rel="noreferrer" onClick={()=>void copy()}>复制本条并打开 {site[1]}</a>
      </div>
      <p className="muted small">
        得到有价值的回答后，记得把结论用自己的话写进 Notes，或在 Study
        里记一条想法。
      </p>
      <section className="reading-questions">
        <h3>待追问的问题 · {drafts.filter(d=>!d.resolved).length}</h3>
        <p className="muted small">保存在本机，刷新后仍在。可把未解决的问题一次复制给 GPT，减少来回跳转。</p>
        <button className="secondary" disabled={!drafts.some(d=>!d.resolved)} onClick={()=>void copyText(batchText).then(()=>{setCopied(true);setError("");}).catch(e=>setError(e.message))}>复制全部未解决问题</button>
        {drafts.map(d=><article key={d.question_id}>
          <strong>{d.question}</strong><small> · p.{d.page} · {d.resolved?"已理解":"待追问"}</small>
          <div><button className="text-button" onClick={()=>{setSelectedDraft(d);setQuestion(d.question);setSelected(d.context);setCopied(false);setSavedDraft(false);}}>带入这条问题</button><button className="text-button" onClick={()=>void resolve(d)}>{d.resolved?"重新打开":"标为已理解"}</button></div>
        </article>)}
      </section>
      <section className="qa-return">
        <h3>把回答保存回这篇论文</h3>
        <p className="muted">
          在 {site[1]}{" "}
          完成问答后，把回答粘贴到这里。保存时会一起记录问题、论文版本、页码与上下文；不会自动读取你的聊天。
        </p>
        <textarea
          aria-label="粘贴 AI 回答"
          rows={5}
          value={answer}
          onChange={(e) => {
            setAnswer(e.target.value);
            setSavedQA(false);
          }}
          placeholder="粘贴你从 ChatGPT 复制的回答…"
        />
        <div className="qa-save">
          <span role="status">{savedQA ? "问答已保存到本机" : ""}</span>
          <button
            className="primary"
            disabled={!answer.trim() || savingQA}
            onClick={() => void saveQA()}
          >
            <Save size={14} />
            {savingQA ? "正在保存" : "保存问答记录"}
          </button>
        </div>
      </section>
      <section className="qa-history">
        <h3>
          已保存问答 <span className="count-pill">{records.length}</span>
        </h3>
        {!records.length ? (
          <p className="muted">
            保存后的问答会出现在这里，刷新或重启后仍可读取。
          </p>
        ) : (
          [...records].reverse().map((r) => (
            <details key={r.qa_id}>
              <summary>
                {r.question}
                <small>
                  第 {r.page} 页 · {r.provider} · 用户粘贴
                </small>
              </summary>
              <Markdown>{r.answer}</Markdown>
              <small>{new Date(r.created_at).toLocaleString("zh-CN")}</small>
            </details>
          ))
        )}
      </section>
    </Modal>
  );
}
function CorrectionDialog({
  paper,
  claim,
  onClose,
  onSaved,
}: {
  paper: Paper;
  claim: Claim;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState("unclear_explanation"),
    [text, setText] = useState(""),
    [reason, setReason] = useState(""),
    [status, setStatus] = useState("accepted"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    try {
      await api(`${base(paper.paper_id, paper.version)}/corrections`, {
        method: "POST",
        body: JSON.stringify({
          claim_id: claim.claim_id,
          type,
          original_text: claim.text,
          corrected_text: text,
          reason,
          status,
        }),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="标记问题与人工纠错" onClose={onClose}>
      <div className="correction-original">
        <code>{claim.claim_id}</code>
        <Markdown>{claim.text}</Markdown>
      </div>
      <div className="field-row">
        <label className="field-label">
          问题类型
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {[
              ["factual_error", "事实错误"],
              ["mathematical_error", "数学错误"],
              ["citation_error", "引用错误"],
              ["missing_information", "信息缺失"],
              ["unclear_explanation", "解释不清"],
              ["other", "其他"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          状态
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="accepted">已确认修正</option>
            <option value="open">待处理</option>
            <option value="dismissed">撤回既有修正</option>
          </select>
        </label>
      </div>
      <label className="field-label">
        正确解释或问题描述
        <textarea
          aria-label="正确解释"
          autoFocus
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className="field-label">
        原因与依据
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例如：原文第 5 页中的条件变量…"
        />
      </label>
      {error && <div className="error-banner">{error}</div>}
      <div className="modal-actions">
        <span className="muted">追加事件，保留所有历史记录</span>
        <button
          className="primary"
          disabled={busy || !text.trim()}
          onClick={() => void save()}
        >
          <Flag size={15} />
          {busy ? "正在保存" : "保存纠错"}
        </button>
      </div>
    </Modal>
  );
}
function MetadataDialog({
  paper,
  onClose,
  onSaved,
}: {
  paper: Paper;
  onClose: () => void;
  onSaved: (p: Paper) => void;
}) {
  const [title, setTitle] = useState(paper.title),
    [topics, setTopics] = useState(paper.topics.join(", ")),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const p = await api<Paper>(base(paper.paper_id, paper.version), {
        method: "PATCH",
        body: JSON.stringify({
          title,
          topics: topics
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      onSaved(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="论文信息" onClose={onClose}>
      <label className="field-label">
        标题
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field-label">
        研究方向（逗号分隔）
        <input
          value={topics}
          onChange={(e) => setTopics(e.target.value)}
          placeholder="VLA, Diffusion / Flow Matching"
        />
      </label>
      <p className="muted">
        文献 ID：{paper.paper_id} · 固定版本：{paper.version}
      </p>
      {error && <p className="error-banner">{error}</p>}
      <div className="modal-actions">
        <button
          className="primary"
          disabled={busy || !title.trim()}
          onClick={() => void save()}
        >
          <Save size={15} />
          保存信息
        </button>
      </div>
    </Modal>
  );
}
