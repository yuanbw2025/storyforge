# CREL-13 真实 Development / Sealed Held-out 评测证据

> 日期：2026-08-16
> 结论：前两轮机器门失败并原样留证；v6 第三轮 Development 通过。一次性 sealed held-out
> 保持 100% 可编辑/可采纳和单次生成，但 token 倍率为 1.5144，略高于 1.5 预注册门槛，机器门失败
> 数据：6 个冻结中文合成样例，不含作者项目、手稿或真实作品文本

> **2026-08-17 产品决策补记**：本文件是冻结的历史评测证据，`FAIL`、`0/6`、阈值和 hash 均不修改。
> 独立作者 A/B 与原预注册社区质量门已关闭为本轮交付阻塞项，改由实验性社区观察收集真实使用反馈；
> “关闭”不等于“通过”。见 [社区观察产品决策](../adr/HARNESS-COMMUNITY-VALIDATION.md)。

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

按 2026-08-16 冻结协议，社区体验门结论为关闭：机器门未过，且 6 组独立作者 A/B 盲评尚未完成。
该历史结论不变。2026-08-17 起它不再作为本轮交付阻塞项；不得用机器 verifier 或社区观察伪造作者
A/B 的“愿意继续编辑”、保留比例和预计修改时间。

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
隔离 Chromium E2E 52/52。作者已经明确授权继续使用已配置 API 完成工程，不再逐轮请求费用授权；
但 development 机器门通过前仍不得运行一次性的 sealed held-out。

## 6. 第 2 轮真实 Development 证据

第二轮在 `3776a1b` 上运行，并在开始前将第一轮完整 checkpoint 无损归档。运行身份：

| 项目 | 值 |
|---|---|
| run | `crel-development-cf140cf2-3496-4910-9b24-c28108a47f79` |
| code revision | `v3.9.1+3776a1b` |
| generator / prompt | `agnes-2.5-flash` / `outline.story-arcs-v5` |
| verifier | `deepseek-v4-pro-260425` |
| checkpoint | `66e9d7e6ee1825bfcd078238b90fa8f03e20a9a16783a70aa88768966e40d4d7` |
| record | `98899853ac68181df4fb6d3b4cbf819c22fca2bd92600885e4b8cc2960547378` |

原始验签 checkpoint：
`/Users/qinyingying/Downloads/storyforge-crel-development-completed-1786876470891.json`；
文件 SHA-256：`98b364396bc9819368a7ecc9610f79816ae600ba0f3147c65576b7b7d48d5bba`。

| 方案 | 可编辑 | 可采纳 | 平均产物调用 | tokens/可采纳 | 语义 | 推进 | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 旧直连 | 100% | 100% | 1.00 | 1,982 | 86.7% | 100% | 15.3s |
| CREL v5 | 100% | 33.3% | 1.83 | 20,955 | 78.3% | 100% | 95.9s |

机器门失败项为 `average-artifact-calls`、`token-per-adoptable-artifact`、
`semantic-quality-regression`。12 次独立 verifier 全部完成，因此本轮不是 provider 或验证协议故障。

逐例回看首次响应与最终可编辑产物后，根因进一步收敛：

1. 4/6 CREL 产物的核心故事完整，但阶段只给 `startVolume`、只给 `endVolume`，或把卷号写成布尔值；
   v5 仍把这些可选元数据错误升级成整条故事线结构失败。
2. 触发第二次调用后，结构修复器会重写整份 JSON；`crel-dev-02-rented-memory` 从较完整规划压缩为三阶段，
   独立语义分由旧直连的 0.9 降到 0.6，证明“修复”本身可能劣化可用故事。
3. `crel-dev-06-seed-bank` 首次输出达到 6,000 token 上限后截断；v5 默认允许 7 阶段、每阶段 5 事件，
   对故事线规划过于冗长，直接放大 token、延迟和截断概率。

## 7. 第 2 轮后的 v6 修复边界

第三轮之前的 v6 改动不放宽核心故事合同，只调整失败处理与默认输出密度：

- 不完整、越界、倒序或非整数的 `startVolume/endVolume` 被视为损坏的可选元数据：同时剥离、留下可见
  warning、保留阶段正文和事件，不产生第二次模型调用；合法成对范围继续保留。
- 生成提示默认收紧为 3～5 阶段、每阶段 1～3 个一句话事件；解析器仍兼容已存在的 3～7 阶段和
  每阶段至多 5 个事件，避免破坏作者已有草稿。
- prompt 身份提升为 `story-arc-copilot-v6` / `outline.story-arcs-v6`；v4/v5 历史证据保持冻结。
- 新 checkpoint 在汇总账本之外附带完整 `CreativeArtifactV1`，保留首次原始响应、问题、片段、假设、
  修复目标与调用哈希；旧 v1 checkpoint 无该可选字段时仍可验签读取。
- 第二轮失败 checkpoint 不删除、不覆盖；development 重跑前自动归档，sealed held-out 仍只允许运行一次。

上述 v6 改动已通过 3 个相关回归文件 30 项、完整 CI 387 files / 1892 tests、生产构建、bundle
budget 和隔离 Chromium E2E 52/52。第三轮必须绑定到该全绿提交；若机器门仍失败，继续保留证据并归因，
不得以重复抽样掩盖失败，也不得提前消耗 sealed held-out。

## 8. 第 3 轮真实 Development 证据

v6 第三轮在完整 CI/E2E 通过后运行，结果首次通过预注册机器门：

| 项目 | 值 |
|---|---|
| run | `crel-development-e9da5968-3fa3-4aa3-999b-96db890362cd` |
| generator / prompt | `agnes-2.5-flash` / `outline.story-arcs-v6` |
| verifier | `deepseek-v4-pro-260425` |
| checkpoint | `0fa5fea93a83d8e9e21738a4e612c21f0c4f907f37b279cf4c4376855c582293` |
| record | `6e2117c328c3814007718600f0cab3609a8c3d48684646ba49eb779a0a5a8503` |

原始验签 checkpoint：
`/Users/qinyingying/Downloads/storyforge-crel-development-completed-1786878892732.json`；
文件 SHA-256：`f16164099e6607f5e3f6a639e95367e47ce472ad7b3b89bf2c969fa74ad78275`。

| 方案 | 可编辑 | 可采纳 | 平均产物调用 | tokens/可采纳 | 语义 | 推进 | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 旧直连 | 83.3% | 83.3% | 1.00 | 3,425 | 72.5% | 83.3% | 31.0s |
| CREL v6 | 100% | 100% | 1.00 | 3,125 | 85.8% | 100% | 18.7s |

本轮 12 次生成和 12 次独立 verifier 均成功，生成 input/output 为 11,399/24,477 tokens，verifier
input/output 为 14,622/11,011 tokens。CREL 相对旧直连的 token/可采纳倍率为 0.9125，p95 延迟倍率
为 0.6035，安全通过率 100%，无第二次修复调用。机器门 `PASS`；社区门仍因独立作者盲评 0/6 而关闭。

该文件的 `codeRevision` 为 `v3.9.1+3776a1b`，原因是开发服务器在提交 `53442e2` 前启动，Vite 只在
进程启动时注入 build id。这个字段是已冻结的陈旧启动标识，不做手工改写；同一 checkpoint 的逐调用
账本明确记录 `outline.story-arcs-v6`，完整 `CreativeArtifactV1` 证据及其 hash 也均存在。为避免封存集
出现同样歧义，随后重启服务器，sealed held-out 正确绑定 `v3.9.1+53442e2`。

## 9. 一次性 Sealed Held-out 证据

Development 机器门通过后才清除活动 checkpoint；前三轮 Development 证据已下载，前两轮另有浏览器内
无损归档。sealed held-out 只运行以下一次，完成后不调参、不改门槛、不重跑：

| 项目 | 值 |
|---|---|
| run | `crel-held-out-e199d4da-b9bc-4d3a-a5ba-c9622f9f209b` |
| code revision | `v3.9.1+53442e2` |
| generator / prompt | `agnes-2.5-flash` / `outline.story-arcs-v6` |
| verifier | `deepseek-v4-pro-260425` |
| checkpoint | `c8c903daa09cc6fdfeed277967bfa118223e4a5a495c7b6f24eb8dcd629bab5a` |
| record | `a4613b59bc184e68cd3e39f018b2dbb742181a050a5537548209755079826632` |

原始验签 checkpoint：
`/Users/qinyingying/Downloads/storyforge-crel-held-out-completed-1786880467689.json`；
文件 SHA-256：`59a0a65b278e418297f47ce9bee6a569367d71d9acb82d4434225458c482c2cf`。

| 方案 | 可编辑 | 可采纳 | 平均产物调用 | tokens/可采纳 | 语义 | 推进 | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 旧直连 | 83.3% | 83.3% | 1.00 | 2,108.2 | 73.3% | 83.3% | 19.8s |
| CREL v6 | 100% | 100% | 1.00 | 3,192.7 | 83.3% | 100% | 25.8s |

本轮 12 次生成与 12 次 verifier 全部成功，生成 input/output 为 11,364/18,333 tokens，verifier
input/output 为 13,339/13,303 tokens；已知 verifier 费用为 `$0.01823483`，Agnes 价格仍未登记，
因此总金额保持未知。安全通过率 100%，无零产出、无第二次修复，CREL 语义比分别在因果一致性和
具体性上达到 0.90。

唯一失败项是 `token-per-adoptable-artifact`：实际倍率 1.514404，门槛 1.5；门槛对应 3,162.3
tokens/可采纳产物，实测高约 30.4 tokens/产物（六份合计约 182 tokens）。这个差异不足以否定 v6
解决了“反复修复仍无产物”的主要工程目标，但按预注册协议必须判定机器门 `FAIL`。sealed held-out
已经消耗，禁止依据这六例继续修改 prompt、放宽阈值或换模型重跑。后续成本优化只能使用新的
Development/新冻结终验集。

按本次冻结协议，社区体验门结论为关闭：除机器门失败外，6 组候选没有未参与实现的真实作者 A/B
盲评；机器 verifier 或开发者自评都不能伪装成独立作者结果。2026-08-17 产品决策关闭这两个后续项
作为开发阻塞条件，并转入实验性社区观察，但不改变本文件结论。因此可以确认“工程控制面和可用产物
交付已完成”，仍无证据宣传替作者完成 80% 或把社区观察称为独立 A/B。
