import { test, expect } from "@playwright/test";
import { demo } from "./fixture";

test("ChatGPT handoff and saved human-pasted answers survive reload", async ({
  page,
}) => {
  await page.goto(demo.route);
  await page.getByRole("button", { name: "Codex 工作台", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "GPT 问答与 Codex 工作台" }),
  ).toBeVisible();
  expect((await page.locator('dialog').boundingBox())!.x).toBeGreaterThan(0);
  await page.getByRole("button", { name: "打开 GPT 提问与回答记录" }).click();
  await expect(
    page.getByRole("radio", { name: "ChatGPT", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("link", { name: "打开 ChatGPT", exact: true }),
  ).toHaveAttribute("href", "https://chatgpt.com/");
  await page
    .getByLabel("补充问题")
    .fill("【自动验收】训练时间与生成时间有何区别？");
  await page
    .getByLabel("粘贴 AI 回答")
    .fill(
      "【人工粘贴流程测试文本，不是实际 GPT 回答】机器人控制时间和生成积分时间是两个变量。",
    );
  await page.getByRole("button", { name: "保存问答记录", exact: true }).click();
  await expect(page.getByText("问答已保存到本机")).toBeVisible();
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page.reload();
  await page.getByRole("button", { name: "带着上下文提问" }).click();
  await expect(page.locator(".qa-history")).toContainText(
    "训练时间与生成时间有何区别",
  );
  await page.locator(".qa-history summary").last().click();
  await expect(page.locator(".qa-history")).toContainText("不是实际 GPT 回答");
});
