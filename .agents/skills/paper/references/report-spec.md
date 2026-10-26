# Report specification

Canonical schema: `docs/schemas/report.schema.json`, implemented by `backend/app/models.py`. New reports use schema version `1.3` (see the last section); 1.0–1.2 reports stay valid. JSON is the browser source, Markdown is deterministically rendered from JSON in reading-chain order: triage → overview / motivation / contributions → deltas → comparisons → tutorial → method / training / inference → mathematics and equations → experiments → evidence audit → limitations → relations and evidence.

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

## Schema 1.3: the reading chain

New reports use `schema_version: "1.3"`. The publisher rejects a 1.3 report that breaks any rule marked **(enforced)**.

### Reading depth

`triage.depth` is `deep` (精读), `selective` (选读) or `skim` (略读). A depth word from the user wins (`depth_source: user`); otherwise recommend one (`depth_source: recommended`) and say why in `rationale`. The reader's own verdict stays in study.json; the triage is a recommendation.

- deep: the paper is the user's baseline, base model or benchmark to beat; its method may be reused directly; or its results contradict common expectations. Full chain: tutorial, every equation, deltas **(enforced: at least one)**, evidence_audit **(enforced when experiments exist)**.
- selective: only some parts matter to the user (for example only the verification rule). `triage.focus` names those parts **(enforced: non-empty)**; give them deep treatment and keep the rest concise.
- skim: background, surveys, distant methods. Triage plus concise required sections; tutorial may be null; equations only when the core change needs them. Claims and citations keep the same rules.

### triage (required in 1.3, enforced)

`{depth, depth_source, user_context, role, paper_type, problem, core_change, headline_result, cost, credibility, rationale, focus[], claim_ids[]}`.
- `user_context` is the user's own sentence, verbatim; `role` restates it (对标论文, 基座, 方法来源, 背景, 对比基线). Both stay empty when the user gave none.
- `paper_type`: method, system, benchmark, survey, technical_report, analysis or other.
- `headline_result` states the main number with its protocol (dataset, hardware, baseline). `cost` covers training, compute, quality loss or extra components. `credibility` is a short first judgment (single benchmark, missing ablation, matched baselines).
- `claim_ids` lists the claims that carry the triage **(enforced: at least one, all must exist)**.

### deltas: what changed against prior work

`{delta_id, component, prior, change, evidence, load_bearing, claim_ids[], citations[]}`. One row per distinctive component. `prior` names the predecessor and its practice; `evidence` names the ablation or controlled comparison. `load_bearing` is yes / partial / no only with a referenced claim or verified citation **(enforced)**; otherwise `untested`. Inherited components belong here too, marked as inherited in `change`, so the reader sees what is actually new.

### evidence_audit: claim → experiment

`{check_id, assertion, claim_ids[], experiments[], strength, fairness, gaps}`. `claim_ids` and `experiments` must exist in this report **(enforced)**; strength strong / moderate needs at least one experiment **(enforced)**. `fairness` checks data, steps, hardware and tuning budget across compared methods; `gaps` names the missing experiment that would settle the claim.

### Equation priority

Every 1.3 equation has `priority` **(enforced)**: `derive` (new and load-bearing: the reader works it out, then reveals the derivation), `understand` (inherited or standard: know what it means), `skip` (implementation detail). Write the derivation completely for derive and understand equations; the reader shows it collapsed.

### Cross-paper comparison

`comparisons: [{title, dimensions[], rows[{label, source, paper_id, version, cells[], citations[]}], note}]`, at least two rows, one cell per dimension **(enforced)**.
- `this_paper`: values printed in this paper's PDF, including its own baseline tables. Cite them with verified quotes from this paper.
- `local_report`: values from another library paper with a published report. `paper_id` and `version` are required **(enforced)**; citations may quote that paper's PDF and are verified against its pages **(enforced)**.
- `unverified`: a paper outside the library. Qualitative cells only, no digits **(enforced)**. Never fill numbers from memory.
- Compare only like with like. When benchmarks, step counts or hardware differ, say so in `note` or in the cell.

### Number traceability (enforced)

Every number with a decimal point or at least two digits in triage, deltas, evidence_audit and comparison cells must appear in this report's claims, experiment records or verified quotes; a `local_report` row's numbers must appear in that paper's published report or the row's verified quotes. arXiv IDs and calendar years are exempt. When the publisher names an untraceable number, add the supporting claim with its verified quote or correct the number; never delete the evidence to pass.
