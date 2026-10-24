# Nature Skills 项目安装与自动选用

本项目已安装原作者 [Yuan1z0825/nature-skills](https://github.com/Yuan1z0825/nature-skills) 在 commit `c6ae86c742705fd968b13c79db1a8518a84089d4` 的完整 `skills/` 内容：**22 个任务技能 + nature-shared，共 23 个目录、808 个上游文件，40,044,401 字节**。安装位置为 `.agents/skills/`，原有 `paper`、`rap` 保留；总计 25 个技能目录。没有安装到用户全局目录。

通过 Codex 的 skill-installer 下载固定版本，逐文件对照 GitHub Git blob SHA-1 核验，再发布到项目。23 个 SKILL.md 均通过 Codex quick_validate，manifest 声明的本地资源无缺失，全部 agents/openai.yaml 一并保留。版本、调用名称、SHA-256 与文件清单见 [安装记录](nature-skills-installation.json)。

## 如何使用

在以 PaperLab 为工作目录的 Codex 或 Claude Code 对话中直接说明任务。AGENTS.md 负责按目标选用技能，再读取其 SKILL.md、manifest 与相关资料；不会把所有技能一次加载。也可明确写 `$nature-paper-xray`、`$nature-writing` 等名称。

技能目录从后续消息开始可发现；如果某客户端没有刷新列表，重新打开项目会话。项目 Agent 按任务加载相应技能，不会在本机后台自行运行。网页已增加固定研究工作流：7 项文字任务直接生成、15 项完整流程准备材料包后交给 Codex；不会在后端执行任意已安装脚本。原有报告、翻译任务保留，详细范围见 [新版科研工作台](NATURE_WORKSPACE.md)。

## 任务目录

| 任务 | 调用名 / 项目入口 |
|---|---|
| 讲透一篇论文、设计取舍、公式教学数例与证据边界 | [nature-paper-xray](../.agents/skills/nature-paper-xray/SKILL.md) |
| 图文对应的中英文论文 reader、片段翻译、原文问答 | [nature-reader](../.agents/skills/nature-reader/SKILL.md) |
| 英文 PDF 转中文图片型 PDF，尽量保留版式 | [nature-paper-trans](../.agents/skills/nature-paper-trans/SKILL.md) |
| 结构化精读卡、方法与实验到结论的映射 | [nature-paper-card](../.agents/skills/nature-paper-card/SKILL.md) |
| 多源学术检索、检索策略、引文管理与影响力核查 | [nature-academic-search](../.agents/skills/nature-academic-search/SKILL.md) |
| 合法开放获取、出版商或已授权机构全文与补充材料 | [nature-downloader](../.agents/skills/nature-downloader/SKILL.md) |
| 文献发现、筛选、精读与归档的多步骤流程 | [nature-literature-pipeline](../.agents/skills/nature-literature-pipeline/SKILL.md) |
| 指定 Nature/CNS 范围的论点支撑文献 | [nature-citation](../.agents/skills/nature-citation/SKILL.md) |
| 核对作者、标题、年份、卷期、页码、DOI | [nature-ref-verifier](../.agents/skills/nature-ref-verifier/SKILL.md) |
| 根据证据起草论文、重构论证、准备首次投稿材料 | [nature-writing](../.agents/skills/nature-writing/SKILL.md) |
| 已有学术文字润色、翻译、精简或 LaTeX 排版 | [nature-polishing](../.agents/skills/nature-polishing/SKILL.md) |
| 投稿前模拟审稿与评估 | [nature-reviewer](../.agents/skills/nature-reviewer/SKILL.md) |
| 返修逐点回复、修订说明、决定后的沟通材料 | [nature-response](../.agents/skills/nature-response/SKILL.md) |
| Python/R 科研绘图、多面板图、可编辑示意图 | [nature-figure](../.agents/skills/nature-figure/SKILL.md) |
| 统计报告、实验单位、重复、区间、检验及图注审查 | [nature-statistics](../.agents/skills/nature-statistics/SKILL.md) |
| Data/Code Availability 声明、FAIR 元数据与共享规划 | [nature-data](../.agents/skills/nature-data/SKILL.md) |
| 图片、文字、音频整理为标准实验记录 | [nature-experiment-log](../.agents/skills/nature-experiment-log/SKILL.md) |
| 从论文生成组会/学术汇报 PPTX 与讲稿 | [nature-paper2ppt](../.agents/skills/nature-paper2ppt/SKILL.md) |
| 截图、图片或扫描页还原为可编辑 PPT 对象 | [nature-image2ppt](../.agents/skills/nature-image2ppt/SKILL.md) |
| 研究计划、开题报告、项目申请 | [researchwrite](../.agents/skills/nature-proposal-writer/SKILL.md)，目录仍叫 nature-proposal-writer |
| 社科选题、研究问题与论证审查 | [nature-social-science](../.agents/skills/nature-social-science/SKILL.md) |
| 技术交底书、中文发明专利草稿 | [nature-paper-to-patent](../.agents/skills/nature-paper-to-patent/SKILL.md) |

[nature-shared](../.agents/skills/nature-shared/SKILL.md) 是共享术语、写作与期刊格式资料。它保留上游 `allow_implicit_invocation: false`，由所选技能按需读取，不作为独立任务运行。

## 与 PaperLab 配合

- 常规“把这篇论文讲透”：`paper` / `rap` 固定原文版本、准备 LaTeX/PDF，结合 `nature-paper-xray` 解释方法、设计、公式数例与证据边界，再走既有 schema 和 publisher。已更新 paper 的分析入口。
- 明确要双语 reader 或精读卡时才增加相应技能。单个公式问题只读相关原文，不强制重新生成整篇报告。
- 写作从作者提供的结果和来源开始；缺失数据、引用或实验不能由技能补造。未指定期刊时用通用学术要求，不默认套用 Nature 投稿限制。
- 新 reader、稿件、图表等默认输出到 `research-outputs/<task>/` 或用户指定位置。原论文 PDF、人工 Notes、Study、纠错、问答、待追问问题、译文和概念库继续独立保存。
- 在 `.env.local` 的 `PAPERLAB_GPT_AUTHORED` 中列出的论文保持由 GPT 撰写分析，网页 Codex 不会重写。安装技能不会重生成或改写任何已有论文报告。
- 本仓库不附带这些技能文件：运行 `python scripts/install-nature-skills.py` 从上游固定版本安装并逐个文件校验哈希，许可与声明见 `docs/third-party/nature-skills/`。

## 运行环境与外部能力

技能文件、共享资源和脚本已全部安装；它们不是一个共同的 Python 依赖包。直接读写与论证流程可用当前 Agent；脚本按任务选择可用解释器和依赖，Windows 下将 Bash 示例转换为等价 PowerShell 参数调用。

- 学术搜索可使用现有浏览工具和公开来源。附带的 MCP server 是可选接口；没有自动注册，Scopus/ScienceDirect、PubMed email 等按实际检索需求配置。
- Downloader 部分机构路径需要用户已有机构登录，论文与 SI 范围遵循所选技能要求；不绕过访问限制。
- 科研图优先使用本地 Python/R、SVG。附带的 OpenRouter 生图路线需要单独 API 凭据，本次没有启用；图片型 PDF 翻译按其技能使用宿主内置 image_gen。
- image2ppt 带有可选模型调用；仅在所需服务、凭据和授权已经具备时使用。普通论文汇报不自动走这条路线。
- 图表、文档、图片型 PDF、专利与机构检索各有独立 requirements 文件，完整保留，按需使用隔离环境，不把全部依赖灌入 PaperLab 后端。
- 没有新建定时任务、外发消息、发布站点、上传材料、修改全局配置或启用额外付费 API。继续使用用户已选的订阅与工具；需要额外能力时说明具体缺口。

## 校验与来源

安装后可运行：

```powershell
backend/.venv/Scripts/python.exe -X utf8 scripts/verify-nature-skills.py
```

该命令只校验已安装文件，不访问网络、执行上游脚本或调用模型。它也检查调用名、共享依赖和清单一致性。上游文件按固定 commit 原样保留，更新时应先检查差异，不使用自动 SessionStart hook。

上游主许可证副本：[Apache-2.0](third-party/nature-skills/LICENSE)。部分技能/素材有自己的许可与版权说明，随完整目录一并保留，使用时依其说明处理。安装记录证明文件与结构检查通过，不代表每个外部数据库、生成模型、机构登录和所有 Python/R 脚本已完成端到端验证。
