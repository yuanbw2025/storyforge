# StoryForge 已完成开发索引

> 本文件回答“以前已经交付了什么”。它只做索引，不复制完整实现说明；迁移前的原始细节保存在 [ROADMAP-LEGACY.md](../ROADMAP-LEGACY.md)，当前可复用能力以 [CAPABILITY-BASELINE.md](./CAPABILITY-BASELINE.md) 为准。

## 使用规则

- “已完成”只表示当时的开发单位有代码和验证记录，不代表未来体系不再扩展。
- 标记“部分完成”的条目不能被新任务当作从零开始，也不能被当作完整能力直接复用；先看能力基线的剩余边界。
- 被新体系取代的旧方案保留历史记录，但禁止重新实现。
- 详细实现记录、原始用户故事和历史讨论统一回查 `docs/ROADMAP-LEGACY.md` 的原任务 ID。

## 按体系索引

| 体系 | 已交付开发单位 / 原 ID | 当前可复用能力 | 主要证据 |
|---|---|---|---|
| **GOV-1 架构与数据安全** | Phase 0/1/2/3 基础；`AUDIT-1/1b/2/3/4`；`HEALTH-2/3/6`；R1-R6 审查；GOV-1 P1；Agent 上下文输入治理 | 三注册表、生命周期派生、参考分析 adopt 收口、领域扩展、真实 AI Manual、依赖/覆盖率/规模/构建发布守卫、按任务上下文路由与固定输入防回退 | `AGENTS.md`、`CLAUDE.md`、`docs/CONTEXT-ROUTING.md`、`MASTER-BLUEPRINT.md`、`scripts/check-agent-context.mjs`、`scripts/check-architecture.mjs`、`scripts/generate-ai-manual.mjs`、`scripts/generate-project-metrics.mjs` |
| **INV-1 物品与状态** | `INVENTORY-1`；`QUICKWIN-1/2/3/5`；C-3/C-4；按角色物品/状态账本 | 双持有人模型、角色背包切换、状态投影、规范章序提取范围、按角色一致性、历史迁移、删除/合并和导入导出 remap | `R-INV1-*`、`R-QUICKWIN3-inventory-extraction-range`、`R-CONSISTENCY1-held-items`、`R-QUICKWIN2-inventory-edit`、`R-QUICKWIN5-state-inventory-source` |
| **CANON-1 连续性与记忆** | Phase A/B/C；NS-1/T1-T8、NS-2、NS-3、NS-4/5/6 代码基础；`CONSISTENCY-0/2/3`；存亡时序 | 章节记忆、handoff、计划对账、规范章序、temporalFacts、检索、层级摘要、影响分析、事实审查、可执行覆盖基线、角色认知、世界宪法、角色存亡闭集判决 | `tests/canon/R-CANON-*`、`scripts/check-canon-coverage.mjs`、`tests/regression/R-CONSISTENCY2-*`、`tests/regression/R-CONSISTENCY3-*`、`tests/regression/R-CONSISTENCY4-*`、`R-NS1-*`、`R-NS3-*`、`R-NS4-*`、`R-NS5-*`、`R-NS6-*` |
| **MEMORY-1 可编辑长期记忆工作区** | `MEMORY-0～10`、`MEMORY-CLOSE-1～3`、`MEMORY-STORAGE-1` | IndexedDB / 硬盘三方核对、稳定 Workspace/World/Work 身份、显式双向同步、章节 Markdown 与故事核心/创作规则 YAML、冲突与影响计划、Harness 原子记忆结算、Deep Audit durable Run、恢复胶囊、项目自有存储位置和十万字级多 World/Work 恢复验收 | `R-MEMORY-*`、`R-MEMORY-CLOSE*`、`R-MEMORY-STORAGE1-*`、`tests/e2e/memory-workspace.spec.ts`、`MEMORY-ENGINEERING-DEVELOPMENT-PLAN-20260817.md`、`MEMORY-ENGINEERING-CLOSURE-CHARTER-20260817.md` |
| **PIPE-1 创作与大纲** | Phase D/F；B 组；`QUICKWIN-4/6`；`EDITOR-1/3/4`；`ENH-OUTLINE-1`；`PIPELINE-1/2/3` | 大纲生成、空节点补全、已写正文进度、跨卷拖动、全文查找替换、对照润色、最终提示词编辑、五阶段章纲工坊、确定性 gate、Workflow 节点适配 | `R-AUDIT6-*`、`R-EDITOR1-*`、`R-EDITOR3-*`、`R-EDITOR4-*`、`R-QUICKWIN6-*`、`R-PIPELINE1-*`、`R-PIPELINE2-*`、`R-PIPELINE3-*` |
| **WORLD-1 世界知识** | Phase 20/22/23/25/32；C-1/C-2/C-6/C-7；Phase 36；多世界 25.4/25.5；WORLD-1 世界隔离地基；Phase 37-a；Phase 34；Phase 35-b/c；ENH-WORLDMAP-2 | Codex、重要地点、地图、世界规则、多世界、正式历史、严格世界隔离、修炼体系 DAG、正文修炼进度、政经文化拆分、城池地点软关联、外部导入证据候选、空间约束地图与可信比例尺 | `R-PHASE36-content-types`、`cultivation-system.test.ts`、`cultivation-progress.test.ts`、`R-WORLD1-*`、`R-worldmap-spatial-layout`、Codex/location/import 回归、浏览器世界知识/词条导入/地图流程 |
| **WORLD-2 世界引擎领域重构** | WORLD-2A / 2B / 2C C1-C5 / 2D / 2E / 2F | 完整世界工作台、显式 World/Work owner、严格 v4 备份、双作用域转换、可执行叙事、不可变修订/Release、世界包 v2，以及跑团/聊天/文字游戏/NPC 演进的统一冻结实例绑定 | `R-WORLD2-*`、`R-WORLD2C-*`、`R-export-fullcoverage`、Chromium 多作品与叙事发布 v2 闭环、`WORLD-ENGINE-COMMUNITY-ARCHITECTURE.md` |
| **STORY-1 角色驱动与动态规划** | `CF-20260702-9/12` | 持久化角色驱动工作区、版本链、active 上下文源、中途变更影响分析、三档未来大纲 patch、正文保护和过期预览拒绝 | `R-CF9C-*`、`R-CF12-character-revision`、Chromium 角色驱动与中途重规划流程 |
| **AUTHOR-1 作者工具** | Phase E/H；`FB-5` 基础画像与高级校准；编辑器基础；`CF-20260702-5/10/11`；`EDITOR-5` | 本地模型配置、任务路由、有界文风 few-shot 与互动校准、富文本、自动保存、对照润色、稳定实体智能全书改名与原子撤销 | `R-EDITOR3-*`、`R-EDITOR5-entity-rename`、`R-FB5-*`、Chromium 文风闭环 |
| **IDEA-1 灵感与参考** | Phase 26.4；Phase 28/28.5；`CM-1`；参考作品导入/分块/分析；参考分析版本演化；角色 AI 聚合去重 | 灵感反推、带来源碎片、增量融合、字段差异、确认版本、参考资料来源声明、失败隔离、断点续跑、版本差异/激活/回滚、active-only 上下文、角色聚合与 AI 去重 | `R-CM1-*`、`R-IDEA1-*`、`INCREMENTAL-INSPIRATION-DESIGN.md`、`REFERENCE-ANALYSIS-EVOLUTION-DESIGN.md` |
| **AGENT-1 / HARNESS / CREL** | Phase 27 主 Agent；HARNESS-0～86；CREL-0～14 | Master Agent、领域 Skill/闭集工具、Run Contract、durable ledger/checkpoint/lineage/receipt、作用域与信息边界、核心入口迁移、影响 DAG、分级创作产物、1+1 成本停止、确定性归一化、一次定向修复和部分设定叙事脚手架；工程主架构与 CREL 开发已完成并进入实验性社区观察。历史 held-out FAIL 与作者 A/B 0/6 保留，旧 A/B/质量门由产品决策关闭而非通过 | `R-AGENT1-*`、`R-HARNESS*`、`R-CREL*`、`AI-HARNESS-REBUILD-HANDOFF-20260810.md`、`AI-CREATIVE-RELIABILITY-DEVELOPMENT-20260816.md`、`AI-HARNESS-REBUILD-RELEASE-20260817.md`、`adr/HARNESS-COMMUNITY-VALIDATION.md` |
| **SIM-1 互动运行时** | SIM-1A / SIM-1B / SIM-1C | 事件回放、确定性骰子、检查点与分支；Canon 冻结快照与运行时实体投影；NPC 演进候选、提案持久化、作者确认/拒绝、过期保护、运行时只读上下文和 Canon 不变性 | `R-SIM1-runtime-core`、`R-SIM1-canon-snapshot`、`R-SIM1C-npc-evolution`、`R-SIM1-runtime-ui`、`SIM-RUNTIME-DESIGN.md` |
| **TTRPG-1 跑团与战役主持** | TTRPG-1A / 1B / 1C | 单机战役场景、回合顺序、动作、确定性技能检定、AI GM 成功/失败候选、原子回合记录、AI 遭遇候选确认、确定性先攻、攻击/伤害、资源上下限、状态效果、战斗回合、战役摘要、任务、NPC 日程和会话分支续接；不包含多人协作 | `R-TTRPG1-campaign-runtime`、`R-TTRPG1-gm-parser`、`R-TTRPG1B-combat-encounter`、`R-TTRPG1C-long-campaign`、`R-SIM1-runtime-ui`、`TTRPG-CAMPAIGN-DESIGN.md` |
| **CHATGAME-1 角色聊天与冒险** | 单角色聊天 MVP | 冻结角色与世界快照、用户身份/场景、流式回复、事件持久化、回复重生成、检查点和会话分支；不包含长期记忆、多角色房间和冒险规则 | `R-CHATGAME1-single-character-chat`、`INTERACTIVE-RUNTIME-ROADMAP.md` |
| **FLOW-3E 节点大图生产力** | 大图效率、模板与可恢复执行 | 官方起始模板、百节点自动布局、框选/复制/对齐/分组、执行计划、暂停/断点恢复、过期下游重跑、运行快照往返与密钥脱敏 | `R-FLOW3E-productivity`、`NODE-AUTHORING-MODE-DESIGN.md` |
| **FLOW-3F 节点兼容发布** | FLOW-2 兼容收口与正式入口统一 | 旧图兼容读取、显式 graph v2 转换、未知节点 fail-closed、项目备份往返和旧入口下线 | `R-FLOW3F-compat-release`、`NODE-AUTHORING-MODE-DESIGN.md` |
| **FLOW-1 历史技术试验（非节点模式产品完成）** | FLOW-1 第一阶段 | 旧工作流兼容图、DAG 校验、拓扑执行、显式入边装配和确认写回的技术验证；产品层级已于 2026-07-26 撤销，迁移归 FLOW-2 | `R-FLOW1-*`、`R-WF-workflow-step-context`、`VISUAL-WORKFLOW-DESIGN.md` |
| **PRODUCT-1 可靠性与发布** | 数据云备份、导出/导入、快照、PWA/Vite、版本与 Release 相关修复、社区反馈批次；当前阶段新增备份恢复可信预检 | 本地优先、JSON/文件夹/Gist/快照恢复、生产构建和 CI；损坏/未来版本备份在写库前拒绝，旧格式缺表兼容警告 | `R-export-import-roundtrip`、`R-folder-backup`、`R-gist-backup`、`R-PRODUCT1-backup-trust`、CI |
| **PLATFORM-1 本地世界发布包** | v1 兼容包与绑定不可变 Release 的 v2 包；声明署名、许可、内容警告和二创用途，导入前校验并生成新的本地世界副本 | 仅分享 `PROJECT_TABLES.communityShare='world'` 登记和发布时选定的世界/叙事资料，保留来源、依赖哈希与当前叙事；不包含正文、运行存档、账号或云同步 | `R-PLATFORM1-world-package`、`R-WORLD2C-2F-completion`、Chromium v1/v2 本地分享包 E2E、`PLATFORM-1-LOCAL-PUBLISHING.md` |

## 主要已完成批次

以下批次的完整正文、原始背景和实现说明都保留在历史快照中：

- Phase 1–7：基础架构与核心创作流程。
- Phase 8–11：界面抛光与提示词参数化。
- Phase 16–18：工作流引擎和分块导入流水线。
- Phase A–H：记忆、故事线、伏笔、大纲、题材、质量、角色和历史增强。
- Phase 20–26、28、30–33：地图、Token、模板、导出、多世界、NVIDIA NIM、角色驱动和灵感反推。
- 6 月 17 日 A/B/C/D/E 批次：章节创作、大纲、设定库、角色和全局 UI。
- 2026-06-30、2026-07-02、2026-07-03 社区反馈批次：已完成项目保留原 ID 和 commit 记录。
- 近期 UI/维护批次：`AUDIT-6` 已完成多批视图拆分，但仍有剩余治理项；不要把“已经拆过几批”误判为整项治理完成。

## 不能当作已完成的条目

以下内容在历史文档中可能出现“有主链路”“代码已具备”或“设计已完成”，但仍有明确剩余边界，必须回到 [当前能力基线](./CAPABILITY-BASELINE.md) 和 [当前路线图](./README.md) 判断：

- WORLD-1 的 Phase 37-a、Phase 34、Phase 35-b/c 与 ENH-WORLDMAP-2 距离、规模和相对位置已完成。
- `FB-4` 与个人写作向量库未完成；`CM-1`、`EDITOR-2/5` 与 `FB-5` 高级校准已完成。
- Phase 27.1 多 Agent、27.2b 后台建议仍有未完成边界；NPC 演进已由 SIM-1C 完成，不再按旧 Phase 27.3 单独立项。

## 迁移审计账本

迁移不是按“看到绿色就搬去已完成”机械处理。`docs/ROADMAP-LEGACY.md` 中共有 197 个二至四级标题，其中 166 个标题带状态词、状态图标或阶段语义。迁移检查把它们分为五类：

| 类别 | 标题数 | 当前落点 | 裁决规则 |
|---|---:|---|---|
| 活跃 / 未来 | 31 | `README.md` 的唯一功能体系 | 有明确待开发、长期或未规划语义；必须有当前归属。 |
| 部分 / 待复核 | 11 | `README.md` 边界表 + `CAPABILITY-BASELINE.md` | 不可宣称完整完成，也不可从零重做。 |
| 已完成 | 115 | 本文件的体系索引和批次索引 | 只证明历史交付；实际复用仍以当前代码和测试为准。 |
| 关闭 / 下线 | 2 | 本文件下方“关闭与取代” | 禁止恢复旧入口或旧系统。 |
| 历史语义 | 7 | `docs/ROADMAP-LEGACY.md` | 只是分区、排期或治理说明，不生成新任务。 |

上述数字由 `scripts/check-roadmap.mjs` 从不可变快照重新计算并锁定；任何分类数量漂移都会让 CI 失败。历史快照仍是字节级原文，分类只决定“现在去哪里找”，不改写历史。

### 历史“部分完成”标题的最终裁决

| 历史标题 | 已交付范围 | 当前是否存在隐含待办 |
|---|---|---|
| Phase 26（部分） | 26.1/26.2；另有 26.3 角色驱动、26.4 灵感反推完成记录 | **否**。后续角色驱动增量已显式归 STORY-1，不能按缺号推断。 |
| Phase 28（部分） | 28.1～28.5 已分别有完成记录 | **否**。新的参考资料演化显式归 IDEA-1。 |
| Phase 30（部分） | 30.1～30.5 已分别有完成记录 | **否**。透明生成新工作显式归 PIPE-1。 |
| Phase 31（部分） | 31.1/31.2 已完成 | **否**。31.3 已被 Phase 32 世界规则体系取代，禁止恢复旧方案。 |
| `CF-20260702-11` 第一阶段 | 模型列表刷新与选择完成 | Ollama pull 仅是候选扩展，须重新登记独立小功能。 |
| `FB-3 原始记录` | 早期误判和部分修复记录 | 后续完整 `FB-3` 已闭环；原始记录仅用于追溯。 |

### 关闭与取代

- Phase 19 大师研读系统已下线，由“项目参考 → 作品分析”取代；禁止恢复旧表、旧入口。
- Phase 29 已关闭，现有 Prompt 能力被判定满足当时需求。
- Phase 31.3 的 creativeMode 联动被 Phase 32 世界规则体系取代。
- `.bat` / `.exe` / Portable 启动器路线被 v3.7.5 源码包 + npm 分发取代；只保留 localhost Service Worker 数据安全结论。

## 历史核对入口

- 原任务 ID 全量快照：[ROADMAP-LEGACY.md](../ROADMAP-LEGACY.md)
- 当前已有能力：[CAPABILITY-BASELINE.md](./CAPABILITY-BASELINE.md)
- 当前待开发组合：[README.md](./README.md)
- 架构与施工权威：[`../MASTER-BLUEPRINT.md`](../MASTER-BLUEPRINT.md)
