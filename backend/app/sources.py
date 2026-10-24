"""RAP's source-first reading, adapted to PaperLab's pinned identities and publisher."""
import re
import tarfile
import tempfile
from pathlib import Path

import httpx

from .importer import extract_source, fetch, parse_arxiv
from .models import Metadata
from .storage import atomic_write, data_lock, paper_dir, read_json, safe_path, sha256, write_json

TEXT_SUFFIXES = {".tex", ".bib", ".bbl", ".sty", ".cls"}


def without_comments(text):
    return re.sub(r"(?<!\\)%[^\n]*", "", text)


def ensure_source(root: Path, meta: Metadata):
    """Recover missing source only from an already pinned arXiv identity."""
    assets = paper_dir(root, meta.paper_id, meta.version, True)
    archive = safe_path(root, str(assets.relative_to(root)), "source.tar.gz")
    if meta.tex_path:
        source = safe_path(root, meta.tex_path)
        if source.is_dir() and any(source.rglob("*.tex")) and (
                source.name.startswith("rap-source-") or not archive.exists()):
            return meta, []
    if not meta.source_url:
        return meta, ["本地 PDF 尚未关联 arXiv 源码；保留 PDF 分析，不自动猜测线上版本。"]
    arxiv_id, version = parse_arxiv(meta.source_url)
    if version != meta.version or arxiv_id.replace("/", "-") != meta.paper_id:
        raise ValueError("arXiv 源码身份与已固定论文版本不一致")
    try:
        raw = archive.read_bytes() if archive.exists() else fetch(f"https://arxiv.org/src/{arxiv_id}{version}")
        digest = sha256(raw)
        if meta.tex_sha256 and digest != meta.tex_sha256:
            raise ValueError("LaTeX 压缩包与已固定 SHA-256 不一致，拒绝替换")
        with data_lock(root):
            assets.mkdir(parents=True, exist_ok=True)
            target = safe_path(root, str(assets.relative_to(root)), "rap-source-" + digest[:16])
            if not target.exists():
                with tempfile.TemporaryDirectory(prefix="rap-stage-", dir=assets) as temp:
                    stage = Path(temp) / "source"
                    stage.mkdir()
                    extract_source(raw, stage)
                    if not any(stage.rglob("*.tex")):
                        return meta, ["源码包没有可读 .tex 文件；保留 PDF 分析。"]
                    stage.rename(target)
            current = Metadata.model_validate(read_json(paper_dir(root, meta.paper_id, meta.version) / "metadata.json"))
            # Preserve concurrent title/reading-status edits.
            current.tex_path = target.relative_to(root).as_posix()
            current.tex_sha256 = digest
            atomic_write(archive, raw)
            write_json(paper_dir(root, meta.paper_id, meta.version) / "metadata.json", current.model_dump())
        return current, []
    except (httpx.HTTPError, OSError, ValueError, tarfile.TarError) as exc:
        return meta, [f"LaTeX 获取/提取受限（{type(exc).__name__}）；保留 PDF 分析。"]


def source_bundle(root: Path, pid: str, version: str, *, recover=False, max_chars=160000):
    folder = paper_dir(root, pid, version)
    meta = Metadata.model_validate(read_json(folder / "metadata.json"))
    warnings = []
    if recover:
        meta, warnings = ensure_source(root, meta)
    bundle = dict(workflow="RAP", mode="pdf_only", paper_id=pid, version=version,
                  entrypoint=None, entrypoint_candidates=[], files=[], missing_includes=[],
                  truncated=False, complete=False, warnings=warnings)
    if not meta.tex_path:
        if not warnings:
            warnings.append("没有 LaTeX 源码缓存；可获取已固定 arXiv 版本的源码，本地 PDF 继续使用原文分析。")
        return bundle
    source = safe_path(root, meta.tex_path)
    assets = paper_dir(root, pid, version, True)
    if not source.resolve().is_relative_to(assets.resolve()):
        raise ValueError("源码路径不属于当前论文版本")
    archive = assets / "source.tar.gz"
    if meta.tex_sha256 and archive.exists() and sha256(archive.read_bytes()) != meta.tex_sha256:
        raise ValueError("源码压缩包 SHA-256 与固定版本不一致")
    inventory = {}
    if source.is_dir():
        for item in sorted(source.rglob("*")):
            item = safe_path(source, str(item.relative_to(source)))
            if item.is_file() and item.suffix.lower() in TEXT_SUFFIXES:
                if len(inventory) >= 1500:
                    raise ValueError("源码文件数量超限")
                if item.stat().st_size > 5 * 1024 * 1024:
                    raise ValueError("单个源码文件超过 5 MB")
                inventory[item.relative_to(source).as_posix()] = item
    mains = []
    for name, path in inventory.items():
        if path.suffix.lower() == ".tex":
            text = without_comments(path.read_text(encoding="utf-8", errors="replace"))
            if re.search(r"\\documentclass(?:\s*\[[^\]]*\])?\s*\{", text):
                mains.append(name)
    bundle["entrypoint_candidates"] = mains
    if not mains:
        warnings.append("未找到含 documentclass 的 LaTeX 主文件；保留 PDF 分析。")
        return bundle
    if len(mains) > 1 and "main.tex" not in mains:
        bundle["mode"] = "ambiguous"
        warnings.append("有多个 LaTeX 主文件且没有唯一根目录 main.tex；需先确认入口，不自动拼接无关文档。")
        return bundle
    main = "main.tex" if "main.tex" in mains else mains[0]
    bundle.update(mode="latex", entrypoint=main)
    if len(mains) > 1:
        warnings.append("多个 documentclass 候选；按根目录 main.tex 读取，其余独立入口未自动并入。")
    visited, remaining = set(), max_chars

    def visit(name):
        nonlocal remaining
        if name in visited:
            return
        visited.add(name)
        path = inventory[name]
        raw = path.read_bytes()
        text = raw.decode("utf-8", errors="replace")
        if "\ufffd" in text:
            warnings.append(f"{name} 含无法按 UTF-8 识别的字节，请对照 PDF。")
        if len(bundle["files"]) >= 120 or remaining <= 0:
            bundle["truncated"] = True
            return
        shown = text[:remaining]
        bundle["files"].append(dict(path=name, sha256=sha256(raw), content=shown,
                                    truncated=len(shown) < len(text)))
        remaining -= len(shown)
        if len(shown) < len(text):
            bundle["truncated"] = True
            return
        clean = without_comments(text)
        # Resolve only literal local filenames; never expand or execute TeX.
        refs = [(m.start(), m.group(1), m.group(2), "") for m in re.finditer(
            r"\\(input|include|subfile|bibliography|addbibresource|usepackage|documentclass)(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}", clean)]
        refs += [(m.start(), "input", m.group(2), m.group(1)) for m in re.finditer(
            r"\\(?:subimport|import)\s*\{([^{}]*)\}\s*\{([^{}]+)\}", clean)]
        # Plain \input file.tex syntax is also accepted by TeX.
        refs += [(m.start(), "input", m.group(1), "") for m in re.finditer(
            r"\\input\s+([A-Za-z0-9_./-]+)", clean)]
        recognized = {ref[0] for ref in refs}
        for command in re.finditer(r"\\(?:input|include|subfile|import|subimport)\b", clean):
            if command.start() not in recognized:
                bundle["missing_includes"].append(f"{name}: {command.group()} (动态或不支持的语法)")
        # Read scientific sections/references before potentially huge typesetting classes.
        for _, command, value, prefix in sorted(refs, key=lambda ref: (ref[1] in {"usepackage", "documentclass"}, ref[0])):
            suffix = ".bib" if command in {"bibliography", "addbibresource"} else ".sty" if command == "usepackage" else ".cls" if command == "documentclass" else ".tex"
            for ref in value.split(","):
                ref = prefix + ref.strip()
                if "\\" in ref or re.search(r"[:{}]", ref):
                    bundle["missing_includes"].append(f"{name}: {ref} (动态或不支持的路径)")
                    continue
                if not Path(ref).suffix:
                    ref += suffix
                resolved = None
                for parent in (path.parent, source):
                    try:
                        candidate = safe_path(source, str((parent / ref).relative_to(source)))
                    except ValueError:
                        continue
                    key = candidate.resolve().relative_to(source.resolve()).as_posix()
                    if key in inventory:
                        resolved = key
                        break
                if resolved:
                    visit(resolved)
                elif command == "bibliography":
                    compiled = Path(main).with_suffix(".bbl").as_posix()
                    if compiled in inventory:
                        visit(compiled)
                    else:
                        bundle["missing_includes"].append(f"{name}: {ref}")
                elif command not in {"usepackage", "documentclass"}:
                    bundle["missing_includes"].append(f"{name}: {ref}")
    visit(main)
    bundle["missing_includes"] = list(dict.fromkeys(bundle["missing_includes"]))
    if bundle["missing_includes"]:
        warnings.append("部分引用文件无法静态解析，请检查 missing_includes 并对照 PDF。")
    if bundle["truncated"]:
        warnings.append("源码超过阅读预算；当前仅提供部分内容，不得声称已完整读完。")
    warnings.append("仅静态追踪 input/include/subfile/import 与本地参考文献/宏文件；未执行 TeX，复杂宏与条件编译需人工核对。")
    bundle["complete"] = not bundle["truncated"] and not bundle["missing_includes"] and len(mains) == 1
    return bundle


def source_summary(bundle):
    return {**{k: v for k, v in bundle.items() if k != "files"},
            "file_count": len(bundle["files"]),
            "files": [{k: v for k, v in item.items() if k != "content"} for item in bundle["files"]]}


def prepare_sources(root, pid, version):
    bundle = source_bundle(root, pid, version, recover=True)
    path = paper_dir(root, pid, version, True) / "rap-source.json"
    write_json(path, bundle)
    return bundle, path
