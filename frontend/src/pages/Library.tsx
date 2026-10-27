import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Clock3,
  FileText,
  FolderOpen,
  Grid2X2,
  HardDrive,
  Lightbulb,
  List,
  Milestone,
  Network,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import { api, readLocal, USER_NAME, writeLocal } from "../api";
import type { BackupStatus, Paper, ResearchLine, StudyOverview, StudySummary } from "../types";
import Modal from "../components/Modal";
import CardBrief from "../features/library/CardBrief";
import KnowledgeGraph from "../features/library/KnowledgeGraph";
import KnowledgeHits from "../features/library/KnowledgeHits";
import { useCommands, type CommandSource } from "../components/CommandPalette";
const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", lambda: "λ",
  mu: "μ", pi: "π", sigma: "σ", tau: "τ", phi: "φ", psi: "ψ", omega: "ω",
};
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆",
  "7": "₇", "8": "₈", "9": "₉", ".": ".", "+": "₊", "-": "₋",
};
/** Plain-text title with simple inline LaTeX such as `$\pi_{0.5}$` shown as `π₀.₅`. */
export const displayTitle = (title: string) =>
  title.replace(/\$([^$]+)\$/g, (whole, tex: string) => {
    const text = tex
      .replace(/\\([a-zA-Z]+)/g, (m, name: string) => GREEK[name] ?? m)
      .replace(/_\{([^}]*)\}|_(\S)/g, (m, group?: string, one?: string) => {
        const sub = group ?? one ?? "";
        return [...sub].every((c) => SUB[c]) ? [...sub].map((c) => SUB[c]).join("") : m;
      });
    return /[\\{}^_]/.test(text) ? whole : text;
  });
export const readingLabel = {
  unread: "未读",
  reading: "阅读中",
  completed: "已完成",
};
export const analysisLabel = {
  not_analyzed: "待分析",
  analyzing: "分析中",
  ready: "报告就绪",
  failed: "分析失败",
  needs_review: "待复核",
};
export const ideaStatusLabel = {
  new: "新想法",
  exploring: "验证中",
  parked: "暂缓",
  dropped: "放弃",
};
const TOPICS = [
  "VLA",
  "World Model",
  "Diffusion / Flow Matching",
  "视频生成",
  "推理加速",
  "LLM 推理与 RL",
  "Transformer / LLM / VLM",
  "具身机器人",
  "计算机视觉",
];
const lineKind = { idea: "Idea", direction: "方向" };
const paperKey = (p: Paper) => `${p.paper_id}/${p.version}`;
const backupTime = (iso: string) => {
  const d = new Date(iso);
  const day = d.toDateString() === new Date().toDateString() ? "今天" : `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${day} ${d.toTimeString().slice(0, 5)}`;
};
const ARXIV =
  /^(?:https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?\/?$/i;
type View = "library" | "recent" | "ideas" | "graph";
const greeting = () => {
  const h = new Date().getHours();
  return h < 5
    ? "夜深了"
    : h < 11
      ? "早上好"
      : h < 14
        ? "中午好"
        : h < 18
          ? "下午好"
          : "晚上好";
};
/** Opening the reader directly on a given tab (e.g. Study from the idea list). */
export function openOnTab(p: Paper, tab: string) {
  const key = `paperlab.reader.${p.paper_id}.${p.version}`;
  writeLocal(key, { ...readLocal(key, {}), tab });
}
export default function Library({ onOpen }: { onOpen: (p: Paper, focus?: "study", page?: number) => void }) {
  const [papers, setPapers] = useState<Paper[]>([]),
    [study, setStudy] = useState<StudyOverview>({ papers: {}, ideas: [] }),
    [warnings, setWarnings] = useState<string[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(""),
    [topic, setTopic] = useState(""),
    [lines, setLines] = useState<ResearchLine[]>([]),
    [line, setLine] = useState(""),
    [backup, setBackup] = useState<BackupStatus | null>(null),
    [backingUp, setBackingUp] = useState(false),
    [year, setYear] = useState(""),
    [status, setStatus] = useState(""),
    [view, setView] = useState<View>("library"),
    [list, setList] = useState(false),
    [importOpen, setImportOpen] = useState<null | "arxiv" | "pdf">(null),
    [quickBusy, setQuickBusy] = useState(false),
    [quickError, setQuickError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const r = await api<{ papers: Paper[]; warnings: string[] }>(
        "/api/papers",
      );
      setPapers(r.papers);
      setWarnings(r.warnings);
      // Study progress is optional decoration; never block the library on it.
      api<StudyOverview>("/api/study/overview")
        .then(setStudy)
        .catch(() => {});
      api<{ lines: ResearchLine[] }>("/api/lines")
        .then((r) => setLines(r.lines))
        .catch(() => {});
      api<BackupStatus>("/api/backup")
        .then(setBackup)
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const arxivMatch = query.trim().match(ARXIV);
  const activeLine = lines.find((l) => l.id === line);
  const linePos = (p: Paper) =>
    activeLine ? activeLine.papers.findIndex((x) => x.key === paperKey(p)) : -1;
  const filtered = papers.filter(
    (p) =>
      (!query ||
        `${p.title} ${p.authors.join(" ")} ${p.paper_id} ${p.doi || ""} ${p.topics.join(" ")}`
          .toLowerCase()
          .includes(
            (arxivMatch ? arxivMatch[1].replace(/v\d+$/, "") : query)
              .trim()
              .toLowerCase(),
          )) &&
      (!topic || p.topics.includes(topic)) &&
      (!activeLine || linePos(p) >= 0) &&
      (!year || String(p.year) === year) &&
      (!status || p.reading_status === status) &&
      (view !== "recent" || p.last_opened_at),
  );
  // Inside a research line, papers follow the line's reading order.
  if (activeLine) filtered.sort((a, b) => linePos(a) - linePos(b));
  const pickLine = (id: string) => {
    setLine(id);
    setTopic("");
    if (view === "ideas" || view === "graph") setView("library");
  };
  const backupNow = async () => {
    setBackingUp(true);
    try {
      setBackup(await api<BackupStatus>("/api/backup", { method: "POST" }));
    } catch (e) {
      setBackup((b) => b && { ...b, error: (e as Error).message });
    } finally {
      setBackingUp(false);
    }
  };
  const topics = [...new Set([...TOPICS, ...papers.flatMap((p) => p.topics)])];
  const summary = (p: Paper): StudySummary | undefined =>
    study.papers[`${p.paper_id}/${p.version}`];
  const recentPaper = useMemo(
    () =>
      [...papers]
        .filter((p) => p.last_opened_at && p.reading_status !== "completed")
        .sort((a, b) => b.last_opened_at!.localeCompare(a.last_opened_at!))[0],
    [papers],
  );
  const mastered = Object.values(study.papers).reduce(
    (n, s) => n + s.tests_mastered,
    0,
  );
  const answered = Object.values(study.papers).reduce(
    (n, s) => n + s.tests_answered,
    0,
  );
  const quickImport = async (reference: string) => {
    setQuickBusy(true);
    setQuickError("");
    try {
      const p = await api<Paper>("/api/import/arxiv", {
        method: "POST",
        body: JSON.stringify({ reference }),
      });
      setQuery("");
      void load();
      onOpen(p);
    } catch (e) {
      setQuickError((e as Error).message);
    } finally {
      setQuickBusy(false);
    }
  };
  const commands = useMemo<CommandSource>(
    () => ({
      commands: [
        {
          id: "import",
          group: "文献库",
          label: "导入论文（arXiv / 本地 PDF）",
          keywords: "import add arxiv pdf 上传",
          run: () => setImportOpen("arxiv"),
        },
        {
          id: "ideas",
          group: "文献库",
          label: "打开想法本",
          keywords: "ideas notebook 想法",
          run: () => setView("ideas"),
        },
        ...papers.map((p) => ({
          id: `open-${p.paper_id}${p.version}`,
          group: "打开论文",
          label: displayTitle(p.title),
          keywords: `${p.paper_id} ${p.authors.join(" ")} ${p.topics.join(" ")}`,
          run: () => onOpen(p),
        })),
      ],
    }),
    [papers, onOpen],
  );
  useCommands(commands);
  return (
    <div className="library-layout">
      <aside className="library-sidebar">
        <nav aria-label="文献库视图">
          <button
            className={view === "library" ? "active" : ""}
            onClick={() => setView("library")}
          >
            <BookOpen size={17} />
            我的文献库 <span>{papers.length}</span>
          </button>
          <button
            className={view === "recent" ? "active" : ""}
            onClick={() => setView("recent")}
          >
            <Clock3 size={17} />
            最近阅读{" "}
            <span>{papers.filter((p) => p.last_opened_at).length}</span>
          </button>
          <button
            className={view === "ideas" ? "active" : ""}
            onClick={() => setView("ideas")}
          >
            <Lightbulb size={17} />
            想法本 <span>{study.ideas.length}</span>
          </button>
          <button
            className={view === "graph" ? "active" : ""}
            onClick={() => setView("graph")}
          >
            <Network size={17} />
            知识图谱
          </button>
        </nav>
        {lines.length > 0 && (
          <>
            <div className="side-section-title">
              研究线 <span>{lines.length}</span>
            </div>
            {lines.map((l) => (
              <button
                key={l.id}
                className={`topic-nav line-nav ${line === l.id ? "selected" : ""}`}
                title={l.question}
                onClick={() => pickLine(line === l.id ? "" : l.id)}
              >
                <Milestone size={15} />
                <span className="line-nav-name">
                  {l.name}
                  <em className={l.kind}>{lineKind[l.kind]}</em>
                </span>
                <small>{l.papers.length}</small>
              </button>
            ))}
          </>
        )}
        <div className="side-section-title">
          技术标签 <span>{topics.length}</span>
        </div>
        <button
          className={`topic-nav ${!topic && !line ? "selected" : ""}`}
          onClick={() => {
            setTopic("");
            setLine("");
          }}
        >
          <FolderOpen size={15} />
          全部论文
        </button>
        {topics.map((t, i) => (
          <button
            key={t}
            className={`topic-nav ${topic === t ? "selected" : ""}`}
            onClick={() => {
              setTopic(t);
              setLine("");
              if (view === "ideas" || view === "graph") setView("library");
            }}
          >
            <span className={`topic-dot color-${i % 4}`} />
            {t}
            <small>
              {papers.filter((p) => p.topics.includes(t)).length || ""}
            </small>
          </button>
        ))}
        <div className="sidebar-bottom">
          <HardDrive size={16} />
          <div>
            <strong>你的研究，保存在本机</strong>
            <p>PDF、报告、笔记与学习记录 · 无需 API</p>
            {backup && (
              <p className="backup-line" title={`备份位置：${backup.dir}`}>
                {backup.error
                  ? `备份失败：${backup.error}`
                  : backup.last
                    ? `已备份 ${backupTime(backup.last.created_at)} · 保留 ${backup.count} 份`
                    : backup.auto ? "尚未备份" : "自动备份未开启"}
                <button disabled={backingUp} onClick={() => void backupNow()}>
                  {backingUp ? "备份中…" : "立即备份"}
                </button>
              </p>
            )}
          </div>
        </div>
      </aside>
      <main className="library-main">
        <section className="hero">
          <h1 className="greeting">
            <span className="greeting-spark" aria-hidden="true">
              ✻
            </span>
            把论文读懂，把研究写清
          </h1>
          <p className="library-new-intro">{greeting()}，{USER_NAME}。从一篇论文开始，逐步形成自己的理解与论证。</p>
          <div className={`composer ${arxivMatch ? "is-import" : ""}`}>
            <Search size={18} />
            <input
              aria-label="搜索文献"
              placeholder="搜索标题、作者、关键词，或粘贴 arXiv 链接直接导入…"
              value={query}
              disabled={quickBusy}
              onChange={(e) => {
                setQuery(e.target.value);
                setQuickError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && arxivMatch)
                  void quickImport(arxivMatch[1]);
                if (e.key === "Escape") setQuery("");
              }}
            />
            {query && !quickBusy && (
              <button
                className="icon-button"
                aria-label="清空搜索"
                onClick={() => setQuery("")}
              >
                <X size={15} />
              </button>
            )}
            <button
              className="icon-button"
              aria-label="上传本地 PDF"
              title="上传本地 PDF"
              onClick={() => setImportOpen("pdf")}
            >
              <Paperclip size={17} />
            </button>
            <button
              className="composer-send"
              aria-label={arxivMatch ? "导入这篇 arXiv 论文" : "打开导入对话框"}
              disabled={quickBusy}
              onClick={() =>
                arxivMatch
                  ? void quickImport(arxivMatch[1])
                  : setImportOpen("arxiv")
              }
            >
              {quickBusy ? (
                <RefreshCw size={16} className="spin" />
              ) : (
                <ArrowRight size={17} />
              )}
            </button>
          </div>
          <p className="composer-hint" role="status">
            {quickError ? (
              <span className="hint-error">{quickError}</span>
            ) : quickBusy ? (
              "正在获取原文并固定版本…"
            ) : arxivMatch ? (
              <>
                按 <kbd>Enter</kbd> 导入 arXiv {arxivMatch[1]}，导入后即可阅读
              </>
            ) : (
              <>
                按 <kbd>Ctrl K</kbd> 打开命令面板 · 拖入 PDF 请点{" "}
                <Paperclip size={11} />
              </>
            )}
          </p>
        </section>
        {view==="library"&&!query&&!topic&&<section className="research-launchpad" aria-label="开始科研任务">
          <a href="#/research?skill=nature-paper-xray"><span className="launch-number">01 / UNDERSTAND</span><h2>讲透一篇论文 <ArrowRight size={18}/></h2><p>设计为什么成立，公式怎样算，证据到哪里为止。</p></a>
          <a href="#/writing"><span className="launch-number">02 / DEVELOP</span><h2>写好一个论点 <ArrowRight size={18}/></h2><p>带上你的结果或草稿，让材料成为清楚的学术表达。</p></a>
          <a href="#/skills"><span className="launch-number">03 / EXPLORE</span><h2>找到研究工具 <ArrowRight size={18}/></h2><p>阅读、写作、引文、图表与汇报，22 项技能按需使用。</p></a>
        </section>}
        {recentPaper && view === "library" && !query && !topic && (
          <button className="continue-card" onClick={() => onOpen(recentPaper)}>
            <span className="continue-label">继续阅读</span>
            <strong>{displayTitle(recentPaper.title)}</strong>
            <StudyMeter
              paper={recentPaper}
              summary={summary(recentPaper)}
              detailed
            />
            <span className="continue-go">
              回到第{" "}
              {readLocal<{ page?: number }>(
                `paperlab.reader.${recentPaper.paper_id}.${recentPaper.version}`,
                {},
              ).page || 1}{" "}
              页 <ArrowUpRight size={15} />
            </span>
          </button>
        )}
        {view === "graph" ? (
          <KnowledgeGraph papers={papers} onOpen={(p) => onOpen(p)} />
        ) : view === "ideas" ? (
          <IdeasView
            overview={study}
            papers={papers}
            onOpen={(p) => {
              openOnTab(p, "study");
              onOpen(p);
            }}
          />
        ) : (
          <>
            <div className="stats-row">
              <Stat value={papers.length} label="收录论文" />
              <Stat
                value={
                  papers.filter((p) => p.reading_status === "reading").length
                }
                label="正在阅读"
              />
              <Stat
                value={
                  papers.filter((p) => p.reading_status === "completed").length
                }
                label="完成精读"
              />
              <Stat
                value={mastered}
                label={answered ? `验收掌握 · 共答 ${answered}` : "验收掌握"}
              />
            </div>
            <div className="library-heading">
              <h2>
                {view === "recent" ? "最近阅读" : activeLine ? activeLine.name : "我的文献库"}
                <span className="count-pill">{filtered.length}</span>
              </h2>
              <div className="library-tools">
                <select
                  aria-label="按年份筛选"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                >
                  <option value="">全部年份</option>
                  {[...new Set(papers.map((p) => p.year).filter(Boolean))]
                    .sort((a, b) => b! - a!)
                    .map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                </select>
                <select
                  aria-label="按阅读状态筛选"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">全部状态</option>
                  {Object.entries(readingLabel).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="view-switch">
                  <button
                    className={!list ? "active" : ""}
                    aria-label="卡片视图"
                    onClick={() => setList(false)}
                  >
                    <Grid2X2 size={16} />
                  </button>
                  <button
                    className={list ? "active" : ""}
                    aria-label="列表视图"
                    onClick={() => setList(true)}
                  >
                    <List size={17} />
                  </button>
                </div>
                <button
                  className="icon-button"
                  aria-label="刷新文献库"
                  title="刷新文献库"
                  onClick={() => void load()}
                >
                  <RefreshCw size={15} />
                </button>
                <button
                  className="primary"
                  onClick={() => setImportOpen("arxiv")}
                >
                  <Plus size={16} />
                  导入论文
                </button>
              </div>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                {error}
                <button onClick={() => void load()}>重试</button>
              </div>
            )}
            {warnings.map((w) => (
              <div className="warning-banner" key={w}>
                {w}
              </div>
            ))}
            {activeLine && (
              <section className={`line-brief ${activeLine.kind}`} aria-label="研究线说明">
                <div className="line-brief-head">
                  <span>{activeLine.kind === "idea" ? "IDEA · 研究线" : "方向 · 研究线"}</span>
                  {activeLine.status && <em>{activeLine.status}</em>}
                </div>
                <p>{activeLine.question}</p>
                <small>按下面的顺序读；每张卡片写了这篇在这条线上的作用。</small>
              </section>
            )}
            {loading ? (
              <div className="empty-state">正在读取本地文献…</div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <FolderOpen size={32} />
                <h3>{papers.length ? "没有匹配的论文" : "从第一篇论文开始"}</h3>
                <p>
                  {arxivMatch
                    ? "文献库里还没有这篇，按 Enter 直接导入。"
                    : papers.length
                      ? query.trim().length >= 2
                        ? "标题、作者和标签里没有匹配；下面是知识库里提到它的内容。"
                        : "试试其他关键词或调整筛选条件。"
                      : "在上方粘贴 arXiv 链接，或上传本地 PDF。"}
                </p>
                {!arxivMatch && (
                  <button
                    className="secondary"
                    onClick={() =>
                      papers.length
                        ? (setQuery(""),
                          setTopic(""),
                          setLine(""),
                          setYear(""),
                          setStatus(""),
                          setView("library"))
                        : setImportOpen("arxiv")
                    }
                  >
                    {papers.length ? "清除筛选" : "导入论文"}
                  </button>
                )}
              </div>
            ) : (
              <div className={list ? "papers-list" : "papers-grid"}>
                {filtered.map((p) => (
                  // The card body opens the paper; the footer holds its own two actions,
                  // so no button is nested inside another.
                  <article className="paper-card" key={p.paper_id + p.version}>
                    <button className="paper-card-body" onClick={() => onOpen(p)}>
                    <div className="card-top">
                      <span className="paper-kind">
                        <FileText size={13} />
                        {p.paper_id.startsWith("local-") ? "本地文献" : "arXiv"}
                        <span>{p.version}</span>
                      </span>
                      <span className={`status-dot ${p.reading_status}`}>
                        {readingLabel[p.reading_status]}
                      </span>
                    </div>
                    <h2>{displayTitle(p.title)}</h2>
                    {activeLine && activeLine.papers[linePos(p)] && (
                      <div className="line-role">
                        <b>{linePos(p) + 1}</b>
                        <div>
                          <strong>{activeLine.papers[linePos(p)].role}</strong>
                          <span>{activeLine.papers[linePos(p)].why}</span>
                        </div>
                      </div>
                    )}
                    <p className="authors">
                      {p.authors.length
                        ? p.authors.slice(0, 3).join(" · ") +
                          (p.authors.length > 3 ? " 等" : "")
                        : "作者信息未提供"}
                    </p>
                    <div className="paper-id">
                      {p.year || "年份未标注"}
                      <span>·</span>
                      {p.paper_id.startsWith("local-")
                        ? "本地 PDF"
                        : p.paper_id}
                      <span>·</span>
                      {p.page_count} 页
                    </div>
                    <div className="topic-tags">
                      {p.topics.length ? (
                        p.topics.map((t) => <span key={t}>{t}</span>)
                      ) : (
                        <span>未分类</span>
                      )}
                    </div>
                    <StudyMeter paper={p} summary={summary(p)} />
                    </button>
                    <div className="card-footer">
                      <div className="card-footer-left">
                        <span className={`analysis-badge ${p.analysis_status}`}>
                          <span />
                          {analysisLabel[p.analysis_status]}
                        </span>
                        <CardBrief paper={p} lines={lines} />
                      </div>
                      <div className="card-actions">
                        <button
                          className="open-study"
                          title="直接打开这篇论文的自测题、研究判断和想法：看看自己学到了什么"
                          onClick={() => onOpen(p, "study")}
                        >
                          <Lightbulb size={14} />
                          自测与思考
                          {!!summary(p)?.ideas && <span>{summary(p)?.ideas}</span>}
                        </button>
                        <button className="open-paper" onClick={() => onOpen(p)}>
                          进入精读 <ArrowUpRight size={15} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <KnowledgeHits query={query} papers={papers} onOpen={onOpen} />
            <div className="library-help">
              <Terminal size={18} />
              <div>
                <strong>让 AI 为论文生成有据可查的研究报告</strong>
                <p>
                  导入后进入论文，打开“Codex 工作台”生成报告和译文；也可手动运行
                  Claude Code <code>/paper 论文ID</code> 或 Codex{" "}
                  <code>$paper 论文ID</code>。
                </p>
              </div>
            </div>
          </>
        )}
        <footer className="library-footer">
          <span>PaperLab · Personal AI Research Workspace</span>
          <span>
            <span className="live-dot" />
            本地优先，专注研究
          </span>
        </footer>
      </main>
      {importOpen && (
        <ImportDialog
          initialTab={importOpen}
          initialReference={arxivMatch ? arxivMatch[1] : ""}
          onClose={() => setImportOpen(null)}
          onImported={(p) => {
            setImportOpen(null);
            void load();
            onOpen(p);
          }}
        />
      )}
    </div>
  );
}
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}
/** Three-pass reading progress plus self-test mastery and Li Mu's value score. */
export function StudyMeter({
  paper,
  summary,
  detailed = false,
}: {
  paper: Paper;
  summary?: StudySummary;
  detailed?: boolean;
}) {
  const passes = summary?.passes || [];
  if (!summary && !detailed) return <div className="study-meter empty" />;
  return (
    <div className="study-meter" aria-label="学习进度">
      <span className="pass-bar" title="三遍阅读进度">
        {[1, 2, 3].map((n) => (
          <i key={n} className={passes.includes(n) ? "done" : ""} />
        ))}
      </span>
      <span>{passes.length ? `第 ${Math.max(...passes)} 遍` : "未开始"}</span>
      {summary && summary.tests_answered > 0 && (
        <span>
          验收 {summary.tests_mastered}/{summary.tests_answered}
        </span>
      )}
      {summary?.value_score != null && (
        <span title="新意度 × 有效性 × 问题大小（李沐的论文价值判断）">
          价值 {summary.value_score}
        </span>
      )}
      {detailed && <span>{paper.page_count} 页</span>}
    </div>
  );
}
function IdeasView({
  overview,
  papers,
  onOpen,
}: {
  overview: StudyOverview;
  papers: Paper[];
  onOpen: (p: Paper) => void;
}) {
  return (
    <section className="ideas-view">
      <div className="library-heading">
        <h2>
          想法本 <span className="count-pill">{overview.ideas.length}</span>
        </h2>
      </div>
      <p className="section-intro">
        读论文时冒出的问题、缺失的消融、可以换个做法的地方，都记在这里。Schulman
        的建议是持续写研究笔记，回头看哪些想法反复出现。
      </p>
      {overview.ideas.length === 0 ? (
        <div className="empty-state">
          <Lightbulb size={30} />
          <h3>还没有想法</h3>
          <p>在阅读器的 Study 标签里随手记下，或选中原文后按 Ctrl K 记录。</p>
        </div>
      ) : (
        <div className="idea-feed">
          {overview.ideas.map((idea) => {
            const p = papers.find(
              (x) => x.paper_id === idea.paper_id && x.version === idea.version,
            );
            return (
              <article key={idea.idea_id} className="idea-row">
                <span className={`idea-status ${idea.status}`}>
                  {ideaStatusLabel[idea.status]}
                </span>
                <p>{idea.text}</p>
                <footer>
                  {p ? (
                    <button className="text-button" onClick={() => onOpen(p)}>
                      {displayTitle(idea.title)}
                      <ArrowUpRight size={12} />
                    </button>
                  ) : (
                    <span>{displayTitle(idea.title)}</span>
                  )}
                  {idea.source && <span>· {idea.source}</span>}
                  <span>
                    · {new Date(idea.created_at).toLocaleDateString("zh-CN")}
                  </span>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
function ImportDialog({
  initialTab,
  initialReference,
  onClose,
  onImported,
}: {
  initialTab: "arxiv" | "pdf";
  initialReference: string;
  onClose: () => void;
  onImported: (p: Paper) => void;
}) {
  const [tab, setTab] = useState<"arxiv" | "pdf">(initialTab),
    [reference, setReference] = useState(initialReference),
    [file, setFile] = useState<File | null>(null),
    [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      let p: Paper;
      if (tab === "arxiv")
        p = await api<Paper>("/api/import/arxiv", {
          method: "POST",
          body: JSON.stringify({ reference }),
        });
      else {
        if (!file) throw new Error("请先选择 PDF 文件");
        const body = new FormData();
        body.append("file", file);
        body.append("title", title);
        p = await api<Paper>("/api/import/pdf", { method: "POST", body });
      }
      onImported(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="导入论文"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="segmented">
        <button
          disabled={busy}
          className={tab === "arxiv" ? "active" : ""}
          onClick={() => setTab("arxiv")}
        >
          arXiv ID / URL
        </button>
        <button
          disabled={busy}
          className={tab === "pdf" ? "active" : ""}
          onClick={() => setTab("pdf")}
        >
          本地 PDF
        </button>
      </div>
      {tab === "arxiv" ? (
        <>
          <label className="field-label">
            论文标识或链接
            <input
              autoFocus
              placeholder="2410.24164v4 或 https://arxiv.org/abs/…"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && reference.trim() && !busy) void run();
              }}
              disabled={busy}
            />
          </label>
          <p className="muted">
            可指定版本；未指定时会确认并固定当前版本。PDF 和可获取的 LaTeX
            源码会保存到本机。
          </p>
        </>
      ) : (
        <>
          <label
            className="drop-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) setFile(e.dataTransfer.files[0] || null);
            }}
          >
            <Upload size={24} />
            <strong>{file ? file.name : "点击选择或拖入 PDF"}</strong>
            <span>最大 100 MB · 不支持加密文件</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              aria-label="选择 PDF"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <label className="field-label">
            论文标题（可选）
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="优先从 PDF 元数据读取"
              disabled={busy}
            />
          </label>
        </>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <span className="muted">
          {busy ? "正在获取原文，请稍候…" : "导入后可立即阅读，无需 AI 分析"}
        </span>
        <button
          className="primary"
          disabled={busy || (tab === "arxiv" ? !reference.trim() : !file)}
          onClick={() => void run()}
        >
          {busy ? <RefreshCw size={16} className="spin" /> : <Plus size={16} />}{" "}
          {busy ? "正在导入" : "导入论文"}
        </button>
      </div>
    </Modal>
  );
}
