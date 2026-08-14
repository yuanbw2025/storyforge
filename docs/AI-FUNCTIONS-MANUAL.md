> ⚠️ **此手写版已废弃** ⚠️
>
> 综合 GPT 5.5 独立代码审查证实：本说明书至少有 **21 处 prompt key 与实际代码不一致**（如 `chapter.deai` vs 实际 `chapter.de-ai`、`foreshadow.suggest` vs `foreshadow.generate` 等），多处"读什么/写什么"也与实际不符。**不可作为事实源**。
>
> 替代方案见 `docs/MASTER-BLUEPRINT.md` §6：
> - 全集由代码扫描自动生成 → `AI-FUNCTIONS-MANUAL.generated.md`
> - 语义注解由人工补充 → `AI-FUNCTIONS-MANUAL.semantic.md`
> - CI 校验两者一致性
>
> 本文件保留作历史参考，待 MASTER-BLUEPRINT Phase 1 完成（自动生成器上线）后删除。

---

# StoryForge · AI 行为说明书（手写版 · 已废弃）

> 项目里所有 AI 功能的"全量目录"。按左侧标签栏分组，逐个面板列出：**该面板有哪些字段、有哪些 AI 动作、每个动作读什么、用哪个提示词、写到哪**。
> 创建：2026-06-04｜口径：当前线上代码（不含未实施的待开发 Phase）。
> 维护规约：今后改 AI 行为、加/删/调动作，**先改这份说明书再改代码**（或者反过来，但两边必须同步）。这份是事实源。

---

## 〇、阅读指南

### 字段约定

每张大功能表都有自己的字段。说明书引用字段时用 `表名.字段名` 格式：
- `worldviews.worldOrigin` = 世界观表的"世界来源"字段
- `storyCores.theme` = 故事核心表的"主题"字段
- `characters.personality` = 角色表的"性格"字段

### 动作"读 / 写"约定

- **读**：AI 执行时从哪些表/字段/输入取数据，拼成提示词上下文
  - `表.字段` 取该表的某个字段值
  - `表[条件]` 取该表筛选后的多条记录（如 `characters[本世界活跃]`）
  - `表.汇总` 取该表的摘要形态（如 `characters.阵容统计`）
  - `当前字段值` = 用户已经在面板上填写的该字段当前内容（生成时带上、AI 在此基础上扩写）
  - `用户输入提示` = 面板上"AI 提示"输入框里用户当下敲的提示
  - `当前章节正文` = 编辑器里此刻打开的章节内容
- **写**：AI 输出解析后落到哪些表/字段
  - `表.字段(覆盖)` 覆盖原值
  - `表.字段(追加)` 追加到原值后面
  - `表(新建)` 新增一条记录
  - `表(批量)` 一次写多条
  - `表.diff合并` 按 diff 合并（如状态表）

### 多世界标记

带 `🌍按世界` 的动作：在多世界模式下按当前世界/章节所属世界读取，单世界模式按项目级读取（行为一致）。

### 触发方式

- 🔘 **手动**：用户点按钮触发
- ⚡ **自动**：某事件后自动触发（如生成章节后自动提取状态）
- 🔄 **批量**：可多条/多章一起跑

---

## 一、著作信息

### 1.1 项目概况（侧栏：info）

**对应表**：`projects`

**字段**：
| 字段 | 含义 |
|---|---|
| `name` | 小说名称 |
| `genre` | 题材（一个或多个） |
| `description` | 项目描述 |
| `targetWordCount` | 目标字数 |
| `enableMultiWorld` | 是否开启多世界 |
| `writingStyleId` | 写作风格预设 ID |
| `creativeMode` | 创作模式（旧字段，迁到真实与幻想） |

**AI 动作**：（本面板**无 AI 动作**，纯元数据维护）

---

### 1.2 灵感反推（侧栏：inspiration）

**对应表**：`inspirationWorkspaces`（碎片与确认版本）；世界观、故事核心、角色和世界组只在版本确认后的独立作者采纳动作中写入

**字段**（本面板内的用户输入与中间态）：
| 字段 | 含义 |
|---|---|
| `碎片输入` | 用户写的灵感片段、人物想法、剧情碎片等自由文本 |
| `reverseResult`（中间态） | AI 生成的反推草稿（世界观+故事核心+角色） |
| `mwResult`（中间态） | 多世界反推草稿 |

**AI 动作**：

#### 动作①：灵感反推（单世界）
- **触发**：🔘 手动，点"反推"按钮
- **读**：
  - 作者本轮勾选的已保存碎片；碎片 ID 固定到主 Agent durable plan
  - `read_inspiration_workspace → CONTEXT_SOURCES + assembleContext()`，未勾选碎片不读取
- **提示词**：`inspiration.reverse`
- **首次确认写入**：结构化候选可编辑/拒绝/确认；确认只经 `adopt(inspirationWorkspaces)` 新增版本，不自动写 Canon
- **后续显式采纳**：
  - `worldviews.worldOrigin / powerHierarchy / continentLayout / climateByRegion / historyLine / races / factionLayout`
  - `storyCores.theme / centralConflict / plotPattern / mainPlot / logline`
  - `characters`（批量新建）
- **采纳方式**：版本确认后，用户在面板上分别点"写入世界观/写入故事核心/写入角色"或"一键全部采纳"

#### 动作②：灵感反推（多世界）
- **触发**：🔘 手动，多世界模式下点"反推"按钮
- **读**：与单世界相同，只读取作者勾选的已保存碎片，并按多世界模式构造结构化候选
- **提示词**：`inspiration.reverse.multiworld`
- **首次确认写入**：只新增 `inspirationWorkspaces.versions`；以下均为版本确认后的独立显式采纳：
  - `worldGroups`（批量新建多世界）
  - 每个世界对应的 `worldviews`（带 worldGroupId 盖章）
  - `characters`（带 homeWorldGroupId 或 isCrossWorld）

> HARNESS-34：旧面板级 `useAIStream`、直接模型调用和组件级上下文装配已删除；候选进入主 Agent durable Run，刷新后仍可编辑、拒绝或确认。当前工程证据不代表真实模型生成质量已经提升。

---

### 1.3 项目参考（侧栏：references）

**对应表**：`references` + `referenceAnalysisRuns` + `referenceChunkAnalysis` + `referenceAnalysisSources`

**字段**：
| 字段 | 含义 |
|---|---|
| `references.title / author` | 参考作品标题/作者 |
| `references.fileBlob` | 上传的原文 |
| `references.analysisStatus / progress` | 深度分析状态、进度 |
| `references.analysisDepth` | 分析深度（quick/standard/deep） |
| `references.analysisSummary` | 全书 AI 总结（JSON） |
| `references.mergedCharacters` | AI 聚合的角色清单（JSON） |
| `referenceChunkAnalysis.chunkIndex / 各维度分析` | 分块逐维度分析 |

**AI 动作**：

#### 动作①：深度分析参考作品（分块流水线）
- **触发**：🔘 手动，点"开始分析"
- **读**：
  - `references.fileBlob`（原文）+ 切分为块
  - 对每块 × 12 维度（含历史维度 5 项 + 创作维度 8 项）
- **提示词**：`reference.analyze`（按维度多次调用）
- **写**：`referenceChunkAnalysis`（每块每维度一条）

#### 动作②：全书 AI 总结
- **触发**：🔘 手动，分析完后点"生成总结"
- **读**：只经 `referenceDerivedBaseline` 读取当前 Work 中精确参考、精确分析版本、来源声明与该版本全部分块维度取样
- **提示词 / 解析**：`inspiration.reference-summary`；一次调用只接受与非空维度同序的 exact-key 纯 JSON
- **运行证据**：HARNESS-74 durable 候选冻结来源 baseline、版本/投影原字段、Context Manifest、Prompt 和模型输出；未知结果不自动重试，刷新恢复不重复调用
- **写**：确认前零写入；确认后经 CAS + `adopt(referenceAnalysisRuns.analysisSummary)` 写目标版本，仅当版本仍 active 时同步 `adopt(references.analysisSummary)` 兼容投影

#### 动作③：AI 角色卡聚合
- **触发**：🔘 手动，点"AI 整理角色卡"
- **读**：只经 `referenceDerivedBaseline` 读取当前 Work 中精确参考、精确分析版本、来源声明与该版本 `characterCraft` 分析
- **提示词 / 解析**：`inspiration.reference-characters`；一次调用只接受根键 `characters`，每项严格为唯一 `name/role/summary/analysis` 四字段
- **运行证据**：与总结使用独立 durable lane；候选、拒绝、重试、确认和不可判定运行显式放弃均绑定原 Run
- **写**：确认前零写入；确认后经 CAS + `adopt(referenceAnalysisRuns.mergedCharacters)` 写目标版本，仅 active 版本同步 `adopt(references.mergedCharacters)` 兼容投影

#### 动作④：采纳引用到创作规则
- **触发**：🔘 手动，"作为创作参考引用"
- **读**：无（直接登记 ID）
- **写**：`creativeRules.citedReferenceIds（追加 ID）`
- **后续效应**：章节正文生成时 `buildRefAnalysisContext` 会自动注入这些参考的分析摘要

---

### 1.3-bis 作品学习子系统（Phase 19，整合在「项目参考」内）

> ROADMAP 决议：作品学习已并入「项目参考 → 深度分析」tab；以下三个内部 AI 流水线是 §1.3 ① 「深度分析」按钮之下自动调度的子任务，**不单独有用户按钮**。

**对应表**：`masterWorks` / `masterChunkAnalysis` / `masterChapterBeats` / `masterStyleMetrics` / `masterInsights`

#### 内部子流水线①：Layer 1 五维分块分析（pipeline.ts）
- **触发**：⚡ 用户点 §1.3 ① "深度分析" 后自动逐块跑
- **读**：分块后的原文（每块约 5000-10000 字）
- **提示词**：`master.analyze.layer1`（按 narrative / character / world / theme / language 五维度）
- **解析**：`parseChunkAnalysis`
- **写**：`masterChunkAnalysis`（每块一条，含五维度）

#### 内部子流水线②：Layer 2 章节节奏点提取（beat-extractor.ts）
- **触发**：⚡ 用户点 §1.3 ① 时同步跑（或单独按钮"提取节奏点"）
- **读**：每章的原文
- **提示词**：`master.extract-beats`
- **解析**：JSON 数组 `[{ position, type, excerpt, note }]`
- **写**：`masterChapterBeats`（每章节奏点列表）

#### 内部子流水线③：题材洞察生成（insight-generator.ts）
- **触发**：⚡ 全部分析完后自动跑
- **读**：`masterChunkAnalysis` 全部维度合并 + `masterStyleMetrics`（风格量化，本地计算非 AI）
- **提示词**：`master.insight`
- **写**：`masterInsights`（按 genre 全局共享，可被多个项目复用）

---

## 二、设定库

### 2.1 世界总览 / 多世界（侧栏：world-overview，对应组件 WorldGroupOverview）

**对应表**：`worldGroups` + `worldGroupLinks`（多世界模式下）

**字段**：
| 字段 | 含义 |
|---|---|
| `worldGroups.name / icon / type / description / powerRestriction / entryCondition / order / plannedChapterCount` | 世界 |
| `worldGroupLinks.fromGroupId / toGroupId / linkType / label / description` | 世界间关系（诸天/穿越/飞升/分支） |

**AI 动作**：

#### 动作①：AI 建议多个世界（WorldGroupOverview）
- **触发**：🔘 手动，多世界模式下"AI 建议"按钮
- **读**：
  - `manualText`：作者当次输入的世界方向
  - `worldGroups`：当前 World 已建世界目录
  - `storyCore`：当前 Work 故事核心
- **提示词**：`world-group.suggest`
- **解析**：`parseWorldSuggestOutputStrictV1`；只接受 2～4 项 exact-key JSON，每项仅含 `name / type / description / entryCondition / powerRestriction / plannedChapterCount`；拒绝 Markdown、`primary`、额外/缺失字段、批内或与已有世界同名及越界值
- **运行证据**：`world-origin.world-suggest` durable 候选冻结 World/Work、项目提示、完整世界目录/关系/故事核心、Context Manifest、Prompt 和一次模型调用；未知结果暂停且不自动重试
- **写**：确认前零正式写入；作者勾选任意非空子集后，冻结选择与顺序，只在上游、Context 和 Prompt 仍 fresh 时经 `FIELD_REGISTRY + AdoptionSchema + adopt(worldGroups)` 原子新增 `name / type / description / icon / order / entryCondition / powerRestriction / plannedChapterCount`。`worldGroupLinks` 不由该 AI 动作写入，世界关系继续人工管理

#### 动作②：AI 扩写单个世界设定（WorldGroupDetail）
- **触发**：🔘 手动，世界详情页“AI 扩写世界观”；名称、类型或描述有未保存改动时拒绝生成
- **读**：
  - `manualText`：已保存目标世界组的名称、类型与描述
  - `worldGroups`：当前 World 的世界目录
  - `storyCore`：当前 Work 的故事核心
  - `worldview`：目标世界组的正式世界观 baseline
- **提示词**：`world-group.expand`
- **解析**：`parseWorldExpandOutputStrictV1`；只接受七个 exact-key、2～30000 字符的非空 JSON 文本字段，拒绝 Markdown、缺失项、额外项和静默默认值
- **运行证据**：`world-origin.worldview-expand` durable 候选绑定 World/Work/世界组、完整正式 baseline、非目标字段、Context Manifest、Prompt 与一次模型调用；未知结果窗口暂停且不自动重试
- **写**：确认前零正式写入；作者确认且目标组、Context、Prompt 和 baseline 仍一致后，在事务中经 `FIELD_REGISTRY + adopt(worldviews)` 原子覆盖 `worldOrigin / powerHierarchy / continentLayout / climateByRegion / historyLine / races / factionLayout`，其它字段保持不变 🌍按世界

---

### 2.2 真实与幻想（侧栏：world-rules）

**对应表**：`worldRulesProfiles`（项目级单例，⚠️ 待 Phase 40 多世界化）

**字段**：
| 字段 | 含义 |
|---|---|
| `entries` | 各节点的设定（节点 id → 历史锚点+架空改造+冲突优先级），JSON |
| `customNodes` | 用户自定义节点（树状） |
| `globalNote` | 对 AI 的全局约束补充 |

**AI 动作**：（本面板**无 AI 直接生成动作**，属"喂养式"上游设定，被以下下游动作读取）

**作为上游被读取**：
- 章节正文生成、卷大纲、章大纲、细纲、场景考证、角色驱动剧情 等所有"按设定生成"的动作都会读取 `worldRulesProfiles` → `buildWorldRulesContext`

---

### 2.3 世界起源（侧栏：worldview-origin）

**对应表**：`worldviews`（部分字段）🌍按世界

**字段**：
| 字段 | 含义 |
|---|---|
| `worldOrigin` | 世界来源（创世神话/科技起源） |
| `powerHierarchy` | 力量体系 |
| `divineDesign` | 神明设定（结构体：hasDivinity/divineRank/divineNames/divineRules） |

**AI 动作（HARNESS-32）**：

三个字段共用现有 `world-foundation-agent`，由 `world-origin.worldview-field` Skill 冻结目标字段、输入状态、上下文预算和写权限；每次只返回一个严格候选：

```json
{"field":"worldOrigin","value":"候选正文"}
```

`powerHierarchy` 和 `divineDesign` 只需替换 `field`。神明字段的 `value` 必须是严格的 `hasDivinity/divineRank/divineNames/divineRules` 对象，不再先生成长文本再额外调用模型拆分。Skill 通过 `CONTEXT_SOURCES + assembleContext()` 读取世界观、规则/事实、故事核心、力量、词条、角色、故事线、卷纲和参考资料；世界基座为空、部分填写和完整填写分别走创建、反推补全和受约束变更。候选刷新可恢复、可编辑、可拒绝；确认前 `worldviews` 零写入，确认后只经 `adopt(target=worldviews)`，完整世界观快照/CAS 和终态回读阻止旧候选覆盖新修改。人工字段编辑、力量词条、神明词条和 Prompt 配置继续保留。

---

### 2.4 自然环境（侧栏：worldview-natural）

**对应表**：`worldviews`（部分字段）🌍按世界

**字段**：
| 字段 | 含义 |
|---|---|
| `worldStructure` | 世界结构 |
| `worldDimensions` | 疆域尺寸 |
| `continentLayout` | 大陆/地貌分布 |
| `mountainsRivers` | 山川水系 |
| `climateByRegion` | 气候环境 |
| `naturalResourceOverview` | 自然物产总体概述 |

**AI 动作**：

#### 动作①~⑥：各字段 AI 生成（统一 Skill）
- **触发**：🔘 手动，每个字段旁有独立按钮。
- **目标字段**：`worldStructure`、`worldDimensions`、`continentLayout`、`mountainsRivers`、`climateByRegion`、`naturalResourceOverview`。
- **合同**：`{"field":"目标字段","value":"候选正文"}`；上下文、预算、反推和采纳规则与 2.3 相同。

> 🟡 已知问题：当前自然物产是自由文本，Phase 35-b 后会迁到 codex 词条；届时本动作改为"写入 codex 矿物/草药/异兽词条"。

---

### 2.5 人文环境（侧栏：worldview-humanity）

**对应表**：`worldviews`（部分字段）🌍按世界

**字段**：
| 字段 | 含义 |
|---|---|
| `historyLine` | 世界历史线 |
| `worldEvents` | 世界大事记 |
| `races` | 种族民族 |
| `factionLayout` | 势力分布 |
| `regionDimensions` | 城池重镇与区域格局 |
| `politicsOverview` | 政治制度 |
| `economyOverview` | 经济制度 |
| `cultureOverview` | 文化制度 |
| `internalConflicts` | 矛盾冲突 |
| `itemDesign` | 道具设计 |

**AI 动作**：

#### 动作①~⑨：各字段 AI 生成（统一 Skill）
- **触发**：🔘 手动，每字段独立按钮；正式历史年表仍是单独入口。
- **目标字段**：`races`、`factionLayout`、`regionDimensions`、`politicsOverview`、`economyOverview`、`cultureOverview`、`internalConflicts`、`itemDesign`，以及保留人工维护的历史字段不进入本 Skill。
- **合同**：`{"field":"目标字段","value":"候选正文"}`；上下文、预算、反推和采纳规则与 2.3 相同。

> 🟡 已知问题：势力/道具迁到 codex 后，本面板动作的"写"目标改为 codex 词条；属 Phase 35-b。

---

### 2.6 历史年表（侧栏：history）

**对应表**：`histories`（概述） + `historicalTimelineEvents`（时间线事件） + `historicalKeywords`（关键词） 🌍按世界

**字段**：
| 字段 | 含义 |
|---|---|
| `histories.overview` | 历史概述 |
| `historicalTimelineEvents.date / title / description / isHistorical / type` | 时间线事件 |
| `historicalKeywords.term / category / description / pinyin` | 历史关键词 |

**AI 动作**：

#### 动作①：考证一个时间线事件
- **触发**：🔘 手动，事件卡上"AI 考证"按钮
- **读**：
  - 该事件的 `date / title / description`
  - `worldviews.worldOrigin / powerHierarchy / historyLine`（背景）
  - `worldRulesProfiles`（真实/架空约束）
- **提示词**：内置严谨历史考证（buildHistoricalEventVerifyPrompt 在 HistoryPanel 内）
- **写**：该事件的 `description（覆盖或追加考证内容）` 🌍按世界

#### 动作②：考证一个关键词
- **触发**：🔘 手动
- **读**：
  - 该关键词的 `term / category / description`
  - 同事件考证的背景
- **提示词**：同上（关键词版）
- **写**：该关键词的 `description（覆盖或追加）` 🌍按世界

---

### 2.7 世界地图（侧栏：world-map，对应组件 WorldMapPanel）

**对应表**：`worldNodes`（节点） + Voronoi 配置存 `worldNodes.mapConfigJSON` 🌍按世界

**字段**：
| 字段 | 含义 |
|---|---|
| `worldNodes.name / type / description / parentId / mapConfigJSON` | 世界节点 / 子节点 / 地图配置 |

**AI 动作**：

#### 动作①：AI 生成 Voronoi 地图配置
- **触发**：🔘 手动
- **读**：
  - 当前世界 `worldviews` 的结构、尺寸、地貌、山川、气候、资源、势力和城池等已填字段
  - 当前世界登记的 `codex` 与 `locations` 上下文
- **提示词**：`world-map.voronoi`
- **候选契约**：宏观参数 + 命名实体 + 规模 + 八向方位/距离；explicit 必须带用户消息
  逐字证据，AI 不输出坐标或数据库 ID
- **本地决议**：闭集/枚举/证据校验 → 确定性空间求解 → Voronoi 命名实体对齐
- **运行证据**：`world-origin.map-config` durable 候选绑定目标节点、Context Manifest、Prompt、原配置 baseline 与终验 receipt；模型结果不可判定时不自动重试
- **写**：作者确认后才以 exact-field CAS 经 `adopt(worldNodes.mapConfigJSON)` 覆盖；手动比例尺继续增量写回 🌍按世界

---

### 2.7-bis 概念地图（隐藏路由 `geography`，对应组件 GeographyPanel）

> ⚠️ 此面板路由 `geography` **不在侧栏 leaf 中**，是历史/隐藏入口（从重要地点或其它跳转可达）。当前线上代码仍存在并可被路由命中。

**字段**：`geographies` 表（旧）+ 内存里的 `svgContent`（不入库）

**AI 动作**：

#### 动作①：AI 生成概念地图 SVG
- **触发**：🔘 手动
- **读**：
  - 自由文本世界观概述 + 重要地点列表
- **提示词**：`geography.concept-map`
- **写**：**无**（仅展示 SVG，不入库）
- **⚠️ 安全**：AI 返回的 SVG 经 `sanitizeSvg` 清洗后才渲染（防 XSS，本轮已修）

---

### 2.8 故事设计（侧栏：story-design / story-core）

**对应表**：`storyCores`

**字段**：
| 字段 | 含义 |
|---|---|
| `logline` | 一句话故事 |
| `concept` | 故事概念 |
| `theme` | 主题 |
| `centralConflict` | 核心冲突 |
| `plotPattern` | 情节模式 |
| `mainPlot`（旧 `storyLines`） | 故事主线 |
| `subPlots` | 故事复线 |

**AI 动作**：

#### 动作①~⑦：每个字段 AI 生成
- **触发**：🔘 手动，每个字段独立按钮
- **执行**：主 Agent → `world-origin.story-core`，每轮固定一个目标字段与 expand/rewrite/polish 模式
- **读**：Skill 声明的 `projectStatus / canonAssertions / worldview / storyCore / powerSystem / codex / characters / storyArcs / existingVolumeOutlines`，统一经 `assembleContext()`；按预算压缩并保留全文救援证据
- **候选**：严格 `{ "field": "目标字段", "value": "候选内容" }`；刷新可恢复，可编辑或拒绝
- **提示词配置**：`story.generate` 面板参数和自定义要求会转入受约束 Agent 请求，不改变 Skill 写权限
- **写**：作者确认后只经 `adopt(target=storyCores)` 覆盖对应字段；确认前零写入，完整故事核心 snapshot/CAS 防止旧候选覆盖新编辑

---

### 2.9 设定词条（侧栏：codex）

**对应表**：`codexCategories` + `codexEntries` 🌍按世界（内置分类全局）

**字段**：
| 表 | 字段 | 含义 |
|---|---|---|
| codexCategories | `domain / parentId / name / icon / builtInKey / fieldSchema / hidden` | 分类树 + 字段 schema |
| codexEntries | `categoryId / name / icon / summary / description / fields / refs` | 词条 + 字段值 + 关联 |

**内置 7 类**：
- 🟫 自然环境：⛏️ 矿物灵材 / 🌿 灵植草药 / 🐅 灵兽异兽
- 🟧 人文环境：🧬 种族民族 / ⚔️ 势力 / 🏰 城池重镇 / 🗡️ 人工器物

**AI 动作**：（当前**无直接 AI 生成动作**，是上游设定库）

**作为上游被读取**：
- 章节正文、大纲、细纲、场景、角色生成 等所有动作通过 `buildCodexContext` 注入；按当前世界隔离（全局项+本世界专属）

**作为下游被写入**：
- 文档解析 → AI 按当前分类目录生成带逐字证据的词条候选 → 作者逐条确认 → `adopt()` 写入；
  AI 不输出数据库 ID，候选不会自动入库

---

### 2.10 道具系统（侧栏：items）

**对应表**：`itemSystems`（旧）

**字段**：`overview` + `items`（JSON，每条含 name/type/rank/description/abilities/origin/owner/significance）

**AI 动作**：（当前面板**无 AI 直接生成动作**，属手动 CRUD）

> ⚠️ 设计中：Phase 35-b 后本表整体并入 `codex.artifact` 词条，本面板下线

---

## 三、角色设计

### 3.1 主要角色 / 次要角色 / NPC / 路人（侧栏：characters / characters-minor / characters-npc / characters-extra）

**对应表**：`characters`（按 `role` 字段过滤；4 个面板是同一表的不同视图，UI 详细度不同）

> 🔔 **AI 动作归属**：仅「主要角色」面板（CharacterPanel）含 AI 生成与解析按钮；「次要 / NPC / 路人」三个面板只是简化版手动 CRUD 视图，**无独立 AI 动作**。
> AI 生成时会按当前世界过滤角色（多世界），新建角色盖章 `homeWorldGroupId`。

**字段**：
| 字段 | 含义 |
|---|---|
| `name` | 姓名 |
| `role` | 定位（protagonist/antagonist/supporting/minor/npc/extra） |
| `alignment` | 阵营倾向 |
| `shortDescription` | 一句话简介 |
| `appearance` | 外貌 |
| `personality` | 性格 |
| `background` | 背景故事 |
| `motivation` | 动机 |
| `abilities` | 能力 |
| `relationships` | 关系描述 |
| `arc` | 角色弧光/成长线 |
| `firstAppearChapterId / exitChapterId / activeChapterRange` | 出场范围 |
| `homeWorldGroupId / isCrossWorld` | 多世界归属 |

**AI 动作**：

#### 动作①：批量 AI 生成角色（按当前 role 视图）
- **触发**：🔘 手动，"AI 生成"按钮（CharacterPanel）
- **读**：
  - `worldviews.worldOrigin / powerHierarchy / races / factionLayout / 等全字段` 🌍按世界
  - `codex`（种族 / 势力词条） 🌍按世界
  - `characters.阵容统计`（已有角色名单、缺口）
  - `用户输入提示`
- **提示词**：`character.generate`
- **解析**：分步骤 AI 入口已收口到 `character.create` Skill 的严格 JSON 候选解析；未知字段、非法枚举、缺少姓名/简介和重复角色在确认前阻断。
- **写**：`characters（新建）` 🌍按世界（盖 homeWorldGroupId）

#### 动作②：单个角色单字段 AI 生成（CharacterFieldGenerator）
- **触发**：🔘 手动，角色卡每个字段旁的"AI"按钮
- **读**：
  - 该角色其它已写字段
  - `worldviews`
  - `当前字段值`
  - `用户输入提示`
- **提示词**：`character.dimension`
- **写**：`characters.对应字段（覆盖）`

#### 动作③：角色解析（粘贴文本结构化）
- **触发**：🔘 手动，"粘贴文本 → AI 解析为角色"
- **读**：`用户粘贴的角色描述自由文本`
- **提示词**：由 `character.create` Skill 绑定 `character-copilot-v1`，继续复用 `character.generate` 的正式模板和 Prompt 配置入口。
- **调用方式**：直接走 `chat()` 非流式（不经 useAIStream），等待 JSON 输出
- **解析**：由 `character.create` Skill 的结构化候选合同负责；确认后只经 `adopt(characters)` 写回，旧自由文本解析旁路已下线。
- **写**：`characters（新建）` 含所有字段

---

### 3.2 关系网（侧栏：relations）

**对应表**：`characterRelations`

**字段**：
| 字段 | 含义 |
|---|---|
| `fromCharacterId / toCharacterId` | 角色对 |
| `relationType` | 关系类型枚举 |
| `label` | 关系标签 |
| `description` | 详细描述 |
| `isBidirectional` | 是否双向 |

**AI 动作**：

#### 动作①：AI 建议关系
- **触发**：🔘 手动，"AI 建议关系"
- **读**：
  - `characters[全部].name / role / shortDescription / background`
  - `characterRelations[已有]`（避免重复）
- **提示词**：`relation.extract`
- **解析**：AI 输出 → `parseRelationOutput` + `matchRelations`（按名字匹配回角色 id）
- **写**：`characterRelations（批量新建，用户审核后采纳）`

---

### 3.3 势力（侧栏：factions，旧实体）

**对应表**：`factions`

**字段**：name / type / description / influence / leader / 等

**AI 动作**：（当前**无 AI 动作**，手动 CRUD）

> ⚠️ Phase 35-b 后整体并入 `codex.faction`，本面板下线

---

## 四、创作区

### 4.1 创作规则（侧栏：rules）

**对应表**：`creativeRules`

**字段**：
| 字段 | 含义 |
|---|---|
| `writingStyle` | 写作风格 |
| `narrativePOV` | 叙事视角枚举 |
| `atmosphere`（旧 `toneAndMood`） | 基调氛围 |
| `prohibitions` | 禁止事项 JSON 数组 |
| `consistencyRules` | 一致性规则 JSON 数组 |
| `specialRequirements` | 特殊要求 |
| `referenceWorks` | 参考作品（旧） |
| `citedReferenceIds` | 引用参考作品 ID 数组 |
| `citedInsightIds` | 引用大师洞察 ID 数组 |

**AI 动作**：

#### 动作①：写作风格 / 基调氛围 / 特殊要求 AI 建议（HARNESS-39）
- **触发**：🔘 手动，三个字段旁的“AI 建议”按钮
- **Agent / Skill**：`world-foundation-agent / world-origin.creative-rules`
- **读**：`projectStatus / worldview / storyCore / creativeRules`，只经
  `CONTEXT_SOURCES + assembleContext()`；按实际输入选择空输入创建、部分输入参考创建或完整输入受约束建议
- **提示词**：继续复用 `rules.generate` 的激活模板，领域 Copilot 追加单字段和严格 JSON 合同
- **候选**：只允许 `{field,value}`，`field` 仅可为
  `writingStyle / atmosphere / specialRequirements`；刷新可恢复、可编辑、可拒绝
- **写**：确认前 `creativeRules` 零写入；确认后只经
  `adopt(target=creativeRules, mode=replace)` 写入本轮目标字段
- **校验**：完整创作规则 snapshot/CAS、字段错投/未知字段/未变化候选拒绝、正式后状态回读和 terminal receipt
- **人工编辑**：叙事视角、禁忌、一致性规则、参考作品和引用能力保持人工维护；基调统一保存到规范字段
  `atmosphere`，旧 `toneAndMood` 仅作为读取兼容

---

### 4.2 大纲（侧栏：outline）

**对应表**：`outlineNodes`（树状：volume / storyBlock / chapter） 🌍按世界（卷可指定所属世界）

**字段**：
| 字段 | 含义 |
|---|---|
| `parentId / type / title / summary / order / worldGroupId` | 节点 |

**AI 动作**：

#### 动作①：AI 生成卷大纲
- **触发**：🔘 手动
- **读**：
  - `projects.name / genre / targetWordCount`
  - `worldviews`（全字段，单世界）
  - `storyCores.theme / centralConflict / mainPlot / subPlots`
  - `characters.阵容简述`
  - `creativeRules` → `buildWorldRulesContext`
  - `codex` 🌍按世界
  - `用户输入提示`
- **提示词**：`outline.volume`
- **解析**：`parseVolumeOutlineSmart`（JSON 优先 → AI 重构）
- **写**：`outlineNodes[type=volume]（批量新建）`

#### 动作②：AI 生成章大纲（针对选中的卷）
- **触发**：🔘 手动
- **读**：
  - `outlineNodes[当前卷].title / summary`
  - `outlineNodes[上一卷的章节摘要]`
  - 多世界：按本卷 `worldGroupId` → `buildCurrentWorldContext`
  - 单世界：worldCtx 同上
  - `characters[本世界活跃]`
  - `creativeRules / worldRulesProfiles`
  - `codex` 🌍按世界
  - `用户输入提示`
- **提示词**：`outline.chapter`
- **解析**：`parseChapterOutlineSmart`
- **写**：`outlineNodes[type=chapter, parentId=本卷]（批量新建）`

#### 动作③：批量生成所有章大纲 🔄
- **触发**：🔘 手动，"批量生成"
- **读**：同动作②，但**逐卷按各自世界**（`worldContextResolver` 解析每卷所属世界）
- **提示词**：`outline.chapter`
- **写**：所有卷下的 `outlineNodes[type=chapter]（批量新建）`

---

### 4.3 角色驱动（侧栏：character-driven-plot）

**对应表**：`characterDrivenPlans`（方案、版本和生成结果）→ `outlineNodes`（作者二次采纳的卷/章）

**字段**：用户在面板上选择/输入 角色 + 弧线意图

**AI 动作**：

#### 动作①：基于角色弧线生成剧情
- **触发**：🔘 手动
- **读**：
  - 固定方案 ID 经 `read_character_driven_plan → characterDrivenPlan` 读取角色起点、终点和作者要求；重新生成时不注入旧生成结果
  - 世界观、故事核心、叙事蓝图、角色、规则、故事线、已有卷纲和已写进度经 `CONTEXT_SOURCES + assembleContext()` 读取
  - 上下文预算、压缩和全文回退由 `outline.character-driven` Skill 冻结
- **提示词**：大纲 Agent 的 `outline.character-driven` Skill；保留 `plot.character-driven` Prompt 配置
- **解析/校验**：`parseCharacterDrivenCandidateDraftV1` 严格 JSON；校验额外字段、卷章数量、重复标题、未知角色、角色弧覆盖和信息释放约束
- **第一次确认写入**：只经 `adopt(recordId, target=characterDrivenPlans)` 更新 `generatedVolumes/status`；候选生成前后对方案做 snapshot/CAS
- **第二次确认写入**：作者勾选卷后，`adoptCharacterDrivenVolumes()` 逐项经 `adopt(target=outlineNodes)` 新增卷/章；不改故事核心或正文
- **运行证据**：固定方案 ID、Context Manifest、候选、编辑/拒绝/确认、重试和刷新恢复进入主 Agent durable Run；旧 `useAIStream → parsePlotOutput` 入口已删除

---

### 4.4 故事线（侧栏：story-arc）

**对应表**：`storyArcs`

**字段**：
| 字段 | 含义 |
|---|---|
| `name` | 故事线名 |
| `type` | main / sub |
| `stages` | 阶段 JSON（起承转合等） |
| `description` | 整体描述 |

**AI 动作**：

#### 动作①：AI 规划故事线
- **触发**：🔘 手动
- **Agent / Skill**：主 Agent → `outline` Agent → `outline.story-arcs`
- **读**：Skill 声明的 `projectStatus`、`canonAssertions`、`worldview`、`storyCore`、
  `characterDrivenPlan`、`powerSystem`、`cultivationProgress`、`codex`、`characters`、
  `creativeRules`、`worldRules`、`historical`、`locations`、`storyArcs`、`storylineProgress`、
  `existingVolumeOutlines`、`writtenChapterProgress`，统一由 `assembleContext()` 装配并记录实际输入证据
- **输入处理**：区分 empty / partial / complete；按 Skill 压缩策略控制预算，超出物理窗口时拒绝静默裁剪
- **提示词版本**：`story-arc-copilot-v1`
- **解析 / 硬校验**：`parseStoryArcCandidateDraft()`；拒绝未知字段、非法 main/sub、重复名称、阶段不足和非法卷范围
- **过程**：模型只生成可编辑 durable 候选；作者可拒绝或修改，修改后重新 gate；刷新恢复不重复模型调用
- **写**：作者确认后唯一经 `adopt({ target: 'storyArcs' })` 新建；snapshot/CAS 和终态 verifier 校验正式结果
- **保留功能**：人工新增、编辑和删除故事线继续使用原面板能力

#### 动作②：映射已写章节的故事线进度与交汇（HARNESS-40）
- **触发**：🔘 在动态进度面板选择已写章节后手动映射
- **Agent / Skill**：主 Agent → `outline` Agent → `outline.storyline-progress`
- **读**：`projectStatus`、`storyArcs`、`storylineProgress`、`chapterContent`，只经
  `CONTEXT_SOURCES + assembleContext()` 装配；目标章节 ID 固定在任务中，正文全文不进入 durable snapshot
- **输出**：严格 `{progress,crossings,newArcs}` 聚合候选；`progress` 只能引用登记故事线/阶段，所有引用必须有正文逐字证据；`newArcs` 只是疑似新线候选
- **过程治理**：章节正文 hash、故事线边界和动态投影版本组成 snapshot/CAS；候选可刷新恢复、编辑、拒绝；章节或故事线变化后旧候选 stale
- **写**：作者确认后一次性经 `adopt()` 原子写入 `storylineProgress`、`storylineCrossings` 和作者确认的新 `storyArcs`，不自动为新线创建进度
- **校验**：闭集 ID、阶段归属、状态枚举、交汇去重、正文逐字引文、项目作用域、正式后状态回读和 terminal receipt
- **保留功能**：章节选择、动态进度/交汇展示、人工故事线维护继续保留；旧面板 `useAIStream` 和直接采纳旁路已删除

---

### 4.5 章节编辑器（侧栏：chapters-list → 进入章节编辑）

**对应表**：`chapters` + 关联 `detailedOutlines`

**字段（chapters）**：
| 字段 | 含义 |
|---|---|
| `outlineNodeId` | 关联的大纲节点 |
| `title` | 标题 |
| `content` | 正文（HTML/JSON） |
| `summary` | 章节摘要 |
| `wordCount / status / order / notes` | 元数据 |

**AI 动作**：（这是最复杂的面板，AI 动作最多）

#### 动作①：生成章节正文 ⭐
- **触发**：🔘 手动（"AI 生成正文"）
- **读**（最丰富的一个动作）：
  - `outlineNodes[当前章].title / summary`
  - `chapters[上一章].正文末尾`
  - **多世界**：按章节父链解析 `worldGroupId` → `buildCurrentWorldContext`（含本世界 `worldviews` 全字段 + `storyCores` + `powerSystems` + `codex` 本世界）
  - **单世界**：`buildWorldContext` 同上字段集
  - `characters[本世界活跃 + 按当前章节过滤]`（`filterActiveCharacters`）
  - `stateCards[按需召回]`（buildSelectiveStateContext，按当前章节内容相关性）
  - `foreshadows[开放]`（buildForeshadowContext）
  - `creativeRules`（写作风格/视角/基调/禁忌/一致性）
  - `importantLocations`（buildLocationContext）
  - `worldRulesProfiles`
  - `creativeRules.citedReferenceIds → referenceChunkAnalysis 摘要`（buildRefAnalysisContext）
  - `creativeRules.citedInsightIds → masterInsights`（buildMasterInsightContext）
  - `projects.genre → buildGenreConstraintContext`（题材约束）
  - `projects.writingStyleId → buildStylePromptInjection`（风格预设）
  - `getContextMemo`（上下文快照）
  - 三层记忆（`buildMemory`）：Working/Episodic/Semantic 按 write 模式预算分配
  - `用户输入提示`
- **提示词**：`chapter.content`
- **写**：`chapters.content`（覆盖；用户预览后采纳）

#### 动作②：续写章节正文
- **触发**：🔘 手动
- **读**：同①，但额外读 `当前正文末尾 N 字`
- **提示词**：`chapter.continue`
- **写**：`chapters.content（追加到现有正文末尾）`

#### 动作③：润色选区
- **触发**：🔘 手动（FloatingToolbar 选区或全文）
- **读**：选中文本 + `用户指令`
- **提示词**：`chapter.polish`
- **写**：替换选区（用户预览后采纳）

#### 动作④：扩写选区
- **触发**：🔘 手动
- **读**：选中文本 + `用户提示`
- **提示词**：`chapter.expand`
- **写**：替换选区

#### 动作⑤：去 AI 味
- **触发**：🔘 手动
- **读**：选中文本
- **提示词**：`chapter.deai`
- **写**：替换选区

#### 动作⑥：状态变更提取（手动）
- **触发**：🔘 手动，"提取状态"按钮
- **读**：
  - `chapters[当前].content`
  - `stateCards[当前状态全量]`（让 AI 对比看变化）
- **提示词**：`state.extract`
- **解析**：`parseStateDiffs`
- **写**：`stateCards`（差异化合并；用户审核 → `applyDiffs` 按实体聚合落库）

#### 动作⑦：状态变更提取（自动）⚡
- **触发**：⚡ 自动，正文采纳后
- **读 / 写**：同⑥
- **行为**：自动出 diff，用户在弹窗审核后采纳

#### 动作⑧：章节摘要生成（自动）⚡
- **触发**：⚡ 自动，正文采纳后
- **读**：`chapters[当前].content`
- **提示词**：`summary`
- **写**：`chapters.summary（覆盖）`

#### 动作⑨：情感节拍规划
- **触发**：🔘 手动（EmotionBeatCard）
- **读**：只经 Context Gateway 的 `chapterOutline / detailedOutline / previousChapterEnding / worldview / storyCore / characters / creativeRules`
- **Skill**：`prose.emotion-beats`，提示词执行版本 `prose-emotion-beats-v1`
- **解析**：严格 exact-key JSON；整体弧线 + 3–6 个唯一节拍，每拍五字段均非空
- **写**：模型输出先持久化为 durable 候选，确认前不写业务表；作者确认后才经 `adopt(emotionBeatCards)` 写入当前章节卡并签发 terminal receipt

#### 动作⑩：质量审校（ReviewPanel）
- **触发**：🔘 手动
- **读**：
  - `chapters[当前].content / title`
  - `worldCtx`（含词条等）
  - `charCtx`
  - `chapters[上一章].summary`
  - `foreshadows[开放]`
  - `stateCards`（前 10 条摘要）
- **提示词**：`review`
- **解析**：`parseReviewResult`（五维：logic/character/worldview/foreshadow/pacing）
- **写**：无（仅展示建议）

#### 动作⑪：追读力评估（ReviewPanel）
- **触发**：🔘 手动
- **读**：`chapters[当前].content`
- **提示词**：`readability`
- **解析**：`parseReadabilityResult`
- **写**：无（仅展示）

#### 动作⑫：反 AI 味检测（ReviewPanel）
- **触发**：🔘 手动
- **读**：`chapters[当前].content`
- **提示词**：`anti-ai`
- **解析**：`parseAntiAIResult`
- **写**：无（仅展示）

#### 动作⑬：人工修正后的后续章纲摘要重建（HARNESS-77/78）
- **触发**：🔘 作者从当前章节完成影响项人工修正并取得 fresh H57 plan，再对目标的直接上游正文记录“已确认”复核后，选择一个仍受影响的后续章纲，点击“AI 重建章纲候选”
- **Agent / Skill**：`outline / outline.impact-summary-regenerate`；Run 是 H57 的直接 child，绑定父 Run/receipt/output、当前 plan/graph/item 与 H50 直接依赖 review receipt
- **读**：只经 `chapterContent / chapterOutline / adjacentChapterOutlines / canonAssertions / storyCore / characters / storyArcs / writtenChapterProgress / consistencyReport` 与 `assembleContext()`；正文与目标章纲必须 full delivery，正式目标 baseline 只由治理层用于 CAS
- **解析**：严格 exact-key JSON `{summary,reason,evidenceRefs}`；证据引用只能来自实际进入模型的 Context 分段。一次模型调用，未知结果不自动重试
- **依赖门**：目标 `dependencyNodeIds` 必须逐项映射到 current plan；下游正文依赖缺少 fresh `acknowledged` review 或仍为“需人工处理”时，模型调用和新 H77 Run 均为零。proof 随候选冻结，恢复、采纳和终验都会重新核对
- **候选 / 恢复**：候选持久化且 `portable:false`，确认前正式摘要零写；刷新恢复同一候选不重复模型调用，拒绝后可显式创建新 child
- **写**：作者确认且 H57、来源、非目标上游 Context、Prompt 与目标 baseline 均 fresh 时，事务内二次 CAS 后只经 `adopt(outlineNodes, merge-diffs)` 写 `summary`；正文、事实、title、锁定节点和其它字段不改
- **终验**：回读正式摘要并签发绑定 H57 lineage 的 terminal receipt；终验后目标或上游变化会撤销旧完成证明

---

### 4.6 细纲（ScenePanel / DetailedOutlinePanel，从大纲节点进入）

**对应表**：`detailedOutlines`

**字段**：
| 字段 | 含义 |
|---|---|
| `outlineNodeId` | 关联章节节点 |
| `scenes` | 场景数组（sceneId / title / summary / characterIds / location / conflict / pace / estimatedWords / notes） |
| `openingHook` | 开篇钩子 |
| `endingCliffhanger` | 结尾悬念 |
| `sceneLocation` | 场景地点 |
| `appearingCharacterIds` | 出场角色 |
| `foreshadowIds` | 关联伏笔 |
| `emotionArc` | 情感弧线 |

**AI 动作**：

#### 动作①：基础细纲生成
- **触发**：🔘 手动
- **读**：
  - `outlineNodes[当前章].title / summary`
  - 多世界：按章节解析世界 → `buildNodeWritingContext`（含本世界 wv/sc/ps/codex）
  - `characters[本世界 protagonist+supporting]`
- **提示词**：`detail.scene`
- **写**：`detailedOutlines.scenes（覆盖）`

#### 动作②：增强细纲（含前后章衔接 + 角色 + 伏笔）
- **触发**：🔘 手动
- **读**：
  - `outlineNodes[当前章].title / summary`
  - `outlineNodes[前一章 / 后一章].summary`
  - `buildNodeWritingContext`
  - `characters[ID:name 列表]`
  - `foreshadows[开放]`
- **提示词**：`detail.enhanced`
- **解析**：`parseEnhancedDetailResult`
- **写**：`detailedOutlines.scenes / openingHook / endingCliffhanger / appearingCharacterIds / foreshadowIds / emotionArc（覆盖）`

#### 动作③：批量细纲生成 🔄
- **触发**：🔘 手动
- **读**：同②，**逐章按各自世界**（`worldContextResolver`）
- **写**：所有未生成细纲的章节

---

### 4.7 伏笔（侧栏：foreshadow）

**对应表**：`foreshadows`

**字段**：
| 字段 | 含义 |
|---|---|
| `name` | 伏笔名 |
| `type` | 类型（chekhov/mystery/etc） |
| `status` | 状态（planned/planted/echoed/resolved） |
| `description` | 描述 |
| `plantChapterId / echoChapterIds / resolveChapterId` | 章节关联 |
| `importance / urgency` | 重要度 / 紧急度 |
| `expectedResolveChapterId` | 预期回收章节 |
| `notes` | 备注 |

**AI 动作**：

#### 动作①：AI 建议新伏笔
- **触发**：🔘 手动，"AI 建议"
- **读**：
  - `projects.name / genre`
  - `worldviews`（全字段）🌍按世界
  - `characters` 阵容
  - `foreshadows[已有简述]`（避免重复）
  - `用户输入提示`
- **提示词**：`foreshadow.suggest`
- **写**：流式展示，用户审核后通过 buildForeshadowStructurePrompt 二次结构化解析

#### 动作②：AI 建议结果二次结构化（自动）⚡
- **触发**：⚡ 自动，用户点"采纳建议"时
- **读**：动作①的文本结果
- **提示词**：`foreshadow.structure`
- **解析**：`parseForeshadowStructured`
- **写**：`foreshadows（批量新建）`

---

### 4.8 重要地点（侧栏：locations）

**对应表**：`importantLocations`

**字段**：
| 字段 | 含义 |
|---|---|
| `name / tags / description / significance / parentId / sortOrder` | 地点（树状） |

**AI 动作**：“AI 从正文提取”会读取当前 Work 全部已写正文和当前 World 的已有地点，以 durable 长任务逐分块提取。已完成分块有 checkpoint，刷新后从下一分块继续；模型结果不可判定时不会自动重试。全部分块完成后才显示候选，作者勾选确认后才经 `adopt(importantLocations)` 写入地点树顶层。手动 CRUD 、树层级和标签编辑保留。

**作为上游被读取**：章节正文生成时被 `buildLocationContext` 注入

---

### 4.9 状态表（侧栏：state-table）

**对应表**：`stateCards`

**字段**：
| 字段 | 含义 |
|---|---|
| `category` | 角色/地点/物品/势力/事件 |
| `entityName` | 实体名 |
| `fields` | 字段 JSON（key-value，如 位置=长安, 状态=受伤） |
| `lastChapterId` | 最近变更章节 |

**AI 动作**：（**触发点在章节编辑器**，本面板仅查看/管理；详见 §4.5 动作⑥⑦）

---

### 4.10 物品栏（侧栏：inventory）

**对应表**：`itemLedger`（流水）

**字段**：
| 字段 | 含义 |
|---|---|
| `itemName / action(gain/consume) / quantity / chapterId / chapterTitle / note` | 物品流水 |

**AI 动作**：

#### 动作①：一键从已写章节提取物品流水 🔄
- **触发**：🔘 手动
- **读**：只经 Context Gateway 的 `chapterContent / itemLedger / characters`；支持全部已写章或自定义起止章
- **Skill**：`prose.inventory-extraction`，提示词执行版本 `inventory-extract-v1`
- **提示词**：`inventory.extract`
- **解析**：严格 exact-key JSON；动作仅 `gain/consume`、数量为正整数、持有人必填；所有分块完成后才持久化候选
- **写**：确认前零正式写入；作者冻结选择后按 `itemLedger.replaceScope=['chapterId']` 逐章事务替换并签发 terminal receipt，空候选表示清理所选章旧结果

---

### 4.11 故事年表（侧栏：story-timeline）

**对应表**：`storyTimelineEvents`

**字段**：
| 字段 | 含义 |
|---|---|
| `title / storyTime / importance(1-3) / description / chapterId / chapterTitle / order` | 故事事件 |

**AI 动作**：

#### 动作①：一键从已写章节提取故事年表 🔄
- **触发**：🔘 手动
- **读**：模型只经 Context Gateway 的 `chapterContent` 读取当前 Work 的全部已写正文；正式年表仅由治理层回读作 CAS
- **Skill**：`prose.story-timeline-extraction`，提示词执行版本 `story-timeline-extract-v1`
- **提示词**：`story-timeline.extract`
- **解析**：严格 exact-key JSON；`importance` 仅允许 1～3 整数，候选按 `chapterId + title` 去重；所有分块完成后才持久化候选
- **写**：确认前零正式写入；作者冻结选择后按 `storyTimelineEvents.replaceScope=['chapterId']` 逐章事务替换，章内 `order` 压缩为 `0..n-1` 并签发 terminal receipt；空选择表示明确清理目标已写章

---

### 4.12 场景考证（侧栏：scene-verify）

**对应表**：无自有表（产出建议性内容，不写回）

**字段**：用户在面板上输入 `scene` / `sceneEra` / `sceneLocation`

**AI 动作**：

#### 动作①：场景考证 AI 生成
- **触发**：🔘 手动
- **读**：
  - `用户输入: scene / sceneEra / sceneLocation`
  - 多世界：当前世界 → `buildCurrentWorldContext`
  - 单世界：`buildWorldContext`（v3）
  - `buildHistoricalContext`（历史年表）
  - `buildWorldRulesContext`（真实与幻想约束）
- **提示词**：`scene.verify`
- **写**：无（仅展示考证建议：时代质感/称谓名词/设定校验/情节灵感四部分）

---

## 五、提示词库

### 5.1 提示词库（侧栏：prompts）

**对应表**：`promptTemplates` + `promptWorkflows`（**全局**，不绑项目）

**字段（promptTemplates）**：
| 字段 | 含义 |
|---|---|
| `name / scope(system/user) / moduleKey / systemPrompt / userPromptTemplate / variables / parameters / promptType / isActive` | 模板 |

**AI 动作**：

#### 动作①：AI 生成模板好示例 / 反例（PromptExamplesEditor）
- **触发**：🔘 手动
- **读**：只读取 `PromptTemplateEditor` 当前未保存 draft 中的 `systemPrompt / userPromptTemplate`；不读取项目、World、Work 或 Canon 上下文
- **提示词**：固定 `prompt.examples` 元提示词，要求基于当前模板生成好示例或反例
- **写**：模型输出只经 `onChange` 加入父组件内存 draft；作者另行点击顶部「保存」后，才由 Prompt store 写入全局、本机且不随项目导出的 `promptTemplates.examples`。系统模板保持只读；此处不是项目业务写入，不建立 durable Agent Run
- **证据**：HARNESS-75 的 `authoring-draft` 反例证明生成后数据库零写、离开页面丢弃未保存草稿、显式保存后才落库，配置缺失零调用

#### 动作②：工作流执行（WorkflowRunner）
- **触发**：🔘 手动
- **读**：
  - 每步的 `promptModuleKey` 取对应模板
  - 步骤间通过 `inputMapping`（如 `previousOutput: 'storyCore'`）传值
  - `userHint`
  - ⚠️ **已知问题（BUG-INPUT-WITH-GEN）**：当前**不注入项目上下文**（projectName/genres/worldContext/characters/dimension），且**步骤卡无用户输入框**。属待修。
- **提示词**：每步独立模板
- **写**：根据每步的 `saveTarget`（storyCore-field / worldview-field / etc）写回对应表

---

## 六、设置区

### 6.1 版本历史（侧栏：version-history）

**对应表**：`snapshots`

**字段**：`label / type(auto/manual) / data(完整 JSON) / size / createdAt`

**AI 动作**：（无 AI 动作）

**非 AI 动作**：
- 创建快照（手动 / 自动）：复用 `exportProjectJSON`
- 还原快照：复用 `importProjectJSON`（创建新项目）

---

### 6.2 导入（侧栏：import-doc）

**对应表**：`importSessions` + `importFiles`（blob） + `importJobs` + `importLogs`

**AI 动作**：

#### 动作①：导入文件解析 → AI 结构化
- **触发**：🔘 手动，上传 .txt/.docx/.pdf
- **读**：
  - 上传文件 → `doc-parser`（动态 import pdfjs/mammoth）
  - 分块后逐块
  - `用户选择: 解析类型`（character / worldview / outline / all）
- **提示词**：`import.parse-character / parse-worldview / parse-outline / parse-all`
- **解析**：`tryParseWithRepair`
- **写**：通过 `chunk-writer`：
  - `worldviews`（字段追加）
  - `characters`（按 name 去重，新建）
  - `outlineNodes`（重建树）

#### 动作②：断点续跑
- **触发**：🔘 手动（扫描未完成 session）
- **行为**：从 `importFiles` 加载 blob → 重新走分块 → 续传

---

### 6.3 导出（侧栏：export）

**对应表**：所有项目内容表

**AI 动作**：（无 AI 动作）

**非 AI 动作**：
- JSON 全量备份：`exportProjectJSON`
- Markdown / HTML / EPUB / TXT 各格式
- Gist 同步

---

### 6.4 消耗统计（侧栏：usage-stats）

**对应表**：`aiUsageLog`

**字段**：`timestamp / category / model / inputTokens / outputTokens / costUsd`

**AI 动作**：（无 AI 动作，本面板**记录所有 AI 动作的消耗**）

**自动埋点**：在 `client.ts` 的 `streamChat / chat` 唯一出口，所有 AI 调用结束后自动写入

---

### 6.5 设置（侧栏：settings）

**对应表**：无 DB 表（用 `localStorage`）

**字段**：AI 提供商 / API Key / 模型 / 温度 / max_tokens / 多套预设

**AI 动作**：

#### 动作①：测试连接
- **触发**：🔘 手动
- **读**：当前配置
- **提示词**：内置 "测试连接" 简单消息
- **写**：无（仅显示连接结果）

---

## 七、跨面板/全局动作清单（汇总速查）

按"何时触发"分类：

### ⚡ 自动触发
| 触发时机 | 动作 | 位置 |
|---|---|---|
| 章节正文采纳后 | 状态提取 → 用户审核 → 落库 | ChapterEditor §4.5 ⑦ |
| 章节正文采纳后 | 章节摘要生成 → 落库 | ChapterEditor §4.5 ⑧ |
| 项目切换/定时 | 自动备份快照 | useAutoBackup |
| 内容编辑 | 自动保存正文 | useAutoSave |

### 🔘 手动触发（按读取上游分类）

**仅读取自身上文的（局部）**：
- 选区润色/扩写/去 AI 味（§4.5 ③④⑤）
- 章节摘要（§4.5 ⑧）
- 章节审校/追读力/反 AI（§4.5 ⑩⑪⑫）

**读取世界观+故事核心+角色（中范围）**：
- 世界观各字段、故事核心各字段、创作规则各字段、卷大纲、章大纲、伏笔建议、故事线、角色生成、场景考证
- 历史考据/头脑风暴（HARNESS-73：只读登记世界观、历史基线与精确事件/关键词目标；候选确认后才写正式结果字段）

**读取全部上游（最大范围，章节正文级）**：
- 章节正文生成、续写（§4.5 ①②）
- 细纲增强生成（§4.6 ②）

**反向流（用户给料 → AI 反推）**：
- 灵感反推（§1.2）
- AI 建议世界（多世界面板）
- 参考分析（§1.3）
- 角色驱动剧情（§4.3）

**下游提取（从正文派生）**：
- 状态提取（§4.5 ⑥⑦）
- 物品流水提取（§4.10 ①）
- 故事年表提取（§4.11 ①）
- 关系网建议（§3.2 ①）
- 情感节拍规划（§4.5 ⑨）
- 章节摘要生成（§4.5 ⑧）

---

## 八、字段流向速查（"某字段被谁读、被谁写"）

> 反向查询用：给我一个字段，告诉我它在系统里被怎么用。

### `worldviews.worldOrigin`（世界来源）
- **被写入**：世界起源 AI 生成（§2.3①）/ 灵感反推（§1.2①②）/ AI 建议世界 / 导入解析
- **被读取**：自然环境/人文环境/故事核心各字段生成、角色生成、卷大纲、章大纲、细纲、章节正文、伏笔建议、故事线、场景考证、历史考据/头脑风暴、上下文快照、HTML 导出设定集

### `historicalTimelineEvents.aiConsult` / `aiBrainstorm` 与 `historicalKeywords.aiConsult` / `aiBrainstorm`
- **被写入**：历史考据/头脑风暴 Agent 的持久候选经作者确认后，通过 `FIELD_REGISTRY` / `AdoptionSchema` 精确采纳
- **被读取**：历史面板结果展示；后续同一目标的 Context 基线快照（用于 CAS 与刷新恢复，不能作为未确认旁路写入）

### `worldviews.factionLayout`（势力分布）
- **被写入**：人文环境 AI 生成（§2.5）/ 灵感反推 / 导入解析
- **被读取**：章节大纲、角色生成、章节正文、世界地图生成（地理参考）

### `storyCores.theme`（主题）
- **被写入**：故事设计 AI 生成（§2.8）/ 灵感反推 / 导入解析
- **被读取**：世界起源生成（作铺垫）、创作规则各字段、卷大纲、章大纲、章节正文、故事线、所有"读 worldCtx"的动作

### `characters.personality`（性格）
- **被写入**：角色单字段 AI 生成（§3.1②）/ 角色解析（§3.1③）/ 角色批量生成（§3.1①）
- **被读取**：章节正文（核心角色）、章节审校、关系网建议、章节细纲生成（场景中的角色）

### `chapters.content`（章节正文）
- **被写入**：章节正文 AI 生成/续写（§4.5①②）、选区润色/扩写/去 AI（§4.5③④⑤）、自动保存、导入正文
- **被读取**：状态提取、物品提取、年表提取、关系提取、摘要生成、审校、追读力、反 AI 检测、上一章正文末尾（下章生成和情感节拍规划时）

### `creativeRules.atmosphere`（基调）
- **被写入**：创作规则 AI 生成（§4.1）
- **被读取**：章节正文（buildCreativeRulesContext）

### `stateCards`
- **被写入**：状态提取（§4.5⑥⑦） → applyDiffs 按实体聚合
- **被读取**：章节正文（按需召回 buildSelectiveStateContext）、章节审校、buildMemory Episodic 层

### `foreshadows`
- **被写入**：伏笔 AI 建议（§4.7） / 用户手动 CRUD
- **被读取**：章节正文、章节细纲、章节审校、buildMemory Semantic 层

### `codex` 词条
- **被写入**：用户手动 CRUD；文档解析的带证据 AI 分类候选经作者确认后写入
- **被读取**：所有"读 worldCtx + codex"的动作（§4.2 大纲、§4.5 章节正文、§3.1 角色生成、§4.6 细纲、§4.12 场景考证 等）

---

## 九、当前已知问题（影响 AI 行为的部分）

> 已记在 ROADMAP，本处仅速查，方便对照说明书时知道"这条动作有什么坑"

| 动作 | 问题 |
|---|---|
| §5.1 工作流执行 | （已修）步骤卡已有用户输入框，运行时会把用户输入、项目元信息、注册表装配上下文和真实/幻想规则注入模板 |
| §1.2 灵感反推 | （已修）多世界 worldGroupId remap 已统一 export-index 协议，导入导出后世界归属不再丢失 |
| §2.2 真实与幻想 | 项目级单例，未按世界隔离（待 Phase 40） |
| §3.1 角色批量生成 | （已修）多世界曾用单世界上下文 |
| §4.5 章节正文 | （已修）创作规则曾不注入、worldview 单世界 v2/v3 错位 |
| §4.5 状态提取 | （已修）applyDiffs 同实体多字段曾重复/覆盖 |
| 整体 | 工作流绕过适配器裸渲染（与统一架构重构 R-1/R-2 一起根治） |

---

## 十、维护规约（这份说明书的"地基"地位）

1. **加新 AI 动作**：先在本说明书加一段（按面板归类），写清读什么/提示词/写什么，再写代码。
2. **改 AI 行为**：先改本说明书对应那段，再改代码。两份不一致 = 必须有一份是错的，code review 拒绝合入。
3. **删功能**：先在本说明书划掉那段，再删代码。
4. **字段重命名 / 新增**：先改字段表（§"对应表"那节）+ 说明书引用，再改类型/schema。

---

## 附录：与其它文档的关系

- `DATA-FLOW-MAP.md` — 文字总表（侧重数据流与漏洞清单）
- `DATA-FLOW-DIAGRAM.md` — Mermaid 可视化（侧重关系图）
- **本文档** — AI 行为目录（侧重"每个 AI 动作的读 / 写"）
- `ARCHITECTURE-REFACTOR.md` — 重构方案（三根支柱的工程实现细节）
- `roadmap/README.md` — 当前功能体系与待开发入口；旧 Phase 38/39/40 规格回查 `ROADMAP-LEGACY.md`

四份文档"四位一体"，覆盖同一个事实源的不同切片。改其一须同步另三个。
