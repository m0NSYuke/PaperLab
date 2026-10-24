import { useEffect, useState } from "react";
import {
  CheckCircle2,
  RefreshCw,
  Terminal,
  Play,
  Copy,
  Square,
} from "lucide-react";
import Modal from "../../components/Modal";
import { api, base, copyText, paperCommand } from "../../api";
import type { Paper } from "../../types";
import type { Job } from "./TranslatedPage";
const labels: Record<string, string> = {
  check: "连接验证",
  analyze: "生成研究报告",
  translate_page: "逐页翻译",
  translate_all: "整篇翻译",
  prepare_sources: "RAP 源码准备",
};
const statuses: Record<string, string> = {
  queued: "排队中",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
export default function CodexWorkbench({
  paper,
  page,
  onClose,
  onReport,
  onAsk,
}: {
  paper: Paper;
  page: number;
  onClose: () => void;
  onReport: () => void;
  onAsk: () => void;
}) {
  const [status, setStatus] = useState<{
      installed: boolean;
      logged_in: boolean;
      message: string;
      gpt_authored?: string[];
    } | null>(null),
    [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState(""),
    [starting, setStarting] = useState(false),
    [copied, setCopied] = useState(false);
  const [sources, setSources] = useState<{
    mode: string; entrypoint: string | null; file_count: number;
    warnings: string[]; truncated: boolean; missing_includes: string[];
  } | null>(null);
  const gptAuthored=Boolean(status?.gpt_authored?.includes(paper.paper_id));
  const load = async () => {
    const r = await api<{ jobs: Job[] }>(
      `${base(paper.paper_id, paper.version)}/jobs`,
    );
    setJobs(r.jobs);
    setSources(await api<NonNullable<typeof sources>>(
      `${base(paper.paper_id, paper.version)}/sources`,
    ));
    if (r.jobs.some((j) => j.kind === "analyze" && j.status === "completed"))
      onReport();
  };
  useEffect(() => {
    void api<typeof status>("/api/automation/status")
      .then(setStatus)
      .catch((e) => setError(e.message));
    void load().catch((e) => setError(e.message));
    const timer = setInterval(
      () => void load().catch((e) => setError(e.message)),
      2500,
    );
    return () => clearInterval(timer);
  }, [paper.paper_id, paper.version]);
  const run = async (kind: string) => {
    setStarting(true);
    setError("");
    try {
      await api(`${base(paper.paper_id, paper.version)}/jobs`, {
        method: "POST",
        body: JSON.stringify({
          kind,
          ...(kind === "translate_page" ? { page } : {}),
        }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };
  const cancel = async (id: string) => {
    try {
      await api(`${base(paper.paper_id, paper.version)}/jobs/${id}/cancel`, {
        method: "POST",
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="GPT 问答与 Codex 工作台" wide onClose={onClose}>
      <div className="connection-card">
        <span className={status?.logged_in ? "live-dot" : "offline-dot"} />
        <strong>
          {status?.logged_in ? "Codex 已连接 ChatGPT 登录" : "Codex 连接状态"}
        </strong>
        <p>{status?.message || "正在检测本机 Codex CLI…"}</p>
        <span className="muted small">
          GPT 问答使用你自己的 ChatGPT 会话；Codex
          负责分析和翻译，结果标明来源。
        </span>
      </div>
      <div className="workbench-actions">
        <button className="primary" onClick={onAsk}>
          打开 GPT 提问与回答记录
        </button>
        <button
          className="secondary"
          disabled={!status?.logged_in || starting}
          onClick={() => void run("check")}
        >
          <CheckCircle2 size={15} />
          验证 Codex 连接
        </button>
      </div>
      <div className="workbench-jobs">
        <h3>让 Codex 处理当前论文</h3>
        <p className="muted">
          任务使用已登录的 Codex 订阅额度，无需 API
          Key。网页只允许下列固定操作，生成前保留已有笔记、学习记录和纠错。
        </p>
        <div className="connection-card" aria-label="RAP 源码状态">
          <strong>RAP · LaTeX 源码优先阅读</strong>
          <p>
            {sources
              ? sources.mode === "latex"
                ? `入口 ${sources.entrypoint} · ${sources.file_count} 个关联文件${sources.truncated ? " · 内容有截断" : ""}`
                : sources.mode === "ambiguous"
                  ? "存在多个主文件，当前按 PDF 分析"
                  : "当前按 PDF 分析，尚无可用 LaTeX 源码"
              : "正在检查源码…"}
          </p>
          <p className="muted small">
            分析时优先追踪源码中的公式和章节，PDF 用于核对页码、引文及最终版式。
            arXiv 仅获取已固定版本；本地 PDF 不猜测线上版本。
          </p>
          {sources?.warnings.map((message) => <p className="muted small" key={message}>{message}</p>)}
          <button className="secondary" disabled={starting} onClick={() => void run("prepare_sources")}>
            检查 / 获取 RAP 源码
          </button>
        </div>
        <div className="workbench-actions">
          <button
            className="primary"
            disabled={!status?.logged_in || starting || gptAuthored}
            onClick={() => void run("analyze")}
          >
            <Play size={14} />
            生成 / 更新研究报告
          </button>
          <button
            className="secondary"
            disabled={!status?.logged_in || starting}
            onClick={() => void run("translate_page")}
          >
            翻译当前页（{page}）
          </button>
          <button
            className="secondary"
            disabled={!status?.logged_in || starting}
            onClick={() => void run("translate_all")}
          >
            翻译整篇（{paper.page_count} 页）
          </button>
        </div>
        {gptAuthored&&<p className="muted small">这篇论文保留 GPT 撰写内容的既定分工；Codex 不会重新生成或覆盖报告。翻译、阅读和笔记仍可使用。</p>}
        <div className="command-line">
          <Terminal size={15} />
          <code>{paperCommand(paper)}</code>
          <button
            className="icon-button"
            aria-label="复制 Codex 命令"
            onClick={() =>
              void copyText(paperCommand(paper))
                .then(() => setCopied(true))
                .catch((e) => setError(e.message))
            }
          >
            {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
          </button>
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="job-history">
        <h3>任务记录</h3>
        {!jobs.length && (
          <p className="muted">
            还没有任务。点击“验证 Codex 连接”可检查真实模型调用是否成功。
          </p>
        )}
        {jobs.map((j) => (
          <article key={j.job_id}>
            <div>
              <strong>
                {labels[j.kind]}
                {j.page ? ` · 第 ${j.page} 页` : ""}
              </strong>
              <span className={`job-state ${j.status}`}>
                {statuses[j.status]}
              </span>
              {["queued", "running"].includes(j.status) && (
                <button
                  className="text-button"
                  onClick={() => void cancel(j.job_id)}
                >
                  <Square size={11} />
                  取消
                </button>
              )}
            </div>
            <p>{j.message}</p>
            {["queued", "running"].includes(j.status) && (
              <progress max={j.total} value={j.progress} />
            )}
            <small>
              {new Date(j.created_at).toLocaleString("zh-CN")} · {j.progress}/
              {j.total}
              {j.receipt?.engine === "codex-cli"
                ? " · 真实 Codex 执行回执"
                : ""}
            </small>
          </article>
        ))}
      </div>
    </Modal>
  );
}
