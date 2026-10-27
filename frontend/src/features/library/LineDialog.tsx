import { useState } from "react";
import { api } from "../../api";
import type { ResearchLine } from "../../types";
import Modal from "../../components/Modal";

type Saved = { id: string; filed: number; lines: ResearchLine[] };

/** Create or edit a research line: its name, kind, the question it answers and the keywords that file new papers. */
export default function LineDialog({
  line,
  onClose,
  onSaved,
}: {
  line?: ResearchLine;
  onClose: () => void;
  onSaved: (result: Saved) => void;
}) {
  const [name, setName] = useState(line?.name ?? ""),
    [kind, setKind] = useState<ResearchLine["kind"]>(line?.kind ?? "idea"),
    [question, setQuestion] = useState(line?.question ?? ""),
    [status, setStatus] = useState(line?.status ?? ""),
    [keywords, setKeywords] = useState((line?.keywords ?? []).join("、")),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    if (!name.trim()) {
      setError("先给研究线起个名字");
      return;
    }
    setBusy(true);
    try {
      const body = JSON.stringify({ name, kind, question, status, keywords: [keywords] });
      const result = await api<Saved>(line ? `/api/lines/${line.id}` : "/api/lines", { method: line ? "PATCH" : "POST", body });
      onSaved(result);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={line ? "编辑研究线" : "新建研究线"} onClose={onClose}>
      <div className="segmented" role="radiogroup" aria-label="类型">
        <button role="radio" aria-checked={kind === "idea"} className={kind === "idea" ? "active" : ""} onClick={() => setKind("idea")}>
          Idea：我想做的一个点子
        </button>
        <button role="radio" aria-checked={kind === "direction"} className={kind === "direction" ? "active" : ""} onClick={() => setKind("direction")}>
          方向：长期关注的领域
        </button>
      </div>
      <label className="field-label">
        名称
        <input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="例如：自回归视频的投机解码" />
      </label>
      <label className="field-label">
        要回答的问题
        <textarea
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="一两句话：这条线最终想弄清楚什么，打开这条线时会显示在最上面"
        />
      </label>
      <label className="field-label">
        关键词
        <textarea
          rows={2}
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="用顿号、逗号或换行分隔，中英文都行：world model、embodied、机器人"
        />
        <small className="field-hint">新导入的论文标题或开头命中这些词，就会自动归到这条线；保存后「未归入」的论文也会按它重新归类。</small>
      </label>
      <label className="field-label">
        状态（可选）
        <input value={status} maxLength={20} onChange={(e) => setStatus(e.target.value)} placeholder="例如：构思中、读论文中、做实验中" />
      </label>
      {error && <p className="error-banner">{error}</p>}
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>取消</button>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {busy ? "保存中…" : line ? "保存" : "创建"}
        </button>
      </div>
    </Modal>
  );
}
