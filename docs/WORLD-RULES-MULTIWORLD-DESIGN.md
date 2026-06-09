# 「真实与幻想」多世界联动 · 设计文档

> 目标：把「真实与幻想」（世界规则 `worldRulesProfiles`，Phase 32）从**项目级单例**升级为**每世界一套**，与多世界系统联动。诸天流里斗破（全架空）与大明（取自真实）应各有独立的真实/幻想规则。
> 原则：**不留漏洞**——逐项列出隐患并给出对策。
> 状态：设计稿（待实现）｜创建 2026-06-04

---

## 〇、问题

- `worldRulesProfiles` 现为 `'++id, &projectId'`（**projectId 唯一** = 项目级单例）。
- `buildWorldRulesContext(projectId)` 项目级注入 AI（9 个调用点）。
- 多世界下所有世界**共用同一套**真实/幻想规则 → 对诸天流/无限流是错的：不同世界的"取自真实 / 架空改造 / 冲突优先"本应各不相同。

---

## 一、数据模型（表）

### 1.1 字段与索引

```ts
interface WorldRulesProfile {
  id?: number
  projectId: number
  worldGroupId?: number | null   // 新增：所属世界组（null = 单世界/主世界默认）
  entries: Record<string, WorldRuleEntry>   // 每世界独立
  customNodes: CustomWorldRuleNode[]         // 每世界独立
  globalNote?: string                        // 每世界独立
  createdAt: number
  updatedAt: number
}
```

- DB 索引：`'++id, &projectId'` → **`'++id, projectId, worldGroupId'`**（去掉 projectId 唯一约束，改为每 `(projectId, worldGroupId)` 一条）。DB 版本 +1（v27）。
- **不变量**：每 `(projectId, worldGroupId)` 至多一条 profile。

### 1.2 内置树 vs 每世界数据（关键区分）

- **内置节点树 `WORLD_RULE_TREE`** 由代码定义（L1 大类→L2 子类），**全局共享**，不进表。
- **每世界独立的只有**：`entries`（各节点的真实/幻想/冲突优先）、`customNodes`（用户自定义节点）、`globalNote`。
- 含义：每个世界基于同一套内置分类结构，各自填"哪些取自真实、哪些架空"。诸天流不同世界差异巨大，**完全独立**是正确模型（不共享 entries）。

### 1.3 迁移（无数据损坏）

- 现有项目的 profile `worldGroupId` 为 `undefined` → 视作 `null`，即"单世界 / 主世界默认 profile"。**无需数据迁移**。
- 单世界项目：永远 `worldGroupId=null`，一条 profile，行为与现状 100% 一致。

---

## 二、功能逻辑

### 2.1 Store（`stores/world-rules.ts`）

- `loadProfile(projectId, worldGroupId?: number | null)`：按 `(projectId, worldGroupId)` 取/建。
- **幂等 getOrCreate（防重复 bug）**：内存无 → **先查 DB**（按 projectId + worldGroupId）→ 有则用、无则建。绝不"内存为空就 add"（这是已多次出现的重复记录 bug 类，本设计明确规避）。
- 新增 `activeWorldGroupId` 状态；`_persist` 更新当前 profile。

### 2.2 面板（`WorldRulesPanel.tsx`）

- **多世界模式**：顶部世界标签切换（主世界 | 斗破 | 遮天 | …），仿 `HistoryPanel` 的 `worldTab` 实现。切换标签 = 加载/创建该世界 profile，独立编辑。
- **单世界模式**：无标签，一套 profile，与现状一致。
- 可选「一览」标签：只读对比所有世界的真实/幻想倾向（低优先）。

### 2.3 AI 注入（`buildWorldRulesContext` + 9 个调用点）—— 贯通核心

签名升级：`buildWorldRulesContext(projectId, worldGroupId?: number | null)`。

**「默认世界」解析（堵洞关键，见 §三-A）**：
```
读 (projectId, worldGroupId) 的 profile：
  - worldGroupId 指定 → 该世界 profile
  - worldGroupId 为空：
      · 有 null-profile（单世界）→ 用之
      · 无 null-profile（多世界，主世界已被盖章为 primaryId）→ 退回「主世界(primary)」profile
```

**9 个调用点的 worldGroupId 来源（逐一定死，杜绝漏注入）**：

| 调用点 | 传入的 worldGroupId |
|--------|---------------------|
| OutlinePanel 卷大纲(139) | null（卷级 = 全书结构，跨世界，取默认/主世界） |
| OutlinePanel 章大纲(164) | `selectedVol.worldGroupId`（本卷所属世界） |
| OutlinePanel 批量(184) | 逐卷 `vol.worldGroupId`（配合已有 `worldContextResolver`） |
| SceneVerifyPanel(76) | 该面板已解析的 `activeGroupId` |
| WorldviewOriginPanel(207,287) | 面板当前 `activeGroupId` |
| WorldviewNaturalPanel(186) | 面板当前 `activeGroupId` |
| WorldviewHumanityPanel(192) | 面板当前 `activeGroupId` |
| character-driven-plot(101) | null（项目级 → 默认/主世界） |

> 单世界下以上一律解析为 null-profile，行为不变。

### 2.4 迁移盖章（`migrateToMultiWorld`）

- 现有 `stamp` 把 null 数据归属主世界，**当前漏了 worldRulesProfiles** → **补上**：
  `await stamp(db.worldRulesProfiles, await db.worldRulesProfiles.where('projectId').equals(projectId).toArray())`。
- 效果：开启多世界时，现有单世界的真实/幻想规则自动成为**主世界**的规则（不丢、不空）。

### 2.5 级联删除（`deleteGroup`）

- 删世界组时，`deleteGroup` 当前删了 worldview/powerSystem/…，**漏了 worldRulesProfiles** → **补上**：删除该 `worldGroupId` 的 profile。避免孤儿 profile。

### 2.6 导出/导入

- `worldRulesProfiles` 已纳入导出（数据丢失修复批次）。新增 `worldGroupId` 后：
  - 导入端 section 27「worldGroupId 重映射」**补一段** worldRulesProfiles 的 remap（与 worldviews 等一致）。
  - ⚠️ 受 ROADMAP `BUG-EXPORT-WG`（worldGroupId 重映射键值错位）影响：本功能的 worldGroupId 正确性**依赖该 bug 修复**。实现时与之合并处理。

---

## 三、漏洞清单（逐条堵死）

| # | 隐患 | 对策 |
|---|------|------|
| A | 多世界下主世界 profile 被盖章为 primaryId，项目级调用 `worldGroupId=null` 找不到 → 规则为空 | `buildWorldRulesContext` 的「默认世界解析」：null 无果时退回 primary 世界 profile（§2.3） |
| B | **跨世界规则污染**：某架空世界没填规则，若退回主世界规则 → 把主世界的史实约束错误套到架空世界 | **每世界独立，指定了 worldGroupId 就绝不回退**；只有"未指定世界"才解析默认世界。架空世界规则为空 = 无史实约束（正确） |
| C | 重复 profile（内存为空就 add） | getOrCreate 先查 DB 再决定（§2.1） |
| D | 漏某个 AI 调用点 → 该面用错世界规则 | 9 个调用点逐一定死来源（§2.3 表）；新增调用点必须在本表登记 |
| E | 开启多世界后主世界规则丢失/变空 | 迁移 `stamp` 补 worldRulesProfiles（§2.4） |
| F | 删世界后留孤儿 profile | `deleteGroup` 级联删除（§2.5） |
| G | 导出/导入后世界归属错乱 | section 27 remap 补 worldRulesProfiles + 依赖 BUG-EXPORT-WG 修复（§2.6） |
| H | 单世界行为被改变 | worldGroupId=null 路径与现状完全一致；多世界相关分支仅在 `enableMultiWorld` 下生效 |
| I | 切换世界标签时把 A 世界的编辑写进 B 世界 | 切标签先 `_persist` 当前 profile 再 load 目标（仿 HistoryPanel 的世界标签提交时序） |

---

## 四、实现清单（待开发）

1. 类型 `WorldRulesProfile` 加 `worldGroupId`；DB v27 改索引 `'++id, projectId, worldGroupId'`。
2. `stores/world-rules.ts`：`loadProfile(projectId, worldGroupId)` + 幂等 getOrCreate + `activeWorldGroupId` + 切换前 persist。
3. `WorldRulesPanel.tsx`：多世界世界标签（仿 HistoryPanel）。
4. `buildWorldRulesContext(projectId, worldGroupId?)` + 默认世界解析；更新全部 9 个调用点（按 §2.3 表传值）。
5. `migrateToMultiWorld`：stamp 补 worldRulesProfiles。
6. `deleteGroup`：级联删 worldRulesProfiles。
7. 导出 section 27 remap 补 worldRulesProfiles（合并 BUG-EXPORT-WG 一起修）。
8. 验证：`tsc` + `build` + 单世界回归（行为不变）+ 多世界往返（建多世界、各世界填不同规则、AI 生成读对世界、导出导入保持）。
