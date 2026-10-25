import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import Markdown from "../../components/Markdown";

/**
 * Typora/Obsidian-style live editing: every Markdown block is shown rendered
 * (images, code, formulas) and turns back into raw text only while it is
 * being edited. The note itself stays plain Markdown.
 */
export type LiveEditorHandle = {
  /** Adds a block after the one being (or last) edited; `edit` opens it with the caret at `caret`. */
  insertBlock: (markdown: string, edit?: { caret: number }) => void;
};

const FENCE = /^(`{3,}|~{3,}|\$\$)/;

/** Splits on blank lines, keeping fenced code and $$ math blocks whole. */
export function splitBlocks(src: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [],
    fence: string | null = null;
  for (const line of src.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (fence) {
      current.push(line);
      if (trimmed.startsWith(fence) && current.length > 1) fence = null;
      continue;
    }
    if (!trimmed) {
      if (current.length) blocks.push(current.join("\n"));
      current = [];
      continue;
    }
    const open = trimmed.match(FENCE)?.[1];
    if (open && !(open === "$$" && trimmed.length > 2 && trimmed.endsWith("$$"))) fence = open.slice(0, 3);
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

const join = (blocks: string[]) => {
  const kept = blocks.filter((b) => b.trim());
  return kept.length ? kept.join("\n\n") + "\n" : "";
};

export default function LiveEditor({
  text,
  onChange,
  imageBase,
  disabled,
  placeholder,
  onImages,
  ref,
}: {
  text: string;
  onChange: (text: string) => void;
  imageBase: string;
  disabled?: boolean;
  placeholder: string;
  /** Uploads pasted or dropped images and returns their Markdown links. */
  onImages: (files: File[]) => Promise<string[]>;
  ref?: Ref<LiveEditorHandle>;
}) {
  // While a block is edited, the other blocks are frozen as a snapshot so a
  // blank line typed into the draft does not reshuffle the indices.
  const [edit, setEdit] = useState<{ blocks: string[]; index: number; caret: number } | null>(null);
  const lastEdited = useRef(-1);
  const area = useRef<HTMLTextAreaElement>(null);
  const blocks = edit ? edit.blocks : splitBlocks(text);

  const open = (base: string[], index: number, caret: number) => {
    lastEdited.current = index;
    setEdit({ blocks: base, index, caret });
  };
  const commit = (draft: string) => {
    if (!edit) return text;
    const next = [...edit.blocks];
    next[edit.index] = draft;
    const joined = join(next);
    if (joined !== text) onChange(joined);
    return joined;
  };
  // Where the draft's last block lands once the snapshot is re-split.
  const settledIndex = (draft: string) => (edit ? edit.index + Math.max(1, splitBlocks(draft).length) - 1 : -1);

  const insertAfter = (base: string[], after: number, markdown: string, editIt?: { caret: number }) => {
    const at = Math.min(Math.max(after + 1, 0), base.length);
    const next = [...base.slice(0, at), markdown, ...base.slice(at)];
    onChange(join(next));
    if (editIt) open(next, at, editIt.caret);
    else {
      lastEdited.current = at;
      setEdit(null);
    }
  };

  useImperativeHandle(ref, () => ({
    insertBlock: (markdown, editIt) => {
      if (edit) {
        const draft = area.current?.value ?? edit.blocks[edit.index];
        const after = settledIndex(draft);
        insertAfter(splitBlocks(commit(draft)), after, markdown, editIt);
      } else {
        const base = splitBlocks(text);
        insertAfter(base, lastEdited.current < 0 ? base.length - 1 : lastEdited.current, markdown, editIt);
      }
    },
  }));

  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !edit) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (document.activeElement !== el) {
      el.focus();
      el.setSelectionRange(edit.caret, edit.caret);
    }
  });

  // A pasted image goes in as its own block (shown rendered), and an empty line
  // opens under it so typing simply continues. On an empty line, the image takes its place.
  const pasteImages = async (files: File[]) => {
    const index = edit?.index ?? -1;
    const links = await onImages(files);
    if (!links.length) return;
    const draft = area.current?.value ?? "";
    const base = splitBlocks(commit(draft));
    const at = Math.min(draft.trim() ? settledIndex(draft) + 1 : Math.max(index, 0), base.length);
    const next = [...base.slice(0, at), ...links, "", ...base.slice(at)];
    onChange(join(next));
    open(next, at + links.length, 0);
  };
  const imageFiles = (list: FileList) => [...list].filter((f) => f.type.startsWith("image/"));

  return (
    <div
      className={`live-editor${disabled ? " disabled" : ""}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = imageFiles(e.dataTransfer.files);
        if (!files.length) return;
        e.preventDefault();
        if (edit) void pasteImages(files);
        else void onImages(files).then((links) => links.length && insertAfter(splitBlocks(text), blocks.length - 1, links.join("\n\n")));
      }}
    >
      {blocks.map((block, i) =>
        edit?.index === i ? (
          <textarea
            key={`edit-${i}`}
            ref={area}
            className="live-block-input"
            aria-label="编辑这一段笔记"
            defaultValue={block}
            rows={1}
            placeholder={blocks.length === 1 ? placeholder : "输入 Markdown…"}
            onChange={(e) => {
              commit(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onBlur={(e) => {
              lastEdited.current = settledIndex(e.target.value);
              commit(e.target.value);
              setEdit(null);
            }}
            onPaste={(e) => {
              const files = imageFiles(e.clipboardData.files);
              if (!files.length) return;
              e.preventDefault();
              void pasteImages(files);
            }}
            onKeyDown={(e) => {
              const el = e.currentTarget;
              if (e.key === "Escape") el.blur();
              const atStart = el.selectionStart === 0 && el.selectionEnd === 0,
                atEnd = el.selectionStart === el.value.length;
              if (e.key === "ArrowUp" && atStart && i > 0) {
                e.preventDefault();
                const next = splitBlocks(commit(el.value));
                open(next, i - 1, next[i - 1]?.length ?? 0);
              } else if (e.key === "ArrowDown" && atEnd && i < blocks.length - 1) {
                e.preventDefault();
                const target = settledIndex(el.value) + 1;
                open(splitBlocks(commit(el.value)), target, 0);
              } else if (e.key === "Backspace" && atStart && !el.value && blocks.length > 1) {
                e.preventDefault();
                const rest = edit.blocks.filter((_, k) => k !== i);
                onChange(join(rest));
                if (i > 0) open(rest, i - 1, rest[i - 1].length);
                else setEdit(null);
              }
            }}
          />
        ) : (
          <div
            key={`view-${i}`}
            className="live-block"
            onClick={(e) => {
              if (disabled || (e.target as Element).closest("a")) return;
              if (window.getSelection()?.toString()) return;
              open(splitBlocks(text), i, block.length);
            }}
          >
            <Markdown imageBase={imageBase}>{block}</Markdown>
          </div>
        ),
      )}
      {!edit && (
        <button
          type="button"
          className={`live-tail${blocks.length ? "" : " empty"}`}
          disabled={disabled}
          onClick={() => {
            const base = splitBlocks(text);
            open([...base, ""], base.length, 0);
          }}
        >
          {blocks.length ? "" : placeholder}
        </button>
      )}
    </div>
  );
}
