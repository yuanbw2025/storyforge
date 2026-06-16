# StoryForge · 项目执行原则（接手者必读）

> **本文件是项目的"宪法"。任何接手者（AI 模型 / 人类开发者）第一次进入本仓库时必须先读完本文件再动手。**
> 文件位置：仓库根目录（Claude Code / Cursor / Codex 等 AI 工具会自动加载此文件作为系统级上下文）。
> 创建：2026-06-04 ｜ 维护者：本项目作者 + 协作 AI 模型。

---

## 🔒 第一铁律：三个注册表是项目的"宪法"

本项目所有的扩展（加表 / 加字段 / 加 AI 动作 / 加上下文源）必须收口到三个单一事实源注册表，不允许散落手写。

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   ① CONTEXT_SOURCES    →  AI 读什么（上下文装配）            │
│      assembleContext({need: [...]})                          │
│                                                              │
│   ② FIELD_REGISTRY + AdoptionSchema  →  AI 写回什么          │
│      adopt({target, data})                                   │
│                                                              │
│   ③ PROJECT_TABLES     →  表的生命周期（导出/导入/删除/迁移）│
│      派生 5 个生命周期 API,不允许手写表清单                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**任何 AI 动作的本质都是**：

> **读** = `CONTEXT_SOURCES.assembleContext({need})`
> **写** = `FIELD_REGISTRY/AdoptionSchema.adopt({target, data})`
> **表元信息** = `PROJECT_TABLES`

不管"上→下生成"（如生成章节正文）、"下→上反推"（如灵感反推）、"下游提取"（如状态卡提取）——**三类全部走同一个机制,只是 reads/writes 方向不同**。

---

## 🚫 动手前的「四问」（必须依次过）

每次接到任务（加功能 / 修 bug / 改交互），动手前**必须依次回答这四个问题**。任何一问过不了 → 停下，先去补注册表 → 再写功能。

### ① 它**读**什么？
- 必须经 `CONTEXT_SOURCES + assembleContext`
- **不允许**：在面板组件里手挑组合 `buildWorldContext + buildCharacterContext + ...`
- 如果 `CONTEXT_SOURCES` 里没有需要的源 → **先去注册表加一行**，再写功能

### ② 它**写**什么？
- 必须经 `FIELD_REGISTRY + AdoptionSchema + adopt()`
- **不允许**：直接 `db.xxx.add / update`、手写字段映射、手写去重逻辑
- 如果是新字段 → 先去 `FIELD_REGISTRY` 加一行；如果是集合写回 → 先去 `AdoptionSchema` 加一条

### ③ 它涉及**哪些表的生命周期**？
- 必须经 `PROJECT_TABLES` 派生（`cascadeDeleteProject / cascadeDeleteGroup / stampPrimaryWorld / exportProjectByRegistry / importProjectByRegistry`）
- **不允许**：在 `deleteProject` / `deleteGroup` / `migrateToMultiWorld` / `exportProjectJSON` 任何一处手写表清单
- 如果是新表 → 先去 `PROJECT_TABLES` 加一行（含 owner / worldScoped / refs / exportable），生命周期自动覆盖

### ④ 如果以上三个注册表里**没登记**？
- **🛑 立刻停下**
- 先去注册表加一行
- **然后**再写功能
- **绝不允许**"先把这个 bug 修了，注册表改造慢慢来"

---

## ❌ 反面教材（永远不要这样做）

| 老毛病（头疼医头） | 正确做法 |
|---|---|
| 修 `deleteGroup` 漏 codex → 在该函数里多加几行 `db.codexEntries.delete(...)` | 改 `PROJECT_TABLES` 让 codex 的 worldScoped/refs 登记好，生命周期 API 自动覆盖 |
| 修灵感反推字段错位（AI 吐 `summary` 写不到 `worldOrigin`） → 在 InspirationPanel 里加 if/else 映射 | 改 `FIELD_REGISTRY` 给 `worldOrigin` 加 `aliases: ['summary']`，`adopt()` 自动处理 |
| 修章节正文不读 worldRules → 在 ChapterEditor 里加一行 `buildWorldRulesContext()` | 在 `CONTEXT_SOURCES` 注册 `worldRules` 源，所有调用 `assembleContext({need:['worldRules']})` 自动注入 |
| 加新表 → 直接 schema.ts 加 + 在 deleteProject 加一行 + 在 export 加一行 + 在 import remap 加一行... | `PROJECT_TABLES` 加一行，5 个生命周期 API 自动覆盖 |
| 加新 AI 动作 → 写新 adapter + 在面板里手拼 `buildXxxContext + ai.start` | 走 `assembleContext + adopt`，仅在 adapter 处定义 prompt 与 reads/writes |

**任何"先这样吧，等以后再统一"的念头 = 头疼医头 = 必然制造下一个反复出现的 bug**。直接拒绝。

---

## 📚 必读文档地图（按重要程度）

| 文档 | 地位 | 用途 |
|---|---|---|
| **`CLAUDE.md`（本文件）** | 🔒 项目宪法 | 任何接手者第一份必读，铁律与四问 |
| **`docs/MASTER-BLUEPRINT.md`** | 🔴 唯一施工权威 | 重构全流程 Phase 0/1/2/3 + 三注册表数据结构 |
| `docs/DATA-FLOW-MAP.md` | 🟡 历史审计记录 | 数据流总表 + 已修 bug 清单 |
| `docs/DATA-FLOW-DIAGRAM.md` | 🟢 可视化辅助 | 15 张 Mermaid 流程图 |
| `docs/ROADMAP.md` | 🟢 任务索引 | 待开发清单（按 MASTER-BLUEPRINT 重排优先级） |
| `docs/WORLD-RULES-MULTIWORLD-DESIGN.md` | 🟢 待实施设计 | Phase 40（多世界化真实与幻想） |
| `docs/CODEX-REDESIGN.md` | 🟢 待实施设计 | Phase 35 词条化重构 |
| `docs/CONSISTENCY-CHECK-DESIGN.md` | 🟢 待实施设计 | Phase 38/39 |
| ⚠️ `docs/AI-FUNCTIONS-MANUAL.md` | 🔴 已废弃手写版 | 21 处 prompt key 错，不可信。生成器上线后删除 |
| ⚠️ `docs/ARCHITECTURE-REFACTOR.md` | 🔴 v1 已废弃 | 被 MASTER-BLUEPRINT 取代 |

---

## ⚠️ 接手者第一次进入项目必须知道的事

### 1. 这是有真实用户的生产项目
- 用户数据全在浏览器 IndexedDB（纯前端项目）
- 任何 DB schema 变更 / 删除操作 / 数据迁移代码改动 = **可能直接损坏用户半年的小说手稿**
- 任何 push 到 main 分支的代码 = **立刻通过 Vercel 部署给全部用户**
- **没有 staging 环境**

### 2. 重构有 4 个阶段（严格串行，不可并行）
按 `MASTER-BLUEPRINT.md` §4：
- **Phase 0 · 紧急修复**（8 项 P0，含本轮自我承认无效的修复）
- **Phase 1 · 三支柱地基**（建立三个注册表）
- **Phase 2 · 多世界 + 上下文贯通**
- **Phase 3 · 精品化**（测试 / CI / 安全 / 性能）

### 3. 当前已知的"自己说修了实际无效"的坑
见 `MASTER-BLUEPRINT.md` §1.3。这类坑的根因都是违反了上面的"四问铁律"——**散在手写处而非走注册表**。

### 4. 外部三份审查（不可质疑事实基准）
本项目经历了三份独立审查：
- 内部全量审计（Claude）
- GPT-5.5 独立审查
- Gemini-3.1 独立审查

三份共识结论在 `MASTER-BLUEPRINT.md` §13。**任何接手者不得无凭据地推翻这些结论**。

---

## 🔧 改动前的检查清单（每次 commit 前必过）

- [ ] 已读 `MASTER-BLUEPRINT.md` 对应任务的「前置 / 改法 / 验证 / 完成判据」
- [ ] 已过「四问」（§动手前的「四问」）
- [ ] 改在分支上（非 main），分支名 `refactor/phase-X-task-Y` 或 `fix/issue-Z`
- [ ] `npx tsc --noEmit` 零错
- [ ] `npm run build` 成功
- [ ] 已跑对应反例测试（如 R-1/R-2/R-3 等，见 §7）
- [ ] commit message 含任务 ID + 完成判据状态 + 验证证据
- [ ] **如果改了 DB schema** → 已写迁移测试 + 已在测试项目跑过导出/导入往返
- [ ] **如果新增了表/字段/源/动作** → 已同步更新对应注册表

---

## ✅ 完成定义（Definition of Done · 交付前必逐条勾选）

> **为什么有这条**：词条化等历史返工的根因不是技术难，而是"加功能不收口、半成品单列出来留着不管"。不立规矩，屎山会以"半成品堆积"的形态再长出来。本条是**流程防线**，与三注册表（数据防线）、ESLint（代码防线）互补。

一个功能 / 任务要算"完成"，必须**同时**满足：

1. **可用**：主路径端到端走得通（不是"代码写完了"，是"用户真能用出结果"）。
2. **无重复 / 旧入口已下线**：🚫 不允许新旧并存。新功能取代老功能时，**老入口必须同步删除或下线**，不能侧栏 / 面板里新旧两个都挂着让用户困惑。
3. **数据读写走注册表**：读经 `CONTEXT_SOURCES`、写经 `adopt()`、表生命周期经 `PROJECT_TABLES`。没有裸 `db.xxx` 散写。
4. **半成品必须对用户不可见**：若一个功能暂时做不完，**明确标注"实验性 / Labs"并默认隐藏**，不允许"做一半还单列在侧栏 / 正式 UI 里"误导用户。做不完就藏起来，不是摆出来。
5. **有验证证据**：tsc / build / 对应反例测试 / `check:architecture` / `check:required-tables` 全绿；commit 写清验证证据。

> 交付（合并 main / 部署）前对照本清单逐条勾选。任何一条不满足 → 不算完成，要么补齐，要么按第 4 条藏起来。

---

## 🛑 立刻停下来的信号

任何接手者遇到以下情况 → **立刻停下，写到 ROADMAP，开 issue，等决策。不要"我觉得应该可以"**：

- 反例测试某条失败且 30 分钟内修不好
- tsc 错误不能解
- 改完代码本地数据库出现损坏
- 不确定一个动作是否会丢用户数据
- 文档与代码冲突且不知如何裁决
- 任务描述含糊（如出现 "略 / TODO / 暂时这样" 等占位词）
- 想"先这样吧，等以后再统一"

---

## 🤝 跨模型 / 跨人接手的提示

如果接手者是另一个 AI 模型（GPT / Gemini / Claude 其他会话）：

1. **先读本文件 + `MASTER-BLUEPRINT.md` §0–§3**（建立宪法认知）
2. 再读 §1.2（项目当前漏洞分级）+ §1.3（已确认无效的修复 — **不要踩坑**）
3. 然后读 §4 找到你被分配的 Phase
4. 严格按"前置 → 改法 → 验证 → 完成判据"执行
5. **不要假设"你记得之前模型做了什么"** — 一切以 `git log` 和本文档为准
6. 完成一个任务后等审查（默认审查者：另一个 AI 模型 / 人类）才能合并到 main

---

## 📜 本文件维护规则

- **任何改动本文件 = 改动项目宪法**，需要项目作者明确授权
- 添加新的"反面教材"或"四问"延伸时，可以追加（不需授权），但不能修改铁律本身
- 本文件不应超过 500 行；过长意味着失焦
- 文件应在每个 Phase 完成后做一次"是否还准确"的复核

---

## 🎯 最终目标

把 StoryForge 重构成**质量优秀、可参评开源项目大赛得奖**的项目。判据见 `MASTER-BLUEPRINT.md` §11.2。

> **不头疼医头、不脚痛医脚。**
> **改一处，让所有相关功能受益。**
> **这就是三个注册表存在的意义。**
