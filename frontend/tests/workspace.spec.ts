import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const pi0 = "/api/papers/2410.24164/v4";
test("real pi0: library, PDF text layer, math, evidence, prompt, notes persistence and corrections", async ({
  page,
  context,
  request,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我的文献库" })).toBeVisible();
  await page.getByRole("button", { name: "切换深色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "切换浅色主题" }).click();
  await page.getByLabel("搜索文献").fill("no-such-paper");
  await expect(page.getByText("没有匹配的论文")).toBeVisible();
  await page.getByLabel("搜索文献").fill("2410.24164");
  await expect(page.locator(".paper-card")).toHaveCount(1);
  await page.screenshot({
    path: "../docs/screenshots/library.png",
    fullPage: true,
  });
  await page.locator(".paper-card").click();
  await expect(page.locator(".pdfViewer .page canvas").first()).toBeVisible({
    timeout: 45000,
  });
  await expect(
    page.locator(".pdfViewer .textLayer span").first(),
  ).toBeAttached();
  await page.getByRole("button", { name: "Mathematics", exact: true }).click();
  await expect(page.locator(".equation-card")).toHaveCount(4);
  await expect(page.locator(".katex-error")).toHaveCount(0);
  await page
    .locator(".equation-card")
    .first()
    .getByRole("button", { name: /原文 p.5/ })
    .click();
  await expect(page.getByLabel("PDF 页码")).toHaveValue("5");
  await expect(page.locator(".pdf-notice")).toContainText("已匹配原文");
  await expect(page.locator(".textLayer .highlight").first()).toBeAttached();
  await page.screenshot({
    path: "../docs/screenshots/reader-mathematics.png",
    fullPage: true,
  });
  // Select original text through its real DOM range, then preserve it in prompt context.
  const selected = await page
    .locator('.pdfViewer .page[data-page-number="5"] .textLayer span')
    .filter({ hasText: "flow matching" })
    .first()
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    });
  await page.locator(".reader-split").dispatchEvent("mouseup");
  await page.getByRole("button", { name: "带着上下文提问" }).click();
  await expect(page.getByLabel("提问选中内容")).toHaveValue(selected);
  await expect(page.getByLabel("完整提问上下文")).toContainText("2410.24164v4");
  await expect(page.getByLabel("完整提问上下文")).toContainText("Page: 5");
  await page.getByRole("button", { name: "复制提问上下文" }).click();
  await expect(page.getByRole("button", { name: "已复制问题" })).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("Version: v4");
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page
    .getByLabel("搜索 PDF 原文")
    .fill("unfindable-acceptance-phrase-xyz");
  await page.getByRole("button", { name: "查找", exact: true }).click();
  await expect(page.locator(".pdf-notice")).toContainText("未匹配到原句");
  await expect(page.getByLabel("PDF 页码")).toHaveValue("5");
  await page.getByRole("button", { name: "论文目录", exact: true }).click();
  await expect(page.locator(".pdf-outline")).toBeVisible();
  await page.getByRole("button", { name: "论文目录", exact: true }).click();
  const beforeZoom = (await page
    .locator('.pdfViewer .page[data-page-number="5"]')
    .boundingBox())!.width;
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page
          .locator('.pdfViewer .page[data-page-number="5"]')
          .boundingBox())!.width,
    )
    .toBeGreaterThan(beforeZoom);
  await page.getByRole("button", { name: "适宽", exact: true }).click();
  const separator = page.getByRole("separator");
  await separator.focus();
  await separator.press("ArrowLeft");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("个人 Markdown 笔记")).toBeEnabled();
  const original = (await (await request.get(pi0 + "/notes")).json()).content;
  const note = `${original}\n\n## 自动验收记录\n真实 PDF、公式和引用已检查。${Date.now()}`;
  await page.getByLabel("个人 Markdown 笔记").fill(note);
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByText(/已保存$/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("个人 Markdown 笔记")).toHaveValue(note);
  await expect(page.getByLabel("PDF 页码")).toHaveValue("5");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByLabel("纠错 goal_001").click();
  await page
    .getByLabel("正确解释")
    .fill(
      "验收记录：这里是架构、数据配方与实证的组合贡献；通用 Flow Matching 原理属于既有工作。",
    );
  await page.getByRole("button", { name: "保存纠错", exact: true }).click();
  await expect(
    page.locator(".human-correction").filter({ hasText: "验收记录" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".human-correction").filter({ hasText: "验收记录" }),
  ).toBeVisible();
  const humanNotes = readFileSync(
    resolve("../tmp/e2e-workspace/papers/2410.24164/v4/notes.md"),
    "utf8",
  );
  const humanCorrections = readFileSync(
    resolve("../tmp/e2e-workspace/papers/2410.24164/v4/corrections.jsonl"),
    "utf8",
  );
  execFileSync(resolve("../backend/.venv/Scripts/python.exe"), [
    "-X",
    "utf8",
    resolve("../scripts/build_pi0_report.py"),
    "--root",
    resolve("../tmp/e2e-workspace"),
  ]);
  expect(
    readFileSync(
      resolve("../tmp/e2e-workspace/papers/2410.24164/v4/notes.md"),
      "utf8",
    ),
  ).toBe(humanNotes);
  expect(
    readFileSync(
      resolve("../tmp/e2e-workspace/papers/2410.24164/v4/corrections.jsonl"),
      "utf8",
    ),
  ).toBe(humanCorrections);
  await page.getByRole("button", { name: "刷新报告", exact: true }).click();
  await expect(
    page.locator(".human-correction").filter({ hasText: "验收记录" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Experiments", exact: true }).click();
  await expect(page.locator(".experiment-card")).toHaveCount(6);
  await page.getByRole("button", { name: "Relations", exact: true }).click();
  await expect(page.locator(".relation-card")).toHaveCount(6);
  await page
    .getByRole("button", { name: /flow matching/ })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Flow Matching", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Mathematics", exact: true }).click();
  await expect(page.locator(".reader-layout")).toBeVisible();
  await expect.poll(async () => {
    const paperWidth = (await page.locator('.pdfViewer .page[data-page-number="5"]').boundingBox())!.width;
    const availableWidth = await page.locator('.pdf-container').evaluate(el => el.clientWidth);
    return paperWidth <= availableWidth;
  }).toBe(true);
  await expect(page.locator('.pdfViewer .page[data-page-number="5"] canvas')).toBeVisible();
  await expect(page.locator('.pdfViewer .page[data-page-number="5"] .loadingIcon')).toHaveCount(0);
  await page.locator('.report-scroll').evaluate(el=>el.scrollTo(0,0));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../docs/screenshots/reader-1280.png",
    fullPage: true,
  });
  expect(exceptions).toEqual([]);
});

test("study tab: reading route, self-test, judgment and ideas autosave; command palette jumps pages", async ({
  page,
  request,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await page.goto("/#/paper/2410.24164/v4");
  await expect(page.locator(".pdfViewer .page canvas").first()).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await expect(page.locator(".pass-card")).toHaveCount(3);
  await expect(page.locator(".self-test")).toHaveCount(5);
  // Reading-route stop jumps the PDF without a quote search.
  await page.locator(".stop-page", { hasText: "p.15" }).click();
  await expect(page.getByLabel("PDF 页码")).toHaveValue("15");
  await page.getByLabel("我的回答 Q1").fill("H = 50，10 步 Euler");
  await page.getByRole("button", { name: "对照参考答案" }).first().click();
  await expect(page.locator(".q-answer").first()).toContainText("H = 50");
  await page.getByRole("button", { name: "我会了" }).first().click();
  await page.getByRole("radio", { name: "新意度 4 分" }).click();
  await page.getByRole("radio", { name: "有效性 3 分" }).click();
  await page.getByRole("radio", { name: "问题大小 5 分" }).click();
  await expect(page.locator(".value-line strong")).toHaveText("60");
  await page.getByLabel("新想法").fill("补一个 τ 采样分布的消融");
  await page.getByRole("button", { name: "记下" }).click();
  // Autosave is debounced: wait until the idea has actually reached the file.
  await expect
    .poll(async () => (await (await request.get("/api/papers/2410.24164/v4/study")).json()).study.ideas.length)
    .toBe(1);
  await expect(page.locator(".save-state")).toHaveText("已自动保存到 study.json");
  const study = await (await request.get("/api/papers/2410.24164/v4/study")).json();
  expect(study.study.judgment).toMatchObject({ novelty: 4, effectiveness: 3, problem_size: 5 });
  expect(study.study.tests[0]).toMatchObject({ question_id: "st_horizon", verdict: "got_it" });
  expect(study.study.ideas[0].text).toBe("补一个 τ 采样分布的消融");
  // Keyboard: tab shortcut, then the command palette with a page number.
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("3");
  await expect(page.locator(".equation-card").first()).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByLabel("搜索命令").fill("12");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("PDF 页码")).toHaveValue("12");
  // Library reflects progress and lists the idea.
  await page.locator("a.brand").click();
  await expect(page.locator(".paper-card .study-meter")).toContainText("价值 60");
  await page.getByRole("button", { name: /想法本/ }).click();
  await expect(page.locator(".idea-feed .idea-row")).toContainText("τ 采样分布");
  await page.screenshot({ path: "../docs/screenshots/library-ideas.png" });
  expect(exceptions).toEqual([]);
});

test("reader layout: collapsible panes, focus mode and selection dictionary card", async ({
  page,
  request,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await page.goto("/#/paper/2410.24164/v4");
  await expect(page.locator(".pdfViewer .page canvas").first()).toBeVisible({ timeout: 30000 });
  // The reader replaces the global header with one compact bar.
  await expect(page.locator(".app-header")).toHaveCount(0);
  const before = (await page.locator(".pdf-pane").boundingBox())!;
  await page.getByRole("button", { name: "收起讲解栏" }).click();
  await expect.poll(async () => (await page.locator(".pdf-pane").boundingBox())!.width).toBeGreaterThan(before.width + 300);
  await expect(page.locator(".report-pane")).toBeHidden();
  await page.getByRole("button", { name: "展开讲解栏" }).click();
  await expect(page.locator(".report-pane")).toBeVisible();
  // Focus mode hides the bar until the pointer reaches the top edge.
  await page.locator("body").click({ position: { x: 300, y: 400 } });
  await page.keyboard.press("f");
  await expect(page.locator(".reader-layout")).toHaveAttribute("data-focus", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".reader-layout")).not.toHaveAttribute("data-focus", "true");
  // Selecting an English word shows the offline dictionary + glossary card.
  const status = await (await request.get("/api/translate/status")).json();
  test.skip(!status.dictionary, "offline dictionary not installed on this machine");
  const word = page.locator('.pdfViewer .page[data-page-number="1"] .textLayer span', { hasText: "embodiment" }).first();
  await word.scrollIntoViewIfNeeded();
  await word.evaluate((el) => {
    const text = el.firstChild!;
    const i = text.textContent!.indexOf("embodiment");
    const range = document.createRange();
    range.setStart(text, i);
    range.setEnd(text, i + "embodiment".length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  const card = page.getByRole("dialog", { name: "划词翻译" });
  await expect(card).toContainText("（机器人）本体");
  await expect(card).toContainText("离线词典");
  // The card never covers the selected word, and can dock beside the reader.
  const picked = (await word.boundingBox())!;
  const floating = (await card.boundingBox())!;
  expect(
    floating.y >= picked.y + picked.height ||
      floating.y + floating.height <= picked.y ||
      floating.x >= picked.x + picked.width ||
      floating.x + floating.width <= picked.x,
  ).toBe(true);
  await card.getByRole("button", { name: "停靠到侧边" }).click();
  await expect(card).toHaveClass(/docked/);
  await card.getByRole("button", { name: "改为浮动卡片" }).click();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "划词翻译" }).click();
  await expect(page.getByRole("button", { name: "划词翻译" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "划词翻译" }).click();
  expect(exceptions).toEqual([]);
});

test("local PDF upload can be read without analysis; notes can be persisted", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "导入论文", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "本地 PDF", exact: true }).click();
  await page
    .getByLabel("选择 PDF")
    .setInputFiles(resolve("../tmp/upload-fixture.pdf"));
  await page
    .getByRole("button", { name: "导入论文", exact: true })
    .last()
    .click();
  await expect(page.getByText("尚未生成 AI 分析报告")).toBeVisible();
  await expect(page.locator(".pdfViewer canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "复制分析命令" }).click();
  const localId = decodeURIComponent(new URL(page.url()).hash.split("/")[2]);
  const localPrepared = execFileSync(
    resolve("../backend/.venv/Scripts/python.exe"),
    [
      "-X",
      "utf8",
      resolve("../.agents/skills/paper/scripts/paper.py"),
      "--root",
      resolve("../tmp/e2e-workspace"),
      "prepare",
      localId,
      "--version",
      "v1",
    ],
    { encoding: "utf8" },
  );
  expect(JSON.parse(localPrepared).metadata.paper_id).toBe(localId);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("个人 Markdown 笔记")
    .fill("# 本地论文\n\n尚未分析也能保存笔记。");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("a.brand").click();
  await expect(page.getByLabel("个人 Markdown 笔记")).toHaveValue(
    "# 本地论文\n\n尚未分析也能保存笔记。",
  );
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByText(/已保存$/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("个人 Markdown 笔记")).toHaveValue(
    "# 本地论文\n\n尚未分析也能保存笔记。",
  );
});

test("missing PDF, malformed report and disconnected backend show recoverable errors", async ({
  page,
}) => {
  await page.route("**/api/papers/2410.24164/v4/pdf", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: '{"detail":"PDF missing"}',
    }),
  );
  await page.route("**/api/papers/2410.24164/v4/report", (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: '{"detail":"JSON 格式错误"}',
    }),
  );
  await page.goto("/#/paper/2410.24164/v4");
  await expect(
    page.getByRole("heading", { name: "原文暂不可用" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "JSON 格式错误" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../docs/screenshots/errors.png",
    fullPage: true,
  });
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/api/papers", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("无法连接本地后端");
});
