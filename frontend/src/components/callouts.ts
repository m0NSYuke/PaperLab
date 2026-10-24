/**
 * Rehype plugin for report callouts: a blockquote starting with `[!KIND]`
 * (GitHub alert syntax) becomes a labelled, tinted box. Unknown kinds stay
 * ordinary blockquotes.
 */
type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

export const CALLOUTS: Record<string, string> = {
  intuition: "直觉",
  analogy: "打个比方",
  key: "要点",
  pitfall: "常见误区",
  note: "注意",
  tip: "提示",
  warning: "注意",
};
const MARK = /^\s*\[!([A-Za-z]+)\][ \t]*\n?/;

function firstText(node: Node): Node | null {
  for (const child of node.children || []) {
    if (child.type === "text") {
      if (child.value?.trim()) return child;
      continue; // whitespace between block elements
    }
    if (child.type === "element") return firstText(child);
  }
  return null;
}

function walk(node: Node) {
  for (const child of node.children || []) {
    if (child.type !== "element") continue;
    if (child.tagName === "blockquote") {
      const text = firstText(child);
      const kind = text?.value?.match(MARK)?.[1].toLowerCase();
      if (text && kind && CALLOUTS[kind]) {
        text.value = text.value!.replace(MARK, "");
        child.properties = { ...child.properties, className: ["callout", `callout-${kind}`], dataLabel: CALLOUTS[kind] };
      }
    }
    walk(child);
  }
}

export default function rehypeCallouts() {
  return (tree: Node) => walk(tree);
}
