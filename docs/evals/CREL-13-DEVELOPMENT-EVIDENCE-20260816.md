# CREL-13 Development 第 1 轮真实证据

> 日期：2026-08-16
> 结论：机器门失败；完成归因和本地修正，尚未复测
> 数据：6 个冻结中文合成样例，不含作者项目、手稿或真实作品文本

## 1. 冻结身份

| 项目 | 值 |
|---|---|
| suite | `crel-story-arc-zh-development-6-heldout-6-v1` |
| run | `crel-development-161a9874-e87a-4f1f-9db7-50ae76575e70` |
| code revision | `v3.9.1+f58ab72` |
| generator | `agnes / agnes-2.5-flash` |
| generator prompt | `crel-story-arc-paired-v1`，实际首次生成调用为 `outline.story-arcs-v4` |
| verifier | `doubao / deepseek-v4-pro-260425` |
| verifier prompt | `crel-story-arc-independent-verifier-v1` |
| temperature / max output | `0.55 / 6000` |
| checkpoint | `590829223beb090ae4154717fc3e1e21c68107bac1e6d432b981613d4d1784bb` |

原始验签 checkpoint 仅保留在本机：
`/Users/qinyingying/Downloads/storyforge-crel-development-completed-1786851104197.json`。
文件 SHA-256：`68346c8744b2aac7fa1c859b17c30d302a0aeda3205b0f9e7675f46da1325694`。
本报告不复制候选全文，以免仓库内材料提前影响后续独立盲评；所有统计均可由原始 checkpoint 复算。

## 2. 调用与消耗

| 项目 | 结果 |
|---|---:|
| 旧直连生成 | 6 次 |
| CREL 生成 / 修复 | 12 次（6/6 均触发第二次调用） |
| 独立 verifier | 12 次 |
| 总调用 | 30 次 |
| 生成 input / output tokens | 20,446 / 35,332 |
| verifier input / output tokens | 14,548 / 11,807 |
| 总 tokens | 82,133 |
| 已知 verifier 费用 | `$0.01691566` |
| Agnes 费用 | 未登记价格，保持未知，不套用其它模型单价 |

## 3. 聚合结果

| 方案 | 可编辑 | 可采纳 | 平均产物调用 | tokens/可采纳 | 语义 | 叙事推进 |
|---|---:|---:|---:|---:|---:|---:|
| 旧直连 | 67% | 67% | 1.00 | 4,283 | 56% | 60% |
| CREL | 100% | 50% | 2.00 | 12,882 | 86% | 100% |

CREL 的 p95 生成延迟为 39.5 秒，旧直连为 43.4 秒；延迟没有回退。机器门失败项：

- `average-artifact-calls`
- `token-per-adoptable-artifact`
- `verifier-evidence-incomplete`

社区体验门继续关闭：机器门未过，且 6 组独立作者 A/B 盲评尚未完成。不得用机器 verifier
代替作者的“愿意继续编辑”、保留比例和预计修改时间。

## 4. 逐例证据

| fixture | 旧直连 | CREL | CREL verifier | 归因 |
|---|---|---|---|---|
| `crel-dev-01-floating-library` | ready，1 次 | ready，2 次 | 0.70，推进 | 第二次调用成功，但结果证明平均成本边界不合格 |
| `crel-dev-02-rented-memory` | ready，1 次 | manual-repair，2 次 | 0.95，推进 | `turningPoint` 布尔类型导致完整高质量稿被结构门拒绝 |
| `crel-dev-03-bridge-repair` | ready，1 次 | ready，2 次 | 0.90，推进 | 第二次调用成功，但结果证明平均成本边界不合格 |
| `crel-dev-04-time-debt` | protocol-failed | manual-repair，2 次 | 0.85，推进 | `turningPoint` 布尔类型导致完整高质量稿被结构门拒绝 |
| `crel-dev-05-borrowed-name` | protocol-failed | ready，2 次 | 0.90，推进 | CREL 留下可采纳产物，但仍付出第二次调用 |
| `crel-dev-06-seed-bank` | ready；verifier failed | manual-repair，2 次 | 0.85，推进 | 阶段含 4～5 个具体事件，旧 1～3 上限整稿拒绝；旧路 verifier 打满 2,000 tokens 后解析失败 |

所有 CREL 产物均有可编辑文本；三份 `manual-repair` 产物的独立语义评分仍为 0.85～0.95，说明首轮
主要失败不是“没有故事”，而是领域结构合同和失败归因策略把可用内容判成不可采纳。

## 5. 实测后修正

提交 `130e397` 及其后续审计修正完成以下变更：

1. CREL 候选遇到布尔 `turningPoint` 时，只删除无效可选元数据、保留阶段正文和关键事件并显示警告；
   不猜测哪个事件是转折点，也不为此产生第二次调用。
2. `StoryStage.keyEvents` 的正式类型本来就是无固定上限的 `string[]`；新 v5 协议在不改表、不改写回
   入口的前提下允许每阶段 1～5 个具体事件，避免丢弃有效创作内容。
3. 新 Prompt 身份提升为 `story-arc-copilot-v5` / `outline.story-arcs-v5`；H86 `v4` 历史证据保持冻结。
4. verifier 复用单一 JSON 围栏的无损归一化，输出上限从 2,000 调整为 3,000；若仍截断，逐调用证据
   明确记录 `finish_reason_length`，不伪造评分成功，也不自动追加验证调用。
5. 新 checkpoint 逐产物导出 `repairTargetIssueCodes`：只要发生第二次生成调用，就必须保留首次调用触发
   修复的稳定错误码；旧 v1 checkpoint 继续可读，但不能再让“已修复”抹掉为什么花费第二次调用。

本地修正已经通过 3 个相关回归文件 27 项、完整 `npm run ci`、生产构建与 bundle budget，以及
隔离 Chromium E2E 52/52。新的 development 复测属于新的最多 30 次外部调用，必须获得独立费用授权；
在复测通过前不得运行 sealed held-out。
