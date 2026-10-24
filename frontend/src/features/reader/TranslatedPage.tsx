import { useEffect, useState } from "react";
import { RefreshCw, Languages } from "lucide-react";
import { api, base } from "../../api";
import type { Paper } from "../../types";
import Markdown from "../../components/Markdown";
export type Job = {
  job_id: string;
  kind: string;
  page: number | null;
  status: string;
  progress: number;
  total: number;
  message: string;
  created_at: string;
  receipt?: { engine: string; auth?: string } | null;
};
type PageData = {
  source: {
    page: number;
    limited: boolean;
    segments: { id: string; source: string }[];
  };
  translation: {
    generated_at: string;
    receipt: { engine: string; auth: string };
    segments: { id: string; source: string; translation: string }[];
  } | null;
};
export default function TranslatedPage({
  paper,
  page,
  mode,
  onOriginal,
}: {
  paper: Paper;
  page: number;
  mode: "zh" | "bilingual";
  onOriginal: () => void;
}) {
  const [data, setData] = useState<PageData | null>(null),
    [job, setJob] = useState<Job | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    [active, setActive] = useState<string | null>(null);
  useEffect(() => setActive(null), [mode, page]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    setData(null);
    setError("");
    setJob(null);
    setBusy(true);
    const run = async () => {
      try {
        const value = await api<PageData>(
          `${base(paper.paper_id, paper.version)}/reading/${page}`,
        );
        if (stopped) return;
        setData(value);
        if (value.translation || value.source.limited) {
          setBusy(false);
          return;
        }
        const task = await api<Job>(
          `${base(paper.paper_id, paper.version)}/jobs`,
          {
            method: "POST",
            body: JSON.stringify({ kind: "translate_page", page }),
          },
        );
        if (stopped) return;
        setJob(task);
        const poll = async () => {
          try {
            const r = await api<{ jobs: Job[] }>(
              `${base(paper.paper_id, paper.version)}/jobs`,
            );
            if (stopped) return;
            const current = r.jobs.find((j) => j.job_id === task.job_id);
            if (!current) throw new Error("翻译任务记录丢失，请重试");
            setJob(current);
            if (current.status === "completed") {
              const result = await api<PageData>(
                `${base(paper.paper_id, paper.version)}/reading/${page}`,
              );
              if (stopped) return;
              if (!result.translation)
                throw new Error("任务结束但没有可读取的译文，请重试");
              setData(result);
              setBusy(false);
            } else if (["failed", "cancelled"].includes(current.status)) {
              setBusy(false);
              setError(current.message);
            } else timer = setTimeout(() => void poll(), 2000);
          } catch (e) {
            if (!stopped) {
              setError((e as Error).message);
              setBusy(false);
            }
          }
        };
        void poll();
      } catch (e) {
        if (!stopped) {
          setError((e as Error).message);
          setBusy(false);
        }
      }
    };
    void run();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [paper.paper_id, paper.version, page, retry]);
  return (
    <div className="translated-page" onMouseUp={() => {}}>
      <div className="translation-heading">
        <Languages size={17} />
        <strong>
          第 {page} 页 · {mode === "zh" ? "中文译文" : "中英对照"}
        </strong>
        <button className="text-button" onClick={onOriginal}>
          查看原始 PDF
        </button>
      </div>
      <p className="translation-disclosure">
        按页重排的 AI 译文 · 图表、版式及公式以原始 PDF 为准。首次切换自动使用
        Codex 订阅翻译本页，保存后可离线读取。
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setRetry((r) => r + 1)}>重试</button>
        </div>
      )}
      {busy && (
        <div className="translation-progress" role="status">
          <RefreshCw size={18} className="spin" />
          <strong>{job?.message || "正在读取原文与本地译文…"}</strong>
          <span>
            可以继续阅读原文或打开 Codex
            工作台查看任务。切换页面不会删除已生成的译文。
          </span>
        </div>
      )}
      {data?.source.limited && (
        <div className="warning-banner">
          此页文本层不足，暂不能可靠翻译。请查看原始 PDF；本功能未执行 OCR。
        </div>
      )}
      {data?.translation ? (
        <>
          <div className="translation-provenance">
            Codex 翻译 ·{" "}
            {new Date(data.translation.generated_at).toLocaleString("zh-CN")} ·
            已保存到本机
          </div>
          {data.translation.segments.map((s) => (
            <article
              className={`translation-segment ${mode === "bilingual" ? "bilingual" : ""} ${active === s.id ? "active" : ""}`}
              key={s.id}
              title={mode === "zh" ? "点击查看这段的英文原文" : "点击固定高亮这一段"}
              onClick={() => {
                // Leave text selection (and the selection translator) alone.
                if (getSelection()?.toString().trim()) return;
                setActive((a) => (a === s.id ? null : s.id));
              }}
            >
              {(mode === "bilingual" || active === s.id) && (
                <div className="original-segment">
                  <span>EN · 原文</span>
                  <p>{s.source}</p>
                </div>
              )}
              <div className="chinese-segment">
                <span>中文译文</span>
                <Markdown>{s.translation}</Markdown>
              </div>
            </article>
          ))}
        </>
      ) : (
        data &&
        !busy && (
          <div className="source-fallback">
            {data.source.segments.map((s) => (
              <p key={s.id}>{s.source}</p>
            ))}
          </div>
        )
      )}
    </div>
  );
}
