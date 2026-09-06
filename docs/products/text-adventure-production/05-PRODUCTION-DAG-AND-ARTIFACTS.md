# 05 · Durable 生产 DAG 与工件方案

> 层级：L2 · 版本：1.8.0 · 生效：2026-09-07
> 性质：正式生产计划、Run Contract 和候选采纳目标契约。

## 1. 目标拓扑

```text
WorldRelease + Confirmed Brief + Frozen SourcePlan
  → content.source-sufficiency（来源编辑候选）
  → source.author-gate（确定性规则 + 必要时作者决策）
  → content.source-decision（绑定审计 hash 的回执）
  → adaptation.brief
  → story.bible ───────────────┐
  → cast.bible                 │
  → systems.design             │
  → narrative.arc-plan         │
  → quest.main-plan            │
  → quest.side-plan + storylet.plan
  → quest.scripts
  → scene.script.act-* (同岗有界并行)
  → dialogue.pass
  → continuity/literary review
  → media.requirements（美术总监候选）
  → media.visual-bible（确定性编译角色/空间/需求闭包）
  → media.anchor-author-gate（商业候选作者确认）
  → media assets + media review
  → deterministic integration
  → qa.autoplay（确定性路线/状态证据）
  → qa.release（确定性发布质量门）
  → qa.playtest-strategy（独立试玩总监）
  → real-browser + author/independent-player receipts
  → recommendation candidate
  → author adopt → immutable ProductRelease
```

关键依赖不可省略：系统设计读取故事/角色；主线任务读取故事弧、角色和系统；支线读取主线；任务脚本读取全部任务与系统；场景正文读取任务脚本；美术清单读取定稿场景和角色锚点。旧 DAG 中“主线与系统并行、支线不读主线”的结构必须下线。

当前代码已经实现来源作者闸门、分场正文、独立对白审校、确定性叙事装配、独立连续性审校、确定性自动游玩和 Playtest Director：来源审计先经 `source.author-gate`，只有 `content.source-decision` 生效后创意总监才可继续；规划、故事、角色、空间、系统、叙事弧、主线、支线和区域事件分别形成已登记任务，随后由 `text-adventure-quest-scripter` 生成严格的 `content.quest-script`；三幕 Scene Writer 分别生成 `content.scene-script.act-1/2/3`，独立 Dialogue Editor 再按幕产生 `content.dialogue-pass.act-1/2/3`，全部通过严格 parser 后，由 `integration.narrative` 应用表达修订并装配 `content.narrative`。

`qa.autoplay` 以零模型调用运行黄金路线、结局覆盖、替代路线、失败注入、状态往返、分支隔离、AI 离线和媒资离线八类检查，产出绑定 Build/package hash 的 `quality.autoplay`。`qa.release` 消费该证据；商业候选的自动游玩失败会阻断。之后 `text-adventure-playtest-director` 使用独立 Skill/Run Contract 和有界证据投影生成 `quality.playtest-plan`，必须覆盖 15 种路线/生命周期用例和至少两场真人试玩。该模型工件最多只可判为“可进入真人验证”，无权产生 `release-ready`。

文字冒险的美术链已经拆成三个权威阶段。Art Director 的模型 Run 只产出 `media.requirements` 候选；`media.visual-bible.compile` 以零模型调用把该清单与 `content.cast-bible`、`content.adventure-architecture` 逐字闭合，冻结整体风格、色板、构图规则、连续性规则、每个角色的身份/视觉锚点和素材引用；商业候选随后停在 `media.anchor-author-gate`，作者未确认前任何图片 Provider 任务都不是 ready。确认回执绑定视觉圣经 hash、全量角色 key、命令与说明。

图片和预留音频也不再藏在一个不可观察的大任务中：`media.visual.001...N` / `media.audio.001...N` 每项拥有自己的 task、subject lock、attempt、预算、checkpoint、Artifact 和 receipt。工作台据此显示“视觉素材 2/8 已签收”等事实进度；单项失败只重试该项。允许纯文字降级时，最终一次失败会生成明确的 omitted-media Artifact，`qa.release` 仍按实际 RuntimePackage 计算媒资覆盖，绝不能把省略回执算作商业素材通过。

真实浏览器刷新、IndexedDB 存读档/分支、损坏恢复、导入导出删除、真人计时和情绪反馈仍必须由后续 E2E 与人工回执完成；`quality.playtest-plan` 不能替代这些证据。

## 2. 计划版本

当前专业链路继续使用已受治理的 `storyforge.product-production-plan` V3，不为产品私域另造计划底座；文字冒险通过新增登记任务和依赖拓扑扩展 V3。计划在开始前冻结：任务 key、Agent/Skill、依赖、输入/输出 Artifact、required receipt、预算、并发组、锁、attempt、timeout、failure policy 和 acceptance gate。若未来字段语义发生不兼容变化，才升级计划版本并保留旧 Build 回放 parser。

V1.2 的一小时纵切面固定为三幕，因此计划创建时已经冻结三个 Scene Writer 任务，不在运行中动态追加 provider 调用。每幕包含哪些场景、选择和结局由 Brief 规模与确定性骨架计算，并由已采纳 `narrative.arc-plan` 精确覆盖；三个任务各自拥有独立的 Run Contract、预算、attempt、receipt 和输出 Artifact。未来支持任意幕数时，必须通过显式 plan revision 与作者预算确认扩展，不能让执行器根据模型输出偷偷追加任务。

`integration.narrative` 是纯确定性装配任务：它读取三幕候选、对白审校、故事/角色/叙事弧和位置投影，验证跨幕不变量，应用只限表达文本的对白修订，再生成统一叙事工件。它不持有模型预算。某一幕的局部缺陷只重跑对应 Scene Writer 及其后代；对白缺陷只回到 Dialogue Editor；无法定位的跨幕缺陷会使三幕候选与对白审校全部 stale 后重跑。装配本身失败时同样回到原始内容 owner，不能在集成层编造修复正文。

## 3. 工件规则

- 每种工件有独立 schema/version/严格 parser；不复用一个“任意 JSON 内容”契约证明专业性。
- Artifact 保存 producer Agent、Skill、Run Contract、输入 key/hash、Context Manifest、候选 hash、验证结果、adoption 状态和 receipt。
- 一个 Artifact key 只有一个 owner task；审查只输出问题工件，不覆盖被审查对象。
- 作者编辑生成新 revision，上游 hash 变化通过依赖图传播 stale；锁定只能阻止覆盖，不能把 stale 伪装成有效。
- 固定内容和旧 Claude 原型仅可作为隔离夹具、算法或测试思想来源，不能整包合并，也不能复制 AI/DB/发布/媒资底座。

## 4. 预算与并发

- 总预算由 Brief 授权，再按故事规划、任务、正文、审校和媒资明确分配；正文任务按目标可见字量分配，不用一个超长主线调用吞掉全部预算。
- 同一 Agent 的场景包可在不重叠的 subject lock 下并行；主线任务与系统完成前不得提前写场景。
- 成本任务、文本 provider 与媒资 provider 分别限流；UI 实时显示已用/预留模型调用、token、成本、时长、媒资数量和存储。
- 高成本或高影响任务开始前设作者闸门；所有任务可暂停、恢复，断点后不重复已确认的副作用。

## 5. 失败与修复

- 鉴权、余额、非重试 4xx、结果未知、stale、预算不足和 schema 大范围不匹配立即暂停。
- 可重试错误最多按 plan 的 `maxAttempts` 执行；每次 attempt 有独立事件和 receipt，不能覆盖失败证据。
- 质量问题定位到 Artifact、字段、证据和建议 owner，由依赖图形成最小修复闭包；作者可预览差异、锁定无关工件后再执行。
- 连续两次同类内容缺陷不自动扩大重生成范围，交回作者决策；不能无界“让模型再试一次”。

## 6. 可观察性

生产事件至少包含 `planned/ready/running/progress/candidate/validating/awaiting-author/accepted/stale/paused/failed/completed`。进度不是虚构百分比：每个阶段按已冻结子任务和权重计算，并显示事实，如“场景正文 4/12 完成”“角色锚点 2/5 已审”。刷新后从 durable ledger 恢复同一状态。
