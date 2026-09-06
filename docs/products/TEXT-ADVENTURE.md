# StoryForge AI 主导文字冒险产品契约

> 层级：L2 · 版本：1.2.0 · 生效：2026-09-06
> 状态：现行产品契约与可用工程纵切面；实际完成度仍以能力基线、代码和测试为准。

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
- 当前通用配方中，主线选择拥有向前移动权威；支线在对应地点先呈现为“可接取”，经玩家确认和正式事件变为“进行中”，环境事件则可直接进入行动闭集。不得用无条件相邻移动绕过主线或让地点与叙事节点脱节。
- storylet 只组合已登记事实、条件和行动；结局候选由作者定义，正式进入仍由冻结叙事节点及状态条件裁决。
- 图片支持纯文字、关键插图、丰富插图三档；纯文字必须始终可完整通关。生产期插图通过共享 Provider Adapter、Blob、Build 与 ProductRelease 装配，图片失败不得改变规则状态。

## 3. 权威写入与数据生命周期

玩家入口只能提交 `commitAdventureAction()`、`commitAdventureNarrativeChoice()` 或共享存档命令。命令必须带幂等 command id、基线序号和状态哈希；规则结算先纯函数预演，再在事务中追加小事件。播放器、AI 候选和叙述文本均无权直接改状态。

第一批不新增表：内容随不可变 Product RuntimePackage/Release 冻结，运行数据继续使用已登记的产品会话、事件和检查点表。因此导出、导入、删除、分支、重放和迁移沿用 `PROJECT_TABLES` 派生生命周期，不创建旁路清单。

`AdventureContentV1` 暂时保留给旧文字冒险发布和文字开放世界兼容层。文字开放世界必须继续显式要求 V1；V2 私域状态不得被它复用。V1 只能在 V2 发布、运行、存档和迁移完成后按证据收口。

## 4. 已实现的工程纵切面

当前纵切面从冻结 `WorldRelease` 开始，经非技术作者 Brief、受治理生产、媒资、Build、质量门、预览、发布进入浏览器玩家。玩家可以移动、观察、交谈、获取和装备物品、使用属性/技能检查、推进任务和时间、经历失败推进、保存/刷新、从检查点创建分支、事件重放，并抵达因果不同的结局。

运行期动态出图、专用玩法包和持续世界模拟不属于当前通用纵切面。前者仅预留协议，后两者分别由未来能力模块与文字开放世界产品承载。

### 4.1 当前分支已经冻结的可行性结论

- **合同可演进**：外层 `ProductRuntimePackageV1` 保持不变，文字冒险私域内容升级为严格 `AdventureContentV2`；V1 旧发布仍可读取，文字开放世界继续只接受 V1，未复制第二套公共运行底座。
- **状态可恢复**：V2 继续复用已登记的 session/event/checkpoint 表与小事件协议；同一事件流重放等于当前状态，从检查点分支不会污染父时间线。
- **规则可确定**：随机检查由发布包种子、事件序号与 command id 共同固定；相同输入产生相同骰点、结果与事件证据。装备修正只形成有效属性，不篡改基础属性。
- **叙事可衔接**：行动的正式结果先写事件，再通过冻结 Narrative Choice 推进叙事节点；storylet 和结局只从已登记状态、行动闭集和作者定义条件中选择。
- **地点与身份不会靠占位补齐**：主线、支线和区域事件都要通过地点标题与 `locationOrdinal` 的确定性锚点检查；发生地错位会阻断候选。没有冻结角色来源时不向玩家暴露“产品角色 1”或虚构交谈行动，播放器对旧发布包也会隐藏此类占位内容。
- **任务有正式生命周期**：支线从 `available` 开始，玩家执行接取行动后由 `adventure.quest.accepted` 进入 `active`，完成目标、奖励、失败推进与回放继续使用同一确定性事件协议。
- **共享关系权威可复用**：角色交谈继续提交冻结 interaction scene/rule，关系变化写共享正式事件，不在文字冒险内另造关系状态。
- **媒资可以降级**：V2 已冻结纯文字、关键插图、丰富插图及 `text-only` fallback 合同；生产执行器会生成稳定 asset key 的封面/背景、角色锚点、区域图、关键事件 CG、物品与结局等需求，复用共享媒资 Provider、Blob、权利回执和发布装配。播放器解析冻结媒资并在失败时保持纯文字可玩。
- **AI 生产受治理**：正式计划登记文案主管、叙事骨架、主线、通用系统、支线、区域事件、独立质量审查和美术需求八个有界模型任务；输入只来自 Brief 与已登记上游工件，输出先过严格 schema，再进入 durable run、artifact、receipt 与预算证据链。
- **叙事质量会阻断发布**：独立审查以因果、能动性、路线差异、节奏、铺垫回收、人物动机和情绪触达七项评分；阻塞问题或低分会保留审查 Artifact 并阻止 RuntimePackage 装配，不能以提示词自证通过。
- **作者可观察和复核**：工作台显示阶段、任务、attempt、预算、媒资用量和阻塞原因；当前 Build 的 Brief、架构、主线、系统、任务包、质量审查、媒资需求、运行包和质量报告均可展开核对，试玩与发布仍需作者显式操作。

对应回归位于 `tests/regression/R-TEXTADV2-foundation.test.ts` 与
`tests/regression/R-TEXTADV2-player-ui.test.tsx`、`tests/regression/R-TEXTADV2-production.test.tsx`、
`tests/regression/R-PRODUCTPROD1F-production-executor.test.ts` 以及
`tests/e2e/text-adventure-v2.spec.ts`。它们覆盖严格反例、正式 V2 生产 DAG、60 分钟目标夹具、
独立叙事审查、插图绑定、Build、不可变 ProductRelease、离线完整路线、失败推进、角色互动、
随机证据、装备、任务、时间、叙事衔接、存档、刷新、分支、结局、事件重放和真实浏览器刷新恢复。

### 4.2 当前没有被自动化证据替代的验收

工程纵切面已经能生产并运行 V2。当前分支已使用作者配置的真实 Agnes 文本与图片 Provider 完成一份约 60 分钟目标的内容生产、2/2 媒资装配、不可变发布、11 次主线选择到结局、刷新恢复和 30 分钟浏览器稳定性验收；该证据证明真实链路可用，但不能替代多样本内容质量判断。以下事项仍未完成：

- 在不同题材、不同 WorldRelease 上重复 60–120 分钟生产与完整人类试玩，建立叙事质量基准；一次真实样例只能证明链路和基本可玩性，不能证明稳定精彩。
- 用同一主要角色的多张真实图片验证跨图一致性、可替换/锁定流程和商用权利声明；当前 2 张真实媒资通过运行验收，但尚不足以证明角色跨图一致性。
- 质量审查不通过时，当前采用“保留问题 → 作者发起受影响泳道的下一版演化”，尚未让模型自动改写高影响内容；自动有界修复需另立候选、差异审查和人工闸门。
- `AdventureContentV1` 仍被文字开放世界显式使用；在该产品迁移前不得为了清理旧代码而删除 V1。

## 5. 关键代码锚点

- 契约：`src/lib/types/adventure.ts`、`src/lib/types/adventure-v2.ts`
- 内容校验与确定性规则：`src/lib/adventure/runtime.ts`
- 正式生产 Brief、Artifact 与编译：`src/lib/adventure/production-brief.ts`、`src/lib/adventure/production-artifacts.ts`、`src/lib/adventure/production-compiler.ts`
- 正式命令：`src/lib/adventure/runtime-commands.ts`
- 生产 DAG 与执行器：`src/lib/product-production/plan.ts`、`src/lib/product-production/production-executor.ts`
- RuntimePackage 边界：`src/lib/product-production/runtime-package.ts`
- 运行组合根：`src/lib/product/runtime-product-adapters.ts`、`src/lib/product/runtime-instances.ts`
- 作者工作台：`src/components/product/ProductProductionStudio.tsx`、`src/components/text-game/TextAdventureProductionWizard.tsx`
- 玩家入口：`src/stores/adventure-game-player.ts`、`src/components/text-game/AdventureGamePlayer.tsx`
