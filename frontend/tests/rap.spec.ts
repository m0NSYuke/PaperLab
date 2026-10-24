import { test, expect } from "@playwright/test";
import { rap } from "./fixture";

test("RAP sources are visible and preparation preserves existing report and PDF", async ({ page, request }) => {
  // Needs a real arXiv paper with LaTeX sources: set PAPERLAB_E2E_ARXIV before prepare_e2e.py.
  test.skip(!rap, "set PAPERLAB_E2E_ARXIV=<arXiv ID>/<version> to run the RAP source test");
  const prefix = rap!.api;
  const beforeReport = await (await request.get(prefix + "/report")).json();
  const beforePdf = await (await request.get(prefix + "/pdf")).body();
  await page.goto(rap!.route);
  await page.getByRole("button", { name: "Codex 工作台", exact: true }).click();
  const source = page.getByLabel("RAP 源码状态");
  await expect(source).toContainText("RAP · LaTeX 源码优先阅读");
  await expect(source).toContainText("入口 ");
  await source.getByRole("button", { name: "检查 / 获取 RAP 源码" }).click();
  await expect(page.locator(".job-history")).toContainText("RAP 源码已准备");
  const summary = await (await request.get(prefix + "/sources")).json();
  expect(summary.mode).toBe("latex");
  expect(summary.files.some((f: {path: string}) => f.path.endsWith(".tex"))).toBeTruthy();
  expect(summary.files.some((f: object) => "content" in f)).toBeFalsy();
  expect(await (await request.get(prefix + "/report")).json()).toEqual(beforeReport);
  expect(await (await request.get(prefix + "/pdf")).body()).toEqual(beforePdf);
});
