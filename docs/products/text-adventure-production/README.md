# StoryForge 文字冒险专业生产与旗舰交付方案

> 层级：L2 · 版本：1.0.0 · 生效：2026-09-06
> 状态：目标契约、施工入口与当前事实的唯一现行方案包；当前实现与目标有差距时，以本文标出的缺口为施工项，不得用目标描述冒充完成事实。

本方案包把 [`../TEXT-ADVENTURE.md`](../TEXT-ADVENTURE.md) 的产品契约落实为可以逐步实现和验收的专业生产体系。目标不是生成一个能打开的工程夹具，而是从来源充分的冻结 `WorldRelease` 出发，交付一款作者可审查、可导入导出、可发布、可完整游玩，并有资格提交社区推荐的有限篇幅文字冒险。

## 当前裁决

2026-09-06 的《潮钟群岛：最后的灯火》Build #4 只保留为失败基线，不是旗舰成品，也不是“约 60 分钟”的完成证据：

- 主线只有 12 个非结局节点、31 个 beat、15 个选择；单条主路线约 3,200–3,300 个中文内容单位和 11 次必选操作。
- 只有 3 个标记为对白的 beat，没有可交互的正式 NPC 与交谈行动。
- 两处实际分叉中一处立即汇流，另一处直接进入三种一句话结局；选择没有正式条件或效果。
- 质量门把 Brief 目标分钟当作实际时长，把地点、物品、任务与动作描述计入主线字量，并允许零 NPC，因此错误放行。
- 生产注册中的文字冒险岗位全部归属 `outline` Agent；主线与玩法系统并行，支线和区域事件不读取主线，未形成故事到任务脚本的专业依赖链。

这些事实的代码锚点是 `src/lib/product-production/product-quality.ts`、`src/lib/product-production/plan.ts`、`src/lib/product-production/production-executor.ts`、`src/lib/adventure/production-compiler.ts` 和 `src/lib/agent/skill-registry.ts`。修复完成前，工作台必须把旧 Build 标为“工程夹具/不具备推荐资格”，不得继续宣称产品完成。

## 开工卡

- 产品：独立 `text-adventure`，总纲阶段 E，上层产品生产、发布与运行纵切面。
- 数据 owner：具体文字冒险产品实例拥有 Brief、SourcePlan、候选工件、媒资、Build、ProductRelease、会话、事件、存档和私域演化。
- 输入：不可变 `WorldReference`、来源充分的 `WorldRelease`、作者确认的 `ConfirmedProductBrief` 与冻结 `ProductSourcePlan`。
- 输出：版本化候选工件 → 可试玩 Build → 推荐候选 → 作者确认的不可变 ProductRelease → 产品私域运行证据。
- 世界读取：只通过已登记 `CONTEXT_SOURCES`、Context Gateway 和冻结 SourcePlan；运行结果不得回写世界引擎。
- 正式写入：模型输出只进入 `productBuildArtifacts` 候选；确定性校验和作者采纳后才能进入 Build/Release。需要新表、新字段或新来源时先更新三注册表。
- 媒资：归具体产品 Build/Release，复用共享 Provider Adapter、受控 transport、Blob、权利回执和完整生命周期。
- 分支：只在 `feat/text-adventure-v2-foundation` 施工；其他产品不得以此分支为开发基线。

## 方案文档顺序

1. [`01-DELIVERY-CONTRACT.md`](./01-DELIVERY-CONTRACT.md)：旗舰产品结果、范围、推荐候选与发布契约。
2. [`02-AGENT-TEAM-AND-SKILLS.md`](./02-AGENT-TEAM-AND-SKILLS.md)：专业 Agent 团队、岗位 Skill、权限与责任边界。
3. [`03-SOURCE-SUFFICIENCY-AND-ADAPTATION.md`](./03-SOURCE-SUFFICIENCY-AND-ADAPTATION.md)：WorldRelease 充分性、改编策略和产品私域补充。
4. [`04-STORY-TO-QUEST-AND-SCENE.md`](./04-STORY-TO-QUEST-AND-SCENE.md)：故事圣经、主支线任务、任务脚本、场景与对白生产。
5. [`05-PRODUCTION-DAG-AND-ARTIFACTS.md`](./05-PRODUCTION-DAG-AND-ARTIFACTS.md)：durable DAG、工件契约、预算、并发、暂停与局部重跑。
6. [`06-RUNTIME-MEDIA-PLAYER-AND-DISTRIBUTION.md`](./06-RUNTIME-MEDIA-PLAYER-AND-DISTRIBUTION.md)：确定性运行、系统 UI、媒资、导入导出与发布体验。
7. [`07-QUALITY-EVAL-AND-ACCEPTANCE.md`](./07-QUALITY-EVAL-AND-ACCEPTANCE.md)：结构、内容、路线、真人试玩和社区推荐质量门。
8. [`08-IMPLEMENTATION-AND-DELIVERY-PLAN.md`](./08-IMPLEMENTATION-AND-DELIVERY-PLAN.md)：按依赖施工、迁移、回归和最终旗舰交付计划。

## 完成定义

本方案只有在以下事实同时成立后才能标记完成：

1. Agent Registry 中存在职责不同的文字冒险专业 Agent，而不是一个 `outline` Agent 挂载所有岗位 Skill。
2. 来源充分性闸门、故事圣经、角色圣经、叙事弧、主线任务、支线/区域内容、任务脚本、分场正文/对白、连续性审查、媒资和试玩工件形成可恢复 DAG。
3. 一条主路线的可见正文、对白轮次、必需行动、有效决定和实测时长均由发布包与试玩回执计算，不从 Brief 目标反推。
4. 从冻结 WorldRelease 到导入/导出、Build、ProductRelease、刷新恢复和结局的真实链路通过自动化与人类完整试玩。
5. 最终游戏达到 [`07-QUALITY-EVAL-AND-ACCEPTANCE.md`](./07-QUALITY-EVAL-AND-ACCEPTANCE.md) 的“社区推荐候选”标准，并由作者显式确认；外部社区发布仍需单独授权。

