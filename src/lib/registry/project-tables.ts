/**
 * PROJECT_TABLES 注册表(Phase 1.1a)· 单一事实源
 *
 * 全部 45 张 Dexie 表的元信息登记在此。
 * 导出/导入/删项目/删世界组/迁移多世界 全部从这里派生(见 lifecycle.ts)。
 *
 * ⚠️ 加新表 = 在此加一行 + schema.ts 加版本 + types 加类型。其它生命周期自动覆盖。
 *
 * 事实来源:docs/refactor/PROJECT_TABLES_ALL.md(45 表硬清单 + owner 分类 + refs)
 * 设计依据:docs/MASTER-BLUEPRINT.md §5.1
 */
import { db } from '../db/schema'
import type { TableSpec } from './types'

/** master blob 在 importFiles 表中的虚拟 sessionId 偏移(与 lib/master-study/pipeline.ts 一致) */
export const MASTER_BLOB_OFFSET = 100000

export const PROJECT_TABLES: TableSpec[] = [
  // ───────────────────────── 项目根表 ─────────────────────────
  { table: db.projects, name: 'projects', owner: 'project', exportable: true,
    note: '项目本身' },

  // ───────────────────── 世界观/设定(world-scoped 多)─────────────────────
  { table: db.worldviews, name: 'worldviews', owner: 'project', worldScoped: true,
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }] },

  { table: db.storyCores, name: 'storyCores', owner: 'project', exportable: true,
    note: '项目级,跨世界共享主线' },

  { table: db.powerSystems, name: 'powerSystems', owner: 'project', worldScoped: true,
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }] },

  { table: db.geographies, name: 'geographies', owner: 'project', worldScoped: true,
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }] },

  { table: db.histories, name: 'histories', owner: 'project', worldScoped: true,
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }] },

  { table: db.worldNodes, name: 'worldNodes', owner: 'project', worldScoped: true,
    exportable: true, tree: { parentField: 'parentId' },
    refs: [
      { kind: 'json', field: 'portalsJSON', jsonPath: '$[].targetNodeId', target: 'worldNodes[id]', onDelete: 'remap' },
    ],
    exportRemap: [
      { field: 'parentId', remapVia: 'worldNodes', selfTree: true },
      { field: 'worldGroupId', remapVia: 'worldGroups' },
    ],
    note: 'portalsJSON 内含指向其它节点的引用' },

  { table: db.historicalTimelineEvents, name: 'historicalTimelineEvents', owner: 'project',
    worldScoped: true, exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }] },

  { table: db.historicalKeywords, name: 'historicalKeywords', owner: 'project',
    worldScoped: true, exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }] },

  { table: db.importantLocations, name: 'importantLocations', owner: 'project',
    exportable: true, tree: { parentField: 'parentId' },
    exportRemap: [{ field: 'parentId', remapVia: 'importantLocations', selfTree: true }],
    note: '⚠️ 无 worldGroupId,当前全局注入写作上下文' },

  { table: db.worldRulesProfiles, name: 'worldRulesProfiles', owner: 'project',
    worldScoped: true, exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups' }],
    note: '真实与幻想规则每世界一套;null 为单世界/默认主世界' },

  // ───────────────────── 角色 ─────────────────────
  { table: db.characters, name: 'characters', owner: 'project', homeWorldScoped: true,
    exportable: true,
    refs: [
      // 删角色 → 关系级联删 + 细纲数组引用清理(Phase 2.6 实现 JSON/array 级联)
      { kind: 'simple', field: 'id', target: 'characterRelations[fromCharacterId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'characterRelations[toCharacterId]', onDelete: 'cascade' },
      { kind: 'array', field: 'appearingCharacterIds', itemTarget: 'detailedOutlines', onDelete: 'removeItem' },
    ],
    exportRemap: [{ field: 'homeWorldGroupId', remapVia: 'worldGroups' }] },

  { table: db.characterRelations, name: 'characterRelations', owner: 'project',
    exportable: true,
    exportRemap: [
      { field: 'fromCharacterId', remapVia: 'characters' },
      { field: 'toCharacterId', remapVia: 'characters' },
    ] },

  // (factions 表已于 DB v29 并入 codex.faction 词条并删除)

  // ───────────────────── 大纲 / 章节 / 细纲 ─────────────────────
  { table: db.outlineNodes, name: 'outlineNodes', owner: 'project', worldScoped: true,
    exportable: true, tree: { parentField: 'parentId' },
    refs: [
      { kind: 'simple', field: 'id', target: 'chapters[outlineNodeId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'detailedOutlines[outlineNodeId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'parentId', remapVia: 'outlineNodes', selfTree: true },
      { field: 'worldGroupId', remapVia: 'worldGroups' },
    ] },

  { table: db.chapters, name: 'chapters', owner: 'project', exportable: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'emotionBeatCards[chapterId]', onDelete: 'cascade' },
      // 软引用:itemLedger/storyTimelineEvents 的 chapterId 保留(独立产物,见 chapter store 注释)
    ],
    exportRemap: [{ field: 'outlineNodeId', remapVia: 'outlineNodes' }] },

  { table: db.detailedOutlines, name: 'detailedOutlines', owner: 'project', exportable: true,
    refs: [
      { kind: 'array', field: 'appearingCharacterIds', itemTarget: 'characters', onDelete: 'removeItem' },
      { kind: 'array', field: 'foreshadowIds', itemTarget: 'foreshadows', onDelete: 'removeItem' },
      { kind: 'json', field: 'scenes', jsonPath: '$[].characterIds[]', target: 'characters[id]', onDelete: 'remap' },
    ],
    exportRemap: [{ field: 'outlineNodeId', remapVia: 'outlineNodes' }] },

  { table: db.emotionBeatCards, name: 'emotionBeatCards', owner: 'project', exportable: true,
    exportRemap: [{ field: 'chapterId', remapVia: 'chapters' }] },

  // ───────────────────── 下游产物 / 工具 ─────────────────────
  { table: db.foreshadows, name: 'foreshadows', owner: 'project', exportable: true,
    note: '可跨世界;plant/resolveChapterId 为软引用(删章不强删)' },

  { table: db.storyArcs, name: 'storyArcs', owner: 'project', exportable: true },

  { table: db.stateCards, name: 'stateCards', owner: 'project', exportable: true },

  { table: db.itemLedger, name: 'itemLedger', owner: 'project', exportable: true,
    exportRemap: [{ field: 'chapterId', remapVia: 'chapters' }],
    note: 'chapterId 软引用;诸天流主角跨世界携带物品' },

  { table: db.storyTimelineEvents, name: 'storyTimelineEvents', owner: 'project', exportable: true,
    exportRemap: [{ field: 'chapterId', remapVia: 'chapters' }] },

  { table: db.notes, name: 'notes', owner: 'project', exportable: true },

  { table: db.creativeRules, name: 'creativeRules', owner: 'project', exportable: true,
    refs: [
      { kind: 'array', field: 'citedReferenceIds', itemTarget: 'references', onDelete: 'removeItem' },
      { kind: 'array', field: 'citedInsightIds', itemTarget: 'masterInsights', onDelete: 'removeItem' },
    ] },

  // (itemSystems 表已于 DB v29 并入 codex.artifact 词条并删除)

  // ───────────────────── 词条系统 ─────────────────────
  { table: db.codexCategories, name: 'codexCategories', owner: 'project', worldScoped: true,
    exportable: true, tree: { parentField: 'parentId' },
    refs: [{ kind: 'simple', field: 'id', target: 'codexEntries[categoryId]', onDelete: 'cascade' }],
    exportRemap: [
      { field: 'parentId', remapVia: 'codexCategories', selfTree: true },
      { field: 'worldGroupId', remapVia: 'worldGroups' },
    ],
    note: '内置分类(builtInKey 非空)保持 worldGroupId=null 全局,不盖章不按世界删' },

  { table: db.codexEntries, name: 'codexEntries', owner: 'project', worldScoped: true,
    exportable: true,
    refs: [{ kind: 'json', field: 'refs', jsonPath: '$.*', target: 'codexEntries[id]', onDelete: 'remap' }],
    exportRemap: [
      { field: 'categoryId', remapVia: 'codexCategories' },
      { field: 'worldGroupId', remapVia: 'worldGroups' },
    ] },

  // ───────────────────── 文风学习（FB-5） ─────────────────────
  { table: db.userStyleProfiles, name: 'userStyleProfiles', owner: 'project', exportable: true,
    note: '每项目一份 AI 文风画像;projectId 单例' },

  // ───────────────────── 多世界 ─────────────────────
  { table: db.worldGroups, name: 'worldGroups', owner: 'project', exportable: true,
    note: '导出用 _exportId(index)重映射,见 json-export BUG-EXPORT-WG 修复' },

  { table: db.worldGroupLinks, name: 'worldGroupLinks', owner: 'project', exportable: true,
    exportRemap: [
      { field: 'fromGroupId', remapVia: 'worldGroups' },
      { field: 'toGroupId', remapVia: 'worldGroups' },
    ] },

  // ───────────────────── 参考书 / 作品学习 ─────────────────────
  { table: db.references, name: 'references', owner: 'project', exportable: true,
    refs: [{ kind: 'simple', field: 'id', target: 'referenceChunkAnalysis[referenceId]', onDelete: 'cascade' }] },

  { table: db.referenceChunkAnalysis, name: 'referenceChunkAnalysis', owner: 'direct-child',
    exportable: true,
    projectResolver: async (projectId) =>
      (await db.references.where('projectId').equals(projectId).primaryKeys()) as number[],
    refs: [{ kind: 'indirect', via: { table: 'references', field: 'referenceId', resolveProject: 'projectId' }, onDelete: 'cascade' }],
    exportRemap: [{ field: 'referenceId', remapVia: 'references' }] },

  { table: db.masterWorks, name: 'masterWorks', owner: 'project', exportable: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'masterChunkAnalysis[workId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'masterChapterBeats[workId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'masterStyleMetrics[workId]', onDelete: 'cascade' },
      // master 原文 blob 复用 importFiles,虚拟 sessionId = MASTER_BLOB_OFFSET + workId
      { kind: 'blob-owner', ownerTable: 'importFiles',
        keyResolver: (row: any) => MASTER_BLOB_OFFSET + row.id, onDelete: 'cascade' },
    ],
    note: 'projectId 可空(null=全局学习库)' },

  { table: db.masterChunkAnalysis, name: 'masterChunkAnalysis', owner: 'direct-child',
    exportable: true,
    projectResolver: async (projectId) =>
      (await db.masterWorks.where('projectId').equals(projectId).primaryKeys()) as number[],
    exportRemap: [{ field: 'workId', remapVia: 'masterWorks' }] },

  { table: db.masterChapterBeats, name: 'masterChapterBeats', owner: 'direct-child',
    exportable: true,
    projectResolver: async (projectId) =>
      (await db.masterWorks.where('projectId').equals(projectId).primaryKeys()) as number[],
    exportRemap: [{ field: 'workId', remapVia: 'masterWorks' }] },

  { table: db.masterStyleMetrics, name: 'masterStyleMetrics', owner: 'direct-child',
    exportable: true,
    projectResolver: async (projectId) =>
      (await db.masterWorks.where('projectId').equals(projectId).primaryKeys()) as number[],
    exportRemap: [{ field: 'workId', remapVia: 'masterWorks' }] },

  { table: db.masterInsights, name: 'masterInsights', owner: 'global', exportable: true,
    note: '按 genre 全局共享;导出全量,导入按 genre 去重' },

  // ───────────────────── 临时态 / blob ─────────────────────
  { table: db.importSessions, name: 'importSessions', owner: 'transient', exportable: false },

  { table: db.importJobs, name: 'importJobs', owner: 'transient', exportable: false,
    note: '直接 projectId' },

  { table: db.importLogs, name: 'importLogs', owner: 'indirect', exportable: false,
    projectResolver: async (projectId) =>
      (await db.importSessions.where('projectId').equals(projectId).primaryKeys()) as number[],
    refs: [{ kind: 'indirect', via: { table: 'importSessions', field: 'sessionId', resolveProject: 'projectId' }, onDelete: 'cascade' }] },

  { table: db.importFiles, name: 'importFiles', owner: 'blob', exportable: false,
    note: '主键=sessionId;普通导入用 importSessions.id,master blob 用 MASTER_BLOB_OFFSET+workId' },

  // ───────────────────── 全局 / 本地态 ─────────────────────
  { table: db.snapshots, name: 'snapshots', owner: 'project', exportable: false,
    note: '本地版本历史;不导出(避免循环嵌套)' },

  { table: db.promptTemplates, name: 'promptTemplates', owner: 'global', exportable: false,
    note: '全局 scope=system|user' },

  { table: db.promptWorkflows, name: 'promptWorkflows', owner: 'global', exportable: false },

  { table: db.aiUsageLog, name: 'aiUsageLog', owner: 'project', exportable: false,
    note: '消耗统计;projectId 可空;体积大不导出' },
]

/** 按表名快速查找 */
export const REGISTRY_BY_NAME: ReadonlyMap<string, TableSpec> = new Map(
  PROJECT_TABLES.map(s => [s.name, s] as const),
)
