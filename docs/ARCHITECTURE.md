# Architecture

```text
React Library / Reader
  -> same-origin /api (FastAPI, loopback)
     -> papers/ID/vN/{metadata,report,source-index}.json
     -> papers/ID/vN/notes.md, corrections.jsonl
     -> local-assets/ID/vN/{paper.pdf,pages.json,source.tar.gz,source/}
     -> concepts/{index.json,*.md}

Codex $paper -> deterministic CLI importer -> original text + LaTeX
            -> Codex analysis -> candidate JSON -> validated publisher
            -> report JSON + Markdown + source index (human files retained)
```

`backend/app/importer.py` pins source versions and hashes files. `storage.py` owns safe paths, atomic writes and process locks. `models.py` defines persistent schemas. `reports.py` validates citations, preserves correction history, builds Markdown, handles regeneration conflicts. `main.py` exposes resource-specific endpoints and serves the static build. `cli.py` shares import/publish behavior with the skill.

Frontend pages own navigation. PdfPane wraps mature PDF.js viewer/search/link components; ReportPane renders six sections with Markdown/KaTeX, evidence chips and correction states. Notes saves text with etags. Reader persists lightweight reading settings in the browser and generates editable ChatGPT context. There is no AI HTTP endpoint or command-execution endpoint.

Report polling every 10 seconds detects completed Codex output. A malformed paper produces a warning or section error without breaking the whole library. Imports publish metadata last so incomplete downloads do not appear as usable entries. Files are stable by paper/version; adding a version creates another entry.
