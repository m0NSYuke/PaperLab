import { useEffect, useRef, useState } from "react";
import { CheckCheck, Save, BookOpen, FileCode2, ImagePlus, Code2 } from "lucide-react";
import LiveEditor, { type LiveEditorHandle } from "./LiveEditor";
import { api, base } from "../../api";
import type { Correction, Paper } from "../../types";
import Markdown from "../../components/Markdown";
import { useHighlights } from "../highlight/highlights";
import "../highlight/highlight.css";
export default function Notes({
  paper,
  corrections,
  onDirty,
  onConcept,
  onJump,
}: {
  paper: Paper;
  corrections: Correction[];
  onDirty: (dirty: boolean) => void;
  onConcept: (slug: string) => void;
  onJump?: (page: number) => void;
}) {
  const highlights = useHighlights(paper);
  const [text, setText] = useState(""),
    [saved, setSaved] = useState(""),
    [etag, setEtag] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [source, setSource] = useState(false),
    [savedAt, setSavedAt] = useState("");
  const dirty = text !== saved;
  const editor = useRef<HTMLTextAreaElement>(null),
    live = useRef<LiveEditorHandle>(null),
    imageInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  /** Replaces the editor selection with `before + selected text + after`. */
  const insert = (before: string, after = "", placeholder = "") => {
    const el = editor.current;
    const start = el?.selectionStart ?? text.length,
      end = el?.selectionEnd ?? text.length;
    const middle = text.slice(start, end) || placeholder;
    setText(text.slice(0, start) + before + middle + after + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + before.length, start + before.length + middle.length);
    });
  };
  const block = (start: number) => (start > 0 && text[start - 1] !== "\n" ? "\n\n" : "");
  /** Saves images into the paper's note-assets folder; returns Markdown links. */
  const upload = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return [];
    setUploading(true);
    setError("");
    try {
      const links: string[] = [];
      for (const file of images) {
        const body = new FormData();
        body.append("file", file);
        const r = await api<{ path: string }>(`${base(paper.paper_id, paper.version)}/note-assets`, {
          method: "POST",
          body,
        });
        links.push(`![${file.name.replace(/\.[^.]+$/, "") || "图片"}](${r.path})`);
      }
      return links;
    } catch (e) {
      setError((e as Error).message);
      return [];
    } finally {
      setUploading(false);
    }
  };
  const addImages = async (files: File[]) => {
    const links = await upload(files);
    if (!links.length) return;
    if (!source) return live.current?.insertBlock(links.join("\n\n"));
    const at = editor.current?.selectionStart ?? text.length;
    insert(block(at) + links.join("\n\n") + "\n\n");
  };
  const current = useRef({ text, saved, etag });
  current.current = { text, saved, etag };
  useEffect(() => {
    let canceled = false;
    void api<{ content: string; etag: string }>(
      `${base(paper.paper_id, paper.version)}/notes`,
    )
      .then((n) => {
        if (!canceled) {
          setText(n.content);
          setSaved(n.content);
          setEtag(n.etag);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (!canceled) setError(e.message);
      });
    return () => {
      canceled = true;
    };
  }, [paper.paper_id, paper.version]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (current.current.text !== current.current.saved) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  const save = async () => {
    setBusy(true);
    setError("");
    const submitted = text;
    try {
      const n = await api<{ content: string; etag: string }>(
        `${base(paper.paper_id, paper.version)}/notes`,
        { method: "PUT", body: JSON.stringify({ content: submitted, etag }) },
      );
      setSaved(n.content);
      setEtag(n.etag);
      setSavedAt(new Date().toLocaleTimeString("zh-CN"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (loaded && !busy) void save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [text, etag, loaded, busy]);
  return (
    <div className="notes-content">
      <div className="section-eyebrow">07 / MAKE IT YOURS</div>
      <h2 className="section-title">记录你的理解</h2>
      <p className="section-intro">
        笔记直接保存为 Markdown 文件。你的思考和人工纠错在重新分析时始终保留。
      </p>
      <div className="notes-tools">
        <div className="segmented">
          <button
            className={!source ? "active" : ""}
            title="所见即所得：图片、代码、公式直接显示，点哪段改哪段"
            onClick={() => setSource(false)}
          >
            <BookOpen size={13} />
            编辑
          </button>
          <button
            className={source ? "active" : ""}
            title="查看和编辑 Markdown 原文"
            onClick={() => setSource(true)}
          >
            <FileCode2 size={13} />
            源码
          </button>
        </div>
        {(
          <div className="notes-insert">
            <button
              className="text-button"
              title="插入图片（也可以直接粘贴或拖入截图）"
              disabled={!loaded || uploading}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => imageInput.current?.click()}
            >
              <ImagePlus size={14} />
              {uploading ? "上传中…" : "图片"}
            </button>
            <button
              className="text-button"
              title="插入代码段"
              disabled={!loaded}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!source) return live.current?.insertBlock("```python\n\n```", { caret: 10 });
                const at = editor.current?.selectionStart ?? text.length;
                insert(block(at) + "```python\n", "\n```\n", "# 代码");
              }}
            >
              <Code2 size={14} />
              代码
            </button>
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              hidden
              onChange={(e) => {
                void addImages([...(e.target.files || [])]);
                e.target.value = "";
              }}
            />
          </div>
        )}
        <span className={dirty ? "unsaved" : "saved-indicator"}>
          {dirty
            ? "有未保存修改"
            : savedAt
              ? `${savedAt} 已保存`
              : "本地 Markdown"}
        </span>
      </div>
      {!source ? (
        <div className="notes-preview notes-live">
          <LiveEditor
            ref={live}
            text={text}
            onChange={setText}
            imageBase={base(paper.paper_id, paper.version)}
            disabled={!loaded}
            onImages={upload}
            placeholder="点这里开始记录你的理解。支持 Markdown、$LaTeX$ 公式、代码段，截图可直接粘贴。"
          />
        </div>
      ) : (
        <textarea
          ref={editor}
          className="notes-editor"
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              void addImages(files);
            }
          }}
          onDragOver={(e) => {
            if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) e.preventDefault();
          }}
          onDrop={(e) => {
            const files = [...e.dataTransfer.files];
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              void addImages(files);
            }
          }}
          aria-label="个人 Markdown 笔记"
          disabled={!loaded}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            "# 我的理解\n\n## 核心方法\n\n## 待解决问题\n- \n\n## 学习总结\n\n支持 Markdown、$LaTeX$ 公式、代码段；截图可直接粘贴进来。"
          }
        />
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="notes-save">
        <span>Ctrl / ⌘ + S 保存到文件</span>
        <button
          className="primary"
          onClick={() => void save()}
          disabled={!loaded || busy || !dirty}
        >
          {busy ? (
            <Save size={15} />
          ) : dirty ? (
            <Save size={15} />
          ) : (
            <CheckCheck size={15} />
          )}{" "}
          {busy ? "正在保存" : "保存笔记"}
        </button>
      </div>
      <h3 className="report-subheading">
        高亮与批注 <span className="count-pill">{highlights.length}</span>
      </h3>
      {!highlights.length ? (
        <p className="muted">
          在 PDF 原文中选中文字，在弹出卡片里点一个颜色即可高亮；点按已有高亮可写批注、改色或删除。
        </p>
      ) : (
        <div className="hl-list">
          {[...highlights]
            .sort((a, b) => a.page - b.page || a.rects[0].y - b.rects[0].y)
            .map((h) => (
              <button key={h.highlight_id} className={`hl-${h.color}`} onClick={() => onJump?.(h.page)}>
                <i className="hl-dot" />
                <span className="hl-text">{h.text}</span>
                <small>
                  p.{h.page}
                  {h.note && ` · ${h.note}`}
                </small>
              </button>
            ))}
        </div>
      )}
      <h3 className="report-subheading">
        纠错历史 <span className="count-pill">{corrections.length}</span>
      </h3>
      {!corrections.length ? (
        <p className="muted">
          发现报告问题时，点击解释旁的“标记问题”。每次修改都作为新事件保留。
        </p>
      ) : (
        <div className="corrections-history">
          {[...corrections].reverse().map((c) => (
            <article key={c.correction_id}>
              <div>
                <code>{c.claim_id}</code>
                <span>
                  {c.status === "accepted"
                    ? "已确认"
                    : c.status === "dismissed"
                      ? "已撤回"
                      : "待处理"}
                </span>
              </div>
              <Markdown>{c.corrected_text}</Markdown>
              {c.reason && <p className="muted">{c.reason}</p>}
              <small>
                {new Date(c.created_at).toLocaleString("zh-CN")} · {c.type}
              </small>
            </article>
          ))}
        </div>
      )}
      <button
        className="concept-inline"
        onClick={() => onConcept("flow-matching")}
      >
        <BookOpen size={15} />
        打开 Flow Matching 概念卡片
      </button>
    </div>
  );
}
