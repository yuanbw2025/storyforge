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
| **GOV-1 架构与数据安全** | Phase 0/1/2/3 基础；`AUDIT-1/1b/2/3/4`；`HEALTH-2/3/6`；R1-R6 审查；GOV-1 P1 | 三注册表、生命周期派生、参考分析 adopt 收口、领域扩展、真实 AI Manual、依赖/覆盖率/规模/构建发布守卫 | `CLAUDE.md`、`MASTER-BLUEPRINT.md`、`scripts/check-architecture.mjs`、`scripts/generate-ai-manual.mjs`、`scripts/generate-project-metrics.mjs` |
| **INV-1 物品与状态** | `CONSISTENCY-1`；`QUICKWIN-1/2/5`；C-3/C-4；物品/状态基础 | itemLedger、held-items、状态卡聚合、物品编辑、来源提示 | `R-CONSISTENCY1-held-items`、`R-QUICKWIN2-inventory-edit`、`R-QUICKWIN5-state-inventory-source` |
| **CANON-1 连续性与记忆** | Phase A/B/C；NS-1/T1-T8、NS-2、NS-3、NS-4/5/6 代码基础 | 章节记忆、handoff、计划对账、规范章序、temporalFacts、检索、层级摘要、影响分析、事实审查 | `tests/regression/R-NS1-*`、`R-NS3-*`、`R-NS4-*`、`R-NS5-*`、`R-NS6-*` |
| **PIPE-1 创作与大纲** | Phase D/F；B 组；`QUICKWIN-4/6`；`EDITOR-1/3/4`；`ENH-OUTLINE-1` | 大纲生成、空节点补全、已写正文进度、跨卷拖动、全文查找替换、对照润色、实体补全 | `R-AUDIT6-*`、`R-EDITOR1-*`、`R-EDITOR3-*`、`R-EDITOR4-*`、`R-QUICKWIN6-*` |
| **WORLD-1 世界知识** | Phase 20/22/23/25/32；C-1/C-2/C-6/C-7；Phase 36；多世界 25.4/25.5 | Codex、重要地点、地图、世界规则、多世界、历史年表、上游/下游导航 | `R-PHASE36-content-types`、Codex/location 回归、`WORLD-RULES-MULTIWORLD-DESIGN.md` |
| **AUTHOR-1 作者工具** | Phase E/H；基础文风学习；编辑器基础；`CF-20260702-5/10/11` | 本地模型配置、任务路由、文风基础、富文本、自动保存、对照润色 | `R-EDITOR3-*`、本地模型与任务路由回归 |
| **IDEA-1 灵感与参考** | Phase 26.4；Phase 28/28.5；参考作品导入/分块/分析；角色 AI 聚合去重 | 灵感反推、参考资料分析、角色聚合、AI 去重、结果持久化 | 参考/导入回归、`docs/ROADMAP-LEGACY.md` 对应历史记录 |
| **AGENT-1 前置能力** | Phase 16/17 工作流；模型路由；Phase 27.2a 场景考证 | Prompt workflow、任务模型路由、用户触发的场景考证 | `AI-COPILOT-DESIGN.md`、现有 workflow / provider 测试 |
| **PRODUCT-1 可靠性与发布** | 数据云备份、导出/导入、快照、PWA/Vite、版本与 Release 相关修复、社区反馈批次 | 本地优先、JSON/文件夹/Gist/快照恢复、生产构建和 CI | `R-export-import-roundtrip`、`R-folder-backup`、`R-gist-backup`、CI |

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

- `INVENTORY-1`：角色归属、迁移和全链路同步未完成。
- `CONSISTENCY-2/3`、完整 `CONSISTENCY-0`：认知账本、世界宪法和覆盖基线未完成。
- `PIPELINE-1/2/3`：透明提示词、章纲工坊和 Agent 节点化未完成。
- Phase 34/35/37 的完整词条、修炼、力量阶段闭环未完成。
- `EDITOR-2/5`、`FB-4`、`FB-5` 高级校准、`CM-1` 未完成。
- Phase 27.1 多 Agent、27.2b 后台建议、27.3 NPC 演进未完成。

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
