import { test, expect } from "@playwright/test";
const prefix = "/api/papers/2410.24164/v4";
test("ChatGPT handoff and saved human-pasted answers survive reload", async ({
  page,
}) => {
  await page.goto("/#/paper/2410.24164/v4");
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

test("Chinese/bilingual reading uses cached translation and preserves original PDF", async ({
  page,
  request,
}) => {
  const original = await (await request.get(prefix + "/pdf")).body();
  const segments = [
    {
      id: "p1-b1",
      source: "The action expert predicts continuous actions.",
      translation: "【译文界面测试夹具】动作专家预测连续动作。",
    },
  ];
  await page.route("**/reading/1", (r) =>
    r.fulfill({
      json: {
        source: { page: 1, limited: false, segments },
        translation: {
          generated_at: new Date().toISOString(),
          receipt: { engine: "test-double", auth: "fixture" },
          segments,
        },
      },
    }),
  );
  await page.goto("/#/paper/2410.24164/v4");
  await expect(page.getByLabel("论文阅读语言")).toBeVisible();
  await page.getByLabel("论文阅读语言").selectOption("zh");
  await expect(page.locator(".translated-page")).toContainText(
    "动作专家预测连续动作",
  );
  await expect(page.locator(".pdf-container")).toBeHidden();
  await page.getByLabel("论文阅读语言").selectOption("bilingual");
  await expect(page.locator(".original-segment")).toContainText(
    "The action expert",
  );
  await page.screenshot({
    path: "../docs/screenshots/bilingual-reading-test.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "查看原始 PDF", exact: true }).click();
  await expect(page.locator(".pdf-container")).toBeVisible();
  await expect(page.locator(".pdfViewer canvas").first()).toBeVisible();
  expect(await (await request.get(prefix + "/pdf")).body()).toEqual(original);
});

test("missing translation starts a fixed Codex page job and shows actual status/errors", async ({
  page,
}) => {
  let started = false;
  const job = {
    job_id: "job_fixture",
    kind: "translate_page",
    page: 1,
    status: "failed",
    progress: 0,
    total: 1,
    message: "【测试夹具】Codex 登录已过期，请重新登录",
    created_at: new Date().toISOString(),
  };
  await page.route("**/reading/1", (r) =>
    r.fulfill({
      json: {
        source: {
          page: 1,
          limited: false,
          segments: [{ id: "p1-b1", source: "Some source text." }],
        },
        translation: null,
      },
    }),
  );
  await page.route("**/v4/jobs", async (r) => {
    if (r.request().method() === "POST") {
      expect(r.request().postDataJSON()).toEqual({
        kind: "translate_page",
        page: 1,
      });
      started = true;
      await r.fulfill({ json: job });
    } else await r.fulfill({ json: { jobs: [job] } });
  });
  await page.goto("/#/paper/2410.24164/v4");
  await page.getByLabel("论文阅读语言").selectOption("zh");
  await expect(page.locator(".translated-page [role=alert]")).toContainText(
    "Codex 登录已过期",
  );
  expect(started).toBe(true);
  await page.getByRole("button", { name: "查看原始 PDF", exact: true }).click();
  await expect(page.locator(".pdfViewer canvas").first()).toBeVisible();
});
