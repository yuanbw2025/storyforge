# 05 · Durable 生产 DAG 与工件方案

> 层级：L2 · 版本：1.0.0 · 生效：2026-09-06
> 性质：正式生产计划、Run Contract 和候选采纳目标契约。

## 1. 目标拓扑

```text
WorldRelease + Confirmed Brief + Frozen SourcePlan
  → source.sufficiency
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
  → visual.bible + media.requirements
  → media assets + media review
  → deterministic integration
  → static quality + autoplay routes
  → author playtest receipts
  → recommendation candidate
  → author adopt → immutable ProductRelease
```

关键依赖不可省略：系统设计读取故事/角色；主线任务读取故事弧、角色和系统；支线读取主线；任务脚本读取全部任务与系统；场景正文读取任务脚本；美术清单读取定稿场景和角色锚点。旧 DAG 中“主线与系统并行、支线不读主线”的结构必须下线。

## 2. 计划版本

新专业链路使用 `storyforge.product-production-plan` 的新版本，旧 V3 只用于已有 Build 回放，不可继续创建文字冒险推荐候选。计划在开始前冻结：任务 key、Agent/Skill、依赖、输入/输出 Artifact、required receipt、预算、并发组、锁、attempt、timeout、failure policy 和 acceptance gate。

场景任务数量由已采纳 `narrative.arc-plan` 确定。系统采用两段计划：先冻结规划子图；叙事弧采纳后，由确定性扩展器生成固定的 Act/场景任务与新的 plan revision，作者确认预算后执行。执行器不能在运行中偷偷新增 provider 调用。

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

