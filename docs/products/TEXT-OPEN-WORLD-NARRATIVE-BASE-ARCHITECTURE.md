# AI 主导文字开放世界叙事基座 · StoryForge 施工规格

> 规格版本：3.2.52
> 生效日期：2026-09-06
> 文档层级：L2 产品目标架构与施工规格
> 当前状态：设计基线；不代表代码已经实现
> 对应产品：文字开放世界
> 对应阶段：阶段 E / `E-OPENWORLD-01`
> 整体产品入口：`TEXT-OPEN-WORLD-PRODUCT-ARCHITECTURE.md`
> 上位权威：`PROJECT-MASTER-CHARTER.md`、`UPPER-PRODUCTS.md`、`DATA-GOVERNANCE.md`、`HARNESS-QUALITY-STANDARD.md`
> 历史与答疑：`TEXT-OPEN-WORLD-VISION-AND-EVOLUTION.md`

## 0. 文档职责

本文把文字开放世界的已确认产品决策、外部架构研究和 StoryForge 现有工程能力收敛为一套可以继续拆任务、定 Schema、写 Skill、做 UI 和验收的施工基线。

本文是叙事生产子系统规格。角色成长、战斗、背包、装备、制作、经济、完整玩家UI和跨系统施工顺序，以 [`TEXT-OPEN-WORLD-PRODUCT-ARCHITECTURE.md`](./TEXT-OPEN-WORLD-PRODUCT-ARCHITECTURE.md) 为整体入口。

本文回答：

1. 第一阶段究竟要做成什么产品；
2. 世界观或小说如何被生产为可玩的开放世界；
3. 哪些工作由 AI、结构化资产和确定性代码分别承担；
4. Agent、Skill、Harness 如何运行，而不是只列角色名称；
5. 哪些逻辑对象必须稳定存在，哪些暂不需要独立物理表；
6. 如何复用 StoryForge 现有运行内核、生产设施与三注册表；
7. 哪些旧入口需要被新体系取代；
8. 用什么小型世界证明从来源到真人游玩的完整闭环。

本文不承担：

- 保存产品构思的全部历史拉扯；历史仍由《愿景与演进记录》负责；
- 把外部研究材料直接提升为项目权威；
- 用文档中的对象名提前决定每张数据库表；
- 声称尚未经过代码、测试和真人游玩的能力已经完成；
- 替代功能开工时的关联闭包、数据迁移设计和测试计划。

本文也不自动改变现行路线图优先级。`E-OPENWORLD-01` 仍以路线图状态为准；业务代码施工应在世界引擎来源出口具备稳定前提后开始，或由用户明确调整项目优先级。

### 0.1 状态词

| 状态 | 含义 |
|---|---|
| 已确定 | 已由用户确认并可指导第一阶段设计 |
| 施工规则 | 为保证产品边界和工程正确性而必须遵守 |
| 验收默认值 | 首个纵向世界采用的可调整参数，不是永恒产品规则 |
| 后续能力 | 已认可方向，但不进入第一阶段完成条件 |
| 待确认 | 仍需要产品答疑、原型或数据校准 |

---

## 1. 产品开工卡

| 项目 | 结论 |
|---|---|
| 产品 | 独立的文字开放世界上层产品，不是世界引擎页面，也不是文字冒险的模式开关 |
| 用户入口 | 选择冻结的 `WorldRelease` 或受治理的小说来源，补充游戏设定，与产品主 Agent 完成会谈并授权生产 |
| 用户结果 | 一个可审查、可修复、可发布、可存档、可持续游玩的不可变 `ProductRelease` |
| 生产 owner | 游戏 `Production / Build`，不是世界引擎 |
| 运行 owner | 游戏实例 `ProductRuntimeSession` 及其私域事件流 |
| 世界来源 | 只读锁定来源版本、内容 Hash 与能力画像；运行结果不反写世界引擎 |
| 媒资 owner | 对应游戏 Build/Release；共享 Blob 只承担存储，不拥有产品语义 |
| 第一阶段体验 | 有边界的自由演绎：固定内容和确定性规则为主，自由文字负责表达、解释和路径引导 |
| 发布策略 | Build 通过质量门后直接形成正式版本供真人游玩；发现问题后修复并发布新版本，不建设单独 staging 产品 |
| 实施策略 | 架构按完整产品设计，先用小型验收世界证明端到端循环 |

### 1.1 核心目标

第一阶段必须让玩家获得以下感受：

- 游戏开始前已经存在一个完整但分层展开的世界；
- 有一条可以长期推进、不会被偶然输入破坏的主线；
- 有多个角色、势力或地区的重要故事线；
- 不推进主线时仍有地区任务、普通支线、随机事件和成长内容可玩；
- 世界时间、地区局势和非主线内容会继续演化；
- 玩家可以用系统动作、固定对话选项和自然语言三种方式交互；
- 自然语言可以得到合乎当前场景的回应，但不能绕过规则直接改写正式状态；
- 关键选择、任务和世界变化会被记住；无长期后果的表现文本可以被压缩或遗忘；
- 等级、战斗、装备、材料、制作、货币、道德和阵营关系形成基础成长循环。

### 1.2 第一阶段非目标

以下内容不进入第一阶段完成条件：

- 玩家即时创造新的大陆、地图拓扑、规则系统或任意任务；
- 玩家用一句自由输入永久推翻主线核心目标；
- AI接受任务表之外的任意解法并直接修改状态；
- 关键角色可被杀死后仍由系统动态重写整条主线；
- 玩家加入敌对势力并让主线整体翻转；
- 自由描述每个战斗动作并由模型临场发明数值效果；
- 潜行、逐格像素移动、完整碰撞和建筑内部关卡；
- 所有 NPC 由常驻 Agent 全天候自主推演；
- 达到大型 3A 开放世界的手工内容规模和画面表现。

### 1.3 第一阶段自由度

第一阶段采用：

> 表达自由，执行受限；选择可以多样，正式结果必须确定。

玩家输入分为四类：

| 输入 | 处理方式 |
|---|---|
| 系统 Action | 直接进入确定性资格和效果计算 |
| 固定对话/任务选项 | 进入绑定的 `ChoiceContract`，由代码提交结果 |
| 可映射的自然语言 | AI生成意图候选；代码映射到已有 Action/Choice；低风险直接执行，高风险或不可逆行动再次确认 |
| 不可映射或越界输入 | AI自然回应、说明限制并推荐现有路径；不得暗中创造新规则或状态 |

---

## 2. 总体架构

```text
┌────────────────────────────────────────────────────────────┐
│ 来源层                                                     │
│ WorldRelease / 小说来源 / 用户补充设定                     │
│ describe → search → read → SourceManifest / SourceLedger   │
└──────────────────────────────┬─────────────────────────────┘
                               │ 只读锁定、可追溯
┌──────────────────────────────▼─────────────────────────────┐
│ 游戏生产层                                                 │
│ Brief → ExperienceContract → StoryArc                      │
│ → RegionSkeleton → Main/Significant Threads                │
│ → RegionNarrativePack → QuestDesign → SceneScript          │
│ → 规则/数值/媒资需求                                       │
└──────────────────────────────┬─────────────────────────────┘
                               │ CreativeArtifact 候选
┌──────────────────────────────▼─────────────────────────────┐
│ 验证与采纳层                                               │
│ Schema / 引用 / 来源 / 可达性 / 预算 / 语义评测 / 修复     │
│ → adopt() → Build Artifact → 组装 → ProductRelease            │
└──────────────────────────────┬─────────────────────────────┘
                               │ 不可变发布
┌──────────────────────────────▼─────────────────────────────┐
│ 确定性运行层                                               │
│ Action / Quest / Combat / Inventory / Clock / Deck         │
│ → append-only Event → Projection → Checkpoint / Branch     │
└──────────────────────────────┬─────────────────────────────┘
                               │ 已确定事实与可见范围
┌──────────────────────────────▼─────────────────────────────┐
│ AI表现与导演层                                             │
│ 意图理解 / 场景演绎 / 对话 / 提醒 / 内容候选 / 降级模板    │
└──────────────────────────────┬─────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────┐
│ 产品界面                                                   │
│ 创建工作台 / 生产进度 / 审查修复 / 地图 / 场景 / 任务日志  │
│ 角色与背包 / 战斗 / 制作 / 存档 / 发布与更新               │
└────────────────────────────────────────────────────────────┘
```

### 2.1 两条不可混淆的数据流

生产流：

```text
来源版本 + 用户 Brief
→ CreativeArtifact 候选
→ 验证与作者授权
→ Build Artifact
→ ProductRelease
```

运行流：

```text
ProductRelease + 玩家命令
→ 确定性 Action/Choice
→ 事件提交
→ 状态投影
→ AI根据已提交结果生成表现
```

运行时不得修改 `ProductRelease`；生产候选不得直接修改玩家存档；游戏私域结果不得自动回写 `WorldRelease`。

---

## 3. AI、结构化资产与代码的责任

### 3.1 总原则

> AI负责提出语义候选和表现；结构化资产保存游戏设计；确定性代码保存当前事实并执行规则。

| 领域 | AI | 结构化资产 | 确定性代码 |
|---|---|---|---|
| 来源理解 | 摘要、选材、改编建议、缺口说明 | Manifest、Ledger、来源映射、证据 | 版本锁定、Hash、权限、读取范围 |
| 体验定位 | 会谈、方案、主题和体验建议 | Brief、ExperienceContract | 必填项、预算、确认状态 |
| 故事结构 | 主线、重要故事线、结局和伏笔候选 | StoryArc、Thread、Stage、Promise | ID、引用、顺序、状态合法性 |
| 地区设计 | 地区主题、矛盾、代表人物和内容生态 | RegionSkeleton、RegionNarrativePack | 地图连通、解锁、旅行和加载 |
| 任务生产 | 任务故事、场景、对白和包装 | QuestDefinition、Objective、SceneScript | 可接取、推进、过期、奖励和效果 |
| 自由输入 | 理解意图、自然回应、推荐选项 | IntentCandidate、表现候选 | Action映射、资格、确认和提交 |
| 任务导演 | 提出节奏和内容推荐 | Deck、配额、内容标签、冷却参数 | 过滤、评分、发牌、去重、并发上限 |
| NPC | 人格化对白、关键节点语义变化候选 | Dossier、知识、故事状态、日程规则 | 位置、态度档位、存活、功能和触发 |
| 战斗 | 战前战后与回合叙述 | 属性、技能、装备、敌人、掉落 | 回合、伤害、暴击、资源、逃跑和胜负 |
| 制作 | 物品说明和配方候选 | Recipe、材料、产物、条件 | 扣除、合成、入库和幂等 |
| 关系 | 按当前档位写态度和对白 | 阵营、NPC解释规则、表现范围 | 道德、阵营亲合度、三档态度 |
| 时间环境 | 生成与状态一致的氛围表现 | 天气类型、地区表现、事件规则 | 时钟、昼夜、天气迁移、期限 |
| 质量 | 语义评审、问题解释、修复候选 | 评测报告、修复 Artifact | Schema、图检查、预算、回放和事务 |

### 3.2 三条红线

1. 模型输出不能直接决定条件是否满足、战斗是否胜利、奖励是否到账或任务是否完成。
2. 正式生产内容必须经过 `CreativeArtifact → validate → adopt → receipt`；运行表不是生产采纳目标。
3. 每次模型调用必须声明读取集。超出读取集的新事实只能被标记为创意提案，不能冒充现有世界事实。

### 3.3 自然语言不是结构化事实证明

模型自报“引用了哪些实体”不能证明正文没有加入未声明事实。第一阶段采用以下边界：

- 关键事实、行动、奖励、伤害、任务进度使用结构化字段；
- AI正文被视为非权威表现，不能反向覆盖结构状态；
- 需要硬保证的台词可以使用带槽位的受约束文本或确定性模板；
- 开放文本通过实体别名、禁泄露集合、知识边界和语义评测降低风险；
- 评测失败或置信不足时使用安全降级文本，不隐藏重试；
- “零幻觉”“零剧透”不能仅凭ID校验对外承诺。

---

## 4. 无循环的内容生产编译体系

### 4.1 唯一生产 DAG

```text
P0 来源锁定
  ↓
P1 SourceManifest + SourceLedger
  ↓
P2 GameBrief + ExperienceContract + ProtagonistAsset
  ├─────────────→ 整体产品：GameplayRulesetSkeleton
  ↓                            │
P3 StoryArc + EndingContracts
  ↓
P4 RegionSkeleton
  ├──────────────┐
  ↓              ↓
P5 Mainline      P6 SignificantThreads（可并行多个实例）
  └───────┬──────┘
          ↓
P7 RegionNarrativePackFinalize
          ↓
P8 QuestSkeleton + ContentRequirementManifest
          ↓
   整体产品：Gameplay Catalogs
          ↓
P8F QuestDesignDocumentsFinalize + Deck/Templates
          ↓
P9 SceneScripts + ChoiceContracts + ActionBindings
          ↓
P10 SystemConfigsFinalize + MediaRequirements + ContentBudget
          ↓
V1 确定性预检
          ↓
V2 语义评审
          ↓
R1 有界修复 → 回到受影响节点重验
          ↓
V3 Build组装、回放与发布门
          ↓
ProductRelease
```

地区被拆成 `RegionSkeleton` 与 `RegionNarrativePackFinalize` 两步。前者给故事线提供稳定空间约束，后者在主线和重要故事线明确后补全地区生态，从而消除“地区包依赖故事线、故事线又依赖地区包”的循环。

### 4.2 阶段契约

| 阶段 | 必要输入 | 正式候选输出 | 主要闸门 |
|---|---|---|---|
| P0 来源锁定 | WorldRelease/小说、用户选择 | SourcePin | 可读取、版本和Hash稳定 |
| P1 来源拆解 | SourcePin、来源目录 | SourceManifest、SourceLedger、SourceGapReport | 证据可追溯、未读内容显式 |
| P2 产品定位 | Ledger、用户会谈 | GameBrief、ExperienceContract、ProtagonistAsset | 冲突和未决项为零或显式接受 |
| P3 全局叙事 | P2、核心来源 | StoryArc、EndingContract、NarrativePromise | 核心目标、结局和主题相容 |
| P4 地区骨架 | P1-P3 | RegionSkeleton、LocationNeed、初始图 | 每个地点有故事/玩法存在理由 |
| P5 主线 | P3-P4 | MainlineThread、Stage、保护与恢复规则 | 严格顺序可达、主线不被普通状态阻断 |
| P6 重要故事线 | P3-P4、相关来源 | Character/Faction/Region/Event Thread | 与主线相容、局部后果明确 |
| P7 地区最终化 | P4-P6 | RegionNarrativePack、NPC角色分层、内容需求 | 地区差异、故事覆盖、前往顺序安全 |
| P8 任务骨架与内容需求 | P5-P7、整体产品的GameplayRulesetSkeleton | QuestSkeleton、ContentRequirementManifest、奖励预算 | 故事动机、阶段目的和玩法需求完整，不引用未生产内容 |
| P8F 任务最终化 | P8、整体产品Gameplay Catalogs | QuestDefinition、QuestStage、Objective、DeckRule、Template | 具体敌人、物品、Action、奖励、失败和时间引用完整 |
| P9 场景脚本 | P8F、角色知识、场景事实 | SceneScript、ChoiceContract、ActionBinding | 选项有后果、知识边界和引用完整 |
| P10 系统整合 | 前述全部、整体玩法模块 | 系统配置最终版、媒资需求、预算 | 玩法闭环、体量、资源和媒资槽完整 |
| V1-V3 | 全部候选 | 报告、修复候选、Build、Release | 硬闸门全过；软评测达到发布阈值 |

### 4.3 修复不是依赖环

修复以新的 Artifact 版本表达，并记录：

- 触发它的失败回执；
- 被修改对象和字段；
- 原版本 Hash 与新版本 Hash；
- 受影响下游集合；
- 必须重跑的验证器；
- 最大修复轮数和停止原因。

修复不得静默原地改写已经被下游消费的 Artifact。超过预算、连续重复同类错误、来源不足或需要产品判断时暂停给作者。

---

## 5. Agent、Skill 与 Harness

### 5.1 职责角色不等于常驻 Agent 数量

本文不规定“必须部署多少个 Agent”。生产职责首先表现为版本化 Skill 和工作流节点：

- 顺序步骤可以由同一主 Agent 在不同 Run 中调用不同 Skill；
- 重要故事线或独立地区可以在读取集互不冲突时并行创建多个子 Run；
- 状态统计、规则判断、发牌、存档和版本校验永远是确定性服务，不创建“状态记忆 Agent”；
- 运行时只保留一个对玩家负责的入口，内部按需要调用意图理解、叙事表现或语义审查能力；
- Agent 不拥有私有事实副本，权威内容始终来自 Artifact、Release 和运行事件。

### 5.2 建议的 Skill 家族

| Skill家族 | 职责 | 是否可以并行 |
|---|---|---|
| Source Curation | 来源目录、证据账本、缺口识别 | 可按来源分片，最终合并 |
| Experience Design | Brief、体验定位、主角与体量 | 通常顺序 |
| Story Architecture | 总体故事弧、主题、结局、承诺 | 通常顺序 |
| Region Skeleton | 把故事需求投影为空间骨架 | 通常顺序 |
| Mainline Design | 严格顺序主线、保护与恢复 | 通常单实例 |
| Significant Thread Design | 角色/势力/地区/事件故事线 | 可多实例并行 |
| Region Finalization | 整合地区生态与任务需求 | 可按地区并行 |
| Quest Design | 任务定义、阶段、目标、奖励和后果 | 可按故事线/地区并行 |
| Scene Writing | 场景、对白、选项和表现 | 可按任务并行 |
| System Integration | 数值、战斗、制作、关系、时间与媒资需求 | 可按系统并行，最终汇合 |
| Review | 来源、叙事、可玩性、连续性、预算 | 独立于生产者运行 |
| Repair | 根据指定失败回执做有限修复 | 只修改授权范围 |
| Runtime Intent | 把自由文字映射为已有意图候选 | 每次玩家输入按需运行 |
| Runtime Direction | 根据确定性状态提出内容选择建议 | 代码仍拥有最终选择权 |
| Runtime Expression | 根据已确定结果生成叙述和对白 | 每个场景/回合按需运行 |

### 5.3 每个 Skill 的四件套

每个正式 Skill 必须同时提供：

1. **Skill Contract**：目的、适用阶段、输入/输出 Schema、读写范围、预算、模型能力和失败策略；
2. **Context Policy**：允许读取的 `CONTEXT_SOURCES`、检索顺序、必读证据、可省略内容和 token 上限；
3. **Prompt/Tool Policy**：任务指令、允许工具、禁止行为、输出协议和降级策略；
4. **Eval Suite**：正例、反例、空来源、冲突来源、超预算、stale、非法结构和语义质量样例。

只存在 Prompt、不存在结构输出、Harness和评测的能力，不算正式 Skill。

### 5.4 Run Contract 最小字段

```text
runId / workflowKind / objective
scope / productOwner / buildId
sourceReleaseId / sourceHash
inputArtifactIds + hashes
contextSourceKeys / actualReadManifest
writeTargets
skillId / skillVersion / modelRuntimeBinding
budget / attemptPolicy / timeoutPolicy
idempotencyKey
acceptanceCriteria / verificationPlan
stalePolicy / repairPolicy / failurePolicy
events / checkpoints / terminalReceipt
```

模型本身不持有数据库写工具。模型返回结构化响应，编排器在 Schema、权限、Hash、stale 和幂等检查通过后持久化候选。

#### 5.4.1 当前生产合同落地基线

`src/lib/open-world/production-contract.ts` 已把本节落实为文字开放世界专属、共享Harness可解析的生产合同：

- 40种专属Artifact Kind分别保存来源、体验、故事、地区、任务、玩法目录、场景、系统整合和质量证据；每种Kind只有一个任务owner；其中SourcePin索引与大体量来源单元分开；
- P0～P10连同V1确定性预检、V2平衡/语义双评审、V3装配和QA共26个任务，全部进入`qa.release`终态汇合；
- 22个模型型durable Run分别承担来源、体验、Ruleset、表现、故事、地区、主角、任务、六类玩法目录和评审；当前执行器中P1最多使用6个来源批次，P9按Scene使用最多127项隔离请求并追加1项零Scene共享请求，其余Run初始执行各1次；
- 完整Build最多执行154次初始模型调用，并为P9额外授权1次明确失败片段修复，总调用预算155次；调用扇出、token份额与时长份额分开计算，输入/输出token按156份叙事生产权重分配，生产时长按100份独立权重分配；P8F/P9分别占12/19份token，P9的最多128次初始小请求及1次修复占48份时长，并在输入/输出内为最大片段预留修复余量，不会挤占不可切分上游；共享账本逐attempt保存已付用量，重试只预留同Run任务剩余额度，部分调用费用上界按实际模型/媒资调用比例分摊，未知结果则保留预留等待人工裁决；实际调用按执行结果计量，不能把“任务数”误当成“一任务只调用一次模型”；
- P8的成长、遭遇、物品奖励、制作经济、NPC运行和地图交互目录允许按依赖并行，P8F只能在六类目录完成后把任务绑定到真实引用；
- 每项任务显式声明输入、输出、依赖回执、Context Source、候选写目标、预算、超时、重试、不可重试错误、stale传播和完成Gate；
- `sourcePinHash`、`briefHash`、`planHash`、`controlEpoch`或上游Artifact Hash变化都会使下游保守stale；旧候选只读，不能直接采纳；
- 模型任务最多两次尝试，只允许传输、限流、协议或Schema局部修复；授权、余额、stale和结果未知不得隐藏重发；
- V3是唯一把已验收产物装配为G2运行包的节点，AI不得直接写正式Release或Session状态。

这套合同已在G3-18激活为`active`。共享调度器按`text-open-world`产品类型选择这套专属Plan，正式生产Service选择唯一专属Executor；其他产品仍走原有通用流程。激活依据不是“所有文件都存在”，而是完整DAG、断点恢复、媒资装配、Build Preview与真实Session启动证据均已闭合。

#### 5.4.2 P0双来源SourcePin落地

`src/lib/open-world/source-pin.ts` 已将世界观与小说来源收口为同一种可验证的P0交接物，但不伪造两类来源相同的物理读取方式：

- WorldRelease入口通过中立Gateway读取冻结目录，Pin只保存便携`WorldReference`、作者授权的资源坐标、各资源content hash和`index`级实读证据；本地Release记录ID被置零，产品不接触物理Release行或完整manifest；
- 小说入口只接受同项目内受控的小说Work，按作者选择解析故事核心、大纲和规范章序，把真实文本完整复制到产品私有SourcePinUnit；单元最多20万字符，超长章节自动分片，Pin不保存来源Work/Chapter/Outline的可变本地主键；
- 两类来源都冻结`sourceVersionHash`、包含选择边界的`sourceBoundaryHash`、Brief/开始revision、原始nonce的hash、明确rights basis、系统派生读取permission、实际读取证据hash和最终`pinHash`；
- WorldRelease在P0只声称实际读取了目录。全文/原文是否读取必须由P1的Context Manifest和SourceLedger证明；小说则因已完成私有全文复制，单元明确标记为`full`；
- P0复用`productBuildArtifacts`，先写独立SourcePinUnit，最后写SourcePin索引作为闭合标记。相同Pin可安全重试；同一Build试图更换来源会被视为stale并拒绝，必须重新确认Brief并建立新Build；
- 来源冻结、Creator交接和Production Plan共同使用同一组P0边界：最多512个SourcePinUnit、合计最多400万UTF-16字符。P0候选checkpoint按每字符最坏6字节JSON转义、每单元16 KiB信封和256 KiB固定信封预留，最大为32,650,752 B，严格小于共享32 MiB resume payload上限；超过任一来源上限必须在生产前失败关闭，不能先接受来源再在checkpoint阶段失败；
- 运行阶段只读取Session绑定的冻结运行包：正式游戏来自ProductRelease，制作端显式试玩来自同一生产链Build Preview；两者都不回读活动小说，也不直接运行WorldRelease。

P0本身没有增加物理表、AI可写字段或第二套Context Source。单元与Pin共享既有Artifact导入、导出、删除、版本和Work作用域生命周期；P1在此基础上通过下述产品专属、已登记Context Source按批选择单元。

#### 5.4.3 P1来源整理、实读清单与证据账本落地

`src/lib/open-world/source-curation.ts` 已将“来源存在”“模型实际读过”“模型从来源中得出了什么”拆成三层不可混淆的证据：

- P0 SourcePin继续证明作者授权、冻结版本和选择边界；P1 SourceManifest逐个单元证明它是否被完整送入某个模型批次。Pin中的存在或小说已经私有复制，都不自动等于模型已读；
- 小说由登记的`text-open-world.source-pin` Context Source只暴露本批选择的完整单元；没有选择器时只返回Pin身份、数量和索引，绝不隐式把整本小说送入模型；
- WorldRelease由P1根据便携WorldReference重新解析本地冻结版本，只允许读取SourcePin已选资源，并经Context Gateway强制`full`深度；交付内容必须同时匹配冻结目录Hash与SourcePin单元Hash；
- SourceLedger中的每项事实都必须绑定已读单元、来源内容Hash、逐字引文、UTF-16起止偏移和模型批次。Schema解析器用实际交付正文复核`content.slice(start,end)`，未读引用、错误偏移和伪造引文全部失败关闭；
- SourceGapReport不由模型自行宣称覆盖率。代码依据SourceManifest的实读集合及Ledger的证据标签，确定性生成未读、故事核心、主角、核心冲突、角色、势力、地点和时间线缺口；模型只能补充矛盾、歧义和低证据缺口；
- Manifest、Ledger与GapReport依次绑定上游Hash、相同生成时间和受控rights证据，仍只产生`productBuildArtifacts`候选，不写世界引擎、正式ProductRelease或运行Session。

P1专属Skill与Executor已经进入正式P0～P10生产Plan。共享durable scheduler持久化每个候选、验收回执与checkpoint；在P1候选写入后模拟崩溃并恢复时，已完成的模型调用不会再次执行或重复计费。

#### 5.4.4 P2 GameBrief、体验契约与主角身份落地

`src/lib/open-world/experience-design.ts` 已把通用作者会谈终态和文字开放世界专属体验设计拆为“代码冻结边界 + 模型补充语义”，避免让模型重新解释已经确认的产品决策：

- G5-02已经用文字开放世界专属Creator Brief承接作者会谈，并把确认结果保存到统一`ProductProductionBrief`修订；它持久绑定G5-01来源身份、作者设定、规模、边界、媒资、完成条件和durable候选证据，但自身不是`SourcePlan`或开始授权。现在只有G5-04专属Creator启动命令能把它提升为生产链可消费的正式来源计划与确认事实；在该命令成功前P2不能运行，也不能把缺少作者确认的字段当作默认值悄悄补齐；
- G5-03在Creator Brief之后加入零写入的生产准备门：复用全局BYOK设置和正式creation任务路由，以provider、精确model、安全endpoint origin、规范基础路径Hash、真实凭证来源和非敏感生成参数形成绑定；远程必须HTTPS，URL内嵌凭证、查询或fragment直接阻断。目录价还要求命中注册的官方商业端点，中转、同域异路径和未复核模型都必须由作者录入报价，本地token零费用只允许明确localhost上的Ollama/custom。界面向作者展示完整叙事生产DAG的155次建议调用/160硬上限、120万输入/36万输出token、30美元文本硬保护、2小时和200MB资源边界，并明确媒资费用由G5-08另行排产；已发生的Brief会谈只把真实调用、token和耗时与非账单估价分开呈现。四项确认在准备页只形成内存Hash，但Verifier会以当前任务路由和AIConfig作外部真实性比较，空确认、自洽重算Hash、同域换路径均不能授权；设置往返只恢复精确会谈/产品/来源。准备页不创建Build或SourcePlan，正式Creator启动会在原子边界重新CAS Brief、来源、模型、报价、预算和Plan Hash后才允许P0运行。中央日志脱敏及供应商错误分类保证Key、认证头、完整URL和原始错误正文不会进入日志、Artifact或创作者页面；
- 登记的`text-open-world.experience-input` Context Source只读取同一Work/Production/Build内的已授权Brief、SourcePin及已验收P1三件Artifact。它选择有界的高优先级Ledger事实和缺口，但把全部开放缺口key带入GameBrief；整个输入而非少数索引字段进入`contextSelectionHash`；
- `GameBrief`完全由确定性代码投影作者意图和集中校准：主角来源模式、目标体量、至少两个结局、严格顺序主线、重要故事安全等待、普通世界持续演化、非地点唯一关键触发、有边界自由、三类输入、四类回合战斗操作、标准难度、三类首版视觉消费槽、成本上限和直接发布条件均不能由模型改写；
- 模型只输出pitch、玩家幻想、叙事支柱、地区差异、成长承诺、基调及主角身份/动机/个人代价。每个来源引用必须是当前上下文已交付的`claimKey`；来源型主角还必须引用证据锚定到作者所选角色来源单元的claim，不能只根据显示名编写新小传；
- `ExperienceContract`冻结有边界自由的承接/拒绝/引导策略、主线与重要故事保护、地区发牌内容、世界演化和失败策略；`ProtagonistAsset`只保存叙事身份，初始数值Build明确留给P4在GameplayRuleset完成后生成；
- GameBrief、ExperienceContract和ProtagonistAsset分别拥有内容Hash，并通过Brief、Pin、Manifest、Ledger、Gap Report、完整P2输入与实际claim entry hash形成basis链。即使重新计算单个Artifact Hash，偷换作者意图、固定边界、来源缺口或未交付claim仍会在采纳前失败关闭；
- P2不再读取WorldRelease/小说原文，P1是唯一来源证据入口；输出仍是`productBuildArtifacts`候选，不写世界引擎、正式Release或Session。一次P2模型请求对应一个durable任务尝试，隐藏多轮重试不在Executor内部发生。

P2已经登记Skill和Executor并随专属生产Plan正式激活。产品路由在调度与执行两层都按`text-open-world`显式选择，不会把半套专属产物交给其他产品，也不会回落到旧通用开放世界机械编译器。

#### 5.4.5 P2 GameplayRulesetSkeleton落地

`src/lib/open-world/gameplay-ruleset.ts`已经把叙事生产使用的“玩法语言”绑定到G2确定性运行合同，任务与场景Agent不再自行假设游戏支持什么：

- 登记的`text-open-world.gameplay-ruleset-input`只读取同一Work/Production/Build内已验收的GameBrief、ExperienceContract、ProtagonistAsset和它们实际引用的SourceLedger claim，不重读WorldRelease或小说原文；
- 模型只负责规则标题、摘要，以及`power/vitality/agility`、技能资源、三个装备位、单一货币和标准难度的世界化显示语义；每次输出至少引用一项已交付claim，不能提交公式、技能、物品、敌人或任务；
- 确定性编译器冻结无职业/无手动配点、三属性、20级上限、1到5级验收跨度、自动成长、资源上限策略、现行G2公式、单人逐回合四操作、普通攻击必中、无元素/友军参战、标准难度和有界物理结算；
- 背包固定无限容量，装备位固定为weapon/armor/accessory，不启用词缀、强化或耐久；制作固定100%成功且要求学习配方；经济固定单货币、普通无限库存、特殊有限库存和G2事务上限；
- Effect词表直接来自`TEXT_OPEN_WORLD_EFFECT_OPERATIONS_V1`，不再在生产Prompt另抄一份；当前新Build操作进一步无重叠地分为模型可提议内容效果与编译器专属协议效果，旧`start-combat/resolve-combat`只用于旧Release读取；
- Artifact精确冻结Progression v1、Combat v3、Items v1、Crafting v2、Economy v2、Action v14和RuntimePackage v1。后续PlayerBuild、任务、目录及最终V3装配可以直接消费这些字段；任何固定数值、模块版本、权限分区、上游Hash、claim或basis变化都会失败关闭。

该Artifact仍只进入`productBuildArtifacts`候选，不写ProductRelease、Session或世界引擎。它现在由已激活的专属Plan消费，但正式ProductRelease仍只能在后续发布动作中产生。

#### 5.4.6 P4 PlayerBuild与目录预留落地

`src/lib/open-world/player-build.ts`把已确认主角从叙事身份推进为受玩法骨架约束的初始构筑，同时避免提前伪造尚未生成的技能和物品目录：

- 登记的`text-open-world.player-build-input`只读取同一Build已验收的GameBrief、ExperienceContract、ProtagonistAsset和GameplayRulesetSkeleton；完整Artifact内容与Hash链进入`contextSelectionHash`，不重新读取WorldRelease、小说、活动角色行或任何Session状态；
- 模型可以完善人物小传式身份、描述性玩法风格、不同的主/副属性选择，以及基础攻击、标志技能、初始武器和恢复品的名称与用途；不得改主角名、核心目标，建立职业系统，或输出伤害、掉落、Effect和运行时状态；
- 代码固定1级开局、`progression.default`、主属性5/副属性4/其余3的12点预算、100初始货币、两项初始技能及一件武器/三份恢复品；标志技能的类别和目标由闭集combatPurpose确定性映射，基础攻击始终依赖power；
- `skill.player.basic-attack`、`skill.player.signature`、`item.player.starter-weapon`和`item.player.recovery-consumable`是后续目录必须兑现的稳定reservation，不是当前已经存在的运行定义；Artifact同时保存语义需求和未来PlayerDefinition所需的Build字段；
- 在Progression Catalog与Item/Reward Catalog精确生成这些键之前，`catalogBinding`固定为`reserved-unbound`且`playerDefinitionReady=false`。任何下游不得据此直接发布；最终装配必须先证明所有预留键、数量、获得来源和机制都有真实定义；
- 执行器复验完整上下文、上游Artifact、身份来源、属性预算、货币、技能物品键、目录依赖、binding状态、basis和内容Hash；任何模型越权或重算Hash后的篡改都失败关闭。

该步骤仍只写产品Build候选。正式PlayerCharacterDefinition、ProductRelease与运行Session均由后续目录绑定和唯一装配阶段产生。

#### 5.4.7 P3 StoryArchitecture、EndingContracts与NarrativePromises落地

`src/lib/open-world/story-architecture.ts`把世界观或小说的故事材料先编译为全局叙事约束，而不是直接跳到自然语言任务或场景正文：

- 登记的`text-open-world.story-architecture-input`只读取同一Build已验收的GameBrief、ExperienceContract、ProtagonistAsset、SourceLedger和SourceGapReport；优先选择体验、主角、故事核心、冲突、人物、势力、时间与地点证据，并把选择数量、遗漏Hash和全部开放gap纳入`contextSelectionHash`；P3存在阻断缺口时停止；
- 模型负责故事标题、主题、核心冲突、5～8个宏观节拍、与Brief目标数量精确一致的多结局语义，以及4～12项叙事承诺。每个节拍、结局和承诺都必须引用当前交付的claim；只有已交付、非阻断且标记`design-with-explicit-assumption`的gap才可作为显式设计假设；
- 代码固定主线严格顺序、长期等待玩家、核心目标不可永久失败、关键流程不以到达地点作为唯一触发。节拍必须从opening单调推进到resolution并覆盖rising、turning-point和convergence；地区在此处仅以`spatialFunctionNeeds`描述未来要承担的戏剧功能，不创建地区或地点实体；
- 结局数量来自GameBrief，标题和差异轴必须唯一，且所有结局的`coreGoalStatus`固定为`achieved`。差异只能来自代价、价值、关系和局部世界后果；Condition与Effect仍是`condition-unbound`，等待主线和任务最终化；
- 每项NarrativePromise必须具有建立、1～3次有序中间回响和最终回收，至少覆盖`core-conflict`、`character`、`world`三类，并保证每个结局至少得到一次回收。Promise到Scene的绑定固定为`scene-unbound`，后续场景生产必须逐项兑现；
- Story、Ending、Promise和Callback稳定键均由代码生成；三个Artifact通过上游Hash、实际claim entry hash、显式假设gap hash、basis和内容Hash闭合。伪造来源、错误节拍、承诺乱序、结局漏回收、模型自造运行绑定以及重算Hash后的确定性字段篡改都会失败关闭。

P3仍只产出Build候选，不写世界引擎、ProductRelease或Session。它给P4地区骨架提供空间戏剧需求，给P5主线与后续场景提供必须兑现的叙事约束，而不是自行承担这些下游职责。

#### 5.4.8 P4 RegionSkeleton与世界级空间规划落地

`src/lib/open-world/region-skeleton.ts`把“从世界观或小说拆世界”落实为来源—故事—空间的受治理编译，不允许先画一张与故事无关的地图：

- 登记的`text-open-world.region-skeleton-input`只读取同一Build已验收的GameBrief、SourceManifest、SourceLedger、ExperienceContract和StoryArc；它核验Artifact行Hash、各自内容Hash、来源读取集合、体验链和故事治理，再优先交付地点/地区/势力/事件claim及StoryArc实际使用的来源事实；
- GameBrief在P4输入中是必要项，因为ExperienceContract只有其Hash而没有地区数和命名地点范围。地区数必须精确匹配Brief，地点总量必须落在冻结范围内；首版编译器显式限制在20区、200命名地点以内，超出时要求拆分产品规模而不是静默截断；
- StoryArc的每项`spatialFunctionNeeds`被转换为稳定的`beatNumber/needNumber`引用。模型设计的每个地区、地点和道路必须至少引用当前交付的SourceLedger claim或故事空间需求，且所有空间需求都要被地区或地点覆盖；
- 每区至少拥有叙事、探索和旅行空间，一个同时提供旅行与服务的地区枢纽；完整地图还必须拥有战斗和制作空间。每个地点都必须说明主线尚未推进时可安全体验的日常、探索或系统内容，不能把提前抵达变成关键剧情触发、剧透或流程跳跃；
- 模型只建议语义、地点类型、功能、距离档位、风险和连线。代码按顺序生成`region.*`、`location.*`、`edge.*`、`fast-travel.*`稳定键，冻结双向道路及15～90分钟的距离档耗时，验证全地点可达、跨区图连通、每区恰有一个快旅/复活点、仅初始点默认解锁；
- 世界骨架在Build时完整存在，玩家知识固定为起始地区/地点`visited`、其余`unknown`并采用`title-on-heard`渐进揭示。骨架道路不带Condition，关键主线固定为`never-critical-location-only`；后续若要门控具体内容，必须由任务和场景条件完成，不能破坏玩家提前到达的地图安全；
- 所有Location的Scene、Quest、Actor、Encounter、Vendor绑定以及地区/地点媒资绑定保持空数组和显式unbound；P5主线、P7地区生态、P8任务与后续目录必须引用这些稳定坐标后再逐项兑现，P4不得冒充完整可玩地图模块。

验证器从Artifact反向还原模型草稿，再用同一Context重新生成全部键、知识状态、连接、快旅、空绑定、治理、coverage、basis和内容Hash做规范比较。伪造claim、漏接空间需求、断开地点或地区、重复道路、错误起点、缺功能、私自绑定Scene/Quest、提前解锁异区快旅，以及重算Hash后的治理篡改都会失败关闭。P4仍只写Build候选，不新增物理表，不写WorldRelease、ProductRelease或Session。

#### 5.4.9 P5 MainlineThread与受保护主线Stage落地

`src/lib/open-world/mainline-production.ts`把StoryArc从宏观叙事约束推进为可供任务工程消费的主线阶段，但仍不把自然语言目标伪装成已经可运行的Quest：

- 登记的`text-open-world.mainline-input`只读取同一Build已验收的GameBrief、GameplayRulesetSkeleton、StoryArc、EndingContracts、NarrativePromises、RegionSkeleton和PlayerBuild。Context复核每件Artifact内容Hash、行Hash、相互引用和固定治理，不重新读取WorldRelease、小说、活动表或Session；
- GameBrief与NarrativePromises补入P5正式输入：前者提供冻结Stage数量和必需游玩时长，后者让主线真正安排每项叙事承诺的建立、回响与回收，避免只输入StoryArc标题却遗漏承诺生命周期；
- 模型在6～8 Stage范围内设计标题、摘要、戏剧问题、StoryBeat编号、地区/地点编号、核心玩法体验、玩家目标、必要揭示、阶段结果、关键资产保护需求、失败恢复说明和时长权重。它不能生成Quest、Objective、Scene、Actor、敌人、物品、奖励、Action、Condition或Effect键；
- Stage必须从第一个StoryBeat单调推进到最后一个并覆盖每个Beat，首Stage必须包含RegionSkeleton初始地点，所有地点必须属于声明地区。整条主线至少覆盖对话、调查、探索、战斗和选择，确保“叙事主线”不是只有文本摘要；
- 代码生成唯一`storyline.main`、`mainline.stage.*`稳定键及严格previous/next链。每个Promise的setup绑定该Beat首个Stage、callback绑定对应Beat首个Stage、payoff绑定对应Beat最后Stage；全部Ending只从最终Stage分流并继续保持`condition-unbound`，所有结局固定完成同一核心目标；
- 代码按Stage权重把主线总时长分配到GameBrief的90～120分钟区间，并把推荐等级从PlayerBuild初始1级确定性推进到GameplayRuleset验收5级。时长和等级只是后序Quest/Encounter/Reward的预算，不是模型可随意填写的运行数值；
- 每个Stage固定由`explicit-mainline-advance`进入，地点到达本身不启动；前置只允许严格前一Stage完成，普通任务、道德、阵营、NPC死亡和资源耗尽不得锁死主线。主线始终可等待、不可放弃、不可过期、不可永久失败，战斗失败通过重试或复活恢复；
- Quest、QuestStage、Objective、Scene与Reward绑定均保持空数组/null和显式unbound，完整运行还依赖QuestSkeleton、ContentRequirementManifest、QuestDesignDocuments、SceneScripts和ActionBindings。

验证器从Artifact反向恢复模型语义，再重新分配稳定键、Stage链、等级/时长、Promise落点、Ending路径、保护策略和全部空绑定做规范比较。StoryBeat逆序或遗漏、未知地点、核心体验缺失、结局漏项、私自绑定任务/场景/奖励、改变等待/失败治理，以及重算Hash后的篡改都会失败关闭。P5仍只写Build候选，不新增物理表，不写ProductRelease或Session。

#### 5.4.10 P6 SignificantThreads与重要故事生态落地

`src/lib/open-world/significant-threads-production.ts`把重要故事生产从“给配角写小传”提升为角色、势力和地区可共同承载的可玩结构，同时不把尚不存在的NPC、任务或Effect目录伪装成运行资产：

- 登记的`text-open-world.significant-threads-input`只读取同一Build已验收的GameBrief、SourceLedger、StoryArc、EndingContracts、NarrativePromises、RegionSkeleton和MainlineThread；Context优先选择角色、势力、事件、剧情与空间claim，完整核验Artifact行Hash、内容Hash、来源条目Hash和选择Hash，不重读活动来源或Session；
- P6正式依赖P5并读取MainlineThread。模型用`availableAfterMainlineStageNumber`描述何时可揭示重要故事，但不能要求修改任何主线Stage、核心目标、可达性或结局；重要故事对NarrativePromise只能提供辅助回响，不能取代主线既有的建立与回收；
- 重要故事数量精确服从GameBrief，owner必须来自character、faction、region且至少覆盖两种。地区owner直接绑定RegionSkeleton稳定键；角色和势力owner由代码分配稳定reservation，等P8 NPC运行目录生产真实Actor/Faction后再兑现，不能在P6自造目录引用；
- 每条故事必须绑定来源claim或StoryBeat，落到有效地区和地点，并拥有2～4方冲突参与者。每方分别声明目标、可调动资源与当前压力，另以升级步骤和氛围信号说明传闻、环境、功能NPC与地方事件如何持续表现群体冲突，而不是为每个群体成员启动常驻Agent；
- 每条故事形成3～6个有序Stage，整线至少包含对话和调查/探索/选择之一；Stage必须声明玩家目标、阶段结果和1～4项局部后果。局部后果只允许道德、阵营亲合、地区状态、NPC态度和资源五类语义计划，真实Condition/Effect仍保持空绑定；
- 代码生成`significant-thread.*`、owner reservation、conflict side、stage和consequence稳定键，按权重给每线形成至少30分钟的可玩时长预算；所有Stage固定显式推进、非地点唯一触发、前后安全等待、不可放弃/过期/永久失败、普通状态不阻断，玩家缺席时不施加压力；
- Quest、Objective、Scene、Action、Reward、Condition、Effect、Actor和Faction绑定全部为null/空数组及显式unbound，P7地区生态、P8任务/目录和P8F最终化必须逐项兑现后才能装配运行包。

验证器从Artifact反向还原模型草稿，再重建owner、空间、冲突方、Stage链、时长、局部后果目标、主线兼容、全部空绑定和Hash。owner类型不足、未知claim、越界地点、阶段空间越权、主线阻断、解除等待保护、注入Effect键，以及重算Hash后的篡改都会失败关闭。P6不新增物理表，不写ProductRelease或Session。

#### 5.4.11 P7 RegionNarrativePacks与地区内容生态落地

`src/lib/open-world/region-narrative-packs-production.ts`把RegionSkeleton的“有地点”推进为每个地点都具备生活和内容供给理由的地区生态，但不越级生产正式任务或NPC目录：

- `text-open-world.region-narrative-packs-input`只读取同一Build已验收的GameBrief、ExperienceContract、SourceLedger、RegionSkeleton、MainlineThread和SignificantThreads，并优先选择体验、地区和重要故事实际引用的claim；所有Artifact行Hash、内容Hash、claim条目Hash和选择Hash均需复验；
- 每个Region必须且只能拥有一个Pack，并具有独特幻想、地方冲突、地区问题、生活基线和辨识度；模型为每区设计2～5条双方矛盾、2～5条可演化状态轴，代码固定这些状态永远不能阻断主线；
- 每个Location必须且只能拥有一项生活计划，计划继承RegionSkeleton冻结的功能，并补充日常、玩家活动、NPC角色需求、传闻钩子、时段/天气表现和风险。提前到达始终只看到安全的地区常态，不自动触发关键主线或泄露未来结果；
- 角色需求分为important、recurring、functional、ambient四级。important固定由Agent维护、受保护且不能被普通死亡关闭内容；其余固定为按日程、服务和问候规则运行。每区至少有一名重要角色和一名功能或氛围角色，同时至少有一个势力需求；
- SignificantThreads中的character/faction owner reservation必须由且仅由一个所在地区角色/势力需求承接，代码直接复用该稳定owner key；其他需求获得新的全局稳定预留键。这样P8 NPC目录可以精确兑现，而不是依赖名称模糊匹配；
- 普通内容供给按GameBrief首版保底规模冻结：全世界精确6个ordinary quest seed、4个task template seed和12个random event seed，每区至少3条rumor。任务种子写故事包装、实际玩家活动、地点、矛盾、奖励需要与时长；模板写变化轴/资格/冷却；事件写类别、机会和重复策略；
- 代码生成Pack、Tension、StateAxis、LocationPlan、Actor/Faction requirement、Quest/Template/Event/Rumor seed全部稳定键。正式Actor、Faction、Quest、Template、Event、Condition、Effect和Reward引用仍为空并标记unbound，由P8～P9逐层兑现。

验证器反向恢复全部模型语义并重建覆盖、owner承接、内容数量、稳定键、NPC运行分层、主线隔离和空绑定。地区或地点漏项、地区同质化、供给不足、跨区地点、重要owner缺失/重复、私自写Quest/Effect，以及重算Hash后的治理篡改都会失败关闭。P7不新增物理表，不写ProductRelease或Session。

#### 5.4.12 P8 QuestSkeleton与ContentRequirementManifest落地

`src/lib/open-world/quest-skeletons-production.ts`把P5～P7的故事结构转换成“玩家究竟能做什么”和“后序目录必须生产什么”，但在目录尚不存在时不伪造正式运行引用：

- `text-open-world.quest-skeletons-input`只读取同一Build已验收的GameBrief、ExperienceContract、GameplayRulesetSkeleton、MainlineThread、SignificantThreads和RegionNarrativePacks；Context复核全部Artifact行Hash、内容Hash、跨Artifact引用和任务保底数量，再从上游确定性投影Quest Source；
- 每个Mainline Stage、Significant Stage、ordinary quest seed和task template seed必须且只能生成一个Quest骨架。当前“盐脊”验收世界形成7个主线、6个重要故事、6个普通任务和4个模板，共23个Quest；模型不得合并、遗漏或另造来源；
- 模型为每个Quest设计故事动机、目标体验、1～4个Stage和每Stage 1～5个Objective。Objective使用对话、调查、探索、战斗、收集、制作、交易、选择、旅行、交互闭集表达玩家意图，并通过语义需求说明需要的角色、势力、敌人、遭遇、物品、装备、材料、技能、配方、商人、奖励、Action或地点交互；战斗目标必须提出敌人或遭遇需求；
- 代码生成Quest、Stage和Objective稳定键及前后关系。主线和重要故事固定`protected-wait`、不可放弃/过期/永久失败且缺席无压力；普通任务可放弃后重接，地区模板由Director实例化并可重复；到达地点永远不是唯一启动条件；
- `ContentRequirementManifest`不仅汇总Objective需求，也覆盖P7全部角色需求、势力需求和Location Plan。每项需求按照kind明确归属Progression、Encounter、Item/Reward、Crafting/Economy、NPC Runtime、Map Interaction或QuestFinalize任务，同kind同title的冲突定义失败关闭；
- Quest/Stage/Objective的Action、Condition、Reward和运行键，以及Manifest中的正式目录definition key全部为空并标记unbound。P8目录只能兑现自身owner的需求，P8F再把真实定义绑定回任务；模型不得通过额外字段越权提前写引用。

验证器从两件Artifact反向恢复模型草稿，用同一Context重建全部任务来源、生命周期、稳定键、需求合并、消费者覆盖、owner路由、basis和Hash。任务来源漏项、主线保护弱化、无敌人战斗、同名冲突、重复需求、越权目录字段，以及重算Hash后的生命周期或绑定篡改都会失败关闭。P8骨架仍只写Build候选，不新增物理表，不写ProductRelease或Session。

#### 5.4.13 P8成长、遭遇、物品与奖励目录落地

P8前三条Gameplay Catalog Lane把ContentRequirementManifest变成后序任务可以精确绑定的稳定定义，但依然不越权生成跨模块运行引用：

- 三条Lane都正式读取QuestSkeleton。Manifest负责列出需求和消费者，QuestSkeleton补足任务类型、地区、地点、时长与Objective意图；目录Agent不得仅凭需求标题猜测这些上下文；
- `progression-catalogs-production.ts`从PlayerBuild两项初始技能、6个长期等级解锁点和全部skill需求生成Skill Demand。代码固定20级平方经验曲线、按主副属性自动成长、获得来源、稳定键和主动攻击公式完整性；模型只设计技能/状态语义和有界机制参数；
- `encounter-catalog-production.ts`把每项enemy/encounter需求及每区基础遭遇变成一个敌人和一个遭遇。模型选择地区候选地点、敌人原型、1～5级推荐难度、强度和表现文本；代码计算生命/攻击/防御/暴击/先攻，绑定已生成基础攻击策略，保证所有战斗Objective和地区均被覆盖，固定标准难度、可逃跑、战败重试或复活，并预留奖励/掉落；
- `item-reward-catalog-production.ts`兑现PlayerBuild初始武器/恢复品及全部item/equipment/material/reward需求，并为每个任务、每个遭遇生成Reward Contract候选，为每个敌人生成地区材料Drop Table候选。关键任务物品固定不可丢弃/出售；每个物品必须拥有初始、任务奖励或敌人掉落来源；
- 经验、货币、装备加成、敌人数值和掉落数量由代码拥有。7个主线任务按时长权重精确分配1600经验，保证验收世界从1级达到5级；任务技能自动进入对应Quest奖励计划；模型只能补物品/奖励语义和受限可选物品；
- 所有Skill Action/Effect/Condition/Quest unlock、Item使用/装备Effect、Enemy DropTable正式键、Encounter Quest/Reward键、Reward Effect与Drop数量Effect仍为空并标记unbound。P8F必须在后续制作经济/NPC/地图目录完成后统一生成并双向校验这些引用。

三条验证器都能从Artifact反向恢复模型草稿并重建确定性目录。需求漏项、主角预留改写、非法技能公式/装备位、战斗地点越界、敌人数值漂移、物品无来源、任务/遭遇漏奖励、主线经验预算不闭合、正式引用提前注入，以及重算Hash后的篡改都会失败关闭。三条Lane不新增物理表，不写ProductRelease或Session。

#### 5.4.14 P8后半目录与P8F任务/发牌最终化落地

P8后半目录已补齐制作经济、NPC运行和地图交互：配方/商店保证物品来源、消耗、定价、库存和反套利闭环；NPC保留整体人物小传，区分重要Agent与普通规则角色，冻结关键保护、四时段日程、三档态度与功能替代；地图目录原样保持Region/Location/Edge/FastTravel拓扑，覆盖每个地点入口，并固定逐步揭示、提前到达安全、旅行推进时间、快旅到访解锁和程序SVG布局。这三类目录与前三类一样，在P8只交付稳定定义，运行引用保持unbound。

`quest-finalize-production.ts`现以不可切分的原子Context读取Mainline、SignificantThreads、RegionNarrativePacks、QuestSkeletons、ContentRequirementManifest和六类Gameplay Catalog，对11件Artifact逐一校验行Hash、内容Hash、产品实例及精确上游来源。任意一件超出任务输入预算时失败关闭，不会把JSON从中间截断后交给模型；生产调度器传入实际任务预算。P8F当前初始执行使用1次模型调用，但获得12/156的token份额，以容纳不可切分的完整任务上下文；完整Build的154次初始调用上限主要用于P1来源分批与P9逐Scene硬隔离，调用扇出不等同于叙事内容预算比例。

模型在P8F只能提交任务/Objective描述、Objective成功语义、发牌预算/触发类型、模板类别/强度/权重/冷却及随机事件语义；任务键、目录键、条件、效果、行动、数值、生命周期和引用均属于代码。确定性编译器完成：

- 23个Quest、全部Stage/Objective及其前置、完成、奖励领取、放弃、过期和时间定义；
- 遭遇启动/结算/奖励、玩家与敌人技能、战斗道具、逃跑、复活和休息行动；
- 物品使用/装备/卸下、配方学习/制作、商店买卖、NPC对话、地点交互、普通/快速旅行、天气和角色日程结算；
- 所有需求到真实目录定义、再到Condition/Effect/Action的双向覆盖。

`DirectorDecks`按地区从P7种子冻结固定普通任务、可实例化模板和随机事件，并写入显示/活跃并发上限、全局实例上限、冷却、高强度连续限制、历史去重与空白牌。主线和重要故事明确排除于Director压力；普通发牌的运行参数已就绪，场景文字、谣言表现及每个模板的3份文字变体显式留给P9，不在P8F冒充完成。验证器会重建完整Artifact，因此漏Objective、超预算、越权字段、非法任务升级或在重算Hash后篡改生命周期/发牌结果仍会被拒绝。P8F仍只写Build候选，不新增物理表，不写ProductRelease或Session。

fresh受治理任务包不再只保存“后续任务有前置条件”，而是用Action v18把受保护故事的揭示链编译成可运行图。主线依来源Stage order建立唯一初始`revealed`根，其余主线与全部重要支线初始`locked`；后续主线依上一主线完成，重要故事首任务依该线声明的主线开放窗口，后续任务依同线前驱。每个锁定任务必须且只能有一个编译器生成的系统`action.reveal.*`，按顺序执行`locked → available → revealed`两个Effect。它无地点、无时间/资源消耗、无失败分支，不进入Choice或自然语言候选，只由任务系统在前置完成后自动结算。旧Action≤17和历史durable Context不被重新解释。

Knowledge编译同时将“最早可传播”与“何时可确认为事实”分开验证。Stage门槛必须由该Stage唯一来源任务的`completed`状态兑现；同Stage任务的领奖发生在完成之后，因此可作为确认owner。主线Knowledge只能由同Stage或更晚的主线领奖、或处于全部主线门槛之后的最终结局确认；重要支线Knowledge只能由同故事线且不早于门槛的任务领奖确认，全局结局不能代替该线进度。每个`reveal-knowledge`或`earn-achievement` Effect必须只有一个真实执行owner：对应任务独占的RewardContract/领奖Action组合，或精确结局Action；RewardContract和领奖Action不得跨任务共享，Director与犯罪后果不得成为第二条执行路径。

fresh Knowledge运行包使用Director v3：每条受治理传闻事件冻结唯一地区和其中唯一传播地点，并唯一进入对应地区牌组。该牌组必须包含`rest`触发，编译器拥有的`action.rest.standard`不绑地点且可重复，所以玩家到达传播点后始终存在可发起抽牌的正式行动；权重、空白牌和冷却仍决定传闻何时真正被抽中。运行时的候选生成、弱授权复核和Replay均再次匹配当前地点。Director v2继续保留历史地区级事件语义；它可在内存中归一为空`locationKeys`，但冻结v2 payload时必须删除该字段，使原字节形状和content Hash保持不变。

#### 5.4.15 P9场景脚本、知识边界与统一交互结果源落地

P9把已经可运行的任务与地区Director结果图转换为玩家可读、可选择的叙事表现，但不允许表现层重新定义玩法结果。`scene-scripts-production.ts`先在代码侧读取并验签SourceLedger、ExperienceContract、StoryArc、RegionNarrativePacks、QuestSkeletons、ContentRequirementManifest、NpcRuntimeCatalog、MapInteractionCatalog、QuestDesignDocuments和DirectorDecks；随后生成去重的Scene Demand、Knowledge Boundary、自然语言Action Demand、模板文字变体和随机事件表现需求。完整上游不会截断，重复且与模型写作无关的Condition/Effect等确定性字段只在代码侧校验，模型接收的是仍可追溯到原Artifact Hash的紧凑投影，因此验收世界能够在P9实际112000 token输入预算内原子交付。

确定性编译器为每个Quest生成委托与收束场景、为每个Objective生成推进场景、为每个NPC生成含`bad/neutral/good`三档态度开场的对话场景、为每个地点交互和随机事件生成入口与表现，并兑现Director为每个模板预留的3份差异化文字。每个Scene只引用当前允许的Source Claim，显式携带禁止提前透露的后续Objective；随机传闻只有存在需求时才能生成且固定为不确定信息。

SceneScripts生产Context自G4-03收口后使用v2确定性语义：同场景多个Action的条件交集才是Scene availability，各Action的其余条件仍只约束自己的Choice；Objective participant只来自该目标显式Actor需求且与场景地点一致，Quest owner不再被无条件复制到所有目标；角色拥有的委托与收束端点则固定在owner常驻地点，Quest地点继续描述冒险主体。因此战斗完成条件尚未成立时仍能看到启动战斗Action，任务不会因委托人缺席而隐藏，发布者也不会被要求瞬移到任务首地点。已冻结的v1 Context继续按旧投影规则和旧Quest首地点/地区端点验签，保护未完成durable Run与历史Artifact复验；旧产物无法仅凭Narrative v2/Action v15版本号与新产物区分，因此玩家投影会依Action条件交集、Objective与Actor对话场景共享的冻结Action引用及Actor居所兼容归一旧P9场景，同地或异地误注入owner都不会成为目标门槛，旧的异地委托/收束也会回到owner常驻地点。

如果旧Scene的冻结地点与归一后的owner常驻地点不同，其模型正文可能仍明确描写旧地点。运行投影必须把这种场景标为`legacy-endpoint-fallback`，隐藏可能矛盾的旧开场/正文，并展示地点中性的确定性兼容文案及可见提示；它不能无提示地改换地点后仍把旧文字标成当前冻结正文。未发生端点迁移的新Scene继续原样消费P9文本。

`ChoiceContracts`中的每个固定选项都精确引用P8F Action Definition Hash，并继承该Action的Condition与确认策略；`ActionBindings`则把系统Action按钮、固定Choice和自然语言候选统一绑定到同一Action结果权威。自然语言只能选择当前投影中已存在的非战斗Action并交回确定性运行校验：高置信度低风险才可执行，高风险/不可逆操作必须确认，低置信度只自然回应并推荐正式Action，无法映射时不得创建Action、任务、地图或写状态。全部战斗Action保持按钮操作，不开放自由描述。模型漏场景、重复自然语言示例、缺少三档态度、无依据传闻、越权输出运行字段，或重算Hash后篡改Action/Choice引用均失败关闭。P9继续只写Build Artifact候选，不新增物理表、不写ProductRelease或Session。

P9的作者修订路径接受一份完整聚合JSON，而不接受一组无法证明闭合的局部文字。scheduler只在blocker、Run、control epoch、Plan task和Skill身份全部一致时交付`authorDraftJson`；P9在governed或legacy模型分支之前直接用同一`parseDraft`和确定性编译器校验它。这个attempt不产生模型或媒资调用，输入/输出token和最大费用均为0，但仍保留真实duration与storage预留。作者稿Hash进入结构输入Hash与幂等键，完整稿在执行前记录为durable `source-snapshot`；无效稿按同一Schema、引用和语义门阻断，不会回落为隐藏模型请求。

对于已由provider返回、但在返回后才发现超出本attempt的token或费用预留的P9响应，Harness必须先持久原始响应和真实usage，并把已付用量记入共享账本，再阻断超额候选。Schema、引用或预算验证失败都不得抹掉已经发生的付费证据；剩余任务预算不足时不得继续隐藏重试，请求结果未知时则保留全额预留等待作者裁决。

#### 5.4.16 P2表现轮廓、P10系统收口与V1/V2质量门落地

此前生产DAG虽然声明了表现轮廓和系统收口任务，但缺少可运行的P2 `PresentationProfile`。现已补齐正式Context、Skill和Executor：模型只能提供主题、语言与消费槽降级文案，代码冻结系统Action、固定选项、自然语言对话三类输入，战斗/逃跑/技能/道具四类战斗控制，以及18个创作端和玩家端UI消费槽。表现Artifact不拥有任何玩家状态或玩法结果。

P10 `SystemFinalize`完整验签GameBrief、ExperienceContract、GameplayRulesetSkeleton、PresentationProfile及P4～P9共17件已验收Artifact，并由代码生成三件系统资产：`SystemConfigs`精确映射15个G2运行模块和18个UI消费槽；`MediaRequirements`为程序地图、全部NPC头像和每个地区场景背景生成必需槽，同时要求每槽具备文字、程序或占位降级，因此媒资生成失败不阻断纯文字可玩；`ContentBudget`把作者生产的全部任务/模板变体库存与玩家单次实际可达内容分开，避免把同一模板的多份包装重复计算成一次流程时长。模型只为这些由代码派生的媒资槽写创意简报，不能增删消费槽、模块或预算。

V1 `DeterministicPreflight`不调用模型，先检查Schema、Artifact Hash链、全部Action/Condition/Effect引用、Action v18唯一主线揭示根、全部后续主线及重要故事的系统揭示Action、前置图无断点/分叉/环、内容预算和全部消费槽可解析。任何一项失败时禁止进入模型质量评审。

V2在V1通过后分别运行平衡和叙事语义评审。平衡评审覆盖成长、战斗、奖励、经济、可解性和内容供给；语义评审覆盖来源忠实、主线弧、重要故事、地区差异、任务体验、对话知识边界、重复度和时长引导。分数低于70为阻断，70～84必须给出可定位问题；代码而非模型决定问题对应的唯一生产任务，并沿正式DAG计算传递stale闭包。修复只产生同一Production中的新Build候选，已验收Artifact保持不可变，修复后必须重新执行V1与双评审。模型评分不能代替真人游玩时长校准，后者仍是发布阶段的独立证据。

#### 5.4.17 G3-18专属生产入口、V3装配与端到端恢复落地

G3-18把此前逐项完成的生产零件接入共享正式Harness，而不是建立第二套调度系统：

- 共享scheduler在创建计划时按产品类型选择`createTextOpenWorldProductionPlanV1`，正式Service在执行时选择`createTextOpenWorldProductionExecutorV1`；其余产品继续使用通用Plan和Executor，产品边界在调度与执行两层均显式可验；
- P0 Executor读取当前Production唯一已授权Brief，按其中的来源选择动态展开精确SourcePinUnit任务，先落单元、后落SourcePin索引闭合标记。WorldRelease与小说仍遵守各自读取边界，Pin、单元及Brief Hash必须一致；
- 同一dispatcher覆盖P1～P10、V1双评审、V3和QA。共享checkpoint、候选、验收与terminal receipt协议保持不变；在P1候选检查点后注入崩溃再恢复，P1不会重复调用模型，后续26项专属任务可以继续完成；
- P1的每次真实模型批次各自拥有精确ContextManifest、请求/响应快照与尝试号；allow-list在确定性目录读取阶段真实生效。失败批次重试不会覆盖旧证据，恢复只复用已经成功的批次，最终采纳只汇总每批最新成功尝试；
- P8F生成每个结局独立Condition及`route→unlock→reach` Effect/Action，P9再把最终场景、固定Choice、系统Action和自然语言示例绑定到该唯一Action。V1检查全链引用，V2读取完整结局表现；V3不得临时创造结局。Narrative v2完整冻结P9场景正文、三档NPC对话、知识边界、随机事件与传闻；Action v15+冻结三类输入绑定，当前fresh治理出口以Action v18补齐受保护故事揭示链，并以Director v3冻结传闻地点；
- P10把完整媒资槽清单和本次实际排产分开：未排产项显式为`fallback-only`，实际生成槽数与冻结Brief/Plan精确一致；`none/music-sfx/full`分别形成0/4/9个音频槽。媒资任务把这些槽翻译为共享媒资执行协议，首版语音保持0并在启用前失败关闭；
- V3逐件核验实际媒资的物理Blob、Capability需求、任务生产回执、Provider回执和权利策略，再把真实资产写入ProductRuntimePackage的冻结`presentation.assets`。IntegrationReport自身、权利明细和覆盖结论各自有Hash；原型/内部档的文字或程序降级只计可玩覆盖，商业候选必须以真实资产覆盖全部必需视觉及Brief已排产音频，降级不得冒充商业完成；
- V3只从已验收Artifact确定性装配15个G2运行模块、兼容叙事壳和`textOpenWorldVNext`能力，不生成旧interaction/adventure/evolution/openWorld四份重复运行状态。旧混合包仍可解析，vNext-only包可独立进入玩家库、ProductRelease与Session，新Session只创建统一`textOpenWorld`投影；
- 端到端证据覆盖完整调度、断点恢复、Package/Quality Artifact、Build Preview媒资解析及真实Session启动。QA逐门重验Package、主线/结局、IntegrationReport和权利证据，不再把所有门直接标为通过；媒资覆盖不足只形成preview-ready，商业候选还必须在发布阶段补真实浏览器、主路线和媒资运行回执。ProductRelease仍只由发布动作创建。

至此G3“来源→故事→任务→玩法目录→场景→可运行Build”出口闭合。下一阶段G4只消费统一运行包与Session能力建设真实玩家端，不回头复制生产逻辑。

#### 5.4.18 G5-04 Creator生产启动、进度与恢复落地

G5-04没有复制第二套叙事scheduler，而是把G5-01～G5-03的Creator事实原子接入G3共享生产链：

- 专属启动页先要求作者选择`author-owned`、`licensed`或`public-domain`来源权利依据并填写说明。零写入预览复验当前Creator Brief、来源locator及生产预检，把作者意图确定性投影成不含本地ID的便携Creator SourcePlan和只供共享scheduler消费的`ProductProductionBriefV3`兼容Brief；后者的`worldReleaseId=1`只是满足共享parser的非定位占位值，P0/P1只能读取SourcePlan与注册表重映射的locator。随后生成精确P0～P10/V1～V3/QA动态Plan，依赖、并行组、模型、预算、完成条件和Plan Hash在写入前可见；
- 正式开始重新CAS Production state revision、Creator Brief revision/Hash、WorldRelease或小说版本与边界、当前AI任务路由/凭证来源、模型绑定、报价预算、四项确认和预览Plan Hash。模型身份比较覆盖规范化完整route、query/fragment/userinfo变化、temperature、configured max tokens和`contextWindow`，实际调用复用这份已核对resolution，不能在下层再次解析成另一条路由。覆盖来源存储、Production、Brief、Command和Build的同一事务原子冻结Creator SourcePlan、Creator Start、Plan、授权Build和命令receipt，并把Brief标为authorized、Production推进为producing；该事务不调用provider。确定性command ID让重复提交只回读原receipt，不能重新授权；
- Creator Brief继续是作者意图与产品边界的权威；兼容Brief不能反向改写它。P0从已验签的Creator Start链读取来源与权利，Plan继续令`mediaCostAuthorized: false`，头像、背景和音频费用仍由G5-08实际排产；v10导入在事务前校验SourcePin/Unit逐行payload、contentHash、owner及同Build/epoch闭包，通用SourcePlan内嵌WorldReference由`PROJECT_TABLES`重映射，Creator Start与SourcePlan保持原字节。这次落地复用现有Production、Brief、Command、Build、Artifact、AgentRun、checkpoint与ledger，没有增加物理表、Schema或migration；
- 专属工作流以精确`productionId`进入`productionOnly`工作台，不回退通用新建或最近Production；锁定ID缺失、被过滤或已失效时显式失败并停止队列。进度投影逐任务显示依赖、lane/并行组、最大尝试、超时、当前step/attempt、尝试历史、最新durable边界、checkpoint verified/invalid、stale原因和预算实耗；scheduler仍以必需receipt和subject lock约束真正可运行集合；
- scheduler把请求前后拆成可恢复付费边界：claim后未开始step时复用同一Run；已开始但尚未派发且超时可以安全恢复；已派发而结果未知时保留reservation并停机，不自动重发；provider响应和真实usage先于解析、验证与证据检查计账，候选checkpoint尚未形成时也停机；已验证候选checkpoint则跳过executor/provider，直接继续验收或下游。P1来源批次与P9场景分片采用登记的有界多调用协议，只重跑未完成分片并按当前attempt剩余额度缩减请求；作者P9聚合稿零模型调用。预算账本在同一Build内按taskKey跨Run/epoch累计paid charge与未知结果reservation，调用、token、费用、时长和存储都不能通过恢复重置；durable请求标记后、真正进入executor前再次核对Production/Build所有权，跨标签页pause/stop不会越过本地dispatch边界；
- pause/resume先递增control epoch，旧epoch只显示stale且不能继续写，新epoch复用已验收Artifact。恢复命令精确绑定失败Run/rootRun、epoch、Plan Hash、task和attempt。已有可选`product-production.repair-feedback`仅作为隔离、不受信任数据进入原子上下文；作者完整JSON跳过provider但仍走同一解析、验证、候选checkpoint和来源记录。两者只开放给登记的P2～P10单次文本创作task/Skill组合，P1有界协议、V2评审、确定性任务和媒资任务只允许原冻结输入重试；Production或epoch变化会清除尚未提交的本地修复输入。

因此G5-04关闭的是“作者可审查的正式启动与可恢复执行”，并不把生成内容浏览、编辑、影响分析或媒资生产提前并入同一工作包。下一项G5-05只读投影当前Build的受治理`productBuildArtifacts`，G5-06、G5-07和G5-08再分别承担编辑、stale/局部修复与媒资。

#### 5.4.19 G5-05受治理Artifact浏览与验收证据落地

G5-05在Creator生产工作台加入只读、快照绑定的三视图浏览器，没有复制生产数据，也没有把浏览器变成新的采纳入口：

- “内容”视图把通过生产合同验证的当前Artifact投影为故事、地区、角色、任务、场景、玩法目录等可读实体，显示稳定ID、公开字段、来源证据和跨实体引用；“Artifact”视图检查不可变信封、版本、owner task、Run、Hash和媒资指针；“诊断”视图集中显示pending、stale、损坏、悬空引用和仅通过完整性检查的记录。三者共享同一个`snapshotHash`、安全搜索、过滤、分页、键盘与窄屏主从导航；刷新失败保留上一次成功快照，不用部分读取覆盖它；
- Artifact状态明确拆为两个维度：完整性状态只说明当前epoch、作用域、Schema、内容Hash、Run/checkpoint/receipt、来源、lineage与稳定引用可由当前数据库证据重算；生产验证状态只在Artifact由文字开放世界官方P0～QA Plan、唯一owner task及其冻结输入/输出/门条件闭合时成立。自定义或历史Plan即使字节与Hash完整，也只能标为“仅完整性”，不得进入“内容”投影；stale、invalid、corrupt和dangling同样不得冒充可审查内容；
- 验收不再只信任Artifact行上的`contentHash`和`producerReceiptHash`。非媒资内容Hash由完整payload重算，媒资还复核Blob；producer proof把官方Plan、task输入与精确输出集、ledger root、完整Run事件流、已验证candidate checkpoint正文、projection/resume正文、task terminal receipt和当前control epoch一起纳入验收期间的CAS复核。事件、checkpoint或root Run在读取与提交之间发生变化时，事务零写入失败；
- 已完成Build的root terminal receipt使用v2信封封存全部active Artifact的payload、metadata、quality、rights、媒资、lineage及生产回执Hash；跨Build携带还必须匹配Plan owner、terminal ledger、manifest member、portable root seal和父Artifact精确字节。旧v1终端封印不包含这组完整证据，不能被静默提升为新的跨Build携带依据；需要携带时必须以当前协议重建并重新封存来源Build，已发布旧Release的只读运行兼容不因此被改写；
- terminal verifier在root回执落库后重新读取并复核最终`$join`输出、root Run/完整事件流、所有producer/synthetic Run及checkpoint，最终事务不再豁免root行。直接携带和终态跨Build携带都会读取父Build的全部active Artifact，而非只读被复用的单行；父Build任一active Blob物理对象损坏，目标Build都保持零写入；
- 物理媒资证明覆盖终态Build经lineage闭包依赖的全部Blob，包括未出现在`RuntimePackage.presentation`中的内容Artifact Blob。IndexedDB媒资在最终写事务中逐字节CAS，OPFS媒资在事务开启前立即重读并在事务内CAS其内容寻址路径、Hash、大小和行元数据；这依赖正式写入口只创建内容寻址不可变对象，不把外部任意OPFS写入宣称为数据库原子能力；
- P0来源规模与checkpoint能力使用同一个硬边界：最多512个单元、合计400万字符，最大候选32,650,752 B，小于共享32 MiB限制；治理读取另设当前行、lineage、Run、事件、checkpoint、实体与公开DTO预算，超限以可定位诊断或失败关闭结束，不能无界加载并把截断结果声明为完整快照。

这些“通过”只证明确定性生产合同和证据链成立，不证明叙事好看、文学质量高、平衡理想或真人体验达标。V2语义/平衡评审与G5-09质量闸门/灰盒试玩继续提供质量证据；G5-10现已把通过质量门的Creator Build封印为双来源便携ProductRelease，不使用兼容Brief中的非定位占位`worldReleaseId`冒充来源。G5-05保持只读；G5-06和G5-07分别承接编辑交接与局部修复Build，G5-08生产媒资，G5-09裁决发布质量，G5-10执行作者确认和不可变发布。

#### 5.4.20 G5-06 Creator Artifact受治理修改与影响分析交接

G5-06在G5-05只读投影之上增加编辑能力，但没有把UI变成正式表写入口，也没有原地改变当前Build：

- 可编辑目标必须来自当前Work、Product、Production、Build的官方生产验证Artifact，并精确定位到一个领域实体及其owner sibling group。首版覆盖P2～P10中19个作者可修复生产任务和29类Artifact；每类Artifact由自身领域模块声明作者可改字段、投影和完整重建函数，不建立跨领域万能JSON编辑器。只允许replace有界标量或字符串数组；稳定ID、实体集合和顺序、跨实体引用、治理证据、来源Claim及模型/Run元数据都不可修改；
- 直接编辑是零模型的确定性路径。Agent修改只通过登记的`text-open-world.creator-artifact-edit`上下文读取精确目标、公开的作者可改投影和作者指令，并由登记Skill与Formal AI Entry执行；intake冻结provider、model、endpoint origin和execution config hash，恢复时不重新咨询live注册表。模型只返回受限patch候选，不能提交Artifact或Production；
- 两条路径都将原始目标、patch、完整重建后的owner sibling group、领域验证结果、identity delta、reference delta和费用证据保存为durable候选。作者可以在同一候选上继续作确定性修订，也可以拒绝；任何非法类型、未声明路径、重复路径、超量值、实体/顺序/引用变化或领域解析失败都在正式状态变化前失败关闭；
- 作者确认不是`adopt()`到当前Build。确认在同一事务中CAS当前Product/Production/Build、Artifact字节、候选revision/Hash、Run事件头和同组冲突，再写不可变确认意图及impact-analysis handoff；当前Artifact、Build、正式Product表和运行包保持原字节。G5-07必须消费这份交接，计算受影响闭包并创建新的修复Build，不能回头把确认解释成原地写入授权；
- 每个修改Run持久化selection、instruction、ContextManifest、request/result/response、candidate checkpoint、作者修订、拒绝/确认、terminal receipt和memory settlement。provider明确失败会记录失败顺序后终止；已派发但结果未知保持unknown并禁止自动重发；尚未派发的静态intake即使来源resolver暂时不可用也可零费用取消。相同owner group跨实体、跨目标及刷新后的未决Run互斥；unknown结果或已有确认意图会阻断冲突任务，替换谱系有循环和深度保护；
- UI嵌入Creator Artifact Browser，只在选中目标通过实时preflight时展示合法字段编辑器、Agent指令、候选差异、确定性问题与显式恢复动作。刷新不会自动恢复或派发模型，只有作者按钮才执行resume；确认后显示影响分析等待状态并隐藏冲突动作。所有服务经`product-production`门面进入，页面不散写IndexedDB。

本项证明的是“修改意图被安全捕获并形成可追责交接”，不是下游已经修复。G5-07现已消费该交接并落实影响闭包、stale传播、新Build局部重跑和再次验收；媒资内容与权利仍属于G5-08，发布仍属于G5-10。

#### 5.4.21 G5-07 Creator影响闭包与局部修复Build

G5-07已经把确认交接接回同一套P0～QA生产Harness，并保持“AI提议、代码裁决、作者授权、新Build承载”的单一事实链：

- 只有G5-06已确认且完成结算的impact-analysis handoff能够成为修改目标。系统按冻结Plan中的依赖边计算包含目标自身的传递stale闭包；V2质量问题和作者编辑共用同一个代码函数，不允许Prompt、Agent或UI各自解释“哪些内容受影响”。同一owner task只消费一张交接，同批祖先/后代修改被拒绝，避免用将被改写的上游同时证明下游候选；
- 影响计划是便携、严格、Hash闭合的结构化Artifact，记录base Build封印、目标siblings前后Hash、handoff/intent/candidate/verification receipt、target/stale/reuse三分区和重跑预算。完整sibling group随目标进入新Build，但未触及的siblings可以保持原Hash；交接整体至少有一项真实变化。UI显示完整闭包和费用上界，并要求独立于“确认修改内容”的第二次范围确认；
- base Build不能只靠状态字段冒充完成。影响预览复用G5-05完整生产治理，要求全部Plan输出均通过官方生产验证和terminal v2封印；随后对Production、Brief、Build、全部Artifact、编辑Run/event/checkpoint/evidence及历史修复命令做预览前后读集比较。正式命令在同一事务再次CAS这组事实，stale时不创建半个Build或候选行；
- 正式命令创建`buildNumber + 1`的不可变子Build，冻结局部修复Plan和作者授权，并原子暂存每个目标的完整确认siblings。目标task在scheduler中作为零provider工具结果运行，但仍保留新的child Run、source snapshot、tool call/return、candidate checkpoint、验收receipt与accepted Artifact；候选checkpoint后的崩溃恢复沿用同一Run，不重复调用、采用或计费；
- stale闭包内的非目标task继续使用原Skill、Context、Executor、预算和验收门重新生产。闭包外task只能从直接父Build按terminal v2 lineage逐项携带，并在新Build生成新的零调用task receipt；P0 SourcePin等确定性任务也不能跳过这一步。修复authority递归绑定全部历史授权命令、base sibling、reuseKey和staged candidate，任一证明被改写都会终止调度；
- 原Build、旧Release和已有Session不会被改写。新Build完成仍只是新的受治理Preview候选，叙事质量、平衡、真人体验和发布资格继续由G5-09/G5-10裁决。G5-07没有新增万能内容表、Context Source或AI写入口，运行结果也不会回写世界引擎。

#### 5.4.22 G5-08 Creator媒资Build与叙事消费边界

G5-08不让图片反向成为叙事事实。P10已经从角色与地区目录声明完整媒资需求，Creator媒资工作区只选择冻结计划允许实际生产的一个地区背景和一个角色头像作为首版visual sibling group；叙事身份、角色设定、地区事实、场景脚本和任务引用仍由上游结构化Artifact持有，图片模型或作者文件都不能新增、删除或改写这些内容。

作者完整导入与AI完整生成共用同一媒资计划、DAG影响和新Build授权。导入必须逐槽验真真实图片字节并冻结alt、来源、许可和权利依据，执行时零模型调用但仍产生正式Run/checkpoint/receipt；生成必须绑定当前可信图片Provider和正费用上限，并沿用共享媒资执行、账本与恢复边界。两条路径都只替换`media.visual`完整sibling group，随后重新装配V3运行包并执行QA，闭包外叙事任务须逐项跨Build复验，不能因为“只换图”跳过来源和终态证明。

程序地图继续由确定性SVG目录覆盖，音频在首版保持显式静音降级。旧Build、Release和Session不可变；新Build中的媒资Hash、格式、权利与槽位闭合只证明可消费性，不证明画面与文本叙事匹配或美学质量达标，后者必须由G5-09的语义质量门和隔离试玩回执提供证据。

#### 5.4.23 G5-09叙事质量决定与真人灰盒证据

G5-09不让模型为自己的故事签发最终通行证。生产期平衡/叙事双评审仍是结构化建议来源；代码重新核对评审Artifact、最低分、阻断finding和确定性QA。任何模型阻断项都必须通过新的修复Build处理，建议项可以进入首版，但作者必须逐条说明接受理由，并同时确认主线引导、地区与任务差异、角色对话/知识边界、媒资降级和问题清单已经人工抽检。

真人灰盒证明来自当前Creator Build Preview的真实运行事实：连续事件可重放、缓存状态头与规范状态一致、Checkpoint有效、至少一条主线到达结局，且组合覆盖受治理Action、地区探索、战斗、成长/经济与刷新恢复。证据只保存稳定键和Hash，不把自然语言正文、来源原文、玩家输入或Session本地ID复制成第二份叙事记忆。

试玩问题以可复现回执进入产品私域。阻断问题不能用作者声明绕过，非阻断问题必须逐项说明；最终质量回执绑定当前Build、双评审、真人抽检、灰盒和完整问题集合。任何新问题或证据漂移都会使旧结论失效。因此“叙事质量通过”是当前版本证据闭合的发布决定，不是模型对文学水平的永久判断，也不会反写世界引擎或已发布内容。

#### 5.4.24 G5-10叙事资产的发布封印

正式发布不再次让模型总结、压缩或改写故事。Creator Release直接封印生产期已经验收的叙事与任务Artifact receipt集合、P1实读清单、V3装配报告和G5-09质量回执，并用作者最终授权把这些证据绑定到同一个RuntimePackage。这样，主线、重要支线、地区生态、普通任务、场景脚本、对话和知识边界在Build Preview与正式玩家Session之间保持逐Hash一致，不会在发布按钮处产生第二版“发布文案事实”。

世界来源的正式血缘指向冻结WorldRelease身份；小说来源的正式血缘指向SourcePin版本、选择边界和逐单元Hash，不伪造世界版本。小说正文仍由产品私有SourcePin Unit Artifact保管，不进入面向玩家和分发的Release manifest。Release reader会重验叙事消费槽、Artifact集合、装配与质量链；任何任务脚本或故事Artifact被替换都必须形成新Build、新质量决定和新Release，旧Session继续绑定旧版本。G5-11只允许不改变既有叙事节点、Choice条件/Effect、任务与状态语义的表现修复迁移；迁移生成新Release子Session并保留原叙事历史，绝不改写已经发生的事件。

#### 5.4.25 G5-11叙事版本维护与历史边界

发布后修改仍从受治理叙事Artifact开始，经影响闭包形成子Build，再完整重走语义评审、真人灰盒、作者发布确认和不可变Release。模型不能直接编辑Release，也不能用“兼容”标签绕过稳定键比较。首版兼容迁移只覆盖文案、图片、音频和Presentation替换；主线Stage、任务目标、Condition/Effect、规则与数值任一变化都让旧Session继续固定旧Release。

迁移时，新Session使用目标Release的冻结叙事定义，但只接续已验证的玩家进度快照；旧事件不会复制成一段伪造的新历史。新Session以父Session和原事件序号作为来源边界，原分支仍可继续游玩或回看。这让叙事修复可进入后续新事件，同时保留“玩家当时在旧版本实际经历了什么”这一不可变事实。

#### 5.4.26 G5-12叙事资产便携与导入复验

导出不会让模型重新概括叙事，导入也不会重新生成主线、支线、地区生态、任务或SceneScript。便携包保存原Artifact信封、生产Run/Checkpoint/receipt图、SourcePin逐单元Hash和正式Release封印；本地ID按照注册表生命周期统一重映射，但叙事稳定键、payload Hash、来源边界与Release内容保持不变。任何SourcePin、任务Artifact、预算账本、发布封印或存档迁移Canon被改写，都必须在项目写入前整体拒绝。

由于Run主键和Blob定位器属于本机证据，终态Build导入后先显式处于“证明待恢复”状态，不能直接Preview。确定性恢复不调用模型、不消耗新预算，也不把旧叙事压缩成新的摘要；它只按新本地身份重新验证Checkpoint、Artifact/Blob、完整terminal lineage和root seal，并附加精确的导入复验尾证。旧ProductRelease和玩家已经经历的Session历史仍不可变。项目删除则完整清除产品私域叙事生产、发布和游玩证据，同时不回写世界或小说来源。

### 5.5 正确的验证顺序

```text
模型返回
→ 协议和Schema预检
→ 确定性引用/范围/预算预检
→ 语义评审
→ 需要时生成修复候选
→ 对修复结果重新执行确定性和语义验证
→ adopt()
→ post-state证据
→ terminal receipt
```

不能在语义评审完成之前把 Artifact 标记为已通过。

---

## 6. 叙事和任务模型

### 6.1 内容层级

```text
ExperienceContract
└── StoryArc
    ├── EndingContract × N
    ├── MainlineThread
    │   └── StoryStage → QuestDefinition → SceneScript
    ├── SignificantThread × N
    │   └── StoryStage → QuestDefinition → SceneScript
    └── RegionNarrativePack × N
        ├── FixedQuest
        ├── QuestTemplate / DeckRule
        └── AmbientEvent / Rumor / Encounter
```

`StoryThread`解释一个长程故事如何变化；`QuestDefinition`解释玩家实际要完成什么；`SceneScript`解释一次可游玩的场景如何展开。三者不能压缩成一个通用 narrative node。

### 6.2 主线

第一阶段主线必须：

- 采用严格顺序 Stage；
- 有一个受保护的核心目标；
- 允许生产时预先设计多个符合核心目标的结局；
- 允许战斗或局部任务失败后重试、复活或读档；
- 玩家长期搁置时等待，不制造强制主线倒计时；
- 关键 NPC、关键线索和关键道具拥有保护策略；
- 不把“首次到达地点”作为唯一关键触发；
- 任何非关键支线状态都不得永久阻断主线；
- 每个 Stage 都有进入条件、完成条件、失败边界、回收点和下一阶段契约；
- fresh Action v18按来源Stage order冻结一个初始可见根和严格前驱链，后续主线任务只能在上一主线完成后由系统以`locked → available → revealed`两步公开。

### 6.3 重要故事线

重要故事线按 owner 分为：

- 角色故事线；
- 势力故事线；
- 地区故事线；
- 跨地区主题或事件故事线。

势力和地区故事线不通过“为所有成员各开一个 Agent”实现，而通过以下结构表达：

```text
长期矛盾
→ 参与方目标与资源
→ 当前阶段和升级条件
→ 少量代表角色
→ 可观察信号：传闻、环境、价格、巡逻、对白
→ 玩家可介入任务
→ 确定性后果
```

第一阶段重要故事线不可由玩家主动删除，也不会因为玩家长期不介入而永久失败。它可以随世界时间推进到预先设计的安全等待点，但必须在该处等待玩家；显式参与后的分支和局部结果仍由故事线契约声明。fresh Action v18中，每条重要故事有且只有一个主线开放窗口根，其余任务只能跟随同故事线的前一任务；任意跨线前驱、断点、分叉或环都在发布前失败关闭。

### 6.4 任务四维分类

| 维度 | 值 | 用途 |
|---|---|---|
| 叙事等级 | mainline / significant / side / random / ambient | 质量、保护、长期记忆 |
| 内容归属 | global / character / faction / region / location | 上下文和影响范围 |
| 时间策略 | waits / timed / periodic / immediate | 时间推进与过期 |
| 生命周期 | non-abandonable / re-offerable / permanently-failable / cooldown | 合法状态迁移 |

这四个维度必须是独立字段或独立可计算属性，不能用一个 `type` 字段同时承担。

### 6.5 任务状态机

```text
locked
  → available
      → revealed
          → accepted → active
                         ├→ completed
                         ├→ failed
                         └→ suspended → active
          ├→ abandoned
          ├→ expired
          └→ withdrawn
abandoned → available → revealed（仅可重接普通任务）
```

约束：

- 主线不允许 `failed / abandoned / expired / withdrawn`；
- 重要故事线不允许玩家主动 `abandoned`，也不因玩家缺席进入 `failed/expired`；
- 普通不限时任务可放弃并重新开放；
- 限时任务到期后关闭，是否留后续回响由任务定义决定；
- 一次性随机事件可以不创建任务实例；产生多阶段目标后再升级为任务；
- 任务状态由代码从事件和条件计算，AI不能口头宣布完成。

### 6.6 QuestDefinition 最小结构

```text
questId / title / narrativeTier / ownerKind / ownerId
sourceEvidenceRefs / threadId / regionIds
premise / playerMotivation / stakes
availabilityConditions / offerChannels
timePolicy / lifecyclePolicy
stages[]
  stageId / purpose / entryConditions / objectives[]
  allowedActions / completionConditions / failureConditions
  scenes / transitions / recovery
rewardContract / consequenceContract
protectedRefs / knowledgeEffects / worldEffects
estimatedMinutes / intensity / tags / fingerprint
```

### 6.7 ChoiceContract 最小结构

每个正式选项必须包含：

- 稳定 `choiceId`；
- 玩家可见文本；
- 对应 Action；
- 前置条件与不可用原因；
- 即时反馈引用或安全模板；
- 确定性 effects；
- 后续 Stage/Scene；
- 知识、关系、道德、阵营和世界状态影响；
- 是否需要二次确认。

不存在后果或表现回执的“空选项”不得通过构建门。

### 6.8 内容时长预算

内容库存与单次游玩时长必须分开估算，避免把可选内容重复计入：

```text
T_required = Σ 必经任务和场景预计时长
T_optional_inventory = Σ 全部可选内容时长
T_expected_optional = Σ (内容被发现概率 × 接取概率 × 完成概率 × 预计时长)
T_exploration = 旅行、地图、战斗、制作和非任务交互预计时长
T_expected_playthrough = T_required + T_expected_optional + T_exploration
```

模型提供时长估算，代码检查总量、比例和缺口；真人游玩数据用于校准。时长不是按字数机械换算即可证明的事实。

---

## 7. 世界、地图与地区内容

### 7.1 地图是故事的可玩投影

```text
冻结世界观或小说
→ 来源事实、人物、势力、事件和已有地点
→ 游戏故事与玩法需求
→ 地区骨架和LocationNeed
→ 区域、地点、道路和快速旅行点
→ 任务与场景绑定
```

地图生成器不能先凭空创建一张地图，再要求故事去填空。每个关键地点必须能够回答：

- 它来自哪项来源或哪项明确的改编补充；
- 它承载哪些主线、重要故事线、玩法功能或地区表达；
- 玩家提前到达时看到什么；
- 哪些场景需要额外任务条件才能触发；
- 它和其他地点如何连通、旅行和快速移动。

### 7.2 地区内容包

`RegionNarrativePack`至少包含：

- 地区主题、氛围和价值冲突；
- 核心地点、功能地点和危险地点；
- 地区势力、代表角色和普通NPC类型；
- 地区长期问题及其阶段；
- 主线和重要故事线在本地区的节点；
- 固定普通支线需求；
- 可半生成任务的母题、素材、禁用组合和奖励范围；
- 随机事件、环境反馈和传闻渠道；
- 进入前、提前到达、相关剧情中、剧情后的可见状态；
- 内容密度、等级范围、重复指纹和预计时长。

### 7.3 首阶段地图交互

首阶段优先实现：

- SVG或节点道路图；
- 世界层、区域层和地点层；
- 点击地点设为旅行目标；
- 路线、旅行时间和可能事件；
- 首次正常到达区域后解锁快速旅行点；
- 到达地点后进入文字场景；
- 已知、听说、未知等知识状态；
- 与主线阶段分离的地点可达性。

WASD像素移动、逐格碰撞和室内关卡属于后续表现升级。

### 7.4 时间、天气和世界推进

- 世界有统一时钟、昼夜和天气状态；
- 主线的叙事阶段不因时间自动关闭；
- 非主线故事线、普通任务、地区问题和NPC事件按自身时间策略推进；
- 普通旅行不持续扣除饥饿或口粮；
- 快速旅行必须推进与距离相符的时间；
- 快速旅行开始后不被沿途事件中断；阻断必须在开始前完成判定；
- 战斗消耗生命、技能资源和物品；
- 天气与昼夜首阶段主要影响表现、可见事件和少量条件，不能形成不可控规则爆炸。

普通旅行仍可产生旅途事件；快速旅行只结算时间和到达结果。

---

## 8. 运行时架构

### 8.1 权威状态域

运行状态至少分为：

| 域 | 权威内容 |
|---|---|
| 玩家 | 等级、经验、生命、属性、技能、货币 |
| 库存 | 物品、材料、装备、配方、领取与消耗 |
| 空间 | 当前地点、旅行状态、已知地点、快速旅行点 |
| 时间 | 世界时钟、昼夜、天气、期限 |
| 任务 | 可接取、活跃、阶段、结果、冷却、指纹 |
| 故事 | 主线阶段、重要故事线阶段、结局资格、承诺回收 |
| 世界 | 地区问题、势力局势、NPC位置与存活、局部变化 |
| 关系 | 道德值、阵营亲合度、NPC态度档位 |
| 知识 | 世界事实、玩家已知事实、角色各自知识边界 |
| 调度 | 发牌历史、近期强度、并发上限、下一次计划动作 |

同一数值只能有一个权威来源。道德值属于玩家域；关系域读取并派生NPC态度，不能各保存一份可独立修改的道德值。

### 8.2 玩家命令处理

```text
输入
→ 输入分类
→ 已有Action/Choice：直接校验
→ 自由文字：生成IntentCandidate
→ 确定性匹配已有Action/Choice
→ 高置信且无额外风险：展示映射结果；可逆低风险动作可以执行，不可逆或高影响动作请求确认
→ 低置信/无匹配：自然回应 + 推荐正式选项
→ 事务提交Event
→ 重建Projection
→ AI根据提交结果生成表现
```

第一阶段的 `IntentCandidate` 不得创建新地图、新任务、新技能或任务表之外的解法。

#### 8.2.1 G4-03确定性场景消费基线

当前玩家端已经能直接消费ProductRelease或制作端显式Build Preview冻结的P9正文与三类输入绑定。代码只从唯一Session Projection派生当前地点、任务生命周期、Scene共有Condition和显式在场NPC允许的场景；一个Action的私有条件不会隐藏同场景其他合法选择，异地Objective不需要发布者同行。新生产把角色拥有的委托/收束放在owner常驻地点，旧冻结包的异地端点也在运行时兼容归一；历史Context v1仍保留原Quest首地点/地区语义以支持durable恢复。交谈和开战Action分别依冻结Actor对话场景与Encounter启动Effect收窄唯一目标，不会因同地点还有其他NPC或遭遇而让正式选项失效。被Scene引用的玩家Quest目标Action及玩家结局`quest-action`还会在Action注册表复核Scene合法性，并按offer、当前Objective、resolution各自生命周期精确收窄实例；同定义多轮任务不会串目标，Quest页或直接命令也不能绕过场景。P8F的`observe + targetScope:quest`兜底需求同样受此约束。Choice、系统按钮及精确匹配的冻结自然语言例句分别标记`fixed-choice`、`system-action`和`mapped-intent`，随后统一进入Action注册表、风险确认、Event提交和Projection重建。高风险确认必须把弹窗打开时整个`ProductRuntimeState.lastSequence`作为基线交给执行器；缺失、数据库状态变化或实时Store切换Session时都必须重新确认，stale失败后Store先尽力刷新权威Projection，Command事务继续以Sequence+Hash处理检查后的竞态。无法唯一映射、普通动作零/多目标或战斗中的自由输入不会写状态；G4-09前，多敌战斗暂按权威Projection选择首个存活目标以保证循环可继续。玩家场景投影不携带内部purpose或未发生结果文案，系统回执以独立读屏动态区与P9正文保持分离。

界面把正式Release和显式Build Preview中的正文统一标为“冻结叙事”，由全局来源标识负责区分已发布与非正式预览；旧端点迁移时则明确改标兼容回退。Action执行同时冻结完整请求代次、scope、世界分组和Session，切换存档后旧Action只影响原Session，不得把回执、错误、busy或刷新投影写进新界面。Narrative v1 / Action v14还按旧正式编译器的`action.talk.<actorKey>`稳定键恢复唯一交谈对象，使同地点多NPC时仍可执行，而非把无目标选择器的按钮伪装为可用。

P9没有为休息等所有通用玩法Action造Scene。运行投影会保留当前合法、且从未被任何P9 Scene引用的环境Action，让这些确定性循环继续从系统按钮执行；被隐藏Scene引用的Action不会从场景环境入口泄露。Scene引用不是通用玩法的全局所有权：Objective即使把use/equip/craft/buy/sell作为支持动作引用，也不能让任务生命周期反向锁死背包、装备、制作或商店页。制作与交易在专用UI补齐商品/配方和数量参数前，不出现在v15 Scene快捷入口或v14兼容场景按钮中。

这只是没有模型时的可玩确定性基线，不等于G6语义理解已经完成。G6仍须补充受治理的IntentCandidate、NPC自由对白和Receipt演绎；Narrative v1/Action v14只允许明确降级。随机事件目前也不会仅凭Director历史重新显示，因为历史只能证明曾经发生，不能证明场景仍在当前活动窗口；后续通知切面必须补足当前激活与失效证据。

#### 8.2.2 G4-04玩家HUD与通知消费基线

首版HUD不是新的叙事状态机。它从权威Session Projection和冻结Release模块派生玩家生命与技能资源、地点与地区、第几天/时段/天气，以及任务追踪摘要。只有显式`primaryInstanceKey`可成为主追踪，最多三个pin保持为独立辅助追踪；每项显示状态、当前阶段、下一项未完成的必需目标与期限。不存在显式主追踪时必须如实显示为空，不能为了填满界面而把普通任务提升成主线焦点。

近期变化是规范Event的有界玩家视图，而非AI总结或额外持久化日志。只有同Session、连续并与Projection head闭合的Command/Random/Effects终态链可以产出通知，标题与语义仍来自冻结任务、角色、地点、地区或随机事件定义。fresh Director v3随机事件除完整授权、随机证据、Narrative表现和成功Effects外，还必须在候选、弱授权复核与Replay中匹配其唯一冻结传播地点；历史Director v2仍按原地区级语义读取，内存归一得到的空`locationKeys`不得在重冻结时写回，避免改变旧payload字节与content Hash。两版随机事件在首版都属于瞬时结算：这些证据只能证明“已经发生/已经结算”，没有任何字段证明“仍在发生”，所以HUD不得恢复活动场景或编造失效时间。持续事件必须留给未来显式版本化生命周期。

初载与切换Session只建立通知基线，不朗读历史；玩家Action由结算回执播报；此后新增的系统重要/关键变化才进入常驻live region。Projection与Event前缀短暂不同步时通知失败关闭且不消费游标，待完整前缀到达后只播一次。该投影不向后续AI泄露内部授权、未发生结果或隐藏世界状态，也不建立新的数据库表和治理字段。

#### 8.2.3 G4-05任务日志与生命周期消费基线

完整任务日志仍然是Quest账本、冻结模块和规范Event的只读投影。玩家只看见已经正式揭示的任务实例、当前及过去Stage、对应Objective状态、已知地图地点、固定奖励预览和实际读过的任务相关传闻/事实；内部`available`卡牌、未来Stage与Objective、未知地点、未读Rumor、隐藏Knowledge及随机掉落内容都留在治理边界内。历史Event短暂落后于Projection时只暂停历史区，不以AI文本补写发生过的事实。

任务日志负责分类筛选、追踪/取消、精确放弃和已知地点的UI定位；接取、重接、Objective和领奖继续归属冻结Scene。这样任务页不能绕过发布NPC、原地点、叙事正文或收束场景。地点定位只切换当前Session玩家壳并聚焦已知地图节点，不提交Action、不推进时间、不披露地图。

G4-05同时把生产端生命周期升级为Action v16：可放弃任务在未开始与每个Stage都有唯一匹配Action；只有固定普通不限时任务拥有原发布Scene上的`restart-quest`，四个迁移Effect原子重置同一实例并从第一Stage激活。限时任务放弃后保留截止时间，仍可从`abandoned`确定性过期；主线、重要故事、模板/Director任务不进入重接规则。终态清除追踪并同步Director镜像，Event Replay重建完全相同的Projection与历史。新合同在P8F/P9/P10/V3共同验签，Action v16强制Quest v2；历史durable Context继续生成并复验Action v15，不重新解释旧事件。

#### 8.2.4 G6-01运行时叙事Skill边界

运行时叙事不由一个全知Agent同时理解输入、决定规则、推进任务和写正文。首版登记六个独立只读Skill：Intent只映射当前合法Action/Choice；Dialogue只依据在场角色、三档态度与实际知识生成对白；Expression只叙述已提交Receipt/Event；Quest Packaging只包装代码选定的地区模板槽；Direction只在合法候选闭集中建议发牌或Blank；Memory只压缩已经发生的对话和终态事件。

六个Skill共用登记的`openWorldRuntime`来源，但合同另行声明各自的逻辑读取片和禁止读取片，不能把整份玩家投影无差别塞给模型。每次正式调用冻结Prompt、Skill、入口、任务路由、严格JSON Schema、token/费用/时间预算及Release/Session/Sequence/State/Visibility边界。模型只有一次调用、零工具和零正式写权限；未知结果不重发，stale候选不采用，失败时回到固定Action、预制对白/文案或Blank。

这项实现只建立G6运行时AI的叙事权限骨架。按需Context Manifest、玩家自由输入、NPC对白、结果演绎、地区包装、导演采用和长期记忆仍须由G6-02～G6-08分别接入并验证，不能因Skill已登记就宣称体验完成。

#### 8.2.5 G6-02运行期叙事上下文切片

G6-02把六个Skill的“逻辑读取片”落成可验资源，而不是让模型读取一份全知存档：

1. Intent只看当前场景、玩家可见状态、当前合法Action/Choice及语义相关的已知任务/事实；它不看未解锁地点、未来节拍或演出结果。
2. Dialogue必须绑定一个当前在场角色，只看该角色档案、三档态度，以及“当前场景允许被谈及”和“该角色实际知道”的知识交集；其他角色私密知识和玩家未知真相不进入请求。
3. Expression只看指定命令的已提交终态Event/Receipt；Quest Packaging只看代码已选定的模板槽和其所需地区语义；Direction只看指定触发点下的合法候选闭集、主线保护、节奏、冲突、冷却和Blank；Memory只看指定角色与明确闭合的事件窗口。
4. 当前场景、合法动作、指定角色或回执是不可裁剪的必读资源；玩家已知事实和可见任务才使用长尾语义选择。实现不以“最近8条”或其他固定N条冒充叙事检索。
5. 每项资源都有冻结范围和SourceRef，与Release/Session/Sequence/State/Visibility一起进入V3 Context Manifest。运行头改变后旧请求失效，不能把过期对白、意图或发牌建议采用到新状态。

这一层只提供叙事候选所需的最小真实上下文，不写Action、Quest、Knowledge、Relation或Memory。它也不会因资源目录已可用就伪装G6-03～G6-08的玩家体验已完成。

#### 8.2.6 G6-03自由输入的叙事采用边界

自由输入现在可以扩大玩家的表达方式，但不能扩大世界事实或规则集合。冻结P9例句仍由本地精确匹配；其余文字才由Intent Skill结合当前所选场景、可执行Action/Choice和玩家可见知识形成候选。候选最多包含四个同类稳定键，不能同时提议Action与Choice，也不能创建新地图、任务、角色、物品、结局、数值或任务表外解法。代码在响应后重新投影当前场景、目标与Action风险，置信度低于0.72、目标不唯一且无法显式展开、越界、污染或过期时均不采用。

唯一低风险解释可以进入同一Action/Event结算；多义解释必须先让玩家选择；犯罪、消耗、任务变化及其他由Action声明的高影响行为仍使用全局确认层。模型的`requiresConfirmation`只是非权威说明，不能降低代码风险等级。解释候选自身作为只读Creative Candidate进入Instance Run及Checkpoint，完整请求、响应、Context Manifest和Receipt可复验；真正的玩家Command只保留不含本地Run ID的便携来源Hash，并在提交前验证原Run终态、候选选择和Release/Session/Sequence/State/Visibility仍一致。

这一步没有实现NPC自由对白或结果演绎。无法解释、模型不可用或网络失败时，只显示边界回应和当前正式行动建议，冻结正文、固定Choice与系统Action仍然可玩；因此AI不能用自然语言伪造已经发生的剧情，也不能成为推进主线的唯一通道。

#### 8.2.7 G6-04 NPC对白的知识闭包

NPC对白现在是受Intent路由的独立叙事表现层。只有玩家明确在当前角色对白场景与在场角色交谈，且Intent高置信判定为`reply-only`时，Dialogue才读取该角色公开人物档案、代码确定的好/一般/差态度、当前场景允许知识与角色真实已知知识交集、合法Action/Choice以及同一场景最多12轮临时对话。临时历史只是当前模型请求的会话材料，切场或正式事件推进即清空，不能反向成为世界事实、角色知识或玩家知识。

模型候选必须逐项声明角色、语气、引用知识和推荐行动，代码随后按当前投影重新验证。模型不能创造记忆、秘密、关系变化、任务推进或行动结果，也不能让对白中的建议自动执行。精确隐藏知识键、标题和内容短语具有第二道泄露拦截；但人物口吻、潜台词质量以及同义改写是否构成剧透仍然是语义问题，必须在G6-10用模型评测与真人样本校准，当前不能宣称仅凭Schema已保证。

当模型失败、超界或响应已过期时，叙事层回到Release冻结的角色开场和确定性态度模板，并明确没有状态变化。这样对白增强可以失败，而主线、任务、固定Choice与系统Action仍然完整可玩。真正持久的对话摘要、玩家知识和角色知识采用留给G6-08，必须继续遵守World Truth、Player Knowledge和Actor Knowledge三层隔离。

#### 8.2.8 G6-05结果演绎的叙事权限

场景、战斗和任务结果的叙述必须发生在确定性结算之后。玩家显式请求演绎时，Expression Skill只能读取当前终态Command的Feedback Receipt、它的完整证据事件和可选当前场景；不读其他终态结果，不由刷新或页面切换自动调用。结果是场景、战斗、任务还是系统语义由代码从Action与Effect确定，模型不能重新解释游戏规则。

候选必须保留Receipt的精确事件序号，只引用由Receipt派生的Action、目标、Outcome、Change、Effect、Operation、Event或Random闭集，对白字段必须为空。新物品、新伤害、关系变化、任务推进、额外事件和未证明数字都不得由表现文本创造。候选只作为Instance Run内的只读表现证据，不写Event或第二份状态；系统回执仍是唯一正式叙事事实。

这套结构能防止可机验的越界引用、数字和状态夹带，但不等于已经证明所有同义改写都不会与真实结果矛盾。表达幻觉、文风、战斗爽感、任务收束感和场景沉浸感必须在G6-10用模型评测与真人样本共同验证。在模型失败时，玩家仍看到原始系统回执并可继续游玩。

#### 8.2.9 G6-06地区任务包装的叙事权限

地区任务包装只为已经由确定性Director选中、实例化并揭示的模板任务增加可选文案，不承担发牌、任务设计或结算。服务从规范Director历史重建唯一任务槽，逐项核对实例来源、模板任务、发放地区、模板指纹、创建时间和发布时预制变体；任一关系缺证或冲突都不开放AI入口。只有玩家仍在发放地区并显式点击时才调用Quest Packaging Skill，任务自动出现、页面刷新和任务筛选不会暗中产生模型费用。

候选只能补充标题、摘要、引子、公开目标方向和完成后的氛围收束，必须逐字回显确定性模板指纹及实例、任务、模板、地区、预制变体闭集。目标、条件、奖励、期限、状态、Effect、NPC对白和事实结果不可由模型增删。代码拦截扩字段、未证明的阿拉伯数字、其他地区/任务/角色/物品/技能、隐藏知识和隐藏目标短语、原样复制预制变体以及stale响应；这能守住结构和精确泄露边界，但文风、新颖性、同义改写泄密和重复感仍须G6-10语义评测。

AI候选是任务日志中的附加表现层，冻结任务定义与系统目标仍是权威；预写的收束段只在任务正式`completed`后展示。候选及请求、响应、V3 Context Manifest、Checkpoint和验证Receipt归Instance Run，不追加ProductRuntimeEvent。刷新与旅行后可恢复通过Release、Director来源、实例绑定、checkpoint链及候选Hash复验的候选；坏数据、不可便携候选、模型失败或离开发放地区均回到Release冻结文案，不影响任务继续运行。

#### 8.2.10 G6-07叙事导演建议的叙事权限

Direction不是另一个任务规划Agent，而是确定性Director结算中的一次可选只读顾问。代码先完成地区/等级/条件、任务容量、冷却、结构指纹、战斗阻断、高强度连发和保护故事排除，再用正式随机证据决定Blank还是进入内容选择。只有已经进入内容选择且至少存在两个合法的普通/模板/随机事件候选时，玩家预先授权的作品级设置才允许发出一次模型请求；Blank、唯一候选和牌组未就绪均保持零调用。

模型只看指定触发的合法候选闭集、节奏历史、当前可见任务、地区状态、冲突/冷却输入和主线安全等待窗口。它可推荐一个现有候选，或返回`blank`表示不提供偏置；后者不能命令代码空过。所有推荐必须保持`mainlineSafe=true`且无冲突，主线与重要故事任务不属于可建议集合。响应后代码在同一Pending Director命令和同一Release/Session/Sequence/State/Visibility边界重新计算候选；验证通过的建议最多替换非空候选，任务结构、Effect、奖励、期限、知识、关系和随机Blank概率都不可改变。

完整模型证据进入Instance Run，Event中的Director授权只保留候选、Manifest和终态Receipt的便携Hash，不写本地Run ID。重放由同一随机证据、合法候选和冻结建议证据恢复同一选择。模型失败、stale、断网或中断时，系统不回滚玩家行动，也不对已经持久化的Pending命令隐藏重发，而是按原确定性选择完成结算。作品级调用授权默认关闭且仅存本机；这保证地区Agent可以增强节奏，但不能成为世界继续运行、主线可达或任务发放的必要条件。

### 8.3 叙事导演与发牌

叙事导演不直接写状态，只读取投影并提出候选。确定性发牌服务负责：

1. 过滤当前区域、等级、任务阶段、角色可用性和时间不满足的内容；
2. 排除已经完成、过期、冷却或指纹重复的内容；
3. 按主线可见性、地区需求、成长缺口、近期强度和类别配额评分；
4. 决定发出固定任务、实例化模板、展示随机事件或保持空白；
5. 写入发牌和实例化事件；
6. 再由AI生成符合地区和角色的表现文本。

“空白牌”是合法结果。系统不应为了证明世界丰富而在每次行动后强塞任务。

### 8.4 NPC分层

| 层级 | 内容和运行方式 |
|---|---|
| 主线关键NPC | 完整档案、知识边界、关系、主线状态和受保护规则；相关场景调用AI |
| 重要故事NPC | 完整档案、故事线状态、位置和关系；只在相关事件点调用AI |
| 普通常驻NPC | 简要档案、阵营、功能、地点和日程；程式化移动与三档问候 |
| 临时NPC | 随事件实例存在；产生长期影响时保存最小事实或升级身份 |

“由Agent持续保持”指档案和状态可持续读取，不表示模型进程常驻后台。

### 8.5 关系模型

第一阶段使用：

- 玩家道德值；
- 玩家对各阵营的亲合度；
- NPC自身阵营与价值解释；
- 派生的好、一般、差三档态度。

态度可以影响问候、价格、普通服务、部分普通任务和对白，不得阻断主线。偷窃、欺骗和犯罪由事件修改道德或阵营亲合度。

### 8.6 战斗与制作

第一阶段战斗：

- 确定性回合制；
- 属性以力量、体质、敏捷等战斗相关值为基础；
- 生命、攻击、防御、暴击、装备加成和技能效果由代码计算；
- 战斗每回合由玩家选择普通攻击、技能、道具或逃跑；不支持自由文字招式；
- 不接受自由描述动作形成临时数值技能；
- AI只演绎已经计算完成的回合结果。

第一阶段制作：

- 支持装备、药剂等固定配方；
- 配方、材料、产物和条件结构化；
- 材料扣除与产物入库在同一事务中完成；
- AI负责物品说明和配方语义候选。

非战斗互动不完整复制D&D属性体系。调查、开锁和说服优先使用已有交互条件；必要时受物品、任务、道德、阵营或明确技能影响。

### 8.7 存档、读档和分支

运行时采用：

```text
不可变 ProductRelease
+ InitialState
+ append-only ProductRuntimeEvents
→ 可重建 Projection
+ 定期 SimulationCheckpoint（状态快照 + throughSequence + hash）
```

读档不能通过“删除水位后的行”恢复被原地修改的数据。正确语义是：

- 默认从某个 Checkpoint 创建新的子 Session 分支；
- 子分支引用相同 Release 和初始状态，从指定事件序列继续；
- 原分支仍保留，可由用户回看或删除；
- Projection 是派生缓存，可以丢弃并重放；
- 所有正式状态改变都以事件表达，禁止绕过事件原地修改权威状态；
- Checkpoint Hash 不一致时从 InitialState 和事件重新构建。

---

## 9. 数据契约与物理存储

### 9.1 通用 Artifact 信封

所有生产候选共享信封，但不强迫所有种类拥有同样正文结构：

```text
CreativeArtifactEnvelope {
  artifactId
  artifactKind
  schemaVersion
  buildId
  producerRunId
  inputArtifactRefs[]
  sourceEvidenceRefs[]
  payload              // 由 artifactKind 决定 Schema
  contentHash
  status
  validationReceipts[]
  parentArtifactHash?
  createdAt
}
```

`SourceLedger`、`GameBrief`、`StoryArc`和`SceneScript`拥有不同 payload Schema。不得要求每一种 Artifact 都同时包含 `program_structure + narrative_script`。

### 9.2 第一阶段逻辑对象

逻辑对象不等于物理表。第一阶段需要表达：

| 对象组 | 逻辑对象 |
|---|---|
| 来源 | SourcePin、SourceManifest、SourceLedgerEntry、SourceGapReport |
| 产品 | GameBrief、ExperienceContract、ProtagonistAsset、ContentBudget |
| 叙事 | StoryArc、EndingContract、StoryThread、StoryStage、NarrativePromise、Callback |
| 空间 | RegionSkeleton、RegionNarrativePack、Location、TravelEdge、FastTravelPoint |
| 角色组织 | CharacterDossier、FactionProfile、KnowledgeBoundary、ScheduleRule |
| 任务 | QuestDefinition、QuestStage、Objective、QuestTemplate、DeckRule、ChoiceContract |
| 场景 | SceneScript、DialogueBeat、ActionBinding、PresentationSlot |
| 玩法 | ProgressionConfig、CombatConfig、Skill、Item、Equipment、Recipe、RewardContract |
| 知识连续性 | CanonFactRef、PlayerKnowledgeRule、Guarantee、Facet、Promise、Callback |
| 生产证据 | RunContract、ContextManifest、ValidationReceipt、RepairReceipt、BuildManifest |
| 运行 | Session、Event、Checkpoint、Projection、QuestInstance、DrawHistory |

人物性格、社会经历、关系背景和外貌叙述优先集中在 `CharacterDossier`；只有真正参与查询、权限、规则或UI的最小字段才结构化，不为每种人物语义新建一张表。

### 9.3 StoryForge 初始物理映射

第一阶段优先扩展现有设施，避免直接创建外部方案提出的二三十张新表：

| 现有设施 | V3.1用途 | 策略 |
|---|---|---|
| `gameProductions` | 产品生产根、当前 Build/Release 指针 | 复用，补文字开放世界产品契约 |
| `gameProductionBriefs` | 不可变 Brief 修订、WorldRelease锁定与授权 | 复用并扩展 Brief Schema |
| `gameProductionCommands` | 幂等开始、暂停、继续、取消、修复、发布命令 | 复用 |
| `gameBuilds` | 计划、预算、集成、QA、兼容与终态证据 | 复用 |
| `gameBuildArtifacts` | 各种 Artifact 信封和 payload | 第一阶段主要生产存储，不为每种Artifact建表 |
| `gameQualityGateReceipts` | 硬闸门和语义评测证据 | 复用并增加 verifier 类型 |
| `openWorldModules` | 采纳后的可运行开放世界模块 | 复用并升级 Schema，不作为生产草稿箱 |
| `gameReleases` | 不可变运行发布 | 复用，确保只引用来源WorldRelease |
| `simulationSessions` | 玩家实例、分支、Release绑定与初始状态 | 复用 |
| `simulationEvents` | 唯一权威的追加运行事件 | 复用并扩展事件类型 |
| `simulationCheckpoints` | 可重建状态检查点 | 复用，禁止只存易失指针 |
| `agentRuns`及事件/检查点 | 生产和运行AI的durable Harness | 复用，不建设第二套Harness |

只有在以下条件之一成立时才新增专门物理表：

- 高频查询无法在聚合Artifact或Release载荷中安全完成；
- 对象有独立 owner、权限、版本或删除生命周期；
- 运行时高频写入，不适合放在不可变Release或大JSON中；
- 需要外键重映射、索引或增量迁移；
- 性能测试证明现有聚合无法达到门槛。

### 9.4 三注册表开工要求

任何新对象正式进入代码前必须完成：

| 问题 | 单一事实源 |
|---|---|
| AI可以读什么 | `CONTEXT_SOURCES` + Context Gateway |
| AI候选可以正式写什么 | `FIELD_REGISTRY` + `AdoptionSchema` + `adopt()` |
| 表如何导入、导出、删除、迁移和重映射 | `PROJECT_TABLES` |

文字开放世界需要的上下文源应按能力登记，例如来源目录、来源证据、生产Artifact索引、当前任务、当前地区、玩家状态、玩家知识和运行回执；不得让每个Skill在Prompt里手写数据库字段清单。

### 9.5 条件与效果语言

第一阶段不建设通用编程语言，但必须扩展现有小型、类型化的 `OpenWorldCondition / OpenWorldEffect`：

- 条件只允许白名单域、操作符和值类型；
- 效果只允许白名单事件和参数；
- 引用在 Build 时解析为稳定ID；
- 所有数值和集合变化有上下界；
- AI只能输出候选表达式，解析器和验证器决定是否合法；
- 复杂语义拆成多个原子条件/效果，不把自然语言交给运行时临场解释。

这套小型DSL用于静态检查、回放和有界可达性分析；它不与“避免建设庞大自定义脚本语言”的原则冲突。

---

## 10. 产品功能与界面

本节只描述叙事基座对产品界面的最低消费需求；完整页面、玩法系统和UI状态契约见 [`TEXT-OPEN-WORLD-PRODUCT-ARCHITECTURE.md`](./TEXT-OPEN-WORLD-PRODUCT-ARCHITECTURE.md)。

### 10.1 创建与生产工作台

至少包含：

1. 来源选择与锁定：WorldRelease或小说来源、能力画像、版本与缺口；
2. 游戏设定：主角、题材、体验规模、内容边界和媒资偏好；首版难度固定为标准；
3. 主 Agent 会谈：显示已理解需求、未决项、预算和预计产物；
4. 生产计划：阶段、依赖、可并行项、模型、预算和完成条件；
5. 生产进度：每个Artifact状态、失败原因、重试和恢复；
6. 内容审查：故事弧、地图、主线、重要故事线、任务和系统配置；
7. 问题修复：按验证回执局部修复，不要求全量重做；
8. 灰盒试玩：使用当前Build运行验收路径，不污染正式Release；
9. 发布：通过硬闸门后生成正式ProductRelease；
10. 更新：修复后生成新Build和新Release，显示存档兼容性。

G5-04已经关闭第4、5项的正式启动和执行可见性，G5-05已经以当前Work/Product/Production/Build内的`productBuildArtifacts`不可变聚合完成第6项的只读三视图浏览。界面把“完整性通过”和“生产验证通过”分开：前者展示证据链是否可重算，后者才允许官方生产合同下的内容实体进入“内容”视图；它们都不等于叙事或美学质量通过。G5-06和G5-07又分别补齐受治理编辑交接、引用影响与新Build局部修复，仍没有建立万能物理内容表或原地改写Artifact。

### 10.2 玩家端

首阶段至少包含：

- 场景叙述和对话区；
- 系统Action、固定选项、自由输入三种入口；
- 世界/区域/地点地图；
- 当前地点、时间、昼夜和天气；
- 主线与任务日志、追踪和过期信息；
- 角色等级、属性、技能和状态；
- 背包、装备、材料、货币和制作；
- 回合战斗界面；
- NPC和势力关系概览；
- 近期事件、传闻和已知信息；
- 存档、读档、分支和设置；
- 模型调用失败时可理解的降级和恢复提示。

### 10.3 媒资范围

第一阶段可以先以文字、SVG地图和基础UI完成叙事闭环，但架构必须允许 Build 拥有：

- 地图样式和图标；
- 角色立绘/头像；
- 地区或场景背景；
- UI皮肤；
- 音乐、环境音、音效和可选配音。

媒资需求由已确定的故事、地图、角色和场景反向产生。媒资生成失败不得破坏核心文字游玩；可以使用明确标识的占位和降级资产。

---

## 11. 质量保证

### 11.1 硬闸门

硬闸门必须可以由代码或明确事务证据判断：

- Schema、版本、owner和作用域合法；
- 所有稳定ID、外键和来源证据可解析；
- WorldRelease、输入Artifact和模型结果没有stale；
- 主线Stage顺序可达，普通内容不能永久阻断主线；
- 所有正式Choice都有Action、条件、反馈和确定性后果；
- Condition/Effect只使用白名单操作；
- 奖励、物品、数值和内容预算不越界；
- 任务状态迁移合法，限时策略与叙事等级相容；
- 地图关键地点可达，提前到达不会误触关键剧情；
- Build内的任务、场景、角色、地区和媒资引用完整；
- Release不可变，运行事件不修改Release或WorldRelease；
- 保存、重放、分支和Checkpoint Hash一致；
- AI写目标、上下文和工具权限符合Run Contract；
- 预算、重试、幂等、暂停和恢复有可验证回执；
- 导出、导入、删除、迁移和引用重映射通过正反例。

### 11.2 语义质量门

以下内容需要模型评审、人工抽检或真人游玩，不能伪装成确定性证明：

- 来源改编是否忠实且有创造性；
- 主线是否有足够的冲突、升级、回收和结局差异；
- 重要故事线是否真正围绕人物、势力或地区展开；
- 地区是否具有不同身份和生活感；
- 任务是否有动机、情境、变化和有意义的结果；
- 对话是否符合人格、知识和关系；
- 小任务是否只是换名重复；
- 节奏、密度、难度和奖励是否形成良好成长体验；
- 自由输入回应是否自然，同时没有虚假承诺；
- 玩家是否能理解下一步、失败原因和可用选择。

地点数量、潜台词比例、任务类别比例、语义相似度和来源顺序相关性可以作为诊断指标或默认目标，不能未经校准就升级为全局BLOCK规则。

### 11.3 可达性与可玩性分析

不尝试穷举等级、物品、关系、时间、NPC和世界状态的完整笛卡尔积。采用：

1. 类型化条件/效果的静态检查；
2. 主线关键状态的抽象可达图；
3. 明确上限的模型检查；
4. 代表性玩家策略模拟；
5. 固定种子的长期运行与性能测试；
6. 真人游玩反馈。

### 11.4 标准自动游玩路径

首个版本至少覆盖：

1. 只推进主线直到一个结局；
2. 大量完成普通支线后再推进主线；
3. 长期搁置主线，验证主线等待而世界继续；
4. 战斗失败、复活或读档后重试；
5. 普通任务放弃、重接、失败和限时过期；
6. 提前访问后续地区，不触发错误主线；
7. 大量自由文字、无效文字和越界请求，验证回归正式路径；
8. 保存、刷新、分支、重放和版本恢复；
9. 固定种子的长时钟推进，检查任务爆炸、状态漂移和重复。

### 11.5 正式发布

StoryForge当前没有独立staging。发布前仍需在隔离数据中完成灰盒试玩、自动回放和必要E2E；通过后直接形成正式ProductRelease供真人游玩。真人发现问题后：

```text
问题回执
→ 影响分析
→ 新Build局部修复
→ 回归与兼容检查
→ 新ProductRelease
→ 用户选择继续旧版本或迁移兼容存档
```

不得原地修改已经发布的Release。

---

## 12. 首个纵向验收世界

### 12.1 目的

首个世界不是产品上限，也不是内容模板。它只证明下列闭环真实成立：

```text
来源
→ 故事生产
→ 地区与任务
→ Build/Release
→ 地图探索
→ 主线/支线/随机内容
→ 战斗/成长/关系
→ 时间演化
→ 存档与恢复
→ 真人完成一个结局
```

首个完整验收世界确定使用虚构测试世界“盐脊”，以固定种子和可控反例证明端到端循环。

### 12.2 验收默认规模

以下是校准起点，不是永久规则：

| 内容 | 默认范围 |
|---|---|
| 地区 | 2个具有明显差异的地区 |
| 命名地点 | 8—12个，形成可旅行图 |
| 主线 | 1条严格顺序主线，6—8个Stage |
| 结局 | 2个符合核心目标但条件不同的结局 |
| 重要故事线 | 2条，至少覆盖两种owner类型 |
| 固定普通支线 | 6—10个 |
| 半生成模板 | 4—6个，产生可验证的地区差异实例 |
| 随机/环境事件 | 12—20个候选，不要求单次全部出现 |
| 关键NPC | 4—6个 |
| 普通常驻NPC | 12—20个程式化角色 |
| 主线体验 | 目标90—120分钟，按真人数据校准 |
| 总内容库存 | 支持约3—5小时的首轮探索选择，不要求一次全部完成 |

### 12.3 必过场景

- 从冻结来源生成带证据引用的StoryArc；
- 玩家可从第一地区推进主线并进入第二地区；
- 玩家提前访问第二地区时只看到普通状态；
- 玩家搁置主线，普通任务过期或地区状态变化，但主线仍可继续；
- 一条角色重要故事线与一条地区/势力重要故事线可以独立推进；
- 至少一个模板在两个地区产生结构相同但叙事包装和参与者不同的任务；
- 道德或阵营变化改变NPC三档态度，但不阻断主线；
- 战斗失败后复活/读档并成功重试；
- 玩家自由输入合理意图时被映射到已有动作，不合理输入得到自然拒绝；
- 完成两个不同条件的结局路径；
- Release发布后由真人直接游玩，问题通过新版本修复。

---

## 13. 与现有 StoryForge 的施工映射

### 13.1 保留并扩展

| 现有能力 | 决策 |
|---|---|
| `src/lib/types/open-world.ts` 的地区、卡牌、模板、Deck、日程、条件和效果 | 保留为运行内核基础，按本规格扩展 |
| `src/lib/open-world/runtime.ts` 的解析、回放、发牌、旅行和Tick | 保留，增加任务/故事/知识和时间契约 |
| `src/lib/open-world/harness.ts` 的只读运行时AI候选 | 保留Harness模式，修正自然语言事实保证边界 |
| `gameProductions / gameBuilds / gameBuildArtifacts / gameReleases` | 复用为产品生产和发布生命周期 |
| `simulationSessions / simulationEvents / simulationCheckpoints` | 复用为玩家实例、追加事件与恢复基础 |
| `AgentRunContract`、scheduler、事件、checkpoint、receipt | 复用，不另建平行Harness |
| 三注册表 | 继续作为AI读取、采纳写入和数据生命周期的单一事实源 |

### 13.2 重做或替换

| 现有能力 | 问题 | 目标 |
|---|---|---|
| `product-module-compilers.ts` 的开放世界编译 | 把通用节点机械映射为地区、任务和模板 | 改为本文P0-P10内容生产编译体系 |
| `NarrativeArtifactV1` | 只有nodes、beats、choices | 升级为StoryArc/Thread/Quest/Scene等分阶段Artifact |
| `text-game/agent-contract.ts` | 面向普通节点文字游戏 | 文字开放世界使用独立Skill家族与Run Contract |
| 通用一次性叙事生成Prompt | 一次调用试图生成完整可玩内容 | 分阶段、可恢复、可评审、可局部修复生产 |
| 文字开放世界发布时反向创建WorldRelease | 违反世界引擎到上层产品的单向引用 | 只锁定已有WorldRelease，发布ProductRelease |

旧入口只有在替代路径、数据迁移、回归和真实UI路径通过后才下线；不得先删除再寻找替代。

### 13.3 新增能力

- SourceLedger和来源缺口报告；
- ExperienceContract、StoryArc、Ending和StoryThread；
- RegionSkeleton与RegionNarrativePack两阶段地区生产；
- 正式QuestDefinition、Stage、Objective、Choice和Scene脚本；
- 玩家知识、角色知识、Guarantee/Facet/Promise/Callback；
- 内容预算和真人时长校准；
- 任务导演与确定性发牌扩展；
- 文字开放世界独立创建工作台和玩家端；
- 发布更新、兼容报告和存档迁移体验；
- 叙事质量Eval与标准自动游玩场景。

---

## 14. 分阶段实施路线

### Phase 0：规格收口

- 确认本文待确认项；
- 为P0-P10定义稳定Artifact Kind和Schema边界；
- 建立现有类型、三注册表、表和UI的影响矩阵；
- 确认世界引擎正式 `describe/search/read WorldRelease` 出口；
- 把外部研究中的硬规则、默认值和经验指标重新分类。

完成条件：没有依赖环、双重owner、重复事实源和无法验证的“硬保证”。

### Phase 1：灰盒数据与确定性闭环

- 不调用AI，人工制作首个验收世界的最小完整Artifact；
- 扩展开放世界Schema、条件/效果和Build组装器；
- 跑通发布、地图、任务、战斗、成长、时间、发牌、存档和两个结局；
- 证明现有事件/Checkpoint模型可恢复和分支。

完成条件：内容虽然人工编写，但完整游戏循环可以在刷新、失败和读档后继续。

### Phase 2：内容生产编译器

- 按P0-P10逐个接入正式Skill；
- 每一步生成CreativeArtifact并由作者或策略采纳；
- 加入语义评审、影响传播和有限修复；
- 先主线和一个重要故事线，再扩展地区并行与模板任务。

完成条件：同一来源可重复生产出结构合法、可追溯、可进入Phase 1运行内核的Build。

### Phase 3：运行时有边界自由

- 自然语言到已有Action/Choice的意图映射；
- 场景和NPC的受限AI演绎；
- 主线/重要故事线/地区内容导演；
- 低置信、越界、超预算和模型失败降级。

完成条件：自由输入不会绕过确定性规则，也不会让玩家陷入无回应或假推进。

### Phase 4：完整产品界面

- 创建、会谈、计划、进度、审查、修复、灰盒试玩和发布；
- 地图、场景、任务日志、角色、背包、装备、战斗、制作、关系和存档；
- Build更新、兼容提示、问题回执和新Release。

完成条件：真实用户无需进入开发工具即可完成“创建—发布—游玩—修复—更新”。

### Phase 5：规模与质量

- 扩大验收世界和内容库存；
- 校准任务密度、时长、模型成本和加载性能；
- 固定种子长期模拟、自动游玩、叙事Eval和真人反馈；
- 完成必要E2E、导入导出和迁移验证。

完成条件：质量门、预算和运行性能具有真实数据，而不是文档阈值。

### 后续能力

- 任务目标固定但接受任务表之外的新解法；
- 玩家创建新任务、地点或地区；
- 主线关键角色死亡后的替代叙事；
- 阵营加入、敌对和主线方向翻转；
- 更复杂NPC关系和长期自主行为；
- 像素地图、WASD、碰撞、潜行和空间关卡；
- 更接近无限自由的持续开放世界。

---

## 15. 外部架构包的本地化修正

本规格对外部“完整架构包”做出以下明确修正：

| 原方案问题 | V3.1处理 |
|---|---|
| Agent总数15、18、19前后不一致 | 不把角色数量写成架构常量；以Skill和Run实例为准 |
| 地区包与主线/重要支线互相依赖 | 拆成RegionSkeleton和RegionNarrativePackFinalize |
| P2使用尚未产生的后续假设做验证 | 验证移动到拥有相关输入的阶段 |
| 每类Artifact都要求相同正文结构 | 使用通用信封 + artifactKind专属payload |
| 通过模型自报ID声称零幻觉/零剧透 | 改为非权威表现、结构化事实、语义评测和安全降级 |
| 用事件水位删除实现读档 | 改为追加事件、可重建Checkpoint和Session分支 |
| 道德值在多个状态对象重复保存 | 玩家域唯一权威，关系态度派生 |
| 质量启发式直接作为BLOCK | 硬工程门与语义评测分层，阈值经真人数据校准 |
| 一边拒绝DSL，一边要求完整可达性证明 | 扩展现有小型类型化Condition/Effect，不建通用脚本语言 |
| 用理论BFS穷举完整世界状态 | 静态检查 + 抽象关键状态 + 有界模拟 + 真人游玩 |
| 内容时长把可选内容重复计算 | 区分内容库存和期望单次游玩时长 |
| Agent“直写Artifact库” | 模型返回候选，由编排器检查后持久化 |
| stale_soft默认不传播 | 使用显式依赖并保守重验，语义依赖不得自动忽略 |
| 一开始建设约30张物理表 | 先用现有Artifact/Release/Session设施，按查询和生命周期证据再拆表 |
| 验收世界被描述为已经可玩 | 明确它是Fixture规格，必须由完整数据和真人路径证明 |
| 叙事架构被当成完整产品 | 补充工作台、玩家端、媒资、更新和迁移功能 |

---

## 16. 已解决决策与剩余校准

2026-09-06的36项整体产品问卷已经解决本节原清单中的大部分边界：

- 世界观使用冻结 `WorldRelease`，小说允许产品内独立 `SourcePin`；
- 重要故事线推进到安全点后等待玩家，不因长期缺席永久失败；
- 快速旅行不被途中事件中断；
- 普通功能NPC死亡后由预制替代者接管通用功能，独特内容可以消失；
- 三属性、20级上限、1到5级验收跨度、逐回合四类操作、三装备位和无元素抗性已经冻结；
- 制作100%成功并要求学习配方；
- 自动/手动/战前检查点并存，首版用列表展示分支；
- 地图采用SVG地形背景和地点节点组合；
- 旧存档继续绑定旧Release，只有明确兼容时才迁移；
- 程序地图、头像和场景背景为必需媒资，音频后置；
- 创作者可直接编辑受治理内容，也可要求Agent修改；
- 创作者自带模型Key，生产前后显示费用估算和实际用量；
- 一个主追踪任务加若干钉选，首版HUD最多额外显示3个；
- 首个验收世界使用“盐脊”。

以下内容已经收口为 `src/lib/open-world/product-config.ts` 中的五个稳定校准决策：

1. `OW-CAL-001`：默认采用“盐脊”规模，即90—120分钟主线和180—300分钟可选内容库存；
2. `OW-CAL-002`：道德/阵营亲合度使用-100～100，三档态度阈值为-25和25，首版不被动衰减；
3. `OW-CAL-003`：主线/重要故事线显示禁用的放弃按钮和原因；
4. `OW-CAL-004`：每个模板Build时预生成3个变体，运行时AI只生成受治理候选并保留不发牌降级；
5. `OW-CAL-005`：Build和每游玩小时都有调用、token和预估费用硬上限，价格或外部结果未知时停止。

它们仍然是需要“盐脊”和真人试玩校准的初始参数，而不是永久平衡结论；任何调整都必须修改集中配置和决策版本，不得散落在Prompt中。

---

## 17. 完成定义

文字开放世界叙事基座第一阶段只有在以下条件同时成立时才算完成：

- 产品边界、来源锁定、owner和媒资归属正确；
- P0-P10生产链能够从真实来源形成可追溯Build；
- 主线、重要故事线、地区内容、普通任务和随机事件均有真实内容；
- 运行规则不依赖模型记忆数值和状态；
- 自由文字能够自然承接并安全回到已有执行路径；
- 玩家可以探索地图、成长、战斗、制作、处理任务和完成两个结局；
- 主线等待，非主线世界能够有限演化；
- 保存、刷新、读档、分支和故障恢复通过；
- 三注册表、Schema、迁移、导入导出、删除和引用重映射完整；
- 模型失败、超预算、stale、非法输出和网络错误具有可见恢复路径；
- 灰盒自动回放、隔离E2E和真人游玩均有证据；
- 正式ProductRelease不可变，修复通过新Release交付；
- 旧机械编译入口完成下线，运行结果不会污染世界引擎。

---

## 18. 变更记录

| 版本 | 日期 | 内容 |
|---|---|---|
| 3.2.52 | 2026-09-13 | 完成G6-07导演建议叙事边界：代码先决定Blank与合法候选闭集，玩家显式授权后AI只在至少两个非保护候选间提出一次建议或不偏置。主线安全等待、密度、冷却、冲突、容量、强度、任务结构与Effect继续由代码拥有；建议保留完整V3 Run证据，Event仅携便携Hash并可重放。模型失败或中断直接确定性恢复且不隐藏重发；语义节奏质量留G6-10与真人校准。 |
| 3.2.51 | 2026-09-13 | 完成G6-06地区任务包装叙事边界：AI只包装确定性Director已选并揭示的模板实例，显式调用且严格绑定任务、模板、地区、预制变体与指纹。结构门拒绝改目标/奖励/期限/结果、数字规则、隐藏或越界内容、预制文复制与stale；收束只在正式completed后展示。完整候选证据归Instance Run并可验恢复，零Event/状态写入，失败始终退回冻结文案；语义新颖性与地区文风留G6-10。 |
| 3.2.50 | 2026-09-13 | 完成G6-05结果演绎叙事边界：Expression只在确定性终态Receipt之后由玩家显式触发，仅读精确Command、证据事件和可选当前场景。代码决定结果类型并强制同序事件、Receipt闭集引用、空对白、数字证据和stale拒绝；只读候选不写Event或状态，系统回执仍是唯一正式事实。结构门不冒充语义幻觉、文风和沉浸感已验收，这些留G6-10与真人样本校准。 |
| 3.2.49 | 2026-09-13 | 完成G6-04 NPC对白知识闭包：Intent仅为当前角色对白场景中的在场角色路由Dialogue，模型只读公开档案、确定性态度、场景允许与角色已知知识交集、合法建议及同场临时历史。候选经角色、语气、知识、建议、新鲜度与精确秘密短语重验，只作表现不写事实；失败回到冻结安全模板。临时历史不持久化，长期知识采用留G6-08；同义改写泄密与文风质量留G6-10评测。 |
| 3.2.48 | 2026-09-13 | 完成G6-03自由输入叙事采用：Intent Skill只从当前场景Action/Choice闭集生成严格候选，代码重验目标、置信度、风险与运行新鲜度；唯一低风险解释进入原Action链，多义先选，高风险再确认。完整候选和Context证据留在Instance Harness，正式Command仅携带无本地Run ID的便携来源Hash；失败时不写状态并回到冻结叙事与确定性入口。 |
| 3.2.47 | 2026-09-13 | 完成G6-02叙事上下文切片：Intent、Dialogue、Expression、Quest Packaging、Direction和Memory只获得各自必读的当前场景、合法动作、角色知识交集、终态回执、已选模板槽或导演候选；长尾事实/任务语义选择不用固定N条替代，隐藏/未来/其他角色私密知识不进模型请求。资源SourceRef与精确运行边界进入V3 Context Manifest，过期候选失效关闭；当前仍未接入各项真实玩家体验。 |
| 3.2.46 | 2026-09-13 | 完成G6-01运行时叙事Skill权限骨架：把Intent、Dialogue、Expression、Quest Packaging、Direction和Memory拆为六个只读候选Skill，逐项冻结可读/禁读语义、Formal Entry、严格JSON、模型与预算边界和失败降级。Run绑定精确Release/Session/Sequence/State/Visibility，模型不能提交Action、任务、关系或记忆；当前不冒充玩家UI已接通。 |
| 3.2.45 | 2026-09-13 | 完成G5-12叙事便携边界：导出导入保持SourcePin、叙事/任务Artifact、Run/Checkpoint/receipt与正式Release内容逐Hash不变，只重映射本地身份；任何来源、账本、发布或迁移证据篡改都在写入前整体拒绝。导入终态Build先阻断Preview，随后用零模型、零费用的确定性本机复验闭合Artifact/Blob、terminal lineage和root seal，不重新生成、总结或改写叙事；旧Release和Session历史继续不可变。 |
| 3.2.44 | 2026-09-13 | 完成G5-11叙事版本维护边界：叙事修改只能从已发布Build创建新子Build并重新通过原生产与发布证据链；旧Release和旧Session继续冻结原叙事。兼容报告把叙事节点、选择条件、Effect和全部状态模块纳入稳定语义比较，只允许不改变稳定叙事/任务状态的直接兼容子版本进入迁移预演。正式迁移把已验证玩家进度接到目标Release冻结定义的新子Session，不复制旧事件、不原地改写旧叙事历史；跨Work、混合旧包、非直接版本、伪造声明与过期预演均失败关闭。 |
| 3.2.43 | 2026-09-13 | 完成G5-10叙事发布封印：正式发布不重新总结或生成故事，而把P1实读、全部叙事/任务Artifact receipt、V3装配、G5-09质量和作者授权绑定到同一RuntimePackage。世界保留冻结Release血缘，小说保留SourcePin逐单元Hash且正文不进入Release；任何故事或任务变更必须生成新Build/质量决定/Release，旧Session继续固定旧叙事历史。 |
| 3.2.42 | 2026-09-13 | 完成G5-09叙事质量与灰盒证据：双模型评审不能自签发布，阻断finding必须新Build修复，建议finding需作者逐项说明并完成人工叙事抽检。灰盒仅接受当前Build Preview真实Session，复核连续事件、状态头、Checkpoint、主线结局及核心循环覆盖；问题回执区分不可豁免阻断项和逐项软豁免建议项。最终质量回执绑定完整问题集合，新问题或篡改自动失效，便携证据不复制原文或本地ID。 |
| 3.2.41 | 2026-09-13 | 完成G5-08 Creator媒资Build：P10冻结需求中的背景+头像完整visual sibling包可由作者真实图片导入或可信Provider生成，程序SVG地图与静音音频降级保持确定性；导入验真字节/尺寸/Hash并冻结alt、来源、许可和权利，生成冻结binding与费用上限。严格媒资计划、四项确认和事务CAS创建紧邻子Build；导入零调用仍走Run/checkpoint/receipt，V3/QA重跑且闭包外叙事任务逐项复验。媒资不能反写叙事事实，合同通过不冒充美学质量。 |
| 3.2.40 | 2026-09-13 | 完成G5-07 Creator影响闭包与局部修复：已确认handoff经完整G5-05封印验证、冻结DAG传递stale和预览前后读集CAS形成便携影响计划；同批祖先/后代目标被拒绝，完整siblings允许未改项保持原Hash。作者二次确认后正式命令原子创建紧邻子Build并暂存目标；目标以零provider工具结果进入新Run/checkpoint/receipt并可断点恢复，下游走原生产链重跑，闭包外任务含确定性P0也须逐项跨Build复验。历史授权命令、base sibling、reuseKey、候选或读集篡改均失败关闭；旧Build/Release/Session不变，无新表或AI旁路。 |
| 3.2.39 | 2026-09-12 | 完成G5-06 Creator Artifact受治理修改：19个作者可修复生产任务、29类Artifact由各领域模块投影可改字段并重建完整owner sibling group；直接编辑零模型，Agent编辑走登记Context/Skill/Formal Entry且冻结完整模型身份，二者都先形成durable候选，经原生领域解析、identity/reference delta及同组冲突门后才能确认。确认只写不可变impact-analysis handoff，不改当前Build或正式表；request/result/candidate/intent/receipt/memory settlement、已知失败、结果未知、静态取消、跨目标阻塞、替换谱系和Product/Build事务CAS均失败关闭。G5-07承接影响闭包与新修复Build。 |
| 3.2.38 | 2026-09-10 | 收口G5-05完整终态证明：root回执写入后重新验证最终root Run、`$join`输出、完整事件/checkpoint与无豁免CAS；同Build、直接跨Build和终态携带统一复核父Build全部active Artifact及其物理Blob。发布前证明扩展为完整terminal lineage Blob闭包，IndexedDB在事务内逐字节CAS，OPFS在事务前立即重读并以正式内容寻址不可变写入边界作元数据CAS。明确Creator链本阶段止于release-ready Build Preview，双来源便携ProductRelease必须在G5-10扩展正式来源合同，不使用兼容占位WorldRelease伪装发布完成。 |
| 3.2.37 | 2026-09-10 | 完成G5-05受治理Artifact浏览与验收证据收口：Creator工作台提供内容、Artifact、诊断三视图及同快照搜索/过滤/分页/键盘/窄屏导航；完整性与官方生产合同验证分轴，只有两者闭合的当前内容才进入实体投影，不把Hash检查夸大为叙事质量或美学验证。验收重算完整内容Hash并绑定Plan owner、producer/root Run、完整事件流、candidate checkpoint正文、task receipt及验收期间CAS；Build终端v2回执和portable seal封存完整Artifact信封及跨Build父证据，旧v1封印不得静默作为新携带依据、需要时必须重建。P0统一限制512个来源单元和400万字符，32,650,752 B最坏候选严格低于共享32 MiB checkpoint上限。 |
| 3.2.36 | 2026-09-10 | 完成G5-04 Creator生产启动、进度与恢复：零写入预览生成不含本地ID的Creator SourcePlan、非定位兼容Brief和精确动态Plan；正式开始重验Production/Brief/来源、完整模型route与生成参数、报价预算、确认及Plan Hash，并在同一事务冻结Creator Start、Plan、Build与命令receipt。专属工作流只打开精确Production，目标缺失即失败关闭。P1/P9通过登记的有界多调用协议按分片恢复，provider响应先计账再解析；同一Build/task跨Run/epoch累计paid charge与未知reservation，durable请求标记后还会在executor前复核当前所有权，跨标签pause/stop不再产生本地可阻止的付费派发。恢复严格绑定原Run、epoch、Plan和attempt，作者修复只开放给白名单文本任务；v10导入写前验证SourcePin闭包并重映射通用SourcePlan locator。无新表、Schema或migration，媒资费用仍后置G5-08；下一项G5-05只读浏览受治理Artifact投影。 |
| 3.2.35 | 2026-09-09 | 落地G5-03叙事生产前门：Creator Brief之后复用全局BYOK与正式creation任务路由；安全origin、基础路径Hash和凭证真实来源形成无密钥模型绑定，Verifier以当前配置作外部比较。目录价仅允许精确复核model和官方商业端点；中转、同域异路径、远程HTTP、URL内嵌凭证与自洽重算Hash均失败关闭。完整DAG的155/160调用、120万/36万token、$30文本、2小时/200MB上界与媒资费用后置规则可见；Brief已发生用量与非账单估价分开。设置往返精确恢复会谈/产品/来源；确认不创建Build/SourcePlan，G5-04仍须原子CAS授权。AI日志和错误UI统一清除Key、认证头、完整URL及供应商原始正文。 |
| 3.2.34 | 2026-09-09 | 接入G5-02作者会谈事实：专属Creator Brief完整保存作者设定、来源边界、未决项、规模、媒资与完成条件；主Agent仅通过正式Skill读取无正文来源摘要和作者输入，候选、ContextManifest、来源CAS及终态Run证据经四项作者确认后进入统一不可变Brief修订。便携导入在事务前先校验RunContract Hash与逐事件世界组，再重放终态证明；该终态仍不是SourcePlan或生产授权，P2在G5-04显式提升前保持不可执行。 |
| 3.2.33 | 2026-09-09 | G4-12把叙事运行史接入正式保存语义：手动、自动、战前、里程碑和系统Checkpoint都只快照同一Event/Projection权威，规范任务终态决定派生档时间；从历史点继续必须创建固定原Release的子分支并保留父线未来，旧Release只继续原叙事规则，不以兼容声明静默迁移。每个Session独立核验来源、初始叙事Hash和运行绑定，损坏来源不向玩家泄露内部状态；Build Preview不冒充正式可保存发布。该纵切面不新增叙事状态、AI上下文或模型写入口。 |
| 3.2.32 | 2026-09-09 | G4-11最终语义收口：fresh生产以Action v18冻结受保护主线与重要故事揭示图，主线依来源Stage order形成唯一初始根和严格前驱，重要故事首任务依声明的主线窗口、后续任务依同线前驱；系统`action.reveal.*`只按前置执行`locked → available → revealed`，P10拒绝断点、分叉、环和错误窗口。Director v3把每条受治理传闻冻结到唯一地区/地点及唯一地区牌组，以牌组`rest`触发和全局休息Action保证到达传播点后存在正式抽牌入口，候选、授权与Replay复核地点；Director v2重冻结时删除归一字段，保持历史字节与Hash。Knowledge确认只允许同Stage或更晚的合法任务Reward/结局下游，重要故事不得借全局结局越过自身进度；每个Knowledge/成就Effect只允许一组独占RewardContract/领奖Action或精确结局Action执行。P9完整`authorDraftJson`以作者稿Hash绑定结构输入与幂等键，执行前记录durable `source-snapshot`，以零模型调用、零token和零费用走同一编译验收；已返回但超预算的响应先持久原始证据与真实usage、再阻断候选。当前代码库存新增50项回归用例、1项Playwright并增强1项既有作者修订用例；完整CI的619个测试文件、3007项测试，以及正式Release桌面/390px刷新Playwright均通过。 |
| 3.2.31 | 2026-09-08 | G4-11生产链审查收口：P8F成就由真实任务Reward/结局Action直接唯一授予，Director不再读取同批才写入的不可达资格标记；Knowledge摘要、传播位置与Stage完成来源逐字段验签。P8F/P9共用场景容量公式并在127项封顶；P9 fresh生成按Scene硬隔离并使用零Scene共享表现请求，最多127+1次初始调用及1次片段修复，模型不可读取其他Scene目标、未来目标、来源Claim和未声明公开的人物规划字段；片段保存durable原始响应与候选以供恢复。完整Build初始最多154次调用、总授权155次，token总权重156、时长总权重100，P8F/P9分别占12/19份token，P9占48份时长并保留最大片段输入/输出修复余量；历史P9与条件式成就保持原义。 |
| 3.2.30 | 2026-09-08 | 完成G4-05叙事消费与生命周期闭环：任务日志只投影已揭示实例、公开Stage/Objective、已知地图、固定奖励、已读相关事实和规范历史，Scene继续拥有接取/重接/目标/领奖入口；Action v16冻结未开始/逐Stage放弃、原发布场景四步原子重接、限时放弃后按原期限过期、终态追踪清理与Director镜像同步，Quest v2配套验签并保留旧P8F/P10 Context及Action v15兼容 |
| 3.2.29 | 2026-09-08 | 完成G4-04叙事消费边界：HUD只读权威Projection与冻结模块，显式区分主追踪与最多三个pin；近期变化只由同Session连续终态Event链重建；Director v2随机事件只可证明已发生/已结算，不推断仍激活；初载/换档不重播历史，玩家回执与系统重要变化播报分流，暂态Event缺口不推进游标 |
| 3.2.28 | 2026-09-08 | 收口G4-03运行兼容：Action异步结果绑定完整请求代次与Session，不串回执、错误、busy或刷新；Release/Preview正文统一称冻结叙事；旧端点迁移隐藏地点冲突正文并标记确定性兼容回退；Narrative v1/Action v14按稳定Action键恢复唯一交谈Actor |
| 3.2.27 | 2026-09-08 | 完成G4-03兼容收口：新P9把角色拥有的委托/收束端点绑定owner常驻地点，v1冻结Context继续按旧Quest端点恢复，旧运行包按常驻地点归一；正式Release与显式Build Preview共享冻结叙事消费边界；高风险确认强制使用整个ProductRuntimeState事件基线，stale后刷新权威Projection再重试 |
| 3.2.26 | 2026-09-07 | 收口G4-03门控语义：场景专属玩家Quest Action按Scene lifecycle精确收窄具体实例，包含同定义多轮任务与`observe + quest`兜底需求；通用玩法不因被Objective引用而全局失效；高风险确认拒绝DB事件基线变化与旧DOM串Session；多敌战斗暂选首个存活目标；v15/v14场景均隐藏缺参数制作交易按钮 |
| 3.2.25 | 2026-09-07 | 完成G4-03最终差异收口：从冻结Actor Scene与Encounter启动Effect恢复交谈/开战唯一目标；把从未绑定P9 Scene但当前合法的通用Action投影为环境系统行动，同时保证隐藏Scene Action不能越过叙事门控；补正式生产休息未绑定Scene的证据与运行回归 |
| 3.2.24 | 2026-09-07 | 收口P9到G4-03语义闭环：SceneScripts Context v2只提升多Action共有Condition，Objective participant只保留当地显式Actor需求，v1历史Context仍可原语义恢复验签，旧Narrative v2/Action v15包按Action交集、Actor场景引用和居所兼容归一，同地或异地误注入owner均不吞场景；运行投影不暴露purpose与未发生结果，结算回执用独立live region；新增Action独立条件、旧包归一、零/多目标及战斗输入回归 |
| 3.2.23 | 2026-09-07 | 接入G4-03运行消费基线：玩家端从冻结P9与唯一Projection派生地点/任务/NPC合法场景，三种输入保留source后统一进入Action/Event，系统回执与模型正文分离；精确例句映射只是无模型确定性降级，真正意图、自由对白和结果演绎仍归G6；缺少当前激活证据的随机事件先fail-closed |
| 3.2.22 | 2026-09-07 | 收口G3-18独立审查：P1按真实模型批次保存精确ContextManifest并仅采纳最新成功尝试；结局生产前移至P8F/P9且V1/V2验收，Narrative v2与Action v15不丢失正文和三类输入；P10区分排产槽与`fallback-only`并与Brief音频计数同源；V3核验物理Blob、Capability、生产/Provider回执及权利策略，IntegrationReport分层验Hash；QA按证据逐门判定，商业真实资产覆盖与原型可玩fallback彻底分开；vNext-only、Hybrid和Legacy读取边界均有回归证据 |
| 3.2.21 | 2026-09-07 | 激活G3-18专属生产链：共享scheduler与service按产品类型选择P0～P10/V1～V3/QA Plan和Executor，P0按Brief精确展开来源单元；完整断点恢复证明已完成模型调用不重复执行；V3验签并装配15个G2模块、兼容叙事壳、真实媒资和降级槽，Build Preview可解析资产并启动只有统一`textOpenWorld`状态的Session；旧混合包只读兼容，正式ProductRelease与真人时长证据仍由发布阶段负责 |
| 3.2.20 | 2026-09-07 | 补齐P2 PresentationProfile并落地P10/V1/V2：代码冻结18个UI消费槽、15个运行模块、必需媒资槽与全量降级，区分内容库存和单次游玩时长；确定性预检先验证Schema/Hash链/引用/可解性/预算/消费槽，再由双模型评审检查6项平衡与8项叙事指标；问题由代码定位到新Build唯一修复任务并传播stale，禁止原地改写已验收Artifact，真人时长校准仍为发布证据 |
| 3.2.19 | 2026-09-07 | 落地P9 SceneScripts/ChoiceContracts/ActionBindings：代码完整验签10件上游并向模型交付去重紧凑投影，覆盖任务委托/目标/收束、NPC三档态度对话、地点交互、随机事件/传闻及模板三变体；固定Choice与自然语言候选都只引用P8F Action Hash和唯一结果权威，战斗自由输入关闭，低置信度不执行、高风险需确认，模型不能创建运行内容或改状态 |
| 3.2.18 | 2026-09-07 | 落地P8后半制作经济/NPC运行/地图交互目录及P8F QuestFinalize/EncounterFinalize：11件叙事、任务与玩法Artifact以完整Hash链原子交付，模型只补受约束叙事/发牌语义，代码最终化全部Quest/Stage/Objective生命周期、Condition/Effect/Action、奖励、战斗、物品、制作、商店、NPC、地图、旅行、快旅、复活和世界演化真实引用；地区Director冻结普通任务、模板、随机事件、冷却、并发和空白牌，保护故事排除于发牌压力；表现变体留给P9；同时修正正式调度的Context预算传递并增加atomic JSON超额失败关闭，推荐总调用仍为150次 |
| 3.2.17 | 2026-09-07 | 落地P8 Map Interaction目录：原样继承完整地区、地点、道路和快旅拓扑，把每项地区生活/任务交互需求编译为地点入口并生成确定性SVG节点；代码确保全图连通、每地点可交互、逐步揭示、提前到达安全、关键故事不靠到达自动触发、快旅到访解锁且首版旅行无资源消耗/不中断，模型只写有界交互语义，全部运行Action/Condition/Effect/Scene/Quest引用留待P8F/P9装配 |
| 3.2.16 | 2026-09-07 | 落地P8 NPC Runtime目录：以任务消费者和地区需求区分主线/重要Agent角色与普通规则角色，人物小传/演绎保持整体内容资产；代码冻结关键保护、普通死亡、四时段日程、道德与阵营加权三档态度、商店/功能服务连续性及“替代功能但不继承独特内容”，对话与行为运行引用留待P8F/P9绑定 |
| 3.2.15 | 2026-09-07 | 落地P8 Crafting/Economy目录：任务recipe/vendor需求与每区基础供给共同生成可验证配方和商店，任务骨架保留消费者语境；模型仅从已登记来源物品与地点中选择并写语义，代码负责数量、价格、库存、服务Actor预留、来源/消耗闭环、反套利及全部未绑定运行槽，为后续NPC目录和P8F真实引用装配提供稳定输入 |
| 3.2.14 | 2026-09-07 | 落地P8 Progression、Enemy/Encounter和Item/Reward三类目录：共同读取QuestSkeleton与Manifest，分别形成20级成长/技能、地区敌人/遭遇、初始与任务物品、全部任务/遭遇奖励及敌人掉落；模型只负责受约束语义与有限选择，代码固定数值、稳定键、需求/地区/战斗目标覆盖、关键物品保护、来源闭环和主线1→5级1600经验预算；跨模块Action/Effect/Condition/Quest/Reward/Drop引用保持unbound等待P8F |
| 3.2.13 | 2026-09-07 | 落地P8 QuestSkeleton与ContentRequirementManifest：登记只读Brief/体验/玩法/主线/重要故事/地区生态的Context及专属Skill/Executor；精确把7主线Stage、6重要故事Stage、6普通任务种子和4地区模板编译为23个任务骨架与可执行Objective，代码固定保护任务等待、普通/模板生命周期、非到达触发和全部运行绑定unbound；需求清单覆盖每个Objective及地区角色/势力/地点交互，并向六类目录和QuestFinalize声明唯一owner，同名冲突、来源漏项、弱化保护、无敌人战斗和越权字段失败关闭 |
| 3.2.12 | 2026-09-07 | 落地P7 RegionNarrativePacks：登记只读Brief/体验/来源/地图/主线/重要故事的Context与专属Skill/Executor；AI为每区设计差异化身份、矛盾/状态轴、全地点生活计划、重要Agent与普通规则NPC分层、势力需求及6普通任务/4模板/12随机事件保底种子和传闻；代码固定全覆盖、owner唯一承接、稳定预留键、普通演化与主线等待隔离、全部正式目录unbound且全链可复验 |
| 3.2.11 | 2026-09-07 | 落地P6 SignificantThreads：登记只读Brief/来源/故事/结局/承诺/地区/主线的Context与专属Skill/Executor；AI精确设计至少两种owner、多方冲突系统、3～6个可玩Stage、氛围信号和局部后果，代码固定稳定键、owner预留/地区绑定、主线揭示窗口、安全等待、不可放弃过期/永久失败/普通状态阻断、非地点触发及主线不可改写/阻断；全部Quest/Scene/Actor/Faction/Condition/Effect绑定保持unbound且全链可复验 |
| 3.2.10 | 2026-09-07 | 落地P5 MainlineThread：登记只读Brief/玩法/故事/结局/承诺/地区/主角的Context与专属Skill/Executor；AI在冻结规模内编排Stage空间与体验、揭示、保护及恢复，代码固定严格链、起点、StoryBeat与Promise全覆盖、多结局终段分流、90～120分钟和1→5级节奏，以及等待/不可放弃过期/不可永久失败/普通状态不阻断/非地点触发；Quest/Scene/Reward/Condition保持unbound且全链可复验 |
| 3.2.9 | 2026-09-07 | 落地P4 RegionSkeleton：登记只读Brief/P1/体验/StoryArc的Context与专属Skill/Executor；AI把来源claim和全部故事空间需求编排为精确规模的地区、地点、功能、提前到达常态及连线，代码固定稳定键、全图/跨区连通、每区快旅复活点、渐进知识、距离耗时及非地点唯一主线触发；Scene/Quest/NPC/遭遇/商店/媒资和主线绑定保持unbound，全部规模、来源、需求、连通、治理和Hash可复验 |
| 3.2.8 | 2026-09-07 | 落地P3 StoryArchitecture：登记只读体验/主角/P1证据的Context与专属Skill/Executor；AI设计核心冲突、长程节拍、多结局差异与叙事承诺，代码固定严格顺序/等待/不可永久失败主线、阶段序列、稳定键、来源与显式假设权限、全结局核心目标达成及建立—回响—回收闭环；Condition/Scene保持unbound供下游兑现，全部上游、引用、顺序、绑定和Hash可复验 |
| 3.2.7 | 2026-09-07 | 落地P4 PlayerBuild：登记只读已验收体验/主角/Ruleset的Context与专属Skill/Executor；AI只生成身份演绎、非职业玩法风格、主副属性选择及初始技能物品语义，代码固定1级、12点属性预算、100货币、数量、机制和稳定预留键；在后续目录兑现前固定`reserved-unbound/playerDefinitionReady=false`，禁止把需求键伪装成可运行定义；全部上游、预算、键、binding和Hash可复验 |
| 3.2.6 | 2026-09-07 | 落地P2 GameplayRulesetSkeleton：登记只读已验收体验链与Ledger claim的Context Source及专属Skill/Executor；模型只生成世界化显示语义，代码冻结三属性、20级、1→5验收跨度、自动成长、G2公式、标准难度单人四操作回合战斗、三装备位、单货币、确定性制作交易和模块版本；Effect单一事实源分离模型、编译器与旧版只读权限，全部上游、固定边界、claim和Hash可复验 |
| 3.2.5 | 2026-09-06 | 落地P2体验设计：复用作者授权Brief终态并登记单一P2 Context Source；完整输入Hash绑定授权、Pin、P1证据、全部缺口与选中claim；代码编译不可由模型改写的GameBrief规模、自由度、主线/重要故事等待、普通世界演化、交互、战斗、媒资、预算和发布边界；模型只补充体验语义和主角小传，来源主角必须引用绑定所选角色单元的Ledger claim；ExperienceContract和ProtagonistAsset以basis/hash链复验，伪造claim、上下文、作者意图或固定边界失败关闭，不重复读取原始来源且不写WorldRelease/Session |
| 3.2.4 | 2026-09-06 | 落地P1来源整理证据链：登记精确批次Context Source及专属Skill/Executor；小说只交付本批私有冻结单元，WorldRelease只经Context Gateway按SourcePin资源坐标完整读取并复核双重Hash；SourceManifest区分已读与未读，SourceLedger强制逐项事实绑定已读单元、逐字引文、UTF-16偏移和批次，SourceGapReport由代码从实读集和覆盖标签生成未读及关键内容缺口；Pin→Manifest→Ledger→GapReport全链可验，伪造、漂移和未读引用失败关闭，仍不激活完整生产入口 |
| 3.2.3 | 2026-09-06 | 落地P0双来源SourcePin：WorldRelease冻结便携WorldReference、选择资源Hash与真实index读取证据；小说从受控Work/大纲/规范章序复制故事核心、大纲和正文，以20万字符有界SourcePinUnit自动分片；40种Artifact将Pin索引与单元分离且同属P0唯一owner；版本、选择边界、Brief/开始授权、nonce Hash、rights、读取证据与Pin全链可验，原始nonce和可变小说行ID不落库；相同Pin幂等、同Build换源及篡改失败关闭，不新增表或Context旁路 |
| 3.2.2 | 2026-09-06 | 落地P0～P10专属生产合同：冻结39种Artifact Kind、26任务DAG、22个模型型durable Run及按Brief分配的22次最低/150次推荐调用预算、唯一owner、六类P8目录并行/P8F最终绑定、确定性预检→平衡与语义双评审→V3唯一装配顺序，以及每项Run的重试、非重试错误、stale传播、候选采纳和完成回执；在全部Skill/Executor齐备前保持合同可验证但不激活线上入口 |
| 3.2.1 | 2026-09-06 | 将五项剩余校准收口为集中配置和稳定决策ID，冻结首版内容规模、关系阈值、保护任务UI、随机任务变体和AI预算硬保护 |
| 3.2.0 | 2026-09-06 | 接入36项首版产品决策；冻结来源、重要故事线等待、快速旅行、战斗输入、地图、媒资、存档与验收世界边界，并把未决项收缩为参数校准 |
| 3.1.2 | 2026-09-05 | 接入整体玩法规则骨架和Gameplay Catalogs；把任务生产拆成QuestSkeleton/ContentRequirementManifest与QuestFinalize，消除玩法内容后置造成的依赖缺口 |
| 3.1.1 | 2026-09-05 | 明确本文为叙事子系统规格，并接入文字开放世界整体产品与游戏系统施工入口 |
| 3.1.0 | 2026-09-05 | 首次形成StoryForge本地化施工规格；修正外部架构包的生产依赖、Agent计数、Artifact、存档、验证和物理表问题，并补齐产品UI、现有代码映射与阶段路线 |
