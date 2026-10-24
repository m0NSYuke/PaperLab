export type ResearchSkill = {
  id: string; name: string; title: string; category: string; summary: string;
  mode: "web" | "codex"; requirement: string; installed: boolean; enabled: boolean;
};
export type ResearchJob = {
  job_id: string; skill_id: string; skill_title: string; title: string; mode: "web" | "codex";
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "prepared";
  progress: number; message: string; created_at: string; updated_at: string;
  receipt: {engine: string; auth?: string} | null; handoff_prompt?: string;
  human_edited?: boolean;
  sources: {paper_id: string; version: string; title: string; scope: string}[];
};
export type ResearchResult = {
  job: ResearchJob; content: string; etag: string; editable: boolean;
  warnings: string[]; human_edited?: boolean;
  citations: {paper_id: string; version: string; page: number; quote: string}[];
};
