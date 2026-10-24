import hashlib
import json
import os
import re
import tempfile
import threading
import time
from pathlib import Path
from contextlib import contextmanager

LOCK = threading.RLock()
ID = re.compile(r"(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*-\d{7}|local-[a-f0-9]{16,32})\Z")
VERSION = re.compile(r"v[1-9]\d*\Z")


def safe_path(root: Path, *parts: str) -> Path:
    root = root.absolute()
    path = root.joinpath(*parts)
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError("Path escapes workspace")
    for candidate in (path, *path.parents):
        if candidate.is_symlink() or (hasattr(candidate, "is_junction") and candidate.is_junction()):
            raise ValueError("Linked data paths are not allowed")
        if candidate == root:
            break
    return path


def paper_dir(root: Path, paper_id: str, version: str, assets=False) -> Path:
    if not ID.fullmatch(paper_id) or not VERSION.fullmatch(version):
        raise ValueError("Invalid paper identifier or version")
    return safe_path(root, "local-assets" if assets else "papers", paper_id, version)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write(path: Path, data: str | bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = data.encode("utf-8") if isinstance(data, str) else data
    fd, tmp = tempfile.mkstemp(prefix=".write-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        # Windows readers/virus scanners can briefly hold a handle without
        # FILE_SHARE_DELETE. Never delete an old file to force replacement.
        for attempt in range(7):
            try:
                os.replace(tmp, path)
                break
            except PermissionError:
                if attempt == 6:
                    raise
                time.sleep(0.025 * 2**attempt)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def write_json(path: Path, data):
    atomic_write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


@contextmanager
def data_lock(root: Path):
    """Thread and process lock: skill CLI and API cannot overwrite each other."""
    root.mkdir(parents=True, exist_ok=True)
    lock_path = safe_path(root, ".runtime", "data.lock")
    lock_path.parent.mkdir(exist_ok=True)
    with LOCK, open(lock_path, "a+b") as handle:
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)
