import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { demo, notesSource, openTab, python, workspace } from "./fixture";
test("demo paper: library, PDF text layer, math, evidence, prompt, notes persistence and corrections", async ({
  page,
  context,
  request,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我的文献库" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "切换浅色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("搜索文献").fill("no-such-paper");
  await expect(page.getByText("没有匹配的论文")).toBeVisible();
  await page.getByLabel("搜索文献").fill("Chunked Flow");
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
  // Step 2 (精读) holds the formulas, folded until opened.
  await openTab(page, "精读");
  await page.locator(".lesson-formula > summary").first().click();
  await expect(page.locator(".equation-card")).toHaveCount(1);
  await expect(page.locator(".katex-error")).toHaveCount(0);
  await page
    .locator(".equation-card")
    .first()
    .getByRole("button", { name: /原文 p.2/ })
    .click();
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  await expect(page.locator(".pdf-notice")).toContainText("已匹配原文");
  await expect(page.locator(".textLayer .highlight").first()).toBeAttached();
  await page.screenshot({
    path: "../docs/screenshots/reader-mathematics.png",
    fullPage: true,
  });
  // Select original text through its real DOM range, then preserve it in prompt context.
  const selected = await page
    .locator('.pdfViewer .page[data-page-number="2"] .textLayer span')
    .filter({ hasText: "Euler" })
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
  await expect(page.getByLabel("完整提问上下文")).toContainText(demo.id);
  await expect(page.getByLabel("完整提问上下文")).toContainText("Page: 2");
  await page.getByRole("button", { name: "复制提问上下文" }).click();
  await expect(page.getByRole("button", { name: "已复制问题" })).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("Version: v1");
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page
    .getByLabel("搜索 PDF 原文")
    .fill("unfindable-acceptance-phrase-xyz");
  await page.getByRole("button", { name: "查找", exact: true }).click();
  await expect(page.locator(".pdf-notice")).toContainText("未匹配到原句");
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  // Wide screens open the sidebar on the paper's table of contents; folding it leaves a rail.
  await expect(page.getByRole("navigation", { name: "论文目录", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "论文目录", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "论文目录（已收起）" })).toBeVisible();
  const beforeZoom = (await page
    .locator('.pdfViewer .page[data-page-number="2"]')
    .boundingBox())!.width;
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page
          .locator('.pdfViewer .page[data-page-number="2"]')
          .boundingBox())!.width,
    )
    .toBeGreaterThan(beforeZoom);
  // After zooming the fit button shows the zoom level instead of 「适宽」.
  await page.locator(".zoom-controls .fit").click();
  const separator = page.getByRole("separator");
  await separator.focus();
  await separator.press("ArrowLeft");
  await openTab(page, "笔记");
  const notes = await notesSource(page);
  await expect(notes).toBeEnabled();
  const original = (await (await request.get(demo.api + "/notes")).json()).content;
  const note = `${original}\n\n## 自动验收记录\nPDF、公式和引用已检查。${Date.now()}`;
  await notes.fill(note);
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByText(/已保存$/)).toBeVisible();
  await page.reload();
  await expect(await notesSource(page)).toHaveValue(note);
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  // Claims and corrections live in the appendix of 精读, grouped by section.
  await openTab(page, "精读");
  const claimGroup = page.locator("details.claims-section").filter({ hasText: "问题与贡献" });
  const openClaims = async () => {
    if ((await claimGroup.getAttribute("open")) === null) await claimGroup.locator("summary").click();
  };
  await openClaims();
  await page.getByLabel("纠错 demo_chunk").click();
  await page
    .getByLabel("正确解释")
    .fill(
      "验收记录：动作块是已有做法，本文的贡献在于对块长度的消融。",
    );
  await page.getByRole("button", { name: "保存纠错", exact: true }).click();
  await expect(
    page.locator(".human-correction").filter({ hasText: "验收记录" }),
  ).toBeVisible();
  await page.reload();
  await openClaims();
  await expect(
    page.locator(".human-correction").filter({ hasText: "验收记录" }),
  ).toBeVisible();
  const humanNotes = readFileSync(resolve(demo.dir, "notes.md"), "utf8");
  const humanCorrections = readFileSync(resolve(demo.dir, "corrections.jsonl"), "utf8");
  // Regenerating the report must leave human notes and corrections untouched.
  execFileSync(python, [
    "-X",
    "utf8",
    resolve("../scripts/make_demo.py"),
    "--root",
    workspace,
    "--paper",
    demo.id,
  ]);
  expect(readFileSync(resolve(demo.dir, "notes.md"), "utf8")).toBe(humanNotes);
  expect(readFileSync(resolve(demo.dir, "corrections.jsonl"), "utf8")).toBe(humanCorrections);
  await page.getByRole("button", { name: "刷新报告", exact: true }).click();
  await openClaims();
  await expect(
    page.locator(".human-correction").filter({ hasText: "验收记录" }),
  ).toBeVisible();
  // Experiments and related work are chapters of the same read.
  await expect(page.locator(".experiment-card")).toHaveCount(1);
  await expect(page.locator(".relation-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: /flow matching/ })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Flow Matching", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭对话框" }).click();
  // Fit mode fills the pane with the printed text (margins may overflow) and refits on resize.
  const paperWidth = async () =>
    (await page.locator('.pdfViewer .page[data-page-number="2"]').boundingBox())!.width;
  const wideWidth = await paperWidth();
  await page.setViewportSize({ width: 1280, height: 800 });
  await openTab(page, "精读");
  await expect(page.locator(".reader-layout")).toBeVisible();
  await expect.poll(paperWidth).toBeLessThan(wideWidth);
  await expect(page.locator('.pdfViewer .page[data-page-number="2"] canvas')).toBeVisible();
  await expect(page.locator('.pdfViewer .page[data-page-number="2"] .loadingIcon')).toHaveCount(0);
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
  await page.goto(demo.route);
  await expect(page.locator(".pdfViewer .page canvas").first()).toBeVisible({
    timeout: 30000,
  });
  await openTab(page, "自测与思考");
  await expect(page.locator(".pass-card")).toHaveCount(3);
  await expect(page.locator(".self-test")).toHaveCount(3);
  // Reading-route stop jumps the PDF without a quote search.
  await page.locator(".stop-page", { hasText: "p.3" }).click();
  await expect(page.getByLabel("PDF 页码")).toHaveValue("3");
  await page.getByLabel("我的回答 Q1").fill("10 步欧拉，执行前一半");
  await page.getByRole("button", { name: "对照参考答案" }).first().click();
  await expect(page.locator(".q-answer").first()).toContainText("10 步欧拉积分");
  await page.getByRole("button", { name: "我会了" }).first().click();
  await page.getByRole("radio", { name: "新意度 4 分" }).click();
  await page.getByRole("radio", { name: "有效性 3 分" }).click();
  await page.getByRole("radio", { name: "问题大小 5 分" }).click();
  await expect(page.locator(".value-line strong")).toHaveText("60");
  await page.getByLabel("新想法").fill("试试随扰动自适应的动作块长度");
  await page.getByRole("button", { name: "记下" }).click();
  // Autosave is debounced: wait until the idea has actually reached the file.
  await expect
    .poll(async () => (await (await request.get(demo.api + "/study")).json()).study.ideas.length)
    .toBe(1);
  await expect(page.locator(".save-state")).toHaveText("已自动保存到 study.json");
  const study = await (await request.get(demo.api + "/study")).json();
  expect(study.study.judgment).toMatchObject({ novelty: 4, effectiveness: 3, problem_size: 5 });
  expect(study.study.tests[0]).toMatchObject({ question_id: "demo_q1", verdict: "got_it" });
  expect(study.study.ideas[0].text).toBe("试试随扰动自适应的动作块长度");
  // Finishing step 3 marks the paper as read, and it can be undone.
  await page.getByRole("button", { name: "标记为已读完" }).click();
  await expect(page.getByRole("button", { name: "已读完" })).toBeVisible();
  expect((await (await request.get(demo.api)).json()).reading_status).toBe("completed");
  // Keyboard: tab shortcut, then the command palette with a page number.
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("2");
  await expect(page.locator(".lesson-toc")).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByLabel("搜索命令").fill("2");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  // Library reflects progress and lists the idea.
  await page.locator("a.brand").click();
  await expect(page.locator(".paper-card .study-meter")).toContainText("价值 60");
  await page.getByRole("button", { name: /想法本/ }).click();
  await expect(page.locator(".idea-feed .idea-row")).toContainText("自适应的动作块长度");
  await page.screenshot({ path: "../docs/screenshots/library-ideas.png" });
  expect(exceptions).toEqual([]);
});

test("reader layout: collapsible panes, focus mode and selection dictionary card", async ({
  page,
  request,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await page.goto(demo.route);
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
  const word = page.locator('.pdfViewer .page[data-page-number="1"] .textLayer span', { hasText: /action chunk/ }).first();
  await word.scrollIntoViewIfNeeded();
  const select = () => word.evaluate((el) => {
    // PDF.js may split a line into several text nodes; select inside the one with the word.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode()!;
    while (!text.textContent!.includes("chunk")) text = walker.nextNode()!;
    const i = text.textContent!.indexOf("chunk");
    const range = document.createRange();
    range.setStart(text, i);
    range.setEnd(text, i + "chunk".length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await select();
  const card = page.getByRole("dialog", { name: "划词翻译" });
  await expect(card).toContainText("动作块");
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
  // The translation belongs to its passage: a small scroll keeps it, scrolling
  // past the passage closes it (docked too) and drops the selection.
  const pdf = page.locator(".pdf-container");
  await pdf.evaluate((el) => el.scrollBy(0, 40));
  await page.waitForTimeout(300);
  await expect(card).toBeVisible();
  await pdf.evaluate((el) => el.scrollBy(0, 1500));
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => getSelection()!.toString())).toBe("");
  await word.scrollIntoViewIfNeeded();
  await select();
  await expect(card).toContainText("动作块");
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
    python,
    [
      "-X",
      "utf8",
      resolve("../.agents/skills/paper/scripts/paper.py"),
      "--root",
      workspace,
      "prepare",
      localId,
      "--version",
      "v1",
    ],
    { encoding: "utf8" },
  );
  expect(JSON.parse(localPrepared).metadata.paper_id).toBe(localId);
  await openTab(page, "笔记");
  const notes = await notesSource(page);
  await notes.fill("# 本地论文\n\n尚未分析也能保存笔记。");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("a.brand").click();
  await expect(notes).toHaveValue(
    "# 本地论文\n\n尚未分析也能保存笔记。",
  );
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByText(/已保存$/)).toBeVisible();
  await page.reload();
  await expect(await notesSource(page)).toHaveValue(
    "# 本地论文\n\n尚未分析也能保存笔记。",
  );
});

test("missing PDF, malformed report and disconnected backend show recoverable errors", async ({
  page,
}) => {
  await page.route(`**${demo.api}/pdf`, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: '{"detail":"PDF missing"}',
    }),
  );
  await page.route(`**${demo.api}/report`, (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: '{"detail":"JSON 格式错误"}',
    }),
  );
  await page.goto(demo.route);
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

test("library card 自测与思考 opens the paper straight at its self-test", async ({ page }) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await page.goto("/");
  const card = page.locator(".paper-card").filter({ hasText: "Chunked Flow Policies" });
  await card.getByRole("button", { name: /自测与思考/ }).click();
  await expect.poll(() => page.url()).toContain(`#/paper/${demo.id}/${demo.version}?focus=study`);
  const selfTest = page.locator("#study-self-test");
  await expect(selfTest).toBeVisible();
  await expect(selfTest.getByRole("heading", { name: "理解验收" })).toBeInViewport();
  // The card body still opens the paper normally.
  await page.goto("/");
  await card.locator(".paper-card-body").click();
  await expect.poll(() => page.url().endsWith(`#/paper/${demo.id}/${demo.version}`)).toBe(true);
  expect(exceptions).toEqual([]);
});

test("knowledge search finds report passages and opens the paper at the cited page; graph view renders", async ({ page }) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await page.goto("/");
  await page.getByLabel("搜索文献").fill("欧拉积分");
  const hits = page.locator(".knowledge-hits");
  await expect(hits).toBeVisible();
  const claim = hits.locator(".knowledge-hit", { hasText: "推理时用 10 步欧拉积分" });
  await expect(claim).toContainText("p.");
  const cited = Number((await claim.locator(".knowledge-meta").innerText()).match(/p\.(\d+)/)![1]);
  await claim.click();
  await expect.poll(() => page.url()).toContain(`page=${cited}`);
  await expect(page.getByLabel("PDF 页码")).toHaveValue(String(cited), { timeout: 30000 });
  await page.goto("/");
  await page.getByRole("button", { name: "知识图谱" }).click();
  await expect(page.locator(".knowledge-graph .graph-node.node-paper").first()).toBeVisible();
  expect(exceptions).toEqual([]);
});

test("research line Idea 区: capture a spark, score its tradeoffs, compare, delete and undo", async ({ page, request }) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await page.goto("/");
  await page.locator(".line-nav", { hasText: "测试研究线" }).click();
  const board = page.locator(".idea-board");
  await board.getByLabel("记下一个闪念").fill("动作块长度随不确定性自适应");
  await page.keyboard.press("Enter");
  await board.getByLabel("记下一个闪念").fill("只在失败步骤上蒸馏");
  await page.keyboard.press("Enter");
  await expect(board.locator(".idea-card")).toHaveCount(2);
  await board.locator(".idea-card", { hasText: "动作块长度" }).click();
  for (const [label, n] of [["新意", 4], ["可行", 3], ["影响", 5], ["投入", 2]] as const)
    await board.getByRole("radio", { name: `${label} ${n} 分` }).click();
  await board.getByRole("radio", { name: "探索中" }).click();
  await board.getByPlaceholder("最小的验证实验是什么").fill("仿真里对比固定 H 与自适应 H");
  await expect(board.locator(".idea-score.total b")).toHaveText("10");
  await expect(board.locator(".idea-save")).toHaveText("已保存");
  // Saved to ideas.json, so it survives a reload.
  const ideas = (await (await request.get("/api/ideas")).json()).ideas;
  expect(ideas.find((i: { title: string }) => i.title.startsWith("动作块"))).toMatchObject({
    status: "exploring", scores: { novelty: 4, feasibility: 3, impact: 5, cost: 2 }, next_step: "仿真里对比固定 H 与自适应 H",
  });
  await page.reload();
  await page.locator(".line-nav", { hasText: "测试研究线" }).click();
  await board.getByRole("button", { name: /对比/ }).click();
  await expect(board.locator(".idea-compare tbody tr").first()).toContainText("动作块长度");
  await expect(board.locator(".idea-compare tbody tr").first()).toContainText("10");
  await board.locator(".idea-card", { hasText: "只在失败步骤" }).click();
  await board.getByRole("button", { name: /删除/ }).click();
  await expect(board.locator(".idea-card")).toHaveCount(1);
  await board.locator(".idea-undo").getByRole("button", { name: "撤销" }).click();
  await expect(board.locator(".idea-card")).toHaveCount(2);
  expect(exceptions).toEqual([]);
});

test("research lines: create from the sidebar, file a paper by hand, switch auto filing, edit and delete", async ({ page, request }) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "新建研究线" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("例如：自回归视频的投机解码").fill("动作块长度");
  await dialog.getByPlaceholder(/一两句话/).fill("动作块该多长？");
  await dialog.getByPlaceholder(/用顿号/).fill("action chunk、chunk length");
  await dialog.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".library-heading h2")).toContainText("动作块长度");
  await expect(page.locator(".line-brief")).toContainText("动作块该多长？");
  // File the demo paper into the new line by hand from its card.
  await page.locator(".line-nav", { hasText: "测试研究线" }).click();
  const card = page.locator(".paper-card").first();
  await card.getByRole("button", { name: /归类/ }).click();
  // These checkboxes follow the server, so click and wait for the new state.
  await card.getByRole("checkbox", { name: "动作块长度" }).click();
  await expect.poll(async () => {
    const lines = (await (await request.get("/api/lines")).json()).lines;
    return lines.find((l: { name: string }) => l.name === "动作块长度").papers.length;
  }).toBe(1);
  await expect(card.getByRole("checkbox", { name: "测试研究线" })).toBeChecked();
  // The switch for automatic filing on import.
  await page.getByLabel("导入时自动归类").click();
  await expect.poll(async () => (await (await request.get("/api/lines")).json()).auto_file).toBe(false);
  await expect(page.getByLabel("导入时自动归类")).not.toBeChecked();
  await page.getByLabel("导入时自动归类").click();
  await expect(page.getByLabel("导入时自动归类")).toBeChecked();
  // Edit, then delete the new line; the paper stays in the library.
  await page.locator(".line-nav", { hasText: "动作块长度" }).click();
  await page.locator(".line-brief-tools").getByRole("button", { name: "编辑" }).click();
  await page.getByRole("dialog").getByPlaceholder("例如：自回归视频的投机解码").fill("动作块长度自适应");
  await page.getByRole("dialog").getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".library-heading h2")).toContainText("动作块长度自适应");
  page.once("dialog", (d) => void d.accept());
  await page.locator(".line-brief-tools").getByRole("button", { name: "删除" }).click();
  await expect(page.locator(".line-nav", { hasText: "动作块长度自适应" })).toHaveCount(0);
  await expect(page.locator(".paper-card")).toHaveCount(2);
  // Sorting: titles A–Z, remembered per view across reloads.
  await page.getByLabel("排序").selectOption("title");
  const titles = await page.locator(".paper-card h2").allInnerTexts();
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, "zh-CN")));
  await page.reload();
  await expect(page.getByLabel("排序")).toHaveValue("title");
  await page.locator(".line-nav", { hasText: "测试研究线" }).click();
  await expect(page.getByLabel("排序")).toHaveValue("default");
  expect(exceptions).toEqual([]);
});

test("tags, papers and lines: add, rename and delete tags; delete a paper and undo; line actions in the sidebar", async ({ page, request }) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await page.goto("/");
  // A new tag from the sidebar, then onto the demo paper from its card.
  await page.getByRole("button", { name: "新建技术标签" }).click();
  await page.getByLabel("新标签名称").fill("动作块");
  await page.keyboard.press("Enter");
  const card = page.locator(".paper-card", { hasText: "Chunked Flow Policies" });
  await card.getByRole("button", { name: /归类/ }).click();
  await card.locator(".picker-tags label", { hasText: "动作块" }).click();
  await expect(card.locator(".topic-tags")).toContainText("动作块");
  await page.keyboard.press("Escape");
  // Rename, then delete the tag everywhere.
  page.once("dialog", (d) => void d.accept("动作分块"));
  await page.locator(".side-row", { hasText: "动作块" }).hover();
  await page.getByRole("button", { name: "重命名标签 动作块" }).click();
  await expect(card.locator(".topic-tags")).toContainText("动作分块");
  page.once("dialog", (d) => void d.accept());
  await page.locator(".side-row", { hasText: "动作分块" }).hover();
  await page.getByRole("button", { name: "删除标签 动作分块" }).click();
  await expect(card.locator(".topic-tags")).not.toContainText("动作分块");
  await expect(page.locator(".side-row", { hasText: "动作分块" })).toHaveCount(0);
  // Delete the paper, then undo: it comes back with its research line.
  await card.getByRole("button", { name: /归类/ }).click();
  page.once("dialog", (d) => void d.accept());
  await card.getByRole("button", { name: "从文献库删除" }).click();
  await expect(page.locator(".paper-card", { hasText: "Chunked Flow Policies" })).toHaveCount(0);
  await page.locator(".line-notice").getByRole("button", { name: "撤销" }).click();
  await expect(page.locator(".paper-card", { hasText: "Chunked Flow Policies" })).toHaveCount(1);
  const lines = (await (await request.get("/api/lines")).json()).lines;
  expect(lines.find((l: { name: string }) => l.name === "测试研究线").papers.length).toBe(1);
  // A research line can be edited or deleted straight from the sidebar.
  await page.locator(".side-row", { hasText: "测试研究线" }).hover();
  await page.getByRole("button", { name: "编辑研究线 测试研究线" }).click();
  await expect(page.getByRole("dialog")).toContainText("编辑研究线");
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  expect(exceptions).toEqual([]);
});

test("论文目录 sidebar: numbered sections, folded notes and a rail when collapsed", async ({ page }) => {
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(demo.route);
  await expect(page.locator(".pdfViewer .page canvas").first()).toBeVisible({ timeout: 30000 });
  const toc = page.getByRole("navigation", { name: "论文目录", exact: true });
  await expect(toc.locator(".toc-chapter")).toHaveCount(6);
  await expect(toc.locator(".paper-toc-key")).toHaveCount(2);
  // Notes stay folded until asked for; formulas in them render as math.
  await expect(toc.locator(".paper-toc-note")).toHaveCount(0);
  await toc.getByRole("button", { name: "展开说明 3 Experiments" }).click();
  await expect(toc.locator(".paper-toc-note")).toContainText("主结果");
  await expect(toc.locator(".paper-toc-note .katex").first()).toBeVisible();
  await toc.locator(".toc-chapter-link", { hasText: "4 Limitations" }).click();
  await expect(page.getByLabel("PDF 页码")).toHaveValue("3");
  await expect(toc.locator("li.here")).toContainText("5 Conclusion");
  // Folded from the panel's own button: one tick per section, still jumps.
  await toc.getByRole("button", { name: "收起论文目录" }).click();
  const rail = page.getByRole("navigation", { name: "论文目录（已收起）" });
  await expect(rail.locator("button:not(.rail-open)")).toHaveCount(6);
  await rail.getByRole("button", { name: "2 Method" }).click();
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  await rail.getByRole("button", { name: "展开论文目录" }).click();
  await expect(toc).toBeVisible();
  expect(exceptions).toEqual([]);
});

