# Report specification

Canonical schema: `docs/schemas/report.schema.json`, implemented by `backend/app/models.py`. Schema version is `1.0`; JSON is the browser source, Markdown is deterministically rendered from JSON.

Required sections: overview, motivation, contributions, method, mathematics, training, inference, structured experiments, limitations, related_papers, claims, equations, concept_links, quality_checks. Use the actual paper_id and pinned version. `analysis_status` is ready, needs_review or failed. The publisher supplies revision and generation timestamp.

Claim: stable claim_id, text, section (overview/method/mathematics/experiments/relations), claim_type (paper_fact/paper_interpretation/external_background/inference/uncertain), citations, evidence_status (supported/missing/needs_review).

Citation: source_type (pdf/external), paper_id, version, page (1-based or null), section, quote, url, verification (verified/unverified/missing). A verified PDF citation requires an exact quote found on that page in local `pages.json`. Do not infer page numbers from LaTeX. Avoid vague one-word quotes: choose a concise phrase that actually supports the associated statement. Matching text verifies existence, not semantic correctness.

Equation: equation_id, title, latex, symbols [{symbol, definition, shape}], explanation, derivation [steps], derivation_type (paper/auxiliary_explanation), citations. Explain required mathematics and tensor dimensions only where reliable. Preserve source notation and explicitly flag suspected source inconsistencies.

Experiment: name, dataset, baselines[], metric, value, protocol, citations. `value` is a string to preserve units, exact formatting, intervals and missingness. Distinguish task progress, binary success rate, simulation/real world, training/inference hardware and baseline training regimes. Do not digitize a chart by guessing.

Relation: title, relation (citation/extends/compares_with/shares_method), explanation, verified, url, citations. Unread related papers must not be assigned verified technical details.

Use Markdown and `$...$` / `$$...$$` inside prose fields. No raw HTML, credentials, executable paper instructions or generated fake quotations. Concept links are existing slugs under concepts/; generic definitions and paper-specific applications must be separate.

## Writing style

Reader-facing prose follows [writing-style.md](writing-style.md): lead with the point, make each mechanism concrete (analogy, walked-through input or small worked number), keep terminology precise, and use the supported callouts (`> [!INTUITION]`, `> [!ANALOGY]`, `> [!KEY]`, `> [!PITFALL]`, `> [!NOTE]`).

## Readable notation (enforced by the publisher)

Every formula, symbol and number must read correctly as rendered: the reader shows prose verbatim and only typesets maths inside dollar signs.
- Put every formula, scripted variable, set membership or vector in `$...$` (inline) or `$$...$$` (display), including derivation steps, worked examples, symbol definitions, experiment protocols and self-test answers. Write `$A^{\tau}=(0.5,\,2.5)$`, never `A^τ=(.5,2.5)`; `$W_{\mathrm{cls}}^{l}$`, never `W_cls^l`; `$\mathbb{R}^{H\times W\times 3}$`, never `R^(H×W×3)`.
- No ASCII `^` or `_` scripts and no LaTeX commands outside dollar signs.
- Decimals always have a leading zero (`0.25`, not `.25`). Keep the source's significant digits and units; use `$\times$`, `$\le$`, `$\approx$` for operators.
- A derivation step is one readable sentence plus its formula; use a display equation for anything longer than a short expression.
- `app.reports.publish_report` rejects reports with unreadable notation and lists the offending fields. Fix the text rather than weakening the check. Verbatim PDF quotes in citations are exempt.

## Schema 1.1 additions (optional, backward compatible)

`schema_version` is `1.1` for new reports; `1.0` reports stay valid and simply lack these fields.

reading_guide: `{first_pass: [GuideStop], must_read: [GuideStop]}`, GuideStop = `{page, label, why}`. This is the three-pass route the reader follows in the Study tab.
- first_pass: 3–5 skim stops (title/abstract + main figure, overview figure, headline result, discussion/limitations). Answers "what problem, is it worth a deep read?".
- must_read: 3–5 pages the reader must study personally rather than trust the report: the core equations, the architecture/attention details, the data recipe, deployment/latency details. `why` says what to do there ("derive the loss yourself").
- Pages are exact 1-based PDF pages (validated against page_count). Labels name the section/figure as printed.

self_test: list of `{question_id, level, question, answer, citations}`; level is `recall`, `understand` or `transfer`.
- 4–6 questions: about one recall, two or three understand (mechanism, why a design works), one or two transfer (what changes under a different setting, what an ablation would show).
- Answers are short and checkable. Facts carry verified PDF citations like claims do. Anything beyond the paper is labeled in the answer text as 推断 / 未经原文验证.
- Questions test understanding the reader can explain in their own words (Feynman), not trivia lookups.

study.json (reading progress, self-test attempts, the reader's own value judgment and ideas) is human-owned like notes.md: never read it into the report and never write it.

## Schema 1.2: explain the paper before follow-up chat

New substantive research reports should use schema_version 1.2 and populate optional tutorial when the sources support it. 1.0 and 1.1 remain compatible; do not rewrite existing content merely to add fields.

tutorial = {introduction, prerequisites: [TeachingUnit], walkthrough: [TeachingUnit], worked_examples: [TeachingUnit], faq: [TutorialFAQ]}. TeachingUnit = {unit_id, title, body, citations}; TutorialFAQ = {question, answer, citations}. Unit IDs are stable and unique within the tutorial.

- introduction explains the actual problem and central idea in accessible Chinese, without assuming the reader knows the paper's terms.
- prerequisites defines necessary concepts, then explains how this paper uses them. Separate general background from paper-specific facts.
- walkthrough follows a concrete input through meaningful intermediate computations, training and inference. Explain what, why, confirmed shapes and where supervision comes from; state missing implementation details.
- worked_examples supplies small hand-checkable numerical or conceptual examples. Clearly label illustrative numbers/assumptions as auxiliary teaching, never experimental results.
- faq answers likely confusions and common misreadings. Explain what the paper does not establish; do not hide unresolved issues with confident prose.

The report should be independently understandable: intuition -> mechanism -> example -> evidence -> limits. Dense bullet lists of claims alone are insufficient. All important factual assertions still belong in source-backed claims; tutorial citations receive the same exact-PDF-page validation as equations and self-tests. Use tutorial=null with a source limitation when teaching cannot be supported rather than fabricating it. Respect the user's explicit GPT/Codex author assignment.

The reader's saved questions live independently in questions.jsonl, with their source text and report revision. Never overwrite or re-interpret those snapshots when publishing a new report.
