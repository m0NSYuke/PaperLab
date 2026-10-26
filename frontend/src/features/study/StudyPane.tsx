import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CircleDashed,
  Eye,
  Lightbulb,
  Plus,
  Trash2,
} from "lucide-react";
import { api, base } from "../../api";
import Markdown from "../../components/Markdown";
import { Citations } from "../report/ReportPane";
import { ideaStatusLabel } from "../../pages/Library";
import type {
  Citation,
  GuideStop,
  IdeaStatus,
  Paper,
  Report,
  Study,
  Verdict,
} from "../../types";
const EMPTY: Study = {
  schema_version: "1.0",
  passes: [],
  checked_stops: [],
  judgment: {
    novelty: null,
    effectiveness: null,
    problem_size: null,
    reasons: "",
    bottleneck: "",
    next_step: "",
  },
  tests: [],
  ideas: [],
  updated_at: null,
};
const LEVEL = { recall: "记忆", understand: "理解", transfer: "迁移" };
const VERDICTS: [Verdict, string][] = [
  ["got_it", "我会了"],
  ["partial", "部分理解"],
  ["missed", "没答出来"],
];
type SaveState = "idle" | "saving" | "saved" | "error";
export function useStudy(paper: Paper) {
  const url = `${base(paper.paper_id, paper.version)}/study`;
  const [study, setStudy] = useState<Study>(EMPTY),
    [loaded, setLoaded] = useState(false),
    [save, setSave] = useState<SaveState>("idle"),
    [error, setError] = useState("");
  const etag = useRef(""),
    pending = useRef<Study | null>(null),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const load = useCallback(async () => {
    try {
      const r = await api<{ study: Study; etag: string }>(url);
      etag.current = r.etag;
      setStudy(r.study);
      setLoaded(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);
  const flush = useCallback(
    async (keepalive = false) => {
      const next = pending.current;
      if (!next) return;
      pending.current = null;
      setSave("saving");
      try {
        const r = await api<{ study: Study; etag: string }>(url, {
          method: "PUT",
          keepalive,
          body: JSON.stringify({ study: next, etag: etag.current }),
        });
        etag.current = r.etag;
        setSave("saved");
        setError("");
      } catch (e) {
        setSave("error");
        setError((e as Error).message);
      }
    },
    [url],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      void flush(true);
    },
    [flush],
  );
  const update = (change: (s: Study) => Study) => {
    setStudy((s) => {
      const next = change(s);
      pending.current = next;
      return next;
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
  };
  return { study, loaded, save, error, update, reload: load };
}
export default function StudyPane({
  paper,
  report,
  onJump,
  onTab,
  onCitation,
  selection,
  focusSelfTest = false,
}: {
  paper: Paper;
  report: Report | null;
  onJump: (page: number) => void;
  onTab: (tab: string) => void;
  onCitation: (c: Citation) => void;
  selection: string;
  /** Scroll to the self-test once loaded (opened from the library's 自测与思考). */
  focusSelfTest?: boolean;
}) {
  const { study, loaded, save, error, update, reload } = useStudy(paper);
  const selfTestRef = useRef<HTMLElement>(null),
    focused = useRef(false);
  useEffect(() => {
    if (!focusSelfTest || !loaded || !report || focused.current) return;
    focused.current = true;
    requestAnimationFrame(() => selfTestRef.current?.scrollIntoView({ block: "start" }));
  }, [focusSelfTest, loaded, report]);
  const guide = report?.reading_guide;
  const tests = report?.self_test || [];
  const togglePass = (n: 1 | 2 | 3) =>
    update((s) => ({
      ...s,
      passes: s.passes.includes(n)
        ? s.passes.filter((x) => x !== n)
        : [...s.passes, n].sort() as (1 | 2 | 3)[],
    }));
  const toggleStop = (key: string) =>
    update((s) => ({
      ...s,
      checked_stops: s.checked_stops.includes(key)
        ? s.checked_stops.filter((x) => x !== key)
        : [...s.checked_stops, key],
    }));
  const attempt = (id: string) =>
    study.tests.find((t) => t.question_id === id) || {
      question_id: id,
      my_answer: "",
      verdict: "unanswered" as Verdict,
      updated_at: new Date().toISOString(),
    };
  const setAttempt = (
    id: string,
    change: Partial<{ my_answer: string; verdict: Verdict }>,
  ) =>
    update((s) => ({
      ...s,
      tests: [
        ...s.tests.filter((t) => t.question_id !== id),
        { ...attempt(id), ...change, updated_at: new Date().toISOString() },
      ],
    }));
  const answered = tests.filter((q) => attempt(q.question_id).verdict !== "unanswered");
  const mastered = answered.filter((q) => attempt(q.question_id).verdict === "got_it");
  const j = study.judgment;
  const value =
    j.novelty && j.effectiveness && j.problem_size
      ? j.novelty * j.effectiveness * j.problem_size
      : null;
  return (
    <div className="study-content">
      <div className="section-eyebrow">06 / MAKE IT STICK</div>
      <h2 className="section-title">把理解变成能力</h2>
      <p className="section-intro">
        报告替你省掉的是整理时间，不是思考。按三遍读法读，再用自测题检查自己是否真的懂了。
      </p>
      <div className={`save-state ${save}`} role="status">
        {!loaded
          ? "正在读取学习记录…"
          : save === "saving"
            ? "正在保存…"
            : save === "saved"
              ? "已自动保存到 study.json"
              : save === "error"
                ? "保存失败"
                : "修改会自动保存"}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => void reload()}>重新读取</button>
        </div>
      )}

      <section className="study-block">
        <header>
          <h3>阅读路线</h3>
          <span>三遍读法：先判断值不值得读，再理解方法，最后亲手啃关键页</span>
        </header>
        <div className="pass-list">
          <PassCard
            n={1}
            title="第一遍 · 快速浏览"
            time="10 分钟"
            done={study.passes.includes(1)}
            onToggle={() => togglePass(1)}
          >
            <p>只看标题、摘要、图和结论，回答：它解决什么问题？值不值得精读？</p>
            <Stops
              prefix="first"
              stops={guide?.first_pass}
              checked={study.checked_stops}
              onToggle={toggleStop}
              onJump={onJump}
            />
          </PassCard>
          <PassCard
            n={2}
            title="第二遍 · 跟着报告理解方法"
            time="1 小时"
            done={study.passes.includes(2)}
            onToggle={() => togglePass(2)}
          >
            <p>读方法与实验，不纠缠推导细节。遇到看不懂的公式先记下来。</p>
            <div className="tab-links">
              {[
                ["method", "Method"],
                ["mathematics", "Mathematics"],
                ["experiments", "Experiments"],
              ].map(([key, label]) => (
                <button key={key} onClick={() => onTab(key)}>
                  {label} <ArrowUpRight size={12} />
                </button>
              ))}
            </div>
          </PassCard>
          <PassCard
            n={3}
            title="第三遍 · 亲读关键页"
            time="按需"
            done={study.passes.includes(3)}
            onToggle={() => togglePass(3)}
          >
            <p>这些页不要只看报告。自己推一遍公式，假装你要复现它。</p>
            <Stops
              prefix="must"
              stops={guide?.must_read}
              checked={study.checked_stops}
              onToggle={toggleStop}
              onJump={onJump}
            />
          </PassCard>
        </div>
      </section>

      <section className="study-block" id="study-self-test" ref={selfTestRef}>
        <header>
          <h3>理解验收</h3>
          <span>
            {tests.length
              ? `先用自己的话回答，再对照参考答案 · 已掌握 ${mastered.length}/${tests.length}`
              : "费曼检验：讲不清楚的地方，就是还没懂的地方"}
          </span>
        </header>
        {tests.length === 0 ? (
          <p className="muted">
            这份报告还没有自测题。重新运行 <code>/paper</code> 会按新规范生成题目。
          </p>
        ) : (
          tests.map((q, i) => {
            const a = attempt(q.question_id);
            return (
              <SelfTest
                key={q.question_id}
                index={i + 1}
                level={LEVEL[q.level]}
                question={q.question}
                answer={q.answer}
                citations={q.citations}
                mine={a.my_answer}
                verdict={a.verdict}
                onCitation={onCitation}
                onAnswer={(text) => setAttempt(q.question_id, { my_answer: text })}
                onVerdict={(v) => setAttempt(q.question_id, { verdict: v })}
              />
            );
          })
        )}
      </section>

      <section className="study-block">
        <header>
          <h3>研究判断</h3>
          <span>只由你来打分。AI 不填这一栏</span>
        </header>
        <div className="judgment">
          {(
            [
              ["novelty", "新意度", "和已有方法比，它的想法有多新？"],
              ["effectiveness", "有效性", "证据有多扎实？基线公平吗？"],
              ["problem_size", "问题大小", "解决了它，领域能前进多少？"],
            ] as const
          ).map(([key, label, hint]) => (
            <div className="rating-row" key={key}>
              <div>
                <strong>{label}</strong>
                <small>{hint}</small>
              </div>
              <div className="rating" role="radiogroup" aria-label={label}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    role="radio"
                    aria-checked={j[key] === n}
                    aria-label={`${label} ${n} 分`}
                    className={j[key] !== null && n <= j[key]! ? "on" : ""}
                    onClick={() =>
                      update((s) => ({
                        ...s,
                        judgment: {
                          ...s.judgment,
                          [key]: s.judgment[key] === n ? null : n,
                        },
                      }))
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="value-line">
            <span>
              论文价值 = 新意度 × 有效性 × 问题大小
              <small>李沐在「论文精读」系列里用的判断框架</small>
            </span>
            <strong>{value ?? "—"}</strong>
            <small>/ 125</small>
          </div>
          {(
            [
              ["reasons", "为什么这样打分", "一两句话写下你的依据…"],
              [
                "bottleneck",
                "真正的瓶颈是什么",
                "Levine 常问：数据从哪来？是方法、数据、算力还是评测在卡脖子？",
              ],
              [
                "next_step",
                "如果我来做下一步",
                "Hamming：你所在领域最重要的问题是什么？这篇离它有多远？",
              ],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label className="field-label" key={key}>
              {label}
              <textarea
                rows={2}
                value={j[key]}
                placeholder={placeholder}
                disabled={!loaded}
                onChange={(e) =>
                  update((s) => ({
                    ...s,
                    judgment: { ...s.judgment, [key]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
        </div>
      </section>

      <IdeaBox
        ideas={study.ideas}
        selection={selection}
        disabled={!loaded}
        onAdd={(text, source) =>
          update((s) => ({
            ...s,
            ideas: [
              {
                idea_id: `idea_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                text,
                status: "new",
                source,
                created_at: new Date().toISOString(),
              },
              ...s.ideas,
            ],
          }))
        }
        onStatus={(id, status) =>
          update((s) => ({
            ...s,
            ideas: s.ideas.map((i) => (i.idea_id === id ? { ...i, status } : i)),
          }))
        }
        onRemove={(id) =>
          update((s) => ({ ...s, ideas: s.ideas.filter((i) => i.idea_id !== id) }))
        }
      />
    </div>
  );
}
function PassCard({
  n,
  title,
  time,
  done,
  onToggle,
  children,
}: {
  n: number;
  title: string;
  time: string;
  done: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <article className={`pass-card ${done ? "done" : ""}`}>
      <button
        className="pass-check"
        aria-pressed={done}
        aria-label={`${title}${done ? "（已完成）" : ""}`}
        onClick={onToggle}
      >
        {done ? <Check size={14} /> : n}
      </button>
      <div>
        <h4>
          {title}
          <small>{time}</small>
        </h4>
        {children}
      </div>
    </article>
  );
}
function Stops({
  prefix,
  stops,
  checked,
  onToggle,
  onJump,
}: {
  prefix: string;
  stops?: GuideStop[];
  checked: string[];
  onToggle: (key: string) => void;
  onJump: (page: number) => void;
}) {
  if (!stops?.length)
    return (
      <p className="muted small">
        报告未提供该遍的具体页码。重新运行 <code>/paper</code> 可生成阅读路线。
      </p>
    );
  return (
    <ul className="stops">
      {stops.map((s, i) => {
        const key = `${prefix}:${i}:${s.page}`;
        const on = checked.includes(key);
        return (
          <li key={key} className={on ? "on" : ""}>
            <button
              className="stop-check"
              aria-pressed={on}
              aria-label={`标记已读 ${s.label}`}
              onClick={() => onToggle(key)}
            >
              {on ? <Check size={12} /> : <CircleDashed size={12} />}
            </button>
            <button className="stop-page" onClick={() => onJump(s.page)}>
              p.{s.page}
            </button>
            <div>
              <strong><Markdown inline>{s.label}</Markdown></strong>
              {s.why && <span><Markdown inline>{s.why}</Markdown></span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
function SelfTest({
  index,
  level,
  question,
  answer,
  citations,
  mine,
  verdict,
  onCitation,
  onAnswer,
  onVerdict,
}: {
  index: number;
  level: string;
  question: string;
  answer: string;
  citations: Citation[];
  mine: string;
  verdict: Verdict;
  onCitation: (c: Citation) => void;
  onAnswer: (text: string) => void;
  onVerdict: (v: Verdict) => void;
}) {
  const [reveal, setReveal] = useState(verdict !== "unanswered");
  return (
    <article className={`self-test ${verdict}`}>
      <div className="self-test-top">
        <span className="q-index">Q{index}</span>
        <span className={`q-level`}>{level}</span>
        {verdict !== "unanswered" && (
          <span className={`q-verdict ${verdict}`}>
            {VERDICTS.find((v) => v[0] === verdict)?.[1]}
          </span>
        )}
      </div>
      <div className="q-text">
        <Markdown>{question}</Markdown>
      </div>
      <textarea
        aria-label={`我的回答 Q${index}`}
        rows={3}
        value={mine}
        placeholder="先不看答案，用自己的话讲清楚…"
        onChange={(e) => onAnswer(e.target.value)}
      />
      {!reveal ? (
        <div className="q-actions">
          <button
            className="secondary"
            disabled={!mine.trim()}
            onClick={() => setReveal(true)}
          >
            <Eye size={14} />
            对照参考答案
          </button>
          <button className="text-button" onClick={() => setReveal(true)}>
            我想不出来，直接看
          </button>
        </div>
      ) : (
        <>
          <div className="q-answer">
            <span>参考答案</span>
            <Markdown>{answer}</Markdown>
            <Citations items={citations} onCitation={onCitation} />
          </div>
          <div className="q-actions" role="group" aria-label="自评">
            {VERDICTS.map(([v, label]) => (
              <button
                key={v}
                className={`verdict-button ${v} ${verdict === v ? "active" : ""}`}
                onClick={() => onVerdict(v)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </article>
  );
}
function IdeaBox({
  ideas,
  selection,
  disabled,
  onAdd,
  onStatus,
  onRemove,
}: {
  ideas: Study["ideas"];
  selection: string;
  disabled: boolean;
  onAdd: (text: string, source: string) => void;
  onStatus: (id: string, status: IdeaStatus) => void;
  onRemove: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    onAdd(text.trim(), selection ? `摘录：${selection.slice(0, 80)}` : "");
    setText("");
  };
  return (
    <section className="study-block">
      <header>
        <h3>
          <Lightbulb size={16} />
          想法本
        </h3>
        <span>像审稿人一样挑刺：缺了哪个消融？换个设定还成立吗？</span>
      </header>
      <div className="idea-input">
        <textarea
          aria-label="新想法"
          rows={2}
          value={text}
          disabled={disabled}
          placeholder={
            selection
              ? "针对选中的原文，记下你的疑问或改进想法…（会附上摘录）"
              : "例如：τ 换成均匀采样会怎样？没看到相关消融…"
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add();
          }}
        />
        <button className="primary" disabled={!text.trim()} onClick={add}>
          <Plus size={15} />
          记下
        </button>
      </div>
      {ideas.map((idea) => (
        <article className="idea-row" key={idea.idea_id}>
          <select
            aria-label="想法状态"
            className={`idea-status ${idea.status}`}
            value={idea.status}
            onChange={(e) => onStatus(idea.idea_id, e.target.value as IdeaStatus)}
          >
            {Object.entries(ideaStatusLabel).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <p>{idea.text}</p>
          <footer>
            {idea.source && <span>{idea.source}</span>}
            <span>{new Date(idea.created_at).toLocaleDateString("zh-CN")}</span>
            <button
              className="icon-button"
              aria-label="删除想法"
              onClick={() => {
                if (window.confirm("删除这条想法？")) onRemove(idea.idea_id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </footer>
        </article>
      ))}
    </section>
  );
}
