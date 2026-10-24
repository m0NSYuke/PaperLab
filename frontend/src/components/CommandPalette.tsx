import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CornerDownLeft, Search } from "lucide-react";
export type Command = {
  id: string;
  label: string;
  group: string;
  hint?: string;
  keywords?: string;
  run: () => void;
};
export type CommandSource = {
  commands: Command[];
  /** Commands derived from what was typed, e.g. "12" -> go to page 12. */
  dynamic?: (query: string) => Command[];
};
export const CommandContext = createContext<(source: CommandSource) => void>(
  () => {},
);
/** Pages register their commands while mounted. */
export function useCommands(source: CommandSource) {
  const register = useContext(CommandContext);
  useEffect(() => {
    register(source);
    return () => register({ commands: [] });
  }, [register, source]);
}
export default function CommandPalette({
  sources,
  onClose,
}: {
  sources: CommandSource[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dynamic = q ? sources.flatMap((s) => s.dynamic?.(q) || []) : [];
    const matched = sources
      .flatMap((s) => s.commands)
      .filter(
        (c) =>
          !q ||
          `${c.label} ${c.group} ${c.keywords || ""}`.toLowerCase().includes(q),
      );
    return [...dynamic, ...matched];
  }, [query, sources]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    // Let the palette unmount before the command moves focus elsewhere.
    setTimeout(c.run, 0);
  };
  let lastGroup = "";
  return (
    <div
      className="palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-label="命令面板">
        <label className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            aria-label="搜索命令"
            placeholder="输入命令、页码或论文标题…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(items[active]);
              }
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="palette-list" ref={listRef} role="listbox">
          {items.length === 0 && (
            <p className="palette-empty">没有匹配的命令</p>
          )}
          {items.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : "";
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "active" : ""}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                >
                  <span>{c.label}</span>
                  {c.hint && <kbd>{c.hint}</kbd>}
                  {i === active && <CornerDownLeft size={14} />}
                </button>
              </div>
            );
          })}
        </div>
        <footer>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 选择
          </span>
          <span>
            <kbd>Enter</kbd> 执行
          </span>
          <span>
            <kbd>Ctrl</kbd>
            <kbd>K</kbd> 随时打开
          </span>
        </footer>
      </div>
    </div>
  );
}
