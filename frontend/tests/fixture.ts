import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Written by scripts/prepare_e2e.py next to the isolated workspace it builds.
export const workspace = resolve("../tmp/e2e-workspace");
type Ref = { paper_id: string; version: string };
const fixture: Ref & { rap?: Ref } = JSON.parse(
  readFileSync(resolve(workspace, "e2e-fixture.json"), "utf8"),
);

const paths = (ref: Ref) => ({
  id: ref.paper_id,
  version: ref.version,
  api: `/api/papers/${ref.paper_id}/${ref.version}`,
  route: `/#/paper/${ref.paper_id}/${ref.version}`,
  dir: resolve(workspace, "papers", ref.paper_id, ref.version),
});

/** The bundled demo paper (scripts/make_demo.py): 3 pages with a published sample report. */
export const demo = paths(fixture);
/** An optional real arXiv paper with LaTeX sources (PAPERLAB_E2E_ARXIV). */
export const rap = fixture.rap ? paths(fixture.rap) : null;
export const python = resolve("../backend/.venv/Scripts/python.exe");

/** Opens a report tab whether it is in the tab bar or folded into the "更多章节" menu. */
export async function openTab(page: Page, label: string) {
  const tab = page
    .getByRole("navigation", { name: "报告章节" })
    .getByRole("button", { name: label, exact: true });
  if (await tab.isVisible()) await tab.click();
  else {
    await page.getByRole("button", { name: "更多章节" }).click();
    await page.getByRole("menuitem", { name: new RegExp(`^${label}`) }).click();
  }
  await expect(tab).toHaveClass(/active/);
}

/** Notes open in the live editor; the Markdown textarea is behind 「源码」 (not kept across reloads). */
export async function notesSource(page: Page) {
  await page.getByRole("button", { name: "源码", exact: true }).click();
  return page.getByLabel("个人 Markdown 笔记");
}
