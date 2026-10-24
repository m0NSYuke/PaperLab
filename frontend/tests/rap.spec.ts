import { test, expect } from "@playwright/test";

test("RAP sources are visible and preparation preserves existing report and PDF", async ({ page, request }) => {
  const prefix = "/api/papers/2410.24164/v4";
  const beforeReport = await (await request.get(prefix + "/report")).json();
  const beforePdf = await (await request.get(prefix + "/pdf")).body();
  await page.goto("/#/paper/2410.24164/v4");
  await page.getByRole("button", { name: "Codex 工作台", exact: true }).click();
  const source = page.getByLabel("RAP 源码状态");
  await expect(source).toContainText("RAP · LaTeX 源码优先阅读");
  await expect(source).toContainText("入口 main.tex");
  await source.getByRole("button", { name: "检查 / 获取 RAP 源码" }).click();
  await expect(page.locator(".job-history")).toContainText("RAP 源码已准备");
  const summary = await (await request.get(prefix + "/sources")).json();
  expect(summary.mode).toBe("latex");
  expect(summary.files.some((f: {path: string}) => f.path === "main.bbl")).toBeTruthy();
  expect(summary.files.some((f: object) => "content" in f)).toBeFalsy();
  expect(await (await request.get(prefix + "/report")).json()).toEqual(beforeReport);
  expect(await (await request.get(prefix + "/pdf")).body()).toEqual(beforePdf);
});
