# 第三方组件与致谢 · Third-party notices

PaperLab 自身代码以 [MIT](LICENSE) 发布。下面列出项目用到、改编或建议安装的第三方内容。**本仓库不附带任何论文、论文报告、翻译模型或词典数据。**

PaperLab's own code is MIT-licensed. The components below are third-party; none of them is relicensed by this project. **No papers, paper reports, translation models or dictionary data are distributed in this repository.**

## Agent skills

| 内容 | 来源 | 许可 | 在本项目中的用法 |
|---|---|---|---|
| Nature Skills（22 个科研任务技能 + `nature-shared`） | [Yuan1z0825/nature-skills](https://github.com/Yuan1z0825/nature-skills) @ `c6ae86c742705fd968b13c79db1a8518a84089d4` | Apache-2.0（各技能内另有素材声明） | **未随仓库发布**。运行 `python scripts/install-nature-skills.py` 从上述固定版本下载，并按 `docs/nature-skills-installation.json` 逐个文件校验大小、SHA-256 与 Git blob 哈希后安装到 `.agents/skills/nature-*`。上游文件不做修改。许可证副本与说明：[`docs/third-party/nature-skills/`](docs/third-party/nature-skills/) |
| `read-arxiv-paper` 方法（源码优先读 arXiv 论文） | [karpathy/nanochat](https://github.com/karpathy/nanochat) · `.claude/skills/read-arxiv-paper` | MIT | `.agents/skills/rap/` 与 `.claude/skills/rap/` 是基于其“先读 LaTeX 源码、递归展开引用文件”思路**改写的项目适配版**，存储、版本固定与发布流程换成 PaperLab 自己的；未复制原文件。 |

`.agents/skills/paper/`（`$paper` / `/paper`）是本项目原创的技能。

## Runtime dependencies (installed by npm / uv, not vendored)

**Frontend**: React, React DOM, Vite (MIT) · [PDF.js](https://github.com/mozilla/pdf.js) `pdfjs-dist` (Apache-2.0) · KaTeX, react-markdown, remark-gfm, remark-math, rehype-katex (MIT) · Tailwind CSS (MIT) · lucide-react (ISC) · Fonts via Fontsource: Inter, Source Serif 4, Noto Serif SC (SIL Open Font License 1.1).

**Backend**: FastAPI, Pydantic, python-multipart (MIT) · Uvicorn, httpx (BSD-3-Clause) · [PyMuPDF](https://github.com/pymupdf/PyMuPDF) (**AGPL-3.0** or commercial license from Artifex). PaperLab imports PyMuPDF for PDF text extraction; if you redistribute a modified PaperLab as a network service, check the AGPL obligations that come with PyMuPDF.

## Optional local downloads (offline selection translation)

These are fetched by each user onto their own machine; see `.env.example` and the README.

| 内容 | 来源 | 许可 |
|---|---|---|
| ECDICT 英汉词典 | [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT) | MIT |
| Hy-MT2 翻译模型（GGUF） | [tencent/Hy-MT2-7B-GGUF](https://huggingface.co/tencent/Hy-MT2-7B-GGUF) · [Hy-MT2-1.8B-GGUF](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF) | Apache-2.0（以模型仓库内 LICENSE 为准） |
| llama.cpp `llama-server` | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT |

## Ideas and design credits

- 阅读流程借鉴 S. Keshav 的 *How to Read a Paper*（三遍读法）、李沐「论文精读」系列的阅读顺序与“新意度 × 有效性 × 问题大小”价值判断，以及 Sergey Levine、Richard Hamming、John Schulman 关于研究问题与研究笔记的公开建议。这些是方法上的参考，不涉及复制其内容。
- 界面配色参考 anthropic.com 公开的色彩体系；未使用 Anthropic 的字体、Logo 或其他品牌素材，PaperLab 的图标为自行绘制。
