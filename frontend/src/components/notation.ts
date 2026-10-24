/**
 * Display-time cleanup for maths written as plain text in older reports, e.g.
 * `A^τ=(.5,2.5)`, `W_cls^l` or `\mathbb R^w`. New reports are rejected by the
 * publisher when they contain such notation; this keeps existing ones readable.
 */
/** Code, existing maths and link targets are left exactly as written. */
const PROTECTED = /(```[\s\S]*?```|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|`[^`\n]*`|\]\([^)]*\)|https?:\/\/\S+)/;
const LEADING_DOT = /(?<![\w.])\.(\d)/g;
const LETTER = /[A-Za-zͰ-Ͽ]/;
const WORD = /[\wͰ-Ͽ]/;

/** Index just past the bracket matching the one at `i`, or -1 when unbalanced. */
function closing(s: string, i: number) {
  const open = s[i],
    close = open === "{" ? "}" : ")";
  for (let j = i, depth = 0; j < s.length; j++) {
    if (s[j] === open) depth++;
    else if (s[j] === close && --depth === 0) return j + 1;
  }
  return -1;
}

/** Parse one scripted expression at `i`; returns its LaTeX and end, or null. */
function parse(s: string, i: number): { tex: string; end: number } | null {
  let j = i,
    tex = "",
    command = false;
  if (s[j] === "\\") {
    const name = /^\\[A-Za-z]+/.exec(s.slice(j));
    if (!name) return null;
    command = true;
    tex = name[0];
    j += name[0].length;
    if (s[j] === "{") {
      while (s[j] === "{") {
        const end = closing(s, j);
        if (end < 0) return null;
        tex += s.slice(j, end);
        j = end;
      }
    } else if (s[j] === "\\" && /^\\[A-Za-z]+/.test(s.slice(j))) {
      // `\hat\ell` style: the next command is the argument.
      const arg = /^\\[A-Za-z]+/.exec(s.slice(j))![0];
      tex += arg;
      j += arg.length;
    } else if (s[j] === " " && LETTER.test(s[j + 1] || "")) {
      // `\mathbb R` style: one-letter argument without braces.
      tex += `{${s[j + 1]}}`;
      j += 2;
    }
  } else {
    const atom = /^(?:\d*\.?\d+|d?[A-Za-zͰ-Ͽ])/.exec(s.slice(j));
    if (!atom) return null;
    tex = atom[0];
    j += atom[0].length;
  }
  let scripts = 0;
  while (s[j] === "^" || s[j] === "_") {
    const mark = s[j++];
    let arg: string;
    if (s[j] === "{" || s[j] === "(") {
      const end = closing(s, j);
      if (end < 0) return null;
      arg = scriptedText(s.slice(j + 1, end - 1));
      j = end;
    } else {
      // No underscore here: in `y^a_{1:H}` the `_` starts the next script.
      const token = /^(?:-?\d*\.?\d+|[A-Za-z0-9Ͱ-Ͽ]+)/.exec(s.slice(j));
      if (!token) return null;
      arg = token[0];
      j += token[0].length;
    }
    tex += `${mark}{${arg}}`;
    scripts++;
  }
  return scripts || command ? { tex, end: j } : null;
}

/** Scripts inside a bracketed argument, e.g. `(s_n−s_a)` → `s_{n}−s_{a}`. */
function scriptedText(s: string) {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const hit = (i === 0 || !WORD.test(s[i - 1])) && s[i - 1] !== "\\" ? parse(s, i) : null;
    if (hit) {
      out += hit.tex;
      i = hit.end;
    } else out += s[i++];
  }
  return out;
}

function convert(s: string) {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const prev = s[i - 1] || "";
    const start = s[i] === "\\" ? prev !== "\\" : !WORD.test(prev) && prev !== "\\" && prev !== ".";
    const hit = start ? parse(s, i) : null;
    if (hit) {
      out += `$${hit.tex}$`;
      i = hit.end;
    } else out += s[i++];
  }
  return out;
}

export function readableMath(text: string) {
  return text
    .split(PROTECTED)
    .map((part, i) => (i % 2 ? part : convert(part.replace(LEADING_DOT, "0.$1"))))
    .join("");
}
