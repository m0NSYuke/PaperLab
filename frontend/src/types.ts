export type PaperType = "method" | "system" | "benchmark" | "survey" | "technical_report" | "analysis" | "other";
export type Paper = {
  schema_version: string;
  paper_id: string;
  version: string;
  title: string;
  authors: string[];
  year: number | null;
  source_url: string | null;
  doi: string | null;
  topics: string[];
  paper_type?: PaperType | null;
  reading_status: "unread" | "reading" | "completed";
  analysis_status:
    "not_analyzed" | "analyzing" | "ready" | "failed" | "needs_review";
  imported_at: string;
  last_opened_at: string | null;
  page_count: number;
  warnings: string[];
};
export type Citation = {
  source_type: "pdf" | "external";
  paper_id: string;
  version: string;
  page: number | null;
  section: string | null;
  quote: string;
  url: string | null;
  verification: "verified" | "unverified" | "missing";
};
export type Claim = {
  claim_id: string;
  text: string;
  section: string;
  claim_type: string;
  citations: Citation[];
  evidence_status: string;
};
export type Equation = {
  equation_id: string;
  title: string;
  latex: string;
  symbols: { symbol: string; definition: string; shape: string | null }[];
  explanation: string;
  derivation: string[];
  derivation_type: string;
  citations: Citation[];
  priority?: "derive" | "understand" | "skip" | null;
};
export type Triage = {
  depth: "deep" | "selective" | "skim";
  depth_source: "user" | "recommended";
  user_context: string;
  role: string;
  paper_type: string;
  problem: string;
  core_change: string;
  headline_result: string;
  cost: string;
  credibility: string;
  rationale: string;
  focus: string[];
  claim_ids: string[];
};
export type Delta = {
  delta_id: string;
  component: string;
  prior: string;
  change: string;
  evidence: string;
  load_bearing: "yes" | "partial" | "no" | "untested";
  claim_ids: string[];
  citations: Citation[];
};
export type EvidenceCheck = {
  check_id: string;
  assertion: string;
  claim_ids: string[];
  experiments: string[];
  strength: "strong" | "moderate" | "weak" | "none";
  fairness: string;
  gaps: string;
};
export type Comparison = {
  title: string;
  dimensions: string[];
  rows: {
    label: string;
    source: "this_paper" | "local_report" | "unverified";
    paper_id: string | null;
    version: string | null;
    cells: string[];
    citations: Citation[];
  }[];
  note: string;
};
export type OutlineItem = {
  title: string;
  page: number;
  level: 1 | 2;
  role: string;
  summary: string;
  key: boolean;
};
export type Report = {
  schema_version: string;
  paper_id: string;
  version: string;
  generated_at: string;
  revision: number;
  analysis_status: string;
  overview: string;
  motivation: string;
  contributions: string;
  method: string;
  mathematics: string;
  training: string;
  inference: string;
  limitations: string;
  experiments: {
    name: string;
    dataset: string;
    baselines: string[];
    metric: string;
    value: string;
    protocol: string;
    citations: Citation[];
  }[];
  related_papers: {
    title: string;
    relation: string;
    explanation: string;
    verified: boolean;
    url: string | null;
    citations: Citation[];
  }[];
  claims: Claim[];
  equations: Equation[];
  concept_links: string[];
  quality_checks: string[];
  reading_guide?: { first_pass: GuideStop[]; must_read: GuideStop[] } | null;
  self_test?: SelfTestItem[];
  tutorial?: {
    introduction: string;
    prerequisites: TeachingUnit[];
    walkthrough: TeachingUnit[];
    worked_examples: TeachingUnit[];
    faq: {question: string; answer: string; citations: Citation[]}[];
  } | null;
  triage?: Triage | null;
  deltas?: Delta[];
  evidence_audit?: EvidenceCheck[];
  comparisons?: Comparison[];
  /** 1.4: the paper's sections in order, with what each does in the argument. */
  outline?: OutlineItem[];
};
export type TeachingUnit = {unit_id: string; title: string; body: string; citations: Citation[]};
export type ReportBlock = {id: string; title: string; section: string; body: string; citations: Citation[]};
export type SavedQuestion = {
  question_id: string; question: string; context: string; section: string; page: number;
  report_revision: number | null; resolved: boolean; created_at: string;
};
export type GuideStop = { page: number; label: string; why: string };
export type SelfTestItem = {
  question_id: string;
  level: "recall" | "understand" | "transfer";
  question: string;
  answer: string;
  citations: Citation[];
};
export type Verdict = "unanswered" | "got_it" | "partial" | "missed";
export type IdeaStatus = "new" | "exploring" | "parked" | "dropped";
export type Idea = {
  idea_id: string;
  text: string;
  status: IdeaStatus;
  source: string;
  created_at: string;
};
export type Study = {
  schema_version: string;
  passes: (1 | 2 | 3)[];
  checked_stops: string[];
  judgment: {
    novelty: number | null;
    effectiveness: number | null;
    problem_size: number | null;
    reasons: string;
    bottleneck: string;
    next_step: string;
  };
  tests: {
    question_id: string;
    my_answer: string;
    verdict: Verdict;
    updated_at: string;
  }[];
  ideas: Idea[];
  updated_at: string | null;
};
export type StudySummary = {
  passes: number[];
  tests_answered: number;
  tests_mastered: number;
  value_score: number | null;
  ideas: number;
};
export type StudyOverview = {
  papers: Record<string, StudySummary>;
  ideas: (Idea & { paper_id: string; version: string; title: string })[];
};
export type Correction = {
  claim_id: string;
  correction_id: string;
  type: string;
  original_text: string;
  corrected_text: string;
  reason: string;
  status: string;
  created_at: string;
};
export type ReadingState = {
  page: number;
  scale: string;
  split: number;
  tab: string;
};
/** A research line (研究线): papers grouped by the idea or direction they serve, in reading order. */
export type ResearchLine = {
  id: string;
  name: string;
  kind: "idea" | "direction";
  question: string;
  status: string;
  keywords?: string[];
  /** `auto`: filed automatically on import and not yet confirmed by the user. */
  papers: { key: string; role: string; why: string; auto?: boolean }[];
};
/** A passage matched by the library-wide knowledge search. */
export type KnowledgeHit = {
  kind: "claim" | "report" | "equation" | "tutorial" | "note" | "memo" | "concept" | "idea";
  kind_label: string;
  paper: string | null;
  memo: string | null;
  concept: string | null;
  idea: string | null;
  line: string | null;
  title: string;
  label: string;
  page: number | null;
  snippet: string;
  score: number;
};
export type GraphNode = {
  id: string;
  type: "paper" | "concept" | "line";
  label: string;
  key?: string;
  kind?: string;
  analysis_status?: string;
};
export type GraphEdge = {
  source: string;
  target: string;
  type: "uses" | "in_line" | "relation" | "compares" | "similar";
  label: string;
};
export type LineIdeaStatus = "spark" | "exploring" | "parked" | "dropped" | "chosen";
/** An idea in a research line's Idea 区 (ideas.json). */
export type LineIdea = {
  id: string;
  line: string;
  title: string;
  body: string;
  status: LineIdeaStatus;
  scores: { novelty: number | null; feasibility: number | null; impact: number | null; cost: number | null };
  pros: string;
  cons: string;
  next_step: string;
  papers: string[];
  created_at: string;
  updated_at: string;
  etag: string;
};
/** A technical tag in the library sidebar, with how many papers carry it. */
export type TagView = { name: string; count: number };
export type BackupStatus = {
  dir: string;
  auto: boolean;
  count: number;
  last: { file: string; created_at: string; files: number; bytes: number } | null;
  error: string;
};
