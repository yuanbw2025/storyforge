# Changelog

## v3.1.0 — 2026-06-09 · 社区反馈批量修复 + 上下文贯通增强 + 旧代码清除

> 在 v3.0.0 架构地基之上,集中处理了一批社区真实反馈,并把"上下游内容贯通"补完。全程守三注册表("加一行/改入口",零新建表/组件/补丁)。验证:tsc=0 / 100 测试 / 架构 lint 0 违规 / build OK。

### 🐛 社区反馈修复

| 编号 | 问题 | 修复 |
|---|---|---|
| **FB-1** | 工作流多步链:第2步「世界起源」串到别的书、不读第1步 | 双根因修复(useRef 累加器替代陈旧 `results` 闭包 + 每步走 `assembleContext` 注入项目设定);真实 AI 抓包验证 |
| **FB-9** | 场景细纲不被正文生成吃进去 | 注册 `detailedOutline` 上下文源,正文(写/续写/扩写/润色)接入 |
| **FB-10** | 生成卷级大纲点采纳后未写入、无提示 | 采纳命中去重时不再静默,明确反馈"未写入·原因·处理建议" |
| **FB-8** | 本地/自定义模型上下文窗口被误判为 8K,误报超窗 | AIConfig 加 `contextWindow` 字段 + 设置区输入框;预算优先级 用户>预设>8K兜底 |
| **FB-3** | 世界起源生成读不到「一句话故事」 | 世界观生成补 `assembleContext(['storyCore'])` |

### 🔗 上下文贯通增强

- **下游 → 上游反推**:世界观生成现在结合用户已填的**角色 / 故事核心 / 故事线**一起反推(此前只读故事核心,"角色→世界观"是断的)。合并冗余:把分散的 storyCore 单独调用升级为一次拉齐 storyCore+characters+storyArcs。

### 🧹 旧代码清除

- 删除 14 个确认 0 引用的死文件(旧地图实验 WorldMap3D/Azgaar/Canvas、被取代组件 ExportPanel/AIFieldCard、死 hook/adapter、三层记忆 memory-builder 等)
- 移除无用依赖 `three / d3-force / dexie-react-hooks` 等,补登记 `nanoid`
- 经核查:`requireBackupBefore` 数据安全网确已接线;`storyLines` 等向后兼容字段刻意保留(承载老用户数据)

### 🧰 测试

- 反例测试新增 R-FB9 / R-FB10 / FB-8 / R-downstream-reverse 等(87 → 100)

---

## v3.0.0 — 2026-06-09 · 架构重构（三注册表地基）+ 数据安全根治

> 一次系统性重构(Phase 0/1/2/3),把项目从"散落手写、加功能易冒同类 bug"的状态,收口到 **三个单一事实源注册表 + CI 自动守护 + 87 个测试**。核心目标是**地基**:不再头疼医头,改一处让所有相关功能受益。
>
> 验证:tsc=0 / 87 测试全绿 / 架构 lint 0 违规 / 必需表 45 / AI 说明书与代码一致 / build OK。浏览器实测:新建·持久化·导出·多世界迁移·删除级联(零孤儿)·真实 AI 生成 全过。

---

### 🏛️ 架构变化(本次重构的核心)

引入**三个单一事实源注册表**,所有"读 / 写 / 表生命周期"必须收口到这里,不允许散落手写:

| 注册表 | 管什么 | 取代了什么 |
|---|---|---|
| **① `PROJECT_TABLES` + 派生生命周期 API** | 表的生命周期(导出/导入/删除/迁移) | 此前 export/deleteProject/deleteGroup/migrate **各处手列表清单**,漏表反复发生 |
| **② `FIELD_REGISTRY` + `AdoptionSchema` + `adopt()`** | AI 写回什么(字段映射/去重/外键/类型) | 此前散落 `db.x.add/update` + 手写字段映射,字段错位、重复记录 |
| **③ `CONTEXT_SOURCES` + `assembleContext()`** | AI 读什么(上下文装配,18 个源) | 此前面板里**手挑** `buildWorldContext+...`,多世界串台 |

**配套地基**:
- 启动期注册表校验(`main.tsx` 校验 45 张表与注册表一致)
- **CI 架构 lint**(`check-architecture.mjs`):自动拦截"绕过注册表的手写代码"——重构中真的抓到过违规
- **AI 说明书自动生成**(`generate-ai-manual.mjs`):从代码扫描生成,CI 校验与实际一致,杜绝文档漂移
- 真上下文裁剪(L3→L2→L1 按预算分层裁剪)
- 项目"宪法" `CLAUDE.md`(三注册表铁律 + 动手前四问)+ 完整接手文档

---

### 🛡️ 数据安全 bug 根治(Phase 0 · 8 个 P0)

这些都是**可能直接损坏用户手稿**的高危 bug:

| # | Bug | 修复 |
|---|---|---|
| P0-1 | `deleteGroup` 事务作用域不全 | 删世界用完整 45 表事务,不再漏删/半删 |
| P0-2 | `migrateToMultiWorld` 漏 `codexEntries` | 多世界迁移事务纳入词条表 |
| P0-3 | `ensureSchema` **有删库风险** | 生产环境 schema 自检改为**阻止重置**而非删 IndexedDB |
| P0-4 | `BUG-EXPORT-WG` 多世界导出 worldGroupId 重映射错位 | 导出用 export id、导入正确还原到对应世界组 |
| P0-5 | `importProjectJSON` 非事务 + 外键不校验 | 导入包进单一 45 表事务,外键非法即快速失败,提交前做完整性断言 |
| P0-6 | `deleteProject` 漏间接归属表 | 删项目级联覆盖导入/作品学习的间接归属 + blob |
| P0-7 | `deleteNode` 绕过章节级联 | 大纲删除统一走章节级联入口 |
| P0-8 | `migrateToMultiWorld` 漏给 outlineNodes 盖章 | 迁移时旧大纲节点盖章到主世界(否则启用多世界后大纲卷消失) |

---

### 🔗 多世界 + 内容完整性(Phase 2 · P1 修复)

| 项 | 修复 |
|---|---|
| 真实与幻想多世界化(Phase 40) | `worldRulesProfiles` 改为世界级,每世界一套规则;9 处调用点逐一传值 |
| 章节正文不读世界规则 | `chapter.content` 接入 `worldRulesContext` |
| AIFieldCard 不带当前值生成 | 单字段生成默认带 currentValue(扩写/润色),rewrite 模式才不带 |
| 分块导入不分目标世界 | 导入数据按选定目标世界盖章,跨世界同名隔离 |
| 批量正文用错世界上下文 | 支持每章 worldContextResolver |
| 角色删除/合并引用残留 | 共享 remap 清理细纲角色数组/场景 JSON/关系/状态卡 |
| 状态卡全量召回 | 改为按正文选择性召回 |
| P1-9~P1-16 一批 | 真请求裁剪、真中止信号、多世界上下文锁、ID 过滤、portal 清理、地理递归删除、导出脱敏等 8 项 |

---

### 🧰 工程化(Phase 3)

- **测试**:0 → 87 个(单元 + 18 条反例测试 R-01~R-18,每条锁一个已修 bug)
- **CI**:6 道关(必需表 → AI说明书 → 架构lint → tsc → 测试 → build)
- **安全**:GitHub PAT 默认 session-only(不再默认写 localStorage)
- **性能**:主包 gzip **587KB → 415KB(-30%)**,地图/编辑器懒加载 + vendor 分包
- **文档**:CONTRIBUTING / Issue·PR 模板 / README 英文 TL;DR
- **i18n**:零依赖框架预留(t() + 语言切换 + zh/en key 对齐测试),未全量迁移

---

### 🗣️ 社区反馈修复

| 编号 | Bug | 修复 |
|---|---|---|
| **FB-1** | 工作流多步链:第2步「世界起源」不读第1步、项目上下文全空(被感知为"串到别的书") | 双根因修复:① `useRef` 累加器替代陈旧 `results` 闭包(步骤链路贯通)② 每步走 `assembleContext` 注入项目名/流派/世界观/维度。**真实 AI(NVIDIA)抓包验证**:修复后步骤2请求含步骤1输出+项目设定 |
| FB-3(部分) | 世界起源生成读不到「一句话故事」 | 补 `assembleContext(['storyCore'])`,storyCore 早已登记、只让调用方 need 它 |

> 其余社区反馈(FB-2/4/5/6/7/8)与完善性专项(HEALTH-1~6)已立项,见 `docs/ROADMAP.md`。

---

## 2026-06-04

### 修复严重数据丢失：导出/备份漏掉重要地点·真实与幻想·设定词条（重大）

**来源**：全量审计交叉核对「DB 全部表 vs JSON 导出覆盖」

JSON 导出（项目备份/恢复、Gist 同步）此前**完全没有包含**三类用户内容表：**重要地点（importantLocations）、真实与幻想（worldRulesProfiles）、设定词条（codexCategories/codexEntries）**。后果：用户导出项目做备份、再导入恢复时，会**丢失这三类全部内容**。

- 修复：导出补全这三类（重要地点/词条分类按树结构导出 parentId、词条按 categoryId 引用导出、worldGroupId 重映射）；导入端对应补全还原（重建 parentId / categoryId / worldGroupId）。Gist 导出复用同一数据格式，一并修复。改动：`src/lib/export/json-export.ts`。
- 顺带发现多世界 export/import 的 `worldGroupId` 重映射疑似键值错位（单世界无影响），已另列任务排查。

### 清扫 + 多世界批量上下文 + 多处遗留字段

- **死代码清扫**：移除侧栏不可达的旧 `WorldviewPanel` 及其专用的 v2 读取函数 `buildExistingWorldview`、对应路由与类型。
- **批量生成多世界化**：批量大纲 / 批量细纲此前在多世界下用单一上下文；批量 runner 增加 `worldContextResolver`，逐卷/逐章按所属世界读取上下文。
- **大纲读遗留字段**：`OutlinePanel` 故事核心上下文读 `storyLines`（v3 已改名 `mainPlot`）→ 改读 `mainPlot`。
- **多世界覆盖**：场景/细纲/角色生成此前写死单世界上下文 → 新增 `buildNodeWritingContext` 按章节所属世界读取。

---

### 全量贯通审计：补齐 6 处「填了 AI 读不到」+ 收口单/多世界字段漂移

**来源**：用户要求全量重扫，确保字段精确、逻辑贯通

逐字段交叉比对「面板写入 / AI 读取 / 采纳写回」，发现并修复 6 处上下文漏注入：

1. 世界观 6 个字段从不被任何上下文 builder 注入：**神明设定 / 疆域尺寸 / 重镇分布 / 山川水系（多世界）/ 世界大事记 / 矛盾冲突**。
2. **单世界 / 多世界两条上下文路径各读各的世界观字段**（漂移源头）：抽出 `formatWorldviewBlock` / `formatStoryCoreBlock` / `formatPowerSystemBlock` 三个共享格式化函数，两条路径共用，单一事实源，杜绝再次漂移。
3. 力量体系**等级阶梯（levels）+ 规则**漏读（原只读名称+描述）。
4. 故事核心**一句话故事（logline）+ 复线（subPlots）**漏读。
5. 角色**外貌（appearance）**漏读。
6. **重要地点整张表从不进入写作上下文**（原仅用于地图生成）：新增 `buildLocationContext` 并注入章节正文生成。

改动：`src/lib/ai/context-builder.ts`、`src/lib/ai/world-group-context.ts`、`src/components/editor/ChapterEditor.tsx`。完整审计清单（含仍待 R-1/35-b 处理项）见 `docs/DATA-FLOW-MAP.md` 第三-ter 节。

---

### 新增：AI 消耗统计页 + 修复多处「半截改版」上下文漏注入

**消耗统计（设置区新页）**：在 AI 调用唯一出口记录每次用量并持久化（DB v26 `aiUsageLog`）。设置区新增「消耗统计」页，逐条展示：时间（年月日时分秒）、消耗类型（按 AI 行为分类的彩色标签：正文生成/世界观生成/主角状态提取/大纲生成/角色生成等）、模型、输入 token、输出 token、花费（美元在上、人民币在下，汇率可调）。顶部汇总总输入/输出/总花费；支持仅当前项目筛选、清空。费用按模型估算单价 × token 计算。关键文件：`lib/ai/usage-log.ts`、`stores/ai-usage.ts`、`components/settings/UsageStatsPage.tsx`、`lib/ai/client.ts`（埋点）、`hooks/useAIStream.ts`（透传类型）。

**全项目「半截改版」扫描，修复三处上下文漏注入**：
- 故事核心（多世界）：`buildCurrentWorldContext` 此前不读 storyCore → 多世界写作缺主题/冲突/主线。已补。
- 创作规则（全模式）：creativeRules（写作风格/视角/基调/禁忌/一致性）此前从不进入任何生成 prompt，整张表对 AI 无效。新增 `buildCreativeRulesContext` 并注入章节正文生成。
- （另见下条：单世界世界观读取错位修复。）
- 三处均记入 `docs/DATA-FLOW-MAP.md` 第三节 F 项。

---

### 修复：单世界模式世界观喂不进 AI（v2/v3 字段读写错位，重大）

**来源**：盘数据流总表时发现

`buildWorldContext`（单世界写作上下文）原先只读 worldview 的 v2 旧字段（`summary`，无则 `geography/society/rules`），而世界观三个面板（世界起源/自然/人文）写入的是 v3 字段（`worldOrigin/continentLayout/races/factionLayout…`），且已无任何地方写 `summary`。导致**单世界模式下作者填写的整个世界观在 AI 写章节/大纲/角色等时基本读不到**（仅故事核心与力量体系漏过）。由于单世界是默认模式，影响面很大。

- 修复：`buildWorldContext` 改为读取 v3 字段（与多世界 `buildCurrentWorldContext` 对齐），v2 字段仅在 v3 全空（极老项目）时兜底。改动：`src/lib/ai/context-builder.ts`。
- 此修复同时收窄了「单世界读 v2 / 多世界读 v3」的字段不一致；彻底清除双轨在统一读取层 R-1 + 词条化 35-b 完成。

---

### 修复：灵感反推采纳后世界观为空 + 新增数据流总表文档

**来源**：社区反馈（精力无穷）「点写入世界观/一键采纳后，世界观面板仍为空」

- **修复写回脆弱点**：`saveWorldview/saveStoryCore/savePowerSystem` 原仅依赖内存中的当前记录，为 null/陈旧时直接新增第二条记录，而面板读取首条（旧空记录）导致显示为空。改为写回前以 DB 为准、按 `(projectId, worldGroupId)` 定位既有记录并更新，仅当确无记录时才新增，杜绝重复记录与写错位。改动：`src/stores/worldview.ts`。
- **新增 `docs/DATA-FLOW-MAP.md` 数据流总表**：通读全项目，盘点每张大功能表的「字段 / AI 读什么 / 生成什么 / 写回哪里」，并标出当前「逻辑不贯通 / 屎山隐患」清单（读侧上下文装配散落、写侧字段映射散落、同一概念多处重复存储、v2/v3 字段双轨），给出「统一上下文装配层 + 统一采纳写回层 + 字段登记」的重构蓝图与增量迁移顺序。作为后续架构重构的唯一事实源。

---

### Phase 35-a — 词条系统地基（设定词条）

**来源**：世界观词条化重构（设计文档 `docs/CODEX-REDESIGN.md`）第一步落地

引入通用「词条系统（Codex）」：以「通用词条表 + 分类树 + 字段 schema」承载世界观中可枚举的实体（矿物/草药/异兽/种族/势力/城池/器物），取代分散的自由文本字段，并原生支持用户自定义分类与字段。本阶段为地基，与现有面板并存，不迁移旧数据。

- 新增设定库入口「设定词条」，按「自然环境 / 人文环境」两大领域组织。
- 内置 7 类分类（含各自专属字段 schema）首次进入项目时自动播种：⛏️矿物灵材、🌿灵植草药、🐅灵兽异兽、🧬种族民族、⚔️势力、🏰城池重镇、🗡️人工器物。
- 词条详情表单由字段 schema 驱动，自动渲染文本/长文本/下拉/数字/关联等控件。
- 支持词条间关联（如「器物 ← 所需材料」「城池 → 所属势力」），通过关联选择器建立。
- 支持用户自定义分类（新增/删除），内置分类不可删除但可隐藏。
- **接入 AI 写作上下文（上游设定全链路贯通）**：词条作为「上游设定」注入 AI 生成链路。经全面排查，覆盖**所有**读取世界上下文的 AI 入口——章节正文、卷/章大纲、细纲、场景生成、场景考证、角色生成、伏笔建议、故事线规划、角色驱动剧情；审校（review）经 worldContext 传参也一并获得词条。多世界经 `buildCurrentWorldContext` 统一注入（一处覆盖全部调用点）；单世界在各写作面追加读取。单世界且无任何词条时返回空，对现有写作零影响。
- **修复多世界词条隔离**：内置分类为全局（worldGroupId=null），原过滤逻辑会在具体世界下把全局分类排除导致词条恒空；改为「全局项在任何世界可见 + 世界专属项仅其世界可见」。

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/types/codex.ts` | 新增：CodexCategory / CodexEntry / CodexFieldDef 类型 + 7 类内置分类 seed |
| `src/lib/db/schema.ts` | DB 升级至 v25，新增 `codexCategories` / `codexEntries` 表 |
| `src/stores/codex.ts` | 新增：词条 store（内置分类幂等播种 + 分类/词条 CRUD） |
| `src/components/codex/CodexPanel.tsx` | 新增：通用词条三栏面板（分类树 / 词条列表 / schema 驱动详情） |
| `src/components/layout/sidebar-tree.ts` + `src/pages/WorkspacePage.tsx` | 注册「设定词条」入口 |
| `src/lib/ai/codex-context.ts` | 新增：`buildCodexContext` 词条上游上下文构建（分类紧凑格式化 + 预算上限 + 世界隔离） |
| `src/lib/ai/world-group-context.ts` | `buildCurrentWorldContext` 注入词条（多世界全调用点覆盖） |
| `src/components/editor/ChapterEditor.tsx`、`outline/OutlinePanel.tsx`、`outline/ScenePanel.tsx`、`outline/DetailedOutlinePanel.tsx` | 单世界写作面追加词条上下文读取 |

> 后续：Phase 35-b（自然/人文分类落地、势力与阵营合并、历史线并入年表、道具系统下线）、35-c（导入时 AI 自动分类）、Phase 37（修炼体系，异兽「修炼体系」字段升级为关联）。

---

### Phase 28.5 — 参考资料角色聚合改用 AI（修复角色重复）+ 文本处理正则全面审查

**来源**：社区反馈「项目参考解析之后角色会重复」+ 全局原则贯彻（一切文本分析与内容提取均调用 AI，不使用正则）

**问题定位**：参考资料深度分析的角色卡片由 `merge-analysis.ts` 中的 `extractCharacterNames` 用三组正则从分析文本里抠人名，再按句子切分聚合。该方式准确率低，且同一角色在不同分块、或使用不同称呼时会被识别为多个，导致角色重复。此问题与导入流程的角色去重（chunk-writer 同名校验，工作正常）无关。

**修复**：
- 移除 `extractCharacterNames` 正则抠名逻辑，角色聚合改为调用 AI：阅读全部分块的「人物塑造」分析，将同一角色（含不同称呼、跨分块出现）归并为一张去重后的角色卡。
- 参考资料新增 `mergedCharacters` 持久化字段，聚合结果落库，刷新后保留。
- 报告查看器「角色分析」区新增「AI 整理角色卡」按钮，输出统一角色名、角色定位、一句话定位与综合塑造手法分析；解析层额外做归一化去重，防止模型偶发重复。

**全项目文本处理审查结论**：
- 共核查 47 个调用 AI 的文件、22 个适配器，约 60 处正则使用。其中约 95% 为合法用途：JSON 围栏剥离、文本清洗、按显式标记的结构切分、第三方库（mammoth/pdfjs）文件解析、量化词频统计等。
- 认定并修复三处与原则相关的问题：
  1. **参考资料角色聚合**（本次核心修复，正则抠名 → AI 聚合）。
  2. **角色解析 role 字段**（`parse-character-output.ts`）：原逻辑用中文关键词匹配，会把 AI 已正确返回的英文枚举（如 `protagonist`）误判并回退为 `supporting`；改为优先信任 AI 枚举，中文关键词仅作兜底。
  3. **卷/章结构检测**（`volume-detector.ts`）：经评估属确定性结构切分（按作者显式书写的卷章标记切分并返回精确字符偏移，整本数十万字无法喂入模型、模型亦无法稳定返回偏移），保留正则并补充注释说明其与语义抽取的本质区别；同时扩展识别楔子、序章、引子、尾声、终章、番外、外传、后记等非数字式特殊标题，提升召回率。

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/reference-analysis/merge-analysis.ts` | 移除 `extractCharacterNames` 正则；新增 `AIMergedCharacter` 类型、`collectCharacterCraftTexts`、`buildCharacterMergePrompt`、`parseCharacterMergeOutput` |
| `src/lib/types/reference.ts` | Reference 新增 `mergedCharacters?: string` 字段 |
| `src/components/project/AnalysisReportViewer.tsx` | 新增「AI 整理角色卡」按钮、聚合结果持久化与渲染；`CharacterCard` → `AICharacterCard` |
| `src/lib/ai/parse-character-output.ts` | `parseRole` → `normalizeRole`，优先信任 AI 英文枚举 |
| `src/lib/import/volume-detector.ts` | 补充注释说明用途；章标题正则扩展识别特殊标题 |

---

## 2026-06-03

### Phase 27.2a — 场景考证

**来源**：社区用户 zzjj 需求

新增「场景考证」功能：作者在构思或撰写场景时，描述当前场景，AI 结合本作品的世界观、历史年表与「真实与幻想」规则，给出符合背景的细节建议、设定校验与情节灵感。

- 创作区新增「场景考证」面板：场景描述 + 可选时代/地点，一键考证
- AI 输出四个部分：时代质感与细节、称谓与名词、设定校验（时代错乱/设定冲突提示）、情节灵感
- 严格遵守作品设定：标注「取自真实」的维度按真实历史考证，标注「架空改造」的维度尊重作者设定，「史实锚点」不可违反
- 多世界模式下按当前世界读取上下文；场景草稿自动保存
- 为 zzjj「边考证边想点子」需求中不依赖 Agent 架构即可实现的部分

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/ai/prompt-seeds.ts` | 新增 `scene.verify` prompt seed |
| `src/lib/ai/adapters/scene-verify-adapter.ts` | 新增：考证 prompt 构建 |
| `src/components/scene/SceneVerifyPanel.tsx` | 新增：场景考证面板 |
| `src/components/layout/sidebar-tree.ts` + `src/pages/WorkspacePage.tsx` | 注册入口 |

---

### 社区反馈批量处理 + 解析增强（全局改用 AI 解析）

**来源**：社区反馈 + 全局原则确立

- **修复伏笔 AI 建议无法写入伏笔表**（买辣椒反馈）：原 onAccept 仅关闭面板、未持久化数据；改为 AI 二次结构化解析后批量写入伏笔表
- **新增 API 配置预设**（长耳朵兔子反馈）：支持保存多套 API 配置并一键切换（保存 / 应用 / 覆盖 / 重命名 / 删除）；下拉型提供商支持手动输入任意模型名
- **灵感反推草稿持久化与结果导出**（鲤鱼跃龙门反馈）：灵感输入按项目自动保存至本地，切换面板不丢失；反推结果可导出为 Markdown
- **AI 结构化输出展示优化**（zzjj 反馈）：JSON 结构化输出不再直接以原始文本呈现，改为友好提示 + 可折叠原始数据
- **世界观重叠字段导航提示**：世界历史线 / 道具与器物 / 地貌分布等字段增加提示，指引前往对应独立面板管理具体条目
- **解析增强（确立全局原则）**：确立「一切文本分析与内容提取均调用 AI 实现，不使用正则」原则。章节大纲、细纲场景解析改为「JSON 优先 → AI 重构」，移除正则降级；新增 `restructure.ts` 通用 AI 重构工具

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/ai/restructure.ts` | 新增：通用 AI 重构（非规整输出 → 干净 JSON） |
| `src/lib/ai/parse-outline-output.ts` | parseChapterOutlineSmart / parseVolumeOutlineSmart |
| `src/lib/ai/adapters/detail-scene-adapter.ts` | parseEnhancedDetailSmart |
| `src/lib/ai/adapters/foreshadow-adapter.ts` | 伏笔结构化解析 |
| `src/stores/ai-config.ts` + `AIConfigPanel.tsx` | API 预设 + 自定义模型名 |
| `src/components/project/InspirationPanel.tsx` | 草稿持久化 + 导出 |
| `src/components/shared/AIStreamOutput.tsx` | 结构化输出友好展示 |
| `src/components/worldview/{Humanity,Natural}Panel.tsx` | 重叠字段导航提示 |
| `src/components/foreshadow/ForeshadowPanel.tsx` + 大纲/细纲面板与批量 runner | 接入 AI 解析 |

---

## 2026-06-02

### 📦 本期合并更新（用户版总览）

> 涵盖：正文粘贴修复 + 多世界系统（25.4）+ 多世界地图打通 + 多世界补完（25.5）。各项详细技术改动见下方分条。

**✍️ 正文粘贴不再丢失**
修复了正文编辑器粘贴内容后马上切换页面会导致内容丢失/格式错乱的问题。现在无论多快切走都会自动保存。

**🌐 新增「多世界模式」（诸天流 / 无限流 / 快穿 / 修仙多界）**
项目概况页新增开关，默认关闭，关闭状态下功能与此前一致。开启后：
- 多个独立世界：每个世界拥有独立的世界观、力量体系、地理与角色，互不干扰
- 世界切换：世界观 / 地理 / 力量体系 / 世界地图面板顶部提供切换器，切换后编辑对应世界
- 地图按世界隔离：每个世界拥有独立的世界树与地图，切换世界时整套地图随之切换
- AI 上下文隔离：生成某世界的设定 / 章节 / 地图时，AI 仅读取该世界的内容，互不混淆
- AI 建议世界：输入故事概念，AI 生成 2-4 个差异化世界供勾选采纳
- AI 扩写世界观：基于一句话草稿，AI 参考其他世界扩展为完整世界观（避免雷同）
- 角色归属：角色可归属于特定世界或标记为「跨世界」（如主角），角色册按世界筛选
- 大纲世界标记：每卷可标记所属世界，写作时 AI 上下文随之切换
- 世界关系流向图：4 种自适应布局（流程 / 辐射 / 阶梯 / 树状）可视化世界间传送门、飞升通道等关系
- 导入导出完整保留全部多世界数据

**📜 多世界历史年表**
历史年表支持多世界，用标签切换——每个世界一个标签 + 「一览」并排对比多个世界的历史脉络。

**📅 故事进程年表（新）**
AI 从已写正文中提取剧情大事，按故事进程排成时间轴，带故事内时间和重要度分级。与「历史年表（世界背景）」「故事线（结构）」是三个不同的东西。

**🎒 游戏包裹式物品栏（新）**
道具追踪升级成游戏包裹——主角在正文里获得/消耗物品，AI 自动提取，显示当前持有数量和每件物品的获得/消耗历程。

**💡 多世界版灵感反推**
写一段带多个世界想法的灵感（如「主角带系统依次穿越斗破、遮天、完美」），AI 顺着思路反推出故事主线 + 多个世界 + 角色，一键创建。

---

### Hotfix — 正文粘贴内容切换页面后格式丢失

**来源**：社区用户（买辣椒）

**问题**：编辑器粘贴内容后 1.5 秒内切换页面，内容丢失/格式错乱。
**根因**：`useAutoSave` 的 1.5s debounce 在组件卸载时只 `clearTimeout` 不 flush，pending 的保存被取消。
**修复**：`useAutoSave` 新增 `dirtyRef` 标记，组件卸载 cleanup 时若有未保存变更立即执行一次 `saveFn`，确保数据落盘。

| 文件 | 改动 |
|------|------|
| `src/hooks/useAutoSave.ts` | 卸载 flush 未保存数据 |

---

### Phase 25.5 — 多世界补完 + 下游提取产物

**来源**：多世界系统讨论延伸

- **多世界历史年表**：历史年表支持多世界，用标签切换（每个世界一个标签 + 「一览」并排对比），不是下拉藏内容
- **故事进程年表（新）**：AI 从已写正文提取剧情大事，按故事进程排成时间轴。与「历史年表（世界背景）」「故事线（结构）」区分。带故事内时间、重要度分级
- **游戏包裹式物品栏（新）**：道具追踪升级为游戏包裹——主角在正文里获得/消耗物品，AI 自动提取，统计当前持有数量 + 获得/消耗历程
- **多世界版灵感反推**：写带多世界意图的灵感，AI 顺思路反推故事主线 + 多个世界 + 角色，一键创建。字段严格对齐，确保正确落框
- **世界关系流向图**：4 种自适应布局（横向流程/中心辐射/纵向阶梯/树状分支），智能默认 + 手动切换，纯 SVG 可视化世界间传送门/飞升通道
- **地图打通**：每个世界有独立的世界树和地图，切换世界整套地图跟随；地图 AI 生成读当前世界的地理设定

**新增文件**：
| 文件 | 说明 |
|------|------|
| `src/lib/types/{item-ledger,story-timeline}.ts` | 物品流水 / 故事年表类型 |
| `src/stores/{item-ledger,story-timeline}.ts` | 对应 store |
| `src/lib/ai/adapters/{inventory-extract,story-timeline}-adapter.ts` | AI 提取适配器 |
| `src/components/items/InventoryPanel.tsx` | 物品栏面板 |
| `src/components/timeline/StoryTimelinePanel.tsx` | 故事年表面板 |
| `src/components/world-group/WorldRelationGraph.tsx` | 世界关系流向图 |

**主要修改**：DB v23（itemLedger）+ v24（storyTimelineEvents）；历史类型加 worldGroupId；HistoryPanel 世界标签；InspirationPanel 多世界分支；WorldMapPanel/world-node store 按世界隔离；prompt-seeds 新增 4 个 seed；导入导出 + 级联删除全部补齐。

---

### Phase 25.4 — 多世界系统

**来源**：产品规划（诸天流/无限流/快穿/修仙多界等多世界题材支持）

一个项目可以管理多个独立世界，每个世界拥有自己的世界观、力量体系、地理和角色。默认关闭，开启后才出现多世界相关 UI，单世界用户完全无感。

**核心能力**：

- **多世界开关**：项目概况页一个开关，默认关闭。开启时自动把现有世界观/力量/地理数据归属到「主世界」
- **世界总览面板**：管理多个世界（增删改排序）、世界列表、穿越总览表格、世界关系
- **世界详情**：编辑世界基础信息（名称/类型/图标/预计章节）+ 穿越规则（进入条件/能力限制/可带走物品）
- **世界切换器**：世界观三面板、地理、力量体系、世界地图面板顶部，一键切换查看/编辑不同世界的设定
- **角色世界归属**：角色可标记属于某个世界或「跨世界」（主角等），角色面板按世界过滤
- **大纲世界标签**：每卷可指定所属世界，列表显示世界图标
- **世界地图按世界隔离**：每个世界有自己的世界树和地图，切换世界组整套地图跟随切换；地图 AI 生成读取当前世界的地理设定（修复了地图 AI 上下文未绑定所属世界的隐患）
- **AI 按世界生成**：生成某世界的世界观 / 章节 / 地图时，自动仅读取该世界的上下文，互不混淆
- **AI 建议世界**：写下整体故事概念，AI 建议 2-4 个差异化的世界，勾选采纳
- **AI 扩写世界观**：给世界一句话草稿，AI 参考其他世界扩展出完整世界观（避免雷同）
- **世界关系**：定义世界间的传送门/飞升通道/召唤/分支等连接
- **导入导出**：JSON 导出/导入完整保留多世界数据及其关联

**实现分期**：A 数据地基 → B 管理 UI → C 数据隔离 → D AI 全链路 → E 世界关系 → 地图打通

**改动文件**：
| 操作 | 文件 |
|------|------|
| 新增 | `src/lib/types/world-group.ts` — WorldGroup/WorldGroupLink 类型 |
| 新增 | `src/stores/world-group.ts` — 世界组 Store（CRUD/级联删除/迁移） |
| 新增 | `src/lib/ai/world-group-context.ts` — 当前世界/全世界上下文构建 |
| 新增 | `src/lib/ai/world-group-ai.ts` — AI 建议/扩写适配器 |
| 新增 | `src/components/world-group/WorldGroupOverview.tsx` — 世界总览 |
| 新增 | `src/components/world-group/WorldGroupDetail.tsx` — 世界详情 |
| 新增 | `src/components/world-group/WorldGroupSwitcher.tsx` — 世界切换器 |
| 修改 | `src/lib/db/schema.ts` — DB v22（worldGroups/worldGroupLinks 表） |
| 修改 | `src/lib/types/{project,worldview,character,outline,geography,history}.ts` — 增加 worldGroupId 等字段 |
| 修改 | `src/lib/export/json-export.ts` — v3 导出导入世界组 |
| 修改 | `src/stores/{worldview,_factories,project}.ts` — 按世界加载/保存 |
| 修改 | `src/components/worldview/{WorldviewOrigin,Natural,Humanity,PowerSystem}Panel.tsx` — 接入切换器 |
| 修改 | `src/components/geography/GeographyPanel.tsx` — 接入切换器 |
| 修改 | `src/components/character/CharacterPanel.tsx` — 世界过滤器 + 归属 |
| 修改 | `src/components/outline/OutlinePanel.tsx` — 卷世界标签 + 按世界生成 |
| 修改 | `src/components/editor/ChapterEditor.tsx` — 按卷所属世界注入上下文 |
| 修改 | `src/components/project/ProjectInfoPanel.tsx` — 多世界开关 |
| 修改 | `src/lib/ai/prompt-seeds.ts` — world-group.suggest/expand seed |
| 修改 | `src/components/layout/{Sidebar,sidebar-tree}.ts(x)` — 世界总览入口 |
| 修改 | `src/stores/world-node.ts` — 世界树按世界组隔离（loadNodes/ensureRootWorld 加 worldGroupId） |
| 修改 | `src/components/geography/WorldMapPanel.tsx` — 世界地图按世界组隔离 + 地图AI读当前世界设定 |

---

## 2026-06-01

### Bugfix — 三个社区反馈 bug 修复

**来源**：社区用户 zzjj、AWUAWU 反馈

**1) 灵感反推采纳世界观后内容不显示**
- 原因：AI 输出的 JSON 字段（`summary/geography/society/rules`）是旧废字段，世界观三面板使用的是 v3 字段（`worldOrigin/continentLayout` 等），采纳后数据写入了无人显示的字段
- 修复：重新设计 AI 输出结构，直接输出 7 个 v3 字段（世界来源/力量层次/地貌分布/气候环境/世界历史/种族/势力），采纳后正确写入世界观
- 同步更新 UI 展示为 7 个对应标签

**2) 世界地图 AI 生成完成后页面不更新/卡住**
- 原因：AI 返回的地图参数 JSON 解析失败时，异常被 `catch` 吞掉只打了 `console.error`，用户看到"推理完成但地图不出来"
- 修复：解析失败时在 UI 显示红色错误提示，告知用户重试

**3) AI 生成信仰体系后无法正确拆分到三个子字段**
- 原因：`handleAccept` 用正则表达式拆分 AI 输出文本，AI 输出格式不固定时正则失配，整段内容全部塞进「信仰层级」一个字段
- 修复：改用**第二次 AI 调用**做结构化拆分（输出 JSON：divineRank / divineNames / divineRules），拆分期间显示 loading 提示

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/ai/prompt-seeds.ts` | 灵感反推 prompt 输出结构改为 7 个 v3 世界观字段 |
| `src/lib/ai/inspiration-reverse.ts` | `ReverseWorldview` 接口和解析逻辑对齐 v3 字段 |
| `src/components/project/InspirationPanel.tsx` | 采纳逻辑写入正确字段 + 更新展示标签 |
| `src/components/geography/WorldMapPanel.tsx` | 地图参数解析失败时显示错误提示 |
| `src/components/worldview/WorldviewOriginPanel.tsx` | 信仰体系拆分改用 AI 调用代替正则 |

---

## 2026-05-29

### Hotfix — 全局AI上下文互注（世界观 ↔ 各独立面板）

**来源**：社区用户（买辣椒）反馈世界观各模块 AI 生成的内容互不关联、缺乏逻辑一致性

**问题**：世界观三面板互不读取；地理面板AI概念地图不读世界观自然环境；历史年表AI考证/头脑风暴不读世界观设定。各模块AI生成内容互相矛盾。

**修复**：

**1) 世界观三面板上下文闭环**
- 世界起源 `buildCtx` 注入自然环境（世界结构/地貌/气候）+ 人文环境（历史线/种族/势力）
- 自然环境 `buildCtx` 注入世界起源（世界来源/力量层次）+ 人文环境（历史线/种族/势力）
- 人文环境原已读取跨面板数据，无需改动

**2) 地理面板AI概念地图注入世界观**
- `buildConceptMapPrompt` 自动提取世界来源、世界结构、地貌分布、山川水系、气候环境、重镇分布，附加到概述中传给AI

**3) 历史年表AI注入世界观**
- 事件考证和关键词头脑风暴的 `userPrompt` 自动附加世界观关键字段：世界来源、力量层次、世界历史线、世界大事记、种族与民族、势力分布、历史总述、纪年体系

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/components/worldview/WorldviewOriginPanel.tsx` | `buildCtx` 增加 Natural + Humanity 关键字段注入 |
| `src/components/worldview/WorldviewNaturalPanel.tsx` | `buildCtx` 增加 Origin + Humanity 关键字段注入 |
| `src/lib/ai/adapters/geography-adapter.ts` | `buildConceptMapPrompt` 注入 worldview 自然环境上下文 |
| `src/components/history/HistoryPanel.tsx` | 两个 AI 调用注入 worldview 上下文 |

---

### Hotfix — 深色主题输入框白底修复

**问题**：`bg-bg-input` CSS 类在 tailwind 配置中不存在，导致灵感反推和角色驱动剧情面板的 textarea/select 在非默认主题下显示白色背景。

**修复**：统一替换为 `bg-bg-base`（6处）。

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/components/project/InspirationPanel.tsx` | 2 处 `bg-bg-input` → `bg-bg-base` |
| `src/components/outline/CharacterDrivenPlotPanel.tsx` | 4 处 `bg-bg-input` → `bg-bg-base` |

---

### Phase 26.4 — 灵感反推入口

**来源**：社区用户反馈

从碎片灵感反推完整故事框架——写下一句话、几个关键词甚至一个模糊想法，AI 自动反向推演出世界观、故事核心和初始角色。

**新增内容**：

- **灵感输入**：大文本框，支持任意形式的碎片灵感——一句话、关键词组合、场景描写、角色概念等都行。可选补充说明（风格、要求等）
- **AI 反向推演**：AI 从灵感出发反推完整故事框架，自动生成：
  - 世界观草稿：精华摘要 + 地理环境 + 社会结构 + 世界规则
  - 故事核心：一句话故事 + 主题 + 核心冲突 + 情节模式 + 主线概述
  - 初始角色卡：2-5 个关键角色，含名字、定位、简介、性格、背景、动机、弧光
- **结构化预览**：三大模块（世界观/故事核心/角色）独立展示，可展开折叠查看详情
- **分模块采纳**：每个模块独立采纳按钮，角色支持逐个勾选。采纳后直接写入对应数据存储
- **一键全部采纳**：一键把所有生成内容写入世界观、故事设计、角色库
- 侧边栏著作信息下新增「灵感反推」入口

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/ai/inspiration-reverse.ts` | 新增：prompt 构建 + AI 输出解析（世界观/故事核心/角色结构化） |
| `src/components/project/InspirationPanel.tsx` | 新增：灵感输入 + AI 生成 + 三模块预览 + 分模块/一键采纳 |
| `src/lib/types/prompt.ts` | `PromptModuleKey` 增加 `inspiration.reverse` |
| `src/lib/ai/prompt-seeds.ts` | 新增灵感反推 seed（反推策划师角色 + JSON 输出格式） |
| `src/components/layout/sidebar-tree.ts` | 侧边栏著作信息下新增 `inspiration` 叶子 |
| `src/pages/WorkspacePage.tsx` | 注册 `InspirationPanel` |

---

### Phase 26.3 — 角色驱动剧情模式

**来源**：社区用户反馈

从角色弧光反推情节大纲——用户设定角色的「起始状态」和「目标状态/结局」，AI 自动推演中间情节并生成结构化的卷/章大纲。

**新增内容**：

- **角色弧光设定面板**：从项目角色库中选择角色，为每个角色填写起始状态和目标状态描述。支持「自动填充」从角色卡已有的背景故事和弧光字段预填
- **AI 剧情推演**：AI 分析多个角色从起点到终点的必经转变，设计触发事件和交叉点，生成完整的卷/章大纲。自动注入世界观、故事核心、世界规则约束等上下文
- **结构化预览**：AI 输出解析为卷/章树形结构，每章显示标题、摘要、关键角色、弧光推进说明。支持展开/折叠、全选/单选
- **一键导入大纲**：选中的卷可批量写入大纲系统，章节摘要自动包含角色弧光推进标注
- **额外要求输入**：用户可补充约束（如卷数限制、侧重方向、感情线要求等）
- 新增 prompt seed：`plot.character-driven`（角色弧光分析 → 多角色交织 → 冲突层次递进）
- 侧边栏创作区新增「角色驱动」入口（Drama 图标）

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/ai/character-driven-plot.ts` | 新增：prompt 构建（角色弧光格式化 + 已有大纲注入）+ AI 输出解析 |
| `src/components/outline/CharacterDrivenPlotPanel.tsx` | 新增：角色弧光设定 + AI 生成 + 结果预览 + 导入大纲 |
| `src/lib/types/prompt.ts` | `PromptModuleKey` 增加 `plot.character-driven` |
| `src/lib/ai/prompt-seeds.ts` | 新增角色驱动剧情 seed（系统提示 + 用户模板） |
| `src/components/layout/sidebar-tree.ts` | 侧边栏创作区新增 `character-driven-plot` 叶子 |
| `src/pages/WorkspacePage.tsx` | 注册 `CharacterDrivenPlotPanel` |

---

### Phase 30.5 — 导入去重增强

**来源**：社区用户反馈

导入大文档时自动过滤重复内容，避免多块解析产生的冗余数据。全部本地计算，无需 AI 调用。

**新增内容**：

- **世界观句子级去重**：将新块解析出的世界观文本按句子拆分，与已有内容逐句比较（使用 bigram Jaccard 相似度），过滤相似度 ≥ 70% 的重复句子，只追加真正新增的信息
- **角色同名自动合并**：导入角色前检查项目中是否已有同名角色（支持精确匹配和去标点/空格的模糊匹配），同名角色不重复创建而是将新信息追加到已有角色卡的各字段中
- **大纲标题去重**：写入大纲节点前检查同层级是否已有相似标题的节点（bigram 相似度 ≥ 80%），重复节点跳过创建，但如果已有节点缺少摘要而新节点有，会自动补充

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/import/dedup.ts` | 新增：三类去重工具（世界观句子去重、角色同名检测+合并、大纲标题去重） |
| `src/lib/import/chunk-writer.ts` | 世界观写入改为句子级去重追加；角色写入增加同名检测+合并；大纲写入增加标题去重 |

---

### Phase 28.4 — 导入分卷支持

**来源**：社区反馈

导入大文档时自动识别卷标题，创建正确的卷→章层级大纲结构。

**新增内容**：

- **本地分卷检测**：纯正则扫描全文，识别卷标题（第X卷/部/篇、卷X、【第X卷】）和章标题（第X章/回/节、Chapter N），构建层级结构
- **确认弹窗结构预览**：点击"开始解析"后的确认弹窗中新增「📖 检测到文档结构」区域，显示卷数、章数，可展开查看完整的卷→章树形结构
- **自动创建卷骨架**：确认导入时，如果检测到分卷，先创建空的卷节点写入大纲
- **AI 章节智能挂载**：AI 分块解析出的章节自动匹配已有的同名卷节点，挂载为子节点；支持模糊匹配（标题包含关系）
- **卷摘要补充**：如果 AI 解析出了卷摘要而已有卷为空，自动补充
- **卷去重**：如果 AI 解析出的卷名与已有卷重复，跳过创建，避免重复

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/import/volume-detector.ts` | 新增：卷/章正则检测、层级结构构建 |
| `src/lib/import/chunk-writer.ts` | 增强：写入大纲时匹配已有卷、子章节挂载 |
| `src/components/system/ImportDocPanel.tsx` | 增加分卷检测 + 预写卷骨架逻辑 |
| `src/components/system/import/ImportConfirmModal.tsx` | 新增分卷结构预览 UI |

---

### Phase 30.2 — 角色关系自动提取

**来源**：社区用户反馈

新增 AI 一键提取角色关系功能。AI 会自动读取项目的大纲摘要和章节正文，分析其中涉及的角色互动，输出结构化的关系数据。

**新增内容**：

- **AI 提取按钮**：角色关系面板顶部新增「AI 提取」按钮，点击后 AI 自动分析文本内容
- **智能数据源**：自动汇总大纲摘要 + 章节正文（前 ~8000 字），作为 AI 分析素材
- **角色名智能匹配**：AI 返回的角色名自动与已有角色卡匹配（精确匹配 + 包含匹配 + 去姓匹配）
- **去重检测**：自动检测与已有关系重复的条目，标记为「已存在」
- **预览面板**：提取完成后展示所有发现的关系，每条显示角色对、关系类型、标签、描述。用户可勾选要导入的关系，批量写入
- **支持的关系类型**：亲属、恋人、朋友、对手、敌人、师父、弟子、盟友、上下级、其他
- **新增 prompt seed**：`relation.extract`（内置角色关系分析 system prompt）

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/ai/relation-extractor.ts` | 新增：prompt 构建、JSON 解析、角色匹配、去重逻辑 |
| `src/lib/types/prompt.ts` | `PromptModuleKey` 增加 `relation.extract` |
| `src/lib/ai/prompt-seeds.ts` | 新增关系提取 seed（system prompt + user template） |
| `src/components/relations/CharacterRelationPanel.tsx` | 新增 AI 提取按钮 + 流式提取 + 预览/勾选/批量导入面板 |

---

## 2026-05-28

### Phase 33 — NVIDIA NIM API 接入

**来源**：社区反馈（用户「长耳朵兔子」）

为 StoryForge 新增 NVIDIA NIM 作为 AI 提供商。NVIDIA NIM 平台托管了多家开源大模型（Llama、DeepSeek、Qwen、Gemma、Mistral 等），使用 OpenAI 兼容协议，用户可通过 NVIDIA 账号获取 API Key 后直接使用。

**新增内容**：

- **AI 提供商**：`AIProvider` 类型新增 `'nvidia'`
- **预置模型**（7 个）：
  - `meta/llama-3.3-70b-instruct` — Llama 3.3 70B（默认推荐）
  - `meta/llama-3.1-405b-instruct` — Llama 3.1 405B（最强开源模型）
  - `meta/llama-3.1-70b-instruct` — Llama 3.1 70B
  - `deepseek-ai/deepseek-r1` — DeepSeek R1 推理模型
  - `qwen/qwen2.5-72b-instruct` — 通义千问 2.5 72B
  - `google/gemma-2-27b-it` — Google Gemma 2 27B
  - `mistralai/mistral-large-2-instruct` — Mistral Large 2
- **本地代理**：vite dev server 新增 `/nvidia-proxy` → `https://integrate.api.nvidia.com` 转发规则，解决浏览器 CORS 限制
- **设置面板**：NVIDIA NIM 选项（带 CORS 警告标记），支持一键「切换到本地代理」/「恢复直连」
- **零改动兼容**：NIM 完全兼容 OpenAI `/v1/chat/completions` 协议，`client.ts` 的 `buildRequest` + SSE 流式解析无需任何修改，`stream_options` 默认支持

**改动文件**：
| 文件 | 改动 |
|------|------|
| `src/lib/types/ai.ts` | `AIProvider` 增加 `'nvidia'`；`PROVIDER_MODELS` 增加 7 个模型；`PROVIDER_PRESETS` 增加默认 baseUrl 和模型 |
| `vite.config.ts` | `server.proxy` 增加 `/nvidia-proxy` 规则 |
| `src/components/settings/AIConfigPanel.tsx` | `PROVIDER_OPTIONS` 增加 NVIDIA NIM；`PROXY_MAP` 增加代理映射 |

---

### Phase 32 — 真实与幻想（世界规则体系）

**来源**：内部审查，取代旧的 `creativeMode` 二选一模式

将历史考证从「项目级二选一开关（fantasy/historical）」彻底重构为「维度级约束声明」系统。用户可在 15 个大类、约 50 个子类的任何维度上独立声明哪些内容取自真实历史、哪些是架空改造，AI 生成时自动遵守所有约束。

#### 32.1 — 数据模型 + DB v21

- 新增 `WorldRulesProfile` 类型：包含 `entries`（每节点的规则条目）、`customNodes`（用户自定义节点）、`globalNote`（全局补充说明）
- `WorldRuleEntry` 结构：`historicalAnchors`（真实锚点文本）、`fictionalAdaptations`（架空改造文本）、`priority`（冲突优先级：history-first / fiction-first / balanced）
- 三级树：15 个 L1 大类（时代背景、重大事件、地理疆域、气候环境、政治制度、军事、经济、社会结构、科技生产力、文化思想、宗教信仰、民族族群、语言称谓、日常生活、力量与超自然），每个 L1 包含 2-6 个 L2 子类，L3 为提示标签
- DB 升级到 v21，新增 `worldRulesProfiles` 表（每项目一条记录，singleton 模式）

**新增文件**：`src/lib/types/world-rules.ts`

#### 32.2 — Store（singleton 模式）

- Zustand store：`useWorldRulesStore`
- 方法：`loadProfile` / `getEntry` / `updateEntry` / `deleteEntry` / `updateGlobalNote` / `addCustomNode` / `updateCustomNode` / `deleteCustomNode` / `filledCount`
- `_persist` 内部方法自动同步到 IndexedDB

**新增文件**：`src/stores/world-rules.ts`

#### 32.3 — 规则清单生成器

- `buildWorldRulesManifest(profile, options)`：从所有 entries 生成结构化文本清单
  - 按 L1 分组，L2 缩进展示
  - 📜 真实锚点 + ✨ 架空改造 + ⚖️ 冲突优先级
  - 可选注入历史年表锚点（`⚓ 时间线锚定`）和历史关键词
  - 全局补充说明追加到末尾
  - 末尾添加 AI 行为约束指令
- `estimateManifestTokens(text)`：Token 估算（字符数 × 0.6）
- `buildWorldRulesContext(projectId)`：一站式读取 DB（profile + 历史年表 + 历史关键词）→ 生成清单，所有 AI prompt 统一调用此函数

**新增文件**：`src/lib/ai/world-rules-manifest.ts`

#### 32.4 — WorldRulesPanel UI

- 三栏布局：L1 导航列表（左）→ L2 子类列表（中）→ 编辑区（右）
- 编辑区包含：📜 真实锚点文本框 + ✨ 架空改造文本框 + ⚖️ 冲突优先级三选一
- L3 提示标签以灰色 tag 形式展示在编辑区
- 已填节点显示绿色圆点标记
- 底部「规则清单预览」：实时生成 manifest 文本 + Token 估算
- 全局补充说明编辑器
- 用户可新增 L1 大类和 L2 子类（自定义节点），支持删除

**新增文件**：`src/components/worldview/WorldRulesPanel.tsx`

#### 32.5 — 世界观三面板去除二选一 toggle

- **WorldviewOriginPanel**（世界起源）：
  - 删除 `creativeMode` 导入和状态管理
  - 合并 `FANTASY_FIELDS` / `HISTORICAL_FIELDS` 为统一 `FIELDS` 数组
  - 标签统一化（如「神明设定」+「宗教与民间信仰」→「神明与信仰」）
  - AI 生成注入 `worldRulesContext`
- **WorldviewNaturalPanel**（自然环境）：同上模式改造
- **WorldviewHumanityPanel**（人文环境）：同上模式改造
- **WorldviewPanel**（世界观总览/旧入口）：
  - 删除模式切换 UI 和 `handleModeChange`
  - 统一使用单一 `DIMENSIONS` 数组
  - AI 生成注入 `worldRulesContext`

**改动文件**：4 个 Panel 组件

#### 32.6 — 下游 prompt 全面改造

- **prompt-seeds.ts**（3 个 system prompt + 4 个 user template）：
  - 删除所有 `{{#if (eq creativeMode "historical")}}...{{else}}...{{/if}}` Handlebars 分支
  - 替换为统一的 `{{#if worldRulesContext}}` 约束注入块
  - `variables` 数组：移除 `creativeMode` / `historicalContext`，新增 `worldRulesContext`
- **outline-adapter.ts**：
  - `buildVolumeOutlinePrompt` / `buildChapterOutlinePrompt` 参数从 `historicalContext + creativeMode` 改为 `worldRulesContext`
- **batch-outline-runner.ts**：
  - `BatchOutlineOptions` 接口同步更新

**改动文件**：`prompt-seeds.ts`、`outline-adapter.ts`、`batch-outline-runner.ts`、`OutlinePanel.tsx`

#### 32.7 — 侧边栏 + 路由

- 侧边栏世界观子树第一项新增「⚖️ 真实与幻想」（使用 lucide-react 的 `Scale` 图标）
- `WorkspacePage` 注册 `world-rules` → `WorldRulesPanel`
- 项目加载时并行调用 `useWorldRulesStore.getState().loadProfile(pid)`

**改动文件**：`sidebar-tree.ts`、`WorkspacePage.tsx`

#### 32.8 — 历史年表锚点标识

- `HistoryPanel.tsx` 中的历史事件标签视觉升级：
  - `isHistorical: true` 的事件：标签从「史实」改为「⚓ 史实锚点」，新增「AI 不可违反」红色提示文字
  - `isHistorical: false` 的事件：标签从「虚构/架空」改为「✨ 虚构/架空」
- 与世界规则清单联动：`buildWorldRulesManifest` 自动读取 `isHistorical=true` 的年表事件作为时间线锚点

**改动文件**：`HistoryPanel.tsx`

#### 32.9 — 数据迁移（旧项目兼容）

- `world-rules.ts` store 的 `loadProfile` 方法：首次创建 profile 时自动检测 `project.creativeMode === 'historical'`
- 如果是旧的历史考证项目，自动填充 `globalNote` 迁移提示文字，引导用户在各维度中重新设定真实与架空规则
- 非历史项目不受影响（`globalNote` 为空）

**改动文件**：`world-rules.ts`

#### 32.10 — 编译验证

- `npx tsc --noEmit` 零错误
- `npm run build` 成功，主 bundle 2630 KB（较改造前 2643 KB 减小 13 KB，因删除了大量重复字段定义和模式切换代码）

---

**Phase 32 完整文件变更清单**：

| 操作 | 文件 |
|------|------|
| 新增 | `src/lib/types/world-rules.ts` |
| 新增 | `src/stores/world-rules.ts` |
| 新增 | `src/lib/ai/world-rules-manifest.ts` |
| 新增 | `src/components/worldview/WorldRulesPanel.tsx` |
| 修改 | `src/lib/db/schema.ts` — v21，新增 `worldRulesProfiles` 表 |
| 修改 | `src/lib/types/index.ts` |
| 修改 | `src/lib/types/project.ts` — deprecated `creativeMode` |
| 修改 | `src/lib/ai/context-builder.ts` |
| 修改 | `src/lib/ai/prompt-seeds.ts` — 3 个 system + 4 个 user template |
| 修改 | `src/lib/ai/adapters/outline-adapter.ts` |
| 修改 | `src/lib/ai/batch-outline-runner.ts` |
| 修改 | `src/components/worldview/WorldviewPanel.tsx` |
| 修改 | `src/components/worldview/WorldviewOriginPanel.tsx` |
| 修改 | `src/components/worldview/WorldviewNaturalPanel.tsx` |
| 修改 | `src/components/worldview/WorldviewHumanityPanel.tsx` |
| 修改 | `src/components/outline/OutlinePanel.tsx` |
| 修改 | `src/components/history/HistoryPanel.tsx` |
| 修改 | `src/components/layout/sidebar-tree.ts` |
| 修改 | `src/pages/WorkspacePage.tsx` |

## v2.0.0 — 2026-05-26 · Phase A-H 全量进化

> 一次性实现 8 个大版本（Phase A → H），覆盖记忆系统、故事线、伏笔增强、大纲强化、题材风格、质量控制、角色增强、导出优化共 25+ 个子功能模块。

---

### Phase A — 三层记忆系统

| 子模块 | 说明 |
|---|---|
| **A1 状态表自动提取** | AI 生成正文后自动提取角色/地点/物品/势力的状态变更（StateDiffModal 支持跳过） |
| **A2 三层记忆架构** | Working Memory（当前章节+近3章摘要）、Episodic Memory（状态卡+事件+关系变动）、Semantic Memory（世界观+角色+故事线+伏笔），按任务类型分配 token 预算 |
| **A3 章节摘要** | AI 自动生成 100-200 字章节摘要，用于 Working Memory 注入 |
| **A4 事件时间线** | 状态表新增"时间线"视图，事件按章节时间轴展示 |
| **A5 情感节拍卡** | 每章自动分析情绪走向，生成情感节拍可视化 |

**新增文件**：`memory-builder.ts` · `summary-adapter.ts` · `EventTimeline.tsx`

---

### Phase B — 全局故事线

| 子模块 | 说明 |
|---|---|
| **B1 数据模型** | `StoryArc`（主线/支线）→ `StoryStage[]`（阶段，含关键事件、转折点） |
| **B2 故事线面板** | Tab 切换多条线、手动添加/AI 生成、阶段卡编辑、进度条可视化 |
| **B3 上下文注入** | `buildStoryArcContext()` 自动注入 AI 写作 prompt |

**新增文件**：`story-arc.ts`(类型) · `story-arc.ts`(store) · `story-arc-adapter.ts` · `StoryArcPanel.tsx`

---

### Phase C — 伏笔系统增强

| 子模块 | 说明 |
|---|---|
| **C1 逾期检测** | `getOverdue()` / `getUpcoming()` / `computeUrgency()` — 自动判断 critical/high/medium/low |
| **C2 伏笔上下文注入** | `buildForeshadowContext()` — 按章节生成 [埋设]/[回收]/[呼应]/[逾期!] 标记注入 prompt |
| **C3 AI 伏笔建议** | `buildForeshadowSuggestPrompt()` — 根据故事线+已有伏笔+大纲建议 3-5 个新伏笔 |

**新增字段**：`expectedResolveChapterId` · `importance` · `urgency`

---

### Phase D — 大纲流程强化

| 子模块 | 说明 |
|---|---|
| **D1 批量生成** | `batch-outline-runner.ts` — 按卷循环生成章节大纲，前一卷摘要自动作为下一卷上下文，支持进度条和中途取消 |
| **D2 细纲增强** | `DetailedOutline` 新增 6 字段：开头衔接 / 结尾悬念 / 场景地点 / 情绪走向 / 出场角色 / 关联伏笔 |
| **D3 大纲预览** | `OutlinePreview.tsx` — 编辑器内一键查看章节聚合信息（摘要、角色、伏笔、场景列表） |

**新增文件**：`batch-outline-runner.ts` · `OutlinePreview.tsx`

---

### Phase E — 题材模板 + 风格系统

| 子模块 | 说明 |
|---|---|
| **E1 题材元数据** | 20 个题材完整元数据（反模式清单、节奏策略、典型结构），GENRE_PACKS 从 5 扩充到 21 个 |
| **E2 写作风格预设** | 11 个风格预设：金庸武侠 / 古龙 / 张爱玲 / 鲁迅 / 网文爽文 / 纯文学 / 轻小说 / 硬核科幻 / 黑色幽默 / 暗黑哥特 / 现代极简 |
| **E3 创作方法论** | 5 种方法论：雪花法 / 英雄之旅(12阶段) / 三幕式 / 起承转合 / 救猫咪节拍表(15节拍) |

**新增文件**：`genre-metadata.ts` · `writing-styles.ts` · `methodology.ts`  
**新增字段**：`Project.writingStyleId` · `Project.methodologyId`

---

### Phase F — 质量控制三件套

| 子模块 | 说明 |
|---|---|
| **F1 章节审校** | 五维检测（逻辑一致性 / 人物行为 / 世界观 / 伏笔衔接 / 情节节奏），0-100 评分 + 逐条问题定位 |
| **F2 去AI味增强** | 五维检测（词汇 / 句法 / 叙事 / 情感 / 对话）+ 高频词统计，输出"人味指数" |
| **F3 追读力评估** | 四维评估（悬念钩子 / 爽点 / 微兑现 / 节奏），0-100 追读力评分 + 亮点&薄弱分析 |

**新增文件**：`review-adapter.ts` · `anti-ai-adapter.ts` · `readability-adapter.ts` · `ReviewPanel.tsx`

---

### Phase G — 角色 + 设定增强

| 子模块 | 说明 |
|---|---|
| **G1 角色动态状态** | `getCharacterState()` — 从状态卡实时获取角色当前位置、实力、持有物品等 |
| **G2 出场章节追踪** | `Character` 新增 `firstAppearChapterId` / `activeChapterRange` / `exitChapterId`，AI 写作时自动过滤未出场/已退场角色 |

**新增字段**：`Character.firstAppearChapterId` · `Character.activeChapterRange` · `Character.exitChapterId`

---

### Phase H — 导出 + 体验优化

| 子模块 | 说明 |
|---|---|
| **H1 HTML 导出** | 带样式排版的单页 HTML（宋体排版 + 目录 + 角色设定 + 世界观），可选包含内容 |
| **H3 便签系统** | 6 色便签 + 置顶 + 章节关联，编辑器侧边快速查阅，DB v17 新增 `notes` 表 |

**新增文件**：`html-builder.ts` · `note.ts`(类型) · `note.ts`(store) · `NotePanel.tsx`

---

### 编辑器工具栏新增

编辑器顶部新增三个切换按钮：

| 按钮 | 功能 |
|---|---|
| 📖 **大纲预览** | 展开当前章节的聚合信息面板（D3） |
| 🛡 **质量审校** | 展开审校/去AI味/追读力三合一面板（F） |
| 📝 **便签** | 展开便签面板，支持本章/全局/全部筛选（H3） |

---

### 数据库变更

- **v16**：新增 `storyArcs` 表
- **v17**：新增 `notes` 表
