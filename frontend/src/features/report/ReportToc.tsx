import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import "./toc.css";

type Item = { el: HTMLElement; title: string; children: { el: HTMLElement; title: string }[] };
/** Chapter-level headings of every report tab; units inside a guided chapter become its children. */
const CHAPTERS =
  ".chapter-title, .report-subheading, .equation-card h3, .experiment-card h3, .relation-card h3, .claims-section > h3, .concept-links > h3";
const UNITS = ".lesson-chapter .lesson-heading h4";

const label = (el: HTMLElement) => {
  // Chapter numbers are drawn by the outline itself.
  const number = el.querySelector(":scope > span")?.textContent || "";
  const text = (el.textContent || "").replace(number, "").replace(/\s+/g, " ").trim();
  return text.length > 44 ? text.slice(0, 43) + "…" : text;
};

function collect(root: HTMLElement) {
  const chapters: Item[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(`${CHAPTERS}, ${UNITS}`)) {
    // Skip headings hidden in closed <details> and the transient search results.
    if (!el.offsetParent || el.closest(".lesson-search, .report-empty")) continue;
    const title = label(el);
    if (!title) continue;
    if (el.matches(UNITS) && chapters.length) chapters[chapters.length - 1].children.push({ el, title });
    else chapters.push({ el, title, children: [] });
  }
  const top = root.querySelector<HTMLElement>("h2.section-title");
  return { title: top ? label(top) : "本页目录", chapters };
}

/**
 * Structured outline for the report: the page title as root, numbered chapters,
 * and the units of the chapter being read. At rest it is one bar per chapter.
 */
export default function ReportToc({ scroll, watch }: { scroll: HTMLElement | null; watch: string }) {
  const [tree, setTree] = useState<{ title: string; chapters: Item[] }>({ title: "", chapters: [] }),
    [active, setActive] = useState<[number, number]>([0, -1]),
    [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (!scroll) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setTree(collect(scroll)), 120);
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(scroll, { childList: true, subtree: true });
    scroll.addEventListener("toggle", refresh, true);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      scroll.removeEventListener("toggle", refresh, true);
    };
  }, [scroll, watch]);
  useEffect(() => {
    if (!scroll || !tree.chapters.length) return;
    const spy = () => {
      const line = scroll.getBoundingClientRect().top + 90;
      let current: [number, number] = [0, -1];
      tree.chapters.forEach((chapter, c) => {
        if (chapter.el.getBoundingClientRect().top <= line) current = [c, -1];
        chapter.children.forEach((child, u) => {
          if (child.el.getBoundingClientRect().top <= line) current = [c, u];
        });
      });
      setActive((a) => (a[0] === current[0] && a[1] === current[1] ? a : current));
    };
    spy();
    scroll.addEventListener("scroll", spy, { passive: true });
    return () => scroll.removeEventListener("scroll", spy);
  }, [scroll, tree]);
  useEffect(() => setOpen(null), [active[0]]);
  if (tree.chapters.length < 2) return null;
  const go = (el: HTMLElement) => {
    // Units such as experiments and formulas sit in collapsed <details>; open them first.
    for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return (
    <nav className="report-toc" aria-label="报告目录">
      <div className="toc-bars" aria-hidden="true">
        {tree.chapters.map((_, i) => (
          <i key={i} className={i === active[0] ? "on" : ""} />
        ))}
      </div>
      <div className="toc-panel">
        <button className="toc-root" onClick={() => scroll?.scrollTo({ top: 0, behavior: "smooth" })}>
          {tree.title}
        </button>
        <ol>
          {tree.chapters.map((chapter, c) => {
            const expanded = chapter.children.length > 0 && (open === null ? c === active[0] : open === c);
            return (
              <li key={c} className={c === active[0] ? "here" : ""}>
                <div className="toc-chapter">
                  <button
                    className="toc-chapter-link"
                    aria-current={c === active[0] && active[1] < 0 ? "location" : undefined}
                    onClick={() => go(chapter.el)}
                    title={chapter.title}
                  >
                    <span>{String(c + 1).padStart(2, "0")}</span>
                    {chapter.title}
                  </button>
                  {chapter.children.length > 0 && (
                    <button
                      className={`toc-toggle ${expanded ? "open" : ""}`}
                      aria-label={expanded ? `收起 ${chapter.title}` : `展开 ${chapter.title}`}
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? -1 : c)}
                    >
                      <small>{chapter.children.length}</small>
                      <ChevronRight size={13} />
                    </button>
                  )}
                </div>
                {expanded && (
                  <ul>
                    {chapter.children.map((child, u) => (
                      <li key={u}>
                        <button
                          className={c === active[0] && u === active[1] ? "on" : ""}
                          aria-current={c === active[0] && u === active[1] ? "location" : undefined}
                          onClick={() => go(child.el)}
                          title={child.title}
                        >
                          {child.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
