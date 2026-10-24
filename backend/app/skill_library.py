"""Project-local, pinned Nature Skills catalog and bounded prompt resources."""
from pathlib import Path
from .storage import read_json, safe_path, sha256

# All task skills are enabled. Tools and multi-artifact workflows remain in the
# full Codex environment; the web runner only produces the stated text artifact.
CATALOG = [
    ("nature-paper-xray", "讲透一篇论文", "reading", "从问题、设计取舍到公式数例，连着理解论文。", "web", ""),
    ("nature-reader", "中英对照阅读", "reading", "图、表、公式与原文对应的双语 reader。", "codex", "需要全文提取、图件处理和 source map。"),
    ("nature-paper-card", "结构化精读卡", "reading", "把方法、实验、证据和研究启发整理成卡片。", "codex", "需要执行原技能的来源提取与卡片校验脚本。"),
    ("nature-paper-trans", "保留版式的中文 PDF", "reading", "逐页生成并核对中文图片型 PDF。", "codex", "需要内置生图工具与逐页目视检查。"),
    ("nature-writing", "起草论文章节", "writing", "根据你提供的结果与材料，建立论证并起草正文。", "web", ""),
    ("nature-polishing", "学术润色与翻译", "writing", "修改已有文字，保留事实、术语与证据边界。", "web", ""),
    ("nature-statistics", "检查统计表述", "writing", "核对样本单位、重复、区间和检验表述。", "web", ""),
    ("nature-data", "数据与代码声明", "writing", "起草 Data / Code Availability，标明待补信息。", "web", ""),
    ("nature-experiment-log", "整理实验记录", "writing", "把文字实验笔记整理成清晰的 Markdown 日志。", "web", ""),
    ("nature-social-science", "梳理研究问题", "writing", "在社科研究中梳理问题、证据路线与主张边界。", "web", ""),
    ("nature-academic-search", "多源文献检索", "discovery", "检索研究文献，整理来源和检索过程。", "codex", "需要联网检索；部分数据源还需已有账号。"),
    ("nature-citation", "寻找支撑文献", "discovery", "在指定 Nature / CNS 范围内，为论点查找依据。", "codex", "需要联网核查文献；只在明确限定期刊范围时使用。"),
    ("nature-ref-verifier", "核查参考文献", "discovery", "逐项核对作者、年份、页码与 DOI。", "codex", "需要实际访问独立文献来源，不能用模型记忆代替核查。"),
    ("nature-downloader", "获取论文与补充材料", "discovery", "通过开放来源或已有机构授权获取全文。", "codex", "需要下载工具；机构登录和补充材料范围按任务确认。"),
    ("nature-literature-pipeline", "整理一组文献", "discovery", "组织发现、筛选、精读与归档流程。", "codex", "需要检索与归档工具；不会自行建立定时推送。"),
    ("nature-figure", "制作科研图", "presentation", "从真实数据制作图表或可编辑方法示意图。", "codex", "需要绘图脚本和图像检查；额外生图 API 未启用。"),
    ("nature-paper2ppt", "论文汇报 PPT", "presentation", "根据论文组织组会汇报、图件与讲稿。", "codex", "需要 PPTX 创建、渲染和逐页检查。"),
    ("nature-image2ppt", "图片转可编辑 PPT", "presentation", "把幻灯片截图重建为可编辑对象。", "codex", "需要图片重建、PPT 工具及所选模型环境。"),
    ("nature-reviewer", "投稿前模拟审稿", "review", "从有效性、重要性与证据边界进行独立审读。", "codex", "完整流程需要互盲审稿与多份独立产物。"),
    ("nature-response", "准备审稿回复", "review", "逐点回复审稿意见，保留真实修改依据。", "codex", "需要修订稿、审稿意见与回复材料的一致性核对。"),
    ("nature-proposal-writer", "研究计划与开题", "review", "以证据表和论证图组织研究计划。", "codex", "完整流程涉及多文件写作状态与专家审查。"),
    ("nature-paper-to-patent", "技术交底与专利草稿", "review", "把技术材料转为可追溯的中文草稿。", "codex", "需要技术特征来源映射和 DOCX 等文档工具。"),
]
BY_ID = {row[0]: row for row in CATALOG}


def installation(root: Path):
    path = safe_path(root, "docs", "nature-skills-installation.json")
    if not path.is_file():
        return {"skills": [], "files": [], "commit": None}
    return read_json(path)


def verified_resource(root: Path, relative: str, manifest=None):
    manifest = manifest or installation(root)
    expected = next((f for f in manifest["files"] if f["path"] == relative), None)
    if expected is None:
        raise ValueError("技能资源不在已安装清单中，请先校验安装")
    path = safe_path(root, ".agents", "skills", relative)
    raw = path.read_bytes()
    if sha256(raw) != expected["sha256"]:
        raise ValueError("技能文件与安装版本不一致，请重新校验后运行")
    return raw.decode("utf-8")


def skill_catalog(root: Path):
    manifest = installation(root)
    entries = {s["directory"]: s for s in manifest["skills"]}
    output = []
    for directory, title, category, summary, mode, requirement in CATALOG:
        installed = False
        try:
            verified_resource(root, directory + "/SKILL.md", manifest)
            installed = directory in entries
        except (ValueError, OSError):
            pass
        output.append(dict(id=directory, name=entries.get(directory, {}).get("name", directory),
                           title=title, category=category, summary=summary, mode=mode,
                           requirement=requirement, installed=installed, enabled=installed))
    return {"skills": output, "commit": manifest["commit"],
            "enabled_count": sum(s["enabled"] for s in output), "total": len(CATALOG)}


def skill_context(root: Path, skill_id: str, section="intro", language="zh", journal="generic", material=""):
    if skill_id not in BY_ID:
        raise ValueError("未知技能")
    manifest = installation(root)
    paths = [skill_id + "/SKILL.md"]
    skill_manifest = skill_id + "/manifest.yaml"
    manifest_text = verified_resource(root, skill_manifest, manifest)
    paths.append(skill_manifest)
    # The pinned manifests use a simple top-level always_load sequence. We read
    # that sequence only, rather than interpreting arbitrary YAML or executing it.
    in_core = False
    for line in manifest_text.splitlines():
        if line.strip() == "always_load:":
            in_core = True
            continue
        if in_core and line and not line[0].isspace() and not line.startswith("#"):
            break
        if in_core and line.strip().startswith("- "):
            relative = line.strip()[2:].split(" #", 1)[0].strip("'\"")
            resolved = (Path(skill_id) / relative)
            # Collapse trusted ../ shared references without accepting a path
            # from the HTTP caller.
            resolved = (root / ".agents/skills" / resolved).resolve().relative_to((root / ".agents/skills").resolve())
            paths.append(resolved.as_posix())
    if skill_id in {"nature-writing", "nature-polishing"}:
        # Polishing's upstream manifest explicitly maps unspecified Portfolio
        # titles to generic; only writing ships a nature-family fragment.
        selected_journal = "generic" if skill_id == "nature-polishing" and journal == "nature-family" else journal
        paths += [skill_id + "/static/fragments/paper_type/research.md",
                  skill_id + "/static/fragments/journal/" + selected_journal + ".md"]
        mapped = {"method": "methods", "experiments": "results", "related-work": "intro"}.get(section, section) if skill_id == "nature-polishing" else section
        paths.append(skill_id + "/static/fragments/section/" + mapped + ".md")
        if skill_id == "nature-writing":
            paths.append(skill_id + "/static/fragments/task/manuscript.md")
        if language == "en":
            import re
            route = "zh-to-en" if re.search(r"[\u4e00-\u9fff]", material) else "en"
            paths.append(skill_id + "/static/fragments/language/" + route + ".md")
        if section == "discussion":
            paths.append("nature-shared/core/discussion-argument-language.md")
        if section == "experiments":
            paths.append("nature-shared/core/main-text-discipline.md")
        if journal != "generic":
            guide = {"intro":"nature-introduction", "abstract":"nature-abstract",
                     "experiments":"nature-results-discussion", "discussion":"nature-results-discussion"}.get(section)
            if guide:
                paths.append("nature-shared/core/" + guide + ".md")
    resources = []
    for path in dict.fromkeys(paths):
        text = verified_resource(root, path, manifest)
        resources.append({"path": path, "sha256": sha256(text.encode()), "content": text})
    if sum(len(item["content"]) for item in resources) > 150000:
        raise ValueError("技能资源超出网页任务长度上限，请在 Codex 中完成")
    return {"commit": manifest["commit"], "resources": resources}
