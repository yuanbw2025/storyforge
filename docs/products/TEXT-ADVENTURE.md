# StoryForge AI 主导文字冒险产品契约

> 层级：L2 · 版本：1.0.0 · 生效：2026-09-06
> 状态：目标契约与第一批实现边界；实际完成度仍以能力基线、代码和测试为准。

> **独立分支说明：** `feat/text-adventure-v2-foundation` 是文字冒险游戏开发的独立分支，仅承载 `text-adventure` 的产品契约、生产、媒资、Build/Release、运行、播放器、测试与迁移。其他内容和产品开发不得使用此分支作为开发基线。

## 1. 产品结果与边界

文字冒险是有限篇幅或有限战役、状态驱动、可重放的独立产品。玩家通过明确选择或经合法化的自然语言行动，改变角色能力、资源、装备、物品、关系、任务和叙事状态，并抵达可解释的不同结局。

- AI 主导生产，运行期只做行动映射、对白措辞、确定性结果叙述和非权威建议。
- 确定性规则、正式命令与不可变事件日志是运行状态唯一权威；AI 不得直接写正式状态。
- 产品只读引用冻结 `WorldRelease`，拥有自己的生产工件、媒资、Build、`ProductRelease`、会话、事件和存档；运行结果不自动回写世界引擎。
- 连续立绘站位、演出时间轴、配音口型和路线型 CG 回想归 AVG；持续角色自治和按需世界模拟归文字开放世界。
- 调查证据链、法庭、生存、政治、恋爱攻略、完整经营或战斗循环均不进入通用内核，只能通过版本化能力包与玩法配方扩展。

## 2. 通用内核

`AdventureContentV2` 在统一的行动、前置、检查和效果协议之上登记八个必需能力：空间、角色、背包、装备、任务、时间、storylet 和结局。

- 空间层级是“大区域 → 区域 → 地点 → 场景”；行动仍绑定稳定地点和目标 key。
- 角色能力由通用 `ability` 表达，并以 `stat` / `skill` 角色区分；生命、法力、体力、经验、技能点、货币和时间是有上下界的通用资源角色。
- 装备通过槽位、标签与能力修正生效；同一槽位最多一件装备，重放必须得到相同有效能力值。
- 任务由主线、支线、环境任务分类，包含阶段与目标；一个目标允许多种通用行动完成，失败默认产生代价或新局面。
- storylet 只组合已登记事实、条件和行动；结局候选由作者定义，正式进入仍由冻结叙事节点及状态条件裁决。
- 图片支持纯文字、关键插图、丰富插图三档；纯文字必须始终可完整通关。第一批只冻结媒资策略和引用 key，不新增媒资底座。

## 3. 权威写入与数据生命周期

玩家入口只能提交 `commitAdventureAction()`、`commitAdventureNarrativeChoice()` 或共享存档命令。命令必须带幂等 command id、基线序号和状态哈希；规则结算先纯函数预演，再在事务中追加小事件。播放器、AI 候选和叙述文本均无权直接改状态。

第一批不新增表：内容随不可变 Product RuntimePackage/Release 冻结，运行数据继续使用已登记的产品会话、事件和检查点表。因此导出、导入、删除、分支、重放和迁移沿用 `PROJECT_TABLES` 派生生命周期，不创建旁路清单。

`AdventureContentV1` 暂时保留给旧文字冒险发布和文字开放世界兼容层。文字开放世界必须继续显式要求 V1；V2 私域状态不得被它复用。V1 只能在 V2 发布、运行、存档和迁移完成后按证据收口。

## 4. 第一批纵切面

第一批完成条件是：一个手工 V2 黄金夹具可在无 AI、无图片条件下，从正式 Build/Release 创建会话；玩家可以移动、调查、获取和装备物品、使用属性/技能检查、推进任务和时间、经历失败推进、保存/刷新、从检查点创建分支、事件重放，并抵达至少两个因果不同的结局。

本批不实现 AI 内容生产 DAG、运行期动态出图、专用玩法包或持续世界模拟。它们只能在本契约与确定性纵切面通过后进入后续批次。

### 4.1 当前分支已经冻结的可行性结论

- **合同可演进**：外层 `ProductRuntimePackageV1` 保持不变，文字冒险私域内容升级为严格 `AdventureContentV2`；V1 旧发布仍可读取，文字开放世界继续只接受 V1，未复制第二套公共运行底座。
- **状态可恢复**：V2 继续复用已登记的 session/event/checkpoint 表与小事件协议；同一事件流重放等于当前状态，从检查点分支不会污染父时间线。
- **规则可确定**：随机检查由发布包种子、事件序号与 command id 共同固定；相同输入产生相同骰点、结果与事件证据。装备修正只形成有效属性，不篡改基础属性。
- **叙事可衔接**：行动的正式结果先写事件，再通过冻结 Narrative Choice 推进叙事节点；storylet 和结局只从已登记状态、行动闭集和作者定义条件中选择。
- **共享关系权威可复用**：角色交谈继续提交冻结 interaction scene/rule，关系变化写共享正式事件，不在文字冒险内另造关系状态。
- **媒资可以降级**：V2 已冻结纯文字、关键插图、丰富插图及 `text-only` fallback 合同；第一批不声称已经完成图片生成、审图或发布装配。

对应回归位于 `tests/regression/R-TEXTADV2-foundation.test.ts` 与
`tests/regression/R-TEXTADV2-player-ui.test.tsx`。它们覆盖严格反例、Build、不可变
ProductRelease、离线完整路线、失败推进、角色互动、随机证据、装备、任务、时间、
叙事衔接、存档、刷新、分支、结局和事件重放。

### 4.2 下一批才能开始的内容

下一批应把作者确认的 Brief、叙事骨架、主支线/区域事件任务拆分、规则编译和美术需求清单接入正式 Agent Skill / Run Contract / durable Harness。生产编译器当前仍只生成兼容 V1，不能因为 V2 手工黄金夹具可玩就宣称 AI 已能生产 V2 内容；正式施工前必须先定义结构化候选、依赖图、质量门和人工采纳点。

## 5. 关键代码锚点

- 契约：`src/lib/types/adventure.ts`、`src/lib/types/adventure-v2.ts`
- 内容校验与确定性规则：`src/lib/adventure/runtime.ts`
- 正式命令：`src/lib/adventure/runtime-commands.ts`
- RuntimePackage 边界：`src/lib/product-production/runtime-package.ts`
- 运行组合根：`src/lib/product/runtime-product-adapters.ts`、`src/lib/product/runtime-instances.ts`
- 玩家入口：`src/stores/adventure-game-player.ts`、`src/components/text-game/AdventureGamePlayer.tsx`
