# AI 主导文字开放世界游戏 · 整体产品与游戏系统施工规格

> 规格版本：1.1.18
> 生效日期：2026-09-06
> 文档层级：L2 文字开放世界整体产品施工入口
> 当前状态：目标架构已冻结并进入分阶段实现；实际完成度以完整开发清单为准
> 对应任务：阶段 E / `E-OPENWORLD-01`
> 完整开发清单：[`TEXT-OPEN-WORLD-IMPLEMENTATION-PLAN.md`](../roadmap/TEXT-OPEN-WORLD-IMPLEMENTATION-PLAN.md)
> 叙事子系统：`TEXT-OPEN-WORLD-NARRATIVE-BASE-ARCHITECTURE.md`
> 首个验收世界：[`TEXT-OPEN-WORLD-SALT-RIDGE-BRIEF.md`](./TEXT-OPEN-WORLD-SALT-RIDGE-BRIEF.md)
> 产品历史：`TEXT-OPEN-WORLD-VISION-AND-EVOLUTION.md`
> 上位权威：`PROJECT-MASTER-CHARTER.md`、`UPPER-PRODUCTS.md`、`DATA-GOVERNANCE.md`、`HARNESS-QUALITY-STANDARD.md`

## 0. 文档定位

文字开放世界不是一套故事生成Prompt，也不是“叙事节点 + 地图 + AI聊天”。它必须是一款由叙事内容、游戏规则、运行状态、产品界面、媒资表现和生产发布共同组成的完整游戏产品。

本文是文字开放世界的整体施工入口，负责把以下体系装配在一起：

1. AI叙事基座：世界来源、故事弧、主线、重要故事线、地区故事和任务脚本；
2. 游戏玩法系统：角色成长、战斗、背包、装备、奖励、制作、经济、任务、地图、关系和时间；
3. 确定性运行时：Action、Condition、Effect、Event、Projection、Checkpoint和分支；
4. 玩家产品：地图、场景、任务日志、角色、背包、战斗、制作、关系、存档和设置；
5. 创作者产品：来源选择、会谈、生产、审查、修复、试玩、发布和更新；
6. AI运行层：自由输入理解、叙事导演、场景演绎和安全降级；
7. 构建发布：Build、质量门、不可变ProductRelease、兼容和迁移。

《AI主导文字开放世界叙事基座 · StoryForge施工规格》继续负责叙事生产的专业细节。本文负责整个游戏的系统边界、模块装配和顶层施工顺序；当两者在跨系统顺序、运行owner或UI边界上冲突时，以本文为准，并同步修订叙事子系统文档。

本文不自动改变路线图优先级。业务代码施工仍需等待稳定的世界来源出口，或由用户明确调整优先级。

### 0.1 使用方法

每个功能施工前必须从本文提取一张功能开工卡：

```text
系统 / 子系统 / 用户入口
玩家循环与可见结果
Release定义 / Session状态 / UI临时态
Action / Condition / Effect / Event
AI读取与候选写入
CONTEXT_SOURCES / FIELD_REGISTRY / AdoptionSchema
PROJECT_TABLES / owner / migration / export / delete
失败与恢复
正例 / 反例 / E2E
替代或下线的旧入口
```

---

## 1. 产品定义

### 1.1 产品承诺

用户选择一个冻结世界版本或受治理的小说来源，设定主角和游戏目标，授权AI完成生产，最终获得一款可以直接发布和真人游玩的文字开放世界游戏。

这款游戏至少包含：

- 一个在游玩前已经规划完成的世界和可探索地图；
- 一条严格顺序但拥有多个合规结局的主线；
- 多条角色、势力、地区或事件的重要故事线；
- 大量普通支线、地区任务、随机事件和成长活动；
- 角色属性、等级、经验、技能和状态；
- 背包、装备、材料、货币、奖励和制作；
- 确定性回合战斗、敌人、掉落、失败、复活和读档；
- 地图探索、旅行、快速旅行、昼夜和天气；
- NPC日程、功能、道德、阵营亲合度和三档态度；
- 系统Action、固定对话选项和自然语言混合交互；
- 任务日志、地图、角色、背包、战斗、关系、存档等完整UI；
- 可恢复的AI生产、不可变发布和版本更新。

### 1.2 第一阶段玩法循环

```text
读取场景与当前目标
→ 选择系统Action / 固定选项 / 输入自然语言
→ 确定性资格与规则判定
→ 移动 / 对话 / 调查 / 战斗 / 制作 / 交易 / 任务推进
→ 结算经验、物品、关系、时间和世界影响
→ 记录Event并更新Projection
→ AI演绎已确定结果
→ 地区导演选择下一个可见机会
→ 玩家继续探索或推进主线
```

### 1.3 第一阶段产品边界

| 可以 | 暂不支持 |
|---|---|
| 玩家长期搁置主线 | 永久放弃或摧毁主线核心目标 |
| 主线多个预制结局 | 运行时临时发明完全不同的主线 |
| 普通任务失败、放弃、过期 | 任务表外任意解法直接写入状态 |
| 普通NPC死亡 | 关键NPC死亡后的全局替代叙事 |
| 偷窃、欺骗、犯罪及局部关系影响 | 加入敌对阵营并让主线整体翻转 |
| 回合战斗；每回合选择普通攻击、技能、道具或逃跑 | 自由描述招式并临场发明数值技能 |
| SVG/节点地图和点击旅行 | 完整像素地图、WASD、碰撞和潜行 |
| 重要NPC按需AI演绎 | 所有NPC由常驻Agent持续推理 |
| 固定配方制作 | AI运行时创造任意新配方和经济规则 |
| 首版不提供友方NPC战斗协助 | 战斗同伴、队伍编成、同伴装备与养成 |

---

## 2. 整体系统图

```text
┌────────────────────────────── 创作者产品 ──────────────────────────────┐
│ 来源锁定 │ Brief会谈 │ 生产计划 │ 内容审查 │ 灰盒试玩 │ 发布/修复/更新 │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                         Production / Build                             │
│                                                                        │
│  叙事生产     角色与成长      任务与世界       玩法规则      媒资与UI    │
│  StoryArc     Attribute       Quest/Region      Combat       MediaSlot │
│  Thread       Skill           Map/Director      Item/Craft   Theme     │
│  Scene        Progression     Time/NPC          Economy      Binding   │
│                                                                        │
│ CreativeArtifact → validate → review/repair → adopt → assemble        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ immutable
┌──────────────────────────────────▼─────────────────────────────────────┐
│                       TextOpenWorldRuntimePackage                      │
│ source + narrative + world + actors + quests + rules + presentation  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                       确定性运行与私域状态                              │
│ Command → Validate → EffectPlan → Event Commit → Projection → Receipt │
│ Player / Inventory / Equipment / Quest / Combat / Map / Time / World │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ verified state/context
┌──────────────────────────────────▼─────────────────────────────────────┐
│                           AI运行层                                     │
│ Intent Mapping │ Narrative Direction │ Dialogue/Prose │ Semantic Review│
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                            玩家产品                                   │
│ 场景 │ 行动 │ 地图 │ 任务 │ 角色 │ 背包装备 │ 战斗 │ 制作交易 │ 存档  │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 系统分层

| 层 | 权威内容 | 不能做什么 |
|---|---|---|
| WorldRelease/来源 | 可版本化世界语义与原文证据 | 保存玩家状态或产品媒资 |
| Production Artifact | 候选设计、来源、验证和修复历史 | 冒充已发布规则 |
| ProductRelease | 不可变游戏内容、规则和媒资绑定 | 被运行时原地修改 |
| Session Event | 玩家命令和正式状态变化 | 修改来源或其他存档 |
| Projection | 从Release、初态和Event计算出的当前状态 | 成为无法重建的唯一事实 |
| AI Candidate | 意图、内容、表现和修复建议 | 直接决定数值或写运行状态 |
| UI State | 面板、筛选、焦点、动画和草稿输入 | 保存任务完成、背包或战斗权威状态 |

### 2.2 跨系统单一事实源

- 玩家等级和经验只属于PlayerProjection；
- 当前生命和战斗状态只属于Player/CombatProjection；
- 物品所有权只属于InventoryProjection；
- 装备状态由Inventory事件派生到EquipmentProjection；
- 任务状态只属于QuestProjection；
- 当前地点和旅行只属于MapProjection；
- 世界时间只属于ClockProjection；
- 道德值属于PlayerProjection，阵营亲合度属于RelationshipProjection；首版不保存独立NPC亲密度；
- NPC态度是派生值，不单独成为可随意修改的第四套关系状态；
- 世界事实与玩家知识分开保存；
- AI输出正文不是事实源。

来源冻结采用双入口但同一证据契约：世界观来源只读取冻结的 `WorldRelease`；小说允许在本产品内建立不可变 `SourcePin`。两者都必须保存版本、Hash、授权范围和实际读取证据，运行时不得读取仍会变化的原始来源。

当前P0实现进一步明确了两类来源的差异：WorldRelease只把便携引用、作者选择和真实目录读取证据带入产品，全文读取留给后续受控Run；小说没有可复用的不可变Release，因此把选定故事核心、大纲和正文完整复制为产品私有、可分片的SourcePinUnit。两类来源共同绑定来源版本、选择边界、Brief/开始revision、nonce Hash、rights、读取permission和证据Hash；同一Build不得静默换源。SourcePin复用Build Artifact生命周期，不为来源另建平行数据库。

当前P1实现继续区分“已冻结”和“模型已读”：小说只通过登记Context Source向单个模型批次交付精确选择的完整私有单元；WorldRelease只通过Context Gateway读取SourcePin已经授权的冻结资源并校验交付Hash。SourceManifest记录逐单元实读状态，SourceLedger要求每项模型结论绑定可复现的逐字证据和偏移，SourceGapReport由代码从实际读集与证据覆盖生成。三件产物都属于文字开放世界Build候选，不回写世界引擎，也不建立第二套产品数据库。

当前P2实现把“作者确认”和“AI设计”明确分层：现有`ConfirmedProductBrief`继续负责作者授权，专属Context Source把同一次授权、SourcePin和P1证据编成完整Hash保护的输入；确定性代码据此生成GameBrief，冻结首版主线、自由度、交互、战斗、演化、媒资、预算和发布边界。模型只能补充ExperienceContract中的体验语义与ProtagonistAsset中的人物叙事，且来源角色必须引用绑定所选角色单元的Ledger事实。P2不会回读活动来源，数值型PlayerBuild也不会提前于GameplayRuleset生成。

当前GameplayRuleset实现继续沿用相同分治：专属Context Source只读取同一Build已验收的体验链和它实际引用的Ledger事实；AI只为规则标题、三属性、技能资源、装备位、货币和标准难度生成符合世界语义的显示文本。代码生成并复验其余全部规则：稳定三属性键、20级和1到5级验收跨度、自动成长与G2公式、四类逐回合战斗、标准难度、有界物理结算、三装备位、单货币、确定性制作/交易上限及当前G2模块版本。Effect白名单直接引用运行时类型事实源，并进一步区分模型可提议、编译器专属和旧Release只读操作，后续内容Agent不能借“创作”生成系统结算标记。

当前PlayerBuild实现把“主角可玩化”拆成语义候选和确定性初始配置：登记Context只读取同一Build已经验收的GameBrief、ExperienceContract、ProtagonistAsset与GameplayRuleset，不回读世界引擎、小说或活动角色表。AI可以完善人物小传式身份、选择描述性玩法风格及不同主副属性，并提出基础攻击、标志技能、初始武器与恢复品语义；它不能改名、改变核心目标、建立职业系统或填写伤害/掉落等运行数值。代码固定1级、主5/副4/其余3的12点属性预算、100初始货币、两项技能和两类物品的稳定键、技能机制映射与初始数量。所有键先作为后续目录生产必须兑现的reservation，Artifact明确保持`reserved-unbound`和`playerDefinitionReady=false`；只有Progression/Item目录真实定义这些键并通过最终绑定后，才能进入G2 PlayerCharacterDefinition和ProductRelease。

### 2.3 跨叙事与玩法的唯一生产 DAG

叙事和玩法不能各自生成完成后再强行拼接。整体产品采用以下顺序：

```text
O0 来源锁定与SourceLedger
  ↓
O1 GameBrief + ExperienceContract + 主角身份
  ↓
O2 三个并行骨架
  ├─ StoryArc / EndingContract
  ├─ GameplayRulesetSkeleton
  └─ PresentationProfile
  ↓
O3 RegionSkeleton + PlayerBuild
  ↓
O4 Mainline / SignificantThread
  ↓
O5 RegionNarrativePack
   + QuestSkeleton
   + ContentRequirementManifest
  ↓
O6 Gameplay Catalogs
   Skills / Items / Enemies / Encounters
   Recipes / Vendors / Rewards / NPC Rules
  ↓
O7 QuestFinalize + EncounterFinalize
   Stage / Objective / Action / Reward / Failure / Time
  ↓
O8 SceneScript + ChoiceContract
   UI Binding + MediaRequirement
  ↓
O9 Balance / Solvability / ContentBudget / SemanticReview
  ↓
O10 Build Assembly / Replay / Preview / ProductRelease
```

关键拆分：

- `GameplayRulesetSkeleton`先冻结属性语义、等级模型、战斗公式族、装备位、货币和Effect白名单，任务生产才知道可以使用哪些玩法；
- `QuestSkeleton`先表达任务动机、阶段目的、玩法需求和奖励预算，不提前引用尚不存在的具体物品或敌人；
- `ContentRequirementManifest`汇总故事需要的敌人、技能、装备、材料、配方、商店、NPC功能和特殊Action；
- Gameplay Catalogs把需求解析为稳定定义；
- `QuestFinalize`再绑定具体Action、敌人、物品、奖励、时间和失败策略；
- 新需求只能通过有界change request回到O5/O6，不能让下游直接修改上游Artifact。

### 2.4 非叙事生产 Skill

| Skill | 输入 | 输出 |
|---|---|---|
| Gameplay Ruleset Architect | Brief、体验、世界规则 | GameplayRulesetSkeleton |
| Player Build Designer | 主角身份、Ruleset | PlayerBuild、初始技能/物品 |
| Progression Designer | 时长、主线Stage、Ruleset | 等级曲线、升级与推荐等级 |
| Encounter Designer | 地区、任务需求、成长曲线 | Enemy/Encounter候选 |
| Item & Reward Designer | 地区资源、任务预算、成长缺口 | Item、DropTable、Reward候选 |
| Crafting & Economy Designer | Item目录、地区功能、时长 | Recipe、Vendor、价格与来源/消耗 |
| NPC Runtime Designer | 角色档案、地区、功能需求 | tier、日程、服务、死亡和关系规则 |
| Map Interaction Designer | RegionSkeleton、Quest需求 | 地点交互、路线、旅行和地图绑定 |
| Presentation Planner | 风格、场景、消费槽 | UI主题、MediaSlot、降级方案 |
| Balance Reviewer | 全部玩法目录与任务 | BalanceReport、问题和修复建议 |

这些是可调度Skill，不是十个常驻Agent。确定性编排器根据DAG创建Run并执行Schema、预算、stale和采纳。

---

## 3. Release 与 Session 总契约

### 3.1 目标运行包

现有 `TextOpenWorldProductRuntimePackageV1` 可以作为迁移基础，但文字开放世界最终需要产品专属的vNext载荷。逻辑结构如下：

```text
TextOpenWorldRuntimePackage {
  metadata
  sourceManifest
  experienceContract
  narrativeModule
  worldModule
  actorModule
  questModule
  actionModule
  progressionModule
  combatModule
  itemModule
  craftingModule
  economyModule
  relationshipModule
  timeWeatherModule
  directorModule
  knowledgeModule
  presentationModule
  mediaManifest
  qualityManifest
}
```

这里的Module是Release内的逻辑分区，不意味着每个Module都需要数据库表。

现行vNext包边界已实现于 `src/lib/types/text-open-world-runtime.ts` 和 `src/lib/open-world/runtime-package.ts`；15个领域payload定义与严格解析实现于 `src/lib/types/text-open-world-modules.ts` 和 `src/lib/open-world/modules.ts`。当前已能验证稳定key、模块依赖、双向归属、跨模块引用、首版冻结规则、完整时间段、区域牌组、构建期任务文案变体、根校准和媒资槽一致性；这表示Release内容合同已经成立，但不代表对应玩法状态机和玩家UI已经完成。

### 3.2 目标运行状态

```text
TextOpenWorldSessionProjection {
  releaseHash
  sequence
  player
  inventory
  equipment
  quests
  combat
  map
  clock
  relationships
  actors
  world
  knowledge
  director
  presentationCursor
  ending
}
```

每个子投影都必须能由 `InitialState + ordered Events` 重建。为了性能保存的runtime head必须携带sequence和hash，校验失败时丢弃并重放。

现行vNext投影实现于 `src/lib/types/text-open-world-session.ts` 和
`src/lib/open-world/session-projection.ts`。RuntimePackage可以确定性生成包含玩家成长、库存与
装备、任务、地图、时间天气、关系、战斗、Actor、世界状态、知识、结局、Action运行约束和
Director预算的完整初态；命令、随机与Effect事件会更新同一投影，并保留中间序号读取能力。
运行包快照随初态冻结，事件重放用Release内Effect定义重新执行计划，不能相信UI提交的after值。

截至G2-28，Director已经从预算占位扩展为正式Release/Session合同：Release冻结逐地区演化规则、
触发牌组、固定任务、任务模板、五类随机事件、权重、Blank、等级/条件、冷却、指纹和强度限制；
Session保存地区压力与结算游标、来源冷却、抽牌历史、动态任务实例和玩家知识历程。玩家成功Action
之后只能由唯一系统Director Action签发授权，以正式随机证据和Effect Receipt原子提交；模板和任务升级
创建独立实例，不改写冻结定义。主线不进入这套自动演化，仍在安全等待点等待玩家。

Condition上下文和Action投影上下文现在由Session Projection统一派生，包括时间段、当前地区
天气、三档NPC态度、合法Actor/地点/物品/任务/商店/遭遇目标、一次性行动和冷却。UI与AI只
消费这份派生结果，不再负责传入自报状态。当前Projection随Session初态保存完整运行包是为了
保证离线、旧Release和重放自足；G1-10会把它与不可变GameRelease绑定并核对来源Hash。

### 3.3 不可变与可变边界

Release内保存：

- 属性和公式定义；
- 等级曲线、技能、物品、配方、敌人和商店定义；
- 地图、地点、任务、NPC、故事和场景；
- 初始状态、限制、媒资和表现配置。

Session内保存：

- 玩家当前等级、经验、生命和状态；
- 物品实例、数量、装备、货币和已学配方；
- 任务实例与阶段；
- 当前地点、时间、天气和已解锁旅行点；
- NPC位置、存活、阵营亲合度、故事修正和局部世界变化；
- 已知事实、已读传闻、已看内容和成就标签；
- 战斗实例、随机证据、发牌历史和存档分支。

---

## 4. 统一命令、行动与事件内核

所有玩法系统必须共享一条提交路径，不能由每个UI组件直接更新自己的store。

### 4.1 CommandEnvelope

```text
CommandEnvelope {
  commandId
  sessionId
  actorKey
  actionKey
  payload
  baseSequence
  baseStateHash
  source: system-action | fixed-choice | mapped-intent
  requestedAt
}
```

现行vNext命令合同实现于 `src/lib/types/text-open-world-command.ts` 和
`src/lib/open-world/command-contract.ts`，权威提交与结果查询实现于
`src/lib/open-world/commands.ts`。命令内容使用稳定指纹；`requestedAt`只作为审计时间，
不进入幂等身份，因此传输重试可以更新时间但不能改变Action、payload、来源或基线。
首次提交只写入一条由`[sessionId+commandId]`唯一约束保护的正式命令事件，同ID同内容返回
原Receipt，同ID不同内容冲突。客户端遇到结果未知时必须查询事件事实源，不得盲目换ID重发。

G1-03只完成提交边界和空操作投影；G1-04～G1-06已经补齐Action可用性、Condition与Effect
规划，但尚未把EffectPlan写成可重放Simulation Event。完成G1-07～G1-08之前，
`text-open-world.command.committed`仍不得被UI解释成玩法成功。

### 4.2 GameActionDefinition

```text
GameActionDefinition {
  actionKey
  category
  label
  description
  actorScope
  targetScope
  locationScope
  requirements[]
  costs[]
  resolver
  successEffects[]
  failureEffects[]
  timeCost
  confirmationPolicy
  presentationRefs
  repeatPolicy
}
```

Action类别第一阶段至少包括：

```text
move / travel / fast-travel / observe / investigate / talk
take / use / equip / unequip / drop / buy / sell / craft
accept-quest / abandon-quest / quest-action
start-combat / continue-combat / escape / rest
read / track / untrack / save / load-branch
```

现行统一Action目录与可用性投影实现于 `src/lib/open-world/action-registry.ts`。Release中的
Action定义是唯一事实源；固定选项、任务Objective、随机事件和教程只保存稳定`actionKey`，
目录可以反查所有消费者。系统Action、固定选项和自然语言映射得到的Command均通过同一
`resolveCommand()`解析，不能由AI或UI临时增加Action。

可用性投影统一判断操作者、当前位置、Condition结果、一次性执行、冷却、合法目标和确认
策略。Condition未提供结果时fail-closed；失败原因只消费Condition返回的公共说明，不从
秘密状态自行拼接。运行时合法目标、Condition结果、一次性记录与冷却现在统一由
`deriveTextOpenWorldContextsV1()`从权威Session Projection派生，不能由页面或模型自报；
底层注册表仍保留显式Context参数，便于纯函数测试和后续服务器权威适配。

### 4.3 提交事务

```text
收到Command
→ 校验Session、Release和baseSequence
→ 校验Action、actor、target和位置
→ 计算Requirements与Costs
→ 生成EffectPlan，但不写数据
→ 校验数值上下界、保护对象和幂等claim
→ 在单一事务中追加Event批次
→ 重建或增量更新Projection
→ 生成CommandReceipt
→ AI根据Receipt生成表现
```

如果AI表现失败，已经提交的游戏状态不能被撤销；使用确定性回执文本作为降级。若规则提交失败，则不能先向玩家显示“成功”。

### 4.4 Condition DSL

条件按域分组，采用白名单操作符：

| 域 | 示例 |
|---|---|
| player | level、attribute、health、status、morality |
| inventory | has-item、quantity、equipped、recipe-known、currency |
| quest | status、stage、objective、result-tag |
| map | current-location、region-known、fast-travel-unlocked、edge-open |
| time | before、after、time-of-day、weather、deadline |
| relation | faction-affinity、attitude、explicit-story-modifier |
| actor | present、alive、protected、schedule-state |
| world | flag、region-pressure、faction-state、ending-eligibility |
| knowledge | player-knows、actor-knows、rumor-heard |

数值操作符限制为 `eq/neq/gt/gte/lt/lte`；集合、状态和可见性使用各自的类型化
`present/statuses/minimum`字段，不接受通用动态路径。复杂逻辑只允许有界的`all/any/not`。
现行合同与解释器实现于 `src/lib/types/text-open-world-condition.ts` 和
`src/lib/open-world/condition-dsl.ts`，覆盖player、inventory、quest、map、time、relation、
actor、world和knowledge九个域。每个Condition最多12层、256个节点，组合节点最多64项；
所有Release资源引用在目录建立时静态校验，未知操作、任意脚本、跨任务阶段和悬空引用均
拒绝。评估结果只返回Condition定义的公共失败说明，不泄露内部叶子或秘密值。

### 4.5 Effect DSL

第一阶段效果白名单：

- change-player-resource；
- grant-experience / level-up；
- apply-status / remove-status；
- grant-item / remove-item / move-item；
- equip-item / unequip-item；
- learn-skill / learn-recipe；
- change-currency；
- transition-quest / complete-objective；
- change-morality / change-faction-affinity / set-explicit-story-modifier；
- reveal-knowledge / reveal-location / unlock-fast-travel；
- enter-location / start-travel / advance-time；
- start-combat / resolve-combat / respawn；
- change-actor-state / change-region-state / set-world-flag；
- unlock-ending / reach-ending。

AI只能生成候选效果。解析器、引用校验器、规则服务和事务决定效果是否可执行。

现行合同与执行器实现于 `src/lib/types/text-open-world-effect.ts` 和
`src/lib/open-world/effect-dsl.ts`。Release加载时严格解析30项白名单操作并静态验证物品、
技能、配方、任务、阶段、目标、地点、道路、阵营、角色、遭遇、知识和结局引用。执行前先在
克隆状态上完成全部效果预演，生成绑定基线状态Hash、结果状态Hash、Release效果定义、影响域
和变化预览的`EffectPlan`；正式应用时再次校验计划Hash、基线、Release定义和预演结果，任一
效果失败都不会产生半提交。`claimKey`写入结果状态防止奖励等效果重复领取；关键Actor、关键
物品、装备中物品、任务状态、数值边界、旅行端点与复活前提由代码保护，不依赖提示词。

### 4.6 Event 设计原则

- Event按Session严格追加并具有连续sequence；
- 每个命令至少有accepted/rejected终态回执；
- 随机结果记录seed、抽样证据和算法版本；
- 奖励、制作、交易和拾取使用claimKey防止重复；
- 复合操作提交一组原子Event，全部成功或全部失败；
- Event载荷只保存重放必需事实，不保存模型完整上下文；
- 表现正文保存引用或压缩回执，避免事件无限膨胀；
- 新规则版本不能改变旧Release和旧Event的重放结果。

现行vNext事件协议实现于 `src/lib/types/text-open-world-event.ts`、
`src/lib/open-world/event-contract.ts` 和 `src/lib/open-world/events.ts`。一个命令批次严格遵循：

```text
text-open-world.command.committed
→ 0..128 × text-open-world.random.resolved
→ text-open-world.effects.applied
```

前一批没有Effect终态时不能接受下一命令。随机事件只接收抽样key和整数范围，结果由冻结的
Session seed、命令序号、drawIndex和`sha256-range-v1`算法决定，并保存seed Hash、输入Hash、
范围和值；重放会重新计算而不是相信事件里的结果。Effect终态保存完整EffectPlan与Receipt，
并用结果批次指纹绑定命令、规则版本、随机请求和效果结果。同一结果批次重试返回原事件，
不同内容复用commandId会失败；随机与Effect事件只能通过单一事务专用入口追加。

### 4.7 Checkpoint、Replay与分支

vNext存档包装实现于 `src/lib/open-world/checkpoints.ts`，继续复用共享
`simulationSessions / simulationEvents / simulationCheckpoints`，不新建另一套存档表。只有已经
写入Effect终态的命令边界可以建立正式检查点；检查时分别报告缺失、作用域错配、Hash格式、
正文损坏、Hash不匹配、内部序号、事件协议和规范重放不一致，不能把所有损坏都模糊成“读档
失败”。runtime head只是派生缓存，损坏时可以在确认事件协议有效后，以并发保护从事件重放
修复。

从历史检查点创建分支时，父Session及检查点之后的事件原样保留；子Session把该时刻完整状态
折叠为新InitialState，并将全局序号、vNext投影序号和待处理协议状态重置为0。已领取claim、
玩家成长和世界结果继续保留，父命令与随机证据历史通过
`parentSessionId + parentThroughSequence`追溯，不复制成子分支伪事件。

---

## 5. 主角创建与角色身份

### 5.1 创建方式

玩家主角支持：

1. 从WorldRelease选择角色；
2. 用户自行填写主角；
3. 用户给出简述，由AI生成候选后确认；
4. 使用游戏提供的预设主角。

无论来源如何，生产结束后都冻结为本游戏Release拥有的 `PlayerCharacterDefinition`。原世界角色只被引用，不被玩家存档反向修改。

### 5.2 身份与规则分离

```text
PlayerCharacterDefinition {
  identity {
    name / pronouns / appearance / background
    personality / publicKnowledge / privateKnowledge
    shortGoal / longGoal / portrayal
    sourceRefs
  }
  build {
    progressionProfileKey
    initialLevel
    attributes
    learnedSkillKeys
    startingItemKeys
    startingCurrency
  }
}
```

人物小传、性格和经历集中存在identity，不拆成十几张角色表。只有参与判定、筛选、UI或知识隔离的字段进入build和结构字段。

### 5.3 创建界面

主角界面至少包含：

- 来源角色/自建/AI辅助/预设四种入口；
- 姓名、代词、外貌、背景和简短人物设定；
- 初始属性和技能预览；
- 初始装备和物品；
- 与主线角色冲突或来源不足提示；
- “故事身份”和“战斗构筑”两个分区；
- 最终确认前展示哪些内容会冻结进游戏。

第一阶段不要求玩家进行复杂配点。生产系统可以根据主角设定提出合法初始Build，用户确认或使用默认值。

---

## 6. 属性与成长系统

### 6.1 目标

属性系统的作用是支撑战斗、成长门槛、装备和少量交互，不复制D&D的完整技能检定体系。数值必须简单、可解释、可平衡、可被代码验证。

### 6.2 规则配置

不同世界可以更换名称和表现，但第一阶段必须映射到三项统一语义：

| 语义 | 默认显示名 | 主要影响 |
|---|---|---|
| power | 力量 | 物理攻击、部分装备需求 |
| vitality | 体质 | 最大生命、防御或恢复 |
| agility | 敏捷 | 行动顺序、暴击倾向和部分技能效果 |

第一阶段不设置“专注”或第四项通用属性，也不让每个世界生成一套不同的底层属性键。世界可以改变三项属性的显示名称，但必须保持 `power / vitality / agility` 稳定，避免任务、装备、技能和战斗公式失去共同契约。

### 6.3 派生属性

Release中的 `ProgressionRuleset` 选择预定义公式并提供参数：

```text
maxHealth = baseHealth + vitality * healthPerVitality + level * healthPerLevel
attackPower = weaponAttack + mainAttribute * attackCoefficient + flatAttack
defense = armorDefense + vitality * defenseCoefficient + flatDefense
criticalChance = clamp(baseCrit + agility * critCoefficient, 0, critCap)
initiative = agility * initiativeCoefficient + equipmentInitiative
skillPower = skillBase + attributes[skill.scalingAttribute] * skillCoefficient + equipmentSkillPower
maximumSkillResource = baseSkillResource + level * resourcePerLevel + equipmentSkillResource
```

这些是首个验收规则的默认公式，不是所有世界不可改变的常量。AI可以建议参数，确定性平衡器验证上下界和曲线。

### 6.4 等级和经验

第一阶段采用数字等级：

- 系统等级上限固定为20级；
- 首个验收世界从1级开始，目标成长到5级；
- 每个等级有明确累计经验阈值；
- 经验来自任务、战斗、探索和少量成就；
- 同一奖励claim只能结算一次；
- 升级按规则自动提高基础属性或最大生命，不给玩家分配属性点；
- 已学技能首版只通过升级解锁和任务奖励获得；探索学习和消耗道具学习留待后续；
- 升级后的当前生命恢复策略由规则配置决定；
- 经验达到最高等级后不继续溢出造成数值错误；
- 主线推荐等级只是提示，不能成为不可恢复的永久阻断。

第一阶段不设置固定职业，也不支持职业转职、天赋树、洗点和随机成长。角色差异只由三项属性、技能和装备组合形成。

### 6.5 PlayerProjection

```text
PlayerProjection {
  characterKey
  level
  experience
  attributes
  derivedStats
  health / maximumHealth
  skillResource / maximumSkillResource
  learnedSkillKeys[]
  activeStatus[]
  morality
  respawnPointKey
  playTime
}
```

### 6.6 角色UI

角色页包含：

- 主角头像、姓名、等级、经验条；
- 当前/最大生命和技能资源；
- 核心属性和派生战斗属性；
- 当前装备及其加成来源；
- 已学技能、冷却、消耗、解锁等级和任务来源；
- 当前状态效果；
- 道德值及解释；
- 数值明细面板，说明每项由基础值、等级、装备和状态如何组成。

---

## 7. 技能与状态系统

### 7.1 SkillDefinition

```text
SkillDefinition {
  skillKey / title / description / tags
  kind: active | passive
  target: self | single-enemy | all-enemies
  scalingAttribute: power | vitality | agility
  unlockConditions
  resourceCost
  cooldownTurns
  priority
  useConditions
  effectSequence[]
  presentationRefs
}
```

第一阶段技能效果来自Effect白名单，例如伤害、治疗、护盾、增益、减益、多次命中或改变出手顺序。模型不能在战斗时解释一段自由文本并临时发明技能效果。

### 7.2 玩家回合操作

玩家每回合从四类正式操作中选择：

1. 普通攻击：无资源消耗，首版默认命中；
2. 技能：从已学习、冷却结束且资源足够的技能中选择；
3. 道具：从当前战斗允许使用的消耗品中选择；
4. 逃跑：按遭遇规则尝试结束战斗。

第一阶段不提供自动战斗策略、技能优先级或自由文字战斗动作。敌人仍由确定性 `strategyProfile` 选择行动；未来如果加入自动战斗，应建立在同一套合法Action之上，而不是另建结算逻辑。

### 7.3 状态效果

状态至少支持：

- 有益/有害/中性分类；
- 持续回合或持续世界时间；
- 不可叠加、刷新、叠层三种规则；
- 属性修正、回合伤害/治疗、行动限制；
- 来源和应用Event；
- 战斗结束、休息或时间到期移除。

### 7.4 技能UI

- 技能列表、类型、消耗、冷却和效果；
- 锁定技能显示解锁条件；
- 技能来源：升级或任务奖励；
- 不展示模型无法兑现的自由文本效果。

---

## 8. 生命、休息、失败与复活

### 8.1 生命状态机

```text
healthy / wounded
→ defeated
    → respawned
    → load-branch
    → encounter-retry
```

玩家战斗失败不等于主线失败。第一阶段支持：

- 在复活点恢复；
- 从战前自动检查点重试；
- 读取已有存档分支；
- 逃跑成功后保留约定代价。

### 8.2 复活契约

复活必须明确：

- 复活地点；
- 恢复生命比例；
- 是否保留消耗品和耐久变化；
- 是否扣除货币或时间；
- 敌人是否重置；
- 任务和主线是否保持；
- 是否生成死亡/失败回执供后续对白引用。

第一阶段默认不永久丢失装备，不因普通战斗失败关闭主线。

首版复活没有额外货币、世界时间或消耗品惩罚，只把玩家恢复到安全状态。战前重试恢复到战前检查点；复活点恢复保留此前已经正式提交的事件，二者在界面上必须说明差异。

### 8.3 休息

休息是正式Action：

- 推进世界时间；
- 恢复生命或技能资源；
- 触发日程、天气、任务期限和地区演化；
- 在危险地点可能被禁止；
- 不能无限重复领取每日奖励。

---

## 9. 战斗系统

### 9.1 目标体验

战斗是清晰、可预测、有成长反馈的文字回合制系统。玩家每回合选择普通攻击、技能、道具或逃跑，但不能输入自由招式，也不能让模型临场发明战斗效果。

### 9.2 CombatDefinition

```text
EnemyDefinition {
  enemyKey / title / level / family
  attributes / derivedStats
  skillKeys / strategyProfile
  rewards / dropTable
  tags / presentationRefs
}

EncounterDefinition {
  encounterKey / locationRefs / questRefs
  participantGroups
  levelBand / difficultyLabel
  escapePolicy / defeatPolicy
  rewardContract
  openingTextRef / victoryTextRef / defeatTextRef
}
```

现行`Combat`模块v2已经把这两个定义落实为Release内不可变合同：

- `EnemyDefinition`保存等级、生命、攻击、防御、暴击、先攻等已编译运行数值，以及技能闭集、确定性策略、掉落表、来源和媒资槽；首版不再复制一套可能漂移的敌人通用属性；
- `StrategyProfile`只能按冻结优先级选择主动技能，并必须有位于该优先级中的回退技能；每项策略都必须有敌人使用；
- `EncounterDefinition`用有序敌人组表达敌人种类和数量，绑定地点、可选任务引用、推荐等级、等级区间、强度、逃跑、战败恢复、战斗奖励和三段表现文本；
- 每个新遭遇必须且只能由一个合法`start-combat` Action进入；到达地点本身仍不触发战斗；
- 战斗奖励必须是该遭遇独占的`combat`来源RewardContract，且覆盖敌人掉落表，避免正文、敌人和奖励各写一套；
- `DifficultyProfile`首版必须且只能有`standard`，所有倍率固定为1；运行时代码不能让AI暗改难度；
- 查询层可以在开战前给出敌人构成、相对等级、逃跑和失败恢复方式，但只读投影不会创建战斗状态。

旧Combat v1 Release仍可读取，并确定性补齐标准难度、敌人策略、敌人组和失败策略；由于旧结构没有RewardContract所有权证据，兼容读取不会猜测或冒领战斗奖励。

### 9.3 战斗状态机

```text
prepared
→ started
→ round-start
→ actor-turn
→ action-resolved
→ next-turn / round-end
→ victory / defeat / escaped / aborted-by-recovery
→ rewards-claimed / respawned
```

G2-23已经把其中“进入战斗到战斗终态”的确定性骨架落入正式运行体系：

- Combat v2 Session中的每次战斗具有稳定`instanceKey`，并保存遭遇、战斗状态、阶段、轮次、行动索引、当前行动者、玩家先攻、冻结回合顺序及逐个敌人实例；敌人实例由Release遭遇组按稳定键展开，不能由演绎正文临时增删；
- 当前阶段合同为`started → round-start → actor-turn → action-resolved → actor-turn/round-end → ...`，仅`action-resolved`可以进入`victory / defeat / escaped`；死亡、终态和游标不一致会在状态验证时失败关闭；
- 平局按“高先攻优先、玩家优先、稳定参与者键”决定，回放不依赖对象遍历顺序或AI描述；跳过已战败参与者，具体伤害与战败标记由Combat v3的确定性结算负责；
- 开战仍是玩家`start-combat` Action与`initialize-combat` Effect；它先建立既有战前重试点，再把`started`状态写入正式事件；代码随后用唯一系统`combat-state-action`和`settle-combat-state` Effect自动推进到首个可行动者；
- 每次阶段迁移都由代码针对当前状态生成`CombatTransitionAuthorization`，冻结迁移意图及前后阶段、轮次和行动者快照。Effect计划、系统命令、Session待处理游标与Replay会交叉核验，普通Action不能借用该Effect；
- 战斗不创建第二事件流，所有迁移继续使用ProductRuntime的`text-open-world.command.committed`与`text-open-world.effects.applied`事件，因此刷新、检查点和分支沿用同一恢复路径；
- Action v9必须与Combat v2成对发布。旧Combat v1/Action v8 Release仍按`{encounterKey,status}`旧投影执行和重放，不被悄悄升级为缺少证据的新战斗实例。

图中的`prepared`目前由战前检查、确认和重试检查点表达，不另存一个可漂移的战斗阶段；`aborted-by-recovery`仍由既有复活/分支生命周期表达。实际回合操作由G2-24完成，数值、随机证据、状态和胜负奖励由G2-25完成。

G2-24在阶段机之上完成了“选择一项行动并把回合交还玩家”的确定性闭环：

- Action v10要求普通攻击、每项玩家战斗技能、每种可消耗道具、逃跑和敌方技能都有唯一静态Action与`perform-combat-action` Effect，Build同时校验技能/道具双向覆盖、资源cost、条件、目标范围和Effect闭集；
- Session只增加必要的回合冷却和`lastAction`投影；Action可用性直接复用已学技能、技能资源、Condition、背包和存活敌人投影，不在战斗页建第二份临时状态；
- 玩家行动签发`CombatActionAuthorization`，冻结行动者、目标、资源、冷却、Effect闭集及行动前阶段；通用EffectPlan原子处理技能消耗和物品消耗，战斗行动代码只记录行动并推进阶段；
- 玩家回合后，系统根据Release冻结的`StrategyProfile`按优先级选取非冷却技能，必要时使用零冷却回退技能，并以正式系统命令执行；所有敌人行动后再回到下一玩家回合；
- 逃跑也是一项玩家行动，成功记录后状态机直接进入`escaped`终态，不再执行敌方回合；未学、资源不足、冷却中、无道具、非当前行动者、非存活目标和授权篡改均失败关闭；
- Action v9与旧Combat v1均保持原投影可读可重放，不会在旧Release中凭空补齐新行动证据。

### 9.4 确定性结算

每回合：

1. 按initiative和稳定平局规则确定顺序；
2. 玩家提交普通攻击、技能、道具或逃跑；敌人按确定性策略选择合法行动；
3. 校验资源、冷却、目标和物品可用性；
4. 计算伤害、暴击、护盾、治疗和状态；普通攻击首版默认命中；
5. 为每个随机值保存seed与抽样证据；
6. 提交原子Event；
7. 检查胜负、逃跑或下一回合；
8. AI根据回执生成一段简洁演绎。

伤害公式使用Ruleset中预定义的公式ID和参数，不接受任意字符串 `eval`。必须保证：

- 伤害、生命和资源有上下界；
- 暴击率和减伤率有封顶；
- 同一seed和输入产生相同结果；
- 死亡后不能继续行动；
- 奖励只在胜利终态领取一次；
- 逃跑不会同时结算胜利奖励。

G2-25已经把上述原则落实为可重放的正式合同：

- Combat v3冻结`bounded-physical-v1`算法ID、万分制暴击抽样范围与封顶、暴击整数倍率、全局最小/最大伤害，以及每项主动攻击技能的整数倍率和固定加值；这些参数属于Release，不随运行时代码升级漂移；
- Action v11为每个攻击目标生成稳定随机请求，正式事件保存seed派生证据；`CombatActionAuthorization`同时冻结攻防值、技能公式参数、伤害各阶段、暴击抽样、实际扣血及生命前后值，Replay会根据旧Release和事件重新计算并拒绝篡改；
- 玩家攻击读取统一玩家派生值服务，敌人攻击读取Combat模块冻结数值；所有计算使用安全整数、有界裁剪且实际伤害不超过当前生命，普通攻击不另做命中判定；
- 伤害、技能已有的状态Effect、资源和冷却仍进入同一EffectPlan，不建立战斗私有写入路径。Combat模块显式声明哪些玩家状态只在本场有效，胜利、战败或逃跑终态由系统迁移原子清除；
- 代码只在所有敌人死亡时进入`victory`，只在玩家生命为零时进入`defeat`，只在已结算逃跑行动后进入`escaped`；死亡参与者不能再行动；
- 胜利终态触发唯一系统`combat-reward-action`，按遭遇独占RewardContract和战斗实例claim结算经验与掉落；重复结算返回既有结果，失败和逃跑没有这条奖励路径；
- Action v10/Combat v2 Release继续按旧合同执行与重放，不被静默补齐新公式或伪造随机证据。

### 9.5 遭遇强度与提示

遇敌前可以显示：

- 推荐等级；
- 敌我强度：轻松、相当、危险、致命；
- 可能的主要伤害类型或特殊状态；
- 是否允许逃跑；
- 战斗失败后的恢复方式。

这只是提示，玩家仍可挑战高等级敌人。

### 9.6 战斗UI

战斗界面至少显示：

- 玩家和敌人的生命、状态、等级；
- 当前轮次和行动者；
- 本回合技能、伤害、暴击、状态和资源变化；
- 精简战斗日志与展开后的计算明细；
- “普通攻击”“技能”“道具”“逃跑”四类操作；
- 技能和道具选择面板必须显示不可使用的原因；
- 胜利奖励、失败恢复和重试入口；
- AI表现失败时仍可读的系统回执。

### 9.7 难度配置

首版只有“标准”难度，不在开场或设置页提供难度选择。`DifficultyProfile`仍作为未来扩展契约存在，只能调整Release声明的参数，例如：

- 敌人生命、攻击和防御倍率；
- 玩家受到伤害倍率；
- 逃跑成功率；
- 复活代价；
- 推荐等级提示精度。

难度不能在后台由AI动态改变，也不能改变主线事实。首版所有Session固定绑定 `standard`；未来增加难度档位时，修改必须生成正式设置Event并说明对当前战斗是否立即生效。

---

## 10. 物品、背包与装备系统

### 10.1 定义与实例分离

```text
ItemDefinition {
  itemKey / title / description / category / tags
  stackPolicy / maxStack
  keyItem / droppable / sellable / consumable
  baseValue
  useActionKey
  equipmentDefinition?
  sourceRefs / presentationRefs
}

ItemInstance {
  itemInstanceId
  definitionRef
  ownerRef / containerRef / locationRef
  quantity
  equippedSlot?
  charges?
  durability?
  acquiredByEventId
  stateTags[]
}
```

第一阶段可堆叠材料和消耗品可以按定义聚合；独特装备和关键道具使用独立实例。

### 10.2 背包规则

- 物品数量不能为负；
- 获得、消耗、转移和出售必须写Event；
- 关键道具不可丢弃、不可出售、不可被普通制作消耗；
- 唯一物品重复奖励必须被拒绝或转换为显式替代奖励；
- 消耗品效果由正式Action执行；
- 第一阶段默认不启用重量和格子上限，避免仓储管理压过叙事；
- 如果特定世界需要容量，使用Ruleset开关和明确上限，不临时写进Prompt。

### 10.3 装备

第一阶段建议最小装备位：

- weapon；
- armor；
- accessory。

世界可以改变显示名称或禁用某类装备，但底层装备位集合必须冻结在Release中。装备只提供固定属性和Skill/Effect引用，第一阶段不生成随机词缀、套装、强化等级和复杂耐久经济。

装备事务：

```text
检查物品归属与装备位
→ 检查等级/属性需求
→ 自动卸下冲突装备
→ 追加unequip/equip事件
→ 重算派生属性
→ 若最大生命下降，按规则裁剪当前生命
→ 返回前后对比Receipt
```

### 10.4 背包和装备UI

背包页：

- 分类：全部、装备、消耗品、材料、任务物品；
- 搜索、排序和数量；
- 详情、来源、用途、使用/装备/出售/丢弃；
- 关键道具保护说明；
- 新获得和未查看标记。

装备页：

- 装备位和当前物品；
- 候选装备列表；
- 更换前后属性对比；
- 新增/失去技能与状态说明；
- 不满足条件的明确原因；
- 一键恢复上次配置属于后续增强。

---

## 11. 奖励与掉落系统

### 11.1 RewardContract

奖励可以包含：

```text
experience
currency
items / materials / equipment
skillUnlocks / recipeUnlocks
moralityDelta
factionAffinityDelta
knowledgeReveal
locationReveal / fastTravelUnlock
achievementTag
worldEffect
```

### 11.2 奖励原则

- 每份奖励拥有唯一claimKey；
- 任务奖励、战斗掉落、探索发现和制作产物走同一Reward/Inventory事务；
- 奖励预算由任务叙事等级、预计时长、难度和一次性决定；
- AI提出语义和候选组合，代码检查预算与引用；
- 不用无上限随机装备制造虚假体量；
- 普通任务主要补充玩家成长资源；
- 重要故事线可以提供技能、特殊装备、关系和长期世界变化；
- 主线奖励同时承担阶段成长和新地区/功能解锁。

### 11.3 DropTable

掉落表必须记录：

- 候选物品；
- 权重或固定概率；
- 数量范围；
- 保底/唯一规则；
- 等级和地区条件；
- seed和算法版本。

掉落先确定后表现。AI不能在战斗胜利文本中额外赠送未结算物品。

---

## 12. 制作系统

### 12.1 RecipeDefinition

```text
RecipeDefinition {
  recipeKey / title / category
  inputItems[]
  inputCurrency[]
  outputItems[]
  requirements[]
  stationTag?
  timeCost
  discoverPolicy
  presentationRefs
}
```

### 12.2 第一阶段规则

- 支持装备和药剂等固定配方；
- 默认制作100%成功，不加入随机品质；
- 配方可以初始已知、任务解锁、物品学习或NPC教授；
- 材料检查、扣除、产出、时间推进和claim在同一事务中；
- 关键任务物品不能被错误消耗；
- 批量制作受数量、材料和事件大小上限限制；
- AI生成配方候选时必须使用已存在材料和物品定义，或者在生产阶段连同新定义一起审查；
- 运行时不允许AI即时创造新配方。

G2-26已经把这些规则落实为Crafting v2与Action v12的正式运行合同。Crafting v2冻结`guaranteed`成功策略、批量上限、单次事件物品单位上限，并为每个配方保存类别、学习状态、制作地点、确定性条件、材料、产物、单份耗时和表现引用。Build要求每个配方恰好对应一项玩家`craft` Action和一个`perform-crafting` Effect；非默认配方还必须存在可引用的`learn-recipe`解锁Effect。输入材料只能是非关键、可堆叠物品，输入输出不得重叠，单份配方与产物堆叠必须在冻结预算内，因此不可执行配方不会进入Release。

玩家命令显式提交配方目标和批量数量。代码在提交前核验已学习、当前位置、Action条件、材料数量、产物容量、批量与事件大小，再签发`CraftingAuthorization`，冻结制作前后的材料/产物数量、世界分钟和总耗时。唯一制作Effect在同一个EffectPlan内扣料、生成堆叠或实例产物并推进时间，claim保证同一命令不会重复制作；事件重放会再次核对命令数量、Action、配方、状态快照和授权。Crafting v1继续按旧Release读取，但没有正式制作Action，不能被运行时静默升级为可执行配方。

### 12.3 制作UI

- 已知/未解锁配方；
- 可制作/材料不足筛选；
- 所需材料、库存数量、产物、时间和货币；
- 数量选择和最大可制作量；
- 缺少材料的来源提示；
- 制作结果和库存变化回执。

---

## 13. 经济、商店与服务

### 13.1 第一阶段经济边界

第一阶段使用简单、稳定的游戏经济：

- 每个ProductRelease只使用一种通用货币；
- 固定基础价格；
- NPC/地区修正、关系修正和买卖倍率；
- 普通商品无限供应，特殊商品可以配置有限库存；
- 购买、出售和服务消费；
- 不建设全世界供需模拟、通货膨胀、拍卖行和复杂动态价格。

### 13.2 VendorDefinition

```text
VendorDefinition {
  vendorKey / actorKey / locationKey
  currencyKey
  buyCategories / sellCategories
  inventoryEntries[]
  restockPolicy
  baseBuyMultiplier / baseSellMultiplier
  relationshipModifiers
  availabilityConditions
  serviceActionKeys[]
}
```

### 13.3 交易事务

购买：检查商店可用、库存、货币、物品限制和背包规则，然后原子扣款、减库存、加物品。

出售：检查物品归属、可出售性、装备状态和商店类别，然后原子移除物品、增加货币和更新库存。

任何失败都返回明确原因，不允许出现扣钱但没得到物品，或刷新后重复购买的问题。

### 13.4 商店UI

- 购买/出售/服务页签；
- 玩家货币；
- 商品类型、库存、单价和总价；
- 装备属性对比；
- 关系对价格的影响说明；
- 关键物品不可出售提示；
- 交易前确认和交易后回执。

### 13.5 当前确定性经济实现

首版运行合同已经收口为 `EconomyModule v2 + ActionModule v13`：

- Economy模块只保存ProductRelease拥有的单一货币、商人目录、营业条件、可买卖类别、基础整数价格以及商品的无限/有限库存声明；
- Session只保存玩家货币、玩家物品实例与数量，以及每个商人的有限库存余量；普通无限商品不复制为运行状态；
- 买价向上取整、卖价向下取整，基础价、商人倍率和现有三档关系价格倍率统一使用整数基点运算，避免浮点重放漂移；
- 构建期逐关系档检查同商人的买卖组合，存在无风险套利时禁止发布；
- 每个商人必须拥有唯一的购买Action、出售Action及对应`perform-transaction`标记Effect，运行时由代码根据命令中的物品和数量生成专用交易授权，不允许内容作者预写任意扣款结果；
- 购买和出售在单一EffectPlan内原子更新货币、物品和有限库存；任一条件、价格、库存或物品状态不匹配则整单失败；
- 装备中的实例、关键物品、不可出售物品和商人不接收的类别不能出售；商人接收的玩家售回物成为有限库存；
- Command、Event与Replay保存并复核商人、物品、数量、地点、时间、态度、价格拆解和交易前后值，使刷新、幂等重试和事件篡改均可确定性裁决；
- Economy v1仅按旧Release原义读取，不自动获得v2交易语义。

---

## 14. 任务系统与任务UI

叙事层级、QuestDefinition、ChoiceContract和内容时长由叙事子系统文档详细定义。本节规定游戏运行和玩家交互。

### 14.1 QuestProjection

```text
QuestInstance {
  instanceKey
  definitionRef / templateRef
  narrativeTier
  ownerKind / ownerRef
  regionRefs[]
  status
  currentStageKey
  objectives[]
  offeredBy / offeredAt
  acceptedAt / deadline
  tracked
  resultTag?
  terminalAt?
  rewardClaimKey?
  sourceContentHash
}
```

### 14.2 状态机与规则

```text
locked → available → revealed → accepted → active
                                     ├→ completed
                                     ├→ failed
                                     ├→ abandoned
                                     ├→ expired
                                     └→ suspended → active
revealed ├→ abandoned / expired / withdrawn
abandoned → available → revealed（仅可重接普通任务）
```

- 主线不能fail、abandon、expire、withdraw或被普通NPC死亡永久阻断；
- 重要故事线不能被玩家删除或因长期不参与永久失败；推进到预设安全等待点后等待玩家；
- 普通不限时任务放弃后可以通过原渠道再次出现；
- 普通限时任务到期关闭；
- 随机事件只有产生多步目标时才创建QuestInstance；
- 完成目标、阶段切换、奖励领取必须分别留下事件证据；
- 任务正文可以压缩，但状态、重要结果和指纹不能丢失。

### 14.3 同时持有大量任务

存档可以保存大量任务，UI和AI上下文不必一次加载全部：

- 主线始终有独立区；
- 重要故事线按角色、势力、地区或事件分组；
- 普通任务按当前地区、临近期限和玩家追踪排序；
- 已完成/失败/过期进入历史；
- AI只读取当前场景、追踪任务、相关角色地点和必要主线摘要；
- 玩家选择一个主追踪任务，并可额外钉选若干任务；首版HUD最多同时显示主追踪任务和3个钉选任务；
- 取消追踪不等于放弃，主线和重要故事线始终保留在任务日志中。

### 14.4 任务日志UI

任务日志至少提供：

- 主线、重要故事、普通支线、随机任务、历史分类；
- 地区、角色、势力、期限和状态筛选；
- 任务说明、当前阶段、目标、奖励预览和相关人物地点；
- 追踪/取消追踪；
- 普通任务放弃；
- 主线和重要故事线为什么不可放弃的提示；
- 失败、过期、重接和后续回响；
- 地图定位；
- 任务来源、关键已知事实和最近更新记录。

---

## 15. 地图、探索与旅行

### 15.1 三层空间

```text
WorldMap
  → Region
      → Location
          → Scene/InteractionPoint
```

Release保存地图图结构和表现布局；Session保存玩家当前地点、已知状态、解锁点、道路状态和旅行过程。

### 15.2 MapDefinition

```text
RegionDefinition {
  regionKey / title / summary / theme
  levelBand / knowledgePolicy
  locationKeys[] / fastTravelPointKey
  regionStateDefinition / presentationRefs
}

LocationDefinition {
  locationKey / regionKey / title / type
  summary / functions / actorRefs / questRefs
  visitStates / discoveryConditions
  sceneRefs / presentationRefs
}

TravelEdgeDefinition {
  edgeKey / from / to / bidirectional
  durationMinutes / riskProfile
  requirements / blockConditions
  travelEventDeckKey
}
```

### 15.3 探索规则

- 玩家可以提前前往尚未被主线介绍的地区；
- 地点可达不等于关键剧情可触发；
- 首次到达只更新探索和知识，关键任务还需Stage、角色和条件；
- 未知地点不能在地图上泄露完整名称和任务；
- 传闻可以把未知地点变为“听说”；
- 调查、观察和交谈可以揭示地点、快捷路线或事件；
- 地图拓扑在第一阶段不由运行时AI新增。

### 15.4 旅行

旅行是有持续状态的Action：

```text
idle
→ route-selected
→ travelling
→ event-interruption? / blocked? / arrived
→ idle
```

普通旅行不扣饥饿、口粮或体力，但会推进时间，并可按道路风险抽取旅途事件。玩家可以取消尚未开始的路线；旅行开始后的取消、折返和事件处理由路线契约决定。

### 15.5 快速旅行

- 玩家正常到达区域后解锁该区域的快速旅行点；
- 只能在允许快速旅行的状态下使用；
- 推进与路线相符的世界时间；
- 不逐一演出普通途中事件；
- 首版快速旅行开始后不会被途中事件中断；使用前若存在阻断，则直接拒绝并返回明确原因；
- 战斗、关键剧情和部分危险地点中禁用。

### 15.6 地图UI

第一阶段采用“SVG地形背景 + 可交互地点节点”的组合地图：

- 世界/地区缩放层级；
- 已知、听说、未知视觉状态；
- 当前地点、目标、任务标记、商店、制作点和快速旅行点；
- 道路、预计时间、风险和阻断；
- 点击地点查看摘要并设置旅行目标；
- 地图标记受知识和任务可见性约束；
- 移动端支持列表视图，不强迫在小屏拖拽复杂图。

---

## 16. 世界时间、昼夜与天气

### 16.1 时间模型

现有open-world `tick`可以作为迁移实现，但目标产品使用可解释的单调 `worldTimeMinutes`：

- Action声明时间成本；
- 旅行按道路时长推进；
- 战斗按遭遇结束时统一结算约定时间；
- 休息推进到指定时间段；
- Tick、NPC日程和地区模拟由世界分钟派生；
- 主线没有自动过期时间；
- 限时普通任务使用绝对deadline或相对duration。

内部仍保存可计算的分钟值，但玩家界面只显示“第几天 + 时间段”（例如清晨、白天、黄昏、夜晚），不在首版展示分钟级世界时刻。

### 16.2 昼夜

Release定义时间段，例如黎明、白天、黄昏、夜晚；规则可以影响：

- NPC日程和地点；
- 商店开放；
- 可见事件与敌人；
- 场景表现；
- 少量任务条件。

昼夜不能在第一阶段扩展成大量隐蔽数值修正，避免玩家无法理解失败原因。

### 16.3 天气

天气按地区气候配置和seed确定性迁移：

```text
WeatherProfile {
  allowedWeather[]
  transitionWeights
  minimumDuration
  maximumDuration
  presentationRefs
  gameplayModifiers[]
}
```

第一阶段天气主要影响文本、背景媒资、事件权重和少量公开条件。所有玩法影响必须在UI中可见。

### 16.4 时间推进调度

一次时间推进按固定顺序：

1. 更新世界时钟；
2. 结算状态持续时间；
3. 更新天气；
4. 推进NPC日程；
5. 处理普通任务deadline；
6. 推进地区问题和普通世界事件；重要故事线最多推进到安全等待点，不因玩家缺席进入永久失败；
7. 执行区域传播和远程行动；
8. 更新导演候选和通知；
9. 主线保持等待，除非玩家完成正式Stage Action。

---

## 17. NPC、势力、关系与犯罪

### 17.1 NPC Definition

```text
ActorDefinition {
  actorKey / title / actorTier
  characterDossierRef
  factionRefs[]
  homeRegionKey / defaultLocationKey
  scheduleRuleRef?
  serviceKeys[]
  dialogueProfileRef?
  combatProfileRef?
  mortalityPolicy
  protectionPolicy
  knowledgeProfileRef
  relationshipPolicyRef
  presentationRefs
}
```

`actorTier`分为：

| 层级 | 内容要求 | 运行方式 |
|---|---|---|
| mainline | 完整档案、知识、主线和保护 | 关键场景按需AI演绎 |
| significant | 完整档案、故事线、位置和关系 | 相关事件点按需AI演绎 |
| resident | 简要档案、阵营、功能和日程 | 确定性运行，对话触发时AI表现 |
| transient | 事件所需最小信息 | 随实例存在，必要时保留事实残留 |

### 17.2 日程

普通NPC采用简单、可解释的日程：

```text
ScheduleRule {
  recurrence
  segments[] {
    timeRange
    locationKey
    activity
    serviceAvailability
  }
  exceptions[]
}
```

玩家不在场时只推进位置和必要功能状态，不为每个NPC生成连续自然语言生活记录。

### 17.3 死亡与保护

`mortalityPolicy`至少包含：

- protected：主线关键角色，玩家不能造成死亡；
- story-only：只能在正式故事结果中死亡；
- mortal：可被战斗、剧情或随机事件杀死；
- despawn-on-resolution：临时事件角色在结束后离开。

普通NPC死亡后必须处理：

- 正在提供的普通任务；
- 商店或制作功能；
- 模板中的角色引用；
- 关系和目击事实；
- 地区氛围与后续传闻。

普通功能NPC死亡后，交易、制作等通用必要服务由预先配置的替代NPC或备用服务点接管；只属于该NPC的独特任务、对白和个人内容可以永久消失。第一阶段不要求AI临场编造替代者，替代关系必须在Build时完成引用校验。

当前vNext落实口径：Actor v3仍以一条角色定义承载小传和演绎准则，只额外结构化上述四级死亡策略及逐服务连续性规则；Action v7把玩家攻击与正式剧情/事件结算分成不同受治理入口。替代服务在原服务拥有者存活时保持休眠，原主死亡后才进入玩家和AI共用的服务投影。关键角色死亡、死者复活、`story-only`越权死亡、临时角色非解决性退场、缺失替代者和替代链都由Schema或确定性运行时代码拒绝，不能只依赖Prompt。

### 17.4 关系数值

```text
RelationshipProjection {
  factionAffinity: Record<factionKey, number>
  crimeReceipts[]
  attitudeCache?     // 可丢弃派生缓存
}
```

NPC态度由以下因素确定：

```text
attitudeScore =
  factionAffinity * factionWeight
  + moralityInterpretation
  + explicitStoryModifiers
```

首版不保存独立NPC亲密度。NPC态度只由玩家道德值、该NPC所属阵营亲合度和预制故事修正派生，最后只显示好、一般、差三档。阈值、权重和不同势力如何解释道德值由Release配置；态度缓存不是权威值。

当前vNext落实口径：Relationship v2为每个冻结阵营声明`-1/0/1`道德解释方向，并完整声明差/一般/好三档的标签、问候语气、普通互动策略及买卖价格倍率；无阵营角色另有统一解释方向。Session只保存道德值、完整阵营亲合度和已经发生的预制故事修正，态度、原因、问候与价格都由同一个确定性投影即时计算。未知阵营、缺失阵营状态、重复态度档、未预制故事修正和任何独立NPC亲密度字段均失败关闭；旧Relationship v1 Release只读时确定性规范化为同等v2合同。

### 17.5 态度影响

态度可以影响：

- 问候和对白语气；
- 普通任务、传闻和帮助是否提供；
- 商店价格或服务；
- 普通NPC是否拒绝非关键交互；
- 重要故事线的预制分支条件。

态度不能阻断第一阶段主线。关键NPC在态度差时仍必须以符合人物的方式提供必要推进。

Build会递归检查任务前置、Stage完成条件和Action条件：主线不得被道德、阵营亲合度、三档态度或故事修正锁死，每个主线必需Objective至少保留一条不依赖关系数值的正式Action。运行时对主线角色强制保留必要互动；普通NPC在态度差时可以拒绝非关键互动。当前价格倍率是G2-27交易结算的唯一输入投影，G2-20不提前实现第二套商店定价状态。

### 17.6 偷窃、欺骗和犯罪

犯罪是正式Action和Event，不由AI看一句话就直接判定：

- 检查目标、地点、当前可执行Action和必要条件；
- 代码决定成功、失败和是否有目击者；
- 生成morality和factionAffinity变化；
- 可以影响问候、价格、普通服务和局部任务；
- 不能使玩家自动加入敌对势力或永久摧毁主线；
- 首阶段不建设罚款、短时敌对、通缉、监狱和司法模拟。

当前实现把每个犯罪机会冻结为Relationship v3中的`crimeActions`记录，并与Action v8中的一项`steal`、`deceive`或`crime` Action一一对应。记录只结构化犯罪ID、固定目标与地点、成功条件、成败目击者、目击后果和公开失败文案；叙事包装仍留在表现层。犯罪Action必须由玩家执行、必须确认、首版按一次性机会消费，避免用重复Action刷物品或道德/阵营数值。

运行时代码从权威Session投影计算条件结果，并只把仍存活、在场且位于犯罪地点的预制目击者写入`crime`授权。授权冻结Action、目标、世界分钟、成败、条件结果、目击者和实际Effect闭集，随后与Command、Outcome、失败原因及Effect Receipt一起进入`ProductRuntimeEvent`；刷新和分支重放会重新计算并拒绝伪造。允许的首版后果仅限道德、阵营亲合度、预制物品、玩家知识和局部世界标记，关系变化再统一影响问候、价格、普通服务和局部任务条件；犯罪不能直接执行主线迁移、角色死亡、战斗、司法或敌对阵营加入。

### 17.7 关系UI

- 势力列表和亲合度；
- 重要NPC的三档态度和关系摘要；
- 道德值及主要近期变化；
- 玩家已经知道的态度原因，不泄露隐藏动机；
- 与当前任务、商店和地区相关的可见影响；
- 关系变化通知可合并，避免每个微小数值弹窗。

---

## 18. 对话、交互与自然语言

### 18.1 三种并存入口

同一个场景可以同时提供：

1. 系统Action：调查、购买、制作、休息、移动等；
2. 固定对话/任务选项：有明确ChoiceContract和后果；
3. 自然语言输入：用于表达、提问、角色扮演和映射已有动作。

不能把自然语言输入做成装饰，也不能让它绕过前两种入口的确定性边界。

### 18.2 DialogueContext

每次对话AI只能读取：

- 当前场景和在场角色；
- 说话角色的人格、语气和当前关系档位；
- 该角色实际知道的事实；
- 玩家已经知道的事实；
- 当前相关任务和故事线阶段；
- 最近有限轮对话与压缩记忆；
- 本轮允许推荐的Action/Choice；
- 禁止泄露和禁止承诺的内容。

不在场角色的秘密、未读取来源和未来剧情不能因为“模型可能知道”而进入上下文。

### 18.3 IntentCandidate

```text
IntentCandidate {
  kind: dialogue-only | mapped-action | mapped-choice | unsupported
  confidence
  actionKey?
  choiceKey?
  extractedArguments
  rationale
  requiresConfirmation
  boundaryExplanation?
}
```

执行策略：

- 纯对话：生成非权威回应，不修改状态；
- 可逆、低风险且唯一匹配的Action：可以执行并展示映射；
- 消耗资源、改变任务、交易、犯罪或其他高影响Action：必须确认；
- 多个可能匹配：展示候选让玩家选择；
- 无匹配：自然回应并推荐当前可用Action/Choice；
- 越界：明确不能这样做，避免假装已经发生。

### 18.4 对话结果

AI对话本身默认不改变关系。只有当玩家选择正式Choice或执行Action后，代码才提交关系、任务、知识或物品效果。可以把AI识别出的“值得记录的情感互动”作为候选，由正式规则或明确确认决定是否形成关系Event。

### 18.5 对话UI

- 角色名、头像、关系档位和当前状态；
- 场景叙述和固定选项；
- 自然语言输入框；
- AI正在理解、已映射动作、需要确认或无法执行的可见状态；
- 历史记录和系统回执可区分；
- 不把规则结算和角色台词混成一段无法核验的文本；
- 模型不可用时固定选项、系统Action和确定性游戏仍可继续。

### 18.6 场景运行

场景是叙事脚本和玩法系统的交汇点：

```text
SceneProjection {
  sceneKey
  locationKey
  mode: exploration | dialogue | combat | shop | crafting | system
  presentActorKeys[]
  visibleObjectKeys[]
  availableActionKeys[]
  availableChoiceKeys[]
  revealedBeatKeys[]
  presentationState
}
```

- 进入场景由地点、任务或事件触发；
- 可用Action和Choice由代码根据Projection计算；
- AI可以补充叙述和对白，不能添加未注册的可交互物体；
- 离开场景前提交所有确定性结果；
- 战斗、商店和制作是场景模式，不创建互相隔离的第二套玩家状态；
- 场景结束后正文可以压缩，关键Choice、知识和结果写入长期事件。

---

## 19. 地区模拟、任务导演与随机事件

### 19.1 世界不会因为玩家不看而停止，但也不会全量模拟

采用分层注意力：

| 层级 | 运行 |
|---|---|
| focus | 当前地区和当前任务，完整规则与表现 |
| active | 邻近地区、重要故事线和近期影响，按时间批次更新 |
| background | 远方地区，只推进少量压力、阶段和预定事件 |
| dormant | 无相关条件时不计算，下一次激活时根据时间差批量结算 |

所有批量结算仍产生有界、可回放的摘要Event，不让后台Agent无限运行。

### 19.2 地区状态

```text
RegionProjection {
  regionKey
  attentionLevel
  issuePressures
  factionInfluence
  resourceMetrics
  activeStoryStages
  activeQuestCount
  weatherKey
  nextScheduledAt
  lastUpdatedSequence
}
```

### 19.3 发牌管线

```text
触发：到达 / 探索 / 交谈 / 休息 / 时间批次 / 任务完成
→ 收集当前地区Deck
→ 过滤前置、时间、角色、任务和指纹
→ 计算类别配额、成长缺口、地区压力、强度和新鲜度
→ 与Blank候选比较
→ 固定任务 / 模板实例 / 随机事件 / 空白
→ 写DrawReceipt
→ 必要时创建QuestInstance
→ AI根据已选内容生成表现
```

### 19.4 模板任务

模板必须同时包含稳定结构和可变槽位：

```text
QuestTemplate {
  templateKey / family / category
  requiredRoles[] / locationTags[] / itemTags[]
  allowedRegions[] / levelBand
  structuralStages[] / allowedSolutions[]
  rewardBudget / timePolicy
  variationSlots
  forbiddenCombinations
  fingerprintShape
}
```

代码选择合法角色、地点和奖励；AI把已选槽位包装成地区化小故事。AI不能替换结构后再私自改变任务效果。

### 19.5 防重复

重复判断至少考虑：

- template family；
- 发起者类型；
- 目标和地点；
- 冲突；
- 解决方式；
- 奖励类型；
- 最近任务文本语义相似度。

结构指纹由代码硬过滤；文本相似度属于软评测。冷却、类别配额、强度连击限制和Blank牌共同控制节奏。

### 19.6 随机事件

随机事件分为：

- 氛围事件：只显示，最多保存已见标签；
- 资源事件：产生小额确定性得失；
- 遭遇事件：可能进入战斗或简短选择；
- 线索事件：揭示地点、传闻或任务入口；
- 升级事件：产生多阶段目标并转为任务实例。

任何有长期后果的事件必须留下最小事实回执。

---

## 20. 知识、传闻、百科与历程

### 20.1 三种知识

- World Truth：Release和Session中的真实事实；
- Player Knowledge：玩家目前知道的事实；
- Actor Knowledge：每个重要角色目前知道的事实。

三者不能合并。UI隐藏不等于数据隔离，AI上下文也必须按知识范围选择。

### 20.2 KnowledgeEntry

```text
KnowledgeEntry {
  knowledgeKey
  subjectRef
  summary
  truthStatus
  visibility
  sourceEvidenceRefs
  revealConditions
  contradictionRefs
  expiresAt?
}
```

传闻可以是错误、不完整或过期的Player Knowledge；系统必须知道它与World Truth的关系，不能让错误传闻直接覆盖事实。

### 20.3 百科UI

- 地区、地点、人物、势力、物品、敌人和知识分类；
- 只显示玩家已知内容；
- 新条目和更新标记；
- 来源于哪次任务、对话或探索；
- 传闻、不确定和确认事实有不同标识；
- 相关任务和地图跳转；
- 不展示内部SourceLedger或未来剧情证据。

### 20.4 玩家历程与成就标签

对于无需长期保存全文的小任务和遭遇，保留：

- 完成/失败/过期标签；
- 重要奖励和关系变化；
- 地区和时间；
- 可选的一句摘要；
- 成就或收藏标签。

这让系统能记住“玩家做过什么”，又不把所有演绎正文永久塞入上下文。

---

## 21. 通知、反馈与可解释性

### 21.1 FeedbackReceipt

所有玩家命令必须产生可解释结果：

```text
FeedbackReceipt {
  commandId
  outcome: success | failure | unavailable | confirmation-required
  systemSummary
  changes[]
  unavailableReasons[]
  relatedQuestRefs[]
  relatedItemRefs[]
  presentationCandidateRef?
}
```

### 21.2 通知类别

- 任务开放、更新、完成、失败、过期；
- 获得/失去物品、货币和经验；
- 升级、技能和配方解锁；
- 地图和快速旅行点发现；
- 关系、道德和阵营变化；
- 时间、天气和地区重大变化；
- 存档、恢复、版本和模型故障。

多个同类小变化可以聚合。重要结果必须可以在历史面板复查，不能只靠几秒钟Toast。

### 21.3 规则解释

玩家应该能够查看：

- 为什么某Action不可用；
- 装备后属性如何变化；
- 战斗伤害来自哪些值；
- 为什么任务过期或失败；
- 为什么NPC态度发生变化；
- 快速旅行为何被阻止；
- AI把自然语言映射成了什么动作。

内部Prompt、隐藏剧情和角色秘密不属于玩家解释范围。

---

## 22. 存档、读档、分支和版本

### 22.1 保存模型

```text
ProductRelease（不可变）
+ Session InitialState
+ append-only ProductRuntimeEvents
+ derived RuntimeHead
+ SimulationCheckpoints
```

Checkpoint包含：

- throughSequence；
- projection snapshot；
- projection hash；
- release hash；
- ruleset version；
- 创建原因：manual / autosave / pre-combat / milestone / system；
- 玩家可见名称和时间。

### 22.2 自动与手动保存

第一阶段建议：

- 关键任务阶段完成后自动保存；
- 战斗开始前建立自动检查点；
- 区域旅行完成后自动保存；
- 玩家可以创建有限数量的命名检查点，首版默认上限20个；
- 自动保存和手动保存都不覆盖原事件流，只创建可恢复指针/快照；
- 从旧检查点继续时创建子Session分支。

### 22.3 读档与分支UI

- 显示游戏版本、地区、主线阶段、等级和游戏时间；
- 以列表区分当前分支、父分支和自动检查点，首版不绘制完整分支树；
- 读档前提示未保存进度；
- 支持删除单个分支，不级联删除共享Release；
- Checkpoint校验失败时提供重放和明确错误；
- 不用“删除水位之后的数据”伪装回滚。

### 22.4 ProductRelease更新

发布修复时生成新Release，并形成兼容报告：

| 改动 | 默认兼容性 |
|---|---|
| 文本、图片、音频替换且稳定ID不变 | compatible |
| 新增未触发普通任务、物品或地点 | usually-compatible，仍需验证 |
| 数值参数改变 | migration-required或仅新档生效 |
| 删除/重命名已引用ID | breaking，除非提供映射 |
| 主线Stage、任务状态机改变 | 高风险，必须专项迁移 |
| Condition/Effect语义或规则算法改变 | breaking或冻结旧规则实现 |

用户可以继续旧Release。迁移必须显式、可预演、可回滚到原分支，不能静默升级存档。

### 22.5 Session生命周期

```text
created → active → paused → active
                   ├→ completed
                   ├→ archived
                   └→ corrupted-needs-recovery
```

- 创建时绑定一个且仅一个Build预览或ProductRelease；
- 暂停不推进世界时间；
- 到达结局后标记completed，但允许查看日志、百科和存档；
- completed存档是否允许继续自由探索由EndingContract声明；
- corrupted状态不得自动覆盖原数据，先重放、导出诊断或从检查点创建恢复分支；
- 删除Session时只删除该实例及私域事件，不删除ProductRelease和其他分支。

---

## 23. 玩家端信息架构

### 23.1 桌面布局

```text
┌──────────────┬──────────────────────────────┬───────────────┐
│ 左侧导航     │ 中央主场景                   │ 右侧上下文    │
│ 当前任务     │ 场景叙述/对话/战斗           │ 人物/地点     │
│ 地图入口     │ 固定选项与系统Action          │ 状态/奖励     │
│ 角色入口     │ 自然语言输入                  │ 近期变化      │
├──────────────┴──────────────────────────────┴───────────────┤
│ 底部：生命/资源、地点、时间天气、模型/保存状态              │
└──────────────────────────────────────────────────────────────┘
```

中央区域根据状态切换为场景、对话、战斗、制作或交易，但全局状态和退出/保存入口保持稳定。

### 23.2 一级页面

| 页面 | 主要内容 | 关键动作 |
|---|---|---|
| 游戏场景 | 叙述、对话、选项、Action、输入 | 行动、交流、继续 |
| 地图 | 世界/地区/地点、路线、标记 | 查看、旅行、快速旅行 |
| 任务 | 主线、重要故事、支线、历史 | 追踪、定位、放弃普通任务 |
| 角色 | 等级、经验、属性、技能、状态 | 查看成长与技能来源 |
| 背包装备 | 物品、材料、装备位、属性比较 | 使用、装备、出售、丢弃 |
| 制作 | 配方、材料和产物 | 制作 |
| 关系 | 势力、重要NPC、道德 | 查看影响 |
| 百科 | 已知地点、人物、势力、敌人和知识 | 阅读、跳转 |
| 历程 | 事件摘要、成就、通知历史 | 回顾 |
| 存档 | 检查点、分支、版本 | 保存、继续、迁移 |
| 设置 | 文字、声音、模型、可访问性 | 调整与诊断 |

### 23.3 移动端

- 底部导航优先：场景、地图、任务、角色、更多；
- 背包、技能、关系和百科进入“更多”；
- 右侧上下文改为底部抽屉；
- 战斗主按钮固定在拇指可达区域；
- 地图必须提供地点列表替代视图；
- 自然语言输入不遮挡固定选项和规则反馈；
- 所有关键操作支持键盘和屏幕阅读器。

### 23.4 UI状态边界

可以只存在前端UI状态：

- 当前打开面板；
- 筛选和排序；
- 展开的详情；
- 未提交输入；
- 动画和临时高亮。

必须来自Projection：

- 等级、生命、背包、装备；
- 任务、地点、时间、天气；
- 关系、战斗和世界变化；
- 存档和Release绑定。

### 23.5 开场、教程与渐进披露

首轮游玩不一次展示全部系统：

```text
选择Release/存档
→ 主角确认（首版固定标准难度）
→ 开场场景
→ 系统Action和固定选项
→ 首次自由输入提示
→ 首次任务日志
→ 首次地图旅行
→ 首次战斗
→ 首次背包/装备
→ 首次制作/商店
```

首版只使用随真实玩法逐步出现的结构化 `TutorialStep`，不建立独立教学场景。教程记录完成状态但不影响主线；每一步绑定实际UI元素、触发条件、完成条件、跳过和帮助入口，不能只让AI临时解释。

### 23.6 通用页面状态

每个一级页面都必须具有：

- loading、empty、ready、recoverable-error和blocking-error；
- 刷新后恢复选中Session和安全UI焦点；
- 未找到引用时显示诊断而不是白屏；
- 危险操作确认与重复点击幂等；
- 无模型、断网和余额不足时的降级提示；
- 可回到当前场景的稳定入口。

---

## 24. 创作者生产工作台

### 24.1 生产阶段

```text
选择来源
→ 游戏会谈与Brief
→ 生产计划与预算
→ 叙事生产
→ 玩法规则与系统配置
→ 地图/角色/任务/物品/敌人/商店/配方生产
→ 媒资需求与生成
→ 集成验证
→ 灰盒试玩
→ 修复
→ 正式发布
```

### 24.2 工作台页面

| 页面 | 内容 |
|---|---|
| 来源 | WorldRelease/小说、能力画像、来源选择、未读和缺口 |
| Brief | 主角、体验、规模、边界、媒资和成本；首版标准难度只读显示 |
| 计划 | DAG、依赖、并行组、预算、模型和完成条件 |
| 叙事 | StoryArc、主线、重要故事线、地区、任务和场景 |
| 玩法 | 属性、成长、战斗、物品、制作、经济、关系和时间 |
| 内容表 | 角色、地点、任务、物品、敌人、商店、配方及引用 |
| 媒资 | 需求、候选、版权、绑定、降级和覆盖率 |
| 质量 | 硬闸门、语义评测、问题、修复和豁免 |
| 试玩 | 隔离Build实例、标准路径、回执和问题记录 |
| 发布 | 版本、兼容、包Hash、终态receipt和发布说明 |

### 24.3 表格编辑原则

AI创建任务、物品、敌人或配方时，本质上生成结构化候选行或聚合对象。工作台必须允许：

- 查看结构字段和对应的创作说明；
- 按稳定ID定位引用；
- 查看来源和生产Run；
- 局部编辑或要求AI修复；
- 显示哪些修改会使下游stale；
- 批量验证但不批量静默采纳；
- 不把人物小传强拆成大量低价值表；
- 不让自然语言正文成为任务状态机或数值规则的唯一来源。

### 24.4 一次授权与过程可见

用户确认Brief和预算后，生产可以按授权策略自动推进，不要求每个内部步骤反复确认。以下情况必须暂停：

- 来源或关键上游stale；
- 预算或模型能力不足；
- 连续重复验证失败；
- 需要改变用户确认的主角、核心目标、内容边界或媒资权利；
- 发布兼容性为breaking；
- 外部调用结果未知或可能重复计费。

---

## 25. 媒资、表现与可访问性

### 25.1 PresentationModule

表现层定义：

- 文字排版、对话样式和系统回执样式；
- 地区、地点、角色、物品、敌人和技能的媒资槽；
- 场景背景、角色头像/立绘、地图图标；
- 音乐、环境音、音效和可选配音；
- 昼夜、天气、战斗和任务状态的表现规则；
- 所有媒资的文字降级。

### 25.2 MediaSlot

```text
MediaSlot {
  slotKey
  kind
  consumerRef
  required
  assetRef?
  fallbackText / fallbackStyle
  altText
  rights/provenance
}
```

媒资缺失不能阻止核心文字玩法，除非用户在Brief中明确把该媒资设为发布必需。

首版正式Release的最低媒资要求是：程序生成的SVG地图、角色头像和场景背景。音乐、环境音和音效保留槽位但不作为首版发布硬门；缺失时必须保持静音可玩和完整文字降级。

### 25.3 文本表现

- AI叙述与系统规则回执视觉区分；
- 角色对白标注说话者；
- 重要数值变化可见；
- 长文本支持折叠、历史和继续阅读；
- 不让AI重复复述完整背包、任务和属性；
- 场景正文可以流式显示，但规则结果必须先有确定状态或明确等待标记。

### 25.4 可访问性

- 字号、行距、字体和高对比度；
- 减少动画；
- 键盘完整操作和焦点管理；
- 屏幕阅读器标签与状态播报；
- 地图列表替代；
- 音频字幕和静音可玩；
- 颜色不作为任务、态度或稀有度的唯一提示；
- AI生成内容遵守用户内容边界和警告。

### 25.5 多语言、本地化与文本版本

- 系统UI继续使用项目统一i18n设施；
- 游戏内容语言在Brief和Release中冻结；
- 一个首版ProductRelease只携带一种游戏内容语言；Schema和稳定ID预留 `locale`，但不要求同一Release同时生产多语言Artifact；
- 稳定ID不使用显示文本；
- 翻译作为新的Artifact版本，保留来源文本和验证证据；
- 语言切换不能改变规则、任务状态和Event重放；
- AI生成的系统术语必须使用Release术语表；
- 字符串长度、复数、日期时间和数字格式在UI中本地化。

### 25.6 内容安全、隐私与诊断

- Brief保存内容边界、警告和禁止内容；
- Runtime Context只发送本轮需要的数据，不上传完整存档；
- 模型请求不包含API密钥、内部数据库ID或无关私密来源；
- 错误日志保存错误分类、Hash和有限摘要，不保存完整秘密Prompt；
- 真人体验数据和遥测默认本地保存，任何外发都需要明确同意；
- 玩家可以导出问题回执而不导出未授权世界原文；
- 删除Session、Build或产品时遵守`PROJECT_TABLES`生命周期。

---

## 26. AI 在完整游戏中的职责

### 26.1 生产期

AI适合：

- 理解来源和用户设定；
- 设计故事、地区、任务、场景和角色内容；
- 提出属性、敌人、物品、配方和奖励候选；
- 生成描述、对白和媒资需求；
- 评审叙事质量、重复和体验问题；
- 根据明确失败回执进行局部修复。

代码必须：

- 验证Schema、引用、规则和数值边界；
- 检查内容预算、成长曲线和主线可达；
- 组装Release并验证所有消费槽；
- 控制预算、幂等、stale、权限和恢复；
- 保存来源、候选、采纳和终态证据。

### 26.2 运行期

AI只在需要语义的时刻调用：

- 自然语言意图映射；
- 重要NPC对话；
- 场景、战斗结果和任务事件的表现；
- 地区化模板任务的文字包装；
- 有限的叙事导演建议；
- 语义一致性检查。

以下不需要模型调用：

- 打开背包和任务日志；
- 查看地图和属性；
- 装备、购买、出售和固定配方制作；
- 任务条件、奖励、等级和关系数值计算；
- 战斗回合和随机数；
- 时间、天气、日程和发牌过滤；
- 保存、读取、重放和迁移。

### 26.3 模型失败降级

| 场景 | 降级 |
|---|---|
| 自然语言意图失败 | 显示固定Action/Choice并请玩家选择 |
| NPC对白失败 | 使用角色态度和场景绑定的安全模板 |
| 场景叙述失败 | 使用Event Receipt生成系统叙述 |
| 模板任务包装失败 | 不发出该实例或使用预制变体 |
| 语义评审失败 | Artifact保持候选，不采纳 |
| 生产预算耗尽 | 保存Checkpoint并请求调整，不伪装完成 |

### 26.4 成本和可观察性

生产工作台显示：

- 首版由创作者配置自己的模型API Key；密钥只进入安全凭证设施，不进入Prompt、Artifact、日志或导出包；
- 当前Run和Skill；
- 生产前显示预计token和费用预算，运行后显示模型、实际token、耗时和实际/估算费用；
- 已重试次数和原因；
- 实际读取来源；
- 当前预算和剩余额度；
- 失败、降级和stale状态。

玩家端只显示与体验有关的“正在生成、已降级、可以重试”，不暴露内部Prompt和秘密上下文。

---

## 27. Build、验证与发布装配

### 27.1 Build Manifest

Build必须记录：

- 来源WorldRelease/SourcePin和Hash；
- Brief版本和用户授权；
- 生产DAG、Skill/模型绑定和预算；
- 所有被采纳Artifact及Hash；
- RuntimePackage和packageHash；
- 媒资Manifest和权利证据；
- 硬闸门和语义评测receipt；
- 灰盒试玩与标准路径结果；
- 对上一Release的兼容报告；
- root terminal receipt。

### 27.2 模块装配检查

| 消费方 | 必须能解析 |
|---|---|
| 角色页 | 玩家、属性、成长、技能、状态、装备 |
| 战斗 | 玩家/敌人、技能、公式、掉落和失败策略 |
| 背包 | 物品定义、实例规则、使用Action和保护策略 |
| 制作 | 配方、材料、产物、条件和时间成本 |
| 商店 | Vendor、库存、货币、价格和关系修正 |
| 任务日志 | Quest、Stage、Objective、时间和奖励 |
| 地图 | Region、Location、Edge、知识和旅行点 |
| 对话 | 角色档案、知识边界、关系和Choice |
| 世界模拟 | 地区状态、日程、时间、天气和Deck |
| 存档 | InitialState、Event版本、Projection和迁移 |

### 27.3 发布条件

- 所有硬闸门通过；
- 语义质量达到当前质量档或具有用户明确软豁免；
- 不存在未解析必需媒资槽；
- 至少一个结局路径可完成；
- 隔离灰盒存档能刷新、恢复和重放；
- 发布包不包含数据库本地ID、密钥或模型完整上下文；
- Release Hash可复算；
- 发布命令幂等；
- 发布后不再原地修改。

### 27.4 数值与内容平衡报告

Build还必须生成可审查的 `BalanceReport`：

- 等级经验曲线和预计升级时间；
- 主线各阶段推荐等级；
- 敌人强度、预计战斗回合和失败率区间；
- 装备升级路径和无效/压倒性装备；
- 货币来源、主要消耗点和余额曲线；
- 材料来源与配方可制作性；
- 任务奖励预算与重复领取风险；
- 重要技能、道具和快速旅行解锁时点；
- 可选内容对成长的上限影响，避免做支线后完全碾压主线。

静态报告只能发现明显异常；最终参数必须通过自动模拟和真人游玩校准。

---

## 28. 系统依赖关系

```text
Source/Brief
    ↓
Narrative ──────────────┐
    ↓                   │
World/Map ──────┐       │
Actors/Relations│       │
    ↓           ↓       ↓
Actions ← Quest ← Knowledge
   ├────────┬───────────┬──────────┐
   ↓        ↓           ↓          ↓
Progress  Inventory   Time       Director
   ↓        ├──────┐    │          │
Combat   Equipment Craft/Economy  Events
   └────────┴──────┴────┴──────────┘
                  ↓
             Event Runtime
                  ↓
            AI Presentation
                  ↓
                  UI
```

### 28.1 不允许的反向依赖

- Narrative不能直接写Session；
- UI不能拥有游戏状态；
- AI表现不能修改规则结果；
- Inventory不能自行推进Quest，必须通过Effect/Event契约；
- Quest不能在内部私改Player或Relationship；
- Map不能因绘图需要凭空增加故事地点；
- Runtime不能向WorldRelease回写；
- 子系统不能维护自己的第二份时间、道德、货币或任务状态。

---

## 29. 现有 StoryForge 能力审计

> 审计快照：2026-09-05。世界引擎仍在清理旧内容，因此这里只决定复用方向，不把当前代码形态冻结为最终方案。

### 29.1 可以复用的基础

| 当前能力 | 复用方式 |
|---|---|
| `TextOpenWorldProductRuntimePackageV1`、ProductBuild、ProductRelease | 延续不可变包和生产证据模式，扩展文字开放世界产品载荷 |
| `gameProductions`、Brief、Command、Build、Artifact、Quality Receipt | 作为完整生产生命周期，不另建平行体系 |
| `AgentRunContract`、scheduler、checkpoint、stale、receipt | 作为所有生产和运行AI的durable Harness |
| `ProductRuntimeSession/Event/Checkpoint` | 作为事件权威、重放、分支和恢复基础 |
| `AdventureContentV1` 的Action、Requirement、Effect、Item和Quest基础 | 作为统一Action/Effect迁移起点，不直接当最终玩法系统 |
| `OpenWorldContentV1` 的Region、Edge、Deck、Card、Schedule和Issue | 作为地区导演与世界演化基础 |
| `NarrativeSimulationContentV1` 的资源、指标、问题、延迟效果 | 借鉴有界地区状态，不让它成为第二份玩家状态 |
| TTRPG的RulePack、物品账本、战斗事件和效果账本 | 复用协议与实现经验，不把D&D式规则直接复制到本产品 |
| 三注册表和Context Gateway | 继续治理AI读取、采纳和数据生命周期 |
| 共享媒资Blob和ProductBuildArtifact | 复用存储、Hash、权利和绑定设施 |

### 29.2 当前文字开放世界已有但不完整

当前玩家页已有：

- Release与Session选择；
- 地区卡片；
- 地区观察/社交/探索/休息触发；
- 旅行；
- 固定/模板任务揭示、接受和简单解决；
- Tick推进；
- AI只读任务/场景表现；
- Checkpoint和分支。

当前缺少完整接入：

- 玩家等级、经验、生命和角色页；
- 已学技能和逐回合普通攻击/技能/道具/逃跑操作；
- 确定性开放世界战斗；
- 正式背包、装备比较和物品使用UI；
- 奖励/掉落账本；
- 制作、商店和经济；
- 主线/重要故事线/普通任务的完整日志；
- 地点级地图和快速旅行；
- 昼夜、天气和世界分钟；
- NPC日程可视化、死亡和功能替代；
- 道德、阵营亲合度和三档态度；
- 玩家知识、百科和传闻；
- 混合Action、固定选项和自由输入；
- Release更新和存档迁移体验。

### 29.3 必须重做

| 当前实现 | 原因 | 处理 |
|---|---|---|
| 通用叙事节点机械编译地区、任务和模板 | 没有真正的故事→任务→玩法生产 | 由叙事P0-P10生产链替代 |
| `NarrativeArtifactV1`只有nodes/beats/choices | 无法承载完整主线、故事线、任务和系统契约 | 拆成专属Artifact payload |
| 旧文字游戏Agent契约 | 不支持文字开放世界的生产体量与系统 | 新产品Skill/Run Contract |
| Workbench直接编辑多个JSON模块 | 只是维护工具，不是完整生产工作台 | 替换为来源、Brief、计划、内容、规则、QA和发布流程 |
| 当前Player单页堆叠区域、任务和投影 | 不能容纳完整游戏系统 | 按第23节重构信息架构 |
| 发布文字开放世界时创建WorldRelease | 违反单向引用 | 只锁定已有WorldRelease并发布ProductRelease |
| 仅按地区/任务数量通过质量门 | 数量不证明玩法和内容完整 | 使用模块消费、状态机、回放和真人路径质量门 |

### 29.4 不直接复用TTRPG产品规则

TTRPG已经包含复杂RulePack、骰制、GM、角色卡、行动经济、物品账本和战斗，但文字开放世界当前需要：

- MMO式简化三属性和玩家逐回合选择的确定性战斗；
- 单主角；
- 游戏代码而非GM裁决；
- 固定任务和地区导演；
- 不复制D&D式技能检定和大量桌面规则；
- 独立的装备、制作、商店和玩家UI。

可以抽取共享的随机证据、Effect计划、物品事务、战斗回执和重放工具，但产品Schema和UI必须独立。

---

## 30. 顶层施工路线

本路线是跨叙事、玩法和UI的顶层顺序；叙事子系统文档中的Phase作为对应工作流内部顺序执行。

### G0：产品决定与契约冻结

- 落实第34节已经冻结的36项首版产品决策；
- 确认第一阶段Ruleset默认值；
- 确认来源输入、地图表现、存档和媒资范围；
- 冻结模块owner、Release边界和Session投影；
- 为旧入口制定替换和迁移策略。

完成：没有跨系统双重事实源，所有未决默认值显式。

### G1：统一Action/Event内核和RuntimePackage

- 扩展Condition/Effect；
- 定义Command、EffectPlan、Event和Receipt；
- 定义文字开放世界vNext运行包和InitialState；
- 打通Build、Release、Session、Replay和Checkpoint；
- 登记三注册表和数据生命周期。

完成：一个人工最小包可被发布、启动、操作、刷新和重放。

### G2：确定性玩法纵切面

按依赖实现：

```text
Player/Progression
→ Item/Inventory/Equipment/Reward
→ Quest
→ Map/Time
→ Relationship/NPC
→ Combat
→ Crafting/Economy
→ Director/World Evolution
```

完成：不调用AI也能用人工Fixture从开场玩到一个结局。

### G3：叙事内容生产编译器

- SourceLedger、Brief和ExperienceContract；
- StoryArc、RegionSkeleton、主线和重要故事线；
- 地区最终化、任务、场景和Choice；
- 玩法内容：敌人、物品、奖励、配方、商店和规则配置候选；
- 语义评审、修复和Build集成。

完成：AI生产结果能进入G2运行时，不依赖人工改JSON才能游玩。

### G4：完整玩家端

- 场景壳、地图、任务、角色、技能；
- 背包、装备、制作、商店；
- 战斗、关系、百科、历程；
- 存档、设置和移动端；
- 确定性反馈与无模型降级。

完成：真实玩家不进入开发工具即可完成全部系统循环。

### G5：创作者工作台与发布更新

- 来源、会谈、Brief、计划和预算；
- 内容/系统表、审查、局部修复；
- 媒资、灰盒试玩、质量门；
- 发布、新版本、兼容和存档迁移。

完成：创作者可以从来源生产、发布、发现问题、修复并更新。

### G6：运行时AI与有边界自由

- 自然语言意图映射；
- NPC对话和场景演绎；
- 地区化模板任务包装；
- 叙事导演建议；
- 知识边界、降级、成本和性能门。

完成：自由输入自然可用，但不能越权改变规则或正式状态。

### G7：规模、质量与真人校准

- 完整小型验收世界；
- 自动游玩、固定种子长时运行和性能测试；
- 内容时长、战斗平衡、奖励、任务重复和模型成本校准；
- 隔离E2E、导入导出、迁移和真人游玩；
- 清理旧入口并更新能力基线。

完成：至少一款正式Release由真人完整游玩，并能通过新Release修复问题。

---

## 31. 首个完整验收世界

叙事规模沿用叙事子系统的验收默认值。本节补充玩法系统默认值，全部属于校准起点。

| 系统 | 验收内容 |
|---|---|
| 主角 | 1名，可从来源选择或自建 |
| 等级 | 从1级成长到5级；系统上限20级 |
| 属性 | 力量、体质、敏捷3项核心语义属性和6项以内派生属性 |
| 技能 | 4—6个，其中至少1个资源技能、1个状态技能 |
| 装备 | weapon/armor/accessory三类，至少8件候选 |
| 物品 | 至少5种材料、4种消耗品、2件关键道具 |
| 配方 | 4—6个，覆盖药剂和装备/工具 |
| 商店 | 2个不同地区商店，至少1种关系价格差异 |
| 敌人 | 3个敌人家族、至少1个主线强敌 |
| 战斗 | 普通、危险、Boss/关键三种强度；每回合选择普通攻击、技能、道具或逃跑；只有标准难度 |
| 任务 | 叙事子系统规定的主线、重要故事线、普通和模板任务 |
| 地图 | 2地区、8—12地点、道路和2个快速旅行点 |
| 时间 | 昼夜、至少3种天气、普通任务期限 |
| NPC | 关键NPC、重要故事NPC、普通功能NPC和可死亡普通NPC；没有友方NPC战斗协助 |
| 关系 | 道德、2个以上势力亲合度、重要NPC三档态度 |
| 知识 | 地点、人物、势力、任务线索和至少1条不确定传闻 |
| 存档 | 手动、自动、战前、分支和重放 |
| 结局 | 2个由不同条件进入的合规结局 |

### 31.1 必过完整路径

1. 从来源创建或选择主角，进入第一地区；
2. 接取主线，完成一次调查和一次NPC对话；
3. 获得材料和装备，查看背包并换装；
4. 在普通战斗中分别使用普通攻击、技能、道具和逃跑，完成另一场战斗并获得经验、货币和掉落；
5. 制作药剂并在后续战斗中主动选择使用；
6. 在商店买卖并看到关系价格差异；
7. 完成普通任务、放弃并重接另一普通任务；
8. 搁置主线，推进时间，使一个限时任务过期；
9. 提前前往第二地区而不误触关键主线；
10. 解锁快速旅行并返回；
11. 犯罪或欺骗造成道德/关系变化，但主线仍可继续；
12. 战斗失败，从战前检查点或复活点恢复；
13. 使用系统Action、固定选项和自然语言三种交互；
14. 推进一条角色重要故事线和一条势力/地区故事线；
15. 从同一Release走到两个不同结局；
16. 刷新、重放和分支后状态一致；
17. 发布修复版并验证兼容或明确要求新档。

---

## 32. 测试与质量矩阵

### 32.1 每个系统的最低测试

| 系统 | 正例 | 关键反例 |
|---|---|---|
| Player | 获得经验并升级 | 重复claim、越过等级上限 |
| Stats | 装备后正确重算 | 卸装导致生命越界、NaN |
| Skill | 资源足够时发动 | 冷却、资源不足、非法目标 |
| Inventory | 获得、使用、转移 | 负数量、重复领取、关键道具丢弃 |
| Equipment | 装备和替换 | 非本人物品、错误装备位、条件不足 |
| Reward | 原子结算多类奖励 | 部分到账、重复到账 |
| Craft | 扣材料并产出 | 关键物品误耗、刷新重复、数量溢出 |
| Economy | 买卖原子完成 | 扣钱无物品、卖关键道具、库存负数 |
| Quest | 接取、推进、完成 | 主线放弃、错误过期、跨任务串状态 |
| Map | 旅行和提前到达 | 不连通、误触主线、快速旅行未解锁 |
| Time | Action推进并触发批次 | 时间倒退、主线自动过期、重复调度 |
| NPC | 日程和态度派生 | 已死亡仍服务、秘密越权、关键NPC死亡 |
| Combat | 同seed同结果 | 死亡继续行动、双领奖、逃跑又胜利 |
| Director | 合法发牌和Blank | 任务洪水、指纹重复、跨地区错误NPC |
| Knowledge | 合法揭示 | 玩家/角色读到秘密、传闻覆盖真相 |
| Save | 重放和分支一致 | checkpoint hash错误、旧版规则漂移 |
| AI Intent | 映射已有Action | 越权新Action、高风险无确认 |
| AI Prose | 与Receipt一致 | 额外物品、额外伤害、剧透和假推进 |

### 32.2 系统不变量

- 任意序列后资源、数量、生命和时间不出现NaN/Infinity；
- 物品所有权唯一；
- 货币、材料和生命不低于规则下限；
- 任务终态不能非法回到active；
- 主线不能因普通内容状态成为永久不可达；
- 关键NPC/道具保护永远通过统一规则生效；
- 同一commandId不产生第二次效果；
- 同一Release、seed和事件序列重放Hash一致；
- UI刷新不改变游戏状态；
- 模型失败不破坏确定性玩法；
- 一个Session不能读取或修改另一个Session；
- 运行不能修改WorldRelease或ProductRelease。

### 32.3 性能门

首阶段至少测量：

- Release解析和Session启动；
- 1,000次时间批次/发牌的有界性；
- 大量任务历史后的可用Action计算；
- 大背包和任务日志的渲染；
- Event重放和Checkpoint恢复；
- 地图布局和移动端列表；
- AI上下文大小、调用延迟和降级时间；
- IndexedDB导入、导出和迁移。

阈值应由目标设备实测后登记，不能在本文凭空声明。

### 32.4 真人验收

真人直接游玩正式候选Build或正式Release，重点记录：

- 是否知道当前能做什么；
- 主线、支线和探索是否形成节奏；
- 成长和装备是否有可感知收益；
- 战斗是否过长、过弱或不可理解；
- 任务是否重复；
- 地图和任务日志是否容易使用；
- 自由输入是否自然且诚实；
- 世界演化是否可见但不打扰；
- 内容时长是否达到Brief；
- 模型成本和等待是否可接受。

---

## 33. 物理数据策略

### 33.1 第一阶段优先复用

- `gameProductions`：产品生产根；
- `gameProductionBriefs`：Brief和产品专属配置；
- `gameProductionCommands`：幂等生产控制；
- `gameBuilds`：计划、预算、集成和兼容；
- `gameBuildArtifacts`：叙事、玩法、媒资和评测Artifact；
- `gameQualityGateReceipts`：验证证据；
- `gameReleases`：不可变正式发布；
- `simulationSessions`：游戏实例和分支；
- `simulationEvents`：权威运行事件；
- `simulationCheckpoints`：可重建检查点；
- `agentRuns`及其事件/检查点：AI Harness；
- 共享媒资表和Blob：产品媒资存储。

### 33.2 暂不按系统各建一张表

Release中的属性、技能、物品、敌人、商店、配方、任务和地图，第一阶段可以作为各自有Schema的Artifact payload和不可变RuntimePackage模块存在。只有出现独立编辑、查询、owner、版本、外键或性能需求时再规范化。

Session中的高频状态优先作为Event和可重建Projection存在，不建立“玩家属性表、背包表、装备表、任务状态表、关系表”多套相互事务难以一致的权威写入点。

### 33.3 什么时候拆表

新增物理表必须给出证据：

- 对象需要独立编辑和局部版本；
- 聚合Artifact无法满足查询和差异更新；
- 数据量使解析或重放超过性能门；
- 需要独立权限、owner、导入导出或删除；
- 需要稳定索引支持UI和检索；
- 迁移方案、正反例和三注册表登记已经完成。

---

## 34. 首版产品决策（36项已冻结）

决策日期：2026-09-06。问卷导出中的“9/36”只表示用户主动修改或点击确认了9项；用户在提交后明确表示“填完了”，因此本节把36项当前选择全部视为已确认。它们是首版施工约束，不再是验收世界的临时默认值；后续改变时必须新增决策记录、兼容分析和受影响模块清单。

### 34.1 角色与成长

| # | 已确认决定 | 直接约束 |
|---|---|---|
| 1 | 只保留力量、体质、敏捷三项基础属性 | 底层键固定为power/vitality/agility |
| 2 | 不设固定职业 | 差异由属性、技能和装备形成 |
| 3 | 升级自动增长属性，不给玩家分配点 | 不建设配点与洗点UI |
| 4 | 系统上限20级；验收世界1级升到5级 | 等级曲线和内容跨度据此校准 |
| 5 | 技能由升级解锁与任务奖励共同提供 | 探索和道具学习后置 |

### 34.2 战斗

| # | 已确认决定 | 直接约束 |
|---|---|---|
| 6 | 每回合选择普通攻击、技能、道具或逃跑 | 不采用全自动继续按钮，也不接受自由招式文本 |
| 7 | 普通攻击默认命中，只计算伤害、防御和暴击 | 首版没有命中率和闪避率 |
| 8 | 同时提供战前重试和复活点恢复 | 两条恢复路径都要有检查点与说明 |
| 9 | 复活无额外代价，只恢复到安全状态 | 不扣货币、时间或复活道具 |
| 10 | 不加入元素、伤害类型和抗性 | Schema保留未来扩展能力但首版不消费 |

### 34.3 物品与经济

| # | 已确认决定 | 直接约束 |
|---|---|---|
| 11 | 背包无限容量，不做重量和格子 | 不存在容量不足的拾取失败 |
| 12 | 装备位为武器、防具、饰品 | Release固定三个底层装备位 |
| 13 | 不做随机词缀、强化和耐久 | 装备使用固定定义和属性 |
| 14 | 制作100%成功，但配方需要学习 | 配方解锁属于正式玩家状态 |
| 15 | 每个游戏只使用一种通用货币 | 不建设兑换和多币种定价 |
| 16 | 普通商品无限供应，特殊商品可以限量 | 库存系统只服务特殊商品 |

### 34.4 任务、地图和时间

| # | 已确认决定 | 直接约束 |
|---|---|---|
| 17 | 一个主追踪任务，并允许钉选若干其他任务 | 首版HUD显示主追踪加最多3个钉选任务 |
| 18 | SVG地形背景与可交互地点节点结合 | 地图同时提供移动端地点列表降级 |
| 19 | 快速旅行不被途中事件中断 | 阻断必须在旅行开始前判定 |
| 20 | 显示第几天和清晨/白天/黄昏/夜晚等时间段 | 内部分钟值不直接暴露给玩家 |
| 21 | 重要故事线不会因长期不参与永久失败 | 推进到安全等待点后等待玩家 |

### 34.5 关系、交互和存档

| # | 已确认决定 | 直接约束 |
|---|---|---|
| 22 | 不设独立NPC亲密度，只使用道德值和阵营亲合度 | NPC态度派生为好/一般/差三档 |
| 23 | 通用功能由替代NPC接管，独特内容随NPC死亡消失 | 替代关系在Build时预制和校验 |
| 24 | 犯罪只影响道德、关系、价格和局部任务 | 罚款、短时敌对、通缉和监禁后置 |
| 25 | 低风险自然语言映射直接执行，高风险或不可逆行动再次确认 | `requiresConfirmation`由Action风险策略决定 |
| 26 | 手动存档数量受限，首版以列表展示分支 | 默认20个命名手动存档，不绘制完整分支树 |

### 34.6 生产、媒资和发布

| # | 已确认决定 | 直接约束 |
|---|---|---|
| 27 | 创作者既能直接编辑受治理内容表，也能要求Agent修改 | 两种入口都进入候选、校验、采纳和stale流程 |
| 28 | 必须有程序地图、角色头像和场景背景；音乐音效后置 | 前三类是首版媒资门，音频有槽位和静音降级 |
| 29 | 创作者自带模型API Key，并显示费用估算与实际用量 | 密钥不得进入Prompt、Artifact、日志或导出 |
| 30 | 世界观引用冻结WorldRelease；小说允许产品内独立SourcePin | 两类来源都保存Hash和读取证据 |
| 31 | 旧存档默认继续绑定旧Release；明确兼容时才迁移 | 不静默升级存档 |
| 32 | 首个验收世界使用虚构测试世界“盐脊” | 先以固定种子和可控反例证明循环 |
| 33 | 首版完全没有友方NPC战斗协助 | 同伴、队伍和剧情援助战斗全部后置 |
| 34 | 首版只有标准难度 | 不显示难度选择器，未来沿用DifficultyProfile扩展 |
| 35 | 首版只使用随玩法逐步出现的教程提示 | 不建设独立教学场景 |
| 36 | 一个Release只生成一种内容语言，但Schema预留locale | 同Release多语言Artifact后置 |

### 34.7 首批校准参数

五项剩余参数已经以稳定决策ID集中登记在 `src/lib/open-world/product-config.ts`，首版校准起点为：

| 决策ID | 首版值 |
|---|---|
| `OW-CAL-001-default-content-scale` | 2地区、8—12地点、6—8主线Stage、2结局、2条重要故事线；主线90—120分钟，总可选内容库存180—300分钟 |
| `OW-CAL-002-relationship-thresholds` | 道德和阵营亲合度均为-100～100；-25及以下态度差、25及以上态度好；首版不被动衰减 |
| `OW-CAL-003-protected-quest-ui` | 主线和重要故事线显示禁用的放弃按钮并解释原因，不隐藏规则 |
| `OW-CAL-004-random-task-expression` | 每个模板Build时预生成3个变体；运行时只允许受治理候选，失败时使用Build变体或不发牌 |
| `OW-CAL-005-ai-budget-guardrails` | 单Build初始上限160次调用、120万输入token、36万输出token、预估30美元；每游玩小时60次、18万输入、4.5万输出、预估1.5美元；价格或结果未知时停止 |

费用数值是BYOK场景的初始硬保护，不是市场报价。每次运行仍必须取得所选提供商的价格快照并由创作者确认，随后通过“盐脊”真实生产和游玩数据校准。

---

## 35. 第一阶段完成定义

只有以下全部成立，才能把文字开放世界称为“真正可用的完整游戏产品”：

- 能从真实WorldRelease或受治理来源建立Brief并授权生产；
- AI能生产主线、重要故事线、地区、任务和场景，而不是机械映射节点；
- Build包含可解析的角色成长、战斗、物品、制作、经济、关系、时间和地图规则；
- 玩家能够从开场探索、接任务、成长、换装、战斗、制作、交易并完成结局；
- 主线等待玩家，其他世界内容有限演化；
- 系统Action、固定选项和自然语言三种输入同时成立；
- 所有正式结果由确定性规则和Event提交，AI不保存第二份状态；
- 玩家端拥有场景、地图、任务、角色、背包、战斗、制作、关系和存档UI；
- 创作者端拥有会谈、生产、审查、修复、试玩、发布和更新UI；
- Release不可变，Session可保存、刷新、重放、分支和迁移；
- AI失败时游戏仍能依靠固定内容和系统回执继续；
- 三注册表、数据owner、导入导出、删除和迁移完整；
- 自动测试、固定种子长期运行、隔离E2E和真人游玩均有证据；
- 旧机械编译和反向创建WorldRelease的入口已经安全下线；
- 至少一个正式小型世界从来源生产后被真人完整玩到两个结局，并能通过新Release修复问题。

---

## 36. 变更记录

| 版本 | 日期 | 内容 |
|---|---|---|
| 1.1.18 | 2026-09-07 | 落地P4 PlayerBuild：从已验收主角/体验/Ruleset形成完整身份与合法初始构筑；AI只负责人物演绎、非职业玩法风格和技能物品语义，代码冻结1级、三属性12点预算、100货币、初始数量、机制及稳定键；未生成的技能/物品目录以`reserved-unbound`显式阻断运行装配，上游、预算、身份、键和Hash均可复验 |
| 1.1.17 | 2026-09-07 | 落地P2 GameplayRulesetSkeleton：登记专属Context Source和Skill/Executor；AI只生成有Ledger claim依据的世界化规则语义，代码冻结三属性、20级、1→5验收跨度、自动成长、G2数值公式、标准难度单人四操作回合战斗、三装备位、单货币、确定性制作交易及完整模块版本映射；Effect词表与G2类型共享并分为模型可提议、编译器专属和旧版只读权限，固定边界、上游、claim与Hash均可复验 |
| 1.1.16 | 2026-09-06 | 落地P2 GameBrief/ExperienceContract/ProtagonistAsset：复用作者授权Brief，登记专属Context Source和Skill/Executor；代码冻结首版体验、规模、主线/重要故事保护、世界演化、交互、战斗、媒资、预算和直接发布条件，模型只补充有来源claim约束的体验语义与人物小传；来源角色必须有绑定所选资源单元的P1证据，全部输入、缺口、作者意图和产物形成可复验Hash链；不读取活动来源、不生成提前数值Build、不写世界引擎或运行状态 |
| 1.1.15 | 2026-09-06 | 落地P1 SourceManifest/SourceLedger/SourceGapReport：小说由登记Context Source精确分批交付，WorldRelease由Context Gateway按冻结资源坐标完整读取；逐单元实读、内容Hash、批次、逐字引文和偏移形成可复验链，代码确定性披露未读与关键来源缺口；所有产物继续复用Build Artifact候选生命周期，不写世界引擎或运行状态 |
| 1.1.14 | 2026-09-06 | 落地P0 WorldRelease/小说双来源SourcePin：世界来源冻结便携WorldReference和index实读证据，小说全文复制为20万字符有界的产品私有单元；版本、选择边界、Brief/开始授权、nonce Hash、rights、permission、读取证据和最终Pin形成可验证链；Pin索引最后落库作为闭合标记，相同Pin幂等、同Build换源失败关闭；复用productBuildArtifacts且不新增来源表、AI字段或Context旁路 |
| 1.1.13 | 2026-09-06 | 接入文字开放世界专属P0～P10生产合同：39种Build Artifact、26任务DAG、22个模型型durable Run及确定性预检/平衡与语义双评审/唯一装配/发布QA全部复用主干ProductProductionPlan、AgentRun和Artifact Store；Ruleset、表现、六类玩法目录各有独立Skill边界，Run可按地区/故事线在冻结预算内多次调用；P8目录可并行、P8F后绑定真实玩法引用，可选媒资Lane从P10需求派生；Skill和Executor未齐备前不切换现有线上入口 |
| 1.1.12 | 2026-09-06 | 落地Economy v2与Action v13确定性经济闭环：冻结单货币、商人归属/营业条件、交易类别、整数基点价格、普通无限库存和特殊有限库存；价格复用三档关系投影并阻断无风险套利；专用交易授权将货币、物品与Session有限库存原子提交，真实命令、Event与Replay复核完整交易状态并拒绝篡改；Economy v1只读兼容 |
| 1.1.11 | 2026-09-06 | 落地Crafting v2与Action v12确定性制作闭环：冻结100%成功、配方类别/学习/地点/条件/材料/产物/耗时、批量与事件单位上限；Build双向校验每配方唯一craft Action与perform-crafting Effect，拒绝关键或实例型材料、输入输出重叠、堆叠越界、不可执行单份配方及无解锁入口的非默认配方；命令显式提交数量，专用授权原子扣料、产出、推进时间并以claim幂等，刷新重放复核完整状态且拒绝篡改；Crafting v1只读兼容而不获得新执行语义 |
| 1.1.10 | 2026-09-06 | 落地Combat v3与Action v11确定性战斗结算：冻结有界整数伤害/暴击算法和逐技能倍率，以正式随机证据与完整目标结算授权原子提交伤害、状态、资源和冷却；代码按生命状态自动判定胜败、清理临时战斗状态，并以独立系统Action按战斗实例只结算一次胜利奖励；Action v10/Combat v2保持旧档兼容 |
| 1.1.9 | 2026-09-06 | 落地Relationship v2道德解释、完整阵营亲合度与三档表现合同；同一确定性投影统一态度、原因、问候、普通互动和价格倍率，拒绝独立NPC亲密度及未预制故事修正；Build保证关系条件不阻断主线，玩家关系页与AI/Actor投影读取同一结果 |
| 1.1.8 | 2026-09-06 | 落地Actor v3四级死亡策略、逐服务连续性表与Action v7玩家攻击/系统剧情结果分治；死者退出交互和服务投影，备用服务按Build预制关系激活，关键保护与替代完整性由确定性代码保证 |
| 1.1.7 | 2026-09-06 | 落地九域类型化Condition DSL、静态引用和归属校验、复杂度硬上限与公开失败结果 |
| 1.1.6 | 2026-09-06 | 落地统一Action目录、跨模块消费者反查、可用性与合法目标投影，并统一三种输入命令解析 |
| 1.1.5 | 2026-09-06 | 落地vNext统一CommandEnvelope、稳定指纹、事务幂等事件、stale保护和未知结果查询边界 |
| 1.1.4 | 2026-09-06 | 落地15个领域Module Schema与跨模块完整性校验，补齐“类型存在但引用不可运行”的确定性阻断 |
| 1.1.3 | 2026-09-06 | 落地TextOpenWorldRuntimePackage vNext严格包络、15个逻辑模块依赖、来源Hash、校准、媒资、质量和旧Release兼容策略 |
| 1.1.2 | 2026-09-06 | 冻结五项首批校准参数并登记稳定决策ID、内容规模、关系阈值、保护任务UI、随机任务正文策略和AI预算硬保护 |
| 1.1.1 | 2026-09-06 | 接入文字开放世界完整开发清单；以121个首版工作包和12个后续能力承接本文施工阶段、依赖、状态和验收进度 |
| 1.1.0 | 2026-09-06 | 冻结36项首版产品决策；收口三属性、20级上限、逐回合四类战斗操作、单货币、SVG节点地图、无个人亲密度、无友方NPC参战、标准难度、渐进教程、单Release单语言及来源/存档/媒资策略 |
| 1.0.0 | 2026-09-05 | 建立文字开放世界整体产品施工入口；补齐角色成长、技能、战斗、物品、装备、奖励、制作、经济、任务、地图、时间、NPC关系、知识、反馈、存档、玩家UI、创作者工作台、媒资、AI边界、Build、现有代码映射、实施路线和验收体系 |
