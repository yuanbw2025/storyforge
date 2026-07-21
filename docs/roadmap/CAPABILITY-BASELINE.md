# StoryForge 当前能力基线

> 本文件回答“项目现在已经有什么”。它是新开发单位开工前的必读事实层，不是未来计划，也不是历史流水账。
>
> 事实来源优先级：当前代码与测试 > `MASTER-BLUEPRINT.md` > `docs/ROADMAP-LEGACY.md` 中的完成记录。文档声称完成但缺少代码/测试证据时，按“部分完成”处理，不得据此重新开发或宣称已交付。

## 如何使用

开始任何新功能前，必须先找到对应体系，完成以下核对：

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
- `check:architecture`、`check:required-tables`、`check:source-reachability`、AI manual 检查和 CI 已存在。
- 数据迁移、导入导出、备份、删除和关键 UI 流程已有大量回归测试。

### 当前边界 / 尚未完成

- 参考作品分析 pipeline 仍需正式收口到字段注册与 adopt 约束。
- AI manual 生成与检查逻辑仍需独立、可证明地避免“假绿”。
- 架构检查仍需扩大到 `src/lib/**` 的旁路和文档语义真实性。
- 生产依赖安全、运行时覆盖率、发布元数据和 Blueprint 规模状态仍需治理。

### 新功能必须复用

- 新 AI 读：`src/lib/registry/context-sources.ts`、`assemble-context.ts`。
- 新 AI 写：`src/lib/registry/field-registry.ts`、`adoption-schema.ts`、`adopt.ts`。
- 新表/字段生命周期：`src/lib/registry/project-tables.ts`、`src/lib/db/schema.ts`。

## INV-1 角色物品与状态账本

### 已有能力

- `itemLedger` 已有获得/消耗流水、编辑能力、章节关联和 `adopt()` 写回。
- `CONTEXT_SOURCES` 已能把物品流水注入生成上下文。
- `checkHeldItemAcquisition` 已能按章节顺序检测“已持有物品被再次写成首次获得”。
- 状态卡、物品栏、故事年表和结构化抽取已有共享组件/adapter/测试。

### 本次增量（仍待开发）

- `heldByName` + `characterId` 持有人模型。
- 主角/配角/NPC 背包切换和角色状态卡统一投影。
- 明确的实际获得、目标/提及排除、转移方向判断。
- owner-less 历史数据迁移、角色删除/合并、导入导出 remap。
- `QUICKWIN-3` 的全部已写章节/自定义范围作为按角色提取的一部分交付。

### 禁止重复建设

- 不新建第二套物品表或第二套持有投影。
- 不在 `InventoryPanel` 内手写 AI 提取器、去重或上下文拼接。
- 不删除角色对应的物品流水；删除角色只解除硬引用并保留持有人原文。

### 代码与测试入口

- `src/lib/consistency/held-items.ts`
- `src/lib/registry/context-sources.ts`
- `src/lib/registry/adoption-schema.ts`
- `src/lib/registry/project-tables.ts`
- `src/components/items/InventoryPanel.tsx`
- `tests/regression/R-CONSISTENCY1-held-items.test.ts`
- `tests/regression/R-QUICKWIN2-inventory-edit.test.ts`

## CANON-1 长期一致性与 Canon

### 已有能力

- 章节规范顺序、连续性交接、章节记忆、计划对账和未来章节过滤已有实现。
- `temporalFacts`、受控谓词、当前有效事实、事实候选确认、异常状态和 human-readable IO 已有代码基础。
- `retrievalChunks`、层级叙事摘要和影响分析已有可重建路径。
- `NS-3` 一致性审查已有 Fast Guard / Deep Audit 和逐字引文回查。
- 物品重复获得是当前唯一已落地的确定性语义判决样板。

### 当前边界 / 尚未完成

- 认知/知识账本尚未形成角色知道、未知、误认的完整闭环。
- 世界宪法和设定断言冲突检测尚未覆盖世界起源、力量体系等互斥场景。
- 一致性覆盖地图和 `tests/regression/` 反例体系需要持续成为活基线；若未来建立专门的 `tests/canon/`，必须先登记其边界和与现有回归的关系。
- 故事线动态进度、交叉和角色变化影响尚未形成统一产品出口。
- 内联编辑器提示尚未把确定性 finding 映射到编辑器装饰层。

### 禁止重复建设

- 不把向量召回或 LLM 软审当作 Canon 判决器。
- 不为 Phase 38、Phase 39、Agent 各建一套事实库。
- 不在生成后自动改正文；所有软结果都要经过作者确认。

### 代码与测试入口

- `src/lib/consistency/`
- `src/lib/fact-ledger/`
- `src/lib/retrieval/`
- `src/lib/registry/assemble-context.ts`
- `tests/regression/R-NS3-consistency-audit.test.ts`
- `tests/regression/R-NS4-current-facts.test.ts`
- `tests/regression/R-NS5-retrieval.test.ts`
- `tests/regression/R-NS6-impact.test.ts`

## PIPE-1 透明生成与质量工作坊

### 已有能力

- Prompt seed、Prompt store、WorkflowRunner、模型路由和上下文装配已存在。
- 卷纲/章纲已有批量生成、空节点补全、已写正文进度和主线约束。
- AI 输出已有确认、采纳和结构化写回路径。

### 当前边界 / 尚未完成

- 最终发送前的提示词预览与编辑尚未成为统一生成节点能力。
- 分阶段章纲工坊、节点 gate、批量改进和评估历史尚未形成一条正式管线。
- 不能在 Outline、Chapter、Agent 各自新写一套生成编排。

### 代码与设计入口

- `src/lib/ai/`
- `src/lib/registry/assemble-context.ts`
- `src/components/settings/prompt/WorkflowRunner.tsx`
- `docs/TRANSPARENT-GENERATION-PIPELINE.md`

## WORLD-1 世界知识、词条、地图与修炼

### 已有能力

- Codex 分类、词条、字段 schema、引用选择器和多世界作用域已存在。
- 世界规则、多世界、历史年表、重要地点、地图和角色设计已有产品能力。
- Phase 36 已为上游设定、正文、下游产物和系统入口建立内容类型标记。

### 当前边界 / 尚未完成

- 自然/人文词条分类、人工器物并入、势力合并、历史线归并尚未完整收口。
- 自定义分类/字段与 AI 导入分类仍需完整端到端交付。
- 修炼体系、角色力量阶段和异兽关联仍未形成完整下游产物。
- 地图的距离、规模和相对位置增强仍待设计确认。

### 代码与设计入口

- `src/components/codex/CodexPanel.tsx`
- `src/lib/registry/project-tables.ts`
- `docs/CODEX-REDESIGN.md`
- `docs/WORLD-RULES-MULTIWORLD-DESIGN.md`

## STORY-1 角色驱动与动态故事规划

### 已有能力

- 角色双轴（戏份、道德/秩序）模型、角色关系、StoryArc 和大纲主线约束已有基础。
- 角色生成、大纲生成、故事线和章节上下文已有注册表入口。

### 当前边界 / 尚未完成

- 角色修改后的影响范围分析和弧光重规划仍未形成用户确认闭环。
- 不应另造 StorylineProgress 之外的第二套线索概念；动态进度由 CANON-1 负责事实底座。

## AUTHOR-1 / IDEA-1 长篇编辑、风格与灵感

### 已有能力

- 富文本编辑、自动保存、对照润色、全文查找替换、实体补全和悬浮档案已存在。
- 基础文风学习、参考作品导入/分块/分析、灵感反推和草稿持久化已存在。

### 当前边界 / 尚未完成

- 智能全书改名、实体引用安全重映射尚未交付。
- 原稿风格续写、高级 few-shot/互动校准和多次灵感融合尚未交付。
- 参考分析的写回旁路必须先由 GOV-1 收口，不能直接扩展。

## AGENT-1 / SIM-1 / PRODUCT-1 / PLATFORM-1

### 已有能力

- 当前 AI 主要是用户触发的单轮生成、流式输出、确认和采纳；已有模型路由和部分 Agent/工具基础。
- 应用是纯前端、本地 IndexedDB、可导出/导入和多种备份恢复路径。
- Phase 27.2a 场景考证按钮已存在；多世界、角色、地点、状态和故事线数据可作为未来运行时底座。

### 当前边界 / 尚未完成

- ChatCopilot、多 Agent 团队、后台 Agent 和 NPC 自动演进仍未形成正式产品闭环。
- 协同编辑、账号、云同步、发布发现和社区治理不属于当前纯前端架构的增量功能，必须另立 PLATFORM 架构阶段。
- 新手转化、加密云备份、帮助系统、国际化和开源信任仍需独立治理/产品组合。

## 新开发前的最小核对清单

- [ ] 已读本文件中对应体系的“已有能力 / 当前边界 / 禁止重复建设”。
- [ ] 已在 `docs/roadmap/README.md` 当前入口登记唯一主归属和非范围。
- [ ] 已定位 `CONTEXT_SOURCES`、`FIELD_REGISTRY`、`ADOPTION_SCHEMA`、`PROJECT_TABLES` 影响。
- [ ] 已搜索 `tests/` 中相关回归、迁移、导入导出和浏览器测试。
- [ ] 已确认是否取代旧入口，是否保留兼容字段。
- [ ] 已写清本次增量不会重新实现哪些已有能力。
