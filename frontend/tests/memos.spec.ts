import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MEMOS = resolve("../tmp/e2e-workspace/memos");

test("memos: pasted screenshots show as images, writing continues below, autosave survives reload, delete can be undone", async ({ page }) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await page.goto("/#/memos");
  await page.getByRole("button", { name: "新建" }).click();
  await expect(page).toHaveURL(/#\/memos\?id=memo-[0-9a-f]{12}$/);
  await page.getByLabel("标题").fill("自适应动作块长度");
  await page.getByLabel("标题").press("Enter");
  await page.keyboard.type("置信度低时缩短动作块。");
  // Paste a screenshot into the paragraph being edited.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#c6613f";
    g.fillRect(0, 0, 320, 180);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
    const data = new DataTransfer();
    data.items.add(new File([blob], "image.png", { type: "image/png" }));
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const image = page.locator(".memo-body img.markdown-image");
  await expect(image).toHaveCount(1);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);
  // The caret sits on a fresh line under the image.
  await expect(page.locator(".memo-body .live-block-input")).toBeFocused();
  await page.keyboard.type("图片下面接着写。");
  await page.getByLabel("添加标签").fill("VLA");
  await page.getByLabel("添加标签").press("Enter");
  await expect(page.locator(".memo-state")).toHaveText(/已保存/);

  const file = readdirSync(MEMOS).find((name) => name.endsWith(".md"))!;
  const text = readFileSync(resolve(MEMOS, file), "utf8");
  expect(text).toContain("title: 自适应动作块长度");
  expect(text).toContain("tags: VLA");
  expect(text.indexOf("置信度低时")).toBeLessThan(text.indexOf("](assets/"));
  expect(text.indexOf("](assets/")).toBeLessThan(text.indexOf("图片下面接着写"));

  await page.reload();
  await expect(page.getByLabel("标题")).toHaveValue("自适应动作块长度");
  await expect(page.locator(".memo-body img.markdown-image")).toHaveCount(1);
  await page.getByLabel("搜索随记").fill("接着写");
  await expect(page.locator(".memos-items li")).toHaveCount(1);
  await page.getByLabel("搜索随记").fill("");

  await page.getByRole("button", { name: "删除这条随记" }).click();
  await expect(page.locator(".memos-items li")).toHaveCount(0);
  await page.locator(".memo-undo").getByRole("button", { name: "撤销" }).click();
  await expect(page.getByLabel("标题")).toHaveValue("自适应动作块长度");
  await expect(page.locator(".memos-items li")).toHaveCount(1);
  expect(exceptions).toEqual([]);
});
