# StoryForge 数据流总表（字段 · AI 读 · 生成 · 写回）

> 目的：把每张「大功能表」（侧栏标签）的**字段、AI 读什么（上游）、AI 生成什么、产物写回哪里（下游）**梳理成唯一事实源。
> 用途：① 看清现状是否「逻辑贯通」；② 作为「统一上下文装配层 + 统一采纳写回层」重构的蓝图；③ 今后加功能先在此登记，从源头杜绝屎山。
> 创建：2026-06-04 ｜ 基于通读 `src/lib/types/*`、`src/lib/ai/adapters/*`、`src/stores/*`、各 `*Panel.tsx`。

---

## 〇、怎么读这张表（核心模型）

作者确认的模型：**每个 AI 动作本质都是「读某些表的某些字段 → AI 生成 → 写到某张表的对应字段」**。方向不同（自上而下生成 / 灵感反推 / 下游提取），机制相同。

```
[上游表的字段]  ──读──▶  [AI + 提示词]  ──生成──▶  [下游表的字段]
```

- **上游（设定）**：作者填、AI 写作时读。
- **创作（正文）**：实际写作。
- **下游（产物）**：AI 从已写正文提取。
- **工具（反推/考证）**：用户给料 → AI 反向生成 → 写回上游表（方向相反，形状相同）。

---

## 一、大功能表总览（侧栏标签 = 大功能表）

| 区 | 标签 | 性质 | 主要存储表 | 主 store |
|----|------|------|-----------|---------|
| 设置区 | **消耗统计** | ⚙️系统(下游) | `aiUsageLog` | ai-usage |
| 著作信息 | 项目概况 | 元数据 | `projects` | project |
| 著作信息 | 灵感反推 | 🛠️工具(反向) | （写回 worldview/storyCore/characters） | inspiration→worldview/character |
| 著作信息 | 项目参考 | 🛠️工具(分析) | `references` / `referenceChunkAnalysis` | reference |
| 设定库 | 世界总览 | 📥聚合展示 | （读多表） | worldview/worldGroup |
| 设定库 | 真实与幻想 | 📥设定 | `worldRulesProfiles` | world-rules |
| 设定库 | 世界起源 | 📥设定 | `worldviews`(worldOrigin/powerHierarchy/divineDesign) | worldview |
| 设定库 | 自然环境 | 📥设定 | `worldviews`(worldStructure/continentLayout/naturalResources…) | worldview |
| 设定库 | 人文环境 | 📥设定 | `worldviews`(races/factionLayout/politicsEconomyCulture/itemDesign…) | worldview |
| 设定库 | 历史年表 | 📥设定 | `histories`/`historicalTimelineEvents`/`historicalKeywords` | historical |
| 设定库 | 世界地图 | 📥设定 | `worldNodes`/`world-map` | world-node |
| 设定库 | 故事设计 | 📥设定 | `storyCores` | worldview(storyCore) |
| 设定库 | **设定词条** | 📥设定 | `codexCategories`/`codexEntries` | codex |
| 设定库 | 道具系统 | 📥设定 | `itemSystems` | project-singletons |
| 设定库 | 角色（主/次/NPC/路人） | 📥设定 | `characters` | character |
| 设定库 | 关系网 | 📥设定/下游 | `characterRelations` | character-relation |
| 创作区 | 创作规则 | 📥设定 | `creativeRules` | （单例） |
| 创作区 | 大纲 | 📥设定/创作 | `outlineNodes` | outline |
| 创作区 | 角色驱动 | 🛠️工具 | （生成剧情建议） | — |
| 创作区 | 故事线 | 📥设定 | `storyArcs` | story-arc |
| 创作区 | 章节 | ✍️正文 | `chapters` / `detailedOutlines` | chapter / detailed-outline |
| 创作区 | 伏笔 | 📥设定/下游 | `foreshadows` | foreshadow |
| 创作区 | 重要地点 | 📥设定 | `importantLocations` | location |
| 创作区 | 状态表 | 📤下游 | `stateCards` | state-card |
| 创作区 | 物品栏 | 📤下游 | `itemLedger` | item-ledger |
| 创作区 | 故事年表 | 📤下游 | `storyTimelineEvents` | story-timeline |
| 创作区 | 场景考证 | 🛠️工具(校验) | （无写回，建议） | — |

---

## 二、主数据流表（每张表：字段 → AI 读 → 生成 → 写回）

> 「AI 读」列 = 该功能生成时实际拼进 prompt 的上下文（来自 adapter 签名）。**★ 已接词条** 表示 `buildCodexContext` 已注入。

### 📥 上游设定（作者填 + AI 可生成，AI 写作时读）

| 大功能表 | 关键字段（输出/存储） | AI 生成时读（上游） | 生成 → 写回 |
|---------|----------------------|--------------------|------------|
| **世界起源** worldview | `worldOrigin` 世界来源、`powerHierarchy` 力量体系、`divineDesign` 神明 | 现有世界观各字段（existingContext，按维度） | 单维度文本 → 该 worldview 字段 |
| **自然环境** worldview | `worldStructure`、`worldDimensions`、`continentLayout`、`regionDimensions`、`mountainsRivers`、`climateByRegion`、`naturalResources`(rareCreatures/herbs/minerals/others) | 同上（worldview 上下文） | 单维度文本 → 该字段 |
| **人文环境** worldview | `races` 种族、`factionLayout` 势力、`politicsEconomyCulture`、`internalConflicts`、`itemDesign` 道具设计 | 同上 | 单维度文本 → 该字段 |
| **真实与幻想** worldRulesProfiles | `entries`(各节点 历史锚点/架空改造/冲突优先)、`customNodes`、`globalNote` | （作者填为主） | → worldRulesProfile |
| **故事设计** storyCores | `theme`、`centralConflict`、`plotPattern`、`mainPlot`、`subPlots`、`logline`、`concept` | `worldContext`（★ 经 buildWorldContext） | 单维度 → storyCore 字段 |
| **创作规则** creativeRules | `writingStyle`、`narrativePOV`、`atmosphere`、`prohibitions`、`consistencyRules`、`specialRequirements`、`referenceWorks`、`citedReferenceIds/InsightIds` | `worldContext` + `storyCore` | 单维度 → creativeRules 字段 |
| **设定词条** codex | 分类(domain/builtInKey/fieldSchema) + 词条(name/summary/description/fields/refs，7 内置类) | （作者填 / 词条内 ref 关联） | → codexEntries |
| **道具系统** itemSystems | overview + items(JSON) | （作者填） | → itemSystem ⚠️ 将被词条 artifact 取代(35-b) |
| **角色** characters | `name/role/alignment/shortDescription/appearance/personality/background/motivation/abilities/relationships/arc`、章节出场范围、世界归属 | `worldContext`(★ 已接词条) + 已有角色名单 | 角色 JSON → characters 表 |
| **重要地点** importantLocations | `name/tags/description/significance/parentId`(树状) | （作者填） | → importantLocations |
| **历史年表** histories/historical* | 概述 + 时间线事件 + 关键词（按世界标签） | （作者填，与世界规则「事件」联动） | → historical* |
| **世界地图** worldNodes | 节点/区域/连线 | `factionLayout`（人文势力自由文本）⚠️ 未接词条 | → worldNodes |
| **故事线** storyArcs | `name/type(main/sub)/stages`(起承转合) | `worldContext`(★ 已接词条) + `storyCore` + 大纲摘要 | → storyArc |
| **大纲** outlineNodes | `parentId/type(volume/chapter)/title/summary/order/worldGroupId` | `worldContext`(★) + `storyCore` + `characterContext` + `worldRulesContext` | 卷/章 JSON → outlineNodes |
| **伏笔** foreshadows | `name/type/status/description/plantChapterId/echoChapterIds/resolveChapterId/importance/urgency` | `worldContext`(★) + `characterContext` + 已有伏笔 | 伏笔 JSON → foreshadows |

### ✍️ 正文创作

| 大功能表 | 字段 | AI 读（上游） | 生成 → 写回 |
|---------|------|--------------|------------|
| **章节·细纲** detailedOutlines | `scenes[]`(title/summary/characterIds/location/conflict/pace)、`openingHook`、`endingCliffhanger`、`foreshadowIds`、`emotionArc` | `worldContext`(★) + 角色 + 前后章摘要 + 伏笔 | 细纲 JSON → detailedOutlines |
| **章节·正文** chapters | `title/content/wordCount/status/summary/outlineNodeId` | `worldContext`(★ 含多世界) + `characterContext` + 状态卡(按需召回) + 伏笔 + 记忆 + 前章结尾 + 大纲 | 正文 → chapters.content |

### 📤 下游产物（AI 从已写正文提取）

| 大功能表 | 字段 | AI 读（上游=正文） | 生成 → 写回 |
|---------|------|-------------------|------------|
| **状态表** stateCards | `category(角色/地点/物品/势力/事件)/entityName/fields(JSON)` | 章节正文 + 当前状态表(diff) | 状态变更 → stateCards（用户审核） |
| **物品栏** itemLedger | `itemName/action(获得/消耗)/quantity/chapterId` | 章节正文 | 物品流水 → itemLedger |
| **故事年表** storyTimelineEvents | `title/storyTime/importance/description/chapterId/order` | 章节正文 | 事件 → storyTimelineEvents |
| **关系网** characterRelations | `fromCharacterId/toCharacterId/relationType/label/description` | 角色 + 正文（提取） | 关系 → characterRelations |

### 🛠️ 工具 / 反向流（用户给料 → AI 反推 → 写回上游表）

| 工具 | AI 读 | 生成 → 写回 |
|------|-------|------------|
| **灵感反推** inspiration | 用户碎片灵感 + 全世界概览(多世界) | `worldview`(worldOrigin/powerHierarchy/continentLayout/climateByRegion/historyLine/races/factionLayout) + `storyCore`(theme/centralConflict/plotPattern/mainPlot/logline) + `characters[]` → 写回对应表 |
| **AI 建议世界** world-group-ai | 全世界概览 | 世界组 + 各世界 worldview |
| **角色驱动剧情** character-driven-plot | `worldContext`(★) + 角色弧线 | 剧情建议（暂不直接落库） |
| **场景考证** scene-verify | `worldContext`(★) + 历史年表 + 世界规则 | 考证建议（无写回，纯建议） |
| **项目参考·深度分析** reference | 上传作品分块 | 分块分析 + 角色聚合(AI) → references/analysisSummary/mergedCharacters |
| **章节审校** review | 章节正文 + `worldContext`(★含词条) + 角色 + 伏笔 + 状态表 | 五维问题清单（建议，无写回） |

---

## 三、当前「逻辑不贯通 / 屎山隐患」清单（重点标识）

> 这是盘表过程中暴露的真实问题，重构要逐条消除。

### 🔴 A. 上下文装配（读侧）是散的 —— 加一个源要改 N 处、必漏

- 现有 **9 个独立 `build*Context` 函数**（worldview/character/rules/codex/historical/ref/masterInsight/worldRules/genre），每个生成面板**各自手挑、手拼**子集，顺序/截断不一。
- **单世界 / 多世界两条平行路径**（同步 `buildWorldContext` vs 异步 `buildCurrentWorldContext`），在每个面板里 `if(多世界)…else…` 各抄一遍。
- 实证：加词条注入时要改 ~10 处，曾**漏 5 处 + 多世界过滤 bug**（已修）。
- **影响面**：所有「📥设定/✍️正文」的生成入口。

### 🔴 B. 采纳/写回（写侧）是散的 —— 字段映射易错、静默丢失

- 字段映射散落在 **9+ 组件**（InspirationPanel、各 Worldview 面板、StoryCore、CreativeRules、ReferencePanel…）。
- 历史 bug：灵感反推 AI 吐 `summary/geography`，实际字段是 `worldOrigin/continentLayout` → 静默丢失，采纳后为空。
- 刚修 bug：`saveWorldview/saveStoryCore/savePowerSystem` 仅看内存记录，为 null 时新增重复记录 → 面板读 `wvList[0]` 旧空记录显示空（已改为以 DB 为准）。
- **缺校验**：AI 输出未知字段不会报警，直接丢。

### 🟠 C. 同一概念多处重复存储 —— 词条化重构正在解决

- **势力**：`worldview.factionLayout`(自由文本) + `factions` 表 + 词条 `faction` 三处并存。
- **道具**：`worldview.itemDesign` + `itemSystems` 表 + 词条 `artifact` 三处。
- **自然物产**：`worldview.naturalResources` + 词条 `mineral/herb/beast` 两处。
- **力量**：`worldview.powerHierarchy`(字段) + `powerSystems`(表) + 未来「修炼体系」。
- 现状：世界地图仍读旧 `factionLayout`，词条尚未供它读 → **不贯通点**。（Phase 35-b 合并后消除）

### 🔴 F. 「半截改版」读写错位全项目扫描结果（2026-06-04）

> 按「面板写的字段 ≠ AI 读的字段 / 上下文漏注入」逐项排查，发现并修复三处：

1. ✅ **世界观（单世界）**：`buildWorldContext` 原读 v2（summary/geography/society/rules），面板写 v3 且 summary 已无人写 → 单世界世界观喂不进 AI。已改读 v3。
2. ✅ **故事核心（多世界）**：`buildCurrentWorldContext` 原不读 storyCore → 多世界写作缺主题/冲突/主线。已补注入。
3. ✅ **创作规则（全模式）**：creativeRules（写作风格/视角/基调/禁忌/一致性/特殊要求）**从不进入任何生成 prompt**（只有 citedIds + 题材预设被用）→ 整张创作规则表对 AI 无效。已新增 `buildCreativeRulesContext` 并注入章节正文生成。

> 这些全是「两条读取路径各读各的 + 加字段不收口」导致的漂移，正是统一读取层 R-1 要根治的；R-1 完成后此类不可能再发生。

### 🟠 D. 旧/新字段双轨（v2/v3）—— 单世界读取已修，双轨待清

- worldview 有 v2 旧字段(`geography/society/rules/summary`) 与 v3 新字段(`worldOrigin/…`) 并存。
- **已发现并修复的严重 bug（2026-06-04）**：`buildWorldContext`(单世界) 原只读 v2 字段，而三个世界观面板只写 v3 字段，且无任何地方再写 `summary` → **单世界模式下作者填的整个世界观喂不进 AI**（仅 storyCore/powerSystem 漏过）。已改为读 v3 字段（与多世界 `buildCurrentWorldContext` 对齐），v2 仅作极老项目兜底。
- **仍待清理**：v2 旧字段本身仍存在于表结构中（双轨）；根治在统一读取层 R-1 + 词条化 35-b 一并收口。

### 🟡 E. 部分下游未回流上游

- 状态表/物品栏/故事年表是纯产物，默认不回流写作上下文（设计如此）；但「主角当前境界/位置」若能回流可防境界倒退（Phase 34 规划）。属可选增强，非 bug。

---

## 三-bis、AI 消耗统计（已实现 2026-06-04）

> 设置区新增「消耗统计」页。在 AI 调用唯一出口（`client.ts` 的 `streamChat/chat`）记录每次用量，持久化到 `aiUsageLog`（DB v26）。

- **字段**：`timestamp`（年月日时分秒）、`category`（消耗类型，来自 moduleKey，如 chapter.content → 正文生成）、`model`、`inputTokens`、`outputTokens`、`costUsd`。
- **AI 读**：无（这是纯下游产物，记录 AI 行为本身）。
- **生成 → 写回**：每次 AI 调用拿到 provider 返回的 usage → 计算费用 → 写 `aiUsageLog`。
- **消耗类型分类**：`usage-log.ts` 的 `categoryMeta` 把 moduleKey 映射为友好标签 + 配色（正文生成/世界观生成/主角状态提取/大纲生成/角色生成/…/其他）。已在 ChapterEditor、Outline、Worldview-StoryCore、CreativeRules、Character 等高频入口打标；其余默认「其他」，随 R-1 统一执行层补全。
- **费用**：`usage-log.ts` 的 `MODEL_PRICING`（每 1M token 美元单价，按模型名匹配，估算）× token；美元→人民币汇率可在页面调整（`localStorage`）。
- **页面**：时间 / 类型标签 / 模型 / 输入 / 输出 / 花费（美元在上、人民币在下）；顶部汇总总输入/输出/总花费；支持「仅当前项目」筛选、调汇率、清空。
- **关键文件**：`lib/ai/usage-log.ts`、`stores/ai-usage.ts`、`components/settings/UsageStatsPage.tsx`、`lib/ai/client.ts`（埋点）、`hooks/useAIStream.ts`（透传 category）。

---

## 三-ter、全量贯通审计（2026-06-04，逐字段交叉比对）

> 对每个实体逐字段核对「面板写 vs AI 读 vs 采纳写回」，把「填了但 AI 读不到 / 版本错位 / 漂移 / 未生效」全部列出。

### ✅ 本轮已修复

| # | 问题 | 性质 | 修复 |
|---|------|------|------|
| 1 | 世界观 6 个字段 **divineDesign（神明）/worldDimensions（疆域尺寸）/regionDimensions（重镇分布）/mountainsRivers（多世界）/worldEvents（世界大事记）/internalConflicts（矛盾冲突）** 无任何上下文 builder 注入 | 填了读不到 | `formatWorldviewBlock` 全字段覆盖 |
| 2 | 单世界 / 多世界两个 builder **各读各的世界观字段**（漂移源头） | 漂移 | 抽 `formatWorldviewBlock/formatStoryCoreBlock/formatPowerSystemBlock` 三个**共享格式化函数**，单/多世界共用 → 单一事实源 |
| 3 | 力量体系**等级阶梯 `levels` + `rules` 漏读**（只读 name+description） | 填了读不到 | `formatPowerSystemBlock` 解析 levels 阶梯 + rules |
| 4 | 故事核心 **logline（一句话故事）/subPlots（复线）漏读** | 填了读不到 | `formatStoryCoreBlock` 全字段 |
| 5 | 角色 **appearance（外貌）漏读**（核心角色完整信息里没外貌） | 填了读不到 | buildCharacterContext 补 appearance |
| 6 | **重要地点整张表从不进写作上下文**（仅用于地图生成） | 整表未生效 | 新增 `buildLocationContext` 并注入章节正文 |

> 连同此前几轮已修：世界观单世界 v2/v3 错位、故事核心多世界遗漏、创作规则不注入正文、灵感反推采纳为空（DB 去重）、多世界词条过滤 bug。

### ✅ 第二批已修复（逐项细查，2026-06-04）

| # | 问题 | 修复 |
|---|------|------|
| 7 | **B**：世界观 naturalResources（自然物产）/itemDesign（道具设计）自由文本不注入 | 现注入（codex 暂空无双轨）；35-b 迁词条后撤掉 |
| 8 | **多世界覆盖**：场景生成 / 细纲生成 / 角色生成 在多世界下写死单世界上下文（读主世界，会串世界） | 新增 `buildNodeWritingContext`（按章节节点父链解析所属世界）；ScenePanel/DetailedOutlinePanel 改用之；CharacterPanel 改用选中/活跃世界的 `buildCurrentWorldContext` |
| — | **C 澄清**：`buildHistoricalContext` 实读历史年表表（v3，正常）；真正读 v2 的是 `buildExistingWorldview`，仅被**不可达的死面板 `WorldviewPanel`** 使用 | 记为死代码，待清理（非线上 bug） |
| — | **A 结论**：创作规则已注入「章节正文」（写作风格/视角/禁忌最相关处）；大纲/细纲为结构规划，写作风格不适用，不强注入（避免无谓 token） | 视为已落到位 |
| — | **D 订正**：「AI 建议世界」实际输出 7 个世界观字段（非 5），缺 worldStructure/politics/worldEvents 等 | 低优先（便捷生成器，可手动补），待补 schema |

### ✅ 第三批已修复 + 已核对无误（逐项细查续，2026-06-04）

| 项 | 结果 |
|---|------|
| **大纲生成读遗留字段**：`OutlinePanel` 的故事核心上下文读 `storyLines`（v3 已改名 mainPlot，用户填的是 mainPlot → 读到空） | ✅ 修复：改读 `mainPlot \|\| storyLines`，并补复线 |
| 创作规则 `toneAndMood`（旧名）vs `atmosphere`（v3） | ✅ 核对：面板读写一致用 toneAndMood，`buildCreativeRulesContext` 取 `atmosphere \|\| toneAndMood`，无错位 |
| 导入写回（chunk-writer）worldview 字段 | ✅ 核对：import prompt 输出 v3 keys，写回 v3，对齐 |
| 项目参考（ReferencePanel）是否漏采纳 | ✅ 核对：参考分析为只读分析工具，不写回项目（设计如此），无字段错位 |
| 历史年表 / 世界地图 / 情感节拍 生成读字段 | ✅ 核对：HistoryPanel/world-map-adapter 读 v3；EmotionBeat 经 prop 拿到正确上下文 |
| 状态表 / 物品栏 / 故事年表 无 worldGroupId | ✅ 核对：**设计如此**——物品栏明确「项目级，诸天流主角跨世界携带」；非 bug |

### 🔴🔴 第四批：发现并修复严重数据丢失 +清扫（2026-06-04）

| # | 问题 | 严重度 | 修复 |
|---|------|--------|------|
| **导出漏表（丢数据）** | JSON 导出/导入（项目备份）**完全没有** `importantLocations`（重要地点）/ `worldRulesProfiles`（真实与幻想）/ `codexCategories`+`codexEntries`（设定词条）→ **备份再恢复会丢掉这三类用户内容** | 🔴 严重 | 已补全导出 + 导入（含树 parentId / 词条 categoryId / worldGroupId 重映射）。gist 导出复用同一格式，一并修复 |
| **J 死代码清扫** | `WorldviewPanel`（侧栏不可达）+ `buildExistingWorldview`（读 v2，仅它用）+ `'worldview'` 路由/类型 | 清理 | 已删除 |
| **H 批量多世界** | 批量大纲/批量细纲在多世界下用单一上下文 | 中 | 批量 runner 加 `worldContextResolver`，逐卷/逐章按所属世界（`buildNodeWritingContext`） |
| ⚠️ 顺带发现 | 多世界 export/import 的 `worldGroupId` 重映射键值错位（`remap` 用 export-index 表查 raw 旧 id）；单世界无影响，多世界备份恢复会丢世界归属 | 待修 | 已列入 ROADMAP「BUG-EXPORT-WG」（含问题机制 + 方案 A/B），独立于本次数据丢失修复 |

### 第五批：导出格式 / 上下文快照 / 单例工厂 / 全代码扫（2026-06-04）

| # | 问题 | 严重度 | 修复 |
|---|------|--------|------|
| **单例工厂重复记录** | `makeSingletonStore.save` 与旧 `saveWorldview` 同 bug（内存为 null 时新建重复）→ 影响 geography/history/itemSystem/creativeRules 四单例 | 🔴 数据 | 工厂层一次修复：先以 DB 为准定位再 update/add |
| **HTML 导出世界观为空** | `html-builder` 的「世界观设定」只渲染世界树 worldNodes，**完全没渲染世界观字段** → 单世界导出设定集世界观空白 | 🟠 | 补全 v3 世界观字段渲染 + 角色卡补外貌/动机/能力/弧线 |
| **上下文快照世界观为空** | `context-snapshot`（注入写作的「上下文快照」）只读 v2 字段 → v3 用户快照世界观空白 | 🟠 | 改读 v3，v2 仅兜底 |
| **故事核心生成上下文过薄** | `StoryCorePanel` 世界上下文仅 worldOrigin 一个字段 | 🟡 | 补力量/种族/势力/历史线等关键字段 |
| 消耗类型补标 | 故事年表提取/物品提取/批量章纲/工作流 的 AI 调用未分类 | — | 已补 category |
| **细纲 getOrCreate 重复风险** | `detailed-outline.getOrCreate` 仅查内存 state，store 未加载/竞态时会对同一节点重复建细纲 | 🟡 数据 | 内存未命中时按 outlineNodeId 查 DB 兜底 |

**第五批额外核对安全**：useAutoSave（refs→最新数据 + 卸载 flush，无陈旧闭包）；useAutoBackup 复用 export（含数据丢失修复）；useBeforeUnload 正常；批量 abort 正确复位；关系提取经 `matchRelations` 解析 name→id；prompt-engine 缺失变量→空串不漏占位；world-map nations「culture 复用」注释为误导（cells 未改，无 bug）；world-map 为视觉子系统，bug 不影响小说数据。

**本次全量审计扫描覆盖**：导出/导入/快照/自动备份（数据完整性）、全部 AI 生成与提取上下文（v2/v3 + 单/多世界）、全部解析器与 prompt 种子字段对齐、所有单例/集合 store 的写入幂等、自动保存/卸载/关闭数据安全、跨项目泄漏、JSON.parse 健壮性、abort/错误恢复、死代码。

**第六批：world-map 子系统 + 导出完整性终检（2026-06-04）**
- world-map 数据路径安全：地图配置存 `worldNodes.mapConfigJSON`（**已在导出覆盖范围内**），渲染结果按 seed 确定性重算、不持久化 → 无数据丢失；地图生成解析由调用方 try/catch 保护。world-map 渲染算法属纯视觉，bug 仅影响地图长相、不涉小说数据，未逐行验证（需运行时验证）。
- **导出完整性终检**：逐一核对 27 张表，未导出的 `snapshots`（本地版本历史）/ `promptTemplates`·`promptWorkflows`（全局 scope=system/user，非项目数据）/ `importJobs·Sessions·Logs·Files`（临时导入态）/ `aiUsageLog`（统计）**均为合理排除**（app 级/临时/统计）。**项目内容表已全部纳入导出**。

> ✅ 结论：除 world-map 视觉渲染算法（需运行时验证）外，**涉及小说数据完整性与 AI 贯通的代码已全量静态扫描完毕**，发现的问题已全部修复或记入待开发。

**核对确认安全（排除嫌疑）**：
- 版本快照还原复用 export/import（已含数据丢失修复）；`ensure-schema` REQUIRED_TABLES 保守（不误删老用户）。
- WorldMapPanel / HistoryPanel 多世界正确（按当前世界）；EmotionBeat 经 prop 拿真实上下文。
- 所有解析器（inventory/timeline/arc/relation/plot/character/outline/import）字段与表对齐、防御性默认。
- 无跨项目查询泄漏（toArray 均带 projectId，除有意的全局表）；导入大纲正确重建 parentId 树。
- 所有 `JSON.parse(AI 输出)` 均被 try/catch 保护（解析器内部 return null/[]，或调用方 try/catch + 错误展示，如 voronoi 地图）。
- 提示词种子输出 v3 字段 key（worldOrigin/theme/mainPlot…），与解析/写回对齐。
- 无藏 bug 的 TODO/FIXME（仅 Phase 37 占位、地图引擎内部注释）。

### 🟠 仍待处理（已记录，低优先 / 需权衡）

> 以下为剩余已知项，均为低严重度或需 DB 改动，列出供决策；高价值 LIVE 漏洞已基本清完。

| # | 问题 | 处置 |
|---|------|------|
| A | **创作规则仅注入「章节正文」**，大纲/细纲/批量生成未注入 | R-1 统一执行层一并接入 |
| D | 「AI 建议世界」输出 7 个世界观字段（缺 worldStructure/politics/worldEvents 等） | 便捷生成器，可手动补；低优先，待补 schema |
| E | 重要地点 `importantLocations` **无 worldGroupId**，多世界下全量注入（非按世界隔离） | 需 DB 迁移，niche，权衡后再做 |
| G | ForeshadowPanel / StoryArcPanel 在多世界下用单世界/全局上下文（伏笔、故事线本为项目级，模糊） | 低，项目级概念，可用活跃世界或 all-worlds |
| H | 批量细纲 / 批量大纲 在多世界下用单一上下文（非逐章按世界） | 中低，批量场景 |
| I | HistoryPanel / WorldMapPanel 生成时用 store 内 worldview（多世界未必是目标世界） | 低 |
| J | 死代码：`WorldviewPanel`（侧栏不可达）+ `buildExistingWorldview`（读 v2，仅它用） | 清理项，待删 |
| K | 创作规则未注入大纲/细纲生成 | 判定：写作风格不适用于结构规划，不强注入（避免无谓 token） |

### 根因与根治

绝大多数已修项源于**同一个病根**：上下文读取没有单一入口，字段散落在多个 builder/面板里手写，加字段不收口 → 必然漏、必然漂移。本轮已：① 用「三个共享格式化函数」收口世界观/故事核心/力量体系（消除字段漏读与单/多世界漂移）；② 用 `buildNodeWritingContext` 收口「按章节解析所属世界」（消除场景/细纲/角色多世界串台）。剩余 D/E/G/H/I 多为低severity 或需权衡，**彻底根治仍需 R-1 统一上下文装配层**。

---

## 三-quater、功能逻辑审计（核心写作链路，2026-06-04）

> 逐个读核心功能的业务逻辑找 bug（非数据/AI 流，是功能本身正确性）。

### ✅ 已修复

| 功能 | bug | 修复 |
|------|-----|------|
| **状态表 `applyDiffs`**（状态提取，核心高频） | ① 同一**新实体**的多条字段变更各建一张卡 → 同名重复卡；② 同一**已有实体**的多条字段变更各自从陈旧快照 parse 再写 → 互相覆盖、只剩最后一条字段。一个角色一章常同时改 位置+状态+持有物，**经常触发** | 按 (category, entityName) 聚合本批次所有 diff、逐实体合并字段后统一写库 |

### 🟠 发现的问题（已记录）

| 功能 | 问题 | 处置 |
|------|------|------|
| **上下文预算自动裁剪** `autoTrimToFit` | 实现了但**只用于显示**（ContextBudgetBar 算"会裁哪些层"给用户看），实际发送的上下文从不真裁 → 超出模型窗口时直接 API 报错而非优雅降级（多数被三层记忆预算兜住，但 L3 引用/洞察可叠加超限） | 记入 ROADMAP（需 token-aware 组装才能真裁，非小改） |
| **三层记忆 semantic 预算** | write 模式 semantic 仅 2000 字，要塞 世界观+角色+伏笔；补全世界观字段后 worldContext 可达 3000 → 截断，伏笔排其后易被挤掉 | 调优项：复核预算或调整层内顺序（角色另有独立 prompt 槽，伏笔仅此一处需留量） |

### ✅ 核对无误

- 物品栏 / 故事年表 **重新提取**：均先 `deleteByChapter` 再 add → 无重复累加（**正确**，与状态表旧 bug 形成对比）。
- 工作流 `inputMapping`：全部 seed 仅用 `previousOutput`，WorkflowRunner 实现覆盖到位。
- 伏笔 `updateStatus` 仅改状态、不自动联动埋设/回收章节（埋设章节为用户显式设置，设计如此）。
- 导入续跑：scanIncomplete + loadBlob + 续跑结构完整。
- 故事块层级（卷→故事块→章）：parentId + order（取 siblings.length）正确。
- 参考分析分块/合并、master-studies 流水线（workId 维度）、AI 配置预设（localStorage 增删改）、写作风格注入（代码定义预设按 id 查）：逻辑健全，无字段错位。
- ⚠️ `filterActiveCharacters` 用章节 **ID** 比较当作故事顺序（`exitChapterId < currentChapterId`），章节重排后理论上会错；但 `firstAppearChapterId/exitChapterId` **全项目无 UI 写入**（恒空）→ filter 实际等于返回全部，**当前休眠无影响**。如未来加这两字段的 UI，需改为按 `order` 比较。

> **功能逻辑审计结论**：核心写作链路（三层记忆 / 状态提取 / 物品·年表 / 伏笔 / 工作流 / 大纲块 / 参考分析 / 配置预设 / 风格注入）逐个读过；除状态表 `applyDiffs` 一个真 bug（已修）外，其余逻辑健全，另记 2 个调优/降级项（autoTrimToFit 真裁剪、记忆 semantic 预算）与 1 个休眠边界（filterActiveCharacters）。

---

## 三-quinque、复核（审计自身，逐条核对记录真伪，2026-06-04）

> 应要求对前述全部记录逐条回查代码，验证「已修」是否真在、「安全」是否属实、有无记错。

### 🔴 复核中新发现并修复（之前漏掉）

| # | 问题 | 修复 |
|---|------|------|
| **deleteGroup 孤儿数据** | 删世界组时级联删了 worldview/power/geo/histories/worldNodes，**漏删 `historicalTimelineEvents` / `historicalKeywords` / `codexEntries` / 该世界自定义 `codexCategories`**（均带 worldGroupId）→ 删世界后留死数据 | 补齐这四类的级联删除 |
| **migrateToMultiWorld 漏盖章 codex** | 开多世界时把 worldview 等盖章到主世界，**漏了 `codexEntries`** → 现有词条不归主世界而残留 null=全局，会泄漏到所有世界（斗破显示遮天的矿物） | 补 `stamp(codexEntries)`（仅词条；内置/自定义「分类」保持全局 null，所有世界共用结构，不盖章） |

### ✏️ 记录订正（之前记得不够准）

- **「naturalResources/itemDesign 注入·codex 无双轨」**订正：codex（35-a）已上线，**若用户同时填了世界观自由文本字段与词条，会有少量重复注入**（非 bug，仅冗余 token）；35-b 迁移后消除。原"无双轨"表述不准确。

### ✅ 复核确认「已修/安全」属实（抽查无误）

- 三表导出/导入（importantLocations/worldRulesProfiles/codex）：query + 数据对象 + 还原 + codex worldGroupId remap **四处俱全**。
- 三个共享格式化函数：`buildCurrentWorldContext` 与 `buildNodeWritingContext` **确实都 import 且调用**。
- SVG 清洗 `sanitizeSvg`：确实在 `setSvgContent` 处应用。
- 状态表 `applyDiffs` 新聚合逻辑：existing 更新 + 新建分支均正确。
- `buildNodeWritingContext` 单世界路径：wv/sc/ps 三者均加载、用共享函数。
- `client.ts` 流式 `JSON.parse` 确在 try/catch（「JSON.parse 均受保护」属实）。
- **BUG-EXPORT-WG 分析复核为真**：export 的 worldGroupId 是 `...rest` 原始 id（未转 index），import `remap` 用 export-index 表查 → 键不匹配确会丢世界归属。记录准确。

> 复核结论：已修项均真实在位且正确；安全项抽查属实；订正 1 处表述（codex 双轨）；**复核过程本身又揪出 2 个之前漏掉的多世界数据完整性 bug（deleteGroup 孤儿、migrate 漏盖章 codex）并已修**。

---

## 三-sex、删除引用完整性审计（之前完全未扫的一类，2026-06-04）

> 扫「删除某条数据时，引用它的数据会不会变成悬空孤儿」。这一整类之前没专门查过，结果扫出 4 个真 bug。

### 🔴 已修复

| 删除操作 | 孤儿问题 | 修复 |
|---------|---------|------|
| **deleteNode（大纲节点）** | 级联删了子节点，但**漏删挂在节点上的 `chapters`（正文内容！）+ `detailedOutlines`** → 删大纲后正文成不可达孤儿 | 按 outlineNodeId 级联删除 chapters + detailedOutlines |
| **deleteCharacter** | **漏删引用该角色的 `characterRelations`** → 关系网显示「角色#id」断链 | 按 from/toCharacterId 清理关系 |
| **deleteChapter** | 漏删紧耦合的 `emotionBeatCards` | 补清理（物品/年表/伏笔的 chapterId 软引用保留——属独立产物，语义不明确不强删） |
| **deleteProject（重大）** | 级联约 30 表，却**漏了 `importantLocations` / `worldRulesProfiles` / `codexCategories` / `codexEntries` / `aiUsageLog`** → 删项目后这些用户内容永久孤儿 | 补齐这 5 张表的级联删除 |

### ✅ 核对无误

- deleteReference 级联 referenceChunkAnalysis、codex deleteCategory 级联 entries、deleteGroup 级联世界数据（上一批已补全）：均正确。

### ⚠️ 反复出现的根因（架构建议）

`importantLocations / worldRulesProfiles / codex` 这几张较新的表，已被发现**反复漏接入生命周期操作**：导出（已修）、deleteProject（本批已修）、deleteGroup（上批已修）、migrateToMultiWorld（上批已修）。根因同「上下文装配漂移」：**没有一份「项目全部表」的唯一清单**，每个生命周期操作各自手列表 → 加新表必漏某处。
**建议**：建一份 `PROJECT_TABLES` 注册表（含每表的 projectId/worldGroupId/外键信息），export / deleteProject / deleteGroup / migrate 全部从它派生 → 加新表只改一处，杜绝此类漏接。已记入 ROADMAP。

---

## 四、统一架构方案（蓝图）

把上面 A/B 两条散缝各收成一根，C/D 由词条化重构收口。

### ① 统一上下文装配层（读侧）

- 单一入口：`assembleContext(projectId, { worldGroupId?, need: [...], referenceText? })`。
- 内部**只判一次**单/多世界；遍历**数据源注册表**（每源声明 `{id, fetch, format, budget}`）。
- 所有生成面板改为：声明「我要哪些源」→ 调一次 `assembleContext`。
- **加新源（如修炼体系）= 注册表加一行，全部入口自动获得**，不再漏、不再有世界模式 bug。

数据源注册表（初始项）：`worldview` / `powerSystem` / `worldRules` / `codex` / `characters` / `history` / `genre` / `state(按需召回)` / `foreshadow`。

### ② 统一采纳/写回层（写侧）

- 单一入口：`adopt(target, aiOutput)`，对着**规范字段 schema** 校验后落库。
- 规范 schema = 各表的字段定义（worldview/storyCore/character/codex…），唯一事实源。
- **未知字段报警**而非静默丢；写回前以 DB 为准定位记录（已在 saveWorldview 落地此原则，推广到全部）。
- 灵感反推 / AI 建议世界 / 参考提取 / 下游提取 全部走这里 → 字段错位**结构性不可能**。

### ③ 字段登记（贯通保证）

- 每张大功能表登记自己的字段（词条 fieldSchema 推广到所有表）。
- 因为「读」走 ①、「写」走 ②、字段定义走 ③ 同一份，**自上而下生成 与 灵感反推/下游反推 天生咬合**。

---

## 五、迁移顺序（增量、每步可验证）

1. **R-1 读侧**：建 `assembleContext` + 数据源注册表 → 旧 `build*Context` 暂留作薄适配 → 生成面板逐个切 → 删重复的单/多世界 if/else。
2. **R-2 写侧**：建规范 schema + `adopt` → 反推/灵感/参考/下游的写回逐个切 + 加未知字段告警。
3. **配合 Phase 35-b**：势力/道具/自然物产由词条收口，消除 C/D 的多处重复与 v2/v3 双轨。
4. 每步 `npx tsc --noEmit` + `npm run build` + 本地走查。

> 维护规约：**今后任何新功能，先在本表登记「字段 / 读什么 / 写哪里」，再写代码。** 这张表是唯一事实源，屎山从源头堵死。
