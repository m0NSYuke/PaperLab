import { useSyncExternalStore } from "react";
import { readLocal, writeLocal } from "./api";

/** Reading-surface tint: plain white paper or a warm sepia eye-care tone. */
export type PaperTone = "white" | "sepia";
export const PAPER_TONES: [PaperTone, string][] = [
  ["white", "白色"],
  ["sepia", "米黄护眼"],
];

const KEY = "paperlab.paperTone";
let tone: PaperTone = readLocal<PaperTone>(KEY, "white") === "sepia" ? "sepia" : "white";
const listeners = new Set<() => void>();
document.documentElement.dataset.paper = tone;

export function setPaperTone(next: PaperTone) {
  tone = next;
  document.documentElement.dataset.paper = next;
  writeLocal(KEY, next);
  listeners.forEach((l) => l());
}

export function usePaperTone() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tone,
  );
}
