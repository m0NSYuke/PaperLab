# PaperLab

[简体中文](README.md) | **English**

**Understand papers, not just finish them.** A research-paper reading workspace that runs on your own computer: the original PDF on the left, a source-checked explanation on the right, offline translation of any English you select, and self-tests and research judgment to check whether you really understood.

> The app's interface and its generated explanations are in Simplified Chinese. The workflow (sources, quote checks, research lines, search) works the same for any paper.

[![CI](https://github.com/m0NSYuke/PaperLab/actions/workflows/ci.yml/badge.svg)](https://github.com/m0NSYuke/PaperLab/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-c6613f)
![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-3d3d3a)
![Node 22+](https://img.shields.io/badge/node-22%2B-3d3d3a)

![Reader: the original on the left, the full explanation on the right](docs/images/reader.png)

> The repository contains the platform only and **ships no papers, reports or notes**. You import your own papers; the screenshots show the bundled demo document (written for this project, CC0), which `scripts/make_demo.py` generates.

| Library | Selection translation (offline) |
|---|---|
| ![Library](docs/images/library.png) | ![Selection translation](docs/images/translate.png) |
| **Study: turn understanding into skill** | **Dark theme** |
| ![Study tab](docs/images/study.png) | ![Dark theme](docs/images/library-dark.png) |

## Features

**Reading**
- **Zotero-style reader**: one 48 px toolbar; the paper's table of contents on the left and the explanation pane both collapse, and `F` leaves only the paper. PDF.js rendering, full-text search, zoom, bookmarks, and the reading position saved automatically.
- **Paper table of contents**: the reader's left sidebar numbers every section in the paper's order, with subsections folded under a count (click › to unfold) and a dot on must-reads. A small arrow on each row unfolds what that part does in the argument and what it says; all of these start folded. Click to jump to the page, and the section you are reading is highlighted. Folded, the sidebar becomes a thin rail with one tick per section that still jumps. Many PDFs have no bookmarks; this still gives a full table of contents. Every new report includes it.
- **Reports with sources**: every conclusion carries its page number and a quote from the original; clicking jumps to the page and highlights it. Before publishing, each quote is checked to really appear on that page, and statements are labelled as paper fact, supporting explanation, inference or to-be-verified.
- **Four steps per paper**: ① Skim (is it worth reading, which pages first) → ② Read (one continuous explanation: background, problem, method, training and inference, step-by-step derivations, experiments and an evidence audit, limitations, related work, ending with every claim's source and a correction button) → ③ Self-test and reflection → ④ Notes. Each step ends with a "next step" button, and the library card's 自测与思考 button jumps straight to step ③.
- **Selection translation**: select English text and the translation appears beside it. There is no whole-paper translation; you always read the original PDF (see below).

**Selection translation (fully offline, no quota)**
- Words and terms: the 770k-entry ECDICT offline dictionary plus a 217-term AI / robotics glossary (so *ablation* is rendered as 消融实验, not as the medical term).
- Sentences: Tencent's translation model Hy-MT2 runs on your own GPU through llama.cpp, starts on demand and exits when idle; the glossary is injected into the prompt so terms stay consistent. Translated sentences are cached.
- One click on the card adds a term to the glossary, and later translations follow your choice.

**Study and research judgment**
- **Self-test and reflection**: a three-pass reading route (page numbers jump to the PDF), self-tests where you answer before seeing the reference, a value score (novelty × effectiveness × problem size), and an idea notebook that collects ideas from every paper.
- **Notes and corrections**: Markdown notes with formulas; flagging an AI explanation is kept as an event, and regenerating a report never overwrites what you wrote.
- **Ask with context**: packages the paper, page and selected text for Claude / ChatGPT / Kimi / DeepSeek, in Socratic or Feynman-check mode.

**Memos (随记: ideas that belong to no single paper)**
- The 随记 tab in the top navigation: the memo list on the left (pinned first, most recently edited, searchable by title / tag / text), the editor on the right.
- Paste or drop screenshots and they show inline, with the cursor continuing on the next line; Markdown, $formulas$, code blocks and a source mode are supported.
- Autosaves as you type, `Ctrl S` saves at once; a deletion can be undone for 10 seconds, deleted memos go to `memos/.trash` and earlier versions stay in `memos/.history`.
- Each memo is one Markdown file under `memos/` in the data directory, with images in `memos/assets/`, so Typora and Obsidian display them too.

**Organizing papers by research line**
- **Research lines** in the library sidebar group papers by the idea or direction you are working on. Each line has a one-sentence question it answers, its papers are in reading order, and each card states the paper's role in the line (baseline, base model, method source, risk…). A paper can sit in several lines.
- **Create and manage lines**: click "+" next to 研究线 in the sidebar and fill in a name, a kind (Idea or direction), the question and keywords; an open line has Edit / Delete at the top. New users start here and never have to write a file by hand. Lines are stored in `lines.json` in the data directory, which can also be edited directly (format in `backend/app/lines.py`). Technical tags still filter by method category.
- **Automatic filing on import**: each import (from the web page or `/paper`) scores every line by its keywords (title hits weigh more) plus content similarity to the line's papers, joins the closest line marked 自动归入, and fills in technical tags. Cards offer confirm / move / remove; papers that match no line wait under 未归入研究线. Local only, no model calls.
- **File papers by hand**: the 归类 button on every card lists all lines; tick to add, untick to remove, several lines allowed, or let keywords file it. The sidebar switch 导入时自动归类 turns automatic filing of new imports off, so they all wait for you under 未归入研究线.
- **Idea board**: add as many ideas as you like to each line. Capture a spark in one line (Enter saves it), then expand it later: status (spark / exploring / parked / dropped / chosen), 1–5 scores for novelty, feasibility, impact and cost, pros and risks, the next validating experiment, and the line's papers it relates to. Sort by the composite score (novelty + feasibility + impact − cost) or compare ideas side by side in a table; autosaved, deletions can be undone. Stored in `ideas.json`, and searchable.
- **Knowledge search**: type a keyword (Chinese or English) in the library search box; besides filtering cards by title, it lists matching passages from report text, conclusions with their page numbers, equation explanations, your notes, memos and concept cards. Clicking a conclusion opens the paper at that page. Local BM25 (Chinese split into adjacent character pairs), no model or embedding calls.
- **Knowledge graph**: draws papers, research lines and concept cards as one graph. Edges come from the related work and comparisons the reports name, line membership, the concepts used, and report similarity, each toggleable. Hover to see what a paper connects to; click to read it.
- **Why read this**: the button at the bottom of each card shows, on hover, the reading motivation (from its research lines), the report's one-line takeaway and the parts worth reading closely.
- **Add and remove tags, papers and lines**: click "+" next to 技术标签 in the sidebar to add a tag; hover a tag to rename or delete it (deleting removes it from every paper, never the papers themselves); hover a research line to edit or delete it. A card's 归类 panel ticks that paper's tags, takes a new tag, and ends with 从文献库删除: the report, notes and study records move together to `.trash/` in the data directory, the deletion can be undone at once, and the app itself never deletes anything for good.
- **Filter by paper type**: a row of type buttons under the library heading (method / system / benchmark & dataset / survey / analysis / technical report / other) works in every view (all papers, each line, unfiled, tags, recent), with counts for the current view. The type comes from the report's triage, or from the title when there is no report (Bench, Survey, Technical Report…); each card shows it and the 归类 panel changes it.
- **Sorting**: the whole library and each line keep their own order: default (reading order inside a line, recently opened for the library), import time, publication year, recently opened or title.
- **Concept cards**: the background chapter of step ② starts with the general concepts the paper uses (DiT, video VAE, speculative decoding, RLVR / GRPO, chain-of-thought…), each a paper-independent explanation linked to the library's papers that use it.
- Mark a paper as read at the end of step ③, so 阅读中 / 已完成 in the library reflect real progress.

**More**
- `Ctrl K` command palette and full keyboard control; a Claude-style interface, dark by default in Anthropic black (silver buttons and a slowly drifting background glow that stays still under reduced motion), with a light theme too; phones and iPads on the same Wi-Fi can connect with an access key.
- Research workbench: 22 [Nature Skills](THIRD_PARTY_NOTICES.md) research tasks (writing, polishing, citation checks, figures and more; installed separately).

## Quick start (Windows)

Requires Windows 10/11, Python 3.11+, Node.js 22.12+ and Git.

```powershell
git clone https://github.com/m0NSYuke/PaperLab.git
cd PaperLab
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

`setup.ps1` installs the backend (uv, kept inside the project in `.tools/`, without touching your system Python) and the frontend dependencies, then builds. If npm is unreliable on your network, add `-Registry https://registry.npmmirror.com`.

Then double-click **Start-PaperLab.cmd** and open http://127.0.0.1:8000 ; stop it with **Stop-PaperLab.cmd**.

Want to see it first? Generate the demo paper and its sample report:

```powershell
.\backend\.venv\Scripts\python.exe -X utf8 scripts\make_demo.py
```

## Import papers and generate reports

1. Paste an arXiv link or ID into the library's input box and press Enter (the version is pinned), or upload a local PDF (up to 100 MB). You can read it right away.
2. Open Claude Code in this project folder and run `/paper <arXiv ID or local-ID>`, or run `$paper …` in Codex; the reader's Codex workbench works too (it uses your local Codex's ChatGPT sign-in, no API key).
3. The skill reads the original (LaTeX sources first for arXiv papers, see [RAP](docs/RAP_INTEGRATION.md)), writes a candidate report, and the publisher checks its structure and every quote before writing it. A failed check never overwrites an existing report.

```powershell
# Manual helpers: fetch the original and page text / publish a candidate report
.\backend\.venv\Scripts\python.exe -X utf8 .agents\skills\paper\scripts\paper.py prepare 2410.24164v4
.\backend\.venv\Scripts\python.exe -X utf8 .agents\skills\paper\scripts\paper.py publish tmp\candidate-report.json
```

The report format is described in [docs/REPORT_SCHEMA.md](docs/REPORT_SCHEMA.md) and `docs/schemas/`.

## Optional: offline selection translation

Selection still works without it: with no model it only looks words up; with no dictionary the card says so. All three pieces go into the git-ignored `models/` folder (or wherever `.env.local` points, see [.env.example](.env.example)).

1. **Dictionary**: download `ecdict.csv` from [ECDICT](https://github.com/skywind3000/ECDICT), then
   `.\backend\.venv\Scripts\python.exe scripts\build_dictionary.py ecdict.csv models\ecdict.db`
2. **Translation model**: from Hugging Face, download [Hy-MT2-7B-Q4_K_M.gguf](https://huggingface.co/tencent/Hy-MT2-7B-GGUF) (4.6 GB, fits entirely in 8 GB of VRAM) or the lighter [Hy-MT2-1.8B](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF) (1.1 GB, fine on a CPU) into `models/`.
3. **Runtime**: download the Windows build from [llama.cpp Releases](https://github.com/ggml-org/llama.cpp/releases) (for NVIDIA GPUs, the CUDA build plus its `cudart` package) and unpack it into `models/llama.cpp/`.

The first sentence loads the model onto the GPU, about 5 seconds on an RTX 4060; after that each sentence takes about 1–2 seconds. The model listens only on 127.0.0.1, with a random port and a one-time key on every start, and exits after 15 idle minutes.

## Optional: Nature Skills research skills

The 22 research-task skills come from the third-party repository [Yuan1z0825/nature-skills](https://github.com/Yuan1z0825/nature-skills) (Apache-2.0) and are not bundled. Install them when you want the full writing desk and research tools:

```powershell
python scripts\install-nature-skills.py      # downloads a pinned version and verifies every file's hash
python scripts\verify-nature-skills.py       # optional: verify again
```

## Reading on a phone or iPad

With the computer and the device on the same private Wi-Fi, stop the service and double-click **Start-PaperLab-LAN.cmd**; the window shows `http://192.168.x.x:8000/?key=…`. Open it once on the device and it remembers the key (you can add it to the home screen); long-press English text to translate it. Windows must treat that network as Private. Deleting `.runtime/lan-token` invalidates old links. Campus and other public networks usually isolate devices, so a phone hotspot works better there.

## Privacy and data

- All papers, reports, notes and study records are plain local files (JSON / Markdown), kept in the project folder by default and ignored by Git; set `PAPERLAB_DATA_DIR` in `.env.local` to move them to another disk.
- The service binds to 127.0.0.1 only (LAN mode requires the key). The web page calls no model API and needs no API key; the Codex workbench uses your locally signed-in Codex CLI, and selection translation is fully offline.
- Automatic backups: when the service starts and every 24 hours while it runs, everything you wrote (papers/, memos/, concepts/, knowledge/, research-outputs/, lines.json, ideas.json, tags.json and imported local PDFs) is zipped into `PAPERLAB_BACKUP_DIR` (default `~/PaperLab-backups`, off the data drive; several PaperLab installs on one computer each manage only their own backups). Unchanged data is skipped and the latest 10 are kept. The library's bottom-left corner shows the last backup time and a back-up-now button. arXiv PDFs and LaTeX can be downloaded again and are left out. To restore, unzip a backup back into the data directory.

```text
<data directory>/
  papers/<ID>/<vN>/        metadata.json · report.json/md · notes.md · study.json · corrections.jsonl
  local-assets/<ID>/<vN>/  original PDF, LaTeX sources, page-text cache
  memos/                   memos: <id>.md · assets/ images · .history/ earlier versions · .trash/ deleted
  lines.json               research lines: papers grouped by idea / direction, in reading order
  ideas.json               ideas, scores and tradeoffs from each line's idea board
  tags.json                the technical-tag list (built-in defaults until you edit it)
  .trash/                  papers deleted from the library (undoable, clean up by hand)
  concepts/  knowledge/  research-outputs/
```

## Keyboard shortcuts

`Ctrl K` command palette (type a page number to jump) · `1`–`4` switch between Skim / Read / Self-test / Notes · `[` `]` previous / next page · `Ctrl F` or `/` search the original · `F` focus mode · `T` toggle selection translation · `A` ask with context

## Project layout

```text
frontend/          React 19 + TypeScript + Vite + PDF.js + KaTeX
backend/app/       FastAPI: import, version pinning, storage, report validation and publishing, translation, Codex jobs
backend/tests/     backend tests (pytest)
frontend/tests/    browser end-to-end tests (Playwright, on a generated demo paper, never your papers)
.agents/skills/    paper (report generation) · rap (source-first paper reading) · nature-* (after installation)
.claude/skills/    Claude Code entry points for /paper and /rap
scripts/           setup, start, test, demo data, dictionary build, Nature Skills installation
docs/              requirements, architecture, technical decisions, report schema
```

Technical decisions and tradeoffs are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## Development and testing

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test.ps1            # backend tests + frontend build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test.ps1 -Browser   # plus Chrome end-to-end tests
```

During development: `.\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --port 8000`, and in another terminal `cd frontend; npm run dev`, then open http://127.0.0.1:5173 . GitHub Actions runs the backend tests and the frontend build on every push.

## FAQ

- **Port in use / fails to start**: see `.runtime/server-error.log`; the stop script only ends the service it started.
- **A citation is not highlighted**: PDF glyphs and line breaks can keep the sentence from being found as a whole; it still jumps to the right page. A quote check proves the text exists, not that the interpretation is right, so check important conclusions against the original.
- **Scanned PDFs**: there is no OCR, and the analysis is marked as limited.
- **Translation says the local model is missing**: check the paths in `models/` or `.env.local`; the dictionary works on its own.
- **Platforms**: the scripts target Windows; the backend and frontend themselves are cross-platform, and on macOS / Linux you start them yourself with uv and npm.

## License and acknowledgements

PaperLab is released under the [MIT](LICENSE) license. Sources and licenses of third-party skills, dependencies, models and design references are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): Nature Skills (Yuan1z0825, Apache-2.0), the `read-arxiv-paper` method (karpathy/nanochat, MIT), PDF.js, ECDICT, Tencent Hy-MT2, llama.cpp and others. Papers you import remain under their authors' copyright and licenses.
