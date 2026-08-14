# StoryForge 当前能力基线

> 本文件回答“项目现在已经有什么”。新体系或完整功能开工前读取对应体系的事实层，不是未来计划，也不是历史流水账。
>
> 事实来源优先级：当前代码与测试 > `MASTER-BLUEPRINT.md` > `docs/ROADMAP-LEGACY.md` 中的完成记录。文档声称完成但缺少代码/测试证据时，按“部分完成”处理，不得据此重新开发或宣称已交付。

## 如何使用

开始新体系或完整功能前，必须先找到对应体系并读取本节相关内容，完成以下核对：

1. 现有能力是否已经覆盖用户故事的一部分。
2. 哪些代码、注册表、表和测试应直接复用。
3. 本次只增加什么，不增加什么。
4. 哪些历史入口必须下线，哪些兼容字段必须保留。

如果本文件与代码不一致，应先开治理任务更新基线；不得直接以新代码“顺便修正文档”。

## GOV-1 架构、质量与发布治理

### 已有能力

- `CONTEXT_SOURCES` + `assembleContext()` 统一 AI 读取；当前上下文注册表已有多种 scope、预算和优先级。
- `FIELD_REGISTRY` + `ADOPTION_SCHEMA` + `adopt()` 统一 AI 结构化写回。
- `PROJECT_TABLES` 驱动表生命周期、导出/导入、级联删除、世界作用域和引用重映射。
- `check:architecture` 覆盖 UI 与 `src/lib/**` 的受治理写回、旧 context builder 和领域扩展复审；检查器带 AST 自测，避免自身假绿。
- AI Manual 用 TypeScript AST 扫描真实 Prompt 源文件，并由运行时测试独立核对 key 唯一性、模板元数据和数字预算。
- 参考分析写回已进入 `FIELD_REGISTRY`、`ADOPTION_SCHEMAS`、`adopt()`；事实账本和角色合并是显式、有复审日期的领域扩展。
- 生产依赖审计、真实运行时代码覆盖率、源码可达性、Blueprint 实时规模和 bundle budget 已进入 CI。
- UI 用 package 语义版本 + commit build SHA 标识每次生产构建；Release tag / changelog 仍由发布闸门三方校验。
- 数据迁移、导入导出、备份、删除和关键 UI 流程已有大量回归测试。
- `AGENTS.md` 是自包含短入口，`docs/CONTEXT-ROUTING.md` 按任务类型定位关联文档、源码与测试；`check:agent-context` 防止恢复长文档固定预载，并量化固定项目输入。

### 持续治理边界

- `ChapterEditor` 仍是复杂度热点；后续按保存、上下文、AI 和连续性 controller 的稳定边界继续拆，不能为降行数搬运复杂度。
- AI runner / parser / import 的覆盖已设分层防退化门槛，但低覆盖文件仍应随相关功能开发补关键路径测试。
- Playwright 商业 smoke、升级前自动快照和第三方匿名错误上报仍分别归 `AUDIT-7` / PRODUCT-1；涉及隐私或产品决策的内容不能擅自启用。
- 依赖、例外复审日期和 Blueprint 指标是持续门槛，P1 完成不代表以后可以停止维护。
- 上下文治理只减少重复和无关输入，不能用作跳过三注册表、数据生命周期、调用方扫描、专项测试或真实项目验证的理由。

### 新功能必须复用

- 新 AI 读：`src/lib/registry/context-sources.ts`、`assemble-context.ts`。
- 新 AI 写：`src/lib/registry/field-registry.ts`、`adoption-schema.ts`、`adopt.ts`。
- 新表/字段生命周期：`src/lib/registry/project-tables.ts`、`src/lib/db/schema.ts`。

## INV-1 角色物品与状态账本

### 已有能力

- `itemLedger` 以 `heldByName` + `characterId` 同时保存原文持有人与角色软引用；`adopt()` 会在名称唯一匹配时解析角色 ID，未匹配仍保留原名。
- 物品栏按 `roleWeight` 分组切换主要/次要/NPC/路人背包；全部角色视图不会合并不同角色的同名物品，状态卡逐角色投影同一账本。
- 抽取 Prompt 明确排除目标、提及、传闻、假设和无主物品，并把角色间转移拆成原持有人消耗 + 新持有人获得。
- `CONTEXT_SOURCES`、持有投影和确定性重复获得检查均支持角色归属；审校会用角色名单避免把 A 的物品误报给 B。
- v38 将 owner-less 历史流水迁到唯一 `roleWeight=main` 角色，旧库才回退 `role=protagonist`；多 main/无主角进入可认领的历史未归属区，迁移异常会整体回滚。
- 角色删除在同一事务中 NULL 化 `characterId` 并保留 `heldByName`；角色合并同时重映射 ID 与 canonical 名称；导出/导入会重映射角色 ID。
- `QUICKWIN-3` 已并入：可选全部已写章节或按规范章序选择起止章；反向/空范围在 API 调用前拦截，范围外流水不受影响。

### 禁止重复建设

- 不新建第二套物品表或第二套持有投影。
- 不在 `InventoryPanel` 内手写 AI 提取器、去重或上下文拼接。
- 不删除角色对应的物品流水；删除角色只解除硬引用并保留持有人原文。

### 代码与测试入口

- `src/lib/consistency/held-items.ts`
- `src/lib/registry/context-sources.ts`
- `src/lib/registry/adoption-schema.ts`
- `src/lib/registry/project-tables.ts`
- `src/lib/inventory/extraction-range.ts`
- `src/components/items/InventoryPanel.tsx`
- `tests/regression/R-CONSISTENCY1-held-items.test.ts`
- `tests/regression/R-QUICKWIN2-inventory-edit.test.ts`
- `tests/regression/R-QUICKWIN3-inventory-extraction-range.test.ts`
- `tests/regression/R-INV1-*.test.ts`

## CANON-1 长期一致性与 Canon

### 已有能力

- 章节规范顺序、连续性交接、章节记忆、计划对账和未来章节过滤已有实现。
- `temporalFacts`、受控谓词、当前有效事实、事实候选确认、异常状态和 human-readable IO 已有代码基础。
- `retrievalChunks`、层级叙事摘要和影响分析已有可重建路径。
- `NS-3` 一致性审查已有 Fast Guard / Deep Audit 和逐字引文回查。
- 物品重复获得与角色认知边界闭集比对是当前两类确定性判决样板。
- `knowledgeLedger` 分离世界真相与角色认知，支持获知、误认、遗忘、纠正事件；v39 迁移、三注册表、角色/章节生命周期和导出导入 FK 重映射已覆盖。
- `characterKnowledge` 按规范章序、世界与角色投影目标章开始前的 confirmed 事件，并进入正文生成上下文；事实库提供角色认知候选、确认/否决和异常复核入口。
- 一致性审校让 LLM 只从已确认 `characterId + knowledgeKey` 闭集提取正文逐字引用，再由代码比较 unknown/mistaken；确定性比对不等于抽取不会漏。
- `CONSISTENCY-3` 复用 `temporalFacts` 而不另造 Canon 表；8 个单值宪法主题和 4 类设定来源受闭集注册表约束，来源 FK 可导出导入、来源字段修改自动 stale。
- 设定抽取只接受登记 sourceKey / predicate / subject 和原文逐字 quote，永远写 candidate；普通确认对同项目、同世界、同分类型主体和同主题异值做确定性阻断，明确取代是独立作者操作且不能覆盖 locked Canon。
- `canonAssertions` 只回注 confirmed 且来源仍有效的宪法，正文、设定、大纲和一致性审校共用；事实库“世界宪法”视图提供扫描、确认、否决、冲突与来源异常出口。
- `CONSISTENCY-0` 已把 6 个 `R-CANON-*` 反例落入 `tests/canon/`；6 个活动测试由 `check:canon-coverage` 与覆盖地图双向对齐，当前无显式 todo。
- 角色存亡以 `temporalFacts.aliveStatus` 为唯一硬事实源：枚举写前归一，confirmed 与时点仍有效的 superseded 历史 Canon 按规范章序投影；审校只接受已死亡角色闭集中的正常活动逐字引用，再由代码硬比对。
- Phase 39 复用 `StoryArc/StoryStage` 静态注册表，v40 动态层保存每线最新作者确认进度和跨线交汇；模型只能对 arc/stage/status 闭集与正文逐字证据提出候选，新线必须由作者明确创建。
- 故事线仪表盘支持选择已写章节映射、逐条采纳、当前阶段/状态与交汇节点展示；确认结果按规范章序进入正文、大纲和一致性审校，未来进度不会泄漏给前章。
- 项目/章节/阶段/故事线删除及 JSON 往返均有明确生命周期：删章保留说明和冗余章名、断 FK；删阶段清悬空指针；删线事务级联动态行；Arc/Chapter 外键导入重映射。

### 当前边界 / 尚未完成

- 世界宪法硬保证只覆盖已登记、已抽取、来源有效且已确认的单值主题；未登记散文、抽取遗漏和复杂条件规则仍属于软审计范围。
- 存亡硬保证只覆盖目标章开始前已确认死亡与正文中的闭集正常活动引用；同章内先死后动、倒叙、附身、借尸和未明确登记的复活仍属于软审计。
- 一致性覆盖地图和 `tests/canon/` 是跨功能的声明基线，`tests/regression/` 继续覆盖具体实现细节；新增 Canon 声明必须先加地图行和可证伪反例，不用删除 `todo` 制造假绿。
- 角色变化影响传播与局部重规划尚未形成统一产品出口；故事线动态进度与交汇已完成。
- 内联编辑器提示尚未把确定性 finding 映射到编辑器装饰层。

### 禁止重复建设

- 不把向量召回或 LLM 软审当作 Canon 判决器。
- 不为 Phase 38、Phase 39、Agent 各建一套事实库。
- 不让语义结果直接修改已采纳正文；未采纳候选只允许按逐字证据定向修订一次，并在硬门和语义复核通过后继续等待作者确认。

### 代码与测试入口

- `src/lib/consistency/`
- `src/lib/fact-ledger/`
- `src/lib/knowledge-ledger/`
- `src/lib/storyline/`
- `src/lib/fact-ledger/setting-assertions.ts`
- `src/lib/registry/canon-assertion-source-registry.ts`
- `src/lib/retrieval/`
- `src/lib/registry/assemble-context.ts`
- `tests/regression/R-NS3-consistency-audit.test.ts`
- `tests/regression/R-NS4-current-facts.test.ts`
- `tests/regression/R-NS5-retrieval.test.ts`
- `tests/regression/R-NS6-impact.test.ts`
- `tests/regression/R-CONSISTENCY3-world-constitution.test.ts`
- `tests/regression/R-CONSISTENCY2-*`
- `tests/canon/R-CANON-*`
- `tests/canon/storyline-progress.test.ts`
- `scripts/check-canon-coverage.mjs`

## PIPE-1 透明生成与质量工作坊

### 已有能力

- `GenerationNode`、输入快照和安全默认不采纳的 `runGenerationNode` 已成为统一运行时薄层。
- 卷纲/章纲四类请求及正文生成/续写支持默认关闭的最终提示词预览与一次性编辑。
- 当前章节页已有五阶段章纲工坊；中间产物瞬态、顺序不可跳、可重做并比较最近版本。
- 工坊质量节点与最终采纳前复用持有物、认知账本和世界宪法闭集 gate；反套路审查保持 advisory。
- 场景卡与不可写清单经 `adopt()` 写入细纲，并由 `detailedOutline` 上下文回注正文。
- 既有 PromptWorkflow step 已适配同一节点接口；模型路由、上下文装配和作者确认写回语义保持不变。

### 当前边界 / 尚未完成

- `GenerationNode` 本身仍不是 durable Harness；实际 `AgentRunner`、run ledger、Context Manifest 与终态回执归 `AGENT-1`，PIPE-1 不复制这些控制面。
- 闭集引用由模型抽取，代码可拒绝伪造 ID/引文和已声明冲突，但不能证明模型没有漏报未声明的语义。
- 工坊历史只保留当前会话最近版本；若未来要求跨会话持久化，必须先登记新表、迁移和导入导出，不得偷写 localStorage。

### 代码与设计入口

- `src/lib/ai/`
- `src/lib/generation/`
- `src/lib/outline/workshop.ts`
- `src/lib/registry/assemble-context.ts`
- `src/components/outline/ChapterOutlineWorkshop.tsx`
- `src/components/settings/prompt/WorkflowRunner.tsx`
- `docs/TRANSPARENT-GENERATION-PIPELINE.md`

## FLOW-2 独立自由节点模式

> 2026-08-04 产品边界：本节记录的能力仍是可复用技术事实，但通用六节点文本 DAG 不等于
> 作者要求的领域节点创作模式，不能再作为节点产品完成证据。后续以
> [`NODE-AUTHORING-MODE-DESIGN.md`](../NODE-AUTHORING-MODE-DESIGN.md) 的 FLOW-3 方案为准，
> 将分步骤模式的世界、故事、角色、大纲、正文和连续性能力映射为同源的可编排节点。

### 已有能力

- FLOW-2 的独立工作区已由 FLOW-3 `NodeAuthoringWorkspace` 接管主入口，不再复用分步骤的
  `PromptWorkflowsPanel`；旧 `NodeModeWorkspace` 与 `PromptWorkflow.graph` 仅作为迁移/兼容实现。
- `nodeFlows` 保存项目级自由图、动态端口、连线、节点配置与视口；未完成图也会自动保存，
  运行前才进行悬空引用、重复边、自环、类型不匹配、必需输入和环路校验。
- 已有自由文本、项目元素、整理合并、自由创作、内容校验、内容输出六类节点；作者可任意
  分支、汇合、增加输入槽、命名语义、设置优先级和逐连线 Token 上限。
- 项目元素节点只经 `CONTEXT_SOURCES → assembleContext()` 选择来源，支持世界/章节作用域、
  来源预算和包含/排除筛选；自由创作仍走统一 AI 客户端、模型路由与用量统计。
- `RAG-1` 已新增独立“资料与检索库”：章节、世界观、故事核心、角色/关系、词条、地点、
  历史、伏笔、参考和物品流水实时投影为可见记录/字段；作者可停用、调权重和字段 token
  上限。稳定资料 ID 随源记录导出，不使用导入后会变化的 Dexie 主键作为节点引用。
- 项目元素节点可在“精确资料 / 注册来源”间切换；精确资料仍经
  `CONTEXT_SOURCES.ragSelection → assembleContext()`，实际纳入、删除/停用省略和预算裁剪
  全部冻结到 `nodeRuns`，资料库可反查最近运行证据。
- 支持运行整图或运行到任意节点；目标节点只执行自己的祖先闭包。`nodeRuns` 在每个节点后
  冻结实际配置、上游内容、来源 included/omitted/trimmed、Token 估算、输出、错误与 gate，
  刷新后仍可检查和编辑。
- 运行或连线不会自动改项目 Canon。只有“内容输出”节点选择明确目标且作者点击确认后，
  才能经 `FIELD_REGISTRY / AdoptionSchema → adopt()` 写入世界来源或新增角色。
- `nodeFlows/nodeRuns` 已登记 `PROJECT_TABLES`，进入项目删除、世界删除、JSON 导出导入和
  ID 重映射生命周期；删除节点图会级联删除运行记录。

### FLOW-3 当前交付边界（2026-08-05）

- FLOW-3A/3B 已接管节点模式主入口，领域节点目录覆盖世界、故事、角色、大纲、正文和控制节点。
  角色档案、卷纲、章纲、细纲和正文节点已接入对应领域的结构化 parser、重复/过期 gate、作用域选择、
  FK 过滤、CAS 和正式采纳；目录与执行器不再存在“模板可见但走泛化 JSON”断层。
- 项目资料概览由 `buildRagLibrary()` 生成实时绑定节点，图 JSON 只保留稳定 `ragDocumentId + fieldKey`
  和绑定元数据；正文仍由 `assembleContext()` 在运行时读取。
- `nodeRuns` 冻结节点配置、实际来源 evidence、source hash 和单字段目标 hash；来源变更会被标记并向
  下游传播，目标 Canon 已变化时采纳会被阻止。相关反例为 `R-FLOW3C-domain-node-sync`。
- 三注册表边界没有扩张：本阶段没有新增 Canon 表、平行上下文入口或旁路写回服务，仍分别复用
  `CONTEXT_SOURCES`、`FIELD_REGISTRY/AdoptionSchema` 和 `PROJECT_TABLES`。
- 领域执行适配层只保存候选所需的目标语义和快照，不复制 Canon 正文；节点级候选数量支持版本选择，
  作者确认后分别写入角色、大纲、细纲或章节既有表。
- 角色档案节点的真实浏览器主路径已通过：生成候选、作者确认采纳并进入角色主档；23 个角色维度节点
  必须绑定稳定资料键，写回时解析当前记录并定点更新，不能落到项目中的第一个角色。
- 节点检查器支持“运行到此节点”，候选区支持多个原始版本对照；相关浏览器证据在
  `tests/e2e/core-workflow.spec.ts`，领域回归为 `R-FLOW3C-domain-specialized-execution`。
- FLOW-3C 官方完整创作链由节点目录派生，覆盖世界来源、故事概念/冲突、角色、卷纲、章纲、细纲、
  正文及卷数/章节数/候选数/字数/温度/输出 token 控制；批量卷章输出与下游候选端口均按 many 合同连接。
- 细纲已与角色/大纲/正文一样支持有界多候选，候选区提供相对当前选择的逐行变化摘要；完整链回归会逐步
  采纳到原有 Canon 表，浏览器验证创建后关键节点可见并在刷新后恢复。
- FLOW-3E 大图效率、模板与可恢复执行已完成：空态可直接创建六个官方模板；百节点画布支持自动布局、
  迷你地图、框选、复制子图、对齐、分组、收藏与最近节点；执行计划冻结调用上限和拓扑顺序，支持暂停、
  取消、同一 `nodeRuns` 断点恢复、过期下游批量重跑和刷新后查看图快照。节点图/运行记录的嵌套 JSON
  在保存与导出边界脱敏，不携带 API Key。回归为 `R-FLOW3E-productivity`。
- FLOW-3F 兼容收口已完成：旧 FLOW-2 图在同一 `NodeAuthoringWorkspace` 中兼容读取，界面明确提示来源版本并
  支持作者显式转换保存；未知节点类型 fail-closed、导入失败不覆盖原图，旧图项目备份往返后仍可再次解析。
  产品侧不再挂载旧 `NodeModeWorkspace`，回归为 `R-FLOW3F-compat-release`。
- FLOW-3D 首个写后整理闭环已交付：`chapter.organize` 通过登记上下文源读取章节，复用既有 parser 和领域
  采纳器生成并确认状态、事实、物品、年表、关系、伏笔六域候选；目录还覆盖故事线、地点、状态、物品、
  事实、角色认知、年表和五类连续性只读上下文节点。正文 hash 变化会阻止过期写回；回归为
  `R-FLOW3D-continuity-network`。本阶段没有新增 Canon 表或旁路注册表。

### 当前边界 / 尚未完成

- 资料库当前对非章节资料提供精确选择和本地内容搜索；不会冒充已经为它们建立了 embedding
  向量索引。章节继续复用 `retrievalChunks` 的关键词/可选向量与层级摘要。
- 条件、循环、并行模型调用、脚本/插件节点、脏下游自动重跑、图模板库和主 Agent 生成图
  尚未交付；后续必须独立登记，不能绕过 Tool Registry、Canon 或作者确认。
- FLOW-3F 的兼容收口已完成；剩余条件、循环、并行、脚本/插件节点和 Agent 自动生成图仍是后续独立功能，
  不得绕过三注册表或作者确认边界。

### 新功能必须复用

- 节点自由只发生在选择和编排；项目读取仍走 `CONTEXT_SOURCES`，AI 调用仍走共享客户端，
  正式写回仍走 `adopt()`。
- `PromptWorkflow` 属于分步骤配方，`NodeFlow` 属于项目手稿过程数据；不得再次合并两者的
  产品入口或持久化模型。
- 新节点类型必须定义输入/输出类型、可见配置、运行快照、失败语义和可取消边界。

### 代码与设计入口

- `src/lib/types/node-flow.ts`
- `src/lib/node-flow/graph.ts`
- `src/lib/node-flow/executor.ts`
- `src/stores/node-flow.ts`
- `src/components/node-flow/NodeModeWorkspace.tsx`
- `docs/AUTHORING-PLATFORM-DESIGN.md`
- `docs/VISUAL-WORKFLOW-DESIGN.md`
- `docs/RAG-VISIBLE-LIBRARY.md`

## WORLD-1 世界知识、词条、地图与修炼

### 已有能力

- Codex 分类 schema 项目级共享、词条严格按世界隔离；手动新增、AI 拆分、编辑器提示、
  ref 选择和 AI 上下文使用同一作用域判定。HARNESS-70 后 AI 拆分只经登记的
  `manualText / codexExtractionBaseline` 读取来源、分类 schema 与既有词条，长来源分块可续跑，
  exact-key 候选确认前零写入，作者子集冻结后经 `adopt(codexEntries)` 原子新增；零候选、
  未知模型窗口、八采纳边界、导入取消和 terminal stale 均有反例。删词条/世界会清理 JSON
  引用和角色种族 FK。
- 世界规则、多世界、历史年表、重要地点、地图和角色设计已有产品能力。
- Phase 36 已为上游设定、正文、下游产物和系统入口建立内容类型标记。
- Phase 37-a 已交付：DB v41 `cultivationSystems`、多套体系、境界 DAG 分叉/合流编辑、
  角色种族/主修/当前设定境界、异兽体系/境界关联、世界宪法来源、AI 上下文以及
  项目/世界/删除/迁移/导出导入生命周期。
- Phase 34 已交付：DB v42 `cultivationProgress`、正文唯一逐字证据与闭集映射、作者
  逐条确认、规范章序/DAG 投影、角色历程视图、默认关闭的后续写作回注，以及章节、
  角色、体系、阶段和导出导入生命周期。角色卡设定境界与正文确认进度严格分层。
- Phase 35-b 已交付：政治/经济/文化三份概述与三类 Codex 独立维护；正式历史成为
  唯一主入口，DB v43 对旧历史做空目标无损桥接；城池词条通过可移植软 FK 关联地点，
  删除地点子树只断引用不删词条。旧历史、`humEra/humEvent`、`humSociety` 和合并字段
  都保留在兼容区，不自动猜测重分类。
- Phase 35-c 已交付：外部文档分块解析会生成带本块逐字证据的 Codex 候选，使用稳定
  分类引用而非数据库 ID；未知分类、非法字段和伪造证据在本地拒绝。候选跨块归并后
  必须由作者逐条选择、改名或改分类，再通过 `adopt()` 写回；同名词条只补空内容，
  多世界严格使用导入目标世界。
- ENH-WORLDMAP-2 已交付：地图 AI 从当前世界观、Codex 和重要地点抽取带证据的命名
  实体、规模、八向方位与距离，本地闭集校验后由确定性求解器计算坐标；命名城市落实
  到适宜陆地，国家规模影响扩张，聚落规模影响人口和渲染，河流只匹配现有物理水道。
- 地图比例尺公开手动、用户疆域、显式距离或估算来源；显式日程/月程明确标为旅行估算，
  矛盾空间关系保留残差提示，手动比例尺按世界持久化。

### 当前边界 / 尚未完成

- 旧自由文本不会后台自动语义拆成实体；作者主动走文档解析并确认后才进入结构化分类。
- 定性约束不承诺重画精确国界或强制河流逐点穿过地名；无明确尺寸/距离时绝对公里数仍
  是系统估算。

### 代码与设计入口

- `src/components/codex/CodexPanel.tsx`
- `src/components/worldview/CultivationSystemsPanel.tsx`
- `src/lib/types/cultivation.ts`
- `src/lib/ai/cultivation-context.ts`
- `src/lib/cultivation/progress.ts`
- `src/components/cultivation/CultivationProgressPanel.tsx`
- `src/lib/registry/project-tables.ts`
- `docs/CULTIVATION-PROGRESS-DESIGN.md`
- `docs/CODEX-IMPORT-CLASSIFICATION-DESIGN.md`
- `docs/CODEX-REDESIGN.md`
- `docs/WORLD-RULES-MULTIWORLD-DESIGN.md`
- `docs/WORLD-MAP-SPATIAL-CONSTRAINTS-DESIGN.md`

## STORY-1 角色驱动与动态故事规划

### 已有能力

- 角色双轴（戏份、道德/秩序）模型、角色关系、StoryArc 和大纲主线约束已有基础。
- CF-9C 已把临时角色驱动面板升级为项目级持久化工作区：方案保存弧光角色快照、作者要求、生成卷章、状态和版本链。
- 工作台支持新建、打开、复制为新版、重命名、删除、生成结果回填和显式“设为当前参考”；刷新不丢输入与结果。
- `characterDrivenPlan` 只读取 `projects.activeCharacterDrivenPlanId` 指向的同项目方案；普通卷纲、章纲、细纲、场景与正文生成均显式接入，没有 active 时不注入。
- 角色改名时使用当前名并提示方案快照名；角色删除时软 ID 置空、文本快照保留，方案不级联删除。
- DB v44、`PROJECT_TABLES`、必需表、项目删除、便携导出导入均已收口；active、父版本和弧光角色引用会在导入后重映射。
- 勾选生成卷后只经统一 `adopt(target=outlineNodes)` 写入卷/章，并保留 `【角色弧光推进】`；重复采纳幂等。
- CF-12 在同一入口提供“开书规划 / 中途重规划”：规范章序和真实正文划分已写保护、近期过渡和未写规划区，保护值不能低于最后已写章。
- 影响分析复用 active 方案、角色、Canon、故事线、现有大纲和章节连续性等登记上下文；章节记忆不足时明确降级为有限证据分析。
- AI 必须给轻量、中度、深度三档方案；本地拒绝未知/重复节点、正文或保护区 patch 和锚点改名，作者可逐项预览后确认。
- 应用前重读项目并拒绝过期预览；合法 patch 只经 `adopt(target=outlineNodes)` 写未来标题/摘要，空 Chapter 仅同步标题，正文和主线不写。

### 当前边界 / 尚未完成

- 当前方案激活和 CF-12 都不会自动修改 `storyCore.mainPlot` 或既有正文；主线影响只生成只读建议，这是刻意的数据安全边界。
- 第一版不保存独立修订计划历史，也不自动补写受影响正文；需要持久化修订审计或安全批量改稿时统一归 AUTHOR-1。
- 证据质量受章节记忆和已确认 Canon 覆盖影响；缺失时界面会警告，不把大纲推断冒充正文事实。

### 代码与测试入口

- `src/stores/character-driven-plan.ts`
- `src/lib/types/character-driven-plan.ts`
- `src/lib/story-planning/character-driven-adoption.ts`
- `src/components/outline/CharacterDrivenPlotPanel.tsx`
- `src/components/outline/CharacterRevisionPanel.tsx`
- `src/lib/story-planning/character-revision.ts`
- `tests/regression/R-CF9C-*.test.ts`
- `tests/regression/R-CF12-character-revision.test.ts`
- `docs/CHARACTER-DRIVEN-WORKSPACE-DESIGN.md`
- `docs/CHARACTER-REVISION-WORKFLOW-DESIGN.md`

## AUTHOR-1 / IDEA-1 长篇编辑、风格与灵感

### 已有能力

- 富文本编辑、自动保存、对照润色、全文查找替换、实体补全和悬浮档案已存在。
- `EDITOR-5` 已提供角色、重要地点和词条的智能全书改名：名称冲突预检、canonical 富文本正文替换、稳定 FK 冗余名同步、项目快照、单事务提交和会话原子撤销。
- 物品因缺少独立稳定实体 ID 不进入智能改名；自由文本和历史快照只列入人工复核，避免语义误改。
- 文风学习已支持章节画像、有界改前/改后 few-shot、作者样本说明、互动校准反馈和显式样本采纳；下游统一由 `userStyleProfile` 读取画像及最多三组短样本。
- 画像学习最多读取 6 章、每章 2500 字符；样本最多保存 8 组且只截取变化附近，未经作者确认的 AI 校准稿不会自动学习。
- 参考作品导入/分块/分析、灵感反推和草稿持久化已存在。
- CM-1 已把灵感反推升级为项目级增量工作区：最多 24 个带来源碎片、12 个确认版本，记录父版本和参与碎片。
- 每轮只发送作者勾选的碎片和有界上一版；AI 结果先做字段级差异，作者确认前禁止采纳到项目主档。
- `inspirationWorkspaces` 已进入 DB v45、字段/生命周期注册表、项目删除及便携导出导入；旧 `localStorage` 草稿继续兼容但不猜测迁移。
- Agnes 真实双轮融合验证了冲突修正、确认和刷新恢复；解析兼容单引号/尾逗号对象及错误对象字段，不再显示 `[object Object]`。
- 参考分析已升级为 DB v46 版本链：每个 run 绑定文件哈希、分析深度、来源声明和适用范围，分块与总结/角色聚合严格按 run 隔离。
- 新 run 在分析、失败或取消期间不会覆盖唯一 active；候选可比较维度差异后显式激活，历史版本可回滚，最多保留 6 版。
- 真实解析文本只在本地 `referenceAnalysisSources` 保存用于刷新续跑，不进入项目 JSON；便携备份只往返 reference/run/chunk 并重映射 ID。
- `buildRefAnalysisContext()` 只读取 active run；AI 原文引文必须在对应分块核对，旧 v45 分块运行时无损桥接为来源待确认的 active v1。
- 研究资料和来源待确认材料被硬限制为仅分析；来源声明不代替法律核验，也不会自动开放续写。
- Agnes 合成双版本流程已验证失败隔离、差异、激活、刷新与 v2→v1→v2 回滚，浏览器无控制台错误。

### 当前边界 / 尚未完成

- 原稿风格续写和个人向量写作知识库尚未交付；FB-4 已完成可行性审查并设计暂缓。IDEA-1 现在具备参考文件的来源、分析版本和断点地基，但仍没有角色终态、事件因果、结局状态等结构化剧情连续性胶囊，因此不得整本回灌或默认仿写原作者声音。
- GOV-1 已将参考分析 AI 写回收口到字段、采纳与生命周期注册表；FB-4 当前阻塞是连续性胶囊、闭集校验、有界上下文和声音分离，不再是来源版本或写回旁路。
- CM-1 当前只显示最近确认结果和版本数量，不提供任意旧版本浏览/分支回滚；整章、整本材料仍走文档解析和项目参考导入。

## AGENT-1 / SIM-1 / PRODUCT-1 / PLATFORM-1

### 已有能力

- 当前 AI 主要是用户触发的单轮生成、流式输出、确认和采纳；已有模型路由和部分 Agent/工具基础。
- AGENT-1 Tool Registry 当前提供 14 个只读工具：Phase 27.1-a 首批 13 个与 27.1-d 的
  `read_inspiration_workspace` 全部经 `CONTEXT_SOURCES → assembleContext()` 读取，带
  项目/世界/实体/碎片归属校验、独立预算与裁剪元数据。
- Phase 27.1-b 已提供 provider-neutral 严格 JSON 协议和只读 `AgentRunner`；步数、工具数、
  模型/工具 token、协议修正、循环和取消均有代码硬停止，协议消息禁止静默裁剪。
- Phase 27.1-c 已提供工作区右侧 ChatCopilot 的世界来源单点闭环：正式只读工具装配当前
  项目/世界，复用 `worldview.dimension` 生成可编辑候选，明确确认后才经
  `GenerationNode gate + adopt(worldviews.worldOrigin)` 写入并刷新同一 store。
- 已确认候选不会在采纳时再次生成；并发旧候选、空/过短/过长/无变化文本和注册表异常
  均由确定性代码阻断。
- Phase 27.1-d 已提供灵感反推的首个独立领域闭环：副驾只读取作者勾选的已保存碎片与
  同模式最近确认版本；结构化候选在内存中可编辑，拒绝零写入，确认只经既有
  `saveVersion → adopt(inspirationWorkspaces)` 新增版本，不自动写入项目主档。
- Phase 27.1-d 已提供角色生成的第二个独立领域闭环：副驾只读取当前世界观、可见角色
  与关系，复用当前激活的 `character.generate` 模板形成闭集 JSON；确认只经既有
  `GenerationNode → adopt(characters)` 新增一个当前世界角色并刷新同一角色 store。
  同名、未知字段、非法三轴和过期角色名单均阻断；不改已有角色或自动创建下游数据。
- Phase 27.1-d 已提供大纲生成的第三个独立领域闭环：复用大纲手工入口的 17 个登记来源、
  `outline.volume/outline.chapter` 提示和 `adopt(outlineNodes)`；整批候选可见可编辑，
  多世界、重复、并发变化及上游候选未采纳均会阻断；同领域重复任务会合并，未获用户明确
  授权的额外领域会从模型计划中移除。
- Phase 27.1-d 已提供正文生成的第四个独立领域闭环：从当前世界规范章序解析既有章纲，
  复用章节编辑器正式上下文与 `chapter.content/chapter.continue`；空白章生成和显式续写
  的候选可见可编辑，确认只经 `adopt(chapters)`。非空正文默认不覆盖，目标章/正文并发
  变化阻断；旧检索块在写入事务中清除，确认正文随后重建索引。
- 工作区右栏现在只有一个面向作者的“主 Agent”对话入口；作者无需选择领域标签。主 Agent
  用紧凑项目状态规划 `world-origin / character / inspiration / outline / prose` 幕后任务，支持
  依赖排序，并把未采纳的上游候选作为显式非 Canon 证据交给下游任务。
- AI 设置把四类通用任务和六个主 Agent 团队角色分区路由；编排、世界、角色、灵感、大纲、
  正文可各自绑定既有连接预设。领域在装配上下文前解析实际 provider/model，手工入口不受
  Agent 专属绑定影响，标准用量日志保留实际角色 taskKind。
- 世界、角色、灵感、大纲和正文领域可独立选择精简/均衡/完整上下文档位；档位只在
  `assembleContext()` 内收窄登记源预算，实际纳入、省略、裁剪、估算 token 和上限随候选
  持久化并可见。旧配置默认均衡，完整档保留此前上限。
- 主 Agent 编排与所有领域调用共享节省/均衡/充分三档单轮总预算；每次调用前按冻结输入与
  最大输出预留判定，候选保存估算 token、调用次数和打回次数。整轮只有一次受预算 Canon
  打回；领域 GenerationNode gate 和物品持有连续性硬判保持确定性。新主 Agent durable run 会把
  失败调用预算持久化；临时/协议错误最多原样重试一次，同一 fingerprint 再现后停止循环。
- `agentConversations/agentEvents` 持久保存用户消息、计划、任务状态、候选编辑、确认、拒绝
  和错误；刷新后候选仍可恢复。候选确认继续复用原领域 GenerationNode gate，刷新后则用
  冻结快照重新执行并发校验，不会因会话恢复绕开安全边界。
- Phase 27.2b 的“整理本章”已成为章节编辑器唯一的章后结构提取入口：同一正文一次调用
  生成角色状态、受控事实、物品流水、故事年表、角色关系和伏笔推进六类候选。每条必须有
  正文逐字证据并通过既有解析器、实体/枚举/伏笔单向状态校验；候选保存在独立归档 Agent
  事件流，刷新可恢复，作者逐项确认前业务表零写入。
- 整理候选带标准化正文 SHA-256 和团队预算证据；正文变化会阻断旧结果。状态/关系/伏笔
  复用既有 adoption 与同步入口，事实只写 candidate；物品和年表按 chapterId 原子替换，
  新批次任一条 FK/写入失败会回滚并保留旧数据。
- Phase 27.2c 一致性 Agent 已接入章节质量审校：正文保存后的后台 Fast Guard 只运行
  确定性物品连续性检查，模型调用和 token 均为零；作者明确选择 fast/deep 时才装配
  16K/32K 登记上下文（包含作者填写的创作一致性规则）并最多调用模型一次。模型发现必须带正文逐字引用和登记证据，
  认知、存亡与持有连续性的硬判仍由确定性 Canon 校验器完成。
- 一致性报告复用归档 Agent 事件流保存模式、正文 SHA-256、发现项、来源纳入/省略/裁剪、
  团队预算和调用次数；刷新可恢复，正文变化后旧结果标为过期且不再显示旧角标。报告没有
  adoption 路径，不修改正文、设定、事实、物品或年表。
- 项目概况、世界组目录、世界大纲树和本地搜索已成为正式上下文源；搜索只做当前项目/世界内的有界短摘，不调用网络或 embedding。
- 分步骤主 Agent 与正文 Harness 当前有 22 个受治理 Skill、18 个提示词执行版本和一份由 14 个只读工具实际声明派生的 schema hash。新 RunContract 按步骤冻结 Skill/Prompt/Tool 版本，候选 hash 同步绑定；恢复会拒绝版本篡改，HARNESS-18 前无 binding 的旧运行保持原协议兼容。
- HARNESS-19 已在章节编辑器的正文生成/续写主路径接入 `prose.review` 和 `prose.revise`：信息边界硬门通过后才做证据型语义初审；blocking 必须同时引用候选原文和登记上下文原文，只有明确可局部修复的问题最多修订一次，修订后重跑硬门和语义复核。评审、修订、复核共用团队预算并写入 Context Manifest、冻结执行版本和 durable 事件；通过后仍停在可编辑候选，作者确认才经 `adopt(chapters)` 写回。旧候选可恢复但不会伪造语义证据。
- HARNESS-20 已将正文确认写回后的自动状态抽取旁路下线：新主路径由同一个 post-adoption durable Run 顺序执行六域综合整理、章节记忆和确定性检索重建。综合整理继续复用既有一次调用解析器与六域作者确认界面，`prose.organize` / `prose.memory` 两个非默认 Skill 冻结各自来源、写入边界、提示词和回归证据；章节记忆写回后才重建层级摘要，避免新摘要仍停留在 pending。只有三步、六域采纳证据和当前正文派生状态全部匹配才有 terminal receipt；历史 Chapter Transition V1 只保留兼容恢复。
- HARNESS-41 将上述 Run 扩展为四步：在检索/摘要重建成功后执行 `prose.consistency` 确定性 Fast Guard。它只读正文、角色和持有物，不调用模型、不写业务 Canon；候选事件通过 `durableRunId` 与 post-adoption Run 关联，并固定正文 hash、Context Manifest hash、step attempt 和 candidate hash。V2 terminal verifier 只有在候选真实存在且全部 hash 匹配时签发回执；候选事件落库而 ledger 尚未推进的崩溃窗口可恢复且不重复调用模型。旧三步 Run 仍按 V1 verifier 兼容。
- HARNESS-42 已将章后失败恢复从组件顺序控制提升为确定性恢复计划：`chapter-post-adoption-resume.ts` 按事件历史计算 step action、依赖、attempt 和失败分类；编辑器继续动作复用既有 post-adoption Run，跳过已成功步骤，只重跑可重试失败。过期、不可重试和运行中未知窗口不会被自动重跑；四个 step 的失败证据统一记录 category/action/fingerprint。当前已有计划级回归，真实浏览器关闭重开仍需补充。
- HARNESS-43 已将正文编辑后的影响分析统一为 `buildEditImpactGraphV1()`：图绑定正文 hash，覆盖事实及其来源记录、后续章节/大纲、章/卷/书摘要、检索块、故事线进度/交汇和状态/物品/年表派生节点；排序后的 graph hash 进入主 Agent 影响报告与 `consistencyReport` 上下文源。图仍是只读证据。
- HARNESS-44 已在该图基座上增加第一条受限反向 patch：`impact-patch-durable.ts` 创建独立 durable Run 和作者确认候选，绑定源正文 hash、graph hash、Context Manifest、Run/step/attempt 与 candidate hash；仅允许 `outlineNodes.summary`，不允许 `chapters.content`、事实权威状态或 `locked` 数据。确认后经过 `adopt()` 写回并签发引用真实 `adoption.committed` 事件的 terminal receipt；stale、篡改、越界和锁定反例已有 `R-HARNESS44-impact-patch-durable`。
- HARNESS-45 已将该受限 patch 接入 `ChapterEditor` 的影响分析入口：选择图中的后续大纲节点，填写候选摘要/理由，创建与恢复均回读 durable Run；作者确认/拒绝分别调用受治理写回或记录拒绝事件。恢复会重新核对 candidate/source/graph hash，过期、损坏和跨作用域候选不会显示为可确认项；`R-AUDIT6-chapter-editor-toolbar` 覆盖 UI 转发，仍不改正文、事实权威状态或 locked 数据。
- HARNESS-46 已新增 `buildImpactRemediationPlanV1()`：对影响图每个节点生成稳定的处理项、责任模式、依赖节点和理由，计划绑定正文/graph hash 并计算 `planHash`；`ChapterEditor` 只展示系统重建与作者复核计数。当前不执行计划，任何后续重建或重跑都必须在新的 durable 执行单元中重新验证这些 hash。
- HARNESS-47 已新增 `executeImpactRemediationV1()`：只执行计划中 `deterministic` 的 `rebuild-retrieval` / `rebuild-summary` 项，复用既有 `rebuildChapterChunks()` 与 `rebuildProjectNarrativeSummaries()`，不调用模型、不写正文/事实/大纲。Run 固定 `chapterContent` Context Manifest、plan/source hash 和 post-state receipt；完成 Run 可幂等复用，来源正文变化或无可执行项目阻断。`R-HARNESS47-impact-remediation-durable` 覆盖成功、复用、stale、零项目边界。
- HARNESS-48 已把正文信息边界从“候选可选证据”提升为新合同必需条件：`requiresProseInformationBoundaryV1()` 识别 V2/V3 terminal contract；`isProseGenerationCandidateCurrentV1()` 与 `verifyProseGenerationRunV1()` 对缺失 `informationBoundaryHash` 的新候选 fail-closed，同时保留历史 V1 Run 的兼容读取。`R-HARNESS7-prose-generation-durable` 新增缺边界反例。
- HARNESS-49 已新增 `replanImpactRemediationV1()` 与正文编辑器“刷新计划”入口：重读当前正文、影响图和三注册表派生节点，生成绑定新 `sourceTextHash + graphHash + planHash` 的处理计划；旧计划 hash 和 changed 标志保留作审计，刷新过程不写业务 Canon。`R-HARNESS49-impact-remediation-replan` 覆盖正文 stale、幂等重规划和损坏计划阻断。
- HARNESS-50 已新增 `executeImpactAuthorReviewV1()`：只处理影响计划中的 `author-confirmed` 项，以零模型 durable Run 记录作者 `acknowledged` / `needs-manual-action` 决定与理由，并绑定 `sourceTextHash + graphHash + planHash + itemId`、Context Manifest、候选 hash 和 receipt。Run 的写目标为空，不调用 `adopt()`、不产生 `adoption.committed`，两种决定都不代表业务 Canon 已修正；`R-HARNESS50-impact-review-durable` 和事件 schema 回归覆盖幂等回放、stale、越界、非作者项与损坏元数据阻断。
- HARNESS-51 已新增 `readImpactAuthorReviewsV1()` 并接入 `ChapterEditor`：影响分析/计划刷新后，从现有 Run ledger 回放当前计划每个作者确认项的最新有效决定、理由和 receipt，显示已复核/总作者项；回放重新验证当前 `sourceTextHash + graphHash + planHash`、契约目标和 candidate hash，旧计划或损坏事件不会冒充完成。`R-HARNESS50-impact-review-durable`、`R-AUDIT6-chapter-editor-toolbar` 覆盖回放、stale 和 UI 投影；自动计划恢复及通用人工修正/依赖重跑仍未交付。
- HARNESS-52 已新增 `impact-handoff.ts`：作者复核结果为 `needs-manual-action` 时，正文编辑器可通过绑定当前正文/影响图/处理计划 hash 的交接协议进入既有事实、状态、物品、故事线、年表、关系、设定、细纲或章节模块；工作区解析交接后展示目标表/记录和计划证据，并可按来源章纲返回正文。该协议是只读导航控制面，不新增修复面板，不写业务 Canon，不调用模型；地址证据不完整或目标不受支持时 fail-closed。`R-HARNESS52-impact-handoff` 与 `R-AUDIT6-chapter-editor-toolbar` 覆盖协议往返、模块映射和入口转发；具体人工修正及依赖重跑仍未交付。
- HARNESS-53 已新增 `readCurrentImpactAuthorReviewStateV1()`：编辑器重挂载时按当前章节重新构建图和计划，只有 `readImpactAuthorReviewsV1()` 能针对当前 `sourceTextHash + graphHash + planHash` 回放至少一条有效 receipt 时才恢复复核面板；正文或图变化后旧 receipt 不会复活。`ChapterEditor` 将这条恢复与 HARNESS-45 patch 候选恢复并行执行并隔离错误。`R-HARNESS50-impact-review-durable` 覆盖恢复和 stale 反例；尚未产生 Run 证据的临时分析计划仍只存在于当前编辑器会话。
- HARNESS-54 已将人工交接从“URL 结构正确”收紧为“当前 durable receipt 可回放”：`ImpactHandoffV2` 绑定复核 Run/receipt，`validateCurrentImpactHandoffV2()` 重新验证来源章节/章纲、当前 graph/plan、目标 item 和最新 `needs-manual-action` 决定。工作区只有验签成功才显示可信交接提示；伪造 hash/run/receipt、被后续决定覆盖或正文 stale 均返回空。该路径不新增表、不调用模型、不写 Canon；`R-HARNESS54-impact-handoff-validation` 是反例证据。
- HARNESS-55 新增 `resolveCurrentImpactHandoffTargetV2()`，从 `PROJECT_TABLES` 验证目标记录仍存在且属于当前 World/Work，并把章节/细纲主键归一为面板实际使用的 `outlineNodeId`。`WorkspacePage` 同时核对 URL 模块和当前可见模块；各既有人工面板按目标 ID 切换页签/列表/筛选、展开层级并高亮记录，不自动进入编辑态或写数据。`R-HARNESS55-impact-target-validation` 与 `R-HARNESS55-impact-target-ui` 覆盖错误模块、缺失/未登记/跨 Work 目标和筛选隐藏反例；修正完成证明与依赖重跑仍未交付。
- HARNESS-56 新增 `beginImpactManualCorrectionV1()` / `completeImpactManualCorrectionV1()`：从 HARNESS-54/55 的可信 handoff 建立零模型 child Run，把冻结 plan、review Run/receipt、精确目标与正式 pre-state 写入可验签检查点；只有作者在既有面板保存后显式终验、同一目标业务状态 hash 确实变化，才签发绑定 pre/post state 与父 lineage 的 receipt。完成后目标再变会 stale；待处理的本地 ID 检查点导入后取消，terminal receipt 导入后 stale。该路径零 Canon 写入、零 `adopt()`、零模型，`R-HARNESS56-impact-manual-correction` 覆盖恢复、幂等、覆盖/篡改/作用域及导入生命周期；修正后 replan 和依赖重跑仍未交付。
- HARNESS-57 新增 `executeImpactPostCorrectionReplanV1()` / `readCurrentImpactPostCorrectionReplanV1()`：以 H56 fresh completion Run/receipt 与目标 post-state 为父 lineage，复用 HARNESS-49 planner 重建当前 graph/plan，把旧有新无、两边均有、新有旧无的稳定 item 分别投影为 `resolved / remaining / new`；仍存在的项保守保留，不用模型臆断问题已解决。工作区终验后立即执行并支持刷新补做，来源编辑器恢复当前计划和计数；H56 已消费的旧 review 不再冒充当前复核。执行器会从 `run.created` 到 `verification.accepted` 的任一 durable 边界沿同一 child Run 收敛；`R-HARNESS57-impact-post-correction-replan` 覆盖 9 项分类、幂等、恢复、父 receipt/目标/plan stale、防篡改、UI 与导入生命周期；自动系统重建和生成式下游重跑仍未交付。
- HARNESS-58/59 已闭合修正后计划的确定性余项执行，并为剩余 UI 模型入口建立可清零 census。H58 只通过 fresh H57 parent 执行检索块/层级摘要，真实 output checkpoint 可在 10 个 durable 边界恢复；H59 的 AST 注册表已进入 CI。HARNESS-60/61/62/63/64 收口角色关系、情感节拍、重要地点、物品栏与故事年表 AI 入口后，census 为 24 个文件 / 39 个静态入口构造点，分类为 7 governed、4 auxiliary、13 migration。该分类不等于 13 个迁移已完成，后续仍须按单一目标表逐项收口。
- HARNESS-77 已交付第一个绑定 fresh H57 的生成式下游目标：`outline.impact-summary-regenerate` 只接受 H57 `remaining/new` 中非来源章的 `review-outline` 项，重新经九个登记 Context Source 装配当前输入，一次模型调用形成严格 `{summary,reason,evidenceRefs}` 持久候选。child 绑定 H57 Run/receipt/output、plan/graph/item，候选冻结来源、完整 Context/Prompt、非目标上游证据与目标 baseline；确认前 `outlineNodes` 零写，确认时事务内二次 CAS 后只经 `adopt()` 合并 `summary`。八采纳边界、拒绝/重试、刷新恢复、父/来源/Context/目标 stale、锁定/越界、导入取消和 terminal stale 已闭合；H44 作者手填 patch、H58 确定性重建及其它字段仍保持独立边界。
- HARNESS-78 为 H77 补上 H57 直接依赖证明门：每个目标的 `dependencyNodeIds` 必须映射到同一 current plan，直接上游作者项须有 fresh H50 `acknowledged` terminal receipt；缺证明或 `needs-manual-action` 时模型调用与 H77 Run 均为零。proof 随候选冻结并进入 candidate/contract/terminal receipt，恢复、采纳和终验重新读取逐项匹配；多个目标只按各自证明逐项解锁，不自动确认、批量调用或级联写正文。首个章纲目标的依赖顺序已闭合；其它目标类型和跨类型通用调度仍须按一次一类型扩展。
- HARNESS-60 已把 `CharacterRelationPanel` 的组件级模型调用、手拼大纲/正文上下文和逐条 store 写入下线，新 `character.relationships` Skill 只经 `CONTEXT_SOURCES + assembleContext()` 读取当前 World 的角色、关系、大纲摘要和已写正文；严格 JSON/枚举/唯一精确角色名验证后持久化候选。作者勾选冻结为不可便携意图，确认后只经 `adopt(characterRelations)` 和登记的 `characters.relationships` 同步入口写回，最后回读正式关系并签发 terminal receipt。八个采纳持久化边界可沿同一 Run 幂等恢复；多世界上下文隔离、baseline stale、导入取消物理 ID 候选和旧旁路下线均有 `R-HARNESS60-character-relationship-durable` 反例。
- HARNESS-61 已把 `EmotionBeatCard` 的组件直调、手拼上下文、宽松 parser 与“生成即保存”下线。`prose.emotion-beats` 只读七个登记源，严格 3–6 拍候选绑定章节/章纲/World/Work、Manifest、实际输入和正式卡 baseline；作者确认后才经 `adopt(emotionBeatCards)` 写入。八个采纳边界恢复、导入取消物理 ID 候选与terminal 后人工修改撤销旧 receipt 已有 `R-HARNESS61-emotion-beat-durable` 反例。
- HARNESS-62 已把 `LocationPanel` 的逐章 `chat()`、手拼正文与已有地点、内存候选和组件内 `adopt()` 下线。`world-origin.locations` 只经 `chapterContent / locations` 登记源读当前 Work/World，长正文分块冻结计划并在每次确定完成后 checkpoint；已完成分块不重试，模型结果不可判定窗口不自动续跑。全部调用完成才持久化严格候选，作者选择后才经 `adopt(importantLocations)` 写入当前 World。八个采纳边界、Work/World 隔离、导入取消和上游/正式状态漂移撤销 receipt 已有 `R-HARNESS62-location-extraction-durable` 反例。
- HARNESS-63 已把 `InventoryPanel` 的逐章 `chat()`、组件内 Context 拼接、吞掉单章失败和 `deleteByChapter + adopt()` 先删后写下线。`prose.inventory-extraction` 只经 `chapterContent / itemLedger / characters` 登记源读取当前 Work/World；范围、分块、roster 与正式 baseline 进入 durable plan，全部调用后才形成严格候选。作者确认后使用 AdoptionSchema 已登记的 `replaceScope=['chapterId']` 逐章事务替换，跨章进度可恢复；空候选是明确清理目标章，姓名仅唯一匹配时绑定角色 FK。八采纳边界、导入取消、作用域隔离和 terminal stale 已有 `R-HARNESS63-inventory-extraction-durable` 反例。
- HARNESS-64 已把 `StoryTimelinePanel` 的逐章 `chat()`、组件内 Context/分块/parser、吞错和 `deleteByChapter + adopt()` 先删后写下线。`prose.story-timeline-extraction` 的模型输入只经 `chapterContent` 登记源读取当前 Work；完整正式年表仅由治理层回读作 CAS。计划冻结提示词、章节 Manifest/分块、正文和完整正式 baseline，全部调用后才形成按 `chapterId + title` 去重的严格候选。作者确认后使用 `storyTimelineEvents.replaceScope=['chapterId']` 逐章事务替换并压缩 order；空选择可明确清理目标已写章，短章/其它 Work 保持冻结。八采纳边界、写后 checkpoint 恢复、导入取消、Work 隔离和 terminal stale 已有 `R-HARNESS64-story-timeline-extraction-durable` 反例。
- HARNESS-65 已把正文选区润色/扩写/缩写/改写与查漏收口为 `prose.selection-edit / prose.selection-check` durable Skill；模型只读冻结 `manualText`，编辑候选确认前零写，确认后通过正文 HTML/文本双 CAS 精确采纳，查漏保持只读。八采纳边界、格式漂移、刷新恢复、导入取消和 terminal stale 已有 `R-HARNESS65-selection-edit-durable` 反例。
- HARNESS-66 已把 `WorldMapPanel` 的直接 DB 扫描、手拼 Prompt/Context 与模型结果立即 `updateNode(mapConfigJSON)` 下线。`world-origin.map-config` 只经 `worldview / geography / codex / locations` 登记源读取当前 World；严格地图配置先成为不可便携 durable 候选，作者确认后才通过 `worldNodes.mapConfigJSON` FIELD_REGISTRY、record-only AdoptionSchema 与 exact-field CAS 定点采纳。节点名、来源、Prompt、原配置、八采纳边界、导入取消和 terminal stale 由 `R-HARNESS66-world-map-durable` 反例闭合。
- HARNESS-67 已把 `WorldGroupDetail` 的 `useAIStream`、直接 DB 读故事核心/跨世界 Context 拼装、宽松 parser 和模型返回后立即 `adopt(worldviews)` 下线。`world-origin.worldview-expand` 只经 `manualText / worldGroups / storyCore / worldview` 登记源读取作者已保存的目标世界草稿、当前 Work 与当前 World；严格七字段结果先成为不可便携 durable 候选。作者确认且目标组、Context、Prompt 与完整正式 baseline 均 fresh 后，才在事务中经 `FIELD_REGISTRY + adopt(worldviews)` 原子采纳七字段。八采纳边界、首次创建、写后恢复、导入取消、作用域隔离和 terminal stale 由 `R-HARNESS67-worldview-expand-durable` 反例闭合。
- HARNESS-68 已把 `WorldGroupOverview` 的 `useAIStream`、内存建议、手拼全世界摘要和直接 `createGroup()` 循环下线。`world-origin.world-suggest` 只经 `manualText / worldGroups / storyCore` 登记源读当前 World/Work，严格 2～4 项建议作为不可便携整批 durable 候选；作者选择的非空子集与最终顺序冻结后，只能在项目提示、世界目录/关系、故事核心、Context 与 Prompt 仍 fresh 时，在同一事务中经 `FIELD_REGISTRY + AdoptionSchema + adopt(worldGroups)` 新增八字段记录。世界关系保持人工 CRUD；八采纳边界、同名/上游 stale、写后恢复、导入取消、World/Work 隔离和 terminal stale 由 `R-HARNESS68-world-suggest-durable` 反例闭合。无运行调用的 `world-group-context.ts` 已删除，不再保留平行 Context builder。
- HARNESS-69 已把 `WorldConstitutionPanel` 的 `useAIStream`、直接 DB 查主体、宽松 parser 和模型返回后立即写事实候选下线。`world-origin.constitution-extract` 只经 `constitutionScanSources` 登记源读取当前 World/Work 的来源、允许主题和主体；无损闭集必须与 runner 冻结快照逐字一致。strict 0～80 项整批候选确认前零写入；作者批次确认后，在事务内复核来源、主体和完整事实 baseline，才经 `fact-ledger` Adoption Extension 原子新增 `temporalFacts(status=candidate)`。批次确认不等于 Canon，既有逐条确认/互斥明确取代保持第二层门。八采纳边界、未知结果、导入取消、World/Work 隔离和 terminal stale 由 `R-HARNESS69-constitution-extraction-durable` 反例闭合。
- HARNESS-70 已把 `CodexPanel` 的直接 `chat()`、组件内 `assembleContext()`、宽松 parser、内存候选和直接 `adopt(codexEntries)` 下线。`world-origin.codex-extract` 只经 `manualText / codexExtractionBaseline` 登记源读取作者来源、目标分类/schema 与同世界组既有词条；逐分块 checkpoint 只续跑剩余调用，未知模型结果不重试。strict 0～200 项整批候选确认前零写入；作者子集与顺序冻结后不可改选或取消，事务内复核完整 baseline 后才经登记采纳层原子新增。零候选、八采纳边界、导入取消、World/Work/世界组/分类隔离和 terminal stale 由 `R-HARNESS70-codex-extraction-durable` 反例闭合。
- HARNESS-71 已把 `CultivationProgressPanel` 的直接 `chat()`、硬编码 prompt、宽松 parser、内存逐条候选和逐条写入下线。`prose.cultivation-progress-extraction` 只经 `chapterContent / cultivationProgressExtractionBaseline` 读取目标正文、角色/体系 DAG、规范章序和完整进度 baseline；strict 候选不接受模型输出 transition，作者选择冻结后由系统按 DAG/章序构造正式投影。事务内二次 CAS、登记批量写入和既有后续 transition 归一化原子完成；零候选、模型未知窗、八采纳边界、上游/正式状态 stale 与作用域隔离由 `R-HARNESS71-cultivation-progress-extraction-durable` 闭合。
- HARNESS-72 已把 `ForeshadowPanel` 的两次 `useAIStream` 调用、自由文本到宽松结构化的二次模型解析、内存候选和逐条写入下线。`outline.foreshadow-suggestions` 一次调用只经登记的 Canon、世界、故事、角色、规则、历史、地点与 `foreshadowSuggestionBaseline` 读取当前 Work，strict 0～12 项候选确认前零写入；作者选择冻结后，项目、完整正式 baseline、上游 Context 与 Prompt 均 fresh 才在事务内二次 CAS，并经 `FIELD_REGISTRY + AdoptionSchema + adopt(foreshadows)` 原子新增系统固定为 `planned` 的伏笔。空结果、未知模型窗、八采纳边界、导入取消、Work 隔离和 terminal stale 由 `R-HARNESS72-foreshadow-suggestions-durable` 闭合，人工伏笔 CRUD 与章节关联保留。
- HARNESS-73 已把 `HistoryPanel / useHistoryAI` 的两路 `useAIStream`、组件内 `manualText` 上下文和即时 `adopt()` 接受路径下线。`world-origin.history-consult / world-origin.history-storm` 只经 `worldview / historyAgentBaseline` 读取已保存历史总述、纪年、精确目标与作者边界；事件/关键词共用一个按目标表/字段闭集运行器。严格 Markdown 先成为不可便携候选，确认前正式结果零写入；确认后以原字段 presence/value CAS 只写 `aiConsult` 或 `aiBrainstorm`，另一路结果可独立变化。未知模型窗、候选恢复、八采纳边界、来源/Prompt/目标字段 stale、目标删除、导入取消、World/Work/世界组隔离和 terminal stale 由 `R-HARNESS73-history-agent-durable` 闭合，人工历史 CRUD 与结果清除保留。
- HARNESS-74 已把 `AnalysisReportViewer` 的总结/角色两处直接 `chat()`、组件内输入取样、内存候选和即时派生写回下线。`inspiration.reference-summary / inspiration.reference-characters` 只经 `referenceDerivedBaseline` 读取当前 Work 的精确参考、精确分析版本、分块分析和来源声明；严格 JSON 先成为不可便携候选。确认后先以字段 presence/value CAS 写版本化 `referenceAnalysisRuns`，仅 active 版本再同步同字段到 `references` 兼容投影；ready/superseded 不污染当前参考。未知模型窗、候选恢复、版本/投影分段写入恢复、十个采纳边界、来源/Prompt/字段 stale、目标删除、导入取消、Work/版本隔离和 terminal stale 由 `R-HARNESS74-reference-derived-durable` 闭合，人工版本生命周期与报告阅读保留。
- HARNESS-75 对 `PromptExamplesEditor` 完成了风险裁决而没有机械新建业务 Agent。该入口只读取 `PromptTemplateEditor` 当前未保存的全局 Prompt draft，模型结果只经 `onChange` 进入内存；作者另点顶部「保存」后才由既有 Prompt store 写 `promptTemplates`。该表已由 `PROJECT_TABLES` 登记为 `owner=global / exportable=false`，不属于项目 Canon；未保存离开即丢弃、生成后 DB/Agent ledger 零写、显式保存后才落库、系统模板只读与配置缺失零调用由 `R-HARNESS75-prompt-examples-authoring-draft` 锁定。census 因此按事实归为 `authoring-draft` auxiliary，而非伪造 durable receipt。
- HARNESS-21 已将正文 Run → post-adoption Run 的父子完成关系持久化：RunContract 的 `lineage.parent`
  与 `agentRuns.parentRunId/parentReceiptHash/parentArtifactHash` 双向核对，父终态回执和正文 hash
  缺一不可；同一父 Run/关系由唯一索引去重。子 Run 的终态证明通过契约 hash 间接绑定父回执，父回执
  stale 或正文再次变化时子 receipt 会被撤销。新链支持刷新恢复、全链状态投影和项目导入导出重映射；
  无 lineage 的 HARNESS-20/历史数据只走兼容分支，不被显示为全链完成。
- HARNESS-22 已闭合主 Agent 多任务候选的同代依赖 join：新 durable 下游候选冻结上游 task、
  candidate/output hash 和 Run generation，恢复验证引用版本确实来自当前严格事件历史；作者编辑
  上游后旧下游仍可查看但不能确认采纳。下游确认前必须回读上游 step 的正式 adoptionHash 与
  succeeded 状态，不再把对话确认消息等同于业务写入完成。旧无绑定候选保持兼容；本单元未开启
  fan-out，后续由 HARNESS-23 接续，attempt replan 仍未开启。
- HARNESS-23 已开启首批受控有限 fan-out：只有作者明确要求且计划包含世界来源、已保存灵感的
  无依赖、无共享写表叶子时才进入 `fan-out-synthesize`，每波最多并行两个模型调用，durable
  账本和候选提交仍串行。并发预算计入 outstanding reservation；一叶失败会保留成功候选，恢复
  只重跑失败叶，汇合任务复用 HARNESS-22 同代 join。大纲、正文、Canon 采纳仍不并行；每叶
  terminal receipt、通用审计 fan-out 和成本/延迟 A/B 尚未完成，可用独立本地开关回到顺序执行。
- HARNESS-24 已为主 Agent 候选 DAG 增加失败分类与最多一次有限重规划：失败事件记录 category、action
  和哈希化 fingerprint，同错第二次出现不再原样 retry。模型只能 patch 失败任务及其下游的指令和
  依赖；任务身份、Skill、workflow 和三注册表权限冻结。换代事务会局部 stale 受影响候选，显式
  carry-forward 未受影响的待确认候选，并原子写入新契约代际、计划事件和检查点；新下游只有当前代
  carry 证据才能引用旧代上游。已确认/已采纳 run 不原地重规划，旧契约不补授权，独立开关可关闭。
- HARNESS-25 已为新 fan-out 契约增加逐候选确定性步骤回执：回执绑定 step/attempt、candidate/output
  hash、Context Manifest、verifier 版本和 criteria，并与候选及 Manifest 同事务提交。汇合任务在模型
  请求前必须取得所有上游 fresh receipt，下游候选再冻结 receipt hash；恢复会拒绝篡改、已失效、跨代
  或晚于 join 的证据。作者编辑先使旧回执失效，合法稿重签，不合法稿不能进入下游；重规划 carry-forward
  在新代重签。`agentEvents.durableRunId` 经 DB v53 索引和 `PROJECT_TABLES` 参与导入重映射及删除生命周期，
  原始 hash-bound payload 不静默改写。历史无策略运行兼容；首批领域语义终验由 HARNESS-27 接续，
  通用 fan-out 仍未完成。
- HARNESS-26 已新增去内容化的顺序/fan-out 配对评测记录：冻结 fixture/input/plan hash 及同一生成器
  provider/model、Prompt/Tool schema 版本，交叉执行两个变体，并要求不同 provider/model 身份的 verifier
  在生成结束后独立评分。逐例证据和两个既有 benchmark artifact 均可重算，正文、hidden label、未知字段、
  指标或 hash 篡改均 fail-closed。发布门覆盖至少 6 组样本、完成率、逐步回执、语义/证据非劣、未来与
  错世界泄漏、p95 延迟、token 和 cost；真实 durable 集成测试已证明同计划能走 1 路顺序与 2 路 fan-out，
  两边均产生完整步骤回执且不写 Canon。尚无真实外部模型的 6 组通过 artifact，不能宣称 fan-out 已证明净收益。
- HARNESS-27 已为当前 `world-origin + inspiration -> character` 限定 fan-out 的两个独立叶子增加
  `world-origin.review` / `inspiration.review` 领域 Skill 和 `candidateSemanticReviewPolicy`。reviewer 只从
  `assembleContext()` 独立装配的登记源取证，必须与 generator 使用不同 provider/model；blocking 必须有
  候选逐字引文、登记 source key 和来源逐字引文，缺少该证据的质量意见不能阻断。通过 artifact 绑定
  candidate、generation、生成/审查 Context Manifest、Prompt/Tool 执行版本和模型响应 hash，再签发 v2
  step receipt；join、恢复与 terminal receipt 都会 fail-closed 复核。编辑会移除 artifact 并 stale 回执，
  重新执行生成/终验前不能汇合或采纳；当前没有只复审编辑稿的自动局部入口。replan 会重跑受审叶及
  全部下游，阻断则暂停给作者。审查成本纳入父候选预算；artifact 复用现有
  `agentEvents` 的项目生命周期和便携重映射。review/revise/organize/memory 等 Harness 内部 Skill 不能成为
  顶层生成任务。因真实外部模型发布 artifact 仍缺失，该策略默认关闭，仅显式本地开关可启用；未交付
  通用审计 fan-out、自动语义修订或更宽的领域白名单。
- HARNESS-28A–28D 已在既有长篇评测模块冻结 ConStory 五类/19 子型，并建立统一只读证据协议：模型只交
  `sourceId + quote`，代码用 `chapter-text-v1` 标准化来源、计算 SHA-256 与 UTF-16 半开 offset，拒绝不存在、
  错来源、重复歧义和同区间 pair。类别和 hard/advisory 由代码派生，intentional/ambiguous 不得升级 hard。
  H4 artifact 严格绑定 fixture 输入/隐藏标签 hash、来源集合、生成/审查身份、Prompt/benchmark、用量、成本和
  trace，并支持防篡改导入导出；不保存整篇来源、不写 Canon、不接生产 gate。headless H4 目录现有 40+20
  个 8,000–12,000 字符的合成长文，四类任务均衡，development 每子型两例、held-out 每子型一例并含 clean、
  intentional/ambiguous 及中段/远距控制。公开 ID 不携带标签，模型可见投影物理移除 hidden labels；60 例均
  通过正式证据定位/artifact 路径。headless runner 强制 generator/verifier 身份分离，按例 checkpoint 并可从
  JSON 恢复；有限重试和调用/token/时长/成本预算包含失败响应用量，无用量失败会阻断发布。aggregate-only
  scorer 计算 high hard precision/recall、证据回查、作者意图误升级、clean 误报及 Wilson 95% 区间；配对
  bootstrap 可比较不同长度输出的每万字符错误密度。开发设置页现已迁移到 H4 40+20，逐例验签 checkpoint
  按 split 存储并可刷新恢复，只展示 aggregate 且可导出完整 artifact；development 通过后才解锁 held-out。
  旧 NS-0/NS-1 模型 runner、独立语义裁判、结果 key 和按钮已删除，H17 对照保留。sealed 仅指调用/评分 API 隔离而非源码
  标签保密；真实外部 verifier 40+20 artifact、真实浏览器关闭重开、人工 held-out 复核和质量收益仍未交付。
- HARNESS-29 已在唯一只读 Agent Runner 上增加 provider 原生工具 transport 基座。默认继续使用
  `text-json-v1`；只有 capability matrix 已验证且显式启用时才声明 `native-tools-v1`。声明由现有 14 个
  `AGENT_READ_TOOLS` 派生，动作重新经过同一闭集解析并只由 `executeAgentTool()` 执行，读取仍走
  `CONTEXT_SOURCES + assembleContext()`，零业务写权限。工具 schema token 纳入物理窗口与 Runner 预算；
  未知/畸形调用有限失败，不会隐藏回退文本协议。任务路由先冻结真实 provider/model，新 durable Run
  绑定 transport capability hash，运行中改路由不能偏离合同；HARNESS-29 前旧 Run 不伪造绑定。当前只有
  模拟 provider 合同测试，开关默认关闭，不能宣称 token、延迟或质量收益。
- HARNESS-30 已交付 `outline.story-arcs`：故事线请求由主 Agent 路由到现有 `outline` Agent 的专用 Skill，
  上下文权限、输入状态和压缩策略由 Skill 声明并只经 `assembleContext()` 实现；严格候选契约限制
  main/sub、阶段、关键事件、转折与卷范围。候选由 durable Run 持久化并等待作者编辑/拒绝/确认，确认前
  `storyArcs` 零写入，确认后只经 `adopt(target=storyArcs)` 写入；snapshot/CAS、正式状态匹配和 terminal
  verifier 防止旧候选或被篡改结果签发完成。旧 AI adapter/直接 `addArc()` 入口已删除，人工 CRUD 保留。
  现有证据为真实 orchestrator、刷新恢复、面板交互和模拟模型回归；生成质量与更完整 Narrative Blueprint
  仍未完成评测。
- HARNESS-31 已交付 `world-origin.story-core`：故事核心七字段的 AI 按钮统一进入现有世界基座 Agent，
  每轮只允许产生一个严格 `{field,value}` 候选。Skill 声明并只经 `assembleContext()` 读取世界、故事核心、
  力量、词条、角色、故事线和卷纲，支持 empty/partial/complete 输入处理、预算压缩与全文救援；`storyCore`
  正式来源补齐此前遗漏的 `concept`。候选进入 durable Run，确认前 `storyCores` 零写入，刷新后仍可编辑、
  拒绝或确认；确认只经 `adopt(target=storyCores)`，完整故事核心 snapshot/CAS、字段错投 gate、正式字段回读
  和 terminal verifier 阻止过期或篡改结果完成。旧 `story-adapter` 与组件级上下文拼接已删除，七字段人工
  编辑保留。工程证据覆盖真实 orchestrator、durable 恢复、组件和 Chromium 两次刷新；尚无真实模型质量 A/B。
- HARNESS-32 已交付 `world-origin.worldview-field`：世界基座起源、自然、人文三面板的 17 个 AI 字段统一进入
  现有世界基座 Agent 的同一 Skill。Skill 通过 `CONTEXT_SOURCES + assembleContext()` 读取正式基座和下游反推
  证据，按 empty/partial/complete 选择创建、参考创建或受约束变换，并支持预算压缩/全文救援；每轮只生成一个
  严格 `{field,value}` 候选。确认前 `worldviews` 零写入，确认后只经 `adopt(worldviews)`，完整基座快照/CAS、
  durable 刷新恢复、作者编辑/拒绝/确认、字段错投和终态回读均有专项回归与 Chromium 证据。旧
  `world-origin.complete` 仅保留历史 durable Run 兼容，人工编辑、词条、历史年表和 Prompt 配置保留；当前
  证据只证明工程闭环和模拟模型合同，不证明真实模型文学质量收益，也不涉及世界引擎体验。
- HARNESS-33 已交付 `character.create`：分步骤角色面板的普通 AI 入口统一进入现有 Character Agent，同一
  Skill 经 Tool Registry → `assembleContext()` 读取世界、故事核心、角色、世界规则和历史，按
  empty/partial/complete 处理，使用受治理压缩预算和完整 roster snapshot/CAS。模型只生成一个严格闭集 JSON
  候选，确认前 `characters` 零写入，确认后只经 `adopt(characters)`；刷新恢复、编辑、拒绝、同名/未知字段/
  非法枚举/stale 和终态回归均已覆盖。旧 `useAIStream → parseCharacterOutput` 自由文本旁路及死代码已删除，
  人工 CRUD、角色轴/维度选择和 Prompt 配置保留；当前不自动创建关系、物品或大纲，也不证明真实模型质量收益。
- HARNESS-34 已交付 `inspiration.reverse` 主入口收口：分步骤灵感面板通过主 Agent 定向 durable 任务执行，
  作者勾选的碎片 ID 进入计划、候选 payload 和恢复合同；Skill 只经 `read_inspiration_workspace` 与
  `assembleContext()` 读取。候选可刷新恢复、编辑、拒绝或确认，确认只经 `adopt(inspirationWorkspaces)`
  新增版本，不自动写世界观、故事核心、角色或世界组。旧面板级 `useAIStream`、直接模型调用和手工上下文装配
  已删除；现有碎片库、差异审阅、多世界预览与显式 Canon 采纳保留。当前无真实模型质量、成本或延迟 A/B。
- HARNESS-35 已交付 `outline.character-driven` 主入口收口：角色驱动开书规划把当前方案 ID 冻结进 durable plan，
  方案输入只经 `read_character_driven_plan` 读取，其它上游只经 `assembleContext()`；重新生成不注入旧方案结果。
  候选使用严格卷章合同，并校验额外字段、重复标题、未知角色、角色弧覆盖和信息释放边界。第一次确认只经
  `adopt(recordId, characterDrivenPlans)` 保存方案，第二次勾选卷才经 `adopt(outlineNodes)` 写正式大纲；旧
  `useAIStream`、自动保存、弱 parser 和无调用 Prompt 构造模块已删除。人工输入、版本、激活参考、中途重规划和
  Prompt 配置保留；角色反推世界基座与真实模型质量 A/B 不在本单元完成。
- HARNESS-36 已交付 `outline.character-revision` 主入口收口：中途重规划把角色变更、保护区、过渡区、策略、
  锚点和方案 ID 冻结进 durable plan，正式项目资料只经 `assembleContext()` 读取。模型输出须满足严格三档合同，
  代码拒绝未知/重复节点、已写或保护区 patch 和锚点改名；作者选择固化后只经 `adopt()` 写未来大纲标题/摘要，
  已有空正文行只同步标题。候选支持刷新恢复、完整 snapshot/CAS、确认后部分中断恢复和 terminal verifier；旧
  `useAIStream`、Prompt service 与非 durable patch helper 已删除。正文、主线、伏笔和只读影响建议不会自动写入。
- HARNESS-37 已交付 `outline.details` 单章细纲入口收口：章节正文页与独立细纲页共用同一 durable 控制器，
  Skill 的读取集合包含章纲、相邻章、当前细纲及世界/故事/角色/规则等登记来源，写权限只覆盖
  `detailedOutlines` 已登记字段。严格闭集 JSON 在持久候选前执行，协议错误只进入有界失败，不再二次调用模型；
  候选支持刷新恢复，确认前业务表零写入。确认会重算完整 Context Manifest，任何纳入来源变化均阻断旧候选，
  确认后只经 `adopt()` 写回并核对正式字段，匹配后才签发 terminal receipt。人工 CRUD、五阶段工坊与
  HARNESS-10 批量细纲保留；当前只有模拟模型和组件证据，没有真实模型质量 A/B。
- HARNESS-38 已交付 `character.supplement` 已有角色补全入口收口：四个角色面板保留原按钮、维度选择和反向哺喂
  开关，但只提交冻结角色 ID、字段闭集和证据开关的定向 durable 任务。`targetCharacter` 精确读取一个角色的完整
  维度，世界、故事、规则和可选剧情证据只经 `assembleContext()`；逐来源原始内容 hash 用于确认前 stale 检查。
  模型只返回所选字段的严格 JSON，候选可刷新恢复、按字段编辑、拒绝或确认，确认前正式角色零写入，确认后只经
  `adopt({ target: 'characters', recordId, mode: 'merge-diffs' })` 并由 terminal verifier 回读。旧组件直调模型、即时写回、
  宽松 parser 与死适配器已删除；隔离浏览器已覆盖生成、刷新恢复、拒绝、编辑和确认，当前不新建角色/关系、不改正文，
  也没有真实模型质量 A/B 或完整影响图证据。
- `check:agent-freshness` 已进入 CI，静态检查每个 Skill 的 owner、提示词版本、45 天复核期限和可定位回归证据；工具 schema 快照另由运行时 hash 回归防漂移。
- 应用是纯前端、本地 IndexedDB、可导出/导入和多种备份恢复路径。
- Phase 27.2a 场景考证按钮已存在；多世界、角色、地点、状态和故事线数据可作为未来运行时底座。
- SIM-1A 已建立共享互动运行时：DB v48 的 `simulationSessions / simulationEvents /
  simulationCheckpoints` 全部登记 `PROJECT_TABLES`，按项目/世界作用域参与导出导入、删除
  和父子分支重映射。
- `src/lib/simulation/runtime.ts` 以纯 reducer 回放严格连续事件；时间、实体、记忆、叙事和
  随机判定均走闭集校验。骰子由会话种子、事件序号、骰式和 nonce 确定性派生，调用方
  不能提交自选点数。
- 工作区“体验中心 → 互动运行时”已提供沙盒、NPC 演进、跑团和角色聊天四类会话壳；产品页签“角色聊天”已接入单角色聊天 MVP，
  可推进逻辑时间、掷骰、追加叙事、建立检查点/分支、刷新恢复和确认删除。继承后的当前
  叙事状态与本会话追加事件日志分开展示。
- SIM-1B 已提供作者选择式 Canon 冻结：世界、角色、地点、物品和规则保存稳定来源键、
  字段、摘要、更新时间与 SHA-256；角色/地点/物品成为独立运行时实体。会话按世界隔离，
  来源删除、导入和分支不回读或反写创作 Canon，检查点恢复建立可验证子分支。
- SIM-1C 已提供 NPC 演进候选、作者确认/拒绝、过期保护和确定性状态更新；AI 只读冻结
  `simulationRuntime`，不修改 Canon 或角色主档。
- TTRPG-1A 已提供单机战役主持：场景、回合顺序、玩家动作、手动/AI 候选技能检定、成功/失败
  分支叙事和原子回合记录。骰点与下一行动者由代码决定，刷新、检查点、分支和导出导入复用 SIM-1。
- TTRPG-1B 已提供规则与战斗遭遇：AI 遭遇候选确认、确定性先攻、攻击/伤害、资源上下限、状态效果、
  战斗回合推进和运行时回放；继续复用三张 SIM 表，不写回 Canon。
- TTRPG-1C 已提供长期战役闭环：战役摘要、任务状态/优先级/期限、NPC 时间段日程与重复方式，
  均以专用事件进入同一运行时事件流；世界时间复用 `time.advanced`，摘要更新有事件基线保护，
  分支和导出导入继承并重映射现有会话，不新增表或 Canon 写字段。

### 当前边界 / 尚未完成

- provider 原生 `tool_calls` 已作为默认关闭的 transport 优化接入唯一只读 Runner；主 Agent 已覆盖世界基座字段、
  故事核心、灵感反推、角色、故事线、角色驱动开书/中途重规划、普通大纲和正文等受治理 Skill。正文仍只支持
  空白章生成和显式续写，不覆盖手稿；这些工程闭环不等于真实模型质量已经通过发布门。
- 后台领域任务目前按依赖顺序执行，不是并行自治团队；当前有三档领域输入预算、一次
  受控确定性打回、正文采纳后的自动六域整理（也可从原手动入口查看/重跑）和只读一致性 Agent。任意单源权重、更多 Canon 闭集和
  模型投票仍未形成正式产品闭环。
- SIM-1B 已完成结构化冻结、实体投影和检查点恢复；SIM-1C 已完成 NPC 演进功能闭环：AI 只读
  `simulationRuntime` 冻结运行时上下文并生成严格结构化候选，候选作为提案事件持久化，作者确认/拒绝
  后由确定性 reducer 更新运行时位置、生命周期、标量属性、叙事和可选记忆；过期候选不可确认，Canon
  主档保持不变。TTRPG-1A/1B/1C 已完成单机战役主持、战斗遭遇和长期战役；CHATGAME-1 单角色聊天 MVP 已完成，长期记忆、多角色和冒险仍待开发。
- 协同编辑、账号、云同步、发布发现和社区治理不属于当前纯前端架构的增量功能，必须另立 PLATFORM 架构阶段。
- PRODUCT-1 已交付第一段“备份恢复可信”闭环：`inspectProjectBackup()` 只读复用 `PROJECT_TABLES` 检查版本、项目根记录和
  所有登记表的数组结构；统一 `importProjectJSON()` 在写库前拒绝损坏/未来版本输入，旧格式缺表只给兼容警告。JSON、
  文件夹、Gist 与快照恢复因此共享同一预检边界，回归为 `R-PRODUCT1-backup-trust`。
- 新手首次成果、加密云备份、帮助系统、国际化和开源信任的其余阶段仍需独立治理/产品组合；本地诊断不会自动上传。
- PLATFORM-1 已交付本地世界发布包：`PROJECT_TABLES` 的 `communityShare='world'` 是唯一分享范围声明，
  `createWorldPackage()` 生成带来源编号、许可、署名、用途、内容警告和 SHA-256 的包；`inspectWorldPackage()`
  在导入前拒绝私有表泄漏或篡改，`importWorldPackage()` 为副本分配新 `worldCode` 并保留 `communityOrigin`。
  章节、笔记、Agent/运行时存档、API 配置和个人文风不会进入包。线上账号、云同步、评论和协同仍属于后续后端阶段。

## WORLD-2 世界引擎领域重构

### 已有能力

- WORLD-2A 已完成产品语义纠偏：`enableMultiWorld` 只表示可选的多世界/位面结构；创建世界和打开完整世界工作台都不要求开启它。
- WORLD-2B 第一垂直切片复用现有分步骤数据和面板，按世界基础、世界资产、叙事设计、世界结构、状态与实例五个领域展示同一份 Canon 与运行数据。
- `PROJECT_TABLES.worldDomains` 是世界产品投影的唯一表级登记；世界内容覆盖度和 World / Work / Runtime 兼容投影从注册表批量派生，不读取正文进度，不创建第二套表。
- 世界工作台按领域深链到现有登记工作区模块；分步骤工作区继续作为 Golden Master，旧项目无需迁移或“同步为世界引擎”。
- WORLD-2C ADR 已接受：`Project` 保留为 `LocalWorkspace` 物理兼容根；显式 World/Work 位于同一工作区，
  `Work.worldId` 是绑定权威；逻辑 owner 进入现有 `PROJECT_TABLES.domainOwner`，不另建表清单。迁移按
  “schema 只加不搬 + 运行时逐工作区预检/before-image/单事务盖章”实施，第二作品入口在全链路隔离前隐藏。
  完整合同见 [WORLD-2C-WORLD-WORK-OWNERSHIP.md](../adr/WORLD-2C-WORLD-WORK-OWNERSHIP.md)。
- WORLD-2C C1 已完成：DB v49 以空升级新增 World、Work、角色作品绑定和迁移凭证；所有非 global 表在
  `PROJECT_TABLES.domainOwner` 中完成逻辑分类，现有表仍标记 `compat-project`。新增根和绑定已进入完整备份
  的便携 ID 重映射与工作区删除生命周期；真实 v48 fixture 证明升级不盖章、不搬移旧内容。
- WORLD-2C C2 已完成：项目创建和旧工作区首次进入统一经过 ownership service；只读预检从 `PROJECT_TABLES`
  派生表范围，以 SHA-256 记录主键/owner 指纹而不记录正文；持久化 before-image 后在单事务中创建或采纳默认
  World/Work、盖默认 owner 并更新兼容镜像。失败回滚、并发幂等、未知归属拒绝和有边界回滚已有反例测试。
- WORLD-2C C3-C5 已完成：核心 Store、`assembleContext()`、`adopt()`、上下文源和 Agent 记录统一经过
  `WorkspaceScope` owner gate；严格 v4 便携 owner、v1-v3 兼容、损坏 owner 拒绝、Workspace/World/Work 删除、
  双作用域原子转换及审计均从 `PROJECT_TABLES` 派生。同一 World 已开放多 Work 创建、切换和删除，双作品
  Golden Project 与浏览器 E2E 证明世界 Canon 共享而作品内容不串。
- WORLD-2D 已完成：`narrativeModules` / `narrativeNodes` 是主线、支线、任务、开局、自由探索、条件、效果、
  选择和后继的可执行合同；五类入口原子创建 `entry -> ending` 最小图，StoryArc 可重复同步而不复制正文。
  图身份、重复 key、悬空后继、入口、可达性与 JSON 都会严格校验；Work 选择当前叙事，模块可选择本作品或
  整个 World 作用域。登记的 `activeNarrativeBlueprint` 上下文按 Work 隔离并供分步骤 AI 与 Agent 共同消费。
- WORLD-2E 已完成：发布分区由 `PROJECT_TABLES` 派生，用户选择世界基础、角色、叙事、大纲和具体叙事模块，
  正文与私有参考固定排除。修订父链、逐表依赖锁、稳定 SHA-256、差异、事务一致性检查、幂等 Release 和世界包
  v2 已落地；v2 对表集、records、便携数据、依赖和 hash 严格防篡改，v1 仍按历史合同兼容。
- WORLD-2F 已完成：SIM 会话绑定 World/Work、可验证 SIM Canon 快照和 Release 便携 NarrativeModule ID；草稿
  节点图、条件、效果、选择和变量在实例创建时冻结。确定性推进、过期序列拒绝、回放、检查点和分支继承统一
  使用原 event/reducer；跑团、角色聊天、文字游戏和 NPC 演进四类实例相互隔离，文字游戏已有实际运行入口。

### 当前边界 / 尚未完成

- `Project` 仍是 IndexedDB 兼容存储边界，`worldCode` / `worldVersion` 仍保留为当前 World/Release 的兼容
  镜像；删除这些镜像需要后续独立 ADR，不能在普通功能改动中顺手移除。
- 世界完整度当前只表达领域覆盖，不冒充引用完整、Canon 冲突或发布准备度；后续验证能力必须复用三注册表和已有一致性检查器。
- 本地世界引擎基座完成不等于社区平台完成；账号、云发布、发现、订阅、fork、协作和治理仍属于 PLATFORM-1B/1C。
- Harness/Agent 执行体系不在 WORLD-2 中扩张；先在完整保留的分步骤模式完成 HARNESS-2，再评估迁移。
- WORLD-2F 完成的是本地共享运行时与冻结绑定，不等于四个上层产品的全部体验都已成熟；新增规则系统、长期
  记忆、多人协作或玩法 UI 时必须消费该基座，不能另造平行状态机。

## 新开发前的最小核对清单

- [ ] 已读本文件中对应体系的“已有能力 / 当前边界 / 禁止重复建设”。
- [ ] 已在 `docs/roadmap/README.md` 当前入口登记唯一主归属和非范围。
- [ ] 已定位 `CONTEXT_SOURCES`、`FIELD_REGISTRY`、`ADOPTION_SCHEMA`、`PROJECT_TABLES` 影响。
- [ ] 已搜索 `tests/` 中相关回归、迁移、导入导出和浏览器测试。
- [ ] 已确认是否取代旧入口，是否保留兼容字段。
- [ ] 已写清本次增量不会重新实现哪些已有能力。
