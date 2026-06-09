# StoryForge 重构施工蓝图（v2 · 最终版）

> **本文档是项目重构的唯一施工权威**。综合本轮全量审计 + GPT 5.5 独立代码审查结论后重写。
> 替代 `docs/ARCHITECTURE-REFACTOR.md`（v1，已部分失效，见 §0.4）。
> 目标读者：任何接手该项目的开发者或 AI 模型。
> 创建：2026-06-04 ｜ v2 修订基线：仓库 `main` 分支 HEAD（commit `1d28158` 后）。

---

## 〇、文档元信息（先读这一节）

### 0.1 这份文档是什么

这份文档是 StoryForge 项目从「能跑但有漏洞」状态，重构到「质量优秀、可参评开源项目大赛」状态的**完整施工蓝图**。它包括：

- 项目当前真实状态（含已确认的严重漏洞与无效修复）
- 重构目标与判据（每阶段、整体）
- 四个施工阶段（Phase 0/1/2/3）的逐项任务（带文件路径、行号、问题描述、改法、验证方法）
- 三支柱架构的强化版定义（含 TypeScript 数据结构与派生 API）
- AI 行为说明书自动生成器规格
- 测试与 CI 策略
- 接手指南（任何模型/任何人）
- 完成判据
- 维护规约

### 0.2 你应该如何读

| 你的角色 | 推荐阅读顺序 |
|---|---|
| 第一次接手项目 | §0 全部 → §1 → §2 → §10 → §4（开始动手） |
| 继续未完成的工作 | §0.5 现状速查 → §4 找到当前 Phase → 本阶段任务 |
| 评估方案合理性 | §1 → §2 → §3 → §5 → §11 → §13 |
| 已经动手出问题 | §10 风险与回滚 → 重读对应 §4 任务 |

### 0.3 这份文档与其他文档的关系

| 文档 | 地位 | 用途 |
|---|---|---|
| **`MASTER-BLUEPRINT.md`（本文档）** | 🔴 施工权威 | 唯一可执行的重构蓝图 |
| `DATA-FLOW-MAP.md` | 🟡 历史审计记录 | 看本轮审计批次记录、漏洞清单（部分已过期，见 §0.4） |
| `DATA-FLOW-DIAGRAM.md` | 🟢 可视化辅助 | Mermaid 流程图，看关系全貌（注意：图中"已修"标记部分实为无效修复） |
| `AI-FUNCTIONS-MANUAL.md` | ⚠️ 已废弃手写版 | **不可信** — 21 处 prompt key 错、多处读写关系错。重生成机制见 §6 |
| `ARCHITECTURE-REFACTOR.md` | 🔴 v1 已废弃 | 被本文档取代（§0.4） |
| `ROADMAP.md` | 🟢 任务清单 | 高/中/低优先级任务索引（部分需根据本文档重新分级） |
| `CHANGELOG.md` | ⚠️ 不完整 | 仅记录前几批修复；本轮后期修复未补，且有数条"修了实际无效"的（见 §1.3） |
| `WORLD-RULES-MULTIWORLD-DESIGN.md` | 🟢 待实施 | Phase 40 多世界化（本蓝图 Phase 2.1 实施） |
| `CODEX-REDESIGN.md` | 🟢 待实施 | Phase 35 词条化（本蓝图后续） |
| `CONSISTENCY-CHECK-DESIGN.md` | 🟢 待实施 | Phase 38/39（本蓝图后续） |
| `AI-COPILOT-DESIGN.md` | 🟢 远期 | Phase 27 Agent 化（不在本蓝图覆盖） |

### 0.4 v1 → v2 重大变更

本文档相对于 `ARCHITECTURE-REFACTOR.md`（v1）的关键差异：

| v1 | v2 |
|---|---|
| 三支柱方向（PROJECT_TABLES / R-1 / R-2） | 保留方向，**全部强化** |
| `refs` 只支持简单 `table[field]` | 扩展为支持 **JSON 引用 / 数组引用 / 间接归属 / Blob owner** |
| `PROJECT_TABLES.scope` 三选一 | 扩展为 `owner` 五类（project/direct/indirect/transient/blob/global），含 `projectResolver` |
| `FIELD_REGISTRY` 只覆盖单字段 | 引入 **`AdoptionSchema`**，覆盖集合写回、去重、FK 校验、merge 策略 |
| `CONTEXT_SOURCES` 部分声明 `world` 实际仍 global | 强制每个 source `scope` 必须有测试断言；`worldGroupId` 必须显式 |
| Stage A→B→C 三阶段 | **扩展为 Phase 0/1/2/3 四阶段**（Phase 0 为紧急修复，因为已有"修了实际无效"的代码必须立即纠正） |
| 无 Phase 0（紧急修复） | **新增 Phase 0**：7 项必须立刻修，否则地基建在沙上 |
| 缺测试/CI 策略 | 新增 §7 完整测试与 CI lint 规格 |
| 缺 AI 说明书生成器 | 新增 §6（说明书禁止手写为事实源） |

### 0.5 接手者第一周清单（关键起步动作）

**Day 1**：通读本文档 §0–§3 + §10；clone 仓库、`npm install` 跑通；`npm run dev` 启动确认线上代码可运行。

**Day 2**：扫一遍 §1 全部子节（项目真实状态），尤其是 §1.3「已确认无效的修复」，理解地基的真实牢度。

**Day 3**：跑一遍 §7.1 反例测试网（如果已建立）；如果未建立，按 §7.1 先创建几条最关键的（导出/导入往返、deleteGroup 完整性）。

**Day 4–5**：开始 Phase 0 第一个任务（§4.0.1 `deleteGroup` 事务声明）。**严格按"前置条件 → 改法 → 验证"流程执行**，不省略验证。

**任何时候你不确定**：停下，写到 ROADMAP 待开发列表里，提问，不要"我觉得这样应该 OK"。

---

## 一、项目当前真实状态

### 1.1 规模与技术栈

```
代码：282 个源文件 / 59020 行（src/**/*.{ts,tsx}）
DB：Dexie.js IndexedDB v26 / 45 张表（其中约 27 张项目级数据 + 5 张全局 + 13 张衍生/临时）
组件：~70 个面板 + 子组件
AI：35 个 PromptModuleKey + 59 处实际 ai.start/chat 调用（39 处未传 meta category）
栈：React 19 / TypeScript 5 / Zustand 5 / Dexie.js / Vite / TipTap
特殊：纯前端，无后端；所有数据在用户浏览器 IndexedDB；AI 通过 OpenAI 兼容协议直连各 provider
```

### 1.2 已确认的严重漏洞（按优先级）

#### 🔴 P0（必须立刻修，否则地基建在沙上）

| ID | 问题 | 位置 |
|---|---|---|
| P0-1 | `deleteGroup` 事务声明 9 表，实际访问 13 表 → Dexie 抛错，"已补"的级联删除**无效** | `src/stores/world-group.ts:88` |
| P0-2 | `migrateToMultiWorld` 事务声明 7 表，实际访问 `codexEntries` → Dexie 抛错 | `src/stores/world-group.ts:225` |
| P0-3 | `REQUIRED_TABLES` 仅 22 张（实际 45），`ensureSchema` 缺表会 `Dexie.delete(dbName)` → **整库删除** | `src/main.tsx:25` / `src/lib/db/ensure-schema.ts:34` |
| P0-4 | `BUG-EXPORT-WG`：导出 `worldGroups` 用 index，其它表用原始 id，导入 remap 键值错位 → 多世界归属丢失 | `src/lib/export/json-export.ts:154/304/595/694` |
| P0-5 | `importProjectJSON` 非事务 + FK 缺失 fallback `0` → 半导入 / 坏引用 | `src/lib/export/json-export.ts:351/413/461/472` |
| P0-6 | `deleteProject` 漏 `importLogs`/`importFiles`/`importJobs` 与 master blob → 孤儿数据/blob 泄漏 | `src/stores/project.ts:64` |
| P0-7 | `deleteNode` 绕过 `deleteChapter` → `emotionBeatCards` 残留 | `src/stores/outline.ts:47` |
| P0-8 | `migrateToMultiWorld` 漏给 `outlineNodes` 盖 `worldGroupId` → 老项目升级多世界后**大纲整体不可见** | `src/stores/world-group.ts:225` |

#### 🟠 P1（影响 AI 行为正确性）

| ID | 问题 | 位置 |
|---|---|---|
| P1-1 | `chapter.content` 模板声明 `worldRulesContext` 但 adapter 不接 → 章节正文不读真实与幻想 | `src/lib/ai/adapters/chapter-adapter.ts:10` |
| P1-2 | Worldview 各面板把 `worldRulesContext` 塞进 `parameterValues` → 模板未声明则不生效 | `WorldviewOrigin/Natural/HumanityPanel` |
| P1-3 | `AIFieldCard` 有 `value` 但 AI 生成时不传 → 说明书"读取当前字段值"是假的，影响 BUG-INPUT-WITH-GEN | `src/components/shared/AIFieldCard.tsx:72` |
| P1-4 | `WorkflowRunner` 步骤无 UI 输入框，运行时只传 `userHint` + `previousOutput` → BUG-INPUT-WITH-GEN | `src/components/settings/prompt/WorkflowRunner.tsx:172` |
| P1-5 | `worldRulesProfiles` 项目级单例 `&projectId`，`buildWorldRulesContext` 不接 `worldGroupId` → 多世界串台（Phase 40 未实施） | `src/lib/db/schema.ts:249` 等 |
| P1-6 | `batch-detail-runner` 章节正文版本只有单一 `worldContext`，无逐章 resolver → 多世界串台 | `src/lib/ai/batch-detail-runner.ts:173` |
| P1-7 | 角色合并/删除不 remap `detailedOutlines.appearingCharacterIds` / `scenes.characterIds` 等 JSON 数组引用 | `src/stores/character.ts:53` 等 |
| P1-8 | `chunk-writer` 导入只收 `projectId` 不接 `worldGroupId` → 多世界导入串台 | `src/lib/import/chunk-writer.ts:32` |
| P1-9 | `autoTrimToFit` 只用于 UI 显示，发送的 messages 不真裁 → 超模型窗口报错 | `src/lib/ai/context-budget.ts:190` |
| P1-10 | 非流式 `chat()` 不接 AbortSignal，`chatWithAbort` 用 `Promise.race` → 假取消，token 继续烧 | `src/lib/ai/client.ts:190` |
| P1-11 | `SceneVerify` 的 `historyContext`/`worldRulesContext` 仍按项目全局，与 `worldContext` 不一致 | `src/components/scene/SceneVerifyPanel.tsx:68` |
| P1-12 | StoryCorePanel 不传 `activeWorldGroupId`，store 多世界下取 `wvList[0]`（不稳定主世界）| `src/components/worldview/StoryCorePanel.tsx:44` |
| P1-13 | 增强细纲采纳 AI 返回的 `characterIds/foreshadowIds` 不校验存在性与归属 → AI 幻觉 ID 进库 | `src/components/outline/DetailedOutlinePanel.tsx:133` |
| P1-14 | `worldNodes.portalsJSON` 多处 `JSON.parse` 无 safe 包装；删节点不清反向 portal 引用 | `src/stores/world-node.ts:104/141` |
| P1-15 | 旧 `geography.locations` JSON 删除只删一层，孙层残留孤儿 | `src/components/geography/GeographyPanel.tsx:89` |
| P1-16 | HTML 导出原样拼 `chapter.content`；EPUB 转换不移除 `on*`/`javascript:` → 导出文件可携带恶意脚本 | `src/lib/export/html-builder.ts:140` / `src/lib/export/epub-export.ts:210` |
| P1-17 | `handleExtractState` 用全量 `buildStateContext()` 而非已有的 `buildSelectiveStateContext` → 后期 100+ 角色场景 token 爆炸 | `src/components/editor/ChapterEditor.tsx:332/388` |

#### 🟡 P2（体验/质量）

| ID | 问题 |
|---|---|
| P2-1 | AI 调用 39/59 处未传 `category` meta，UsageStats 不能保证全覆盖 |
| P2-2 | GitHub PAT 默认持久化 `localStorage` |
| P2-3 | `AI-FUNCTIONS-MANUAL.md` 21 处 prompt key 错（详见 §6） |
| P2-4 | 主包 ~1.93MB（已懒加载 pdf/docx，剩余应用代码） |
| P2-5 | 三层记忆 `semantic` 预算偏紧（2000 字塞补全后世界观可能截断伏笔） |
| P2-6 | `filterActiveCharacters` 用 chapter `id` 而非 `order`（休眠隐患） |

#### 🟢 P3（远期 / 设计文档已就绪）

- Phase 35-b/c 词条化迁移
- Phase 38 一致性检测
- Phase 39 多故事线追踪
- Phase 27 Agent 化
- Phase 34 力量阶段追踪

### 1.3 已确认无效的"修复"（本次必须立即纠正）

> 本节列出我（本轮审计执行者）之前自认为"已修"但实际未生效的修复。**接手者必须重做这几处**，不要因为 commit 日志写了"已修"就跳过。

| 自称已修 | 实际状态 | 原因 |
|---|---|---|
| deleteGroup 补级联删 `historicalTimelineEvents/historicalKeywords/codex*` | ❌ 无效 | 事务声明未包含这些表，Dexie 运行时抛错 |
| migrateToMultiWorld 补 `stamp(codexEntries)` | ❌ 无效 | 同上 |
| `formatWorldviewBlock` 补 `divineDesign/worldEvents/internalConflicts` 等 | ⚠️ 仅生效于章节多世界路径；单世界 / 多面板 ParameterValues 路径未生效 | adapter 调用方未对应改 |
| `buildLocationContext` 注入章节正文 | ✅ 真生效 | — |
| 状态 diff `applyDiffs` 按实体聚合 | ✅ 真生效 | — |
| `saveWorldview` 以 DB 为准定位 | ✅ 真生效 | — |
| 词条 `codexCategories/Entries` 进入导出/导入 | ✅ 真生效（但 worldGroupId remap 仍受 P0-4 影响） |
| HTML 导出补 v3 世界观字段 | ✅ 真生效 |
| `sanitizeSvg` 应用 | ✅ 真生效 |
| `deleteCharacter` 清关系 | ⚠️ 仅清 `characterRelations`；JSON 数组引用未清（P1-7） |
| `deleteNode` 级联删 chapters + detailedOutlines | ⚠️ 跳过 `deleteChapter` → emotionBeats 残留（P0-7） |
| `deleteProject` 补 importantLocations/worldRulesProfiles/codex/aiUsageLog | ⚠️ 部分生效；仍漏 importLogs/importFiles/importJobs/master blob（P0-6） |

### 1.4 文档可信度评估

| 文档 | 可信度 | 说明 |
|---|---|---|
| `DATA-FLOW-MAP.md` 第一/二节（数据流总表） | 🟢 高 | 大致准确，可作参考 |
| `DATA-FLOW-MAP.md` 第三章各批"已修"清单 | 🟡 中 | "已修"标签需结合 §1.3 重新核对 |
| `DATA-FLOW-DIAGRAM.md` 图八（生命周期×表矩阵） | 🟡 中 | 部分"已修"标签同上 |
| `AI-FUNCTIONS-MANUAL.md` | 🔴 低 | 21 处 key 错 + 多处读写关系错。**禁止作为权威**。重生成机制 §6 |
| `ARCHITECTURE-REFACTOR.md` | 🔴 低 | 已被本文档取代 |
| `WORLD-RULES-MULTIWORLD-DESIGN.md` | 🟢 高 | 设计正确，待落地 |
| `CODEX-REDESIGN.md` | 🟢 高 | 设计文档完整 |
| `ROADMAP.md` | 🟡 中 | 任务列表正确，优先级需按本文档 §1.2 重排 |
| `CHANGELOG.md` | 🔴 低 | 不完整 + 部分"已修"无效 |

---

## 二、重构目标与判据

### 2.1 三个层次目标

**层次 1 · 质量底线（Phase 0 完成）**
- 零数据丢失：导出/导入/删项目/删世界组/迁移多世界 完整可逆 + 多世界归属不丢
- AI 行为可信：章节正文真正读取所有声明的上下文源；说明书与代码一致

**层次 2 · 架构地基（Phase 1 完成）**
- 单一事实源建立：PROJECT_TABLES / FIELD_REGISTRY / CONTEXT_SOURCES + ADOPTION_SCHEMA
- 生命周期、上下文装配、采纳写回 全部派生自注册表，禁止手写

**层次 3 · 项目精品化（Phase 2/3 完成）**
- 测试覆盖：反例测试网 + 多世界往返冒烟 + 字段一致性
- CI lint：prompt key 一致性 / 事务作用域 / 字段引用 / 注册表完整性
- 安全：导出 sanitize / PAT 不持久化 / chat AbortSignal
- 性能：主包 < 1MB / 真裁剪 / 懒加载重面板
- 文档体系：AI 说明书自动生成 / 维护规约
- 国际化预留：i18n 框架接入（不必填全内容，但要预留）

### 2.2 开源大赛参评判据（"够好"的定义）

| 维度 | 判据 |
|---|---|
| 代码质量 | tsc 零错；ESLint 零警告；CI 全绿；测试覆盖 ≥ 60% |
| 架构清晰 | 三个注册表为唯一事实源，任何新功能改一处即可 |
| 文档完整 | README 五分钟入门；CONTRIBUTING；本蓝图；自动生成的 AI manual |
| 用户体验 | 关键路径无 bug；导出/导入往返无损；多世界场景可用 |
| 创新性 | 多世界、词条系统、三层记忆、AI 一致性检测（这些已有，需做完） |
| 安全 | 导出无 XSS；本地敏感数据有提示；无显式安全漏洞 |
| 可维护性 | 任何模型/人按文档可继续开发；不能"只有作者懂" |

---

## 三、总体哲学（强化版）

> 🔒 **本节是项目宪法。完整版见仓库根目录 `CLAUDE.md`（含动手前的「四问」+ 反面教材 + 立刻停下的信号）。**
> 任何接手者动手前必读 `CLAUDE.md`；以下五条是从那里精炼出的核心。

```
五条不可违反的原则：

  ① 单一事实源
     每张表只在 PROJECT_TABLES 登记一次；
     每个可写字段只在 FIELD_REGISTRY 登记一次；
     每个上下文源只在 CONTEXT_SOURCES 登记一次；
     每个 AI 动作只在自动生成的 AI manual 出现一次。

  ② 显式优于隐式
     Dexie 事务作用域必须完整声明所有访问的表（lint 校验）；
     上下文源的 scope/worldGroupId 必须有测试断言；
     AI 调用的 meta.category 必须传（CI 强制）。

  ③ 引用即声明
     JSON 引用、数组引用、间接归属、Blob owner 都必须在注册表里登记；
     任何"潜规则"引用 = 漏洞预备役。

  ④ 集合不是字段
     AI 写回集合表（角色/伏笔/词条/场景等）必须有独立 AdoptionSchema
     声明唯一键、去重、FK 校验、merge 策略。

  ⑤ 文档由代码生成
     AI 行为说明书的"全集"由代码扫描生成；
     人只补"读什么/写什么"的语义注解；
     不允许说明书自称"事实源"但与代码不一致。
```

---

## 四、施工分期（四个 Phase · 详细任务）

> 每个任务格式统一：**ID · 位置 · 前置条件 · 改法 · 验证方法 · 完成判据**。
> 接手者必须严格按 ID 顺序执行（同 Phase 内可并行的会标注 `[parallel]`）。

### Phase 0 · 紧急修复（约 3–5 天，必须先做完）

#### 0.1 修复 deleteGroup 事务声明缺失

**位置**：`src/stores/world-group.ts:88`
**前置**：阅读 §1.2 P0-1 / §1.3
**改法**：
1. 把事务表清单从手写改为：
   ```
   db.transaction('rw', PROJECT_TABLES_ALL, async () => { ... })
   ```
   其中 `PROJECT_TABLES_ALL` 暂时硬编码全部 45 张 Dexie 表（Phase 1 后由注册表派生）。
2. 暂行步骤：在事务声明中显式添加：
   - `db.historicalTimelineEvents`
   - `db.historicalKeywords`
   - `db.codexEntries`
   - `db.codexCategories`

**验证**：
- `npx tsc --noEmit` 零错
- 跑 §7.1.1 多世界删除冒烟（删一个非主世界，断言所有 worldScoped 表中该 wgId 不存在）
- 浏览器开发者工具 IndexedDB 面板对照检查

**完成判据**：删除一个非主世界后，10 张 worldScoped 表均无该 worldGroupId 残留。

---

#### 0.2 修复 migrateToMultiWorld 事务声明缺失

**位置**：`src/stores/world-group.ts:225`
**前置**：0.1 完成
**改法**：在事务声明中添加 `db.codexEntries`（其它已声明）。
**验证**：开启多世界（单世界项目 → 启用多世界），断言：
- `codexEntries.where('projectId').equals(pid).count()` 中 `worldGroupId IS NULL` 的条数为 0（全部盖章到主世界）
- 不抛错
**完成判据**：开启多世界不抛错，已有词条全部归属主世界。

---

#### 0.3 修复 ensureSchema 删库风险

**位置**：`src/main.tsx:25` + `src/lib/db/ensure-schema.ts:34`
**前置**：无

**💥 灾难场景还原**：
> 这是最致命的潜在场景：用户写了半年小说，~200 万字数据全在浏览器 IndexedDB。某天浏览器更新/插件冲突/磁盘异常导致 schema 检测失败（缺一张表）。`ensureSchema` 看到缺表，**直接调用 `Dexie.delete(dbName)` 把整个数据库删干净**。用户打开应用看到空白，半年心血归零。原因是 `REQUIRED_TABLES` 早期写死只列 22 张表，没跟随 schema 升级到 45 张；只要任何一张未登记的表在某个版本误删/重命名，就会触发删库。这是写在代码里的定时炸弹。

**改法**：
1. `REQUIRED_TABLES` 从 schema 派生（生产环境不写死）：
   ```
   // 暂行：硬编码与 schema.ts 一致的 45 张表
   // Phase 1 后改为从 PROJECT_TABLES 派生
   ```
2. `ensureSchema` 检测到缺表时：
   - 生产环境：**不删库**，弹窗提示用户备份后重新加载页面 / 提交反馈
   - 开发环境（`import.meta.env.DEV`）：保持当前自动 reset 行为
3. 加 lint：CI 跑一个脚本对照 `schema.ts` 与 `REQUIRED_TABLES`，数量不一致则 fail

**验证**：
- 手动制造缺表场景（注释掉 schema 里某张表），观察生产环境是否弹提示而非删库
- `npm run build` 后部署 preview，跑 §7.1.2

**完成判据**：生产环境永远不可能因 schema 自检触发 `Dexie.delete()`。

---

#### 0.4 修复 BUG-EXPORT-WG 多世界归属丢失

**位置**：`src/lib/export/json-export.ts:154`/`304`/`595`/`694`
**前置**：无

**💥 灾难场景还原**：
> 多世界用户(诸天流写手)项目里有 5 个世界——主世界、斗破、遮天、完美、武动。用户做完一卷后想换电脑写作，点"导出 JSON"备份；新电脑上点"导入 JSON"恢复。**导入后所有数据的世界归属全是错的**：主世界角色跑去了斗破、斗破的修炼体系挂在遮天名下。原因是导出时世界组用了"导出序号"重新编号、但其他表存的还是原始 DB id，导入时键值对不上。用户看到这景象后多半会怀疑是自己操作问题，反复几次后才会发现是 bug；那时候导出的备份文件已经全部串台、不可信。

**改法**：采用 GPT 5.5 报告的 **方案 A**（推荐，统一用 export 序号）：
1. 导出阶段：所有带 `worldGroupId/homeWorldGroupId` 的表，导出时把这些字段转换为 `_worldGroupExportId`（通过 `worldGroupIdMap.get(rawId)`）；不再保留原始 `worldGroupId` 字段。
2. 导入阶段（section 27）：只识别 `_worldGroupExportId`，通过 `newWorldGroupIds.get(_exportId)` 拿新 id。
3. 旧导出格式兼容：保留对旧字段 `worldGroupId` 的识别（identity remap，作为兼容降级）。

**验证**：
- 写多世界项目（≥ 2 个世界，至少一个非主世界）导出 → 删项目 → 导入，断言所有 worldScoped 表的 `worldGroupId` 与原值对应
- 跑 §7.1.3 多世界导出导入往返测试

**完成判据**：多世界项目导出再导入后，所有表 `worldGroupId` 正确归属，零丢失。

---

#### 0.5 修复 importProjectJSON 非事务 + FK fail-fast

**位置**：`src/lib/export/json-export.ts:351`
**前置**：0.4 完成（remap 协议统一后再包事务）
**改法**：
1. 把整个 `importProjectJSON` 主体包进单个 `db.transaction('rw', PROJECT_TABLES_ALL, ...)`。
2. 所有 `parentId/outlineNodeId/chapterId/referenceId/workId/categoryId` 等 FK remap，缺失时：
   - 当前 fallback `0` → 改为：**抛错 + 在事务内 abort**（用户看到导入失败提示，但不会留半个项目）
   - 或：跳过该记录 + 在 importResult 里记录 warning
3. 增加导入完成后的引用完整性断言：扫一遍关键 FK，发现 0 或非法引用立刻 abort。

**验证**：
- 构造一个**故意缺章节 outlineNode 的导出 JSON**，导入，断言：
  - 整个导入回滚（项目不存在）
  - 用户看到清晰的错误提示

**完成判据**：导入要么完全成功，要么完全无副作用（无半导入数据）。

---

#### 0.6 修复 deleteProject 漏间接归属表

**位置**：`src/stores/project.ts:64`
**前置**：无

**💥 灾难场景还原**：
> 用户导入了一本 10MB 的小说原文（存入 `importFiles` 表的 Blob 字段）。用过后觉得不满意，在首页点了"删除项目"。项目表面消失了——但那 10MB 的 Blob **永远残留在 IndexedDB**，因为 deleteProject 没删 importFiles。用户再删 10 次类似项目，浏览器存了 100MB 不可见的"游魂数据"，最终：IndexedDB 配额爆满 → 应用无法保存新数据 → 用户写到一半的章节存不进去 → 最终白屏。Master 作品学习也走同条路径（masterWorks 的原文存 importFiles，用 100000+workId 虚拟 sessionId）。

**改法**：
1. 删项目前，先查 `sessionIds = await db.importSessions.where('projectId').equals(id).primaryKeys()`
2. 删除：
   ```
   - db.importLogs.where('sessionId').anyOf(sessionIds).delete()
   - db.importFiles.where('sessionId').anyOf(sessionIds).delete()
   - db.importJobs.where('projectId').equals(id).delete()
   ```
3. master blob：查 `workIds = await db.masterWorks.where('projectId').equals(id).primaryKeys()`，删除 `db.importFiles` 中 `sessionId = 100000 + workId` 的记录（master 用虚拟 sessionId 复用 importFiles 表）
4. 事务声明加上 `importLogs/importFiles/importJobs`

**验证**：
- 建项目 → 导入文件（产生 importSession/Logs/Files）→ 学习一部作品（产生 masterWorks + blob）→ 删项目 → 断言：
  - `importSessions/importLogs/importFiles/importJobs` 中无该项目残留
  - `masterWorks` 中无该项目残留
  - master blob 无残留

**完成判据**：删项目后 IndexedDB 该项目无任何残留记录或 blob。

---

#### 0.7 修复 deleteNode 绕过 deleteChapter

**位置**：`src/stores/outline.ts:47` + `src/stores/chapter.ts:57`
**前置**：无
**改法**：
1. 在 `chapter.ts` 中导出一个内部使用的 `_cascadeDeleteChapter(id)` 函数，把当前 `deleteChapter` 的级联逻辑（删 emotionBeatCards 等）抽出。
2. `outline.ts:deleteNode` 中：
   ```
   - 原：bulkDelete(chapterIds)
   - 改为：for (const chId of chapterIds) await chapterStore._cascadeDeleteChapter(chId)
   ```
3. 保留 `bulkDelete` 行为的性能优势：批量收集子表 ids 后一次 `bulkDelete`，而不是循环单删（具体实现见 §5.1）

**验证**：
- 建大纲节点 → 加章节 → 章节生成情绪节拍卡 → 删大纲节点 → 断言：
  - `chapters` 中无残留
  - `detailedOutlines` 中无残留
  - **`emotionBeatCards` 中无残留**（旧逻辑这一步失败）

**完成判据**：删大纲节点后所有子表都正确清空。

---

#### 0.8 修复 migrateToMultiWorld 漏给 outlineNodes 盖章

**位置**：`src/stores/world-group.ts:225`
**前置**：0.2 完成（事务声明已含 codexEntries）
**改法**：
1. 在事务声明中添加 `db.outlineNodes`
2. 在 stamp 调用列表中添加 `await stamp(db.outlineNodes, ...)`
3. （可选）如发现 `worldNodes`/`importantLocations` 等其它带 worldGroupId 字段表也漏，一并补齐

**💥 灾难场景还原（务必理解为什么这是 P0）**：
> 老用户的项目在单世界模式下使用了几个月，大纲累积了 50 卷。某天点击"启用多世界"，期望保持现状（只是多了"主世界"标签）。**但这次升级会让所有 50 卷的大纲在屏幕上瞬间消失**——因为多世界模式下大纲页按当前世界 ID 筛选卷，而所有卷的 worldGroupId 是 null（未盖章），不匹配主世界 ID。**用户会以为自己几个月的心血被吃掉了**，而数据其实还在表里，只是失去了归属。

**验证**：
- 准备一个单世界项目（已有大纲卷）→ 调用 `migrateToMultiWorld` → 断言：
  - 所有 `outlineNodes.where('projectId').equals(pid)` 的 `worldGroupId === primaryId`
  - 大纲面板按主世界过滤能正常显示所有卷
- 跑 §7.1 R-2 测试

**完成判据**：单世界升级多世界后，大纲在 UI 上完整可见。

---

### Phase 0 完成判据汇总

完成 Phase 0 八项任务后：
- [ ] tsc 零错；build 成功
- [ ] §7.1 反例测试网（至少前 4 条）全绿
- [ ] 多世界导出/导入往返测试通过
- [ ] 删项目/删世界组/迁移多世界 三个操作不抛错且数据无残留
- [ ] commit 顺序：每个任务一个 commit，commit message 含验证脚本链接

---

### Phase 1 · 三支柱地基（强化版，约 10–15 天）

#### 1.1 PROJECT_TABLES 注册表（含间接归属/JSON 引用/Blob owner）

**位置**：新建 `src/lib/db/project-tables.ts`
**前置**：Phase 0 完成
**数据结构**：见 §5.1
**实施步骤**：
1. 创建 `PROJECT_TABLES: TableSpec[]` 数组，覆盖全部 45 张表
2. 派生 API：见 §5.1
3. 改造 5 个生命周期入口为派生调用：
   - `deleteProject` → `cascadeDeleteProject(id)`
   - `deleteGroup` → `cascadeDeleteGroup(pid, wgId)`
   - `migrateToMultiWorld` → `stampPrimaryWorld(pid, primaryId)`
   - `exportProjectJSON` → `exportProjectByRegistry(pid)`
   - `importProjectJSON` → `importProjectByRegistry(data)`
4. 旧函数保留作适配器，3 个月后下线（标 `@deprecated`）
5. 加 lint：启动期校验注册表完整性（45 张表全在注册表中）

**验证**：
- §7.1 全部反例测试网通过
- §7.2 注册表完整性 lint 通过
- §7.3 生命周期一致性测试通过

**完成判据**：所有生命周期操作改为派生；新增表只改 `PROJECT_TABLES` 一处即可被所有生命周期感知。

---

#### 1.2 FIELD_REGISTRY + AdoptionSchema 统一写回层 [parallel with 1.1]

**位置**：新建 `src/lib/ai/field-registry.ts` + `src/lib/ai/adoption-schema.ts` + `src/lib/ai/adopt.ts`
**前置**：无（可与 1.1 并行）
**数据结构**：见 §5.2
**实施步骤**：
1. 创建 `FIELD_REGISTRY: FieldSpec[]`，覆盖：
   - worldviews 所有 v3 字段（含 aliases: summary→worldOrigin 等）
   - storyCores（含 storyLines→mainPlot）
   - characters（含 role 中文→英文枚举归一）
   - creativeRules（含 toneAndMood→atmosphere）
   - foreshadows / storyArcs / outlineNodes / chapters / 等
2. 创建 `AdoptionSchema: CollectionAdoptionSpec[]`，覆盖集合写回：
   - 角色批量采纳（按 name 去重 + worldGroupId 校验）
   - 伏笔批量采纳
   - 大纲节点批量（按 outline tree 校验）
   - 词条批量（按 categoryId + name 去重）
3. 实现 `adopt(input): AdoptResult` 统一入口
4. 改造 9+ 调用方：
   - InspirationPanel.handleAdoptWorldview/StoryCore/Characters
   - WorldGroupAI.parseWorldExpand → adopt
   - chunk-writer → adopt
   - WorkflowRunner.saveTarget → adopt
   - 其余面板 `saveXxx` 改为 adopt 薄壳

**验证**：
- §7.4 写回反例测试（17 个已知 bug 反例全绿）
- 灵感反推：手动构造 AI 输出含 `summary` 字段，断言自动映射到 `worldOrigin`
- 角色批量采纳：构造重名输入，断言自动去重

**完成判据**：所有 AI 输出 → 上游表的路径都经 `adopt`；旧 `saveWorldview/saveStoryCore` 仅为薄壳。

---

#### 1.3 CONTEXT_SOURCES + assembleContext 统一上下文层

**位置**：新建 `src/lib/ai/context-registry.ts` + `src/lib/ai/assemble-context.ts`
**前置**：1.1 + 1.2 完成
**数据结构**：见 §5.3
**实施步骤**：
1. 创建 `CONTEXT_SOURCES: ContextSource[]` 覆盖 17 个上下文源（参考 v1 ARCHITECTURE-REFACTOR §3.3）
2. 强制每个 `scope: 'world'` 的 source 必须接收 `worldGroupId`
3. 实现 `assembleContext(input): AssembleResult`，含**真裁剪**（L3→L2→L1 真删 segment 后再发送）
4. 改造 32+ 生成入口，按依赖顺序：
   - 章节正文（最重要，§4.5 ①）
   - 卷大纲/章大纲（§4.2 ①②③）
   - 细纲（§4.6 ①②③）
   - 世界观各维度（§2.3-2.5 全部）
   - 角色/伏笔/故事核心/创作规则/故事线 等
5. 旧 `buildXxxContext` 保留作适配器
6. 加 lint：CI 校验每个生成入口必须经 `assembleContext`（grep 检查 `ai.start` 上下文构建模式）

**验证**：
- §7.5 上下文一致性测试
- §7.6 多世界上下文隔离测试（同项目两个世界输入不同数据，assembleContext(worldA) 不得包含 worldB）
- §7.7 真裁剪测试（人为超预算，断言 L3 先被丢）

**完成判据**：所有 AI 调用经 `assembleContext`；旧 `buildXxxContext` 仅为适配器；真裁剪生效。

---

### Phase 1 完成判据汇总

- [ ] 三个注册表建立 + lint 通过
- [ ] 5 个生命周期操作全部派生
- [ ] 32+ 生成入口全部经 assembleContext
- [ ] 9+ 写回调用全部经 adopt
- [ ] §7 全部测试通过
- [ ] 旧函数标 @deprecated 并保留作适配器

---

### Phase 2 · 内容完整性 + 多世界贯通（约 7–10 天）

#### 2.1 Phase 40 worldRulesProfiles 多世界化

**位置**：`src/lib/db/schema.ts:249` + `src/stores/world-rules.ts` + `src/lib/ai/world-rules-manifest.ts` + 9 个调用点
**前置**：Phase 1 完成（注册表与 adopt 就绪）
**改法**：按 `WORLD-RULES-MULTIWORLD-DESIGN.md` 完整实施。要点：
1. schema：`worldRulesProfiles` 索引改为 `'++id, projectId, worldGroupId'`（去掉 `&projectId` 唯一）→ DB 版本 v27
2. store：`loadProfile(projectId, worldGroupId)` + 幂等 getOrCreate（先查 DB）
3. WorldRulesPanel：多世界加世界标签（仿 HistoryPanel）
4. `buildWorldRulesContext(projectId, worldGroupId?)` + 默认世界解析（见设计文档 §2.3）
5. 9 个调用点按设计文档 §2.3 表传值
6. 由 PROJECT_TABLES（Phase 1）派生：迁移 stamp / 删除级联 / 导出 remap 全部自动覆盖
7. 注入 CONTEXT_SOURCES（取代独立 `buildWorldRulesContext` 调用）

**验证**：跑 §7.8 真实与幻想多世界冒烟
**完成判据**：见 `WORLD-RULES-MULTIWORLD-DESIGN.md` §四完成判据全部勾选。

---

#### 2.2 chapter-adapter 真接 worldRulesContext

**位置**：`src/lib/ai/adapters/chapter-adapter.ts:10` + `prompt-seeds.ts:351`
**前置**：1.3 完成（assembleContext 就绪）
**改法**：
1. `buildChapterContentPrompt` 增加 `worldRulesContext` 参数
2. 调用方（ChapterEditor）通过 assembleContext 取 `worldRules` source
3. prompt-seeds 中 `chapter.content` 的 `worldRulesContext` 变量真正生效
**验证**：构造含真实与幻想约束的项目，生成章节正文，prompt 实际发送内容应包含真实与幻想约束文本
**完成判据**：grep prompt 输出，确认含 worldRules 内容。

---

#### 2.3 AIFieldCard 传 currentValue

**位置**：`src/components/shared/AIFieldCard.tsx:20/72` + 各调用方
**前置**：1.2 完成（adopt 就绪）
**改法**：
1. `buildMessages(hint, opts)` → `buildMessages(hint, opts, currentValue)`
2. 各 adapter（worldview/storyCore/character 等）prompt 模板增加 `currentValue` 变量
3. 模板区分三模式：rewrite / expand / polish（用户在 UI 选）

**验证**：手动测试：在字段里写半句，点 AI 生成，断言 AI 输出基于已写内容扩写而非另起
**完成判据**：所有单字段 AI 生成默认带当前值；用户可选"重写"模式忽略当前值。

---

#### 2.4 chunk-writer 支持 worldGroupId

**位置**：`src/lib/import/chunk-writer.ts:32` + `src/lib/import/pipeline.ts:271`
**前置**：无
**改法**：
1. `ImportSession` 增加 `targetWorldGroupId?` 字段（DB 加列，v28）
2. `applyChunkResult(projectId, result, worldGroupId)` 全链路传
3. 写入 worldviews/characters/outlineNodes 时盖 `worldGroupId/homeWorldGroupId`
4. 导入面板（ImportDocPanel）多世界下增加"目标世界"选择器
**验证**：多世界项目 → 选目标世界 → 导入 → 断言所有写入归属正确世界
**完成判据**：多世界导入无串台。

---

#### 2.5 批量正文 worldContextResolver

**位置**：`src/lib/ai/batch-detail-runner.ts:173/234`
**前置**：1.3 完成
**改法**：照 `batch-outline-runner.ts` 已有的 resolver 模式，给批量细纲/批量正文都加 `worldContextResolver?(chapterId)`
**验证**：多世界批量生成，断言每章用其所属世界上下文
**完成判据**：多世界批量场景无串台。

---

#### 2.6 角色引用 remap（JSON 数组级联）

**位置**：`src/stores/character.ts:53` + `src/lib/import/character-merge.ts:156`
**前置**：1.1 完成（JSON refs 已在 PROJECT_TABLES 登记）
**改法**：
1. 删/合并角色时，通过 PROJECT_TABLES 注册表自动查找所有 JSON 引用：
   - `detailedOutlines.appearingCharacterIds`
   - `detailedOutlines.scenes[].characterIds`
   - 状态卡 entityName（按 name 而非 id，特殊处理）
2. 删除 → 从数组中移除；合并 → 替换为新角色 id
**验证**：构造场景：细纲 sceneA 引用角色 5，删角色 5，断言 sceneA.characterIds 不再含 5
**完成判据**：删/合并角色不留断引用。

---

#### 2.7 修复 handleExtractState 改用按需召回

**位置**：`src/components/editor/ChapterEditor.tsx:332` 和 `:388`
**前置**：无（独立修复）

**💥 灾难场景还原**：
> 项目里已有的状态卡系统本来就实现了「按需召回」机制 (`buildSelectiveStateContext`)，根据当前章节相关文本智能筛选只相关的状态卡。但状态提取(`handleExtractState`)和自动状态提取(`handleAutoPostGenerate`)**写死了用全量 `buildStateContext()`**。前期没问题，等用户写到 50 章、累积 100+ 角色卡 + 物品 + 地点状态后，每次提取状态就把全部 100+ 张卡塞进 prompt：① token 账单暴涨 5–10 倍；② 上下文塞满导致 AI 出现严重幻觉，提取出来的 diff 全是乱编。

**改法**：
1. 把第 332 行 `const stateCtx = buildStateContext()` 改为：
   ```
   const stateCtx = buildSelectiveStateContext(plainText, extraStateIds).text
   ```
2. 第 388 行（handleAutoPostGenerate 中）同样改为按需召回，召回的 reference 文本用刚生成的正文 `text`
3. 同步 §8 已有的 `selectiveState` 计算逻辑（185 行），保持一致

**验证**：
- 构造场景：项目内 50+ 状态卡 → 触发状态提取 → 断言 prompt 实际发送的卡数远少于 50
- 跑章节生成的自动状态提取，断言 token 消耗显著低于全量召回

**完成判据**：状态提取 prompt 体积稳定在合理范围（与"相关性"成正比，不随项目角色总数线性增长）。

---

#### 2.8 修复 P1 其余各项 [parallel]

按 §1.2 P1-9 至 P1-16 逐一修复（autoTrimToFit 真裁/chat AbortSignal/SceneVerify多世界/portal safe parse/旧地理递归删/HTML+EPUB sanitize 等）

---

### Phase 2 完成判据汇总

- [ ] Phase 40 真实与幻想多世界化完整落地
- [ ] 章节正文真读取所有声明的上下文源
- [ ] 单字段 AI 生成带 currentValue
- [ ] 多世界导入/批量生成不串台
- [ ] 所有 P1 项关闭

---

### Phase 3 · 精品化（约 10–15 天）

#### 3.1 AI 行为说明书自动生成器

**位置**：新建 `scripts/generate-ai-manual.ts`
**前置**：Phase 1 完成
**详细规格**：见 §6

#### 3.2 测试体系建立

**详细规格**：见 §7

#### 3.3 CI lint 规则

**详细规格**：见 §7.9

#### 3.4 安全加固

- HTML/EPUB sanitize（DOMPurify 或自写白名单清洗）
- GitHub PAT 默认 session-only，显式勾选才持久化
- chat AbortSignal 全链路
- AI 输出 SVG 已 sanitize（已完成）

#### 3.5 性能

- React.lazy 懒加载重面板（world-map / master-studies / 3D 地图）
- 真裁剪生效后预算条 UI 更新
- 批量任务取消传播

#### 3.6 文档体系收口

- README 重写（五分钟入门 + 截图）
- CONTRIBUTING.md 增加"接手指南"
- 本 MASTER-BLUEPRINT 维护更新
- 自动生成的 AI manual 加入 CI 校验

#### 3.7 国际化预留

- 抽出所有硬编码中文文案到 `src/i18n/zh-CN.ts`
- 框架接入（react-i18next），但只填中文
- README 加英文版

---

### Phase 3 完成判据

- [ ] 自动生成的 AI manual 与代码 100% 一致（CI 校验）
- [ ] 测试覆盖 ≥ 60%
- [ ] CI 全绿（lint + test + build）
- [ ] 安全审计通过
- [ ] 主包 < 1MB（首屏）
- [ ] README + CONTRIBUTING 完整
- [ ] 项目可参评开源大赛

---

## 五、三支柱的强化定义

### 5.1 PROJECT_TABLES 注册表（v2 强化版）

**关键扩展**（相对 v1）：

```ts
// src/lib/db/project-tables.ts

export type TableOwner =
  | 'project'      // 直接 projectId 字段
  | 'direct-child' // 通过另一个表的 id 间接归属（如 referenceChunkAnalysis.referenceId）
  | 'indirect'     // 通过非直接外键间接归属（如 importLogs.sessionId → importSessions.projectId）
  | 'transient'    // 临时态（与项目同生命周期但不导出）
  | 'blob'         // Blob 存储，特殊 owner（如 importFiles 复用为 master blob）
  | 'global'       // 全局（不绑项目）

export interface TableSpec<T = unknown> {
  table: Table<T, number>
  name: string
  owner: TableOwner
  /** owner='project' 时使用 projectId 字段；其它情况需要自定义 resolver */
  projectResolver?: (row: T, db: Db) => Promise<number | null>
  worldScoped?: boolean
  homeWorldScoped?: boolean
  worldGroupField?: string  // 默认 'worldGroupId'
  tree?: { parentField: string }
  refs?: RefSpec[]
  exportable: boolean
  exportRemap?: ExportRemapField[]
  note?: string
}

export type RefSpec =
  | SimpleRef       // table[field] 简单外键
  | JsonRef         // JSON 字段中的引用
  | ArrayRef        // 数组字段中的多引用
  | IndirectRef     // 间接归属
  | BlobOwnerRef    // Blob owner

export interface SimpleRef {
  kind: 'simple'
  field: string
  target: string  // 'tableName[fieldName]'
  onDelete: 'cascade' | 'setNull' | 'keep' | 'validate'
}

export interface JsonRef {
  kind: 'json'
  field: string   // 如 'fields'（JSON 字符串）
  jsonPath: string  // 如 '$.characterId'
  target: string
  onDelete: 'cascade' | 'setNull' | 'keep' | 'remap'
}

export interface ArrayRef {
  kind: 'array'
  field: string   // 字段名（数组）
  itemTarget: string  // 数组元素指向的 table
  onDelete: 'removeItem' | 'setNullItem' | 'keep'
}

export interface IndirectRef {
  kind: 'indirect'
  /** 间接父表 + 字段 + 目标 */
  via: { table: string; field: string; resolveProject: string }
  onDelete: 'cascade'
}

export interface BlobOwnerRef {
  kind: 'blob-owner'
  /** Blob 表名 */
  blobTable: string
  /** key 计算（如 importFiles.sessionId = workId + 100000） */
  keyResolver: (row: unknown) => number | string
  onDelete: 'cascade'
}

// 派生 API（核心）
export function projectScopedTables(): TableSpec[]
export function worldScopedTables(): TableSpec[]
export function exportableTables(): TableSpec[]
export function transactionTablesFor(operation: 'deleteProject' | 'deleteGroup' | 'migrate' | 'export' | 'import'): Table[]

// 主要生命周期函数
export async function cascadeDeleteProject(projectId: number): Promise<void>
export async function cascadeDeleteGroup(projectId: number, wgId: number): Promise<void>
export async function stampPrimaryWorld(projectId: number, primaryId: number): Promise<void>
export async function cascadeDeleteRecord(tableName: string, id: number): Promise<void>
export async function exportProjectByRegistry(projectId: number): Promise<ExportData>
export async function importProjectByRegistry(data: ExportData): Promise<number>

// 启动期 lint
export function validateRegistry(): void  // 在 main.tsx 启动时调用
```

**核心 API 实现伪代码**(实施者可直接照写):

```ts
// ─────────────────────────────────────────────────────────────
// 派生函数(基础)
// ─────────────────────────────────────────────────────────────

const REGISTRY_BY_NAME = new Map(PROJECT_TABLES.map(s => [s.name, s] as const))

export const projectScopedTables = () =>
  PROJECT_TABLES.filter(s =>
    s.owner === 'project' || s.owner === 'direct-child' ||
    s.owner === 'indirect' || s.owner === 'transient' || s.owner === 'blob'
  )

export const worldScopedTables = () =>
  PROJECT_TABLES.filter(s => s.worldScoped)

export const exportableTables = () => {
  // 按 refs 拓扑序(被依赖的表先,依赖的表后)
  return topoSort(PROJECT_TABLES.filter(s => s.exportable))
}

/** 计算某个生命周期操作需要的事务表清单(防止 Dexie 事务作用域漏表) */
export function transactionTablesFor(
  op: 'deleteProject' | 'deleteGroup' | 'migrate' | 'export' | 'import',
): Table[] {
  if (op === 'deleteProject') {
    return projectScopedTables().map(s => s.table)
  }
  if (op === 'deleteGroup') {
    // 不仅 worldScoped,还包括需要 setNull 的角色/大纲等
    return [
      ...worldScopedTables().map(s => s.table),
      db.characters,           // homeWorldGroupId setNull
      db.outlineNodes,         // worldGroupId setNull
      db.worldGroups, db.worldGroupLinks,
    ]
  }
  if (op === 'migrate') {
    return worldScopedTables().map(s => s.table)
  }
  // export/import:全部可导出表
  return exportableTables().map(s => s.table)
}

// ─────────────────────────────────────────────────────────────
// cascadeDeleteProject - 删项目级联清理
// ─────────────────────────────────────────────────────────────

export async function cascadeDeleteProject(projectId: number): Promise<void> {
  await db.transaction('rw', transactionTablesFor('deleteProject'), async () => {
    // Step 1:收集 indirect 表的待删 keys(因为它们没 projectId)
    const importSessions = await db.importSessions
      .where('projectId').equals(projectId).primaryKeys()
    const masterWorks = await db.masterWorks
      .where('projectId').equals(projectId).primaryKeys()
    const references = await db.references
      .where('projectId').equals(projectId).primaryKeys()

    // Step 2:按拓扑序删子表(被依赖的最后删)
    for (const spec of projectScopedTables().reverse()) {
      if (spec.owner === 'project') {
        // 直接 projectId 删
        await spec.table.where('projectId').equals(projectId).delete()
      } else if (spec.owner === 'indirect') {
        // 间接归属:用 IndirectRef 解析
        for (const ref of spec.refs ?? []) {
          if (ref.kind !== 'indirect') continue
          if (ref.via.table === 'importSessions') {
            await spec.table.where(ref.via.field).anyOf(importSessions as number[]).delete()
          }
          // 其他间接归属同理
        }
      } else if (spec.owner === 'blob') {
        // Blob owner:用 keyResolver 计算 key
        for (const ref of spec.refs ?? []) {
          if (ref.kind !== 'blob-owner') continue
          // master blob 用 100000+workId 虚拟 sessionId
          for (const wid of masterWorks as number[]) {
            await spec.table.delete(ref.keyResolver({ workId: wid }) as number)
          }
          // 普通导入 blob
          for (const sid of importSessions as number[]) {
            await spec.table.delete(sid as number)
          }
        }
      } else if (spec.owner === 'transient') {
        await spec.table.where('projectId').equals(projectId).delete()
      }
    }

    // Step 3:删主表
    await db.projects.delete(projectId)
  })
}

// ─────────────────────────────────────────────────────────────
// cascadeDeleteGroup - 删世界组级联清理
// ─────────────────────────────────────────────────────────────

export async function cascadeDeleteGroup(projectId: number, wgId: number): Promise<void> {
  await db.transaction('rw', transactionTablesFor('deleteGroup'), async () => {
    // Step 1:删该世界的所有 worldScoped 数据
    for (const spec of worldScopedTables()) {
      const wgField = spec.worldGroupField ?? 'worldGroupId'

      // codexCategories 特殊:builtInKey 非空的内置分类保持 null=全局,不删
      if (spec.name === 'codexCategories') {
        const all = await spec.table.where('projectId').equals(projectId).toArray()
        for (const row of all) {
          const r = row as any
          if (r[wgField] === wgId && !r.builtInKey) {
            await spec.table.delete(r.id)
          }
        }
        continue
      }

      const rows = await spec.table.where('projectId').equals(projectId).toArray()
      for (const row of rows) {
        if ((row as any)[wgField] === wgId) {
          await spec.table.delete((row as any).id)
        }
      }
    }

    // Step 2:清角色 homeWorldGroupId(homeWorldScoped 表)
    const chars = await db.characters.where('projectId').equals(projectId).toArray()
    for (const c of chars) {
      if (c.homeWorldGroupId === wgId) {
        await db.characters.update(c.id!, { homeWorldGroupId: null })
      }
    }

    // Step 3:清大纲 worldGroupId(outlineNodes 是 worldScoped 但不删,只 setNull)
    const nodes = await db.outlineNodes.where('projectId').equals(projectId).toArray()
    for (const n of nodes) {
      if (n.worldGroupId === wgId) {
        await db.outlineNodes.update(n.id!, { worldGroupId: null })
      }
    }

    // Step 4:删世界关系链接
    await db.worldGroupLinks.where('fromGroupId').equals(wgId).delete()
    await db.worldGroupLinks.where('toGroupId').equals(wgId).delete()
    await db.worldGroups.delete(wgId)
  })
}

// ─────────────────────────────────────────────────────────────
// stampPrimaryWorld - 开启多世界时把现有数据盖章到主世界
// ─────────────────────────────────────────────────────────────

export async function stampPrimaryWorld(projectId: number, primaryId: number): Promise<void> {
  await db.transaction('rw', transactionTablesFor('migrate'), async () => {
    for (const spec of worldScopedTables()) {
      const wgField = spec.worldGroupField ?? 'worldGroupId'
      const rows = await spec.table.where('projectId').equals(projectId).toArray()
      for (const row of rows) {
        const r = row as any
        if (r[wgField] == null) {
          // 内置 codexCategories(builtInKey 非空)保持 null=全局共用结构,不盖章
          if (spec.name === 'codexCategories' && r.builtInKey) continue
          await spec.table.update(r.id, { [wgField]: primaryId })
        }
      }
    }
  })
}

// ─────────────────────────────────────────────────────────────
// cascadeDeleteRecord - 删某条记录时按 refs 级联(角色/章节/大纲等)
// ─────────────────────────────────────────────────────────────

export async function cascadeDeleteRecord(tableName: string, id: number): Promise<void> {
  const spec = REGISTRY_BY_NAME.get(tableName)
  if (!spec || !spec.refs?.length) {
    return await spec?.table.delete(id)
  }

  // 收集所有"指向此记录"的引用,按 RefSpec 分类处理
  for (const ref of spec.refs) {
    switch (ref.kind) {
      case 'simple': {
        // 简单外键:cascade=级联删 / setNull=置空 / keep=保留
        const m = ref.target.match(/^(\w+)\[(\w+)\]$/)
        if (!m) break
        const [, targetName, targetField] = m
        const targetSpec = REGISTRY_BY_NAME.get(targetName)
        if (!targetSpec) break

        if (ref.onDelete === 'cascade') {
          const keys = await (targetSpec.table as any).where(targetField).equals(id).primaryKeys()
          if (keys.length) await targetSpec.table.bulkDelete(keys)
        } else if (ref.onDelete === 'setNull') {
          const rows = await (targetSpec.table as any).where(targetField).equals(id).toArray()
          for (const r of rows) await targetSpec.table.update((r as any).id, { [targetField]: null })
        }
        break
      }
      case 'json': {
        // JSON 字段引用:扫描所有可能含该 id 的记录,按 jsonPath 移除/重写
        // 当前实现:全表扫描(数据量小,可接受;大数据后做索引)
        const m = ref.target.match(/^(\w+)\[(\w+)\]$/)
        if (!m) break
        const [, targetName] = m
        const targetSpec = REGISTRY_BY_NAME.get(targetName)
        if (!targetSpec) break

        const rows = await (targetSpec.table as any).toArray()
        for (const r of rows) {
          const jsonStr = (r as any)[ref.field]
          if (!jsonStr) continue
          try {
            const parsed = JSON.parse(jsonStr)
            // 简化:此处用 jsonpath 库或自写小解析
            const cleaned = removeJsonRef(parsed, ref.jsonPath, id, ref.onDelete)
            if (cleaned !== parsed) {
              await targetSpec.table.update((r as any).id, { [ref.field]: JSON.stringify(cleaned) })
            }
          } catch { /* 静默忽略坏 JSON */ }
        }
        break
      }
      case 'array': {
        // 数组字段引用:扫描所有包含该 id 的数组,移除该项
        const m = ref.itemTarget.match(/^(\w+)$/)
        if (!m) break
        // 实现略,与 json 类似但操作目标是数组而非 JSON path
        break
      }
      case 'indirect':
      case 'blob-owner':
        // 由 cascadeDeleteProject/Group 处理,这里不重复
        break
    }
  }

  await spec.table.delete(id)
}

// ─────────────────────────────────────────────────────────────
// validateRegistry - 启动期完整性校验
// ─────────────────────────────────────────────────────────────

export function validateRegistry(): void {
  const dexieTableNames = db.tables.map(t => t.name)
  const registryTableNames = PROJECT_TABLES.map(s => s.name)

  const missing = dexieTableNames.filter(n => !registryTableNames.includes(n))
  const extra = registryTableNames.filter(n => !dexieTableNames.includes(n))

  if (missing.length) throw new Error(`[Registry] 缺失登记: ${missing.join(', ')}`)
  if (extra.length) throw new Error(`[Registry] 多了不存在的表: ${extra.join(', ')}`)

  // 校验所有 RefSpec.target 表名存在
  for (const spec of PROJECT_TABLES) {
    for (const ref of spec.refs ?? []) {
      if (ref.kind === 'simple' || ref.kind === 'json') {
        const m = ref.target.match(/^(\w+)\[/)
        if (m && !REGISTRY_BY_NAME.has(m[1])) {
          throw new Error(`[Registry] ${spec.name}.refs 指向不存在的表: ${ref.target}`)
        }
      }
    }
  }
}
```

> 📌 **实施者注**:`topoSort` / `removeJsonRef` 等辅助函数 5.5 自由实现(都是 < 30 行的纯函数)。
> 关键的"事务作用域 / 拓扑序 / 间接归属 / Blob owner"四类难点在伪代码里已点透。

**关键不变量**:
- 启动期 `validateRegistry()` 校验：
  - 注册表中每张表都存在于 Dexie 实例
  - Dexie 中每张表都在注册表里登记（反之亦然）
  - 所有 `target/via.table` 引用的表名存在
  - JSON refs 的 `jsonPath` 语法正确
  - 不一致则 **throw**（开发期立刻发现）

### 5.2 FIELD_REGISTRY + AdoptionSchema（v2 强化版）

```ts
// src/lib/ai/field-registry.ts

export interface FieldSpec {
  target: string  // 表名
  field: string
  type: 'string' | 'longtext' | 'json' | 'number' | 'boolean' | 'enum'
  enums?: string[]
  worldScoped?: boolean
  aliases?: string[]
  sanitize?: (val: unknown) => unknown
  label?: string
  /** 中文枚举归一（如 role: 主角→protagonist） */
  enumAliasMap?: Record<string, string>
}

// src/lib/ai/adoption-schema.ts

export interface CollectionAdoptionSpec {
  target: string  // 集合表名
  /** 唯一键策略（去重） */
  identity: 'id' | 'name' | { kind: 'composite'; fields: string[] }
  /** 重复时的策略 */
  duplicatePolicy: 'skip' | 'update' | 'merge' | 'error'
  /** 必填字段（缺失则跳过该条） */
  required: string[]
  /** 自动盖章字段（如 projectId/worldGroupId/homeWorldGroupId） */
  autoStamps: ('projectId' | 'worldGroupId' | 'homeWorldGroupId' | 'createdAt' | 'updatedAt')[]
  /** FK 校验：写入前检查这些字段引用是否存在 */
  fkChecks?: { field: string; target: string }[]
  /** 数组成员校验 */
  arrayMemberChecks?: { field: string; itemTarget: string }[]
  /** merge 策略（mode=merge 时） */
  mergeStrategy?: 'overwrite-non-empty' | 'append-text' | 'union-array'
}

// src/lib/ai/adopt.ts

export interface AdoptInput {
  projectId: number
  worldGroupId?: number | null
  target: string
  data: Record<string, unknown> | Record<string, unknown>[]
  mode: 'replace' | 'append' | 'add' | 'add-many' | 'merge-diffs'
}

export interface AdoptResult {
  written: { id: number; fields: string[] }[]
  aliasMapped: { from: string; to: string }[]
  unknown: string[]
  typeErrors: { field: string; expected: string; got: string }[]
  fkErrors: { field: string; refValue: unknown }[]
  skipped: { reason: string; data: unknown }[]
}

export async function adopt(input: AdoptInput): Promise<AdoptResult>
```

**adopt() 实现伪代码**(实施者可直接照写):

```ts
const FIELD_BY_TARGET = new Map<string, FieldSpec[]>()
for (const f of FIELD_REGISTRY) {
  const arr = FIELD_BY_TARGET.get(f.target) ?? []
  arr.push(f)
  FIELD_BY_TARGET.set(f.target, arr)
}

const ADOPTION_BY_TARGET = new Map<string, CollectionAdoptionSpec>(
  ADOPTION_SCHEMAS.map(s => [s.target, s] as const)
)

export async function adopt(input: AdoptInput): Promise<AdoptResult> {
  const result: AdoptResult = {
    written: [], aliasMapped: [], unknown: [], typeErrors: [], fkErrors: [], skipped: [],
  }

  const fieldSpecs = FIELD_BY_TARGET.get(input.target) ?? []
  if (!fieldSpecs.length) {
    result.skipped.push({ reason: `target ${input.target} 未在 FIELD_REGISTRY 登记`, data: input.data })
    return result
  }

  const tableSpec = PROJECT_TABLES.find(s => s.name === input.target)
  if (!tableSpec) throw new Error(`[adopt] target ${input.target} 不在 PROJECT_TABLES`)

  // 分支:集合 vs 单例
  const isCollection = ['add', 'add-many', 'merge-diffs'].includes(input.mode)

  if (isCollection) {
    return await adoptCollection(input, fieldSpecs, tableSpec, result)
  } else {
    return await adoptSingleton(input, fieldSpecs, tableSpec, result)
  }
}

// ─────────────────────────────────────────────────────────────
// 单例写回(worldviews / storyCores / creativeRules 等)
// ─────────────────────────────────────────────────────────────
async function adoptSingleton(
  input: AdoptInput, fieldSpecs: FieldSpec[], tableSpec: TableSpec, result: AdoptResult,
): Promise<AdoptResult> {
  const data = input.data as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  // 1. 别名映射 + 类型校验
  const byName = new Map(fieldSpecs.map(f => [f.field, f] as const))
  const byAlias = new Map<string, FieldSpec>()
  for (const f of fieldSpecs) for (const a of f.aliases ?? []) byAlias.set(a, f)

  for (const [key, val] of Object.entries(data)) {
    if (val == null || val === '') continue

    let spec = byName.get(key)
    let canonical = key
    if (!spec) {
      const aliasHit = byAlias.get(key)
      if (aliasHit) {
        spec = aliasHit
        canonical = aliasHit.field
        result.aliasMapped.push({ from: key, to: canonical })
      } else {
        result.unknown.push(key)
        console.warn(`[adopt] 未知字段: ${input.target}.${key}`)
        continue
      }
    }

    const cleaned = validateAndCoerce(spec, val, result)
    if (cleaned === undefined) continue

    if (input.mode === 'append' && spec.type === 'longtext') {
      const existing = await getCurrentFieldValue(input, spec)
      patch[canonical] = existing ? `${existing}\n\n${cleaned}` : cleaned
    } else {
      patch[canonical] = cleaned
    }
  }

  // 2. 以 DB 为准定位记录(防"内存为 null 建重复"那一类 bug)
  const all = await tableSpec.table.where('projectId').equals(input.projectId).toArray()
  let target: any = null
  if (tableSpec.worldScoped) {
    const wgField = tableSpec.worldGroupField ?? 'worldGroupId'
    target = all.find((r: any) => (r[wgField] ?? null) === (input.worldGroupId ?? null))
  } else {
    target = all[0]
  }

  // 3. 写入(update 或 add)
  if (target?.id) {
    await tableSpec.table.update(target.id, { ...patch, updatedAt: Date.now() })
    result.written.push({ id: target.id, fields: Object.keys(patch) })
  } else {
    const newRow = {
      projectId: input.projectId,
      ...(tableSpec.worldScoped ? { worldGroupId: input.worldGroupId ?? null } : {}),
      ...patch,
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    const id = await tableSpec.table.add(newRow as any) as number
    result.written.push({ id, fields: Object.keys(patch) })
  }

  return result
}

// ─────────────────────────────────────────────────────────────
// 集合写回(characters / foreshadows / codexEntries 等)
// ─────────────────────────────────────────────────────────────
async function adoptCollection(
  input: AdoptInput, fieldSpecs: FieldSpec[], tableSpec: TableSpec, result: AdoptResult,
): Promise<AdoptResult> {
  const adoption = ADOPTION_BY_TARGET.get(input.target)
  if (!adoption) {
    throw new Error(`[adopt] target ${input.target} 是集合写回但未在 ADOPTION_SCHEMAS 登记`)
  }

  const items = Array.isArray(input.data) ? input.data : [input.data as Record<string, unknown>]

  for (const raw of items) {
    // 1. 字段映射(同单例)
    const item = normalizeAndValidate(raw, fieldSpecs, result)
    if (!item) continue

    // 2. 必填字段校验
    for (const req of adoption.required) {
      if (!item[req]) {
        result.skipped.push({ reason: `必填字段 ${req} 缺失`, data: raw })
        continue
      }
    }

    // 3. FK 校验(防 AI 幻觉 ID 进库)
    let fkOk = true
    for (const fk of adoption.fkChecks ?? []) {
      const refValue = item[fk.field]
      if (refValue == null) continue
      const targetSpec = PROJECT_TABLES.find(s => s.name === fk.target)
      if (!targetSpec) continue
      const exists = await targetSpec.table.get(refValue as number)
      if (!exists) {
        result.fkErrors.push({ field: fk.field, refValue })
        fkOk = false
        break
      }
    }
    if (!fkOk) {
      result.skipped.push({ reason: 'FK 校验失败', data: raw })
      continue
    }

    // 4. 数组成员校验(防 AI 幻觉 ID 进 JSON 数组)
    for (const arr of adoption.arrayMemberChecks ?? []) {
      const arrValue = item[arr.field] as unknown[]
      if (!Array.isArray(arrValue)) continue
      const targetSpec = PROJECT_TABLES.find(s => s.name === arr.itemTarget)
      if (!targetSpec) continue
      const filtered: unknown[] = []
      for (const v of arrValue) {
        if (await targetSpec.table.get(v as number)) filtered.push(v)
        else result.fkErrors.push({ field: `${arr.field}[]`, refValue: v })
      }
      item[arr.field] = filtered
    }

    // 5. 自动盖章(projectId / worldGroupId / homeWorldGroupId / 时间戳)
    for (const stamp of adoption.autoStamps) {
      if (stamp === 'projectId') item.projectId = input.projectId
      else if (stamp === 'worldGroupId' && tableSpec.worldScoped) item.worldGroupId = input.worldGroupId ?? null
      else if (stamp === 'homeWorldGroupId' && tableSpec.homeWorldScoped) item.homeWorldGroupId = input.worldGroupId ?? null
      else if (stamp === 'createdAt') item.createdAt = Date.now()
      else if (stamp === 'updatedAt') item.updatedAt = Date.now()
    }

    // 6. 去重 + 写入
    const existing = await findExisting(tableSpec, item, adoption)
    if (existing) {
      if (adoption.duplicatePolicy === 'skip') {
        result.skipped.push({ reason: '重复(skip)', data: raw })
      } else if (adoption.duplicatePolicy === 'update') {
        await tableSpec.table.update(existing.id, item)
        result.written.push({ id: existing.id, fields: Object.keys(item) })
      } else if (adoption.duplicatePolicy === 'merge') {
        const merged = mergeByStrategy(existing, item, adoption.mergeStrategy ?? 'overwrite-non-empty')
        await tableSpec.table.update(existing.id, merged)
        result.written.push({ id: existing.id, fields: Object.keys(merged) })
      } else if (adoption.duplicatePolicy === 'error') {
        throw new Error(`[adopt] 重复记录 ${input.target}.${JSON.stringify(item)}`)
      }
    } else {
      const id = await tableSpec.table.add(item as any) as number
      result.written.push({ id, fields: Object.keys(item) })
    }
  }

  return result
}

// 工具函数(实施者自由实现细节):
// - validateAndCoerce(spec, val, result) → 类型校验 + 枚举归一(role: 主角→protagonist)
// - normalizeAndValidate(raw, specs, result) → 单条记录的字段映射 + 校验
// - findExisting(tableSpec, item, adoption) → 按 identity 策略找已有记录(id / name / composite)
// - mergeByStrategy(existing, item, strategy) → overwrite-non-empty / append-text / union-array
// - getCurrentFieldValue(input, spec) → 取单例表当前字段值(用于 append 模式)
```

> 📌 **实施者注**:6 个工具函数都是 < 30 行的纯函数,5.5 自由实现。
> 核心难点(别名映射 / FK 校验 / 数组成员校验 / 自动盖章 / 去重策略)在伪代码里已点透。

### 5.3 CONTEXT_SOURCES（v2 强化版）

```ts
// src/lib/ai/context-registry.ts

export interface ContextSource<T = unknown> {
  id: string
  label: string
  layer: 'L0' | 'L1' | 'L2' | 'L3'
  scope: 'world' | 'global' | 'node'
  budget: number
  build: (input: AssembleInput) => Promise<string> | string
  enabledWhen?: (input: AssembleInput, project: Project) => boolean
  /** 测试断言：必须有这个 source 的隔离测试（CI 校验） */
  testAssertion?: 'world-isolated' | 'global' | 'node-derived'
}

export async function assembleContext(input: AssembleInput): Promise<AssembleResult>

// 强化点：
// 1. scope='world' 的 source 必须接收 worldGroupId（运行时校验）
// 2. 实现真裁剪（L3→L2→L1 真删 segment 后再发送）
// 3. assembleContext 返回的 sections 用于消耗统计/预算条
```

**assembleContext() 实现伪代码**(实施者可直接照写):

```ts
const SOURCE_BY_ID = new Map(CONTEXT_SOURCES.map(s => [s.id, s] as const))

export async function assembleContext(input: AssembleInput): Promise<AssembleResult> {
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('[assembleContext] 项目不存在')

  // ──────────────────────────────────────────
  // Step 1:多世界 worldGroupId 解析
  // ──────────────────────────────────────────
  // 优先级:input.worldGroupId 显式传入 > 按 nodeId 沿父链解析 > 单世界 null
  let resolvedWg = input.worldGroupId ?? null
  if (project.enableMultiWorld && resolvedWg == null && input.nodeId != null) {
    resolvedWg = await resolveNodeWorldGroupId(input.projectId, input.nodeId)
  }
  const resolved: AssembleInput = { ...input, worldGroupId: resolvedWg }

  // ──────────────────────────────────────────
  // Step 2:运行时校验 scope='world' 必须有 worldGroupId
  // ──────────────────────────────────────────
  const need = new Set(input.need)
  for (const id of need) {
    const src = SOURCE_BY_ID.get(id)
    if (!src) {
      console.warn(`[assembleContext] need 中含未登记的 source: ${id}`)
      continue
    }
    if (src.scope === 'world' && project.enableMultiWorld && resolvedWg == null) {
      console.warn(`[assembleContext] source ${id} 是 world-scoped 但未指定 worldGroupId(项目多世界模式)`)
    }
  }

  // ──────────────────────────────────────────
  // Step 3:并行 build 所有声明的源
  // ──────────────────────────────────────────
  const tasks = CONTEXT_SOURCES
    .filter(s => need.has(s.id))
    .filter(s => !s.enabledWhen || s.enabledWhen(resolved, project))
    .map(async (s): Promise<AssembledSection | null> => {
      try {
        const text = await s.build(resolved)
        if (!text || !text.trim()) return null

        const budget = input.budgetOverride?.[s.id] ?? s.budget
        const clipped = text.length > budget
          ? text.slice(0, budget) + '\n…(单源预算截断)'
          : text

        return {
          id: s.id,
          label: s.label,
          layer: s.layer,
          text: clipped,
          tokens: estimateTokens(clipped),
        }
      } catch (err) {
        console.warn(`[assembleContext] source ${s.id} build 失败:`, err)
        return null
      }
    })

  const sections = (await Promise.all(tasks)).filter(Boolean) as AssembledSection[]

  // ──────────────────────────────────────────
  // Step 4:按 layer 排序(L0 在前必留 / L3 末尾可丢)
  // ──────────────────────────────────────────
  sections.sort((a, b) => a.layer.localeCompare(b.layer))

  // ──────────────────────────────────────────
  // Step 5:真裁剪(超总预算时 L3→L2→L1 真删 segment)
  // ──────────────────────────────────────────
  const trimmedLayers: string[] = []
  if (input.totalBudget != null) {
    let total = sections.reduce((s, x) => s + x.tokens, 0)
    for (const layer of ['L3', 'L2', 'L1'] as const) {
      if (total <= input.totalBudget) break
      const toRemove = sections.filter(s => s.layer === layer)
      if (toRemove.length) {
        const removed = toRemove.reduce((sum, s) => sum + s.tokens, 0)
        for (const s of toRemove) {
          const idx = sections.indexOf(s)
          if (idx >= 0) {
            sections.splice(idx, 1)
            s.trimmed = true
          }
        }
        total -= removed
        trimmedLayers.push(layer)
      }
    }
    // L0 必留:如仍超预算只能告警,不能再删
    if (total > input.totalBudget) {
      console.warn(`[assembleContext] L0 必留层超预算 ${total}/${input.totalBudget}`)
    }
  }

  // ──────────────────────────────────────────
  // Step 6:拼装 fullContext
  // ──────────────────────────────────────────
  return {
    fullContext: sections.map(s => s.text).join('\n\n'),
    sections,
    totalTokens: sections.reduce((s, x) => s + x.tokens, 0),
    trimmedLayers,
    resolvedWorldGroupId: resolvedWg,
  }
}

// 工具函数(实施者自由实现):
// - resolveNodeWorldGroupId(projectId, nodeId) → 沿大纲 parentId 父链找到所属世界
// - estimateTokens(text) → 中文 ~1.5 字符/token,英文 ~4 字符/token,粗估
```

> 📌 **实施者注**:`resolveNodeWorldGroupId` / `estimateTokens` 都是 < 20 行纯函数,5.5 自由实现。
> 关键的"多世界解析 / 运行时 scope 校验 / 真裁剪 L3→L2→L1"在伪代码里已点透。

---

## 六、AI 行为说明书自动生成器规格

### 6.1 为什么必须自动生成

GPT 5.5 审计已证明：手写说明书会过期（21 处 prompt key 错），不能作为事实源。

### 6.2 生成器输入

扫描代码得到：
1. 所有 `PromptModuleKey` 枚举（从 `src/lib/types/prompt.ts`）
2. 所有 `prompt-seeds.ts` 中的模板定义（含 variables/parameters）
3. 所有 `ai.start(...)` / `chat(...)` 调用点（带 meta.category）
4. 所有 adapter `build*Prompt` 函数（参数列表 = 读取的上下文）
5. 所有写回路径（store 调用 / adopt 调用）
6. `PROJECT_TABLES` 字段定义
7. `FIELD_REGISTRY` 字段定义

### 6.3 生成器输出

`docs/AI-FUNCTIONS-MANUAL.generated.md`（前缀 `generated` 标识自动产物）：

```markdown
# AI 行为说明书（自动生成 · 请勿手动编辑）

> 由 scripts/generate-ai-manual.ts 生成
> 基于 commit: <hash>
> 时间: <timestamp>

## 按面板分组的 AI 动作清单

### 面板：worldview-origin
| ID | moduleKey | 读取字段 | 写回字段 | 触发文件:行号 |
|---|---|---|---|---|
| ... | worldview.dimension | storyCores.theme, worldviews.powerHierarchy, ... | worldviews.worldOrigin | WorldviewOriginPanel.tsx:221 |
...
```

### 6.4 人工补充

`docs/AI-FUNCTIONS-MANUAL.semantic.md`（手工写）：
- 每个动作的语义说明（"这个动作的业务意图是什么"）
- 已知问题与坑（"这个动作在多世界下..."）
- 用户视角的解释

### 6.5 CI 校验

CI 跑：
1. 自动生成最新版 `AI-FUNCTIONS-MANUAL.generated.md`
2. 与仓库中已提交的版本 diff
3. 不一致则 fail（提示开发者跑 `npm run gen:ai-manual`）

`semantic.md` 中引用的所有 ID 必须存在于 `generated.md`（防止语义注释引用已删除的动作）。

---

## 七、测试与 CI 策略

### 7.1 反例测试网（每个已知 bug 一条断言）

**位置**：`tests/regression/`

| 测试 ID | 反例 |
|---|---|
| R-1 | 删世界组后 10 张 worldScoped 表无该 wgId 残留 |
| R-2 | 开启多世界后 worldScoped 表无 null `worldGroupId` 残留（含 codexEntries） |
| R-3 | 多世界项目导出再导入后所有 worldGroupId 正确 |
| R-4 | 缺章节 outlineNodeId 的导入应整体回滚 |
| R-5 | 删项目后 importLogs/importFiles/importJobs/master blob 无残留 |
| R-6 | 删大纲节点后 emotionBeatCards 无残留 |
| R-7 | 删角色后 detailedOutlines.appearingCharacterIds 中不再含该角色 id |
| R-8 | 状态 diff 同实体多字段不创建重复卡 |
| R-9 | 单例 store save 不创建重复记录 |
| R-10 | 灵感反推采纳后 worldview 字段正确填写（aliases 生效） |
| R-11 | 章节正文 prompt 实际发送内容包含 worldRulesContext |
| R-12 | AIFieldCard 生成带 currentValue |
| R-13 | 多世界批量正文按章节所属世界（不串台） |
| R-14 | autoTrimToFit 超预算时 L3 先被丢 |
| R-15 | chat AbortSignal 真取消（不消耗 token） |
| R-16 | HTML 导出包含 `<script>` 的章节内容时脚本被清洗 |
| R-17 | ensureSchema 缺表生产环境不删库 |

### 7.2 注册表完整性测试

- PROJECT_TABLES vs Dexie 实例双向覆盖
- 所有 RefSpec.target 表名存在
- 所有 JsonRef.jsonPath 语法正确
- FIELD_REGISTRY 所有 target 表存在
- CONTEXT_SOURCES 无重复 id

### 7.3 多世界往返冒烟（人工脚本 + 自动）

```
1. 建新项目 → 开启多世界 → 建 3 个世界
2. 各世界填不同的 worldview/codex/worldRules/角色
3. 全字段冒烟生成（章节/大纲/细纲/角色/伏笔/场景考证）
4. 抽样断言 prompt 内容按所属世界
5. 导出 JSON → 删项目 → 导入 JSON
6. 断言 worldGroupId 全部正确
7. 删一个世界 → 断言无孤儿数据
```

### 7.4 写回反例测试

针对 `adopt()`：
- 别名映射（summary→worldOrigin 等 21 个 aliases）
- 类型校验（role 中文→英文枚举）
- FK 校验（AI 幻觉 ID 被拒绝）
- 集合去重（重名角色按 name 合并）

### 7.5 上下文一致性测试

针对 `assembleContext()`：
- 同 input 多次调用结果一致
- need 中包含的 source 必须出现在输出
- need 中不包含的不得出现

### 7.6 多世界上下文隔离测试

构造场景：项目里两个世界 A/B 各有不同 worldview/codex
- `assembleContext({wgId: A, need: ['worldview', 'codex']})` 不得含 B 的内容
- `assembleContext({wgId: B, need: [...]})` 不得含 A 的内容

### 7.7 真裁剪测试

构造一个超预算的 input：
- 断言返回 result 的 trimmedLayers 包含 L3
- 断言最终发送 messages 字符数 ≤ 预算

### 7.8 真实与幻想多世界冒烟（Phase 2.1 完成后）

按 `WORLD-RULES-MULTIWORLD-DESIGN.md` §四 验证清单。

### 7.9 CI lint 规则

`.github/workflows/lint.yml`：

```yaml
jobs:
  registry-lint:
    - 跑 validateRegistry()，注册表与 Dexie 不一致则 fail
  ai-manual-sync:
    - npm run gen:ai-manual
    - git diff docs/AI-FUNCTIONS-MANUAL.generated.md → 不为空则 fail
  prompt-key-existence:
    - 扫描 docs/AI-FUNCTIONS-MANUAL.semantic.md 引用的 moduleKey
    - 必须全部存在于 PromptModuleKey 类型
  context-source-isolation:
    - 跑 §7.6
  transaction-scope-completeness:
    - AST 分析所有 db.transaction(...) 调用
    - 事务体内访问的表必须全部在事务声明里
    - 不一致则 fail
  ai-call-meta-coverage:
    - 扫描所有 ai.start/chat 调用
    - 必须传 meta.category（除明确豁免列表）
```

---

## 八、风险与回滚

### 8.1 风险矩阵（重点项）

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| Phase 0 修复引入新回归 | 中 | 中 | 反例测试网每步必跑；commit 粒度小，单回滚 |
| Phase 1 注册表写错 | 中 | 高 | 启动期 validateRegistry + CI 校验 |
| 32+ 调用点迁移漏 | 中 | 中 | CI grep lint 强制；旧函数标 @deprecated 但保留 |
| Phase 40 多世界化破坏单世界 | 低 | 高 | 单世界默认路径行为不变；测试 §7.6/7.8 |
| AI 说明书生成器漏识别 | 中 | 中 | 输出含 unknown 节点提示人工补；CI 不允许 unknown |
| 长任务我自己改飘（接手方一致性） | 高 | 中 | 每个 Phase 完成判据 checkbox；下一个 Phase 必须前一个完成 |

### 8.2 回滚策略

- 每个 §4 任务一个 commit；commit message 含任务 ID + 验证脚本
- 任务级回滚：`git revert <commit>`
- Phase 级回滚：`git revert <第一commit>..<最后commit>`（保留过程记录）
- 数据库迁移：每次 schema bump 同步写"反向迁移"或导出/导入兼容性测试

### 8.3 停止信号（接手者必须停下来的时刻）

- 反例测试网某条失败且不能在 30 分钟内修好
- tsc 错误不能解
- 改完代码本地数据库出现损坏
- 不确定一个动作是否会丢用户数据
- 文档与代码冲突且不知如何裁决

→ 停下，写到 ROADMAP，开 issue，等决策。

---

## 九、性能与安全

### 9.1 性能目标

| 指标 | 当前 | 目标 |
|---|---|---|
| 首屏 JS 主包 | 1.93 MB | < 1 MB |
| 首屏首字时间（FCP） | 未测 | < 2 s |
| 章节正文生成上下文构建 | 未测 | < 200 ms |
| 多世界项目导出（5 世界、10 万字） | 未测 | < 3 s |

实施手段：
- React.lazy 重面板（world-map/master/3D）
- Phase 0–1 完成后再做（避免基础不稳时调性能）

### 9.2 安全清单

- [ ] HTML 导出：DOMPurify 白名单清洗
- [ ] EPUB 导出：同上
- [ ] AI 输出 SVG：已 sanitize（保持）
- [ ] GitHub PAT：默认 session-only，显式持久化
- [ ] localStorage 敏感数据：审计一遍，必要项加密或不存
- [ ] 第三方 AI Provider：URL 白名单提示（防钓鱼）

---

## 十、接手指南（任何模型/任何人）

### 10.1 第一周清单（再次强调）

见 §0.5

### 10.2 关键沟通规约

- **改动前先读对应任务的「前置」**
- **改动后必须跑「验证」**，不允许跳过
- **任何"我觉得应该可以"=立刻停下**，写问题到 ROADMAP
- **不允许修改 `MASTER-BLUEPRINT.md` 的内容**，除非完成一个完整 Phase 后追加"完成记录"
- **CHANGELOG 必须每 commit 同步更新**（这是修补本次工作中已确认的 CHANGELOG 不完整问题）

### 10.3 何时寻求决策（不能自己拍板）

- DB schema 变更（版本 bump）
- 删除任何用户数据（即使是修 bug）
- 引入新依赖
- 任何超出本蓝图范围的"顺手优化"
- 与本蓝图明显冲突的代码模式

### 10.4 跨模型接手的注意

如果接手者是另一个 AI 模型：
- 先读 §0.1–0.5 + §1（建立现状认知）
- 再读 §3（哲学）+ §4（具体任务）
- 不要假设你"记得"之前模型做了什么 — 一切以 git log 和本文档为准
- 不要修改 `AI-FUNCTIONS-MANUAL.md` 手写版（它已废弃），只通过生成器更新

---

## 十一、完成判据（精品级）

### 11.1 阶段判据

见 §4 各 Phase 末尾。

### 11.2 整体（开源大赛参评）

- [ ] Phase 0/1/2/3 全部完成
- [ ] CI 全绿（含 lint/test/build）
- [ ] 测试覆盖 ≥ 60%
- [ ] tsc 严格模式零错
- [ ] ESLint 零警告
- [ ] README 含五分钟入门 + 截图 + 中英双语
- [ ] CONTRIBUTING.md 完整
- [ ] AI 说明书自动生成 + CI 校验
- [ ] 三个注册表稳定 + lint 强制
- [ ] 已知 17 bug 反例测试全绿
- [ ] 多世界、词条、三层记忆、一致性检测 等创新功能均可用
- [ ] 安全清单全部勾选
- [ ] 主包 < 1 MB
- [ ] 项目可在 GitHub Discussions 接收反馈，作者响应及时

---

## 十二、维护规约（永久）

### 12.1 加新功能的强制流程

1. 确认是否需要 DB schema 改动 → 是 → schema bump + 写迁移测试
2. 确认是否影响 PROJECT_TABLES → 是 → 加新表/字段登记
3. 确认是否有新 AI 调用 → 是 → 加 `meta.category`；自动生成的 manual 会更新
4. 确认是否有新可写字段 → 是 → 加到 FIELD_REGISTRY 或 AdoptionSchema
5. 确认是否有新上下文源 → 是 → 加到 CONTEXT_SOURCES（并写测试）
6. 改代码 + 跑测试 + 提 PR
7. PR review 时强制对照本蓝图 §3 五条原则

### 12.2 加新动作的强制流程

不允许直接调 `ai.start/chat`。必须经 `assembleContext + adopt` 链路。例外（如 reference 分析的硬编码 prompt）必须在本蓝图记一行豁免理由。

### 12.3 改 AI 行为的强制流程

1. 改 prompt-seeds 模板
2. 改对应 source 的 budget/scope（如需）
3. 跑生成器更新 `AI-FUNCTIONS-MANUAL.generated.md`
4. 必要时在 `semantic.md` 补语义注解
5. 跑反例测试，确保不破坏既有行为

### 12.4 文档同步

任何对**用户可见行为**的改动都必须：
- 更新 `AI-FUNCTIONS-MANUAL.semantic.md`（语义说明）
- 更新 `CHANGELOG.md`（用户视角）
- 必要时更新 `DATA-FLOW-MAP.md` 或 `DATA-FLOW-DIAGRAM.md`

---

## 十三、外部审查综合摘要（不可质疑的事实基准）

本节固化三份外部独立审查的关键结论。任何接手者均**不得质疑**这些已确认事实，除非用更严格的代码审查推翻。

### 13.0 三份审查来源
1. **本轮内部全量审计**（Claude，6 批 + 复核）
2. **GPT 5.5 独立代码审查**（只读、覆盖 src 87,709 行）
3. **Gemini 3.1 独立代码审查**（脚本驱动 + 灾难场景叙事）

### 13.0.1 三份审查的独立发现分布

| 问题 | 内部 | GPT-5.5 | Gemini-3.1 |
|---|---|---|---|
| deleteGroup 事务作用域漏表 | ❌ 漏 | ✅ 抓到 | — |
| migrateToMultiWorld 事务漏 codexEntries | ❌ 漏 | ✅ 抓到 | — |
| **migrateToMultiWorld 漏盖章 outlineNodes** | ❌ 漏 | ❌ 漏 | ✅ **独立抓到** |
| ensureSchema 删库风险 | ❌ 漏 | ✅ 抓到 | — |
| BUG-EXPORT-WG | ✅ 抓到 | ✅ 复核 | — |
| importProjectJSON 非事务 + FK 写 0 | ❌ 漏 | ✅ 抓到 | — |
| deleteProject 漏 importFiles/Logs/Jobs | ⚠️ 部分 | ✅ 完整 | ✅ 含灾难场景 |
| deleteNode 绕过 deleteChapter | ❌ 漏 | ✅ 抓到 | — |
| chapter.content 不读 worldRulesContext | ❌ 漏 | ✅ 抓到 | ✅ 独立确认 |
| **handleExtractState 用全量召回** | ❌ 漏 | ❌ 漏 | ✅ **独立抓到** |
| WorkflowRunner 无输入 + 不注入项目 | ✅ 抓到 | ✅ 复核 | — |
| AI Manual 21 处 key 错 | ❌ 漏 | ✅ 抓到 | ✅ 独立确认（"虚假宣发"） |
| AIFieldCard 不传 currentValue | ❌ 漏 | ✅ 抓到 | — |
| autoTrimToFit 只算不真裁 | ✅ 自承 | ✅ 复核 | — |
| chat 不接 AbortSignal | ❌ 漏 | ✅ 抓到 | — |
| HTML/EPUB 不 sanitize | ❌ 漏 | ✅ 抓到 | — |

**关键观察**：
- 内部审计漏了 **9 项**
- GPT-5.5 抓到 **15 项**，独立发现 **8 项**
- Gemini-3.1 抓到 **8 项**，**独立发现 2 项（P0-8 + P1-17）+ 表达方式贡献**（灾难场景还原）
- 三份审查互补，叠加后基本无大遗漏

### 13.0.2 三份审查方法论的差异（值得学习）

| 维度 | 内部 | GPT-5.5 | Gemini-3.1 |
|---|---|---|---|
| 方法 | 一边修一边审，按记忆 | 静态全量覆盖 + 高风险路径深读 | 脚本驱动 + 业务灾难叙事 |
| 强项 | 熟悉代码上下文 | 工程严谨（事务作用域/JSON 引用/间接归属） | 用户视角灾难场景 + 教学性表达 |
| 弱项 | 盲点多（"我以为修了"） | 灾难表达较冷 | 部分判断不够细（如夹带 codex 严重度） |

**接手指南启示**：今后审查请综合多种风格 — 工程严谨 + 用户灾难场景 + 脚本验证。

### 13.1 已确认存在的高危问题

### 13.1 已确认存在的高危问题

| 类别 | 位置 | 已纳入 |
|---|---|---|
| BUG-EXPORT-WG 多世界归属丢失 | `json-export.ts:154/304/595/694` | §4.0.4 |
| importProjectJSON 非事务 + FK 写 0 | `json-export.ts:351/413/461/472` | §4.0.5 |
| deleteGroup 事务作用域不全 | `world-group.ts:88` | §4.0.1 |
| migrateToMultiWorld 事务作用域不全 | `world-group.ts:225` | §4.0.2 |
| deleteProject 漏间接归属 | `project.ts:64` | §4.0.6 |
| deleteNode 绕过 deleteChapter | `outline.ts:47` | §4.0.7 |
| worldRulesProfiles 单例（Phase 40 未落地） | `schema.ts:249` | §4.2.1 |
| chapter.content 模板声明 worldRulesContext 但 adapter 不接 | `chapter-adapter.ts:10` | §4.2.2 |
| 工作流步骤无用户输入 + 不注入项目上下文 | `WorkflowRunner.tsx:172` | §4.1.2 / §4.2 |
| AIFieldCard 不传 currentValue | `AIFieldCard.tsx:72` | §4.2.3 |
| autoTrimToFit 只算不真裁 | `context-budget.ts:190` | §4.1.3 |
| 非流式 chat 不接 AbortSignal | `client.ts:190` | §4.3.4 |
| HTML/EPUB 导出不 sanitize | `html-builder.ts:140` / `epub-export.ts:210` | §4.3.4 |
| AI 说明书 21 处 key 错 | `docs/AI-FUNCTIONS-MANUAL.md` | §4.3.1 / §6 |
| ensureSchema 删库风险 | `main.tsx:25` / `ensure-schema.ts:34` | §4.0.3 |
| AI 调用 meta 覆盖率低（39/59） | 各面板 | §4.3.1 配套 |
| **migrateToMultiWorld 漏盖章 outlineNodes**（Gemini 独立发现） | `world-group.ts:225` | §4.0.8 |
| **handleExtractState 用全量召回**（Gemini 独立发现） | `ChapterEditor.tsx:332/388` | §4.2.7 |

### 13.2 已确认无效的"修复"

见 §1.3。

### 13.3 三支柱方案补强项

| v1 缺陷 | v2 增强 |
|---|---|
| refs 只支持简单字段 | 扩展 JSON refs / Array refs / Indirect refs / Blob owner（§5.1） |
| scope 只三类 | 扩展 owner 五类（含 transient/blob） |
| FIELD_REGISTRY 集合写回写"略" | 引入 AdoptionSchema（§5.2） |
| CONTEXT_SOURCES 部分 scope='world' 实际 global | 强制每个 source 有 testAssertion + CI 校验（§5.3） |
| 缺真裁剪 | assembleContext 实现真裁剪（§5.3） |
| 缺事务作用域派生 | `transactionTablesFor(operation)` 派生 API + lint（§5.1） |
| 缺 AI manual 自动生成 | §6 新增 |
| 缺测试体系 | §7 新增完整规格 |

---

## 十四、附录：文档清理清单

### 14.1 需更新

| 文档 | 操作 |
|---|---|
| `ROADMAP.md` | 按本蓝图 §1.2 重排优先级；高优先级移除已纳入 Phase 0 的；添加 Phase 1/2/3 |
| `DATA-FLOW-MAP.md` | "已修"标签按 §1.3 逐条复核 |
| `DATA-FLOW-DIAGRAM.md` | 图八（生命周期×表矩阵）的"已修"标签同上 |

### 14.2 需归档（标 @deprecated）

| 文档 | 处置 |
|---|---|
| `ARCHITECTURE-REFACTOR.md` | 文件头加 `> ⚠️ 已废弃，见 MASTER-BLUEPRINT.md`；保留作历史参考 |
| `AI-FUNCTIONS-MANUAL.md` | 文件头加 `> ⚠️ 此手写版已废弃。最新自动生成版本：AI-FUNCTIONS-MANUAL.generated.md`；Phase 1 完成后删除 |
| `MULTI-WORLD-DESIGN.md`（V1） | 文件头标"已被 V2 取代" |
| `FEATURE-DESIGN-v1.md` | 同上 |

### 14.3 保留

- `WORLD-RULES-MULTIWORLD-DESIGN.md`（Phase 40 实施依据）
- `CODEX-REDESIGN.md`
- `CONSISTENCY-CHECK-DESIGN.md`
- `AI-COPILOT-DESIGN.md`
- `MULTI-WORLD-DESIGN-V2.md`
- `TOKEN-COST-GUIDE.md`
- `COMMUNITY-GUIDE.md`
- `FEATURE-GUIDE.md`
- `ARCHITECTURE.md`

---

## 十五、附录：与项目 README 的关系

完成 Phase 3 后，项目 `README.md` 应包含以下章节（参考开源精品项目模式）：

1. 项目简介（中英双语 1 段）
2. 截图 / 演示视频 / 在线 Demo 链接
3. 功能亮点（多世界、词条系统、三层记忆、一致性检测等）
4. 五分钟快速上手
5. 部署/本地运行
6. 文档目录（指向本蓝图、设计文档等）
7. 贡献指南（CONTRIBUTING）
8. License
9. 鸣谢

---

## 〆 终
