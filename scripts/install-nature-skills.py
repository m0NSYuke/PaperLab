"""Install the third-party Nature Skills bundle into .agents/skills.

The bundle (Yuan1z0825/nature-skills, Apache-2.0) is not vendored in this
repository. This script downloads the exact upstream commit recorded in
docs/nature-skills-installation.json, copies only the files listed there and
checks each one's size, SHA-256 and Git blob hash before writing it.
Nothing from the bundle is executed.

Usage:  python scripts/install-nature-skills.py [--force]
"""
import argparse
import hashlib
import io
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs" / "nature-skills-installation.json"


def blob_sha1(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="replace installed files that differ from the manifest")
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    destination = (ROOT / manifest["destination"]).resolve()
    repo, commit = manifest["repository"], manifest["commit"]
    expected = {item["path"]: item for item in manifest["files"]}

    url = f"https://codeload.github.com/{repo}/tar.gz/{commit}"
    print(f"Downloading {repo}@{commit[:12]} …")
    with urllib.request.urlopen(url, timeout=120) as response:
        archive = tarfile.open(fileobj=io.BytesIO(response.read()), mode="r:gz")

    # Upstream keeps each skill under skills/<name>/; the archive adds one top folder.
    found = {}
    for member in archive.getmembers():
        parts = member.name.split("/", 2)
        if len(parts) == 3 and parts[1] == "skills" and member.isfile() and parts[2] in expected:
            found[parts[2]] = archive.extractfile(member).read()
    missing = sorted(set(expected) - set(found))
    if missing:
        sys.exit(f"Upstream archive lacks {len(missing)} manifest files, e.g. {missing[0]}")

    written = skipped = 0
    for relative, data in found.items():
        item = expected[relative]
        if len(data) != item["size"] or hashlib.sha256(data).hexdigest() != item["sha256"] \
                or blob_sha1(data) != item["git_blob_sha1"]:
            sys.exit(f"Hash mismatch for {relative}; refusing to install anything further")
        target = (destination / relative).resolve()
        if not target.is_relative_to(destination):
            sys.exit(f"Unsafe path in manifest: {relative}")
        if target.exists():
            if target.read_bytes() == data:
                skipped += 1
                continue
            if not args.force:
                sys.exit(f"{relative} exists with different content; rerun with --force to replace it")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        written += 1
    print(f"Installed {written} files ({skipped} already up to date) for {manifest['task_skill_count']} task skills "
          f"and {manifest['support_package_count']} shared package into {manifest['destination']}.")
    print("License and notices: docs/third-party/nature-skills/. Verify with: python scripts/verify-nature-skills.py")


if __name__ == "__main__":
    main()
