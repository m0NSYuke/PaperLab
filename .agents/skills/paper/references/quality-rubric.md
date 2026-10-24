# Quality rubric

Target for future human review: method/math 25, experimental completeness 20, provenance 20, motivation/innovation 15, teaching clarity 10, relations/concept reuse 10. Do not claim an independently verified score without an independent review.

- Read the pinned PDF and corresponding LaTeX. PDF is final for pages and visible formulas.
- Check math against original equations, symbol definitions, time axes and dimensions. Mark supplemental derivations and examples as teaching.
- Prose follows writing-style.md: answer first, a concrete picture or hand-checkable example for each mechanism, precise professional terms, no rigid repeated templates.
- Notation must be readable as rendered: formulas and scripted symbols only inside `$...$` / `$$...$$`, decimals with a leading zero. Follow report-spec "Readable notation".
- Check experimental units, sample counts, task scoring, baseline data and training budget. Missing hyperparameters stay missing; chart heights do not become fabricated precise values.
- Ensure every critical paper fact is represented by a claim with an actually supporting citation. Review support semantically, not just substring matching. Retain unverified status where necessary.
- Read accepted human corrections before generation. Retain stable claim IDs, never remove notes/correction files, and require review when regenerated explanations disagree with accepted corrections.
- If sources disagree, explain the discrepancy and set needs_review. If extraction fails, report parsing limits instead of manufacturing a full report.
- Validate candidate with the publisher; inspect JSON, Markdown and key rendered pages. List actual checks and limits. No blanket 95% accuracy assertion based solely on a quote-match script.
