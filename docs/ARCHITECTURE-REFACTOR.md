> ⚠️ **此文档（v1）已废弃** ⚠️
>
> 综合 GPT 5.5 独立代码审查结论后，本方案被认定为**不够完整**，已被以下文档取代：
>
> 👉 **`docs/MASTER-BLUEPRINT.md`（v2 · 最终施工蓝图）**
>
> v1 的主要缺陷：refs 不支持 JSON/数组/间接归属；FIELD_REGISTRY 集合写回写"略"；CONTEXT_SOURCES 部分 scope='world' 实际为 global；缺事务作用域派生；缺测试与 CI 策略；缺 AI 说明书自动生成机制。
>
> **本文档保留作历史参考**，但**不可作为施工依据**。所有重构工作请以 v2 为准。

---

# 架构改造方案：三根支柱（项目地基重构）· v1 历史版

> 一份能落地的工程方案。目标：把本轮审计反复发现的"屎山症状"从根上消灭，让今后加功能/加表/加字段不会再触发同类大漏洞。
> 状态：设计稿（待实施）｜创建：2026-06-04
> 配套文档：`DATA-FLOW-MAP.md` 文字总表 · `DATA-FLOW-DIAGRAM.md` 可视化图 · 各 Phase 设计文档

---

## 〇、为什么必须重构（一句话）

> **本轮审计发现的所有同类大漏洞，根因只有一个：没有"单一事实源"。**

具体表现：
- 加新表 → 5 个生命周期操作（导出/导入/deleteProject/deleteGroup/migrate）各自手写表清单 → 漏一处 = 数据丢失/孤儿/泄漏（本轮抓到 4 次）。
- 加新上下文源 → 32+ 生成入口各自手挑组合 → 漏一处 = AI 读不到（本轮抓到 10+ 处）。
- AI 反推/采纳 → 9+ 组件各自手写字段映射 → AI 字段错位 = 静默丢数据（本轮抓到灵感反推等多处）。

**只要不收口，加任何新功能都会冒同类新 bug。** 这是结构问题，不是手抖问题，靠 grep 防御网兜不住。

## 一、总体哲学：三根支柱 = 三个"单一事实源"

```
┌─────────────────────────────────────────────────────────────┐
│  支柱 1: PROJECT_TABLES 注册表（生命周期单一事实源）          │
│    → 加新表只改一处 · 生命周期操作全部派生                    │
│                                                              │
│  支柱 2: R-1 统一上下文装配层（读侧单一事实源）               │
│    → 加新上下文源只改一处 · 32+ 生成入口走单一入口            │
│                                                              │
│  支柱 3: R-2 统一采纳写回层 + 规范字段 schema（写侧单一事实源）│
│    → 加新可写字段只改一处 · 所有 AI 写回经此入口，自动校验    │
└─────────────────────────────────────────────────────────────┘
```

三根支柱**独立、可分期、可单独验证**；互不阻塞、互相增强。

---

## 二、支柱 1：PROJECT_TABLES 注册表（生命周期）

### 2.1 目标

把"每张表的元信息（项目级/世界级/外键/可导出/重映射）"声明在**唯一一处**，导出/导入/删除/迁移**全部从它派生**，再也不需要在 5 个地方手写表清单。

### 2.2 数据结构

```ts
// src/lib/db/project-tables.ts（新建）

import type { Table } from 'dexie'
import { db } from './schema'

/** 每张表的元信息 */
export interface ProjectTableSpec<T = unknown> {
  /** Dexie 表对象（直接可操作） */
  table: Table<T, number>
  /** 表名（日志/错误信息） */
  name: string
  /** 隔离层级 */
  scope:
    | 'project'      // 项目级：按 projectId 隔离（绝大多数）
    | 'global'       // 全局：不绑项目（promptTemplates / promptWorkflows / masterInsights）
    | 'transient'    // 临时：本地操作态，不导入导出（importJobs/Sessions/Logs/Files）
  /** 多世界隔离 */
  worldScoped?: boolean       // 带 worldGroupId
  homeWorldScoped?: boolean   // 带 homeWorldGroupId（仅 characters）
  /** 树形（parentId） */
  tree?: { parentField: string }
  /** 外键引用（删除时级联用） */
  refs?: ForeignRef[]
  /** 是否纳入 JSON 备份 */
  exportable: boolean
  /** 导出时需要的 ID 重映射（外键/categoryId 等） */
  exportRemap?: ExportRemapField[]
  /** 备注（说明为什么这样配） */
  note?: string
}

export interface ForeignRef {
  /** 本表的字段（指向 target） */
  field: string
  /** 指向哪张表（名字） */
  target: string
  /** 删除目标时本表如何处理 */
  onDelete: 'cascade' | 'setNull' | 'keep'
}

export interface ExportRemapField {
  /** 字段名 */
  field: string
  /** 重映射到哪张表的 _exportId */
  remapVia: string
  /** 是否树形自引用（parentId） */
  selfTree?: boolean
}

/** ────────────────────────────────────────────────
 *  唯一事实源：全部表注册（按 DB 版本顺序列出）
 *  ────────────────────────────────────────────────
 *  以后加新表 = 在这里加一行 + 在 schema 加版本 + 在 types 加类型。
 *  导出/导入/删除/迁移自动获得新表的正确处理。 */
export const PROJECT_TABLES: ProjectTableSpec[] = [
  // ── 核心项目数据 ──
  { table: db.projects, name: 'projects', scope: 'project', exportable: true },

  { table: db.worldviews, name: 'worldviews', scope: 'project',
    worldScoped: true, exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }] },

  { table: db.storyCores, name: 'storyCores', scope: 'project', exportable: true },

  { table: db.powerSystems, name: 'powerSystems', scope: 'project',
    worldScoped: true, exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }] },

  { table: db.characters, name: 'characters', scope: 'project',
    homeWorldScoped: true, exportable: true,
    refs: [/* by characterRelations.from/toCharacterId */],
    exportRemap: [{ field: 'homeWorldGroupId', remapVia: 'worldGroups' }] },

  { table: db.factions, name: 'factions', scope: 'project', exportable: true },

  { table: db.outlineNodes, name: 'outlineNodes', scope: 'project',
    worldScoped: true, exportable: true,
    tree: { parentField: 'parentId' },
    refs: [
      { field: 'id', target: 'chapters[outlineNodeId]', onDelete: 'cascade' },
      { field: 'id', target: 'detailedOutlines[outlineNodeId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'parentId', remapVia: 'outlineNodes', selfTree: true },
      { field: 'worldGroupId', remapVia: 'worldGroups' },
    ] },

  { table: db.chapters, name: 'chapters', scope: 'project', exportable: true,
    refs: [{ field: 'id', target: 'emotionBeatCards[chapterId]', onDelete: 'cascade' }],
    exportRemap: [{ field: 'outlineNodeId', remapVia: 'outlineNodes' }] },

  { table: db.foreshadows, name: 'foreshadows', scope: 'project', exportable: true,
    // chapterId 软引用（设计如此，删章节不强删）
  },

  { table: db.geographies, name: 'geographies', scope: 'project',
    worldScoped: true, exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }] },

  { table: db.histories, name: 'histories', scope: 'project',
    worldScoped: true, exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }] },

  { table: db.itemSystems, name: 'itemSystems', scope: 'project', exportable: true,
    note: 'Phase 35-b 将并入 codex.artifact，届时此条移除' },

  { table: db.creativeRules, name: 'creativeRules', scope: 'project', exportable: true },

  { table: db.characterRelations, name: 'characterRelations', scope: 'project', exportable: true,
    refs: [
      // 当 characters 中某 id 被删 → 这里 fromCharacterId/toCharacterId 等于该 id 的记录级联删
    ],
    exportRemap: [
      { field: 'fromCharacterId', remapVia: 'characters' },
      { field: 'toCharacterId', remapVia: 'characters' },
    ] },

  { table: db.snapshots, name: 'snapshots', scope: 'project', exportable: false,
    note: '本地版本历史 · 不导出（避免循环嵌套）' },

  { table: db.references, name: 'references', scope: 'project', exportable: true,
    refs: [{ field: 'id', target: 'referenceChunkAnalysis[referenceId]', onDelete: 'cascade' }] },

  { table: db.referenceChunkAnalysis, name: 'referenceChunkAnalysis', scope: 'project', exportable: true,
    exportRemap: [{ field: 'referenceId', remapVia: 'references' }] },

  // ── 全局 / 不绑项目 ──
  { table: db.promptTemplates, name: 'promptTemplates', scope: 'global', exportable: false,
    note: '全局 scope=system|user · 不绑项目 · 不导出' },
  { table: db.promptWorkflows, name: 'promptWorkflows', scope: 'global', exportable: false },
  { table: db.masterInsights, name: 'masterInsights', scope: 'global', exportable: true,
    note: '按 genre 全局共享 · 导出时全量' },

  // ── 大纲/章节衍生 ──
  { table: db.detailedOutlines, name: 'detailedOutlines', scope: 'project', exportable: true,
    exportRemap: [{ field: 'outlineNodeId', remapVia: 'outlineNodes' }] },

  // ── 临时态：导入会话 ──
  { table: db.importJobs, name: 'importJobs', scope: 'transient', exportable: false },
  { table: db.importSessions, name: 'importSessions', scope: 'transient', exportable: false },
  { table: db.importLogs, name: 'importLogs', scope: 'transient', exportable: false },
  { table: db.importFiles, name: 'importFiles', scope: 'transient', exportable: false,
    note: 'blob 数据 · 临时态' },

  // ── 大师作品学习 ──
  { table: db.masterWorks, name: 'masterWorks', scope: 'project', exportable: true,
    refs: [
      { field: 'id', target: 'masterChunkAnalysis[workId]', onDelete: 'cascade' },
      { field: 'id', target: 'masterChapterBeats[workId]', onDelete: 'cascade' },
      { field: 'id', target: 'masterStyleMetrics[workId]', onDelete: 'cascade' },
    ] },
  { table: db.masterChunkAnalysis, name: 'masterChunkAnalysis', scope: 'project', exportable: true,
    exportRemap: [{ field: 'workId', remapVia: 'masterWorks' }] },
  { table: db.masterChapterBeats, name: 'masterChapterBeats', scope: 'project', exportable: true,
    exportRemap: [{ field: 'workId', remapVia: 'masterWorks' }] },
  { table: db.masterStyleMetrics, name: 'masterStyleMetrics', scope: 'project', exportable: true,
    exportRemap: [{ field: 'workId', remapVia: 'masterWorks' }] },

  // ── 状态卡 / 节拍 / 故事线 / 笔记 / 世界树 / 历史年表 ──
  { table: db.stateCards, name: 'stateCards', scope: 'project', exportable: true },
  { table: db.emotionBeatCards, name: 'emotionBeatCards', scope: 'project', exportable: true },
  { table: db.storyArcs, name: 'storyArcs', scope: 'project', exportable: true },
  { table: db.notes, name: 'notes', scope: 'project', exportable: true },

  { table: db.worldNodes, name: 'worldNodes', scope: 'project',
    worldScoped: true, exportable: true,
    tree: { parentField: 'parentId' },
    exportRemap: [
      { field: 'parentId', remapVia: 'worldNodes', selfTree: true },
      { field: 'worldGroupId', remapVia: 'worldGroups' },
    ] },

  { table: db.historicalTimelineEvents, name: 'historicalTimelineEvents', scope: 'project',
    worldScoped: true, exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }] },
  { table: db.historicalKeywords, name: 'historicalKeywords', scope: 'project',
    worldScoped: true, exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }] },

  // ── 重要地点 / 真实与幻想 ──
  { table: db.importantLocations, name: 'importantLocations', scope: 'project', exportable: true,
    tree: { parentField: 'parentId' },
    exportRemap: [{ field: 'parentId', remapVia: 'importantLocations', selfTree: true }] },

  { table: db.worldRulesProfiles, name: 'worldRulesProfiles', scope: 'project', exportable: true,
    note: 'Phase 40 后变 worldScoped:true · 届时加 worldGroupId remap' },

  // ── 多世界 ──
  { table: db.worldGroups, name: 'worldGroups', scope: 'project', exportable: true,
    note: 'BUG-EXPORT-WG 修复后：与其它表共用一套 worldGroupId remap 协议' },
  { table: db.worldGroupLinks, name: 'worldGroupLinks', scope: 'project', exportable: true,
    exportRemap: [
      { field: 'fromGroupId', remapVia: 'worldGroups' },
      { field: 'toGroupId', remapVia: 'worldGroups' },
    ] },

  // ── 物品流水 / 故事年表 ──
  { table: db.itemLedger, name: 'itemLedger', scope: 'project', exportable: true,
    exportRemap: [{ field: 'chapterId', remapVia: 'chapters' }] },
  { table: db.storyTimelineEvents, name: 'storyTimelineEvents', scope: 'project', exportable: true,
    exportRemap: [{ field: 'chapterId', remapVia: 'chapters' }] },

  // ── 词条系统 ──
  { table: db.codexCategories, name: 'codexCategories', scope: 'project',
    worldScoped: true, exportable: true,
    tree: { parentField: 'parentId' },
    refs: [{ field: 'id', target: 'codexEntries[categoryId]', onDelete: 'cascade' }],
    exportRemap: [
      { field: 'parentId', remapVia: 'codexCategories', selfTree: true },
      { field: 'worldGroupId', remapVia: 'worldGroups' },
    ] },
  { table: db.codexEntries, name: 'codexEntries', scope: 'project',
    worldScoped: true, exportable: true,
    exportRemap: [
      { field: 'categoryId', remapVia: 'codexCategories' },
      { field: 'worldGroupId', remapVia: 'worldGroups' },
    ] },

  // ── 消耗统计 ──
  { table: db.aiUsageLog, name: 'aiUsageLog', scope: 'project', exportable: false,
    note: '统计数据 · 体积大 · 不导出' },
]
```

### 2.3 派生 API（基于注册表生成）

```ts
// src/lib/db/lifecycle.ts（新建）

/** 取所有项目级表 */
export const projectScopedTables = () =>
  PROJECT_TABLES.filter(s => s.scope === 'project')

/** 取所有世界隔离表 */
export const worldScopedTables = () =>
  PROJECT_TABLES.filter(s => s.worldScoped)

/** 取所有可导出表（按依赖顺序：被依赖的先） */
export const exportableTables = () =>
  topoSort(PROJECT_TABLES.filter(s => s.exportable))

/** ──── 5 个生命周期操作改造为一行 ──── */

/** 删项目：级联清理所有项目级 + 临时态 + 子表 */
export async function cascadeDeleteProject(projectId: number): Promise<void> {
  await db.transaction('rw', PROJECT_TABLES.map(s => s.table), async () => {
    // 先删子表（按 refs 拓扑序）
    for (const spec of topoSortChildrenFirst(PROJECT_TABLES)) {
      if (spec.scope === 'project' || spec.scope === 'transient') {
        await spec.table.where('projectId').equals(projectId).delete()
      }
    }
  })
}

/** 删世界组：级联本世界所有 worldScoped 数据 + 清角色 home / 大纲 wgId */
export async function cascadeDeleteWorldGroup(projectId: number, wgId: number): Promise<void> {
  await db.transaction('rw', PROJECT_TABLES.map(s => s.table), async () => {
    for (const spec of worldScopedTables()) {
      // codexCategories：只删 worldGroupId=wgId 的（null 全局保留）
      const all = await spec.table.where('projectId').equals(projectId).toArray()
      for (const r of all) {
        if ((r as any).worldGroupId === wgId) await spec.table.delete((r as any).id)
      }
    }
    // 清角色 homeWorldGroupId
    const chars = await db.characters.where('projectId').equals(projectId).toArray()
    for (const c of chars) {
      if (c.homeWorldGroupId === wgId) await db.characters.update(c.id!, { homeWorldGroupId: null })
    }
    // 清大纲 worldGroupId
    const nodes = await db.outlineNodes.where('projectId').equals(projectId).toArray()
    for (const n of nodes) {
      if (n.worldGroupId === wgId) await db.outlineNodes.update(n.id!, { worldGroupId: null })
    }
    // 删世界组链接
    await db.worldGroupLinks.where('fromGroupId').equals(wgId).delete()
    await db.worldGroupLinks.where('toGroupId').equals(wgId).delete()
    await db.worldGroups.delete(wgId)
  })
}

/** 开启多世界：把所有 worldScoped 表的 null 数据盖章到主世界 */
export async function stampPrimaryWorld(projectId: number, primaryId: number): Promise<void> {
  await db.transaction('rw', PROJECT_TABLES.map(s => s.table), async () => {
    for (const spec of worldScopedTables()) {
      // 内置 codexCategories（builtInKey 非空）保持 null=全局，不盖章
      const all = await spec.table.where('projectId').equals(projectId).toArray()
      for (const r of all) {
        const row = r as any
        if (row.worldGroupId == null) {
          // codexCategories 的内置分类例外：保持全局
          if (spec.name === 'codexCategories' && row.builtInKey) continue
          await spec.table.update(row.id, { worldGroupId: primaryId })
        }
      }
    }
  })
}

/** 删某条记录时的引用级联（如删角色 → 关系级联） */
export async function cascadeDeleteRecord(
  spec: ProjectTableSpec,
  id: number,
): Promise<void> {
  if (!spec.refs?.length) return
  for (const ref of spec.refs) {
    // 解析 target 如 'characterRelations[fromCharacterId]'
    const m = ref.target.match(/^(\w+)\[(\w+)\]$/)
    if (!m) continue
    const [, targetName, targetField] = m
    const targetSpec = PROJECT_TABLES.find(s => s.name === targetName)
    if (!targetSpec) continue
    if (ref.onDelete === 'cascade') {
      const keys = await (targetSpec.table as any).where(targetField).equals(id).primaryKeys()
      if (keys.length) await targetSpec.table.bulkDelete(keys)
    } else if (ref.onDelete === 'setNull') {
      const rows = await (targetSpec.table as any).where(targetField).equals(id).toArray()
      for (const r of rows) await targetSpec.table.update(r.id, { [targetField]: null })
    }
  }
}

/** 导出：基于 exportable 派生 */
export async function exportProjectByRegistry(projectId: number): Promise<ProjectExportData> { ... }
export async function importProjectByRegistry(data: ProjectExportData): Promise<number> { ... }
```

### 2.4 调用方迁移（前后对比）

```ts
// stores/project.ts deleteProject（before：手列 35 张表，~70 行）
await db.transaction('rw', [/* 列 35 张表 */], async () => {
  // 子表先删（依赖外键）
  if (refIds.length) await db.referenceChunkAnalysis...
  // 主表删除
  await db.projects.delete(id)
  await db.worldviews.where('projectId').equals(id).delete()
  // ... 30 多行
})

// after：1 行
await cascadeDeleteProject(id)
```

```ts
// stores/world-group.ts deleteGroup（before：手列 10+ 表）
const allWv = await db.worldviews.where('projectId')...
for (const wv of allWv) if (wv.worldGroupId === id) await db.worldviews.delete(...)
// ... 重复 10 次

// after：1 行
await cascadeDeleteWorldGroup(pid, id)
```

```ts
// migrateToMultiWorld（before：手写 stamp 8 次）
await stamp(db.worldviews, ...)
await stamp(db.powerSystems, ...)
// ... 8 行

// after：1 行
await stampPrimaryWorld(projectId, primaryId)
```

### 2.5 这次为什么不会再出 bug（漏洞清单）

| 过去的 bug | 注册表如何根治 |
|------|------|
| 导出漏 importantLocations / worldRulesProfiles / codex / aiUsageLog | 加表时 `exportable: true` 一处声明 = 自动入导出/导入 |
| deleteProject 漏 5 张表 | 派生自 `projectScopedTables()` = 不可能漏 |
| deleteGroup 漏 HTE/HK/codex | 派生自 `worldScopedTables()` = 不可能漏 |
| migrateToMultiWorld 漏盖章 codex | 同上 |
| deleteCharacter 漏关系、deleteNode 漏正文/细纲 | `refs` 声明 + `cascadeDeleteRecord` 自动级联 |
| BUG-EXPORT-WG 重映射键值错位 | `exportRemap` 协议统一 = 导出端与导入端用同一份映射规则 |

**关键不变量**：今后加新表 = `PROJECT_TABLES` 加一行，**没有任何"手列表"步骤**。

---

## 三、支柱 2：R-1 统一上下文装配层（读侧）

### 3.1 目标

把 9 个 `build*Context` 收成 1 个 `assembleContext`；让 32+ 个生成入口**只声明"我要哪些源"**而不再手挑组合；加新源 = 注册表加一行。

### 3.2 数据结构

```ts
// src/lib/ai/context-registry.ts（新建）

/** 上下文源声明 */
export interface ContextSource<T = unknown> {
  /** 唯一 id（声明用） */
  id: string
  /** 显示名（预算条 / 调试） */
  label: string
  /** 优先级层级（裁剪时 L3 先丢） */
  layer: 'L0' | 'L1' | 'L2' | 'L3'
  /** 隔离作用域 */
  scope: 'world' | 'global' | 'node'
  /** token 预算上限（字符，估算） */
  budget: number
  /** 取数 + 格式化（同一函数，便于复用） */
  build: (input: AssembleInput) => Promise<string> | string
  /** 仅当某条件成立时启用（如 enableMultiWorld） */
  enabledWhen?: (input: AssembleInput, project: Project) => boolean
}

export interface AssembleInput {
  projectId: number
  /** 指定世界（多世界生效） */
  worldGroupId?: number | null
  /** 指定大纲节点（用于按节点解析世界、按章节过滤角色） */
  nodeId?: number
  /** 当前章节 ID（活跃角色/按需召回状态卡） */
  chapterId?: number
  /** 声明需要哪些源 */
  need: string[]
  /** 任务类型（影响预算分配） */
  taskType?: 'write' | 'plan' | 'review'
  /** 召回用文本（按需召回状态卡） */
  referenceText?: string
  /** 覆盖每源预算（可选） */
  budgetOverride?: Record<string, number>
}

export interface AssembledSection {
  id: string
  label: string
  text: string
  tokens: number    // estimateTokens(text)
  layer: 'L0' | 'L1' | 'L2' | 'L3'
  trimmed?: boolean
}

export interface AssembleResult {
  /** 拼装好的完整上下文（直接喂 prompt） */
  fullContext: string
  /** 按源分组明细（预算条 / 调试 / 未来 R-2 的 dimension 注入） */
  sections: AssembledSection[]
  totalTokens: number
  /** 哪些层因超预算被裁掉 */
  trimmedLayers: string[]
  /** 实际生效的 worldGroupId（按节点解析后的） */
  resolvedWorldGroupId: number | null
}
```

### 3.3 源注册表

```ts
export const CONTEXT_SOURCES: ContextSource[] = [
  // ── L0 必留 ──
  { id: 'creativeRules', label: '创作规则', layer: 'L0', scope: 'global', budget: 600,
    build: async ({ projectId }) => {
      const rules = await db.creativeRules.where('projectId').equals(projectId).first()
      return buildCreativeRulesContext(rules ?? null)
    } },

  // ── L1 核心 ──
  { id: 'worldview', label: '世界观', layer: 'L1', scope: 'world', budget: 2500,
    build: async (input) => {
      const wv = await resolveWorldview(input)
      return formatWorldviewBlock(wv)
    } },
  { id: 'storyCore', label: '故事核心', layer: 'L1', scope: 'global', budget: 500,
    build: async ({ projectId }) => {
      const sc = await db.storyCores.where('projectId').equals(projectId).first()
      return formatStoryCoreBlock(sc ?? null)
    } },
  { id: 'powerSystem', label: '力量体系', layer: 'L1', scope: 'world', budget: 500,
    build: async (input) => formatPowerSystemBlock(await resolvePowerSystem(input)) },
  { id: 'characters', label: '角色档案', layer: 'L1', scope: 'global', budget: 1500,
    build: async (input) => {
      let chars = await db.characters.where('projectId').equals(input.projectId).toArray()
      // 多世界过滤
      if (input.worldGroupId != null) {
        chars = chars.filter(c => c.isCrossWorld || c.homeWorldGroupId === input.worldGroupId)
      }
      // 按章节过滤活跃角色
      if (input.chapterId) chars = filterActiveCharacters(chars, input.chapterId)
      return buildCharacterContext(chars)
    } },
  { id: 'state', label: '状态表（按需召回）', layer: 'L1', scope: 'global', budget: 1000,
    build: async ({ projectId, referenceText }) => {
      const store = useStateCardStore.getState()
      if (!store.loadedProjectId || store.loadedProjectId !== projectId)
        await store.loadAll(projectId)
      return referenceText
        ? store.buildSelectiveStateContext(referenceText).text
        : store.buildStateContext()
    } },
  { id: 'worldRules', label: '真实与幻想', layer: 'L1', scope: 'world', budget: 800,
    build: async (input) => buildWorldRulesContext(input.projectId, input.worldGroupId) },
  { id: 'style', label: '写作风格预设', layer: 'L1', scope: 'global', budget: 300,
    build: async ({ projectId }) => {
      const project = await db.projects.get(projectId)
      return project?.writingStyleId ? buildStylePromptInjection(project.writingStyleId) : ''
    } },
  { id: 'memo', label: '上下文快照', layer: 'L1', scope: 'global', budget: 600,
    build: ({ projectId }) => getContextMemo(projectId) },

  // ── L2 增强 ──
  { id: 'codex', label: '设定词条', layer: 'L2', scope: 'world', budget: 1500,
    build: async (input) => buildCodexContext(input.projectId, input.worldGroupId) },
  { id: 'foreshadows', label: '开放伏笔', layer: 'L2', scope: 'global', budget: 800,
    build: async ({ projectId, chapterId }) => {
      const store = useForeshadowStore.getState()
      if (chapterId) return store.buildForeshadowContext(chapterId)
      return ''
    } },
  { id: 'storyArc', label: '故事线', layer: 'L2', scope: 'global', budget: 600,
    build: async ({ projectId }) => { /* 取主线+支线阶段 */ return '' } },
  { id: 'genre', label: '题材包', layer: 'L2', scope: 'global', budget: 400,
    build: async ({ projectId }) => {
      const project = await db.projects.get(projectId)
      return project?.genre ? buildGenreConstraintContext(project.genre) : ''
    } },
  { id: 'history', label: '历史年表', layer: 'L2', scope: 'world', budget: 1000,
    build: async ({ projectId }) => buildHistoricalContext(projectId) },

  // ── L3 可选 ──
  { id: 'locations', label: '重要地点', layer: 'L3', scope: 'global', budget: 800,
    build: async ({ projectId }) => buildLocationContext(projectId) },
  { id: 'refAnalysis', label: '参考分析引用', layer: 'L3', scope: 'global', budget: 1200,
    build: async ({ projectId }) => {
      const rules = await db.creativeRules.where('projectId').equals(projectId).first()
      const ids = JSON.parse(rules?.citedReferenceIds || '[]')
      return ids.length ? await buildRefAnalysisContext(ids) : ''
    } },
  { id: 'masterInsight', label: '大师洞察', layer: 'L3', scope: 'global', budget: 1000,
    build: async ({ projectId }) => {
      const rules = await db.creativeRules.where('projectId').equals(projectId).first()
      const ids = JSON.parse(rules?.citedInsightIds || '[]')
      return ids.length ? await buildMasterInsightContext(ids) : ''
    } },
]
```

### 3.4 主入口

```ts
// src/lib/ai/assemble-context.ts（新建）

export async function assembleContext(input: AssembleInput): Promise<AssembleResult> {
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在')

  // 1. 多世界：按节点解析 worldGroupId（如果传了 nodeId 且未指定 wgId）
  let resolvedWg = input.worldGroupId ?? null
  if (project.enableMultiWorld && resolvedWg == null && input.nodeId != null) {
    resolvedWg = await resolveNodeWorldGroupId(input.projectId, input.nodeId)
  }
  const resolvedInput: AssembleInput = { ...input, worldGroupId: resolvedWg }

  // 2. 并行 build 所有声明的源
  const need = new Set(input.need)
  const tasks = CONTEXT_SOURCES
    .filter(s => need.has(s.id))
    .filter(s => !s.enabledWhen || s.enabledWhen(resolvedInput, project))
    .map(async (s) => {
      try {
        const text = await s.build(resolvedInput)
        if (!text) return null
        // 按预算截断
        const budget = input.budgetOverride?.[s.id] ?? s.budget
        const clipped = text.length > budget ? text.slice(0, budget) + '\n…（截断）' : text
        return { id: s.id, label: s.label, layer: s.layer, text: clipped, tokens: estimateTokens(clipped) } as AssembledSection
      } catch (err) {
        console.warn(`[assembleContext] 源 ${s.id} 失败：`, err)
        return null
      }
    })

  const sections = (await Promise.all(tasks)).filter(Boolean) as AssembledSection[]

  // 3. 按 layer 排序（L0 必留在前；L3 末尾，超总预算时先丢）
  sections.sort((a, b) => a.layer.localeCompare(b.layer))
  const total = sections.reduce((s, x) => s + x.tokens, 0)

  // 4. 真裁剪（如果设了总预算）
  const trimmedLayers: string[] = []
  // ...（按 model 预算从 L3 → L2 → L1 真裁）

  return {
    fullContext: sections.map(s => s.text).join('\n\n'),
    sections,
    totalTokens: total,
    trimmedLayers,
    resolvedWorldGroupId: resolvedWg,
  }
}
```

### 3.5 调用方迁移（前后对比）

```ts
// ChapterEditor（before：~50 行手挑组合）
const memo = getContextMemo(project.id!)
const worldCtx = chapterWorldGroupId != null
  ? [memo, multiWorldCtx].filter(Boolean).join('\n\n')
  : [memo, buildWorldContext(worldview, storyCore, powerSystem), singleCodexCtx].filter(Boolean).join('\n\n')
const charCtx = buildCharacterContext(filterActiveCharacters(worldScopedChars, currentChapter?.id))
const selectiveState = useMemo(() => { ... }, [...])
const foreshadowCtx = currentChapter?.id ? buildForeshadowContext(currentChapter.id) : ''
const memory = await buildMemory({ taskType: 'write', working: {...}, episodic: {...}, semantic: {...} })
const styleCtx = project.writingStyleId ? buildStylePromptInjection(project.writingStyleId) : ''
const rulesCtx = buildCreativeRulesContext(creativeRules)
const locationCtx = await buildLocationContext(project.id!)
// ... 还有 5 个

// After（声明式，1 次调用）
const ctx = await assembleContext({
  projectId: project.id!,
  nodeId: outlineNodeId,
  chapterId: currentChapter?.id,
  need: [
    'creativeRules', 'memo',
    'worldview', 'storyCore', 'powerSystem',
    'characters', 'state', 'foreshadows', 'storyArc',
    'codex', 'worldRules', 'locations', 'history',
    'genre', 'style',
    'refAnalysis', 'masterInsight',
  ],
  taskType: 'write',
  referenceText: outlineNode?.summary,
})
const fullCtx = ctx.fullContext
```

```ts
// CharacterPanel（before：~10 行）
const codexCtx = await buildCodexContext(project.id!, null)
const worldCtx = [buildWorldContext(...), codexCtx].filter(Boolean).join('\n\n')
// 多世界判断分支...

// After（1 次调用）
const ctx = await assembleContext({
  projectId: project.id!,
  worldGroupId: targetWorld,
  need: ['worldview', 'storyCore', 'powerSystem', 'codex'],
})
```

### 3.6 这次为什么不会再出 bug

| 过去的 bug | R-1 如何根治 |
|------|------|
| 创作规则不注入正文 | 加 `'creativeRules'` 到 need 即可；漏了 grep 立刻能发现 |
| 多世界串台（场景/细纲/角色） | 单/多世界路径只在 `assembleContext` 内部判一次；面板只声明 `nodeId` 或 `worldGroupId` |
| 重要地点不注入 | 加 `'locations'` 即可；新源只在注册表加一行 |
| 单/多世界字段漂移 | 源 `build` 函数是单一事实源，两条路径不存在 |
| 故事核心多世界遗漏 | 同上 |
| storyLines 遗留字段 | 源内部用 `mainPlot || storyLines`；任何调用方自动正确 |

**关键不变量**：今后加新上下文源 = `CONTEXT_SOURCES` 加一行；加新调用 = 在 `need` 写 id；**没有"手挑组合"步骤**。

### 3.7 三层记忆系统在 R-1 后的位置

`buildMemory` 仍存在，但变为 `assembleContext` 内部的一个**装配模式**（按 taskType 应用 working/episodic/semantic 预算切分）。调用方只声明 `taskType`，记忆系统自动按层填充。

---

## 四、支柱 3：R-2 统一采纳写回层 + 规范字段 schema（写侧）

### 4.1 目标

所有 "AI 输出 → 写回上游表" 经唯一入口；规范字段表为单一事实源；自动校验类型 + 别名映射 + 未知字段告警；以 DB 为准定位记录（杜绝"内存为空建重复"）。

### 4.2 数据结构

```ts
// src/lib/ai/field-registry.ts（新建）

export interface FieldSpec {
  /** 目标表名（对应 PROJECT_TABLES.name） */
  target: string
  /** 字段名 */
  field: string
  /** 类型 */
  type: 'string' | 'longtext' | 'json' | 'number' | 'boolean' | 'enum'
  /** 枚举值（type=enum） */
  enums?: string[]
  /** 字段是否 worldGroupId-aware（写回需指定世界） */
  worldScoped?: boolean
  /** AI 历史输出可能用的旧名（自动映射） */
  aliases?: string[]
  /** 自定义校验/清洗 */
  sanitize?: (val: unknown) => unknown
  /** 标签（错误提示用） */
  label?: string
}

/** 唯一事实源：所有可被 AI 写回的字段 */
export const FIELD_REGISTRY: FieldSpec[] = [
  // ── worldviews v3 ──
  { target: 'worldviews', field: 'worldOrigin', type: 'longtext', worldScoped: true,
    aliases: ['origin', 'summary', 'worldSummary'], label: '世界来源' },
  { target: 'worldviews', field: 'powerHierarchy', type: 'longtext', worldScoped: true,
    aliases: ['power', 'powerSystem'], label: '力量体系' },
  { target: 'worldviews', field: 'continentLayout', type: 'longtext', worldScoped: true,
    aliases: ['geography', 'continents'], label: '大陆分布' },
  { target: 'worldviews', field: 'climateByRegion', type: 'longtext', worldScoped: true,
    aliases: ['climate'], label: '气候' },
  { target: 'worldviews', field: 'historyLine', type: 'longtext', worldScoped: true,
    aliases: ['history', 'historyTimeline'], label: '世界历史线' },
  { target: 'worldviews', field: 'races', type: 'longtext', worldScoped: true,
    aliases: ['race', 'peoples'] },
  { target: 'worldviews', field: 'factionLayout', type: 'longtext', worldScoped: true,
    aliases: ['factions', 'forces'] },
  { target: 'worldviews', field: 'politicsEconomyCulture', type: 'longtext', worldScoped: true,
    aliases: ['society', 'culture', 'politics'] },
  { target: 'worldviews', field: 'worldEvents', type: 'longtext', worldScoped: true },
  { target: 'worldviews', field: 'internalConflicts', type: 'longtext', worldScoped: true },
  { target: 'worldviews', field: 'itemDesign', type: 'longtext', worldScoped: true,
    aliases: ['items'] },
  // ... 其余 worldview 字段

  // ── storyCores ──
  { target: 'storyCores', field: 'theme', type: 'string', label: '主题' },
  { target: 'storyCores', field: 'centralConflict', type: 'longtext', label: '核心冲突' },
  { target: 'storyCores', field: 'mainPlot', type: 'longtext',
    aliases: ['storyLines', 'mainStory'], label: '主线' },
  { target: 'storyCores', field: 'subPlots', type: 'longtext', aliases: ['subplots'] },
  { target: 'storyCores', field: 'logline', type: 'string', aliases: ['oneLine'] },
  { target: 'storyCores', field: 'concept', type: 'longtext' },
  { target: 'storyCores', field: 'plotPattern', type: 'string' },

  // ── characters ──
  { target: 'characters', field: 'name', type: 'string' },
  { target: 'characters', field: 'role', type: 'enum',
    enums: ['protagonist', 'antagonist', 'supporting', 'minor', 'npc', 'extra'],
    aliases: ['type'] },
  { target: 'characters', field: 'shortDescription', type: 'string', aliases: ['summary', 'desc'] },
  { target: 'characters', field: 'appearance', type: 'longtext' },
  { target: 'characters', field: 'personality', type: 'longtext' },
  { target: 'characters', field: 'background', type: 'longtext' },
  { target: 'characters', field: 'motivation', type: 'longtext' },
  { target: 'characters', field: 'abilities', type: 'longtext' },
  { target: 'characters', field: 'arc', type: 'longtext' },

  // ── creativeRules ──
  { target: 'creativeRules', field: 'writingStyle', type: 'longtext' },
  { target: 'creativeRules', field: 'narrativePOV', type: 'enum',
    enums: ['first', 'third-limited', 'third-omniscient', 'second'] },
  { target: 'creativeRules', field: 'atmosphere', type: 'longtext',
    aliases: ['toneAndMood', 'tone'] },
  { target: 'creativeRules', field: 'prohibitions', type: 'json' },
  { target: 'creativeRules', field: 'consistencyRules', type: 'json' },
  { target: 'creativeRules', field: 'specialRequirements', type: 'longtext' },

  // ... 其它表
]
```

### 4.3 主入口

```ts
// src/lib/ai/adopt.ts（新建）

export interface AdoptInput {
  projectId: number
  worldGroupId?: number | null
  /** 目标表名 */
  target: string
  /** AI 输出对象 */
  data: Record<string, unknown>
  /** 模式 */
  mode?: 'replace' | 'append'
  /** 仅采纳哪些字段（undefined = 全部声明字段） */
  onlyFields?: string[]
}

export interface AdoptResult {
  /** 已写入的规范字段名 */
  written: string[]
  /** 别名映射记录（原名 → 规范名） */
  aliasMapped: { from: string; to: string }[]
  /** 未知字段（写入失败，告警） */
  unknown: string[]
  /** 类型错误 */
  typeErrors: { field: string; expected: string; got: string }[]
}

export async function adopt(input: AdoptInput): Promise<AdoptResult> {
  const result: AdoptResult = { written: [], aliasMapped: [], unknown: [], typeErrors: [] }

  // 1. 查目标表所有可写字段
  const specs = FIELD_REGISTRY.filter(s => s.target === input.target)
  const byName = new Map(specs.map(s => [s.field, s] as const))
  const byAlias = new Map<string, FieldSpec>()
  for (const s of specs) for (const a of s.aliases ?? []) byAlias.set(a, s)

  // 2. 解析 AI 输入：规范名 + 别名映射 + 未知字段
  const patch: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(input.data)) {
    if (val == null || val === '') continue
    if (input.onlyFields && !input.onlyFields.includes(key)) continue

    let spec = byName.get(key)
    let canonical = key
    if (!spec) {
      // 别名映射
      const aliasHit = byAlias.get(key)
      if (aliasHit) {
        spec = aliasHit
        canonical = aliasHit.field
        result.aliasMapped.push({ from: key, to: canonical })
      } else {
        result.unknown.push(key)
        console.warn(`[adopt] 未知字段：${input.target}.${key}（将丢弃）`)
        continue
      }
    }

    // 3. 类型校验 + 清洗
    const cleaned = validateAndCoerce(spec, val, result)
    if (cleaned === undefined) continue

    // 4. 模式
    if (input.mode === 'append' && spec.type === 'longtext') {
      const existing = await getCurrentFieldValue(input, spec)
      patch[canonical] = existing ? `${existing}\n\n${cleaned}` : cleaned
    } else {
      patch[canonical] = cleaned
    }
    result.written.push(canonical)
  }

  // 5. 写库：以 DB 为准定位记录（防重复 bug）
  await writeWithDbAuthority(input, patch)

  return result
}

/** 写库（以 DB 为准定位 + 多世界感知） */
async function writeWithDbAuthority(input: AdoptInput, patch: Record<string, unknown>) {
  const tableSpec = PROJECT_TABLES.find(s => s.name === input.target)!
  const isSingleton = ['worldviews', 'storyCores', 'powerSystems', 'creativeRules',
                       'geographies', 'histories', 'itemSystems', 'worldRulesProfiles']
                      .includes(input.target)

  if (isSingleton) {
    // 单例表：按 (projectId, worldGroupId) 定位
    const all = await tableSpec.table.where('projectId').equals(input.projectId).toArray()
    const target = tableSpec.worldScoped
      ? all.find((r: any) => (r.worldGroupId ?? null) === (input.worldGroupId ?? null))
      : all[0]
    if (target) {
      await tableSpec.table.update((target as any).id, { ...patch, updatedAt: Date.now() })
    } else {
      await tableSpec.table.add({
        projectId: input.projectId,
        ...(tableSpec.worldScoped ? { worldGroupId: input.worldGroupId ?? null } : {}),
        ...patch,
        createdAt: Date.now(), updatedAt: Date.now(),
      } as any)
    }
  } else {
    // 集合表：调用方需提供 id 或走 add（AdoptInput 扩展）
    // 略
  }
}
```

### 4.4 调用方迁移

```ts
// 灵感反推（before：手写映射 + 漏字段 bug 反复）
await wvStore.saveWorldview({
  projectId: project.id!,
  worldOrigin: wv.worldOrigin || undefined,
  powerHierarchy: wv.powerHierarchy || undefined,
  // ... 7 行
})
// AI 吐了 summary/geography → 静默丢

// After（声明式）
const result = await adopt({
  projectId: project.id!,
  worldGroupId: null,
  target: 'worldviews',
  data: aiOutput.worldview,
  mode: 'replace',
})
console.log(`[Inspiration] 写入 ${result.written.length} 个字段，
  别名映射 ${result.aliasMapped.length}，未知 ${result.unknown.length}`)
if (result.unknown.length) {
  alert(`AI 输出包含未知字段（已忽略）：${result.unknown.join(', ')}\n建议截图反馈作者`)
}
```

### 4.5 这次为什么不会再出 bug

| 过去的 bug | R-2 如何根治 |
|------|------|
| 灵感反推 AI 吐 `summary/geography` 静默丢 | `aliases: ['summary']` 自动映射到 `worldOrigin`；未识别字段告警 |
| saveWorldview 内存 null 新建重复 | `writeWithDbAuthority` 以 DB 为准定位 |
| 单例工厂同 bug | 同上（adopt 内部统一） |
| AI 把 role 写成中文 → parseRole 误覆盖为 supporting | `type: 'enum'` 校验 + `sanitize` 兜底 |
| storyLines 遗留字段写入 | `aliases: ['storyLines']` 映射到 mainPlot |

**关键不变量**：今后加新可写字段 = `FIELD_REGISTRY` 加一行；AI 反推方写法不变（只声明 target + data），**字段映射不再是手工活**。

---

## 五、实施分期（从风险低到高）

```
Stage A · PROJECT_TABLES 注册表（先做，独立、风险最低）
   A1: 建注册表 + 派生 API（与旧函数共存）
   A2: cascadeDeleteProject/Group + stampPrimaryWorld 切换
   A3: exportProjectByRegistry/importProjectByRegistry 切换
   A4: 旧函数下线（确认无引用）
   收益：根治"加新表漏接生命周期"那一类（本轮 4 次中的 4 次）
   附带：同步修 BUG-EXPORT-WG（worldGroupId remap 协议统一）

Stage B · R-2 统一写回（建议中间做）
   B1: 建 FIELD_REGISTRY + adopt() 入口（不破现有保存）
   B2: 灵感反推 / world-group-ai / 参考采纳 切换
   B3: 单字段 AI 生成（AIFieldCard 等）经 adopt 校验
   B4: 旧 saveWorldview/saveStoryCore... 改为 adopt 薄壳
   收益：根治"字段映射散落 / AI 字段错位静默丢"

Stage C · R-1 统一上下文装配（最后做，工程量最大）
   C1: 建 CONTEXT_SOURCES 注册表（每源对应当前 build*Context 函数）
   C2: assembleContext() 入口（共存期）
   C3: ChapterEditor / OutlinePanel / DetailedOutlinePanel 切换（影响最大）
   C4: 其余 32 个生成入口逐个切（含工作流复用 adapter）
   C5: 真裁剪 autoTrimToFit 启用（替代当前"只算不裁"）
   C6: 旧 build*Context 改为薄壳 / 删除
   收益：根治"加新源要改 N 处"+ 工作流上下文丢失 + 真裁剪

每个 Stage 内部细分（建议）：
  ① 建注册表/API（不动调用方）
  ② 高频调用点先切（1-2 个面板）
  ③ 验证 + 灰度
  ④ 批量切换其余调用点
  ⑤ 旧实现下线
```

**每步独立 commit + 可单独回滚**；旧函数保留作适配器直到最后一步下线。

---

## 六、验证策略

### 6.1 单元 / 集成测试（每个支柱必加）

**Stage A**：
- 注册表完整性：`PROJECT_TABLES` 中每张表存在于 `db`，反之亦然（防漏注册）
- `cascadeDeleteProject` 跑完后所有项目级表 count(projectId)=0
- `cascadeDeleteWorldGroup` 跑完后该世界的 wgId 不再出现在任何 worldScoped 表
- `stampPrimaryWorld` 跑完后 worldScoped 表无 worldGroupId=null（内置 codexCategories 除外）
- 多世界项目导出 → 导入 → 抽样 5 张表对照原始 / wgId 正确

**Stage B**：
- `adopt({target:'worldviews', data:{summary:'X'}})` → `worldOrigin = 'X'` + aliasMapped 包含 `summary→worldOrigin`
- `adopt({target:'characters', data:{role:'主角'}})` → 类型错误 + `sanitize` 兜底为 `'protagonist'`
- 内存为 null 时 adopt → DB 中既有记录被更新（不新增）

**Stage C**：
- `assembleContext({need:['worldview', 'codex']})` 单/多世界路径产物对比
- 真裁剪：人为构造超预算 → 验证 L3 先被丢
- 工作流复用 assembleContext + adapter → 第一步能拿到 projectName/genres/dimension

### 6.2 多世界往返冒烟（人工脚本）

```
1. 新建项目 → 开启多世界 → 建 3 个世界（主世界、斗破、遮天）
2. 各世界填不同的 worldview/codex/角色/真实与幻想
3. 全字段冒烟生成（章节/大纲/细纲/场景考证/角色生成）→ 检查 AI 上下文按所属世界
4. 导出 JSON → 删项目 → 导入 JSON → 检查所有 worldGroupId 归属正确
5. 删某世界 → 检查所有该世界数据清除、无孤儿
```

### 6.3 回归网

把本轮已修 17 个 bug 全部写成"反例测试"：每个 bug 一条断言，确保重构后不复现。

---

## 七、风险与回滚

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| 切换调用方时引入回归 | 中 | 中 | 旧函数保留为薄适配器 / 灰度逐个切 / 分期 commit 可单回滚 |
| 注册表自身写错（字段拼写 / 漏 worldScoped） | 中 | 高 | 测试覆盖每表至少 1 条规则 / lint 校验注册表完整性（启动时报错） |
| 注册表 + 反射有性能影响 | 低 | 低 | 启动期一次性构建索引（Map<name, spec>） |
| Stage C 工程量大、影响 30+ 调用点 | 高 | 中 | 分批切（先 3 个最重的写作面板，跑一段时间确认后再切其余） |
| 工作流 BUG-INPUT-WITH-GEN 与 R-1 R-2 重叠 | 中 | 低 | 优先在 Stage B/C 完成后再修工作流（届时可直接复用） |

**整体回滚策略**：每个 Stage 独立 commit，每次切一两个调用点也独立 commit。任何阶段不满意，直接 `git revert` 到上一个稳定点。

---

## 八、与现有架构和未实现 Phase 的关系

```
PROJECT_TABLES (Stage A)
   ├── 修复 BUG-EXPORT-WG（worldGroupId remap 统一协议）
   ├── 简化 Phase 40 实施（worldRulesProfiles 加 worldScoped: true 一行 = 多世界化）
   └── 简化 Phase 35-b/35-c（新词条字段加进 registry 即可）

R-1 (Stage C)
   ├── 简化 Phase 38（一致性检测的事实基准走 assembleContext）
   ├── 简化 Phase 39（线索注册表作为新 context source）
   └── 修复 BUG-INPUT-WITH-GEN（工作流走 adapter + assembleContext）

R-2 (Stage B)
   ├── 简化所有 AI 反推类功能（统一走 adopt）
   ├── 修复 BUG-INPUT-WITH-GEN（输入框 value 自动通过 adopt 写回）
   └── 简化 Phase 35-c（AI 导入分类直接走 adopt + categoryId）
```

**先做架构 → 再做新 Phase**：所有未实现的 Phase 38/39/40/34/35-b/35-c 在三根支柱之上实施成本会显著降低。

---

## 九、完成判据

### Stage A
- [ ] `PROJECT_TABLES` 覆盖所有 27 张表，启动期完整性 lint 通过
- [ ] 5 个生命周期操作全部改为派生 API（旧手写表清单全部删除）
- [ ] 多世界往返冒烟通过 + BUG-EXPORT-WG 关闭
- [ ] 单元测试 ≥ 20 条

### Stage B
- [ ] `FIELD_REGISTRY` 覆盖所有 AI 可写字段（worldview/storyCore/characters/creativeRules…）
- [ ] 灵感反推 / world-group-ai / 参考采纳 / chunk-writer 全部走 adopt
- [ ] 老 saveWorldview 等改为 adopt 薄壳
- [ ] 单元测试 ≥ 15 条 + 灵感反推已知 bug 反例全部通过

### Stage C
- [ ] `CONTEXT_SOURCES` 覆盖所有上下文源
- [ ] 32+ 生成入口全部经 `assembleContext`
- [ ] 旧 build*Context 全部下线（或仅作 source 内部实现）
- [ ] 真裁剪 autoTrimToFit 启用
- [ ] 工作流 BUG-INPUT-WITH-GEN 关闭（顺带）

### 全局
- [ ] 本轮 17 个已修 bug 全部有"反例测试"
- [ ] 加新表 / 新字段 / 新源 = 单点修改，文档登记一处即可
- [ ] `DATA-FLOW-MAP.md` 与 `DATA-FLOW-DIAGRAM.md` 与本设计同步更新

---

## 十、维护规约（重构完成后）

1. **加新表**：在 `PROJECT_TABLES` 加一行（生命周期自动）；在 `DATA-FLOW-MAP` 总览章节登记；如有可写字段，在 `FIELD_REGISTRY` 加对应条目。
2. **加新 AI 可写字段**：在 `FIELD_REGISTRY` 加一行（adopt 自动校验）；如是历史字段重命名，加 `aliases`。
3. **加新上下文源**：在 `CONTEXT_SOURCES` 加一行（指定 layer/scope/budget）；面板 `need` 写 id。
4. **加新生成入口**：调 `assembleContext` 声明 need；写回调 `adopt` 声明 target。

> 任何违反以上规约的"直接调底层 db / 手挑组合 / 手写字段映射"，code review 应拒绝合入。

---

## 十一、本设计的元约束

- 本文档与 `DATA-FLOW-MAP.md` / `DATA-FLOW-DIAGRAM.md` 三位一体；重构期间任一变动须同步另两个。
- 三个 Stage **严格按 A → B → C 顺序**：A 是 B/C 的依赖（注册表元信息），B 比 C 风险低，先做 B 也能为 C 验证模式。
- 每个 Stage 完成前**不开始下一个**；不允许并行（除非有充分理由且分支管理）。
