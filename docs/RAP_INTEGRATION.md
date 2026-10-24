# RAP 在 PaperLab 中的用法

RAP 指你已安装的 read-arxiv-paper。原 skill 针对 nanochat，将源码放在全局 knowledge 缓存，并输出 nanochat 相关解读。本项目保留它的“源码优先、递归阅读”方法，适配成项目 skill `.agents/skills/rap/SKILL.md`，沿用 PaperLab 的版本、存储和发布规则；全局原 skill 没有修改。

## 如何使用

- 在 Codex 中用 `$rap <arXiv ID，如 2410.24164v4>` 或 `$rap local-<本地ID> --version v1`。现有 `$paper` 也已接入同一源码准备流程。新 skill 的菜单发现可能需要新会话；也可直接要求读取项目 `.agents/skills/rap/SKILL.md` 执行。Claude Code 的 `/rap` 指向同一套指引。
- 网页论文页 → Codex 工作台 → **RAP · LaTeX 源码优先阅读**，查看主文件、关联文件数和限制。**检查 / 获取 RAP 源码**不调用模型，也不要求 Codex 登录；它准备固定版本的缓存。随后使用原来的 **生成 / 更新研究报告**，分析上下文自动加入源码。
- arXiv abs/pdf/src URL 都会规范化；未指定版本时沿用导入器确定并固定的版本，源码只请求对应 `/src/IDvN`。已导入论文缺少源码时可补取，已有有效缓存复用。纯本地 PDF 未关联 arXiv 时不猜测版本，明确降级为 PDF 分析。

## 源码到报告

辅助命令仍为：

```powershell
backend/.venv/Scripts/python.exe -X utf8 .agents/skills/paper/scripts/paper.py prepare 2410.24164v4
```

输出中 `rap_source` 指向 `local-assets/ID/vN/rap-source.json`，含入口、按依赖排序的内容及文件哈希。支持 input、include、subfile、import/subimport、未加花括号的简单 input、bibliography/addbibresource，以及本地 sty/cls；只有编译参考文献 main.bbl 时可回退读取它。科学章节/参考文献先于排版宏进入阅读预算。

这是静态阅读，不编译 TeX。宏展开、条件分支和复杂路径无法保证完整解析；未解析引用、歧义、多入口、编码问题与预算截断会显示。`complete` 只表示已解析静态依赖内没有缺失/截断且入口唯一，不代表 TeX 编译或研究内容正确。大类文件可能仅部分传入，应检查每个文件的 truncated 字段。

网页版分析将有界源码内容送给已有 Codex 订阅桥接，记录实际提供文件数和限制；PDF-only/不完整源码会保留 needs_review。源码文字不能冒充 verified PDF 引句，发布器仍按指定 PDF 页验证。

报告继续写到 `papers/ID/vN/report.json`、`report.md`、`source-index.json`。不会新增一份脱离平台的 nanochat summary，也不会在准备源码时重写已有报告、笔记、Study、问答、纠错或译文。历史导入的源码缓存可能迁移到同一论文目录内的 rap-source-HASH 文件夹，以保留原先遗漏的 .bbl。

RAP 是输入阅读流程，不改变内容作者的约定；明确指定由 GPT 撰写的论文仍应由 GPT 产出正文，Codex 仅作校验整理。这里没有重新生成既有报告。

没有新增 API Key 或 API 付费；网页分析消耗已有 Codex 订阅额度。源码准备只下载 arXiv 数据并作文件处理，不启动 AI。项目 skill 验证和后端/浏览器检查记录在 TEST_RESULTS.md（本地记录，不随仓库发布）；模型实际是否成功仍以具体分析任务回执为准。
