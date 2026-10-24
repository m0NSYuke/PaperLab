# Writing style for reader-facing report text

The user wants reports that read like a strong researcher explaining the paper in a chat: vivid enough to picture, precise enough to trust. This governs every prose field (overview through limitations, tutorial units, equation explanations and derivation steps, experiment protocol notes, FAQ and self-test answers). It never relaxes the evidence, notation or authorship rules in report-spec.md.

## Voice

- Lead with the answer. Open each section or unit with one bold sentence that states the point (`**一句话：这个方法把“决定做什么”和“具体怎么做”交给同一个模型的两个输出头。**`), then explain.
- Explain to a smart colleague from a neighbouring field: confident, direct, no filler, no stacked hedges. Uncertainty is stated once, precisely, where it applies.
- Vary sentence openings. Do not repeat a template such as “本文提出……本文……本文……” or restate the abstract.

## Make it concrete (形象化)

- Give each abstract mechanism a picture: a physical analogy, a concrete input walking through the system, or a small number the reader can check by hand. Example: describe the action expert as a “手部小脑” that receives the VLM's plan as context and outputs 50 future joint commands at once.
- An analogy explains, it never adds facts. Put it in an `> [!ANALOGY]` callout or mark it with “打个比方”, and say where it breaks down if that matters.
- Prefer specifics over adjectives: “成功率从 X% 升到 Y%（评测环境、任务数）” with the source's actual numbers, instead of “显著提升”. Name tensor shapes, horizons, step counts and data sizes when the source confirms them.

## Stay professional

- Use field-standard terms. On first use give Chinese plus the original term: 流匹配（flow matching）, 动作块（action chunk）. Then use one name consistently.
- State the design reason, not just the design: what problem the component solves, what alternative was rejected and why (only from the source, or labeled as inference).
- Keep facts, interpretation and inference visibly separate, as report-spec requires.

## Layout the reader renders well

- Short paragraphs of 2–4 sentences. Numbered lists for processes and derivations, bullets for parallel points, a Markdown table for comparisons (method vs baseline, design choice vs alternative, symbol vs meaning vs shape).
- Bold only the few terms a reader must remember; no decorative bold, no emoji.
- `###` subheadings are fine inside long bodies (method, mathematics); keep them short and noun-like.
- Callouts, rendered as coloured boxes; use at most two per unit:
  - `> [!INTUITION]` the core idea in plain words before the formal version
  - `> [!ANALOGY]` an everyday picture of the mechanism
  - `> [!KEY]` the takeaway to remember
  - `> [!PITFALL]` a common misreading and the correct reading
  - `> [!NOTE]` a source limitation or discrepancy the reader should keep in mind

## Before / after

Rigid:

> 本文提出了一种分层的方法。该方法包括高层和低层。高层预测子任务，低层预测动作。实验表明该方法有效。

Target:

> **一句话：同一个模型先用语言“想”下一步，再用连续动作“做”出来。**
>
> 高层推理先输出一句子任务，比如“拿起盘子”；动作专家（action expert）再把这句话和当前观测一起，变成未来 50 个时刻的关节指令，也就是一个动作块（action chunk）。
>
> > [!ANALOGY]
> > 像厨师先在心里报出“下一步：切洋葱”，手再自动完成一连串细动作。报菜名的和动刀的是同一个人，只是用了不同的“通道”。
>
> 这样拆的好处是：语言层可以直接用网页问答数据学“该做什么”，动作层专注机器人数据学“怎么做”。至于这种拆分到底带来多少提升，要看实验章里对应的对照结果和统计显著性，而不是凭直觉下结论。

(The example illustrates tone and layout only; its content is not a source for any report.)
