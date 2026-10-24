import html
import io
import re
import tarfile
import uuid
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

import httpx
import pymupdf

from .models import Metadata
from .storage import atomic_write, data_lock, paper_dir, read_json, safe_path, sha256, write_json

MAX_BYTES = 100 * 1024 * 1024
ARXIV_RE = re.compile(r"(?P<id>\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*/\d{7})(?P<version>v[1-9]\d*)?\Z")


def parse_arxiv(reference: str) -> tuple[str, str | None]:
    reference = reference.strip()
    if reference.startswith(("http://", "https://")):
        url = urlparse(reference)
        if url.hostname not in {"arxiv.org", "www.arxiv.org", "export.arxiv.org"} or url.query or url.fragment:
            raise ValueError("请输入 arXiv ID 或 arxiv.org 的 abs / pdf URL")
        reference = re.sub(r"^/(?:abs|pdf|src)/", "", url.path).removesuffix(".pdf")
    match = ARXIV_RE.fullmatch(reference)
    if not match:
        raise ValueError("无效的 arXiv ID，例如 2410.24164v4")
    return match["id"], match["version"]


class MetaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and a.get("name", "").startswith("citation_"):
            self.values.setdefault(a["name"], []).append(a.get("content", ""))


def fetch(url: str, limit=MAX_BYTES) -> bytes:
    # Only internal callers supply fixed arxiv.org URLs. Redirect hosts are checked.
    with httpx.Client(timeout=httpx.Timeout(120, connect=20), follow_redirects=False,
                      headers={"User-Agent": "PaperLab/0.1 (personal research reader)"}) as client:
        for _ in range(4):
            with client.stream("GET", url) as response:
                if response.is_redirect:
                    from urllib.parse import urljoin
                    url = urljoin(url, response.headers["location"])
                    target = urlparse(url)
                    if target.scheme != "https" or target.hostname not in {"arxiv.org", "export.arxiv.org"}:
                        raise ValueError("论文下载重定向到了未授权主机")
                    continue
                response.raise_for_status()
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > limit:
                        raise ValueError("文件超过 100 MB 限制")
                    chunks.append(chunk)
                return b"".join(chunks)
    raise ValueError("论文下载重定向次数过多")


def pdf_index(raw: bytes) -> dict:
    if not raw.startswith(b"%PDF-"):
        raise ValueError("文件不是有效 PDF")
    with pymupdf.open(stream=raw, filetype="pdf") as doc:
        if doc.needs_pass:
            raise ValueError("暂不支持加密 PDF，请先解密")
        if len(doc) == 0 or len(doc) > 2000:
            raise ValueError("PDF 页数不受支持")
        # Native content order preserves academic columns better than global y-sorting.
        pages = [{"page": i + 1, "text": page.get_text(sort=False)} for i, page in enumerate(doc)]
        return {"schema_version": "1.0", "page_count": len(doc), "pages": pages,
                "outline": doc.get_toc(), "limited": sum(len(p["text"].strip()) for p in pages) < 100,
                "document_metadata": doc.metadata}


def extract_source(raw: bytes, target: Path) -> int:
    """Never call extractall: no links, devices, traversals, or executable files."""
    count = total = 0
    try:
        archive = tarfile.open(fileobj=io.BytesIO(raw), mode="r:*")
    except tarfile.ReadError:
        import gzip
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
                text = stream.read(5 * 1024 * 1024 + 1)
        except (OSError, EOFError):
            text = raw
        if len(text) > 5 * 1024 * 1024 or b"\\documentclass" not in text:
            raise ValueError("LaTeX 源码格式无法识别")
        atomic_write(target / "main.tex", text)
        return 1
    with archive:
        for member in archive:
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts or "\\" in member.name or ":" in member.name:
                raise ValueError("源码包含不安全路径")
            if not member.isfile() or name.suffix.lower() not in {".tex", ".bib", ".bbl", ".sty", ".cls", ".txt"}:
                continue
            total += member.size
            count += 1
            if member.size > 5 * 1024 * 1024 or total > 30 * 1024 * 1024 or count > 1500:
                raise ValueError("LaTeX 解压大小超过限制")
            file = archive.extractfile(member)
            if file:
                path = safe_path(target, *name.parts)
                atomic_write(path, file.read())
    return count


def store_import(root: Path, meta: Metadata, raw: bytes, index: dict, source: bytes | None = None):
    with data_lock(root):
        folder = paper_dir(root, meta.paper_id, meta.version)
        assets = paper_dir(root, meta.paper_id, meta.version, assets=True)
        metadata_path = safe_path(root, str(folder.relative_to(root)), "metadata.json")
        if metadata_path.exists():
            existing = Metadata.model_validate(read_json(metadata_path))
            if existing.pdf_sha256 != sha256(raw):
                raise ValueError("下载文件与已固定版本的 SHA-256 不一致，拒绝替换")
            pdf_path = safe_path(root, str(assets.relative_to(root)), "paper.pdf")
            if not pdf_path.exists():
                atomic_write(pdf_path, raw)
            write_json(safe_path(root, str(assets.relative_to(root)), "pages.json"), index)
            return existing
        atomic_write(safe_path(root, str(assets.relative_to(root)), "paper.pdf"), raw)
        write_json(safe_path(root, str(assets.relative_to(root)), "pages.json"), index)
        if source:
            atomic_write(safe_path(root, str(assets.relative_to(root)), "source.tar.gz"), source)
            try:
                count = extract_source(source, safe_path(root, str(assets.relative_to(root)), "source"))
                meta.tex_sha256 = sha256(source)
                if count:
                    meta.tex_path = (assets / "source").relative_to(root).as_posix()
                else:
                    meta.warnings.append("源文件中没有可读取的 LaTeX 文本")
            except (ValueError, OSError, tarfile.TarError) as exc:
                meta.warnings.append(f"LaTeX 提取受限：{exc}")
        meta.pdf_path = (assets / "paper.pdf").relative_to(root).as_posix()
        meta.pdf_sha256 = sha256(raw)
        meta.page_count = index["page_count"]
        if index["limited"]:
            meta.warnings.append("PDF 原生文本不足，可能是扫描件；未执行 OCR，分析须标记受限")
        for name in ("notes.md", "corrections.jsonl"):
            human_file = safe_path(root, str(folder.relative_to(root)), name)
            if not human_file.exists():
                atomic_write(human_file, "")
        # Metadata last: incomplete imports never appear in the library.
        write_json(metadata_path, meta.model_dump())
        write_json(safe_path(root, str(folder.relative_to(root)), "source-index.json"), {
            "schema_version": "1.0", "paper_id": meta.paper_id, "version": meta.version,
            "pdf_sha256": meta.pdf_sha256, "page_count": meta.page_count, "citations": []})
        return meta


def import_arxiv(root: Path, reference: str) -> Metadata:
    arxiv_id, requested = parse_arxiv(reference)
    local_id = arxiv_id.replace("/", "-")
    if requested:
        path = paper_dir(root, local_id, requested) / "metadata.json"
        pdf_path = safe_path(root, str(paper_dir(root, local_id, requested, True).relative_to(root)), "paper.pdf")
        if path.exists() and pdf_path.exists():
            return Metadata.model_validate(read_json(safe_path(root, str(path.relative_to(root)))))
    page = fetch(f"https://arxiv.org/abs/{arxiv_id}{requested or ''}", 3 * 1024 * 1024).decode("utf-8")
    parser = MetaParser()
    parser.feed(page)
    values = parser.values
    versions = re.findall(r"\[v(\d+)\]", page)
    if not versions:
        versions = re.findall(re.escape(arxiv_id) + r"v(\d+)", page)
    if not versions or "citation_title" not in values:
        raise ValueError("无法可靠确定论文元数据与版本，请明确指定版本")
    latest = max(map(int, versions))
    if requested and int(requested[1:]) > latest:
        raise ValueError("arXiv 不存在该版本")
    version = requested or f"v{latest}"
    exact = arxiv_id + version
    if not requested:
        return import_arxiv(root, exact)
    raw = fetch(f"https://arxiv.org/pdf/{exact}")
    index = pdf_index(raw)
    # The first page of arXiv PDFs must confirm the pinned ID; never relabel latest as vN.
    if exact not in re.sub(r"\s+", "", index["pages"][0]["text"]):
        raise ValueError("PDF 首页无法确认所请求的 arXiv 精确版本，停止导入")
    warnings = []
    try:
        source = fetch(f"https://arxiv.org/src/{exact}")
    except (httpx.HTTPError, ValueError) as exc:
        source = None
        warnings.append(f"LaTeX 获取失败，保留 PDF 阅读：{type(exc).__name__}")
    first = lambda key, default="": values.get(key, [default])[0]
    year = int(first("citation_date", str(2000 + int(arxiv_id[:2])) if arxiv_id[0].isdigit() else "2000")[:4])
    meta = Metadata(paper_id=local_id, version=version, title=html.unescape(first("citation_title")),
                    authors=values.get("citation_author", []), year=year,
                    source_url=f"https://arxiv.org/abs/{exact}", doi=f"10.48550/arXiv.{arxiv_id}", warnings=warnings)
    return store_import(root, meta, raw, index, source)


def import_pdf(root: Path, raw: bytes, filename: str, title: str = "") -> Metadata:
    if len(raw) > MAX_BYTES:
        raise ValueError("PDF 超过 100 MB")
    index = pdf_index(raw)
    title = title.strip() or index["document_metadata"].get("title") or Path(filename).stem
    meta = Metadata(paper_id="local-" + uuid.uuid4().hex[:20], version="v1", title=title[:1000],
                    authors=[index["document_metadata"]["author"]] if index["document_metadata"].get("author") else [])
    return store_import(root, meta, raw, index)
