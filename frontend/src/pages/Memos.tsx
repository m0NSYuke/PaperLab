import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, FileCode2, ImagePlus, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import LiveEditor, { type LiveEditorHandle } from "../features/notes/LiveEditor";
import { useCommands, type CommandSource } from "../components/CommandPalette";
import { api } from "../api";
import "../features/memos/memos.css";

type MemoSummary = {
  id: string;
  title: string;
  created: string;
  updated: string;
  tags: string[];
  pinned: boolean;
  excerpt: string;
  search: string;
  images: number;
};
type Memo = { id: string; title: string; created: string; updated: string; tags: string[]; pinned: boolean; body: string; etag: string };
type Draft = Pick<Memo, "title" | "tags" | "pinned" | "body">;

const IMAGE_BASE = "/api/memos";
const SAVE_DELAY = 700;

function when(stamp: string) {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1 && new Date().getDate() === date.getDate()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (days < 7) return `${Math.max(1, days)} 天前`;
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (value: string) => {
    const tag = value.replace(/[,，#]/g, "").trim().slice(0, 32);
    if (tag && !tags.includes(tag) && tags.length < 12) onChange([...tags, tag]);
    setText("");
  };
  return (
    <div className="memo-tags">
      {tags.map((tag) => (
        <span key={tag} className="memo-tag">
          #{tag}
          <button type="button" aria-label={`删除标签 ${tag}`} onClick={() => onChange(tags.filter((t) => t !== tag))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={text}
        aria-label="添加标签"
        placeholder={tags.length ? "" : "添加标签，回车确认"}
        onChange={(e) => (/[,，]/.test(e.target.value) ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
      />
    </div>
  );
}

export default function Memos({ requested, onDirtyChange }: { requested?: string; onDirtyChange: (dirty: boolean) => void }) {
  const [list, setList] = useState<MemoSummary[] | null>(null),
    [query, setQuery] = useState(""),
    [memo, setMemo] = useState<Memo | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [state, setState] = useState<"saved" | "pending" | "saving" | "error">("saved"),
    [savedAt, setSavedAt] = useState(""),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [source, setSource] = useState(false),
    [uploading, setUploading] = useState(false),
    [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  /** The memo just created; its title field takes the focus. */
  const freshId = useRef("");
  const live = useRef<LiveEditorHandle>(null),
    sourceArea = useRef<HTMLTextAreaElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    timer = useRef(0),
    saving = useRef<Promise<void> | null>(null);
  // Latest values for the save loop, which runs outside React's render cycle.
  const latest = useRef({ memo, draft, conflict });
  latest.current = { memo, draft, conflict };

  const refresh = useCallback(async () => {
    const r = await api<{ memos: MemoSummary[] }>("/api/memos");
    setList(r.memos);
    return r.memos;
  }, []);

  // One request at a time, always the newest draft with the last etag; edits made
  // meanwhile schedule the next save.
  const save = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = 0;
    while (saving.current) await saving.current;
    const { memo: current, draft: next, conflict: blocked } = latest.current;
    if (!current || !next || blocked || sameAs(current, next)) return;
    setState("saving");
    saving.current = (async () => {
      try {
        const response = await fetch(`/api/memos/${current.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...next, etag: current.etag }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.status === 409) {
          setConflict(true);
          throw new Error(body.detail || "这条随记已在其他窗口修改。");
        }
        if (!response.ok) throw new Error(body.detail || `保存失败 (${response.status})`);
        const saved = body as Memo;
        setMemo((m) => (m && m.id === saved.id ? saved : m));
        latest.current.memo = saved;
        setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
        setError("");
        setState(sameAs(saved, latest.current.draft) ? "saved" : "pending");
        setList((items) => items && [summaryOf(saved), ...items.filter((i) => i.id !== saved.id)].sort(order));
      } catch (e) {
        setState("error");
        setError((e as Error).message === "Failed to fetch" ? "无法连接本地后端，内容还在这个页面里；恢复连接后会继续保存。" : (e as Error).message);
      } finally {
        saving.current = null;
      }
    })();
    await saving.current;
  }, []);

  const edit = (changes: Partial<Draft>) => {
    setDraft((d) => {
      const next = d && { ...d, ...changes };
      latest.current.draft = next;
      return next;
    });
    setState("pending");
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_DELAY);
  };

  const open = useCallback(
    async (id: string | null) => {
      await save();
      setError("");
      setConflict(false);
      setSource(false);
      if (!id) {
        setMemo(null);
        setDraft(null);
        return;
      }
      try {
        const m = await api<Memo>(`/api/memos/${id}`);
        setMemo(m);
        setDraft({ title: m.title, tags: m.tags, pinned: m.pinned, body: m.body });
        setState("saved");
        setSavedAt("");
      } catch (e) {
        setMemo(null);
        setDraft(null);
        setError((e as Error).message);
      }
    },
    [save],
  );

  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    void open(requested || null);
  }, [requested]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving PaperLab or this page: write what is pending; warn only if it could not be saved.
  useEffect(() => {
    onDirtyChange(state === "error");
  }, [state, onDirtyChange]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      const { memo: current, draft: next } = latest.current;
      if (!current || !next || sameAs(current, next)) return;
      void fetch(`/api/memos/${current.id}`, {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next, etag: current.etag }),
      });
      if (latest.current.conflict) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("beforeunload", leave);
      void save();
      onDirtyChange(false);
    };
  }, [save, onDirtyChange]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [save]);

  const go = (id: string | null) => {
    location.hash = id ? `/memos?id=${id}` : "/memos";
  };
  const create = async () => {
    await save();
    try {
      const m = await api<Memo>("/api/memos", { method: "POST", body: JSON.stringify({}) });
      setList((items) => [summaryOf(m), ...(items || [])].sort(order));
      freshId.current = m.id;
      location.hash = `/memos?id=${m.id}`;
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!memo) return;
    clearTimeout(timer.current);
    timer.current = 0;
    await saving.current;
    try {
      await api(`/api/memos/${memo.id}`, { method: "DELETE" });
      setUndo({ id: memo.id, title: draft?.title || "无标题随记" });
      latest.current.memo = null;
      setMemo(null);
      setDraft(null);
      setList((items) => items && items.filter((i) => i.id !== memo.id));
      go(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const restore = async () => {
    if (!undo) return;
    try {
      const m = await api<Memo>(`/api/memos/${undo.id}/restore`, { method: "POST" });
      setUndo(null);
      await refresh();
      go(m.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(t);
  }, [undo]);

  const upload = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return [];
    setUploading(true);
    try {
      const links: string[] = [];
      for (const file of images) {
        const body = new FormData();
        body.append("file", file);
        const r = await api<{ path: string }>("/api/memos/assets", { method: "POST", body });
        links.push(`![](${r.path})`);
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
    if (!links.length || !draft) return;
    if (!source) return live.current?.insertBlock(links.join("\n\n"));
    const el = sourceArea.current,
      at = el?.selectionStart ?? draft.body.length;
    const gap = at > 0 && draft.body[at - 1] !== "\n" ? "\n\n" : "";
    edit({ body: draft.body.slice(0, at) + gap + links.join("\n\n") + "\n\n" + draft.body.slice(at) });
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!list) return [];
    return q ? list.filter((m) => `${m.title} ${m.tags.join(" ")} ${m.search}`.toLowerCase().includes(q)) : list;
  }, [list, query]);

  const commands = useMemo<CommandSource>(
    () => ({
      commands: [
        { id: "memo-new", group: "随记", label: "新建随记", keywords: "new memo idea note 新建 随记 想法", run: () => void create() },
        ...(list || []).slice(0, 50).map((m) => ({
          id: `memo-${m.id}`,
          group: "随记",
          label: m.title || "无标题随记",
          keywords: `${m.tags.join(" ")} ${m.excerpt}`,
          run: () => go(m.id),
        })),
      ],
    }),
    [list], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useCommands(commands);

  const status =
    state === "saving" ? "保存中…" : state === "pending" ? "编辑中" : state === "error" ? "没有保存" : savedAt ? `已保存 · ${savedAt}` : "已保存到本地";

  return (
    <main className="memos-page" data-open={memo ? "" : undefined}>
      <aside className="memos-list" aria-label="随记列表">
        <div className="memos-list-head">
          <h1>随记</h1>
          <button className="primary memos-new" onClick={() => void create()}>
            <Plus size={15} />
            新建
          </button>
        </div>
        <label className="memos-search">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、标签和正文" aria-label="搜索随记" />
        </label>
        {list === null ? (
          <p className="muted memos-empty">正在读取…</p>
        ) : !list.length ? (
          <div className="memos-empty">
            <p>想法先记下来，不用想清楚。</p>
            <p className="muted">每条随记是数据目录里 memos 文件夹下的一个 Markdown 文件，截图可以直接粘贴。</p>
          </div>
        ) : !shown.length ? (
          <p className="muted memos-empty">没有找到「{query}」</p>
        ) : (
          <ul className="memos-items">
            {shown.map((m) => (
              <li key={m.id}>
                <a href={`#/memos?id=${m.id}`} aria-current={memo?.id === m.id ? "page" : undefined}>
                  <strong>
                    {m.pinned && <Pin size={11} className="memo-pin" aria-label="已置顶" />}
                    {(memo?.id === m.id ? draft?.title : m.title) || "无标题随记"}
                  </strong>
                  <span className="memo-excerpt">{m.excerpt || (m.images ? `${m.images} 张图片` : "空白")}</span>
                  <small>
                    {when(m.updated)}
                    {m.tags.slice(0, 3).map((t) => (
                      <i key={t}>#{t}</i>
                    ))}
                  </small>
                </a>
              </li>
            ))}
          </ul>
        )}
      </aside>
      {undo && (
        <div className="memo-undo" role="status">
          已删除「{undo.title}」
          <button className="text-button" onClick={() => void restore()}>
            撤销
          </button>
        </div>
      )}
      <section className="memo-editor" aria-label="编辑随记">
        {error && (
          <div className="error-banner" role="alert">
            {error}
            {conflict && (
              <button className="text-button" onClick={() => memo && void open(memo.id)}>
                重新载入
              </button>
            )}
          </div>
        )}
        {!memo || !draft ? (
          <div className="memo-blank">
            <BookOpen size={28} />
            <p>选一条随记，或新建一条。</p>
            <p className="muted">
              <kbd>Ctrl K</kbd> 输入「新建随记」也可以。
            </p>
          </div>
        ) : (
          <>
            <div className="memo-bar">
              <button className="icon-button memo-back" aria-label="返回随记列表" onClick={() => go(null)}>
                <ArrowLeft size={16} />
              </button>
              <span className={`memo-state ${state}`} aria-live="polite">
                {status}
              </span>
              <div className="segmented">
                <button className={!source ? "active" : ""} title="所见即所得：图片、公式直接显示，点哪段改哪段" onClick={() => setSource(false)}>
                  <BookOpen size={13} />
                  编辑
                </button>
                <button className={source ? "active" : ""} title="查看和编辑 Markdown 原文" onClick={() => setSource(true)}>
                  <FileCode2 size={13} />
                  源码
                </button>
              </div>
              <button
                className="icon-button"
                title="插入图片（也可以直接粘贴或拖入截图）"
                aria-label="插入图片"
                disabled={uploading}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => imageInput.current?.click()}
              >
                <ImagePlus size={16} />
              </button>
              <button className={`icon-button${draft.pinned ? " on" : ""}`} aria-pressed={draft.pinned} aria-label={draft.pinned ? "取消置顶" : "置顶"} title={draft.pinned ? "取消置顶" : "置顶"} onClick={() => edit({ pinned: !draft.pinned })}>
                {draft.pinned ? <PinOff size={16} /> : <Pin size={16} />}
              </button>
              <button className="icon-button" aria-label="删除这条随记" title="删除（可撤销）" onClick={() => void remove()}>
                <Trash2 size={16} />
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
            <input
              className="memo-title"
              value={draft.title}
              placeholder="标题"
              aria-label="标题"
              maxLength={200}
              autoFocus={freshId.current === memo.id}
              onChange={(e) => edit({ title: e.target.value.replace(/[\r\n]/g, "") })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  live.current?.insertBlock("", { caret: 0 });
                }
              }}
            />
            <div className="memo-meta">
              <TagInput tags={draft.tags} onChange={(tags) => edit({ tags })} />
              <span className="muted">创建于 {new Date(memo.created).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}</span>
            </div>
            {source ? (
              <textarea
                ref={sourceArea}
                className="notes-editor memo-source"
                aria-label="随记 Markdown 原文"
                value={draft.body}
                onChange={(e) => edit({ body: e.target.value })}
                onPaste={(e) => {
                  const files = [...e.clipboardData.files];
                  if (files.some((f) => f.type.startsWith("image/"))) {
                    e.preventDefault();
                    void addImages(files);
                  }
                }}
              />
            ) : (
              <div className="memo-body notes-live">
                <LiveEditor
                  key={memo.id}
                  ref={live}
                  text={draft.body}
                  onChange={(body) => edit({ body })}
                  imageBase={IMAGE_BASE}
                  onImages={upload}
                  placeholder="写下这个想法…  截图可以直接粘贴，支持 Markdown、$公式$ 和代码段。"
                />
              </div>
            )}
            <p className="memo-hint">
              自动保存到本地 <code>memos/</code> 文件夹 · <kbd>Ctrl</kbd> <kbd>S</kbd> 立即保存 · 删除后 10 秒内可撤销，文件留在 <code>memos/.trash</code>
            </p>
          </>
        )}
      </section>
    </main>
  );
}

function sameAs(memo: Pick<Memo, "title" | "tags" | "pinned" | "body"> | null, draft: Draft | null) {
  return !!memo && !!draft && memo.title === draft.title && memo.pinned === draft.pinned && memo.body.trim() === draft.body.trim() && memo.tags.join("\u0000") === draft.tags.join("\u0000");
}
function summaryOf(m: Memo): MemoSummary {
  const plain = m.body.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/[#>*_`~|\-]+|\$+/g, " ").replace(/\s+/g, " ").trim();
  return { id: m.id, title: m.title, created: m.created, updated: m.updated, tags: m.tags, pinned: m.pinned, excerpt: plain.slice(0, 160), search: plain.slice(0, 4000), images: (m.body.match(/!\[[^\]]*\]\(/g) || []).length };
}
function order(a: MemoSummary, b: MemoSummary) {
  return Number(b.pinned) - Number(a.pinned) || b.updated.localeCompare(a.updated);
}
