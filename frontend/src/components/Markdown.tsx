import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { readableMath } from "./notation";
import rehypeCallouts from "./callouts";
/** Report evidence ids such as `[method-core, data-recipe]`, not numeric citations like `[1, 48]`. */
const EVIDENCE = /\[((?:[a-z][a-z0-9]*-[a-z0-9-]+)(?:\s*[,，;]\s*[a-z][a-z0-9]*-[a-z0-9-]+)*)\](?!\()/g;
/** Turn evidence ids into links rendered as chips, leaving code and math untouched. */
const chipEvidence = (text: string) =>
  text
    .split(/(```[\s\S]*?```|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(EVIDENCE, (_, ids: string) =>
            ids
              .split(/\s*[,，;]\s*/)
              .map((id) => `[${id}](#ref:${id})`)
              .join(" "),
          ),
    )
    .join("");
/**
 * `inline` renders a short phrase inside running text, without paragraph blocks.
 * `imageBase` shows images (notes): relative paths resolve against it; without
 * it images stay placeholders, since report figures live in the PDF.
 */
export default function Markdown({
  children,
  inline = false,
  imageBase,
}: {
  children: string;
  inline?: boolean;
  imageBase?: string;
}) {
  const Wrapper = inline ? "span" : "div";
  return (
    <Wrapper className={inline ? "markdown-inline" : "markdown"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeCallouts, [rehypeKatex, { strict: false, trust: false }]]}
        components={{
          ...(inline ? { p: ({ children }) => <>{children}</> } : {}),
          img: ({ alt, src }) =>
            imageBase && typeof src === "string" && src ? (
              <img
                className="markdown-image"
                alt={alt || ""}
                loading="lazy"
                src={/^(https?:|data:image\/|\/)/.test(src) ? src : `${imageBase}/${src.replace(/^\.\//, "")}`}
              />
            ) : (
              <span className="muted">[图像：{alt || "请查看原始 PDF"}]</span>
            ),
          a: ({ children, href }) =>
            href?.startsWith("#ref:") ? (
              <span className="ref-chip" title="报告内部证据编号，可在“关键结论与原文证据”中查看">
                {children}
              </span>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {chipEvidence(readableMath(children))}
      </ReactMarkdown>
    </Wrapper>
  );
}
