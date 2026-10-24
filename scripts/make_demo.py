"""Create a demo paper with a sample report so a fresh install has something to explore.

PaperLab ships no papers. This script writes a short toy paper authored for this
project (CC0, not a real publication), imports it like any local PDF and publishes
a sample report through the normal validator, so every citation is checked
against the generated PDF text.

Usage:  backend/.venv/Scripts/python.exe -X utf8 scripts/make_demo.py [--root DATA_DIR] [--paper ID]
        --paper republishes the sample report onto an existing demo paper (notes, study
        records and corrections are kept, as with any regenerated report).
"""
import argparse
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.importer import import_pdf  # noqa: E402
from app.models import Metadata  # noqa: E402
from app.paths import data_root  # noqa: E402
from app.reports import publish_report  # noqa: E402
from app.storage import data_lock, paper_dir, read_json, write_json  # noqa: E402

TITLE = "Chunked Flow Policies for Tabletop Manipulation: A Toy Study"
NOTICE = ("PaperLab demo document. Written for this project to demonstrate the reader; it is not a real "
          "publication and reports no real experiments. Released under CC0.")
PAGES = [
    [("h1", TITLE), ("note", NOTICE),
     ("h2", "Abstract"),
     ("p", "We study a small policy that predicts an action chunk of future joint targets instead of a single "
           "action. The policy is trained with a flow matching objective conditioned on camera images and the "
           "proprioceptive state. Predicting chunks reduces compounding errors at a control frequency of 20 Hz."),
     ("h2", "1 Introduction"),
     ("p", "Imitation learning policies often fail when small errors accumulate over a long horizon. A policy "
           "that commits to several future actions at once can smooth its behaviour and react less to noise in "
           "individual observations. We ask how long an action chunk should be for simple tabletop tasks."),
     ("p", "Our contributions are a minimal flow matching policy that outputs chunks of H future actions, and an "
           "ablation over the chunk length on three toy tasks.")],
    [("h2", "2 Method"),
     ("p", "Let o_t denote the observation and A_t = [a_t, ..., a_{t+H-1}] the action chunk. We sample noise e "
           "from a standard Gaussian and a time tau in [0, 1], and form the noisy chunk A^tau = tau A_t + (1 - tau) e."),
     ("p", "The network v_theta is trained to predict the velocity A_t - e with a mean squared error loss. At "
           "inference we start from pure noise and integrate the learned vector field with 10 Euler steps."),
     ("p", "The policy executes the first half of each chunk and then replans from a new observation. This "
           "receding execution keeps the robot responsive while still benefiting from smooth chunks."),
     ("h2", "3 Experiments"),
     ("p", "We evaluate on three simulated tasks: pick cube, open drawer and stack blocks. Each configuration is "
           "evaluated over 50 trials. The single-step baseline predicts one action per observation."),
     ("p", "With a chunk length of H = 8 the policy reaches a success rate of 0.82 averaged over the three tasks, "
           "compared with 0.61 for the single-step baseline. Longer chunks of H = 32 lower the success rate to "
           "0.70 because the policy reacts too slowly to disturbances.")],
    [("h2", "4 Limitations"),
     ("p", "All results come from a toy simulator with perfect state estimation. The study uses one random seed "
           "per configuration, so the differences should be read as illustrative rather than significant."),
     ("h2", "5 Conclusion"),
     ("p", "A moderate chunk length gave the best trade-off between smoothness and reactivity in this toy setting. "
           "Real robots, longer tasks and more seeds are needed before drawing general conclusions.")],
]


def make_pdf() -> bytes:
    doc = pymupdf.open()
    styles = {"h1": ("tibo", 17, 30), "h2": ("tibo", 12.5, 22), "p": ("tiro", 10.5, 0), "note": ("tiit", 9, 0)}
    for blocks in PAGES:
        page = doc.new_page(width=595, height=842)
        y = 72
        for kind, text in blocks:
            font, size, _ = styles[kind]
            rect = pymupdf.Rect(72, y, 523, 800)
            rest = page.insert_textbox(rect, text, fontname=font, fontsize=size, align=0)
            used = rect.height - rest if rest >= 0 else rect.height
            y += used + (14 if kind != "h1" else 10)
        page.insert_text((72, 815), "PaperLab demo document · CC0", fontname="tiit", fontsize=8)
    doc.set_metadata({"title": TITLE, "author": "PaperLab demo"})
    return doc.tobytes()


def build_report(meta: Metadata) -> dict:
    cite = lambda page, quote, section: {"source_type": "pdf", "paper_id": meta.paper_id, "version": meta.version,
                                         "page": page, "section": section, "quote": quote, "verification": "verified"}
    chunk = cite(1, "predicts an action chunk of future joint targets instead of a single action", "Abstract")
    loss = cite(2, "trained to predict the velocity A_t - e with a mean squared error loss", "2 Method")
    euler = cite(2, "integrate the learned vector field with 10 Euler steps", "2 Method")
    replan = cite(2, "executes the first half of each chunk and then replans", "2 Method")
    trials = cite(2, "Each configuration is evaluated over 50 trials.", "3 Experiments")
    best = cite(2, "reaches a success rate of 0.82 averaged over the three tasks", "3 Experiments")
    longer = cite(2, "lower the success rate to 0.70", "3 Experiments")
    seed = cite(3, "uses one random seed per configuration", "4 Limitations")
    claim = lambda cid, section, text, cites, kind="paper_fact": {
        "claim_id": cid, "section": section, "claim_type": kind, "text": text, "citations": cites,
        "evidence_status": "supported" if cites else "missing"}
    return {
        "paper_id": meta.paper_id, "version": meta.version, "analysis_status": "ready",
        "overview": "**一句话：让策略一次预测一小段未来动作（动作块），而不是每步只出一个动作。** 这是一篇为演示 PaperLab 而写的玩具论文，"
                    "用来展示报告、出处跳转、划词翻译和学习记录如何配合。",
        "motivation": "模仿学习的策略每一步的小误差会在长时程里累积。一次规划多步动作，可以让动作更平滑，也不那么容易被单帧观测的噪声带偏。",
        "contributions": "1. 一个输出 $H$ 步动作块的极简流匹配策略。\n2. 在三个玩具任务上对动作块长度做了消融。",
        "method": "输入相机图像与本体感知状态，输出长度为 $H$ 的动作块 $A_t=[a_t,\\dots,a_{t+H-1}]$。执行时只执行前一半，再用新观测重新规划。",
        "mathematics": "训练目标是条件流匹配：把真实动作块和高斯噪声按时间 $\\tau$ 线性插值，让网络回归从噪声指向数据的速度。",
        "training": "每个训练样本是一对（观测，动作块）。采样噪声 $\\epsilon\\sim\\mathcal N(0,I)$ 与时间 $\\tau\\in[0,1]$，构造带噪动作块后用均方误差监督速度。",
        "inference": "从纯噪声出发，用 10 步欧拉积分沿学到的向量场走到 $\\tau=1$，得到一个动作块；执行前一半后重新规划。",
        "experiments": [
            {"name": "动作块长度消融", "dataset": "三个仿真任务：pick cube、open drawer、stack blocks",
             "baselines": ["单步策略（每次观测只预测一个动作）"], "metric": "三任务平均成功率",
             "value": "$H=8$：0.82；单步基线：0.61；$H=32$：0.70", "protocol": "每种配置 50 次试验，单一随机种子",
             "citations": [best, longer, trials]}],
        "limitations": "全部结果来自理想状态估计的玩具仿真器，每种配置只用一个随机种子，差异只能当作示意，不能当作显著结论。",
        "related_papers": [
            {"title": "Diffusion Policy", "relation": "compares_with",
             "explanation": "同样用生成模型输出动作序列；本文换成流匹配，推理只需 10 步积分。", "verified": False}],
        "claims": [
            claim("demo_chunk", "overview", "策略一次预测一个动作块，而不是单个动作。", [chunk]),
            claim("demo_loss", "method", "网络用均方误差回归速度 $A_t-\\epsilon$。", [loss]),
            claim("demo_euler", "method", "推理时用 10 步欧拉积分生成动作块。", [euler]),
            claim("demo_replan", "method", "每个动作块只执行前一半，然后重新规划。", [replan]),
            claim("demo_best", "experiments", "$H=8$ 时三任务平均成功率 0.82，高于单步基线的 0.61。", [best]),
            claim("demo_seed", "experiments", "每种配置只用一个随机种子，差异仅作示意。", [seed]),
        ],
        "equations": [
            {"equation_id": "eq_demo_path", "title": "带噪动作块的构造",
             "latex": "A^{\\tau}=\\tau A_t+(1-\\tau)\\,\\epsilon,\\qquad \\epsilon\\sim\\mathcal N(0,I)",
             "symbols": [{"symbol": "A_t", "definition": "真实动作块", "shape": "H × 动作维度"},
                         {"symbol": "\\tau", "definition": "流匹配时间", "shape": "标量 [0,1]"}],
             "explanation": "$\\tau=0$ 是纯噪声，$\\tau=1$ 是真实动作块；网络学习沿这条直线移动的速度。",
             "derivation": ["对 $\\tau$ 求导得到速度 $\\frac{dA^{\\tau}}{d\\tau}=A_t-\\epsilon$。",
                            "这就是训练时网络要回归的目标。"],
             "derivation_type": "auxiliary_explanation", "citations": [loss]}],
        "concept_links": ["flow-matching"],
        "quality_checks": ["演示文档：PDF 与报告均由 scripts/make_demo.py 生成，不代表任何真实研究。",
                           "所有 verified 引句都通过了发布器的页文本校验。"],
        "reading_guide": {
            "first_pass": [{"page": 1, "label": "Abstract", "why": "一句话弄清：预测动作块解决什么问题。"},
                           {"page": 2, "label": "3 Experiments", "why": "只看结论：最好的动作块长度是多少。"}],
            "must_read": [{"page": 2, "label": "2 Method", "why": "自己推一遍带噪动作块和速度目标。"},
                          {"page": 3, "label": "4 Limitations", "why": "判断结论能推广到多远。"}]},
        "self_test": [
            {"question_id": "demo_q1", "level": "recall", "question": "推理时积分几步？每个动作块执行多少？",
             "answer": "10 步欧拉积分；只执行前一半，然后重新规划。", "citations": [euler, replan]},
            {"question_id": "demo_q2", "level": "understand", "question": "为什么动作块太长（$H=32$）反而变差？",
             "answer": "执行一大段动作期间不看新观测，策略对扰动反应太慢。", "citations": [longer]},
            {"question_id": "demo_q3", "level": "transfer",
             "question": "如果要把结论写进自己的论文，还缺什么证据？",
             "answer": "真实机器人、更长的任务和多个随机种子；目前只有单一种子的玩具仿真结果（推断）。",
             "citations": [seed]}],
        "tutorial": {
            "introduction": "按「问题 → 方法 → 证据 → 局限」读完这篇玩具论文，再去右侧 Study 标签做三道自测题。",
            "walkthrough": [
                {"unit_id": "demo_walk_chunk", "title": "为什么要预测动作块",
                 "body": "**一句话：一次规划几步，误差就不会每一步都重新累积。** 类比开车时看远一点再打方向，而不是只盯着车头。",
                 "citations": [chunk]},
                {"unit_id": "demo_walk_flow", "title": "流匹配怎么生成动作",
                 "body": "从噪声出发，按网络给出的速度走 10 小步，就到达一个合理的动作块。", "citations": [euler]}],
            "faq": [{"question": "这篇论文是真的吗？", "answer": "不是。它是 PaperLab 自带的演示文档，内容为虚构的玩具实验。"}]},
    }


CONCEPT = r"""# Flow Matching

**一句话：学一个把噪声「推」成数据的速度场，再沿着它积分几步得到样本。**

- 训练：把数据 $x_1$ 和噪声 $x_0$ 按时间 $\tau$ 线性插值成 $x_\tau$，让网络回归速度 $x_1-x_0$。
- 生成：从纯噪声出发，用欧拉法等常微分方程解法沿学到的速度场走到 $\tau=1$。
- 和扩散模型的关系：同属「从噪声生成」的方法；直线路径让少量积分步也能得到不错的样本。

> PaperLab 演示概念卡（自行撰写，CC0）。
"""


def create(root: Path, paper_id: str | None = None) -> tuple[Metadata, object]:
    """Import the demo paper (or reuse ``paper_id``) and publish its sample report."""
    root = root.absolute()
    if paper_id:
        meta = Metadata.model_validate(read_json(paper_dir(root, paper_id, "v1") / "metadata.json"))
    else:
        meta = import_pdf(root, make_pdf(), "paperlab-demo.pdf", "PaperLab 演示 · " + TITLE)
        with data_lock(root):
            path = paper_dir(root, meta.paper_id, meta.version) / "metadata.json"
            meta = Metadata.model_validate(read_json(path))
            meta.topics = ["VLA", "Diffusion / Flow Matching"]
            write_json(path, meta.model_dump())
    concept = root / "concepts" / "flow-matching.md"
    if not concept.exists():  # never replace a concept card the user already has
        concept.parent.mkdir(parents=True, exist_ok=True)
        concept.write_text(CONCEPT, encoding="utf-8")
    return meta, publish_report(root, build_report(meta))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=None, help="data directory (default: PAPERLAB_DATA_DIR or the app folder)")
    parser.add_argument("--paper", default=None, help="republish onto this existing demo paper instead of importing a new one")
    args = parser.parse_args()
    root = (args.root or data_root()).absolute()
    meta, report = create(root, args.paper)
    print(f"Demo paper {meta.paper_id}/{meta.version} ready ({report.analysis_status}, revision {report.revision}) in {root}")


if __name__ == "__main__":
    main()
