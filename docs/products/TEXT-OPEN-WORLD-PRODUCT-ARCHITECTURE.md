# AI 主导文字开放世界游戏 · 整体产品与游戏系统施工规格

> 规格版本：1.1.61
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

当前StoryArchitecture实现把“全局故事设计”限定在任务、地区和场景生产之前：登记Context只读取同一Build已验收的GameBrief、ExperienceContract、ProtagonistAsset以及P1 Ledger/Gap Report，不重新接触活动世界或小说。AI负责核心冲突、长程节拍、多结局差异和叙事承诺的开放式语义；代码固定严格顺序且等待玩家的主线、不可永久失败的核心目标、非地点唯一触发、5～8节拍单调阶段、结局数量与Brief一致、所有结局达成同一核心目标，以及承诺的建立—中间回响—最终回收顺序。地区只在此阶段以`spatialFunctionNeeds`表达戏剧空间需求，不能提前制造地点ID；任务、奖励和运行条件同样不得越级生成。稳定Story/Ending/Promise/Callback键由代码分配，结局Condition与承诺Scene绑定保持显式unbound，由后续主线、地区和场景生产兑现后才可装配。

当前RegionSkeleton实现随后把来源与故事空间需求转成稳定世界坐标，而不是让地图Agent自由扩写世界：登记Context只读取同一Build已验收的GameBrief、SourceManifest/Ledger、ExperienceContract和StoryArc，地区数精确服从Brief、地点总量服从命名地点范围。AI为地区、地点和道路设计名称、用途、空间功能及提前到达时的安全常态，每项都必须引用已交付来源claim或StoryArc空间需求，并覆盖全部需求；代码生成Region/Location/Edge/FastTravel稳定键，保证全部地点和地区双向连通、每区一个快旅/复活点、只有起点默认解锁、完整世界Build时存在但知识逐步揭示、道路在骨架期无剧情Condition且关键主线绝不因到达地点自动触发。主线、Scene、Quest、Actor、Encounter、Vendor和媒资引用继续保持unbound，等待对应生产阶段真实兑现。

当前MainlineThread实现再把宏观故事变成可施工的主线阶段，而不越级伪造任务目录：登记Context只读取同一Build已验收的GameBrief、玩法骨架、StoryArc、EndingContracts、NarrativePromises、RegionSkeleton与PlayerBuild。AI在Brief的Stage范围内设计阶段标题、玩家目标、空间落点、对话/调查/探索/战斗/选择体验、必要揭示、结果、关键资产保护需求和失败恢复；代码生成唯一`storyline.main`与稳定Stage前后链，要求从初始地点开始、按StoryBeat单调推进且全部覆盖，把每项Promise的建立/回响/回收投影到具体Stage，并让所有合规结局只从最终Stage分流。主线时长按模型权重确定性分配到Brief范围，推荐等级从1推进到首版验收5级；所有Stage固定可等待、不可放弃/过期/永久失败、不被普通世界状态阻断且只能由显式主线Action推进。Quest、Objective、Scene、Reward、Condition和Effect继续显式unbound。

当前SignificantThreads实现把“重要支线”从人物小传或一句势力冲突升级为可施工的长程故事资产：登记Context只读取同一Build已验收的GameBrief、SourceLedger、StoryArc、EndingContracts、NarrativePromises、RegionSkeleton和MainlineThread。AI按Brief精确生成角色、势力、地区owner的重要故事线，并至少覆盖两种owner；每线必须有2～4方的目标、资源与压力，3～6个玩家可实际完成的Stage、升级步骤、环境/传闻/功能NPC氛围信号，以及道德、阵营、地区、NPC态度或资源范围内的局部后果。代码生成稳定Thread/Owner预留/冲突方/Stage/Consequence键，地区owner立即绑定地图，角色与势力owner等待后续NPC目录兑现；所有故事固定安全等待、不可放弃/过期/永久失败、缺席无压力、非地点唯一触发，且不能改写或阻断主线、改变核心目标或单独决定结局。Quest、Scene、Actor、Faction、Condition、Effect和Reward继续显式unbound。

当前RegionNarrativePacks实现把完整地图继续编译为可供任务与地区导演消费的内容生态：登记Context只读取同一Build已验收的Brief/体验、来源Ledger、RegionSkeleton、MainlineThread和SignificantThreads。AI必须为每个地区建立独特幻想、地方冲突、生活基线、矛盾与状态轴，并逐一覆盖全部地点的日常活动、NPC角色需求、传闻钩子、昼夜/天气表现和风险；同时按盐脊Brief首版保底生成6个普通任务、4个可变模板、12个随机事件种子及每区传闻。角色需求明确分成需要Agent持续保持且受保护的重要角色，与按日程/服务/问候规则运行的功能、常驻和氛围角色；势力只保存群体目标、资源和可见存在，不启动“一个成员一个Agent”。代码生成全部稳定预留键，保证重要故事的角色/势力owner由唯一地区需求承接，固定普通世界继续演化而主线等待、重要故事只在安全点等待；NPC、Faction、Quest、Template、Event、Condition和Effect仍全部unbound。

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

当前P8任务骨架已按这条边界落地：同一Build中已验收的Brief、体验、玩法规则、主线、重要故事和地区生态被投影为确定性的Quest Source，7个主线Stage、6个重要故事Stage、6个普通任务种子和4个地区模板各生成一个且只能生成一个骨架。模型只负责故事动机、阶段目的、玩家Objective与语义需求；代码固定任务生命周期、显式启动、受保护故事等待，以及任务/Stage/Objective的运行绑定为空。同步生成的`ContentRequirementManifest`覆盖全部Objective和地区角色、势力、地点交互需求，为六类Gameplay Catalog和`QuestFinalize`分配owner；因此后续目录能够按需求生产真实定义，而任务不会引用尚不存在的敌人、物品、奖励、NPC或Action。

P8六类Gameplay Catalog均已落地，并共享已验收QuestSkeleton而不是仅凭需求标题猜测。Progression形成20级曲线、技能及公式；Enemy/Encounter兑现战斗Objective与地区基础遭遇；Item/Reward形成任务/遭遇奖励、掉落与主线1→5级1600经验闭环；Crafting/Economy形成配方、商店、定价、库存与反套利约束；NPC Runtime形成角色/势力、重要Agent和普通规则角色、日程、态度与功能替代；Map Interaction形成完整拓扑、地点交互、旅行、快旅和程序SVG布局。六类目录在P8均保持运行引用unbound，避免各目录自建一套Action或伪造跨模块键。

P8F现已把上述目录与23个任务骨架一次性最终化为`QuestDesignDocuments`和`DirectorDecks`。模型不能编造运行键、公式或结算结果，只负责任务/Objective可读语义、模板类别/强度/权重、随机事件包装，以及从代码提供的候选中选择传闻传播地点、事实确认来源和成就来源；代码从已验收目录生成所有Condition、Effect、Action，并建立任务、目标、奖励、战斗、技能、道具、配方、商店、NPC、地图、旅行、快旅、复活、地区演化、Knowledge、Rumor和Achievement的双向真实引用。P7每条受治理传闻必须声明主题、内部真相、来源Claim、可靠度和最早揭示门槛；P8F为其生成唯一Knowledge、一次性传播事件、未读/阶段Condition及1～3个真实确认Effect。阶段门槛必须由该来源Stage对应的唯一任务`completed`兑现；同Stage任务领奖因发生在任务完成后可作为确认来源。主线Knowledge只允许同Stage或更晚的主线任务领奖及最终结局确认；重要支线Knowledge只允许同故事线且不早于门槛的任务领奖确认，不得借全局结局绕过。每个`reveal-knowledge`与`earn-achievement` Effect都只有一个执行owner：对应任务独占的RewardContract/领奖Action组合，或精确结局Action；RewardContract与领奖Action不得跨任务共享，任务奖励Effect镜像必须与RewardContract完全一致。3～6个成就由真实任务领奖Reward或结局Action直接且唯一拥有`earn-achievement` Effect，Director和犯罪目击后果都不能成为第二条授予路径；历史发布缺少`owner-action`标记时继续按原条件式语义重放。

fresh受治理生产进一步以Action v18冻结受保护故事的确定性揭示链。主线顺序由来源Stage order而不是Artifact数组顺序决定：必须且只能有一个无前置的主线根任务初始`revealed`，其余主线与全部重要支线初始`locked`。后续主线依赖上一主线完成；每条重要故事的首任务依赖该线声明的主线开放窗口，后续任务依赖同故事线上一任务。编译器为每个锁定的受保护任务生成唯一系统`action.reveal.*`，以有序双Effect完成`locked → available → revealed`；它不绑地点、不消耗时间或资源、没有失败分支，不进入Choice或自然语言候选，只由任务系统在前置成立后自动结算。P10不相信数组顺序，而是从前置图重建主线和每条重要故事，拒绝断点、分叉、环或错误窗口；Action≤17及历史durable Context保持原冻结语义。

fresh Knowledge运行包使用Director v3。每条受治理传闻事件必须精确冻结一个地区和该地区内一个传播地点，并且唯一进入对应地区牌组；牌组必须包含`rest`触发，且编译器拥有的`action.rest.standard`在任意地点均可执行，从而保证玩家到达冻结传播点后存在可触发抽牌的正式行动，但权重、空白牌和冷却仍决定实际传播时机。Director候选生成、弱授权复核和Replay都要再次匹配当前地点。Director v2历史事件继续是地区级语义；解析时只在内存归一为空`locationKeys`，重新冻结v2 payload时会删除该新字段，保持原字节形状与content Hash兼容。主线/重要故事仍为受保护等待，不进入区域发牌压力；普通任务可放弃重接或按时限过期。P9只补三类交互的场景表现与模板文字变体，不得另建第二套结果。

P9现已落地`SceneScripts`、`ChoiceContracts`和`ActionBindings`。代码先完整读取并校验Source、体验、故事、地区、任务、NPC、地图、QuestFinalize和Director产物；fresh Build再从完整durable Context确定性派生`governed-v3`最小模型投影。每个Scene使用一项独立模型请求，只得到该Scene的唯一Knowledge边界、公开地区/地点、当前Objective、由运行元数据推导的通用角色职责和当前Action语义；另以一项不含Scene的共享请求生成Action例句、模板/事件及Knowledge/成就公开表现。请求之间不共享其他Scene材料，`forbiddenFutureObjectiveKeys`、Source Claim、P7原始人物职责/叙事功能/日程/服务需求、SourceLedger正文与证据、StoryArc全文、人物小传/私密演绎、内部真相和传闻事实均不得进入模型。fresh Build最多127个Scene加1项共享请求；P8F在接受任务包前使用同一确定性公式证明该上限。各片段拥有稳定子步骤、原始响应、候选和恢复证据，已成功片段不得在重试时重复计费；共享调度账本按`runId + attempt`结算每次真实调用，后续attempt只预留任务总预算扣除同Run历史已付用量后的余量，未知结果保留原预留，部分调用的费用上界则按本次实际模型/媒资调用比例分摊。调用、输入和输出预算各额外保留一项最大片段的修复余量。P9因此授权最多129次调用（128次初始请求加1次片段修复），输入/输出token按独立的19/156权重分配，并独占48/100的生产时长权重；P8F以12/156继续满足不可切分任务上下文，调用扇出不会挤占上游故事与任务生产，同时给大体量Scene投影保留安全余量。完整Build初始最多154次调用，连同一次P9修复授权共155次。模型只写场景/对话、固定选项标签、地区模板三种文字变体、非传闻事件表现、Knowledge/成就公开标题及非战斗自然语言示例；传闻文本、可靠度、来源与Knowledge键一律从P8F和Director复制。代码拥有场景来源、知识边界、全部稳定引用和Action Definition Hash：系统Action按钮、固定Choice与自然语言候选最终都只选择`QuestDesignDocuments.actions`中的同一Action。战斗Action只允许按钮/系统操作；自然语言低置信度不得执行，高风险或不可逆Action必须确认，无法映射时只作自然回应并推荐正式操作，首版不能据此创建任务、地图、Action或直接写状态。历史P9 durable Context继续使用原单次调用与原始字段语义。

P9的作者修订是一条显式的零模型durable路径，不是把作者稿再送给模型改写。当前blocker、Run、control epoch、Plan task与Skill身份全部匹配后，scheduler把完整聚合JSON作为`authorDraftJson`交给P9；governed与legacy Context均在任何模型分支之前执行同一`parseDraft`和最终编译验证。该attempt的model/media calls、输入/输出token和最大费用全部为0，但仍预留真实的duration与storage；作者稿Hash进入结构输入Hash与幂等键，因此两份不同修订不会误复用。执行前完整原稿以`source-snapshot`记录进Agent Run，候选、验收和terminal receipt继续走同一Harness；结构或语义无效时直接阻断，绝不回落为隐藏模型请求。

已返回的P9模型响应可能在返回后才被发现超出本attempt的token或费用预留。这种情况必须先将原始响应和provider返回的真实usage写入durable证据与共享账本，再把超额候选阻断；不得因验证失败丢失已付成本，也不得在剩余任务预算不足时继续隐藏重试。请求结果未知则保留全额预留并进入作者裁决，不将“没有候选”误当作“没有产生费用”。

P9新生产使用SceneScripts Context v2：同一场景中只有全部Action共有的Condition才能上升为场景可用性，其余条件仍留在各自Choice/Action上；Objective只把该目标显式需求且属于当前地点的Actor列为必须在场参与者，不再无条件把任务发布者加入每个目标。这避免“完成Action尚未解锁导致启动Action也不可见”和“任务发布者缺席导致目标永久消失”。历史Context v1仍按原确定性语义验签，确保旧durable Run可继续恢复而不伪造篡改；历史Narrative v2/Action v15包仍需兼容归一；玩家投影会从Action条件交集、Objective与Actor对话场景共享的冻结Action引用及Actor居所确定性归一旧P9场景，连同发布者恰好与目标同地的旧包也不会重现上述两类吞场景问题。 fresh包仍使用Narrative v2和Action v15+输入绑定合同，但当前完整治理出口为Action v18。

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
保证离线、旧Release和重放自足；G1-10会把它与不可变ProductRelease绑定并核对来源Hash。

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
  activation: active | passive
  mechanic:
    attack
    | recovery(baseAmount, scalingRatio)
    | resource(baseAmount, scalingRatio)
    | status(statusKey)
    | passive-static(modifiers[])
  target: self | single-enemy | all-enemies
  scalingAttribute: power | vitality | agility | null
  unlockConditions
  resourceCost
  cooldownTurns
  priority
  useConditions
  presentationRefs
}
```

新生产把AI设计的技能语义经过确定性编译形成上述结构化机制，再由P8F绑定到唯一正式Action。数值、状态策略和运行结果进入Release与授权，不在战斗时临时生成。首版实际闭合攻击、治疗、技能资源恢复、增益/减益和静态被动；护盾、多次命中和改变出手顺序保留Schema扩展方向，在对应确定性合同落地前模型不能声称可用。历史Progression v1继续按冻结的`activation/kind/effectKeys`合同读取，不被静默改写。

### 7.2 玩家回合操作

玩家每回合从四类正式操作中选择：

1. 普通攻击：无资源消耗，首版默认命中；
2. 技能：从已学习、冷却结束且资源足够的技能中选择；
3. 道具：从当前战斗允许使用的消耗品中选择；
4. 逃跑：按遭遇规则尝试结束战斗。

第一阶段不提供自动战斗策略、技能优先级或自由文字战斗动作。敌人仍由确定性 `strategyProfile` 选择行动；未来如果加入自动战斗，应建立在同一套合法Action之上，而不是另建结算逻辑。

### 7.3 状态效果

首版战斗内状态支持：

- 有益/有害/中性分类；
- 持续目标自身行动数或持续至本场战斗结束；
- 不可叠加、刷新、叠层三种规则；
- attack、defense、skillPower和暴击率的白名单静态修正；
- 来源战斗员、来源技能及应用/刷新/叠层/到期Event授权；
- 目标完成约定数量的自身行动或战斗进入终态时移除。

持续世界时间、每回合伤害/治疗、护盾与行动限制属于完整架构的后续机制。它们必须先扩展Condition/Effect、状态时钟、授权、Replay和玩家解释，再允许生产Agent输出；首版不能仅凭状态说明文字假装已经生效。

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
- 只有固定生成、普通、不限时且明确采用`abandon-restart`策略的任务，放弃后才可回到冻结的原发布场景重新接取；重接复用原实例、清空旧终态和目标进度，并从第一Stage重新开始；
- 普通限时任务允许放弃，但放弃是终态且原绝对截止时间继续存在；到期后仍由系统迁移为`expired`，不得借重接刷新期限；
- 新发布的Action v16对尚未开始及每个Stage分别生成精确放弃Action；终态迁移同步清理主追踪/pin并重算Director任务预算镜像，旧Action v15存档仍按冻结语义重放；
- fresh Action v18只让一个无前置主线根初始`revealed`；其余主线和全部重要支线初始`locked`，再由无地点、零时间、零成本且不进入玩家输入的唯一系统Action依前置图自动执行`locked → available → revealed`；后续主线只跟随上一主线，重要支线首任务跟随声明的主线窗口、后续任务跟随同线前驱；
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

首版任务日志只是权威运行状态的玩家投影，不建立第二份任务表。它只显示已经`revealed`且留下`offeredAt`证据的任务实例；`locked`、仅内部`available`的卡牌、未来Stage、未来Objective、未知地区/地点、未揭示知识与随机奖励结果均不得进入视图。传闻正文还必须同时命中当前Session实际读过的Rumor键，不能因为同一Knowledge已经处于`rumor`状态就任选一条未读传闻。

任务日志只拥有追踪、取消追踪和当前Stage精确放弃入口。接受任务、重接任务、目标动作和奖励领取仍属于各自冻结Scene，日志不得成为绕开发布者、地点、剧情正文或结算场景的备用入口。地图定位只是绑定当前Session的一次性UI请求，只能聚焦玩家地图投影中已经可见的地点，不等于旅行Action，也不能揭示未知地点。

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

### 20.5 首版已落地边界

首版G4-11已经闭合Player Knowledge消费纵切面，但没有提前宣称完成G6的Actor Knowledge长期记忆：

- P7生产受治理的传闻种子，P8F将其编译为唯一Knowledge/Rumor、单地点Director v3传播事件、揭示门槛、确认来源和真实Effect；传播事件唯一进入对应地区牌组，牌组的`rest`触发与全局休息Action共同保证到达传播地点后存在可达抽牌入口；Director v2继续按原地区级字节形状冻结；
- Stage门槛只能由精确来源任务`completed`证明；同Stage或更晚的领奖可确认主线Knowledge，最终结局也是主线的合法下游；重要支线只能由同故事线且不早于门槛的领奖确认，不允许全局结局绕过；
- P8F把3～6个成就绑定到真实任务领奖Reward或结局Action；每项Knowledge确认或成就Effect的执行owner只能是对应任务独占的RewardContract/领奖Action组合，或精确结局Action，Director与犯罪后果不得形成第二路径；历史条件式成就继续按旧语义重放；
- fresh Action v18冻结一个初始可见的主线根、后续主线链和每条重要故事的主线窗口/线内前驱；锁定任务只能由系统`action.reveal.*`的两步Effect公开，P10从前置图拒绝断点、分叉和环；
- P9只生产公开表现文字，传闻事实由上游逐字段复制；场景引用运行时Knowledge键，不把SourceLedger Claim冒充玩家知识；
- P10、确定性预检和运行包装配共同验证P7→P8F→Director→P9→Runtime引用闭合；fresh运行包的百科条目只来自受治理Knowledge，不再把完整SourceLedger自动发布给玩家；
- Session Effect/Event是唯一揭示、读传闻和获得成就的状态源；关系、百科、传闻、历程和成就页面只是当前Session的披露安全投影，不保存第二份状态；
- 百科只显示已知事实、已知地图层级和当前持有物；传闻必须有当前Session实际读过的Rumor证据；未获得成就只显示匿名数量；历程必须由同Session连续终态事件和Knowledge历史共同证明；
- 历史Release没有`knowledgeProgressReady`治理标记时继续使用原有解析路径，不能伪装为新闭环；Actor Knowledge、对话摘要和长期最小记忆仍由G6-08实现。

关系页沿用确定性的道德值、阵营亲合度与三档态度投影，只公开当前位置人物或已揭示任务联系人；人物小传、`privateKnowledge`、内部权重、稳定内容键和未揭示任务关系均不得进入玩家DTO或DOM。

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

G5-11首版实现采用“直接兼容子版本 + 状态级复算”的双门：Release lineage必须把目标声明为当前固定版本的直接兼容子版本，代码还会根据新旧RuntimePackage重新计算稳定键兼容报告。当前只放行稳定ID、规则、任务、数值和状态语义完全不变的文本、图片、音频及Presentation替换；任何状态语义变化都拒绝迁移并继续固定旧档。预演读取当前规范事件头，重建新Release冻结定义并验证完整玩家投影；作者确认后创建绑定新Release的子Session，不复制旧事件、不修改父Session，父子关系与迁移计划Hash共同保留回退证据。

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

### 22.6 首版玩家启动器的落实边界

玩家入口采用“游戏库 → Release详情 → Session运行”三级结构，不能把制作面板、发布选择和游戏运行堆在同一个侧栏：

- 普通进入只打开游戏库，不根据最近更新时间擅自进入任意存档；
- 游戏身份使用已核验Release根记录的`productionKey`，不能按可重复的显示标题合并；同一产品族先比较`version`，只有版本相同时才用时间与ID破平；
- 详情默认展示当前Release，同时保留同一产品族的全部不可变旧版本供创作者明确选择开新档；
- 存档始终通过自己的`productReleaseId`继续，旧档不会因为库中出现新版本而静默迁移；
- 正式目录只列Release-bound Session。Build Preview只能由制作端以明确Session handoff进入，运行页必须标记“非正式发布”，不能伪装成正式Release或混入正式存档；
- Release详情只展示公开主角和数量统计，不披露未来地区名称、隐藏任务、秘密知识；版本、发布时间、来源Hash、运行包Hash和Release Hash分别显示，不能混用；
- 同scope的损坏Release仍保留诊断卡但禁止新开Session；选档校验失败时清空旧运行投影、保留原数据并返回游戏库重试；
- 删除存档必须二次确认。删除前只做scope、世界分组和产品kind的owner校验，使来源丢失或损坏的自有Session仍可清理；实际级联统一调用Session生命周期入口，不删除Release和其它时间线。

这一级只解决入口、选版和Session来源语义。20个手动档、自动档分类、分支列表、迁移预演和完整恢复工具仍由G4-12实现；响应式三栏游戏壳与场景主界面由G4-02实现。

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

当前实现把教程进度明确限定为浏览器本地表现状态：以稳定`productionKey + runtimeChannel + optional userId`划分作用域，正式Release进度自然跨版本和Session延续，Build Preview使用独立通道；任何步骤状态都不得进入World、ProductRelease、Session、Event、Checkpoint、导出、模型上下文或凭证记录。存储不可用时只保留当前挂载内存，不以游戏状态表兜底。

自动披露必须同时满足三重事实：该产品确实支持功能、当前运行状态已经开放功能、目标所在页面已经由玩家真实打开。场景页再以ScenePanel当前选中场景的固定选项、自然输入和可见Action为准；战斗只在事件与投影对齐且真实按钮就绪后开放。一个`作品 + 通道 + Session + 页面 + Event序号`周期最多显示一步；页面、场景、Action、战斗或目标变化使原提示失效时立即撤下，不能借可见导航入口提前讲解尚未打开的页面。玩家从帮助页主动重看时可以使用导航锚点引导前往目标页，但重看不得执行Action或改变已完成状态。

系统步骤和Presentation冻结的作者步骤进入同一披露安全投影。作者步骤只引用已发布Action和受支持UI白名单；当前未满足的Action保持休眠，未知目标、非法字段、超长、超量或重复内容失败关闭，帮助页只显示不泄漏内容的兼容数量。首次生产的作者提示绑定真实Scene Action，不再从全目录任取Action。Coach提供完成、单项跳过、暂停/恢复、重看和显式重置；自动提示使用live region，重看转移并恢复焦点，目标离开可见滚动区时先定位，高对比、层级和移动端长文滚动均须保持操作可达。

### 23.6 通用页面状态

每个一级页面都必须具有：

- loading、empty、ready、recoverable-error和blocking-error；
- 刷新后恢复选中Session和安全UI焦点；
- 未找到引用时显示诊断而不是白屏；
- 危险操作确认与重复点击幂等；
- 无模型、断网和余额不足时的降级提示；
- 可回到当前场景的稳定入口。

### 23.7 首版响应式壳的实现边界

玩家运行器统一采用纯展示壳，壳只拥有`activeView`和上下文抽屉开关两类前端临时状态，不读取Store、不提交Action，也不保存到Session。切换Session时必须复位到场景并关闭抽屉；页面切换只改变可见区域，不能改变Event、Checkpoint或Projection。

首版壳固定提供：

- 桌面左侧主导航与当前任务摘要、中央当前一级页、右侧当前位置上下文；
- 中等宽度把右栏改为上下文侧抽屉，移动端再收起左栏并固定“场景、地图、任务、角色、更多”五项底栏；
- Header内稳定保留退出、当前游戏/地点、Release或Build Preview来源及冻结运行包Hash、返回场景和窄屏上下文入口；
- Footer只投影运行时已经确定的生命/资源、地点、战斗、时间天气、tick/旅行、事件序号与忙碌状态，不在这一层发明新HUD语义；
- 上下文抽屉和高风险确认层均必须隔离背景交互、将Tab焦点限制在模态区内，支持Escape关闭并把焦点恢复到触发器；跨响应式断点时不得残留伪模态，换Session时必须撤销尚未执行的旧确认；切页和换Session后把焦点送回中央主区域；
- vNext与legacy Release共用同一壳。legacy缺失统一角色数值合同时必须明确显示兼容降级，禁止根据旧字段猜测属性。

五个一级页在G4-02只重新安放已有功能：场景承接现有行动和反馈，地图承接现有地图/旅行，任务承接现有任务实例，角色承接已有身份/数值，更多承接装备、背包、关系、历史和检查点。场景叙述、NPC对话、固定选项与自然输入由G4-03实现；完整HUD、任务日志、地图、角色、背包、战斗、交易和存档能力仍分别由G4-04～G4-12实现。

该切面不新增数据库表、Schema、Context Source、可采纳字段或Release字段；玩家父入口只负责scope加载、游戏库和vNext/legacy运行器分派，不再保留旧发布侧栏副本。

### 23.8 首版场景投影与三类输入的实现边界

G4-03直接消费ProductRelease或制作端显式Build Preview内冻结的Narrative v2场景正文和Action v15+输入绑定（当前fresh完整治理包为Action v18），不回读生产Artifact，也不新建`currentSceneKey`。当前可见场景由代码从唯一Session Projection实时派生：地点必须等于玩家当前位置，Context v2确定的场景共有Condition必须成立，任务委托/当前Objective/收束分别匹配`revealed`、当前`active`目标和`completed`实例，场景显式参与NPC必须仍存活且在场。任一Action的私有Condition只隐藏自己的Choice/Action，不隐藏同场景其他合法行动；旧P9误注入的任务发布者无论同地或异地，也会由Objective与Actor对话场景共享的冻结Action引用被剔除，真正的Actor需求仍保留在场门控。角色拥有的委托与收束在新生产中固定落到发布者常驻地点，其任务地点继续描述冒险主体；无法区分编译修订的旧Narrative v2包在运行时同样按角色常驻地点归一，避免发布者被要求异地出现而软锁。历史P9 Context v1仍按任务首地点/地区的原端点语义验签，使已付费未完成的durable Run可以继续恢复。推荐场景只取合法集合中P9 `order`最小者，玩家切换同地点的其他合法场景只是前端临时选择，不写Event。玩家投影仅携带当前显示与交互所需字段，不向UI或后续模型暴露内部场景purpose及未发生的成功/失败文案。

旧P9端点归一不能把按原任务地点写成的正文冒充为当前地点文本。只要归一后的地点与冻结Scene地点不同，玩家投影就显式标记`legacy-endpoint-fallback`，隐藏可能产生地理矛盾的旧开场/正文，改用带兼容提示的地点中性确定性文案；新生产及未迁移地点的Scene仍逐字展示冻结P9正文。该回退不修改Release、Build或Session状态，未来若允许NPC移动，必须以新版本端点合同取代这项兼容推断。

同一场景表面分成五个不可混淆的区域：

1. “冻结叙事”只展示当前Session来源中冻结的P9开场与正文；正式Session来自ProductRelease，制作端显式试玩来自Build Preview，不能把Preview标成已经发布；
2. NPC对话从统一关系Projection选择`bad/neutral/good`开场和问候语气，不读取或暴露知识治理内部字段；
3. 固定Choice以`fixed-choice`提交它绑定的Action；
4. 系统Action以`system-action`提交同一Action；
5. 自然输入在无运行时模型的首版只对当前场景P9冻结例句做Unicode归一、去首尾空白和大小写归一后的精确匹配，唯一匹配才以`mapped-intent`提交。

三类执行入口都必须再次通过当前Action Projection解析合法目标并进入同一Command/Event事务。交谈Action从冻结的Actor对话场景反向限定对应Actor，开战Action从唯一`start-combat/initialize-combat` Effect限定对应Encounter，不能把同地点其他NPC或遭遇当作可互换目标。被P9 Scene引用、由玩家执行且目标为Quest的Action，以及玩家执行的结局`quest-action`，属于场景专属任务动作：Action注册表会再次校验所属Scene当前合法，并以该Scene的offer=`revealed`、objective=`active + 当前Stage + 当前Objective`、resolution=`completed + 对应Stage`精确匹配实例；即使同一可重复任务定义同时存在多轮实例，也不会把旧active实例与新revealed实例混成多个目标。这也覆盖P8F为未落专用目录需求生成的`observe + targetScope:quest`兜底Action，Quest页和直接命令不能越过NPC、地点、Stage或Objective门槛。目标为零、普通动作收窄后仍不唯一、Action已经失效、自然输入无唯一匹配或处于战斗自由输入禁用状态时都不写世界状态；G4-09完整目标选择器落地前，战斗动作在多名合法敌人中按权威Projection顺序选择第一名存活目标，避免多敌遭遇死锁。高风险Action仍进入统一确认层，确认后保留原始输入来源，并把弹窗打开时整个`ProductRuntimeState.lastSequence`作为必填`expectedBaseSequence`传到执行器；执行器读取数据库最新状态后拒绝缺失基线，或跨标签页/其他命令造成的stale确认，随后Command事务仍以Sequence+State Hash防住检查后的并发变化。确认按钮还必须读取实时Store身份，旧DOM不能把上一Session意图提交到新Session；若确认因stale失败，Store先尽力刷新权威Projection再保留并抛出原错误，让玩家可在新基线上重新确认。系统结算回执在视觉与辅助语义上均独立于发布正文，通过独立的读屏动态区播报终态，不能让AI文本伪装成已发生结果。

Action开始时还必须冻结`request revision + scope + worldGroupId + sessionId`。执行期间即使用户切换了游戏或存档，旧Action仍可只在其原Session完成，但它的成功回执、错误、busy终态和刷新结果都不得提交到新Session界面；新一次load/select会显式清除旧busy。Narrative v1 / Action v14的正式旧编译器以`action.talk.<actorKey>`冻结单NPC交谈目标，兼容投影按该稳定键收窄目标，避免同地点多NPC时出现“按钮可见但永远不可执行”；无法证明该键契约的更旧通用Action不作猜测。

P9只为任务、NPC、地点交互和随机事件等叙事需求生产Scene，并不保证休息等通用玩法Action拥有Scene。场景投影因此额外返回“当前Action Projection可用、但从未被任何P9 Scene引用”的环境Action；场景页将其与当前选中Scene的Action去重合并。被隐藏Scene引用的Action不会借场景页的环境入口提前出现，但Scene引用本身也不能反向锁死背包、装备、制作或商店等通用玩法：这些Action继续按自身Condition与专用功能UI执行。制作、购买和出售还需要商品/配方及数量参数，G4-10专用UI完成前，Narrative v2/Action v15+场景快捷入口及Narrative v1/Action v14兼容场景均不展示这三类必然缺参的按钮；旅行、快旅和装备同样由对应功能页消费。 Action v18的受保护任务揭示Action是系统私有结算入口；即使P9 ActionBindings完整覆盖该Action，也不能把它投影为环境按钮、Choice或自然语言候选。

这一级不实现G6的语义模型、自由对话和结果演绎。G6-03接入模型后只能在同一候选/确认边界内扩大表达识别，不能创建Action、任务、地点或结果。Narrative v1/Action v14旧包只显示兼容地点正文和仍合法的系统Action，自然输入禁用且不得伪造P9内容。当前Director状态只能证明随机事件曾经发生，尚不能证明其场景仍处于活动窗口，因此随机事件场景先失败关闭；G4-04必须以显式当前激活/失效证据接入通知与表现。

### 23.9 首版HUD与重要变化通知的实现边界

G4-04不建立第二份HUD状态。玩家页必须从已经通过运行包与Session校验的唯一Projection及其冻结Release模块实时派生生命、技能资源、当前位置、地区、第几天、时段、天气和任务摘要。任务区只把`tracking.primaryInstanceKey`解释为主追踪；主追踪为空时明确显示“当前没有主追踪任务”，不得用钉选任务冒充。最多三个钉选任务单独显示。每条摘要统一包含任务状态、当前阶段、下一项未完成的必需目标及绝对期限的玩家可见表达，终态或已失效追踪引用必须从HUD剔除。

“近期变化”同样不保存第二份通知表，而是从当前Session的规范Event前缀重建。通知投影只接受与Projection head完全相符、同Session、连续且已经到达终态的Command/Random/Effects链，并从冻结任务、角色、地区、地点和随机事件定义取得玩家可见标题；条数和每条细节数都有上限。跨Session事件、断裂链、未结算Effects、未来Event或无法由冻结定义证明的标签一律失败关闭，不能用`lastFeedback`、Director历史、PRNG游标或`seen`集合猜测发生了什么。

fresh Director v3与历史Director v2的随机事件都是随系统结算原子发生的瞬时结果，不存在可供玩家继续互动的“当前激活窗口”。v3额外要求候选、授权和Replay匹配随机事件的冻结地点；v2仍按原地区级语义读取，不因内存归一获得新地点含义。因此只有精确匹配Director授权、随机证据、冻结事件定义、Narrative表现和成功`effects.applied`终态时，近期变化才能显示“已发生/已结算”；不得显示“正在发生”。若未来要支持持续随机事件，必须新建有版本的`active → resolved/expired`生命周期和对应Event，而不是重新解释旧历史。

读屏播报与持久变化列表分离：初次载入或切换Session先以当前Event head建立基线，只展示历史而不重播；玩家刚执行的Action继续由独立结算回执播报，避免重复；只有同Session基线之后新增、来源为系统且级别为重要或关键的变化进入常驻`role=status`区域。播报内容可以更新，但live-region容器本身不得被替换。Projection与Event可能因独立读取短暂不同步，此时页面保持可用、通知失败关闭且不推进播报游标；事件前缀补齐后仍须正常播报一次，同一head不得重复播报，换Session不得残留旧内容。

该切面只增加纯投影和玩家展示，不新增数据库表、Schema、Context Source、可采纳字段或Release字段。

### 23.10 完整任务日志与任务生命周期实现边界

G4-05继续复用唯一Quest实例账本、规范Event和冻结Release模块。完整日志以主线、重要支线、普通支线、随机任务和历史分类，并可组合筛选状态、期限、追踪、地区及角色/势力owner；详情只投影已经公开的当前/过去Stage、Objective状态、固定奖励预览、随机奖励存在性、已知地点、实际读过的任务相关事实和规范历史。历史Event尚未追上Projection head时，任务正文保持权威可用，但历史区明确等待，不拼接或猜测缺失事件。

新生产链以Action v16+关闭放弃/重接的结构缺口：所有可放弃任务覆盖未开始和逐Stage精确Action；固定普通不限时任务的`restart-quest`只绑定原发布Scene和地点，并以`abandoned → available → revealed → accepted → active(first stage)`四步原子迁移恢复同一实例。限时任务即使被放弃也保留原截止时间，过期Action覆盖`abandoned`；主线、重要故事、模板任务和Director实例不能借该入口重接。终态同步清理HUD追踪并从规范Quest账本重算Director镜像。P8F、P9、P10和V3运行包装配共同验签这些引用，Action v16+必须搭配Quest v2；当前fresh完整治理包再以Action v18增加受保护故事揭示链；缺少新生命周期字段的历史durable Context仍原样恢复Action v15产物。

日志页不会执行Scene拥有的接取、重接、Objective或领奖Action。玩家放弃仍使用统一高风险确认和正式Command/Effect Event；回到原发布场景后的重接也走同一Action Registry、授权、Effect、Event与Replay链。旧v15终态追踪残留在HUD/日志投影层过滤，不篡改历史状态或改变旧事件Hash。任务地点定位只是绑定当前Session的一次性UI请求，只聚焦玩家已知地图，不执行旅行。该切面没有新建表、Schema、Context Source或可采纳字段。

### 23.11 首版玩家地图与旅行UI实现边界

G4-06不建立第二份地图或行程状态。玩家地图由一个纯聚合投影组合现有披露安全地图、普通旅行Action和快速旅行授权：组件只消费该投影，不直接读取冻结模块。未知地点和隐藏道路从结果中完全省略；仅听说地点只提供名称及公开通行信息，不泄露描述、主题、等级、功能或隐藏路径。快速旅行的内部最短路径还必须与已披露道路求交后才能进入玩家视图。

桌面端使用完整尺寸的`1000×700` SVG节点图，区分当前位置、选中地点、听说/到访状态、任务聚焦、道路开闭和已解锁快旅点；地点具有独立键盘语义和至少58px的命中面。点击、Enter或Space只选择地点并高亮当前可见路线，不写Event；玩家必须在详情区显式确认普通旅行或快速旅行。移动端地点列表与SVG共用同一投影和两步操作，不建立另一套旅行入口。地图同时提供已知地区、全部已知道路、预计时间、风险、阻断原因和快旅目的地，提前到达仍只展示Release冻结的安全常态。

选择态冻结当前Session身份和外层`ProductRuntimeState.lastSequence`，不得误用嵌套游戏Projection的事件序号。投影变化后旧按钮禁用并要求重新选择；父运行器在提交瞬间再次核对Session和事件基线。确认后仍只调用统一`executeVNextAction → Action Registry → Effect/Event → Projection`链，普通旅行保持单道路原子抵达，快速旅行保持一次原子结算，不新增多段自动寻路、途中演出或旅行状态机。旅行Promise的回执在地图内按请求代次、Session、Action、目标和基线精确归属；切换Session会作废旧请求并释放提交锁，其他Action的全局错误或旧快旅回执不能串入地图。

该切面仅增加纯投影、响应式UI和既有Action入口的绑定，不新增数据库表、Schema、Context Source、可采纳字段或Release字段。地图选择、路线高亮、任务聚焦、提交中状态和局部反馈都属于Session绑定的临时UI状态。

### 23.12 首版角色、成长、技能与状态UI实现边界

G4-07不建立第二份角色卡或成长状态。角色页只通过一个披露安全的纯聚合投影读取当前Session Projection和其中冻结的RuntimePackage：身份区仅输出玩家可见的姓名、代词、外貌、背景、性格、公开经历和目标，不输出`privateKnowledge`、`portrayal`、来源引用或内部稳定键。现有P10只为NPC生产头像，没有主角头像的显式生产与绑定合同，因此首版使用姓名首字的可访问占位，不得把任意NPC头像或第一件portrait媒资冒充主角；正式主角头像必须在后续补齐独立的player portrait生产合同后再接入。

等级、累计经验、本级进度、生命和技能资源直接来自通过验签的Session；三项属性使用Release配置的世界化显示名，并以该Release的实际初始等级为基线解释逐级自动成长。六项派生战斗值继续调用唯一确定性公式服务，明细只把基础值、当前等级、属性显示名和已装备物品名称交给玩家，不穿透`semanticKey`、`formulaKey`、`sourceKey`或物品键。20级满级、非1级开局、零技能资源上限和旧Action版本缺少战斗冷却字段均有显式兼容，UI不会产生`NaN`、`Infinity`或伪造的成长来源。

技能区按第7.4节展示冻结Release中已学与锁定技能、中文类型/目标、资源消耗、规则冷却、实际剩余冷却和可能获得方式。等级来源可以公开；任务来源只有在对应任务实例已经向玩家发放后才显示任务标题，否则统一为“尚未发现的任务奖励”，不泄露任务、Condition或Effect键。角色页的“技能条件就绪”只表示技能自身的资源、冷却和公开使用条件满足，不等于当前正式战斗Action可执行；是否处于战斗、是否轮到玩家及目标是否合法仍由Action Registry和G4-09战斗界面裁决。旧Progression v1的被动技能只标记为“已掌握的被动技能”，不得声称运行时已兑现；Progression v2的确定性被动修正和战斗状态持续时间、叠层、数值修正由G4-09战斗投影展示。角色页的非战斗`player.statusKeys`仍没有可靠持续时间、来源和叠层合同，因此本页不推测这些字段。

G4-07审查时冻结的技能/战斗债已由G4-09的新生产合同关闭：主动`status/resource/recovery`技能按结构化机制结算，被动技能使用可重放静态修正，`scalingAttribute`和装备`skillPower`进入对应公式，战斗状态拥有生命周期、叠层与数值修正，`cooldownTurns`采用不包含施放回合的统一口径并覆盖1/2回合边界。历史Release仍保持其原有能力，不由角色页伪造升级。该切面没有新增Action、Effect、Event、持久化表、Schema、Context Source或可采纳字段；切换视图与展开明细均不改变时间线。

### 23.13 首版背包、物品详情与装备UI实现边界

G4-08不建立第二份背包或装备状态。一个披露安全的纯聚合投影从已验签Release物品定义、当前Session库存/装备账本、唯一派生数值服务和Action Projection实时形成玩家DTO。页面只展示实际持有物品、总数、类别、数量、安全来源概括、用途、基础价值、公开标签、真实属性修正和保护说明；不输出物品/实例/Action/Condition/Effect/claim键、来源引用或媒资内部引用。背包提供全部及装备、消耗品、材料、任务物品、其他分类，可搜索并按类别、名称、数量和基础价值排序。当前Session尚无可验证的“已读/未读”清除事件，因此本页不把实例的`new`标签伪装成可持续的新物品提示。`skillPower`尚未进入战斗公式时也不声称其已生效。

使用、装备、卸下和丢弃均只提交投影给出的精确Action与物品目标，再次进入玩家壳统一确认、Action Registry、Effect/Event与Replay链。P8F对每件可丢弃非关键物品生成固定一件且`always`确认的丢弃Action；关键物品继续禁止丢弃、出售和材料消耗。运行时仅派生“可移除数量”，将正在占用装备位的具体实例排除在使用、丢弃、出售和再次装备目标之外，不把该数量写入存档。装备/卸下Action分别要求“未装备/已装备”；Release模块解析与物品Action重放共同复核玩家操作者、物品目标、唯一固定Effect和命令目标，而不仅信任生成包或旧Event文本。

恢复品只在对应资源未满时可用；正向`change-player-resource`按实际上限裁剪并在回执记录实际变化量，负向越过零仍失败关闭。装备页固定展示武器、防具、饰品三槽，每个候选和卸下预览均使用唯一数值服务给出旧值、新值、差值及方向，资源上限降低或提高导致当前生命/技能资源调整时显式警告，不只靠颜色表达。基础价值不是成交价；本页只说明是否可售及需前往商店，商人、数量、关系价格和交易回执由G4-10专用UI负责。

页面在桌面与移动端共用同一投影，筛选、选中和视图切换都是Session绑定临时UI状态，换档必须重置。页内动态回执只接受同Session且精确命中本页最近`action + target`请求的安全表现，不串入地图或任务回执。旧Release没有丢弃Action时保留原义只读，不临时伪造可执行入口。该切面没有新增数据库表、Schema、migration、Context Source、可采纳字段或`PROJECT_TABLES`登记。

### 23.14 首版逐回合战斗UI实现边界

首版战斗页不是给场景卡片增加几个按钮，而是当前Session进入战斗后接管主要交互区的专用运行界面。界面只开放已经登记的普通攻击、技能、战斗道具和逃跑四组操作；单体敌对行动必须由玩家显式选择仍存活的目标，不能自动代选第一个敌人，也不能把自由文本解释为战斗招式。每项操作同时展示资源消耗、冷却、持有数量及经过披露清洗的不可用原因。桌面与移动布局必须拥有等价操作能力、键盘焦点和屏幕阅读器播报。

战斗显示由一个只读聚合投影统一生成。输入仅包括冻结RuntimePackage、当前Session投影、截至投影头的同Session规范事件、完整Action Registry结果及经校验的检查点；界面不得读取隐藏敌人定义、随机种子、内部key、Condition表达式或尚未落盘的预期奖励。战斗日志只从`Command -> Random* -> Effects`闭合批次及其授权和实际Receipt生成，展示实际伤害、治疗、资源恢复、状态变化、消耗和终态；胜利奖励只显示已由独立系统命令实际领取的数值与物品，不能用RewardContract预告冒充结算。

结构化战斗机制采用严格的`Action v17+ + Progression v2 + Combat v4`三联合同；当前fresh Knowledge受治理发布使用Action v18，完整继承v17的战斗语义：

- 主动机制分为attack、recovery、resource和status；被动机制只允许确定性的静态战斗修正，不形成可点击Action；
- 玩家技能按技能自己的`scalingAttribute`读取力量、体质或敏捷，装备`skillPower`只计入一次；普通攻击仍使用派生attack；
- recovery和resource首版只以行动者自身为目标，并按当前上限记录请求值、实际值和裁剪结果；
- status拥有目标回合或整场战斗两种时钟，以及reject、refresh、stack和`maxStacks`规则；持续N回合指状态施加后目标接下来完成N个自身行动才到期，其他战斗员回合不消耗；
- 状态和被动只可通过白名单flat modifier修改attack、defense、skillPower和暴击基点，叠层乘数与到期清除均由确定性代码计算；
- `cooldownTurns=N`不包含施放当回合，阻断行动者接下来的N次行动机会，在边界后的下一次行动恢复。

每次行动仍进入统一Action、EffectPlan、Event和Replay链。Combat v4授权冻结结构化伤害、治疗、资源、状态及到期结果；应用和重放时用当前基线重新推导并逐字段复核。浏览器在Command已提交但Effect未完成时恢复原命令和已有随机前缀；在玩家Effect已完成但自动战斗、任务或Director后续尚未完成时，根据持久Command/Effect账本和稳定cause标记续跑。战斗胜利奖励、任务结算和地区发牌都必须幂等，重复刷新不得再次发奖、推进或抽牌。

历史Action v10/v11～v16与Combat v2/v3仍按各自冻结规则重放；缺少可验证数值结算的更旧战斗在新界面明确只读，不补造敌人生命、回合、日志或奖励。本纵切面不增加物理表、Context Source或AI正式写入口；结构化技能与状态由P8语义候选经过确定性编译和P8F绑定进入Release，运行状态继续只归Session与ProductRuntimeEvent所有。

### 23.15 首版制作、商店与交易UI实现边界

制作与交易不是背包页上的临时加减按钮，而是消费已经冻结在Release中的Crafting v2、Economy v2与Action v12/v13以上合同的专用玩家界面。首版仍保持移动端五项主导航：制作和商店进入“更多”页，与背包并列而不新增第六项底栏。制作区提供已知配方、匿名锁定项、可制作/材料不足筛选、材料持有与所需数量、产物、耗时、批量数量和最大可制作量；商店区只显示玩家当前位置实际可用的服务，提供购买/出售、货币、有限或无限库存、单价、总价、商人倍率、关系倍率、最大数量、装备比较和不可出售原因。

页面只消费一个披露安全的纯玩家投影。投影以冻结RuntimePackage和当前Session Projection为输入，把Crafting/Economy目录与当前Action Projection、地点、Actor存活/在场/日程服务、三档关系、背包与装备状态相交；不把完整目录、Condition表达式、远端商人、远端库存或未发现配方内容直接交给组件。Action、Recipe、Vendor和Item稳定键只能作为不可渲染的不透明提交字段随精确请求传递，不能进入界面正文、公开错误或清洗后回执的可渲染文案。没有正式发现合同的未学习配方只显示不带名称、材料、来源或解锁条件的通用锁定占位；材料来源没有玩家知识证据时只说明尚未发现。Crafting v1或Economy v1只能显示明确的只读兼容状态，不能由新UI补造执行语义、价格或可制作数量。

所有制作和买卖必须从投影给出的精确Action生成一次性请求：

```text
Session ID + Action Key + Recipe/Vendor Target + Item Key? + Quantity
+ ProductRuntimeState.lastSequence
→ 本地摘要确认
→ 实时身份和Action重新投影
→ Store统一执行桥
→ Command / Authorization / EffectPlan / Event / Replay
→ 同请求的披露安全回执
```

摘要确认冻结玩家当时看到的材料、产物、耗时、库存、单价、总价和关系说明，但不能代替运行时授权。确认提交前必须重新读取当前Session、完整事件基线和相同Action/目标/商品；任何跨存档、价格、关系、材料、库存或时间变化都拒绝旧请求并要求玩家重新选择，不能静默按新价格成交。组件不直接修改货币、背包、库存或世界时间，也不自行补发制作后天气、NPC日程、任务或Director事件；这些后续仍由统一Action执行与恢复链结算。

页内结果只接受本次Promise返回且完整命中`session + base sequence + action + target + item + quantity`的回执。实际变化必须从规范Authorization与Event清洗为世界化名称和数值，不能渲染原始Effect摘要中的Recipe、Vendor、Item或Claim键，也不能用确认预览冒充已经制作或成交。切换Session必须清空页签、筛选、选中项、数量、确认和旧结果；同Session事件基线变化必须撤销尚未提交的确认并重置数量，但本次正式操作自身推进基线后，完整命中的终态回执可作为“上一次操作结果”保留。取消确认只关闭未提交摘要，不擅自改动玩家已选商品。首版不对未知结果隐藏自动重发；底层已支持同一commandId幂等查询和续结，其玩家可见恢复入口归G4-14统一错误恢复界面收口。

首版不引入服务购买、制作货币费用、定时补货、动态地区供需或AI临场定价，因为这些尚无正式运行合同。该纵切面不新增物理表、Schema、migration、Context Source、可采纳字段或`PROJECT_TABLES`登记；配方、物品、商人和价格规则归Release，已学配方、材料、货币、有限库存及时间归Session/Event，页签、筛选、选择、数量与待确认摘要才归前端临时状态。

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

来源页已经以独立的文字开放世界创作者入口落地，不再复用通用文字游戏生产表单。它同时支持两条受治理来源：一条从中立`WorldReference`目录选择精确的冻结`WorldRelease`，展示版本、完整Hash、能力、资源和预检缺口；另一条从独立小说Work选择整部、卷、章节范围或自定义章节，展示正文/大纲覆盖、规模以及与正式P0冻结完全相同算法计算的`sourceVersionHash`和`sourceBoundaryHash`。世界和小说来源各自携带明确`WorkspaceScope`，允许小说入口在没有世界工程时成立，`worldGroupId`只负责路由与重置，不能冒充数据owner。

这个页面仍属于“确认来源”的第二阶段：目录与预览只读，不创建Production、Brief、Build、SourcePin、Ledger、GapReport、Release、Session，也不触发模型读取、计费或生产。预检缺口只是目录可见性的候选判断，不能冒充P1实际逐项读取后的GapReport。交给下一阶段的临时候选必须携带精确来源身份；正式冻结时以WorldRelease `releaseHash`或小说两枚预览Hash进行compare-and-swap，来源在确认后变化就失败关闭并要求重新确认。旧WorldRelease生产调用也必须从已授权Brief派生相同版本证据，不能只信任本地记录ID。

来源确认后的专属Brief页已经落地。进入该页时才以稳定产品实例键创建统一`ProductProduction`，并把WorldRelease或小说选区的本地locator、便携来源身份与Hash同时固化在生产根；重复点击、刷新和React StrictMode并发只能得到一条会谈及一个来源起点。作者可以编辑主角模式、玩家体验、核心目标、来源保留/推演/禁改边界、未决问题、内容规模、最低媒资和完成条件；首版有边界自由、顺序主线、多结局、关键对象保护、四操作回合战斗和标准难度等能力边界由代码只读提供，模型与作者都不能改写。

主Agent是可选理解辅助，不是生产启动器。它只能通过登记的正式入口和Skill读取作者表单、固定边界及G5-01的无正文来源摘要，每次尝试保存ContextManifest，协议错误最多修复一次；未配置Key时，作者人工填写仍会形成同一类可审计候选Run。正式确认必须同时满足四项显式确认、零未决问题、来源Hash再次复验，以及候选、ContextManifest、Run binding、步骤输出和终态receipt的一致性，随后才新增不可变`ProductProductionBrief`修订并把Production推进到`brief-ready`。此时依然没有Build、SourcePin、Release或Session；只有后续专属Creator启动命令才能把Creator Brief提升为正式生产计划和来源授权，旧通用Brief命令不能旁路。

Creator Brief自身只保存可移植来源身份和稳定Run binding；所有本地主键位于注册表治理的locator列，并在项目导出导入时严格重映射。导入会在事务前复核Brief行、Production、来源owner、候选Run事件投影及ContextManifest链；项目范围重绑后原终态receipt按Harness规则显式stale，但不可变Brief证明仍可随项目再次迁移。备份整体仍遵守项目现有的非签名本地备份信任边界，不把可重算Hash描述成外部签名。

Creator Brief确认后的G5-03生产准备页复用全局AI配置、任务路由和凭证存储，不另建Key输入、表或导出字段。`product-production`已正式归入creation路由，因此页面与后续模型调用解析同一个任务预设。预检只把`provider + model + endpoint origin + 规范基础路径Hash + credential mode + 非敏感生成参数`组成模型绑定；URL用户名、密码、查询和fragment会令准备失败，基础路径只进入不可反显Hash，Key只参与“当前是否存在以及来自会话、浏览器记住或本地免Key”的判断，绝不进入DOM、Hash、Artifact或项目备份。远程端点必须为HTTPS；只有localhost、127.0.0.1或`::1`上的Ollama/custom服务可以使用HTTP并在无Key时声明本地token零费用。

价格快照按provider、精确已复核model与注册的官方商业端点共同匹配；中转站、同域不同基础路径、同名模型或未复核后缀一律不能套用目录价。目录没有明确条目时，作者必须录入非负、非同时为零的USD报价、短来源说明和核对日期；本地零token费用也必须显式选择，并说明不含硬件、电力和托管成本。界面把完整生产的155次建议模型调用、160次硬上限、120万输入token、36万输出token、30美元文本估算保护、2小时和200MB资源边界绑定为可校验Hash；这些都是单Build授权上界，不是实际账单。头像、背景等媒资在G5-08形成实际排产前不进入本次金额。已发生的Creator Brief会谈只展示真实请求数、provider回传或本地估算token、耗时及按已知价格推算的费用，并明确后者不是provider账单。

作者逐项确认凭证政策、模型绑定、报价预算和媒资边界后，准备页只得到内存中的确认Hash，仍不创建Build、SourcePlan或任何费用。运行时Verifier不把可重算Hash当成外部真实性：确认时必须重新解析当前任务路由、AIConfig和实际凭证来源，并逐字段比对Brief、模型、端点路径Hash、报价、预算与四个精确确认键；设置页往返也携带无密钥的精确会谈、产品和来源身份，目标失效时不得误选“最近会谈”。正式启动在同一原子授权边界重新读取并CAS这些事实，不能把页面内存确认当作durable授权。全局AI日志在create/update/read/format四个出口统一脱敏：日志URL只保留HTTP(S) origin，调用方Key、认证头、常见凭证字段和嵌入式URL敏感部分全部清除；余额、欠费、授权、限流、超时、网络和未知结果只显示安全分类与显式恢复动作，不把原始供应商响应送入页面，也不隐藏重发。

G5-04已经落地专属Creator生产启动。作者先选择`author-owned`、`licensed`或`public-domain`权利依据并填写说明；零写入预览把当前Creator Brief确定性投影为不含本地ID的便携Creator SourcePlan、共享scheduler兼容执行Brief和精确动态DAG，显示依赖、并行组、模型、预算、完成条件及Plan Hash。兼容Brief中的`worldReleaseId=1`是非定位占位值，真实读取只允许走专属SourcePlan与注册表治理的locator。正式开始再次核验Production state revision、Creator Brief revision/Hash、WorldRelease或小说版本与边界、当前AI任务路由/凭证来源、规范完整route、生成参数、模型绑定、报价、预算、四项确认和预览Plan Hash，并让实际模型调用复用同一份已核对resolution，避免下层二次解析发生TOCTOU。覆盖Production、Brief、Command、Build及来源存储的同一事务写入命令claim/receipt、授权Brief的Creator SourcePlan和Creator Start、不可变Plan与授权Build，再推进Production为`producing`。这个边界不调用provider；相同确定性command ID重放只读取已冻结receipt，不重建授权。Creator Brief仍是作者意图权威，`ProductProductionBriefV3`只是共享scheduler兼容投影，不能反向覆盖Creator Brief。

启动成功后，专属工作流把精确`productionId`交给`productionOnly`工作台；不展示通用新建/最近Production回退，锁定ID不存在、被过滤或失效时停止队列并明确报错。每个任务显示依赖、lane/并行组、最大尝试、超时、当前step/attempt、尝试历史、最新durable边界、checkpoint验证状态、stale原因和预算实耗；scheduler同时以必需receipt和subject lock计算真正可运行集合。P1来源批次和P9场景分片通过登记的有界多调用协议执行，只重跑未完成分片；响应先计账再解析，作者P9聚合稿不调用模型。pause/resume先持久递增control epoch，旧执行者不能继续写入；新epoch只重绑control epoch并复用已验收Artifact，冻结DAG、预算与Creator Start字节不变。同一Build/task的paid charge与结果未知reservation跨Run/epoch累计，恢复不能重置调用、token、费用、时长或存储；durable请求标记之后、真正调用executor之前再次复核当前Production/Build，跨标签页pause/stop不会越过本地可阻止的dispatch边界。v10备份则在导入事务前验证SourcePin/Unit payload、contentHash、owner和闭包，并重映射通用SourcePlan内嵌locator。媒资费用仍由G5-08实际排产，本次Creator Start保持`mediaCostAuthorized: false`。

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

恢复必须按最后一个durable付费边界裁决，而不是把所有失败都归为“再试一次”：claim后尚未开始step时复用同一Run；step已开始但尚未派发且超时时可以同attempt安全恢复；请求已派发但结果未知时保留预算预留并停机，绝不自动重发；provider响应和真实usage先计账，后续解析、验证或证据失败也不能抹掉已付调用；候选checkpoint尚未形成时同样停机，已验证候选checkpoint才可直接恢复验收或下游调度。task预算在同一Build内按task key累计全部历史charge与保留reservation，下一attempt只能使用扣减后的剩余额度。UI必须把这些状态、最新边界及明确恢复动作呈现给作者。

任何恢复命令都绑定原失败Run/rootRun、control epoch、Plan Hash、task key和attempt，不能借“当前失败任务”松散定位。重试前先递增epoch，保留既有charge/reservation账本并复用已接受Artifact。作者修复说明只通过登记的可选`product-production.repair-feedback`来源以隔离、不受信任数据交付；作者完整JSON跳过本次provider调用但仍经过同一解析器、验证器和候选checkpoint，并记录作者来源、零模型调用与零token。两种作者修复只开放给精确登记的P2～P10单次文本创作task/Skill组合；P1有界多调用协议、V2评审、确定性任务和媒资任务只允许按原冻结输入重试。Production或epoch变化时，页面必须清除尚未提交的本地修复输入。

### 24.5 G5-06受治理内容修改实现边界

内容表的编辑能力以G5-05当前Build快照为入口，但正式owner仍是不可变Artifact与生产Build，页面没有正式写权限：

- 首版只开放P2～P10中19个作者可修复领域任务产生的29类Artifact。领域模块各自声明可编辑标量/字符串数组、作者投影及完整重建函数；稳定ID、集合和顺序、引用、来源、治理及Run字段不能修改，也不提供任意JSON或路径写入；
- 直接编辑不调用模型；Agent编辑只读取登记Context和作者指令，并用intake冻结的Skill、Formal Entry与完整模型身份最多派发一次。两者都形成同一种候选信封，保存原始值、patch、重建结果、领域验证、identity/reference delta和费用边界；
- 作者可对候选继续作确定性修订、拒绝或确认。确认在事务内复核Product/Production/Build、Artifact字节、候选revision/Hash、Run头及冲突组，只形成不可变影响分析交接；当前Build、Artifact、正式Product表和玩家运行包保持不变；
- 已知模型失败、已派发结果未知、未派发取消、候选替换、刷新恢复、跨目标冲突和确认意图都拥有显式状态及恢复动作。刷新不自动调用模型；unknown不自动重发；同一owner sibling group在任何目标上存在unknown或已确认意图时均失败关闭；
- G5-07必须以交接单为唯一作者授权，计算下游stale闭包并创建新修复Build。G5-06不能借“编辑完成”原地重写当前Build，G5-07也不能把裸UI patch当成生产输入。

### 24.6 G5-07引用影响与局部修复实现边界

G5-07把G5-06已确认交接提升为新的、可执行且可审计的ProductBuild，而不是在原Build上改一行内容：

- 影响预览只接受当前`preview-ready` Production上的完整Creator封存Build。它先复用G5-05的完整生产验证，重算Plan、manifest、root Run、全部task Run/event/checkpoint/receipt、Artifact/Blob和跨Build lineage；只伪造`release-ready`状态或根Hash不能进入修复。预览前后还逐字节比较Production、Brief、Build、全部Artifact、编辑Run/evidence和历史修复命令，读集漂移即要求重算；
- 修改目标只能来自未消费的`impact-analysis handoff`。同一owner task只能有一张交接；同批目标不能互为祖先/后代，避免下游候选建立在同批将被替换的上游之上。完整owner sibling group必须随交接进入新Build，但允许未被本次编辑触及的siblings保持字节和Hash不变；至少目标内容必须真实变化；
- 唯一代码实现的DAG传递闭包同时服务质量评审和Creator修复。目标task计入stale，全部后代按冻结Plan顺序进入重跑集合，其余task进入逐项复验的reuse集合；UI分别展示直接采用、下游重跑、可复用任务及模型、媒资、token、费用、耗时和存储上限，作者必须二次确认施工范围；
- 正式`authorize-text-open-world-creator-repair`命令在一个事务中CAS预览Hash与完整读集，创建紧邻的不可变子Build、冻结目标Plan/影响授权、原子暂存完整确认siblings，并把Production切回`producing`。重复command幂等回读；stale预览、并发Build号、来源/命令/候选漂移均零部分写入失败；
- 目标task不再调用模型或外部执行器。scheduler把已暂存内容作为零费用工具结果，仍生成新的child Run、source-snapshot、tool call/return、candidate checkpoint、验收receipt和accepted Artifact；在checkpoint后崩溃可由同一Run继续，不能重复采用或计费。其余stale后代走原冻结Executor正常生成与验证；
- 未受影响task只能从直接父Build按完整terminal v2证明跨Build携带，并逐task重新生成零调用receipt；这一规则也覆盖P0等确定性task，不能因`executionMode=deterministic`跳过依赖证明。修复链逐级绑定全部授权命令，任一历史命令、base sibling、reuseKey或staged candidate被篡改都会使后续执行失败关闭；
- 原Build、旧ProductRelease和现有Session始终保持原字节。修复Build完成后仍须经过G5-09质量/试玩和G5-10正式发布；本项复用既有Production、Brief、Command、Build、Artifact、Run、checkpoint和ledger生命周期，没有新增物理表、Context Source、AI写字段或世界引擎回写。

### 24.7 G5-08 Creator媒资生成、导入与权利边界

G5-08把P10的媒资需求接回正式Creator Build链，而不是在页面上给当前运行包替换图片：

- 入口只接受当前`preview-ready` Production中已通过完整G5-05封印的最新Creator Build。系统从冻结P10 `MediaRequirements`和`media.visual`输出精确提取一个地区场景背景、一个角色头像组成完整sibling group；程序地图继续使用已验证的SVG代码资产，首版不排产音频并保留明确静音降级；
- 作者导入模式要求所有视觉槽一次完整覆盖。浏览器读取真实文件字节，仅接受PNG、JPEG或WebP，复核MIME、尺寸、byte size和SHA-256后写入产品私有内容寻址Blob；候选同时冻结alt、来源、许可、`author-owned/licensed/public-domain`权利依据和权利说明。导入不调用模型、不产生媒资费用，也不能混入Provider参数；
- AI生成模式复用全局已配置的Agnes或可信图片Relay，冻结requirement、adapter、binding和回执Hash以及严格为正的本次费用上限；预览不派发图片请求。正式执行仍走共享media executor、usage账本和失败恢复，不能由页面或task override绕过Provider身份；
- 两种模式都从官方DAG唯一计算`media.visual`及其传递后代为stale，其余task逐项跨Build复验。UI展示槽位、覆盖、Provider、费用和重跑预算，四项显式确认进入严格命令合同；正式命令在事务外完成物理Blob验真，在事务内CAS Production、Brief、base Build、全部Artifact、Blob信封及历史Creator派生命令，随后原子创建紧邻子Build；
- 作者导入的`media.visual`在scheduler中作为零调用工具结果进入新的Run、candidate checkpoint、验收receipt和accepted Artifact；V3运行包装配与QA按原链重跑。命令重放只读取durable receipt，不再次依赖本地Blob定位器。任何Blob、Plan、来源、权利、候选或命令链漂移都失败关闭；
- 旧Build、ProductRelease和Session不变，新媒资Build仍只是受治理Preview候选。MIME、Hash、权利声明和合同覆盖通过不等于美术质量通过；审美、一致性、可读性和试玩效果由G5-09质量/灰盒试玩继续裁决。

### 24.8 G5-09发布质量、隔离灰盒与问题证据

G5-09是当前不可变Creator Build进入发布命令前的独立质量层，不重复生产期V1/V2/QA，也不把作者勾选伪装成运行证明：

- 入口重新解析Creator派生授权、完整Artifact治理快照、Build QualityReport、全部QA硬门以及平衡/叙事评审Artifact自身Hash。Schema、引用、权利、运行包装配、可玩性和模型阻断finding均为不可豁免硬门；70～84分的模型建议仍可通过，但作者必须逐项记录本版接受风险的理由；
- 灰盒候选只来自当前Build Preview创建的`text-open-world` Session，必须绑定精确packageHash且没有ProductRelease来源。系统重放连续Event、核对规范状态头和有效Checkpoint，组合覆盖主线结局、受治理Action、世界探索、战斗、成长/经济与刷新恢复六类证据，并至少有一个Session真正完成主线；作者还须确认引导、叙事、媒资降级和问题登记；
- 灰盒与问题凭据存入现有`productQualityGateReceipts`。便携证据只保存Build Hash、稳定Action/结局键、事件流/状态/Checkpoint Hash和环境，不保存Session本地ID、世界原文、玩家输入、完整事件正文或内部Prompt；
- 作者可登记带前置条件、复现步骤、预期/实际结果和稳定受影响键的问题。阻断问题不能豁免，只能通过G5-07生成新Build；非阻断问题可逐项绑定明确理由。相同问题以指纹幂等，跨Build、跨Work、篡改或碰撞失败关闭；
- 最终质量结论由确定性代码联结当前Build、治理快照、硬门回执、作者语义抽检、灰盒回执及完整问题/豁免集合，并在同一事务CAS全部权威行。新增问题、替换Build、Artifact漂移、回执被改写或集合变化都会使旧结论立即失效；G5-10只能消费这一份当前通过回执，不能根据UI状态或旧QA结果旁路发布；
- 该能力属于文字开放世界产品生产私域，不新增物理表、Schema、Context Source或AI写字段，也不修改WorldRelease、正式Release或玩家Session。质量通过表示证据满足首版发布门，不等价于作品已经达到固定文学或审美水平。

### 24.9 G5-10 Creator装配发布与不可变ProductRelease

G5-10复用共享`productReleases`、正式媒资表和原子发布事务，但不再把Creator兼容执行Brief中的占位`worldReleaseId`当成真实来源：

- 发布准备从当前`release-ready` Creator Build重新读取Creator Brief、专属SourcePlan/Start、已接受SourcePin整包、P1 SourceManifest、全部当前Artifact、V3 IntegrationReport、G5-09最终质量回执、root Run与terminal v2读集。世界来源重新绑定精确本地WorldReference；小说来源只验证产品私有SourcePin整包可用，并把`ProductRelease.worldReleaseId`写为`null`；
- Creator Release来源合同携带便携Brief、SourcePlan、Start、SourcePin索引、实际读取清单、完整Artifact receipt集合及集合Hash、装配报告、治理快照、最终质量回执和作者发布授权。小说正文继续只存在SourcePin Unit Artifact中，不复制进Release manifest；本地行ID和原始授权nonce不进入便携合同；
- 共享Release外层的`sourceWorldRelease.contentHash`仅保留为现有运行包的来源内容Hash坐标。真正来源种类、版本、边界和血缘由Creator专属source contract与中立lineage持有，小说不会伪造WorldReference；旧共享WorldRelease Release仍使用原合同和reader；
- 创作者面板展示下一版本、Build/RuntimePackage、SourcePin、SourceManifest、Artifact集合、装配报告、治理快照、质量回执和媒资数量。作者须分别确认来源权利、Build/质量、不可变规则和立即发布；一次性授权Hash绑定当前adoption intent、Build manifest、RuntimePackage、G5-09回执和发布名称；
- 正式提交继续使用共享事务，对Production、Brief、Build、全部当前Artifact、全部质量回执、terminal读集和物理Blob做最终CAS；随后原子创建不可变ProductRelease、固化Release媒资、回写Build/Production并保存幂等命令回执。任一权威行、Blob、来源、问题或质量证据漂移均零发布失败关闭；同一成功命令可安全重放；
- ProductRelease reader在创建Session或读取包时重新验证Creator合同自身Hash、来源链、消费槽、Artifact receipt、装配报告、质量、作者授权、release identity和lineage。世界与小说两种正式Release均可启动同一文字开放世界Runtime；旧Build、旧Release和既有Session不被改写。G5-11已允许作者从当前已发布Creator Build修改受治理内容、创建紧邻子Build并重新完成媒资/质量/发布链；兼容报告和玩家迁移仍以新旧不可变Release为唯一输入。

本项没有新增表、Schema、Context Source或AI写入口，也不向WorldRelease或小说源作品回写。发布证明当前冻结内容满足既定证据门，不对文学或美术质量作永久保证。

### 24.10 G5-11 新Release、兼容报告与存档迁移

发布后的Creator Production不另造通用Brief或第二套演化系统。作者仍在当前Release对应的受治理Artifact上使用G5-06修改入口；G5-07影响闭包现在允许当前已发布Build作为不可变基线，新子Build的`sourceProductReleaseId`精确指向该Release。子Build完成后重新经过媒资、质量、作者授权和G5-10发布，因此版本维护与首次生产共用同一套Artifact、DAG、Run和Release事实源。

兼容报告以稳定状态语义为准：运行契约、初始变量、叙事节点/选择条件与Effect、全部状态模块的schema/hash/dependency都会参与比较；文字开放世界Presentation模块只把schema与依赖纳入状态稳定键，其文案、地图布局和媒资内容Hash可作为表现更新。删除或改变任一既有状态稳定键仍为`breaking / pin-old-save`，仅新增稳定键或纯表现变化才是`compatible`。玩家端不会仅相信lineage文字声明，迁移预演会再次对两个已核验Release的RuntimePackage计算同一报告。

迁移只支持活动中的正式vNext Session，并要求目标是当前Release的直接兼容子版本。预演从规范事件流读取精确序号和状态Hash，把玩家进度迁入目标Release的冻结叙事定义与RuntimePackage后运行完整解析验证，同时展示等级、地点、任务和世界时间摘要。正式提交重新计算预演并用Session、事件头、源Release和目标Release做事务CAS；成功时只创建一个事件序号从0开始的新子Session，`parentSessionId/parentThroughSequence`指回原时间线，便携迁移计划与preview Hash写入新Session的Canon快照。原Session、原事件、原Release和其它分支逐字节不变；预演过期、跨Work、Build Preview、旧混合包、非直接版本或语义不兼容均零写入失败关闭。

该纵切面复用`productRuntimeSessions`父子关系、现有Release和事件生命周期，不新增表、Schema、Context Source或AI写字段。它只保证受支持的状态语义兼容与可回退分支，不声称能自动迁移任务状态机、数值规则、删除/重命名ID或任意剧情结构变化。

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

- 来源WorldRelease/小说选择、Creator SourcePlan、后续SourcePin和对应Hash；
- Creator Brief版本、Creator Start Hash、权利依据和用户授权；
- 生产DAG/Plan Hash、Skill/模型绑定、报价和预算；
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

### 27.5 当前P10与质量门实现

当前实现已经把抽象发布要求落实到生产Artifact边界：P2 `PresentationProfile`冻结三类交互、四类战斗操作和18个UI消费槽；P10 `SystemFinalize`完整验签17件上游，由代码生成15个运行模块配置、全部必需视觉媒资槽/降级策略和区分“作者内容库存”与“玩家单次可达内容”的时长预算。模型只能补表现语言和媒资创意简报，不能增删模块、消费槽、媒资槽或数值预算。

V1确定性预检必须先通过Schema、Hash链、引用、可解性、预算和消费槽六类检查，V2平衡/语义评审才可运行。评审问题不会原地修补已验收Artifact；代码把每项问题映射到唯一生产任务，并按正式生产DAG计算传递stale闭包，在同一Production中新建修复Build。修复后重新执行预检和双评审。静态时长预算只能证明规划合理，仍不能冒充真人游玩时长证据。

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
| 1.1.61 | 2026-09-13 | 完成G5-11发布后版本维护与存档迁移：已发布Creator Build可作为不可变修改基线，新Build精确继承来源Release并复用原生产、质量和发布链。兼容报告比较运行契约、初始变量、叙事与状态模块稳定键，只有直接兼容子Release可进入状态级复算；迁移预演重放当前事件、安装目标冻结定义并验证完整投影。正式事务CAS源Session、事件头和双Release，只创建绑定新Release且事件从0开始的子时间线，旧档、旧事件、旧Release和其它分支不变。真实Chromium已覆盖显式预演、确认迁移、切换新版本、保留旧分支与刷新恢复。 |
| 1.1.60 | 2026-09-13 | 完成G5-10 Creator正式发布：专属双来源合同封印Creator Brief/SourcePlan/Start、SourcePin索引、P1实读清单、完整Artifact receipt、V3装配、治理快照、G5-09质量与作者授权；小说正文不进Release且`worldReleaseId=null`，世界来源重绑真实locator。共享事务最终CAS全部权威行、terminal读集与物理Blob并原子固化Release/媒资/幂等命令；专属中立lineage不伪造WorldReference，reader完整验签后两种Release均可启动正式Session。 |
| 1.1.59 | 2026-09-13 | 完成G5-09发布前质量层：复验当前Creator Build授权、Artifact治理、QualityReport、QA硬门与双模型评审；硬门/阻断finding不可豁免，建议finding和非阻断问题逐项说明。灰盒只从Build Preview真实Session的连续事件、状态头和Checkpoint生成，覆盖主线结局、Action、探索、战斗、成长经济及恢复；便携凭据不含本地ID或原文。最终质量回执事务联结硬门、作者抽检、灰盒与完整问题集合，新问题或证据漂移自动使旧结论失效，G5-10必须显式消费。 |
| 1.1.58 | 2026-09-13 | 完成G5-08 Creator媒资纵切面：P10精确视觉槽形成背景+头像完整sibling包，程序SVG地图和静音音频降级保持确定性；作者导入验真真实PNG/JPEG/WebP字节、尺寸、Hash并冻结产品Blob、alt、来源、许可和权利依据，AI生成冻结当前可信图片Provider及正费用上限。统一影响预览和四项确认经严格命令/CAS创建紧邻子Build；导入目标零模型但保留Run/checkpoint/receipt，生成目标走正式media executor，V3/QA重跑、其余任务逐项复验。旧Build/Release/Session不改，结构与来源通过不冒充美学质量。 |
| 1.1.57 | 2026-09-13 | 完成G5-07引用影响与局部修复：G5-06确认交接经G5-05完整封印验证与前后读集CAS形成唯一影响计划；代码按冻结DAG计算目标、传递stale和逐项复验reuse，禁止同批祖先/后代目标并允许未改siblings原Hash携带。作者二次确认后，正式命令原子创建紧邻子Build、暂存完整siblings并冻结便携授权；目标以零provider工具结果进入新Run/checkpoint/receipt，崩溃可恢复，下游按原Executor重跑，确定性P0等未受影响task也必须获得新的跨Build复验receipt。旧Build/Release/Session不变；篡改历史修复命令、base sibling、reuseKey、staged candidate或预览读集均失败关闭；未新增表、Context Source或AI写入口。 |
| 1.1.56 | 2026-09-12 | 完成G5-06直接编辑与Agent修改双入口：当前官方生产验证Artifact按19个领域任务、29类Artifact投影受限作者字段并完整重建owner sibling group；直接路径零模型，Agent路径走登记Context/Skill/Formal Entry并冻结完整模型身份。两条路径统一产生durable候选，经原生解析、领域验证、identity/reference delta和同组冲突门后，可由作者修订、拒绝或确认。确认只形成不可变impact-analysis handoff，不改当前Build、正式表或运行包；结果未知不重发，未派发可零费用取消，跨目标冲突、替换谱系、刷新恢复及Product/Build事务CAS均失败关闭。G5-07承接影响闭包和新修复Build。 |
| 1.1.55 | 2026-09-10 | 完成G5-04专属Creator生产启动、进度与恢复：零写入预览生成不含本地ID的Creator SourcePlan、兼容Brief及精确DAG；正式开始重验Production/Brief/来源、完整模型route与参数、报价预算、确认及Plan Hash，并原子冻结Creator Start、Plan、Build与命令receipt。工作流只打开精确Production，目标失效即失败关闭。P1/P9以登记的有界多调用协议按分片恢复，响应先计账再解析；同一Build/task跨Run/epoch累计paid charge和未知reservation，executor前重验当前所有权，跨标签pause/stop不产生本地可阻止的付费派发。恢复绑定原Run、epoch、Plan及attempt，作者修复只开放给白名单文本任务；v10导入写前验证SourcePin闭包并重映射通用SourcePlan locator。媒资费用仍后置G5-08；未新增物理表、Schema或迁移。 |
| 1.1.54 | 2026-09-09 | 完成G5-03生产准备纵切面：确认Brief进入无写入的BYOK/模型/报价/预算页，复用全局凭证与正式creation任务路由；模型绑定保存安全origin与不可反显路径Hash，确认时再以当前路由和凭证来源作外部真实性比较。内置价仅适用精确复核model及官方商业端点，中转、同域异路径、远程HTTP和URL内嵌凭证均失败关闭；作者报价和严格本地零费用形成独立快照。界面显示完整DAG 155/160次调用、120万/36万token、$30文本、2小时/200MB硬保护及媒资费用后置边界，并展示Brief真实用量与非账单估价。设置往返精确绑定会谈/产品/来源；四项确认仍为内存事实，G5-04必须CAS并原子授权。中央AI日志清除Key、认证头及URL敏感部分，供应商错误只暴露安全分类和恢复动作。 |
| 1.1.53 | 2026-09-09 | 完成G5-02专属主Agent会谈与Creator Brief：真实双来源选择进入统一Production/Brief生命周期；完整可编辑作者表单、代码冻结产品边界、可选正式AI入口与有界修复、无Key人工durable候选、四项确认/零未决/来源CAS/终态证据门全部落地。确认只推进`brief-ready`且G5-04前拒绝授权；刷新和StrictMode并发保持单一会谈。来源locator、Brief与candidate Run支持严格导出重映射、事务前RunContract Hash及逐事件世界组校验、导入事件重放和二次迁移，并明确非签名备份信任边界。 |
| 1.1.52 | 2026-09-09 | 完成G5-01独立创作者来源入口：文字开放世界从通用文字游戏生产表单拆出，提供冻结WorldRelease与受治理小说双入口、独立owner scope、精确版本/Hash、能力目录、资源范围和预检缺口；小说预览不返回正文，并与正式P0复用同一快照/分片/Hash算法。来源确认阶段零Production/Build/SourcePin/Release/Session写入、零模型读取和计费；世界与小说正式冻结均以已确认Hash做CAS，旧生产路径从授权Brief派生版本证据。小说-only与旧WorldRelease精确选择真实浏览器路径、通用文字冒险兼容路径及27项关联回归通过。 |
| 1.1.51 | 2026-09-09 | 实现G4-13渐进式教程合同：教程进度限定为按作品和Release/Preview通道隔离的浏览器本地表现状态；系统与Presentation作者步骤只在当前页面、选中场景、真实可见Action及就绪战斗首次出现时逐项披露，每周期最多一项并随目标失效清理。帮助中心支持跳过、暂停恢复、重看和重置，冻结内容经白名单、有界兼容诊断且不泄漏；离屏定位、live region、焦点、高对比、层级和移动长文滚动完成收口。vNext/legacy共用同一Coach，无独立教学场景，也不写任何运行、发布、导出、提示词或凭证状态。 |
| 1.1.50 | 2026-09-09 | 完成G4-12玩家保存与设置纵切面：共享Checkpoint显式区分手动、自动、战前、里程碑和系统用途，历史缺失用途按手动档兼容；玩家领域限定20个手动槽、系统派生档有界轮转、规范终态时间校准、owner/来源/Hash/Projection修复与同不可变Release子分支，非手动档不可由玩家删除。统一保存中心展示存档、分支、固定版本与设置；每个Session单独验真，损坏记录只显示安全诊断，Build Preview禁用正式保存与分支，新Release仅展示只读兼容声明且绝不迁移旧档。偏好按冻结productKey浏览器本地持久化，未知字段和凭证拒绝；所有异步结果受Session与操作代次隔离。无新表、Schema、Context Source、AI写入口或WorldRelease回写。 |
| 1.1.49 | 2026-09-09 | G4-11最终语义收口：fresh生产升级为Action v18，以唯一主线根、Stage顺序及主线窗口/重要故事线内前驱生成系统`locked → available → revealed`链，P10从前置图拒绝断点、分叉和环；Director v3冻结传闻唯一地点、唯一地区牌组和`rest`可达触发，候选/授权/Replay复核地点，Director v2重冻结时删除归一字段以保持原字节与Hash。Knowledge确认只能来自同Stage或更晚的合法Reward/结局下游，重要支线不得借全局结局绕过，Knowledge/成就Effect只允许唯一RewardContract/领奖Action或结局Action owner。P9作者聚合稿先以Hash绑定幂等键并记录`source-snapshot`，再以零模型/零token/零费用走同一编译验收；已返回的超额模型响应先持久原始证据和真实usage、再阻断候选。当前库内为50项新增回归用例、1项Playwright及1项既有作者修订用例增强；完整CI的619个测试文件、3007项测试，以及正式Release桌面/390px刷新Playwright均通过。 |
| 1.1.48 | 2026-09-08 | G4-11独立审查收口：成就改为任务奖励/结局Action直接唯一授予，Director不再依赖同批先置资格标记的不可达链，历史条件式发布保持原义；Knowledge公开摘要、传播地区/地点、未读门和Stage完成来源逐字段复验。P9 fresh生产按Scene硬隔离为最多127项独立请求和一项零Scene共享请求，P8F以同一公式预检上限，去除未来目标、来源Claim与未声明公开的P7人物规划字段；片段以durable子步骤保存原始响应和候选并可恢复，完整Build初始最多154次调用并另授权1次P9片段修复，总调用预算155次。token按156份独立权重分配，P8F/P9各占12/19份且P9独占48/100生产时长，并在输入/输出预算内保留一项最大片段的修复余量。关系记录补齐无可见Actor的任务势力及在场/异地/缺席/死亡口径；传闻初读与后续确认保留各自真实时间线。 |
| 1.1.47 | 2026-09-08 | 完成G4-11关系、百科、传闻、历程与成就纵切面，并补齐此前缺失的生产闭环：P7传闻种子经P8F编译为Knowledge/Rumor、传播事件、揭示门槛、确认来源与3～6个真实成就，P9以预算内最小披露投影生产公开表现且不能读取来源证据、人物私密信息、内部真相或未来目标，P10/运行包装配逐项验证引用与Effect可达。玩家世界记录只投影当前Session实际接触人物、已知事实、已读传闻、连续事件历程和已获得成就，隐藏条目只保留匿名计数；桌面、390px和刷新重放均由正式Release/Session浏览器路径验证。历史Release继续原路径；Actor Knowledge长期记忆留给G6；无新表、Schema、migration或AI写入口 |
| 1.1.46 | 2026-09-08 | 完成G4-10制作、商店与交易玩家纵切面：披露安全投影仅展示已学配方、通用锁定占位、当前地点存活且当班服务的商人、材料/产物/耗时/批量、货币/库存/整数价格/三档关系倍率和装备比较；稳定键只作为不可渲染提交字段。制作/买入/卖出先冻结数量和公开摘要二次确认，再以外层ProductRuntime序列重投影授权并进入唯一Action/Event事务；安全回执以提交时前态重算Authorization，逐项复核Effect、summary、before/after后才重建世界化文案。Store对Session切换、外部基线漂移、重复提交和乱序请求隔离；真实浏览器完成买材料→制作药剂→卖出的落库闭环。无新表、Schema、migration或AI写入口 |
| 1.1.45 | 2026-09-08 | 落实G4-09逐回合战斗纵切面：新生产以Action v17、Progression v2、Combat v4严格三联发布，补齐主动攻击/治疗/资源/状态、被动静态修正、成长属性与装备skillPower、目标自身回合状态时钟、叠层策略及不含施放回合的冷却语义；专用玩家战斗投影和响应式UI提供显式多敌选取、四类操作、公开不可用原因、实际日志、实际胜利奖励和战败重试/复活。Command随机前缀及玩家Effect后系统后续均可从持久事件恢复，奖励、任务结算和Director标记幂等；旧Release保持原义或明确只读；无新表和AI写入口 |
| 1.1.44 | 2026-09-08 | 完成G4-08背包、物品详情、装备和比较UI：披露安全纯投影统一展示实际持有物、分类/搜索/排序/详情、真实数值修正、关键保护、使用/装备/卸下/丢弃和三槽前后比较；基础价值不冒充成交价，出售仅显示政策并留给G4-10。P8F补齐固定单件必确认丢弃、恢复品未满Condition和装备状态Condition；可移除数量排除已装备实例，正向资源恢复按上限裁剪，Replay复核物品Action的操作者/目标/唯一Effect。换档重置UI且页内回执不串其他功能；无新持久化或三注册表登记 |
| 1.1.43 | 2026-09-08 | 完成G4-07角色、成长、技能与状态UI：披露安全聚合投影只读组合冻结Release和当前Session，以世界化显示名解释三属性、实际初始等级成长及六项派生值来源；响应式角色页展示身份、等级经验、生命/技能资源、已学与锁定技能、公开解锁来源、实际冷却和当前状态，隐藏任务来源、内部键及主角私密知识不穿透。主角头像在显式生产合同缺失时使用可访问占位，不误用NPC媒资；技能条件就绪不冒充正式Action可执行，被动技能不虚称生效。同步记录G4-09前必须闭合的技能编译、成长属性、状态生命周期与冷却口径债；无新持久化或三注册表登记 |
| 1.1.42 | 2026-09-08 | 完成G4-06玩家地图与旅行UI：单一披露安全聚合投影组合地图、普通旅行和快旅授权；完整SVG及移动等价列表以选点后确认方式执行，展示当前位置、知识层级、已知道路、风险/阻断和快旅点，未知地点、隐藏路径及听说地点内容继续失败关闭。选择冻结Session与外层ProductRuntime事件基线，陈旧请求需重选；回执由本次Promise按请求代次和完整身份局部归属，换档不串结果或卡住提交。全部动作仍进入统一Action/Effect/Event链，普通与快旅维持原子结算；不新增持久化或三注册表登记 |
| 1.1.41 | 2026-09-08 | 完成G4-05完整任务日志与生命周期闭环：四类任务加历史分类及状态/期限/追踪/地区/角色势力筛选；只投影已公开Stage、Objective、已知地图地点、固定奖励、实际读过的相关事实和规范历史；地图定位是Session绑定UI请求；日志只执行追踪/取消和精确放弃，不绕过冻结Scene接取、重接、目标或领奖。新生产发布Action v16，覆盖未开始/逐Stage放弃、原发布场景四步原子重接、限时放弃后按原期限过期、终态追踪清理和Director镜像同步；Quest v2配套验签，旧P8F/P10 Context与Action v15重放兼容；不新增持久化或三注册表登记 |
| 1.1.40 | 2026-09-08 | 完成G4-04首版HUD与通知边界：生命/资源、地点、时间天气及显式主追踪/最多三个钉选任务统一从权威Projection与冻结模块派生；任务摘要展示状态、阶段、下一必需目标和期限；近期变化只从同Session连续终态Event链重建，随机事件仅在Director授权、冻结定义、Narrative与成功Effects完整闭合后标记已发生/已结算，绝不从历史猜测仍在发生；初载与换档不重播历史，玩家回执不重复，系统重要变化通过常驻live region播报，独立读取暂态不推进游标；不新增持久化或治理注册表 |
| 1.1.39 | 2026-09-08 | 关闭G4-03最终竞态与兼容缺口：Action结果以完整请求代次和Session身份守卫，切换后旧回执/错误/busy/刷新不串入新存档；场景统一标为冻结叙事以区分正式Release与非正式Preview；旧端点正文在地点变化时使用显式确定性兼容回退；Narrative v1/Action v14按旧稳定Action键收窄交谈Actor；玩家入口回归增至24项、Action注册表增至13项 |
| 1.1.38 | 2026-09-08 | 完成G4-03发布前兼容收口：新P9生产把角色拥有的委托/收束固定在发布者常驻地点，历史Context v1继续按旧任务端点验签并可恢复，旧冻结包由运行投影按常驻地点归一；明确正式Release与显式Build Preview共用冻结场景消费边界；高风险确认必须携带整个ProductRuntimeState事件基线，stale后Store刷新权威Projection再允许重新确认；更新32项G4场景/壳及22项玩家入口回归证据 |
| 1.1.37 | 2026-09-07 | 完成G4-03最终门控审计：场景专属玩家Quest Action按Scene lifecycle精确收窄到具体实例，覆盖同定义多轮实例与P8F的`observe + quest`兜底需求；Scene引用不再反向锁死通用use/equip/craft/buy/sell；高风险确认携带弹窗事件基线至执行器并拒绝跨标签页stale，旧DOM不能串Session；多敌战斗在G4-09前确定性选取首个存活目标；v15/v14场景均隐藏缺参数制作交易快捷按钮 |
| 1.1.36 | 2026-09-07 | 收口G4-03正式生产差异：交谈Action按冻结Actor场景、开战Action按冻结Encounter Effect收窄目标，避免同地多目标令Choice失效；未被任何P9 Scene引用且当前合法的通用Action作为环境系统行动保留，任何属于隐藏Scene的Action仍不能越权出现；补真实生产未绑定休息的投影与Session执行回归 |
| 1.1.35 | 2026-09-07 | 收口G4-03生产—运行语义：P9 Context v2只把多Action共有Condition提升为场景门槛，Objective只绑定当地显式Actor需求而不强制任务发布者在场；v1 Context保留旧语义可恢复验签，旧Narrative v2/Action v15包按Action交集、Actor场景引用和居所兼容归一，同地或异地误注入owner均不吞场景；场景投影删除purpose和未发生结果文案，结算回执以独立live region播报；Action独立条件、旧包归一、零/多目标和战斗输入均有回归 |
| 1.1.34 | 2026-09-07 | 落实G4-03首版场景运行：从冻结Narrative v2/Action v15与唯一Session Projection实时派生合法场景，以地点、Condition、Quest生命周期及NPC存活/在场门控且不保存第二份scene状态；P9发布正文、NPC三档态度对白、固定Choice、系统Action、确定性自然输入和系统回执分层显示，三种可执行输入保留各自source后统一进入Action/Event；无唯一目标、无匹配、战斗自由输入与缺少当前激活证据的随机事件均fail-closed；旧v1/v14明确降级，真正模型语义映射、自由对话和结果演绎仍归G6 |
| 1.1.33 | 2026-09-07 | 落实首版响应式玩家壳：vNext与legacy共用只持有页面/抽屉临时态的纯展示壳，父入口删除旧发布侧栏并只负责Launcher与运行包分派；桌面三栏、中宽上下文侧抽屉、移动五项底栏和底部抽屉形成同一信息架构；Header、Release/Preview来源与运行包Hash、退出、返回场景及战斗/全局Projection状态栏稳定；上下文抽屉和高风险确认层隔离背景、循环焦点且支持Escape，断点及Session变化不残留伪模态或旧确认；五页只重排现有能力，不提前侵入G4-03～12；legacy缺失角色合同明确降级不伪造；无新表、Schema或三注册表登记 |
| 1.1.32 | 2026-09-07 | 落实首版玩家启动器：游戏库、Release详情和Session运行三级分离；按核验`productionKey`及版本号归并，旧版可选且旧档固定原Release；正式存档与制作Build Preview严格隔离并显式标源；分别展示来源、运行包和Release证据；损坏发布可诊断不可开档，选档失败清空投影可重试；存档删除以scope/世界分组owner守卫后复用统一生命周期，即使来源损坏也不形成不可清理孤儿；完整存档树和迁移留给G4-12，响应式游戏壳留给G4-02 |
| 1.1.31 | 2026-09-07 | 落地P2表现轮廓、P10系统收口及V1/V2质量门：18个UI消费槽、15个G2运行模块、必需媒资与全量降级、库存/单次双时长均由代码冻结；确定性预检先于模型评审；平衡和叙事问题由代码定位到新Build唯一修复任务并传播stale，禁止原地修改已验收Artifact，真人校准保持独立 |
| 1.1.30 | 2026-09-07 | 落地P9 SceneScripts/ChoiceContracts/ActionBindings：代码侧完整验签10件上游后生成去重知识边界与Action投影，使原子Context在实际任务预算内完整交付；模型只写场景、三档态度对话、选项标签、模板三变体、事件/传闻和非战斗自然语言示例；代码生成全部稳定引用，系统按钮、固定Choice和自由输入候选共同指向P8F唯一Action Hash与结果权威，战斗自由输入关闭，低置信度不执行、高风险需确认，禁止模型创建内容或写状态 |
| 1.1.29 | 2026-09-07 | 落地P8F QuestFinalize/EncounterFinalize与地区Director冻结：11件已验收上游以完整Hash链原子输入，模型只写受约束的任务/目标/发牌语义，代码生成全部Quest/Stage/Objective生命周期、Condition/Effect/Action、奖励、战斗、物品、制作、商店、NPC、地图、旅行、快旅、复活和世界演化定义及双向引用；Director按区域冻结固定任务、模板、随机事件、冷却、并发上限和空白牌，保护故事排除于发牌压力；同时修复正式生产任务实际输入预算传递，为不可切分JSON Context增加atomic超额失败关闭，保持完整Build推荐总调用150次不变 |
| 1.1.28 | 2026-09-07 | 落地P8 Map Interaction Catalog：从完整Region/Location/Edge/FastTravel骨架、地区生活计划和任务地点交互需求生成全地点可点击目录与确定性SVG布局；模型只负责提前到达安全的交互语义和候选选择，代码保持拓扑、知识披露、旅行时间、快旅解锁/复活点和不靠抵达推进关键故事的规则，所有Action/Condition/Effect/Scene/Quest运行引用继续留待P8F/P9真实绑定 |
| 1.1.27 | 2026-09-07 | 落地P8 NPC Runtime Catalog：把地区/任务角色势力需求及商店服务预留编译为Actor/Faction候选，人物小传保持整体文本，代码确定主线/重要Agent维护和保护、普通NPC四时段规则运行与可死亡、功能服务替代但独特内容不继承，以及道德+阵营亲合度三档态度；对话、Scene和Action继续留待后序真实绑定 |
| 1.1.26 | 2026-09-07 | 落地P8 Crafting/Economy Catalog：从已验收玩法、地区、任务、需求与物品奖励目录生成任务所需及每区保底的配方/商店；模型只负责语义和候选选择，代码固定单货币、制作数量、整数基点价格、普通无限/装备限量库存、Actor服务预留、全地区覆盖、物品来源/消耗闭环与无风险套利阻断，全部Action/Effect/Condition/Actor正式引用保持unbound等待后序装配 |
| 1.1.25 | 2026-09-07 | 落地P8 Progression、Enemy/Encounter、Item/Reward三类Gameplay Catalog：正式输入补入QuestSkeleton以保留任务类型/地区/地点/时长语境；形成20级成长、技能与攻击公式、地区敌人/遭遇、全部任务与战斗奖励、关键物品保护和敌人掉落来源，主线奖励精确支持1→5级；代码拥有数值/预算/来源/稳定键，模型拥有受约束语义，全部跨模块运行引用保持unbound等待P8F |
| 1.1.24 | 2026-09-07 | 落地P8 QuestSkeleton与ContentRequirementManifest：把主线/重要故事Stage和地区普通任务/模板种子逐项编译为23个任务骨架、Stage与可执行Objective；代码固定保护任务等待和普通/模板生命周期，并把Objective与地区角色/势力/地点交互需要汇总为有唯一后序owner的内容需求清单，所有正式目录和运行绑定保持unbound，供P8目录和P8F最终化精确兑现 |
| 1.1.23 | 2026-09-07 | 落地P7 RegionNarrativePacks：从已验收Brief/体验、来源、地图、主线和重要故事形成每区差异化内容生态；AI设计矛盾/状态轴、全地点生活与NPC需求、重要Agent/普通规则角色分层、势力及6普通任务/4模板/12随机事件保底种子和传闻，代码固定完整覆盖、owner唯一承接、稳定预留键、普通演化与主线等待隔离以及全部目录unbound |
| 1.1.22 | 2026-09-07 | 落地P6 SignificantThreads：从已验收Brief、来源、故事/结局/承诺、地区与主线形成精确数量的重要故事资产；AI设计至少两种角色/势力/地区owner、多方冲突系统、可玩Stage、氛围信号和局部后果，代码固定稳定键、owner预留/地区绑定、揭示窗口、安全等待、不可放弃过期/永久失败、非地点触发和主线不可改写/阻断；任务、场景、目录与运行绑定保持unbound且全链可复验 |
| 1.1.21 | 2026-09-07 | 落地P5 MainlineThread：从已验收Brief、玩法、故事/结局/承诺、地区和主角形成严格顺序Stage；AI设计玩家体验、空间落点、揭示、保护与恢复语义，代码固定起点、前后链、StoryBeat/Promise/结局覆盖、主线时长与等级节奏、等待/不可永久失败/非地点触发/普通状态不阻断；任务、场景和运行绑定保持unbound且全链可复验 |
| 1.1.20 | 2026-09-07 | 落地P4 RegionSkeleton：从已验收Brief、P1来源、体验和StoryArc编译精确规模的完整世界骨架；AI设计有来源或故事需要的地区/地点/道路语义与提前到达常态，代码固定稳定键、全图/跨区连通、每区快旅复活点、渐进知识、旅行耗时及非到达触发；所有内容、主线与媒资绑定保持unbound，来源、需求、规模、连通和Hash可复验 |
| 1.1.19 | 2026-09-07 | 落地P3 StoryArchitecture：从已验收体验、主角与P1来源证据形成全局故事弧、多结局契约和可追踪叙事承诺；AI负责冲突、节拍、结局差异和承诺语义，代码固定严格顺序/等待/不可永久失败主线、5～8阶段序列、全结局核心目标达成、稳定键与建立—回响—回收闭环；地区、任务、场景及运行Condition不提前生成，所有来源、显式假设、绑定占位和Hash可复验 |
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
