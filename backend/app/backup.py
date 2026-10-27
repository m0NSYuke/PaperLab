"""Automatic snapshots of everything the user wrote, so one bad write or disk mistake is recoverable.

Each snapshot is one zip in the backup folder: PAPERLAB_BACKUP_DIR (environment or .env.local),
default ~/PaperLab-backups so it sits off the data drive (shared folder, but each data directory
keeps and rotates only its own tagged snapshots). The server takes one when it starts and
every 24 hours while it runs, skips it when nothing changed, and keeps the newest KEEP.
Included: papers/, memos/, concepts/, knowledge/, research-outputs/, lines.json, ideas.json and imported local
PDFs (local-assets/local-*). arXiv PDFs and LaTeX can be downloaded again and stay out.
"""
import hashlib
import json
import os
import threading
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from .models import now
from .paths import env_file_values
from .storage import atomic_write

FOLDERS = ["papers", "memos", "concepts", "knowledge", "research-outputs"]
KEEP = 10
EVERY = 24 * 3600


def default_dir() -> Path:
    configured = os.environ.get("PAPERLAB_BACKUP_DIR") or env_file_values().get("PAPERLAB_BACKUP_DIR")
    return Path(configured).absolute() if configured else Path.home() / "PaperLab-backups"


def included(root: Path):
    roots = [root / name for name in FOLDERS] + sorted((root / "local-assets").glob("local-*"))
    for top in roots:
        if top.is_dir():
            for path in sorted(top.rglob("*")):
                # .write-*.tmp are atomic writes still in flight.
                if path.is_file() and not path.name.startswith(".write-"):
                    yield path
    for name in ("lines.json", "ideas.json"):
        if (root / name).is_file():
            yield root / name


def fingerprint(files, root: Path) -> str:
    digest = hashlib.sha256()
    for path in files:
        stat = path.stat()
        digest.update(f"{path.relative_to(root).as_posix()}\0{stat.st_size}\0{stat.st_mtime_ns}\n".encode())
    return digest.hexdigest()


class Backups:
    def __init__(self, root: Path, folder: Path):
        self.root, self.folder = root, folder
        # Several installs on one machine share the default folder; each data directory
        # keeps and rotates only its own snapshots, tagged by a hash of its path.
        self.tag = hashlib.sha256(str(root.resolve()).lower().encode()).hexdigest()[:8]
        self.error = ""
        self.lock = threading.Lock()

    def latest(self):
        path = self.folder / f"latest-{self.tag}.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def snapshots(self):
        return sorted(self.folder.glob(f"paperlab-{self.tag}-*.zip"))

    def status(self, auto: bool):
        last = self.latest()
        if last and not (self.folder / last["file"]).exists():
            last = None
        return {"dir": str(self.folder), "auto": auto, "count": len(self.snapshots()),
                "last": last and {k: last[k] for k in ("file", "created_at", "files", "bytes")}, "error": self.error}

    def snapshot(self):
        """Write a new zip unless nothing changed since the last one; returns its file name or None."""
        with self.lock:
            files = list(included(self.root))
            if not files:
                return None  # nothing written yet: an empty library needs no backup
            mark = fingerprint(files, self.root)
            last = self.latest()
            if last and last.get("fingerprint") == mark and (self.folder / last["file"]).exists():
                return None
            self.folder.mkdir(parents=True, exist_ok=True)
            for stale in self.folder.glob(f"paperlab-{self.tag}-*.partial"):
                stale.unlink()  # left by a server stopped mid-snapshot
            stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')[:-3]
            name, n = f"paperlab-{self.tag}-{stamp}.zip", 1
            while (self.folder / name).exists():  # two snapshots within one millisecond
                name, n = f"paperlab-{self.tag}-{stamp}-{n}.zip", n + 1
            partial = self.folder / (name + ".partial")
            count = 0
            with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for path in files:
                    try:
                        archive.write(path, path.relative_to(self.root).as_posix())
                        count += 1
                    except FileNotFoundError:
                        continue  # removed while we were copying; the next snapshot reflects it
            os.replace(partial, self.folder / name)
            atomic_write(self.folder / f"latest-{self.tag}.json", json.dumps(
                {"file": name, "created_at": now(), "files": count, "bytes": (self.folder / name).stat().st_size,
                 "fingerprint": mark}, ensure_ascii=False, indent=2))
            for old in self.snapshots()[:-KEEP]:
                old.unlink()
            self.error = ""
            return name

    def run(self):
        try:
            self.snapshot()
        except Exception as exc:  # a failed backup must never take the server down
            self.error = f"{type(exc).__name__}: {str(exc)[:200]}"


def register_backup(app, root: Path, folder: Path, auto: bool):
    backups = Backups(root, folder)

    @app.get("/api/backup")
    def backup_status():
        return backups.status(auto)

    @app.post("/api/backup")
    def backup_now():
        backups.run()
        return backups.status(auto)

    if auto:
        # Started with the server, not at import, so importing the app (tests, scripts) never backs up.
        def start_backups():
            def loop():
                while True:
                    backups.run()
                    time.sleep(EVERY)
            threading.Thread(target=loop, name="paperlab-backup", daemon=True).start()
        app.router.on_startup.append(start_backups)
