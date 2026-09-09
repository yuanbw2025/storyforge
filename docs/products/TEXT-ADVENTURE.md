# StoryForge AI 主导文字冒险产品契约

> 层级：L2 · 版本：1.4.0 · 生效：2026-09-10
> 状态：现行产品契约与工程基座；专业生产与旗舰交付以 [`text-adventure-production/README.md`](./text-adventure-production/README.md) 为唯一施工入口。

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

## 4. 当前工程基座与已确认缺口

当前代码已经具备 `AdventureContentV2` 严格合同、确定性行动/事件/随机检查、产品会话与存档、Build/ProductRelease、共享媒资适配器、基础生产工作台和浏览器玩家。这些能力证明“受治理生产工件可以被编译并运行”，仍值得复用。

专业生产底座已登记 18 个独立岗位，每个岗位只挂载自己的核心 Skill；叙事弧、主支线、任务脚本、分场正文、对白、连续性、媒资、自动游玩和真人试玩都有独立 Run Contract、严格 Artifact 与确定性装配边界。完整主线不再压成单任务单阶段；角色系统 Artifact 也必须逐字覆盖冻结 Brief 的全部属性、技能和装备槽。任务路线、技能成长、物品操作、装备、地图、旅程、存档、分支和结局回顾已进入正式播放器与事件权威链路。

这些工程能力仍不等于首款旗舰已交付。当前《潮钟群岛：最后的灯火》的真实 Production 尚需完成最新 Build 的浏览器复核、独立视觉和真人试玩验收、不可变 ProductRelease、实际下载文件与全新 Work 导入通关回环；在这些证据闭合前不得向社区推荐。旧 Build #4 继续只作为负向工程夹具。专业施工和实时状态以 [`text-adventure-production/README.md`](./text-adventure-production/README.md) 及其现行子文档为准。

`AdventureContentV1` 仍被文字开放世界显式使用；在该产品迁移前不得为了清理文字冒险旧实现而删除 V1。

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
