import type { PaperType } from "../../types";

/** Paper genres as conference reviewers sort them, in the order the library shows them. */
export const PAPER_TYPES: [PaperType, string, string][] = [
  ["method", "方法", "Method"],
  ["system", "系统", "System"],
  ["benchmark", "基准与数据集", "Benchmark"],
  ["survey", "综述", "Survey"],
  ["analysis", "分析与实证", "Analysis"],
  ["technical_report", "技术报告", "Tech Report"],
  ["other", "其他", "Other"],
];

export const paperTypeLabel: Record<string, string> = Object.fromEntries(PAPER_TYPES.map(([k, zh]) => [k, zh]));

/** Papers imported before types existed count as "other" until classified. */
export const typeOf = (p: { paper_type?: PaperType | null }): PaperType => p.paper_type || "other";
