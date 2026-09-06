# AI 主导文字开放世界叙事基座 · StoryForge 施工规格

> 规格版本：3.2.4
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
- 22个模型型durable Run分别承担来源、体验、Ruleset、表现、故事、地区、主角、任务、六类玩法目录和评审；每个Run可以在自己的冻结预算中分批调用模型，例如按地区或重要故事线逐项生产；
- 完整Build的推荐预留为150次模型调用，低预算骨架最低为22次；最终预留不超过Brief授权，不能把“任务数”误当成“一任务只调用一次模型”；
- P8的成长、遭遇、物品奖励、制作经济、NPC运行和地图交互目录允许按依赖并行，P8F只能在六类目录完成后把任务绑定到真实引用；
- 每项任务显式声明输入、输出、依赖回执、Context Source、候选写目标、预算、超时、重试、不可重试错误、stale传播和完成Gate；
- `sourcePinHash`、`briefHash`、`planHash`、`controlEpoch`或上游Artifact Hash变化都会使下游保守stale；旧候选只读，不能直接采纳；
- 模型任务最多两次尝试，只允许传输、限流、协议或Schema局部修复；授权、余额、stale和结果未知不得隐藏重发；
- V3是唯一把已验收产物装配为G2运行包的节点，AI不得直接写正式Release或Session状态。

这套合同当前标记为`contract-only-until-skills-and-executors-registered`。G3-02～G3-17逐项补齐Schema、Skill和Executor，G3-18完成端到端证据后才替换现有通用生产入口，避免半套新DAG进入正式创建流程。

#### 5.4.2 P0双来源SourcePin落地

`src/lib/open-world/source-pin.ts` 已将世界观与小说来源收口为同一种可验证的P0交接物，但不伪造两类来源相同的物理读取方式：

- WorldRelease入口通过中立Gateway读取冻结目录，Pin只保存便携`WorldReference`、作者授权的资源坐标、各资源content hash和`index`级实读证据；本地Release记录ID被置零，产品不接触物理Release行或完整manifest；
- 小说入口只接受同项目内受控的小说Work，按作者选择解析故事核心、大纲和规范章序，把真实文本完整复制到产品私有SourcePinUnit；单元最多20万字符，超长章节自动分片，Pin不保存来源Work/Chapter/Outline的可变本地主键；
- 两类来源都冻结`sourceVersionHash`、包含选择边界的`sourceBoundaryHash`、Brief/开始revision、原始nonce的hash、明确rights basis、系统派生读取permission、实际读取证据hash和最终`pinHash`；
- WorldRelease在P0只声称实际读取了目录。全文/原文是否读取必须由P1的Context Manifest和SourceLedger证明；小说则因已完成私有全文复制，单元明确标记为`full`；
- P0复用`productBuildArtifacts`，先写独立SourcePinUnit，最后写SourcePin索引作为闭合标记。相同Pin可安全重试；同一Build试图更换来源会被视为stale并拒绝，必须重新确认Brief并建立新Build；
- 运行阶段只读取ProductRelease副本，既不回读活动小说，也不直接运行WorldRelease。

P0本身没有增加物理表、AI可写字段或第二套Context Source。单元与Pin共享既有Artifact导入、导出、删除、版本和Work作用域生命周期；P1在此基础上通过下述产品专属、已登记Context Source按批选择单元。

#### 5.4.3 P1来源整理、实读清单与证据账本落地

`src/lib/open-world/source-curation.ts` 已将“来源存在”“模型实际读过”“模型从来源中得出了什么”拆成三层不可混淆的证据：

- P0 SourcePin继续证明作者授权、冻结版本和选择边界；P1 SourceManifest逐个单元证明它是否被完整送入某个模型批次。Pin中的存在或小说已经私有复制，都不自动等于模型已读；
- 小说由登记的`text-open-world.source-pin` Context Source只暴露本批选择的完整单元；没有选择器时只返回Pin身份、数量和索引，绝不隐式把整本小说送入模型；
- WorldRelease由P1根据便携WorldReference重新解析本地冻结版本，只允许读取SourcePin已选资源，并经Context Gateway强制`full`深度；交付内容必须同时匹配冻结目录Hash与SourcePin单元Hash；
- SourceLedger中的每项事实都必须绑定已读单元、来源内容Hash、逐字引文、UTF-16起止偏移和模型批次。Schema解析器用实际交付正文复核`content.slice(start,end)`，未读引用、错误偏移和伪造引文全部失败关闭；
- SourceGapReport不由模型自行宣称覆盖率。代码依据SourceManifest的实读集合及Ledger的证据标签，确定性生成未读、故事核心、主角、核心冲突、角色、势力、地点和时间线缺口；模型只能补充矛盾、歧义和低证据缺口；
- Manifest、Ledger与GapReport依次绑定上游Hash、相同生成时间和受控rights证据，仍只产生`productBuildArtifacts`候选，不写世界引擎、正式ProductRelease或运行Session。

P1已登记专属Skill与Executor，但完整P0～P10线上入口仍保持关闭；直到G3-18完成共享durable scheduler、checkpoint、receipt、恢复与端到端Build证据后，才允许替代旧生产入口。

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
- 每个 Stage 都有进入条件、完成条件、失败边界、回收点和下一阶段契约。

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

第一阶段重要故事线不可由玩家主动删除，也不会因为玩家长期不介入而永久失败。它可以随世界时间推进到预先设计的安全等待点，但必须在该处等待玩家；显式参与后的分支和局部结果仍由故事线契约声明。

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
| 3.2.4 | 2026-09-06 | 落地P1来源整理证据链：登记精确批次Context Source及专属Skill/Executor；小说只交付本批私有冻结单元，WorldRelease只经Context Gateway按SourcePin资源坐标完整读取并复核双重Hash；SourceManifest区分已读与未读，SourceLedger强制逐项事实绑定已读单元、逐字引文、UTF-16偏移和批次，SourceGapReport由代码从实读集和覆盖标签生成未读及关键内容缺口；Pin→Manifest→Ledger→GapReport全链可验，伪造、漂移和未读引用失败关闭，仍不激活完整生产入口 |
| 3.2.3 | 2026-09-06 | 落地P0双来源SourcePin：WorldRelease冻结便携WorldReference、选择资源Hash与真实index读取证据；小说从受控Work/大纲/规范章序复制故事核心、大纲和正文，以20万字符有界SourcePinUnit自动分片；40种Artifact将Pin索引与单元分离且同属P0唯一owner；版本、选择边界、Brief/开始授权、nonce Hash、rights、读取证据与Pin全链可验，原始nonce和可变小说行ID不落库；相同Pin幂等、同Build换源及篡改失败关闭，不新增表或Context旁路 |
| 3.2.2 | 2026-09-06 | 落地P0～P10专属生产合同：冻结39种Artifact Kind、26任务DAG、22个模型型durable Run及按Brief分配的22次最低/150次推荐调用预算、唯一owner、六类P8目录并行/P8F最终绑定、确定性预检→平衡与语义双评审→V3唯一装配顺序，以及每项Run的重试、非重试错误、stale传播、候选采纳和完成回执；在全部Skill/Executor齐备前保持合同可验证但不激活线上入口 |
| 3.2.1 | 2026-09-06 | 将五项剩余校准收口为集中配置和稳定决策ID，冻结首版内容规模、关系阈值、保护任务UI、随机任务变体和AI预算硬保护 |
| 3.2.0 | 2026-09-06 | 接入36项首版产品决策；冻结来源、重要故事线等待、快速旅行、战斗输入、地图、媒资、存档与验收世界边界，并把未决项收缩为参数校准 |
| 3.1.2 | 2026-09-05 | 接入整体玩法规则骨架和Gameplay Catalogs；把任务生产拆成QuestSkeleton/ContentRequirementManifest与QuestFinalize，消除玩法内容后置造成的依赖缺口 |
| 3.1.1 | 2026-09-05 | 明确本文为叙事子系统规格，并接入文字开放世界整体产品与游戏系统施工入口 |
| 3.1.0 | 2026-09-05 | 首次形成StoryForge本地化施工规格；修正外部架构包的生产依赖、Agent计数、Artifact、存档、验证和物理表问题，并补齐产品UI、现有代码映射与阶段路线 |
