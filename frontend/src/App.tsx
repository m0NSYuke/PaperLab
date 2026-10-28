import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Command as CommandIcon, Moon, Sun, ShieldCheck } from "lucide-react";
import Library from "./pages/Library";
const Reader = lazy(() => import("./pages/Reader"));
const ResearchWorkspace = lazy(() => import("./pages/ResearchWorkspace"));
const Memos = lazy(() => import("./pages/Memos"));
import "./features/research/research.css";
import { api, base, readLocal, USER_NAME, writeLocal } from "./api";
import type { Paper } from "./types";
import { setPaperTone, usePaperTone } from "./paperTone";
import CommandPalette, {
  CommandContext,
  type CommandSource,
} from "./components/CommandPalette";
// Renamed when the dark theme became Anthropic black, so everyone lands on it once.
const THEME_KEY = "paperlab.theme.v2";

export default function App() {
  const [paper, setPaper] = useState<Paper | null>(null),
    [route, setRoute] = useState(location.hash),
    [routeLoading, setRouteLoading] = useState(false),
    [routeError, setRouteError] = useState(""),
    [dirty, setDirty] = useState(false),
    [theme, setTheme] = useState(() => readLocal(THEME_KEY, "dark")),
    [palette, setPalette] = useState(false),
    [pageSource, setPageSource] = useState<CommandSource>({ commands: [] });
  const paperTone = usePaperTone();
  const dirtyRef = useRef(dirty),
    routeRef = useRef(location.hash);
  dirtyRef.current = dirty;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeLocal(THEME_KEY, theme);
  }, [theme]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    const route = () => {
      const next = location.hash;
      if (dirtyRef.current && next !== routeRef.current) {
        if (!window.confirm("当前内容尚未保存。确定离开？")) {
          history.replaceState(null, "", routeRef.current || "#/");
          return;
        }
        dirtyRef.current = false;
        setDirty(false);
      }
      routeRef.current = next;
      setRoute(next);
      const m = location.hash.match(/^#\/paper\/([^/?]+)\/(v\d+)(?:\?.*)?$/);
      if (m) {
        setRouteLoading(true);
        void api<Paper>(base(decodeURIComponent(m[1]), m[2]))
          .then((p) => {
            if(location.hash!==next)return;
            setPaper(p);
            setRouteError("");
          })
          .catch((e) => {
            if(location.hash!==next)return;
            setPaper(null);
            setRouteError(e.message);
          }).finally(()=>{if(location.hash===next)setRouteLoading(false);});
      } else {
        setPaper(null);
        setRouteLoading(false);
        setRouteError("");
      }
    };
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);
  /** `focus: "study"` opens the paper straight at its self-test and reflections; `page` at a PDF page. */
  const open = (p: Paper, focus?: "study", page?: number) => {
    setPaper(p);
    const query = new URLSearchParams();
    if (focus) query.set("focus", focus);
    if (page) query.set("page", String(page));
    location.hash = `/paper/${encodeURIComponent(p.paper_id)}/${p.version}${query.toString() ? `?${query}` : ""}`;
  };
  const globalSource = useMemo<CommandSource>(
    () => ({
      commands: [
        {
          id: "theme",
          group: "外观",
          label: theme === "light" ? "切换到深色主题" : "切换到浅色主题",
          keywords: "theme dark light 主题",
          run: () => setTheme(theme === "light" ? "dark" : "light"),
        },
        {
          id: "paper-tone",
          group: "外观",
          label: paperTone === "sepia" ? "纸张背景改为白色" : "纸张背景改为米黄护眼",
          keywords: "paper sepia eye care background 护眼 米黄 纸张 背景",
          run: () => setPaperTone(paperTone === "sepia" ? "white" : "sepia"),
        },
        {
          id: "memos",
          group: "导航",
          label: "打开随记",
          keywords: "memos ideas notes 随记 想法 笔记",
          run: () => {
            location.hash = "/memos";
          },
        },
        ...(paper
          ? [
              {
                id: "library",
                group: "导航",
                label: "返回文献库",
                keywords: "home library 首页",
                run: () => {
                  location.hash = "/";
                },
              },
            ]
          : []),
      ],
    }),
    [theme, paperTone, paper],
  );
  const path = route.split("?")[0];
  const params = new URLSearchParams(route.split("?")[1]||"");
  const researchRoute = ["#/writing","#/research","#/skills","#/outputs"].includes(path);
  const memosRoute = path === "#/memos";
  // The reader brings its own compact bar, so the paper gets the full height.
  const readerRoute = path.startsWith("#/paper/");
  return (
    <CommandContext.Provider value={setPageSource}>
      {!readerRoute && <header className="app-header">
        <a
          className="brand"
          href="#/"
        >
          <BrandMark />
          <strong>PaperLab</strong>
          <span className="version-tag">Research</span>
        </a>
        <span className="header-caption">你的个人科研工作台</span>
        <div className="header-right">
          <button
            className="command-trigger"
            onClick={() => setPalette(true)}
            aria-label="打开命令面板"
          >
            <CommandIcon size={14} />
            <span>搜索或跳转</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="local-label" title="所有数据保存在本机文件中">
            <ShieldCheck size={14} />
            本地私有
          </span>
          <button
            className="icon-button theme-toggle"
            aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"}
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <span className="avatar" title={USER_NAME}>
            {USER_NAME[0].toUpperCase()}
          </span>
        </div>
      </header>}
      {!paper&&!routeLoading&&<nav className="workspace-navigation" aria-label="科研工作区">
        <a href="#/" aria-current={!researchRoute&&!memosRoute?"page":undefined}>读论文<span>Library</span></a>
        <a href="#/memos" aria-current={memosRoute?"page":undefined}>随记<span>Memos</span></a>
        <a href="#/writing" aria-current={["#/writing","#/research"].includes(path)?"page":undefined}>写作台<span>Studio</span></a>
        <a href="#/skills" aria-current={path==="#/skills"?"page":undefined}>研究工具<span>Skills</span></a>
        <a href="#/outputs" aria-current={path==="#/outputs"?"page":undefined}>成果库<span>Outputs</span></a>
      </nav>}
      {routeError && (
        <div className="error-banner" role="alert">
          {routeError}
          <a href="#/">返回文献库</a>
        </div>
      )}
      {routeLoading ? <div className="empty-state" role="status">正在打开固定版本论文…</div> : paper ? (
        <Suspense
          fallback={<div className="empty-state">正在加载阅读工作台…</div>}
        >
          <Reader
            onDirtyChange={setDirty}
            key={paper.paper_id + paper.version}
            paper={paper}
            initialFocus={params.get("focus") === "study" ? "study" : undefined}
            initialPage={Number(params.get("page")) || undefined}
            onBack={() => {
              location.hash = "/";
              setPaper(null);
              setDirty(false);
            }}
          />
        </Suspense>
      ) : memosRoute ? (
        <Suspense fallback={<div className="empty-state">正在打开随记…</div>}>
          <Memos requested={params.get("id") || undefined} onDirtyChange={setDirty} />
        </Suspense>
      ) : researchRoute ? (
        <Suspense fallback={<div className="empty-state">正在打开科研工作台…</div>}>
          <ResearchWorkspace key={route} mode={path==="#/skills"?"skills":path==="#/outputs"?"outputs":"work"}
            requestedSkill={params.get("skill")||undefined} requestedJob={params.get("job")||undefined}
            sourcePaper={params.get("paper")||undefined} onDirtyChange={setDirty}/>
        </Suspense>
      ) : (
        <Library onOpen={open} />
      )}
      {palette && (
        <CommandPalette
          sources={[pageSource, globalSource]}
          onClose={() => setPalette(false)}
        />
      )}
    </CommandContext.Provider>
  );
}
/** A small spark-and-page mark; deliberately our own, not Anthropic's logo. */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="6" y="5" width="17" height="22" rx="3.5" />
      <path d="M10.5 12h8M10.5 16h8M10.5 20h5" />
      <path
        className="brand-spark"
        d="M24.5 3.5l1.1 3.1 3.1 1.1-3.1 1.1-1.1 3.1-1.1-3.1-3.1-1.1 3.1-1.1z"
      />
    </svg>
  );
}
