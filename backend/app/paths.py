"""Where the app code lives versus where the user's paper data lives."""
import os
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]


def env_file_values(root: Path = APP_ROOT) -> dict:
    """Values from the git-ignored .env.local next to the app code."""
    values = {}
    env_file = root / ".env.local"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"')
    return values


def data_root() -> Path:
    """papers/, local-assets/, concepts/, knowledge/, research-outputs/ and the data .runtime/.

    PAPERLAB_ROOT (environment only, used by isolated test workspaces) wins, then
    PAPERLAB_DATA_DIR from the environment or .env.local, otherwise the app folder itself
    (papers and assets there are git-ignored).
    """
    configured = os.environ.get("PAPERLAB_ROOT") or os.environ.get("PAPERLAB_DATA_DIR") \
        or env_file_values().get("PAPERLAB_DATA_DIR")
    if configured:
        return Path(configured).absolute()
    return APP_ROOT


def gpt_authored_ids() -> set[str]:
    """Paper IDs whose analysis the user keeps with GPT; web Codex jobs must not rewrite them.

    Configured per machine as a comma-separated PAPERLAB_GPT_AUTHORED in the environment
    or .env.local; empty by default.
    """
    raw = os.environ.get("PAPERLAB_GPT_AUTHORED") or env_file_values().get("PAPERLAB_GPT_AUTHORED") or ""
    return {item.strip() for item in raw.split(",") if item.strip()}
