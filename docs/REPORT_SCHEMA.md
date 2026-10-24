# Persistent data contract

Generated JSON Schemas are in schemas/. Regenerate via `cd backend; .\.venv\Scripts\python.exe -m app.cli schemas`. Pydantic models in app/models.py are the source of truth.

- metadata.schema.json: source identity, exact version, title/authors/year/DOI, relative asset paths, PDF/source hashes, topics, reading/analysis states and timestamps.
- report.schema.json: required research sections, claims with source classification, equations and symbols/derivations, structured experiment values/protocols, relations, concepts, quality checks and revision.
- correction.schema.json: append-only event identity, stable target claim/equation ID, original/corrected text, reason, type, status and timestamp.

source-index.json contains schema_version, paper_id, version, PDF hash, page_count and all report citations. During initial import citations is empty. Page text/cache is ignored under local-assets, not mixed into versioned personal notes.

Every JSON file has schema_version=1.0. The corrections JSONL schema is validated per event; API notes are UTF-8 Markdown. A correction status change creates a new event, never rewrites old history. On regeneration accepted corrections are shown separately and mark conflicts for review.

Missing page numbers are null, never invented. A verified PDF citation requires a 1-based page and nonempty quote, and the publisher checks normalized quote existence on that page. External references must be independently verified by the analyst; the offline publisher cannot validate a remote page. Supported claim status requires citations; a ready report requires verified evidence for all paper_fact claims. needs_review reports may retain explicitly labeled gaps.

No V0 dataset existed; future incompatible changes must introduce explicit migration and preserve old source/human files before emitting a newer schema_version.
