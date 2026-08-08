/**
 * PROJECT_TABLES 注册表(Phase 1.1a)· 单一事实源
 *
 * 全部项目 Dexie 表的元信息登记在此。
 * 导出/导入/删项目/删世界组/迁移多世界 全部从这里派生(见 lifecycle.ts)。
 *
 * ⚠️ 加新表 = 在此加一行 + schema.ts 加版本 + types 加类型。其它生命周期自动覆盖。
 *
 * 当前事实来源:本注册表 + schema.ts + ensure-schema.ts，三者由 CI 双向校验。
 * docs/refactor/PROJECT_TABLES_ALL.md 仅保留 Phase 1 前的历史快照。
 * 设计依据:docs/MASTER-BLUEPRINT.md §5.1
 */
import { db } from '../db/schema'
import type { DomainOwnershipSpec, TableSpec } from './types'

const WORKSPACE_DOMAIN_OWNER = {
  allowed: ['workspace'], legacyDefault: 'workspace', locator: { kind: 'workspace' },
} as const satisfies DomainOwnershipSpec

const LEGACY_WORLD_OWNER = {
  allowed: ['world'], legacyDefault: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' },
} as const satisfies DomainOwnershipSpec

const LEGACY_WORK_OWNER = {
  allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' },
} as const satisfies DomainOwnershipSpec

const LEGACY_WORLD_OR_WORK_OWNER = {
  allowed: ['world', 'work'], legacyDefault: 'work', locator: {
    kind: 'exclusive-fields', worldField: 'worldId', workField: 'workId',
  },
} as const satisfies DomainOwnershipSpec

export const PROJECT_TABLES: TableSpec[] = [
  // ───────────────────────── 项目根表 ─────────────────────────
  { table: db.projects, name: 'projects', owner: 'project', exportable: true,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    exportRemap: [
      {
        field: 'activeCharacterDrivenPlanId',
        remapVia: 'characterDrivenPlans',
        exportAs: '_activeCharacterDrivenPlanExportId',
      },
      { field: 'activeWorldId', remapVia: 'worlds', exportAs: '_activeWorldExportId' },
      { field: 'activeWorkId', remapVia: 'works', exportAs: '_activeWorkExportId' },
    ],
    note: 'WORLD-2C 后作为 LocalWorkspace 物理兼容根，不再冒充 World/Work' },

  // WORLD-2C C1 added empty roots; C2 now creates/adopts them lazily on workspace entry.
  { table: db.worlds, name: 'worlds', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    refs: [
      { kind: 'simple', field: 'id', target: 'works[worldId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'worldRevisions[worldId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'worldReleases[worldId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'simulationSessions[worldId]', onDelete: 'cascade' },
    ],
    note: 'WORLD-2C 显式世界根；公开身份和世界版本的未来权威' },

  { table: db.works, name: 'works', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world'], legacyDefault: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    refs: [
      { kind: 'simple', field: 'id', target: 'workCharacterBindings[workId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'simulationSessions[workId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentRuns[workId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'activeCharacterDrivenPlanId', remapVia: 'characterDrivenPlans',
        exportAs: '_activeCharacterDrivenPlanExportId' },
      { field: 'activeNarrativeModuleId', remapVia: 'narrativeModules',
        exportAs: '_activeNarrativeModuleExportId' },
    ],
    note: 'WORLD-2C 显式作品根；同一 World 可包含多部隔离作品' },

  { table: db.workCharacterBindings, name: 'workCharacterBindings', owner: 'project', exportable: true,
    communityShare: 'world', releaseSection: 'characters',
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    exportRemap: [
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId', onUnmapped: 'require' },
    ],
    note: '角色身份保持世界级；本表只保存作品内角色作用投影' },

  { table: db.ownershipMigrations, name: 'ownershipMigrations', owner: 'transient', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    note: 'WORLD-2C 惰性迁移的紧凑 before-image 和恢复凭证，不保存手稿正文' },

  { table: db.worldRevisions, name: 'worldRevisions', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world'], legacyDefault: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    worldDomains: ['foundation', 'narrative'],
    tree: { parentField: 'parentRevisionId' },
    refs: [{ kind: 'simple', field: 'id', target: 'worldReleases[revisionId]', onDelete: 'keep' }],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'parentRevisionId', remapVia: 'worldRevisions', selfTree: true, exportAs: '_parentExportId' },
    ],
    note: 'WORLD-2E 可比较的世界草稿修订；manifest 为冻结快照' },

  { table: db.worldReleases, name: 'worldReleases', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world'], legacyDefault: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    worldDomains: ['foundation', 'narrative'], communityShare: 'world', releaseSection: 'foundation',
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'revisionId', remapVia: 'worldRevisions', exportAs: '_revisionExportId', onUnmapped: 'require' },
    ],
    note: 'WORLD-2E 不可变发布版本；运行实例只绑定该记录或显式草稿快照' },

  // ───────────────────── 世界观/设定(world-scoped 多)─────────────────────
  { table: db.worldviews, name: 'worldviews', owner: 'project', worldScoped: true, communityShare: 'world', releaseSection: 'foundation',
    domainOwner: LEGACY_WORLD_OWNER,
    worldDomains: ['foundation'],
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },

  { table: db.storyCores, name: 'storyCores', owner: 'project', exportable: true,
    communityShare: 'world', releaseSection: 'narrative',
    domainOwner: LEGACY_WORLD_OR_WORK_OWNER,
    worldDomains: ['narrative'],
    note: '项目级,跨世界共享主线' },

  { table: db.powerSystems, name: 'powerSystems', owner: 'project', worldScoped: true, communityShare: 'world', releaseSection: 'foundation',
    domainOwner: LEGACY_WORLD_OWNER,
    worldDomains: ['foundation'],
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },

  { table: db.cultivationSystems, name: 'cultivationSystems', owner: 'project', worldScoped: true, communityShare: 'world', releaseSection: 'foundation',
    domainOwner: LEGACY_WORLD_OWNER,
    worldDomains: ['foundation', 'assets'],
    exportable: true, exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'characters[cultivationSystemId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'codexEntries[cultivationSystemId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'temporalFacts[sourceCultivationSystemId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'cultivationProgress[cultivationSystemId]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ],
    defaults: { description: '', stages: '[]' },
    note: 'Phase 37 修炼流派；stages 为已校验 DAG，区别于世界底层 powerSystems' },

  { table: db.cultivationProgress, name: 'cultivationProgress', owner: 'project', worldScoped: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportable: true,
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId' },
      { field: 'cultivationSystemId', remapVia: 'cultivationSystems', exportAs: '_cultivationSystemExportId' },
      { field: 'sourceChapterId', remapVia: 'chapters', exportAs: '_sourceChapterExportId' },
    ],
    defaults: { status: 'confirmed', sourceOffset: 0, trigger: '' },
    note: 'Phase 34 作者确认的正文修炼事件；当前境界与实际路径按规范章序实时投影，软引用缺失时保留冗余名称与证据' },

  { table: db.geographies, name: 'geographies', owner: 'project', worldScoped: true, communityShare: 'world', releaseSection: 'foundation',
    domainOwner: LEGACY_WORLD_OWNER,
    worldDomains: ['foundation'],
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },

  { table: db.histories, name: 'histories', owner: 'project', worldScoped: true, communityShare: 'world', releaseSection: 'foundation',
    domainOwner: LEGACY_WORLD_OWNER,
    worldDomains: ['foundation'],
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },

  { table: db.worldNodes, name: 'worldNodes', owner: 'project', worldScoped: true, communityShare: 'world', releaseSection: 'foundation',
    domainOwner: LEGACY_WORLD_OWNER,
    worldDomains: ['foundation', 'assets'],
    exportable: true, tree: { parentField: 'parentId' }, exportIdField: true,
    refs: [
      { kind: 'json', field: 'portalsJSON', jsonPath: '$[].targetWorldId', target: 'worldNodes[id]', onDelete: 'remap' },
    ],
    exportRemap: [
      { field: 'parentId', remapVia: 'worldNodes', selfTree: true, exportAs: '_parentExportId' },
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ],
    exportRefRemap: [{ field: 'portalsJSON', remapVia: 'worldNodes', kind: 'portals' }],
    note: 'portalsJSON 内含指向其它节点的引用' },

  { table: db.historicalTimelineEvents, name: 'historicalTimelineEvents', owner: 'project',
    domainOwner: LEGACY_WORLD_OWNER,
    worldScoped: true, exportable: true, communityShare: 'world', releaseSection: 'foundation',
    worldDomains: ['foundation'],
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },

  { table: db.historicalKeywords, name: 'historicalKeywords', owner: 'project',
    domainOwner: LEGACY_WORLD_OWNER,
    worldScoped: true, exportable: true, communityShare: 'world', releaseSection: 'foundation',
    worldDomains: ['foundation'],
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },

  { table: db.importantLocations, name: 'importantLocations', owner: 'project',
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true, communityShare: 'world', releaseSection: 'foundation', tree: { parentField: 'parentId' }, exportIdField: true,
    worldDomains: ['foundation', 'assets'],
    refs: [
      { kind: 'simple', field: 'id', target: 'codexEntries[importantLocationId]', onDelete: 'setNull' },
    ],
    exportRemap: [{ field: 'parentId', remapVia: 'importantLocations', selfTree: true, exportAs: '_parentExportId' }],
    note: '⚠️ 无 worldGroupId,当前全局注入写作上下文；城池词条可通过 importantLocationId 建立软引用' },

  { table: db.worldRulesProfiles, name: 'worldRulesProfiles', owner: 'project',
    domainOwner: LEGACY_WORLD_OWNER,
    worldScoped: true, exportable: true, communityShare: 'world', releaseSection: 'foundation',
    worldDomains: ['foundation'],
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }],
    note: '真实与幻想规则每世界一套;null 为单世界/默认主世界' },

  // ───────────────────── 角色 ─────────────────────
  { table: db.characters, name: 'characters', owner: 'project', homeWorldScoped: true,
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true, communityShare: 'world', releaseSection: 'characters',
    worldDomains: ['assets'],
    refs: [
      // 删角色 → 关系级联删 + 细纲数组引用清理
      { kind: 'simple', field: 'id', target: 'characterRelations[fromCharacterId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'characterRelations[toCharacterId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'chapters[perspectiveCharacterId]', onDelete: 'setNull' },
      { kind: 'array', field: 'appearingCharacterIds', itemTarget: 'detailedOutlines', onDelete: 'removeItem' },
    ],
    exportRemap: [
      { field: 'homeWorldGroupId', remapVia: 'worldGroups', exportAs: '_homeWorldGroupExportId' },
      { field: 'raceEntryId', remapVia: 'codexEntries', exportAs: '_raceEntryExportId' },
      { field: 'cultivationSystemId', remapVia: 'cultivationSystems', exportAs: '_cultivationSystemExportId' },
    ] },

  { table: db.characterRelations, name: 'characterRelations', owner: 'project',
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true, communityShare: 'world', releaseSection: 'characters',
    worldDomains: ['assets'],
    exportRemap: [
      { field: 'fromCharacterId', remapVia: 'characters', exportAs: '_fromCharacterIndex', onUnmapped: 'drop' },
      { field: 'toCharacterId', remapVia: 'characters', exportAs: '_toCharacterIndex', onUnmapped: 'drop' },
    ] },

  // (factions 表已于 DB v29 并入 codex.faction 词条并删除)

  // ───────────────────── 大纲 / 章节 / 细纲 ─────────────────────
  { table: db.outlineNodes, name: 'outlineNodes', owner: 'project', worldScoped: true,
    domainOwner: LEGACY_WORLD_OR_WORK_OWNER,
    exportable: true, communityShare: 'world', releaseSection: 'outline', tree: { parentField: 'parentId' }, exportIdField: true,
    worldDomains: ['narrative'],
    // summary 是非可选字段,但老数据/跨版本导入的 JSON 可能整体缺该键 → 导入兜成 ''，
    // 保证 OutlineNode.summary 不变量(恒为 string),读取处无需散补 `?.`。
    defaults: { summary: '' },
    refs: [
      { kind: 'simple', field: 'id', target: 'chapters[outlineNodeId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'detailedOutlines[outlineNodeId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'parentId', remapVia: 'outlineNodes', selfTree: true, exportAs: '_parentExportId' },
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ] },

  { table: db.chapters, name: 'chapters', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER,
    selfIdPaths: ['continuityHandoff.chapterId', 'planReconciliation.chapterId'],
    refs: [
      { kind: 'simple', field: 'id', target: 'emotionBeatCards[chapterId]', onDelete: 'cascade' },
      // 软引用:itemLedger/storyTimelineEvents 的 chapterId 保留(独立产物,见 chapter store 注释)
    ],
    exportRemap: [
      { field: 'outlineNodeId', remapVia: 'outlineNodes', exportAs: '_outlineExportId', onUnmapped: 'require' },
      { field: 'perspectiveCharacterId', remapVia: 'characters', exportAs: '_perspectiveCharacterExportId' },
    ] },

  { table: db.detailedOutlines, name: 'detailedOutlines', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORLD_OR_WORK_OWNER,
    communityShare: 'world', releaseSection: 'outline',
    worldDomains: ['narrative'],
    refs: [
      { kind: 'array', field: 'appearingCharacterIds', itemTarget: 'characters', onDelete: 'removeItem' },
      { kind: 'array', field: 'foreshadowIds', itemTarget: 'foreshadows', onDelete: 'removeItem' },
      { kind: 'json', field: 'scenes', jsonPath: '$[].characterIds[]', target: 'characters[id]', onDelete: 'remap' },
    ],
    exportRefRemap: [
      { field: 'appearingCharacterIds', remapVia: 'characters', kind: 'id-array', exportAs: '_appearingCharacterIndexes' },
      { field: 'foreshadowIds', remapVia: 'foreshadows', kind: 'id-array', exportAs: '_foreshadowIndexes' },
      { field: 'scenes', remapVia: 'characters', kind: 'scene-character-ids', exportAs: '_sceneCharacterIndexes' },
    ],
    exportRemap: [{ field: 'outlineNodeId', remapVia: 'outlineNodes', exportAs: '_outlineExportId', onUnmapped: 'require' }] },

  { table: db.emotionBeatCards, name: 'emotionBeatCards', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [{ field: 'chapterId', remapVia: 'chapters', exportAs: '_chapterExportId', onUnmapped: 'require' }] },

  // ───────────────────── 下游产物 / 工具 ─────────────────────
  { table: db.foreshadows, name: 'foreshadows', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORLD_OR_WORK_OWNER,
    worldDomains: ['narrative'],
    note: '可跨世界;plant/resolveChapterId 为软引用(删章不强删)' },

  { table: db.storyArcs, name: 'storyArcs', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORLD_OR_WORK_OWNER,
    communityShare: 'world', releaseSection: 'narrative',
    worldDomains: ['narrative'],
    exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'storylineProgress[arcId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'storylineCrossings[arcIdA]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'storylineCrossings[arcIdB]', onDelete: 'cascade' },
    ] },

  { table: db.narrativeModules, name: 'narrativeModules', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: LEGACY_WORLD_OR_WORK_OWNER,
    worldDomains: ['narrative'], communityShare: 'world', releaseSection: 'narrative',
    refs: [{ kind: 'simple', field: 'id', target: 'narrativeNodes[moduleId]', onDelete: 'cascade' }],
    defaults: { description: '', status: 'draft', sourceProjection: 'custom', entryNodeKey: null },
    note: 'WORLD-2D 主线/支线/任务/开局的单一可执行叙事来源' },

  { table: db.narrativeNodes, name: 'narrativeNodes', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world', 'work'], legacyDefault: 'work', locator: { kind: 'parent', owner: 'work', table: 'narrativeModules', field: 'moduleId' } },
    worldDomains: ['narrative'], communityShare: 'world', releaseSection: 'narrative',
    exportRemap: [
      { field: 'moduleId', remapVia: 'narrativeModules', exportAs: '_moduleExportId', onUnmapped: 'require' },
      { field: 'sourceOutlineNodeId', remapVia: 'outlineNodes', exportAs: '_sourceOutlineExportId' },
    ],
    defaults: { summary: '', conditionJson: '{}', effectsJson: '[]', successorKeysJson: '[]', order: 0 },
    note: 'WORLD-2D 条件、选择、效果、后继和结局节点' },

  { table: db.characterDrivenPlans, name: 'characterDrivenPlans', owner: 'project',
    domainOwner: LEGACY_WORK_OWNER,
    exportable: true, exportIdField: true, tree: { parentField: 'parentPlanId' },
    refs: [
      { kind: 'json', field: 'arcs', jsonPath: '$[].characterId', target: 'characters[id]', onDelete: 'remap' },
      { kind: 'simple', field: 'id', target: 'projects[activeCharacterDrivenPlanId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'characterDrivenPlans[parentPlanId]', onDelete: 'setNull' },
    ],
    exportRemap: [{
      field: 'parentPlanId',
      remapVia: 'characterDrivenPlans',
      selfTree: true,
      exportAs: '_parentExportId',
    }],
    exportRefRemap: [{
      field: 'arcs',
      remapVia: 'characters',
      kind: 'character-plan-arcs',
      exportAs: '_arcCharacterIndexes',
    }],
    defaults: {
      arcs: '[]',
      userHint: '',
      generatedVolumes: '[]',
      status: 'draft',
      version: 1,
      parentPlanId: null,
    },
    note: 'CF-9C 项目级角色驱动设计方案；角色为软引用，删除后保留姓名/身份快照' },

  { table: db.storylineProgress, name: 'storylineProgress', owner: 'project',
    domainOwner: LEGACY_WORK_OWNER,
    exportable: true,
    defaults: { status: 'dormant', involvedEntities: '[]' },
    exportRemap: [
      { field: 'arcId', remapVia: 'storyArcs', exportAs: '_arcExportId', onUnmapped: 'require' },
      { field: 'lastActiveChapterId', remapVia: 'chapters', exportAs: '_lastChapterExportId' },
    ],
    note: 'Phase 39 已确认的故事线动态投影；每条 StoryArc 至多一行，删章保留标题并 NULL 化引用' },

  { table: db.storylineCrossings, name: 'storylineCrossings', owner: 'project',
    domainOwner: LEGACY_WORK_OWNER,
    exportable: true,
    exportRemap: [
      { field: 'arcIdA', remapVia: 'storyArcs', exportAs: '_arcAExportId', onUnmapped: 'require' },
      { field: 'arcIdB', remapVia: 'storyArcs', exportAs: '_arcBExportId', onUnmapped: 'require' },
      { field: 'chapterId', remapVia: 'chapters', exportAs: '_chapterExportId' },
    ],
    note: 'Phase 39 已确认的两条登记故事线交汇；删章保留证据与章节标题并 NULL 化引用' },

  { table: db.stateCards, name: 'stateCards', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER },

  { table: db.itemLedger, name: 'itemLedger', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER,
    refs: [
      { kind: 'simple', field: 'characterId', target: 'characters[id]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'chapterId', remapVia: 'chapters', exportAs: '_chapterExportId' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId' },
    ],
    note: 'chapterId 与 characterId 均为软引用；角色删除时 NULL 化 characterId、保留 heldByName' },

  { table: db.storyTimelineEvents, name: 'storyTimelineEvents', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [{ field: 'chapterId', remapVia: 'chapters', exportAs: '_chapterExportId' }] },

  { table: db.notes, name: 'notes', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER },

  { table: db.creativeRules, name: 'creativeRules', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER,
    refs: [
      { kind: 'array', field: 'citedReferenceIds', itemTarget: 'references', onDelete: 'removeItem' },
    ],
    exportRefRemap: [
      { field: 'citedReferenceIds', remapVia: 'references', kind: 'id-array', exportAs: '_citedReferenceIndexes', storage: 'json-string' },
    ] },

  // (itemSystems 表已于 DB v29 并入 codex.artifact 词条并删除)

  // ───────────────────── 词条系统 ─────────────────────
  { table: db.codexCategories, name: 'codexCategories', owner: 'project',
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true, communityShare: 'world', releaseSection: 'foundation', tree: { parentField: 'parentId' }, exportIdField: true,
    refs: [{ kind: 'simple', field: 'id', target: 'codexEntries[categoryId]', onDelete: 'cascade' }],
    exportRemap: [
      { field: 'parentId', remapVia: 'codexCategories', selfTree: true, exportAs: '_parentExportId' },
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ],
    note: '分类 schema 项目级共享；worldGroupId 仅为旧备份兼容字段，不参与世界生命周期' },

  { table: db.codexEntries, name: 'codexEntries', owner: 'project', worldScoped: true,
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true, communityShare: 'world', releaseSection: 'foundation',
    worldDomains: ['foundation', 'assets'],
    refs: [
      { kind: 'json', field: 'refs', jsonPath: '$.*', target: 'codexEntries[id]', onDelete: 'remap' },
      { kind: 'simple', field: 'id', target: 'characters[raceEntryId]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'categoryId', remapVia: 'codexCategories', exportAs: '_categoryExportId', onUnmapped: 'require' },
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'cultivationSystemId', remapVia: 'cultivationSystems', exportAs: '_cultivationSystemExportId' },
      { field: 'importantLocationId', remapVia: 'importantLocations', exportAs: '_importantLocationExportId' },
    ] },

  // ───────────────────── 文风学习（FB-5） ─────────────────────
  { table: db.userStyleProfiles, name: 'userStyleProfiles', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER,
    note: '每项目一份 AI 文风画像;projectId 单例' },

  // ───────────────────── 增量灵感工作区（CM-1） ─────────────────────
  { table: db.inspirationWorkspaces, name: 'inspirationWorkspaces', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER,
    defaults: { fragments: '[]', versions: '[]' },
    note: '每项目一份有界灵感碎片与确认版本；未确认 AI 预览不落库' },

  // ───────────────────── PLATFORM-2 创作过程层 ─────────────────────
  { table: db.agentConversations, name: 'agentConversations', owner: 'project',
    domainOwner: LEGACY_WORK_OWNER,
    worldScoped: true, exportable: true, exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'agentEvents[conversationId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentRuns[conversationId]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ],
    defaults: { status: 'active' },
    note: 'AGENT-1 单一总对话；领域 Agent 只作为幕后事件，不形成前台标签' },

  { table: db.agentEvents, name: 'agentEvents', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      { field: 'conversationId', remapVia: 'agentConversations', exportAs: '_conversationExportId', onUnmapped: 'require' },
    ],
    defaults: { payload: '{}' },
    note: 'Agent 追加事件流：消息/计划/任务/候选/确认/错误，未确认候选不属于 Canon' },

  { table: db.agentRuns, name: 'agentRuns', owner: 'project',
    domainOwner: LEGACY_WORK_OWNER,
    worldScoped: true, exportable: true, exportIdField: true,
    tree: { parentField: 'parentRunId' },
    refs: [
      { kind: 'simple', field: 'id', target: 'agentRuns[parentRunId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentRunEvents[runId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentRunCheckpoints[runId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'parentRunId', remapVia: 'agentRuns', selfTree: true, exportAs: '_parentExportId' },
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'conversationId', remapVia: 'agentConversations', exportAs: '_conversationExportId' },
    ],
    portableData: {
      kind: 'agent-run-root',
      contractField: 'contractJson',
      contractHashField: 'contractHash',
      dependencies: ['worldGroups', 'chapters', 'outlineNodes'],
    },
    defaults: {
      status: 'planned',
      contractVersion: 1,
      generation: 1,
      lastSequence: 0,
      projectionJson: '{}',
      terminalReceiptHash: null,
      parentRunId: null,
      parentRelation: null,
      parentReceiptHash: null,
      parentArtifactHash: null,
    },
    note: 'HARNESS-1/21 durable run 根与父子 lineage；contract 与严格事件投影的物化状态，不保存正文或隐藏推理' },

  { table: db.agentRunEvents, name: 'agentRunEvents', owner: 'project',
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'parent', owner: 'work', table: 'agentRuns', field: 'runId' } },
    worldScoped: true, exportable: true,
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'runId', remapVia: 'agentRuns', exportAs: '_agentRunExportId', onUnmapped: 'require' },
    ],
    portableData: { kind: 'agent-run-child', parentField: 'runId', contractHashField: 'contractHash' },
    defaults: { generation: 1, payloadJson: '{}' },
    note: 'HARNESS-1 严格追加事件；(runId,sequence) 唯一，非法版本/断序/scope 污染 fail-closed' },

  { table: db.agentRunCheckpoints, name: 'agentRunCheckpoints', owner: 'project',
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'parent', owner: 'work', table: 'agentRuns', field: 'runId' } },
    worldScoped: true, exportable: true,
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'runId', remapVia: 'agentRuns', exportAs: '_agentRunExportId', onUnmapped: 'require' },
    ],
    portableData: { kind: 'agent-run-child', parentField: 'runId', contractHashField: 'contractHash' },
    defaults: {
      generation: 1,
      checkpointHash: '0'.repeat(64),
      resumePayloadJson: null,
      resumePayloadHash: null,
    },
    note: 'HARNESS-1 最小恢复检查点；保存投影与可选 provider opaque 状态哈希，不复制手稿全文' },

  { table: db.nodeFlows, name: 'nodeFlows', owner: 'project',
    domainOwner: LEGACY_WORK_OWNER,
    worldScoped: true, exportable: true, exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'nodeRuns[flowId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ],
    defaults: { graphJson: '{"version":1,"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}' },
    note: 'FLOW-2 项目级自由节点文档；独立于 PromptWorkflow' },

  { table: db.nodeRuns, name: 'nodeRuns', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      { field: 'flowId', remapVia: 'nodeFlows', exportAs: '_flowExportId', onUnmapped: 'require' },
    ],
    defaults: {
      inputSnapshotsJson: '{}',
      nodeResultsJson: '{}',
      executionPlanJson: '{}',
      graphSnapshotJson: '',
    },
    note: 'FLOW-2/3 逐节点输入、输出、执行计划与断点记录，保证刷新后仍可见可恢复' },

  // ───────────────────── SIM-1 共享互动运行时 ─────────────────────
  { table: db.simulationSessions, name: 'simulationSessions', owner: 'project',
    domainOwner: { allowed: ['instance'], legacyDefault: 'instance', locator: { kind: 'field', owner: 'instance', field: 'id' } },
    worldScoped: true, exportable: true, exportIdField: true,
    worldDomains: ['runtime'],
    tree: { parentField: 'parentSessionId' },
    refs: [
      { kind: 'simple', field: 'id', target: 'simulationSessions[parentSessionId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'simulationEvents[sessionId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'simulationCheckpoints[sessionId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'parentSessionId', remapVia: 'simulationSessions', selfTree: true,
        exportAs: '_parentSessionExportId' },
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId' },
      { field: 'worldReleaseId', remapVia: 'worldReleases', exportAs: '_worldReleaseExportId' },
      { field: 'narrativeModuleId', remapVia: 'narrativeModules', exportAs: '_narrativeModuleExportId' },
    ],
    defaults: {
      kind: 'sandbox',
      status: 'active',
      rulesetVersion: 1,
      canonSnapshotJson: '{"version":1,"sources":[]}',
      initialStateJson: '{"version":1,"clock":0,"entities":{},"memories":[],"narratives":[],"ttrpg":null,"lastSequence":0}',
    },
    note: 'SIM-1 独立互动世界实例；冻结创作来源，不反写 Canon；分支拥有独立事件流' },

  { table: db.simulationEvents, name: 'simulationEvents', owner: 'project',
    domainOwner: { allowed: ['instance'], legacyDefault: 'instance', locator: { kind: 'parent', owner: 'instance', table: 'simulationSessions', field: 'sessionId' } },
    worldScoped: true, exportable: true,
    worldDomains: ['runtime'],
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'sessionId', remapVia: 'simulationSessions',
        exportAs: '_simulationSessionExportId', onUnmapped: 'require' },
    ],
    defaults: { actorKey: null, targetKey: null, payloadJson: '{}' },
    note: 'SIM-1 严格追加事件；(sessionId,sequence) 唯一，状态、骰子、记忆和叙事均从事件回放' },

  { table: db.simulationCheckpoints, name: 'simulationCheckpoints', owner: 'project',
    domainOwner: { allowed: ['instance'], legacyDefault: 'instance', locator: { kind: 'parent', owner: 'instance', table: 'simulationSessions', field: 'sessionId' } },
    worldScoped: true, exportable: true,
    worldDomains: ['runtime'],
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'sessionId', remapVia: 'simulationSessions',
        exportAs: '_simulationSessionExportId', onUnmapped: 'require' },
    ],
    defaults: { throughSequence: 0, name: '检查点' },
    note: 'SIM-1 可重建状态检查点；hash 异常时从初始状态与追加事件恢复' },

  // ───────────────────── NS-4 时序事实账本 ─────────────────────
  // 导出/导入：全部分类型 FK + 三个章节引用 + 自引用 supersedesFactId 都做 exportRemap，
  //   未映射（引用的实体/章已不在导出内）默认置 null，事实不丢、引用不悬空。
  // 项目级删除：owner:'project' 自动覆盖。
  // 单独删除/合并：角色删除/合并由 character-references.ts 统一重映射；章节删除由 chapter store
  //   调 fact-ledger/lifecycle.ts 清 source/valid chapter FK 并降级待复核。绝不自动改写相邻时序。
  { table: db.temporalFacts, name: 'temporalFacts', owner: 'project', worldScoped: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportable: true, exportIdField: true,
    defaults: { status: 'candidate', locked: false },
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_wgExportId' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_charExportId' },
      { field: 'locationId', remapVia: 'importantLocations', exportAs: '_locExportId' },
      { field: 'storyArcId', remapVia: 'storyArcs', exportAs: '_arcExportId' },
      { field: 'subjectWorldGroupId', remapVia: 'worldGroups', exportAs: '_subjWgExportId' },
      { field: 'codexEntryId', remapVia: 'codexEntries', exportAs: '_codexExportId' },
      { field: 'objectCharacterId', remapVia: 'characters', exportAs: '_objCharExportId' },
      { field: 'objectLocationId', remapVia: 'importantLocations', exportAs: '_objLocExportId' },
      { field: 'objectCodexEntryId', remapVia: 'codexEntries', exportAs: '_objCodexExportId' },
      { field: 'sourceChapterId', remapVia: 'chapters', exportAs: '_srcChapExportId' },
      { field: 'sourceWorldviewId', remapVia: 'worldviews', exportAs: '_srcWorldviewExportId' },
      { field: 'sourcePowerSystemId', remapVia: 'powerSystems', exportAs: '_srcPowerSystemExportId' },
      { field: 'sourceCultivationSystemId', remapVia: 'cultivationSystems', exportAs: '_srcCultivationSystemExportId' },
      { field: 'sourceStoryCoreId', remapVia: 'storyCores', exportAs: '_srcStoryCoreExportId' },
      { field: 'sourceCharacterId', remapVia: 'characters', exportAs: '_srcCharacterExportId' },
      { field: 'validFromChapterId', remapVia: 'chapters', exportAs: '_vFromChapExportId' },
      { field: 'validToChapterId', remapVia: 'chapters', exportAs: '_vToChapExportId' },
      { field: 'supersedesFactId', remapVia: 'temporalFacts', selfTree: true, exportAs: '_supersedesExportId' },
    ],
    note: 'NS-4 时序事实；candidate=observation/confirmed=canon；stale/source-missing/invalid-range 进入异常审核；时序只存 chapterId 不缓存 order' },

  // ───────────────────── CONSISTENCY-2 角色认知事件账本 ─────────────────────
  // 角色认知与世界真相分表；事件只追加，章节时点投影实时计算。
  // 角色/章节删除由 knowledge-ledger/lifecycle.ts 保留记录并降级复核；
  // 项目/世界生命周期与导出导入由本注册表派生。
  { table: db.knowledgeLedger, name: 'knowledgeLedger', owner: 'project', worldScoped: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportable: true,
    defaults: { status: 'candidate' },
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_wgExportId' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId' },
      { field: 'factId', remapVia: 'temporalFacts', exportAs: '_factExportId' },
      { field: 'sourceChapterId', remapVia: 'chapters', exportAs: '_sourceChapterExportId' },
    ],
    note: 'CONSISTENCY-2 认知事件；角色知道/误认/遗忘/纠正与世界 Canon 分离，时点按规范章序实时投影' },

  // ───────────────────── NS-5 检索块（可重建派生缓存） ─────────────────────
  // exportable:false —— 从章节正文切块而来、含大体积向量，是可重建缓存，不进 JSON 备份；
  // 导入后由 chapter 正文重建。项目级删除由 owner 覆盖；删章/改章触发该章块重建（在 chunk 写入层处理）。
  { table: db.retrievalChunks, name: 'retrievalChunks', owner: 'project', worldScoped: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportable: false,
    note: 'NS-5 检索块·可重建派生缓存(关键词+可选 embedding)，不导出，导入后从正文重建' },

  // ───────────────────── NS-5 层级叙事摘要树（可重建派生缓存） ─────────────────────
  // exportable:false —— 从章节正文/已验证章节记忆/大纲 roll-up 得出，可按需重建；
  // 用于章→卷→全书的远距离叙事骨架，不替代事实账本，也不作为 Canon。
  { table: db.narrativeSummaryNodes, name: 'narrativeSummaryNodes', owner: 'project', worldScoped: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportable: false,
    note: 'NS-5 章→卷→全书层级摘要树·可重建派生缓存；四态 pending/rebuilding/verified/stale' },

  // ───────────────────── 多世界 ─────────────────────
  { table: db.worldGroups, name: 'worldGroups', owner: 'project', exportable: true, communityShare: 'world', releaseSection: 'foundation',
    domainOwner: LEGACY_WORLD_OWNER,
    worldDomains: ['structure'],
    exportIdField: true, exportOrderBy: 'order',
    note: '导出用 _exportId(导出序)重映射;按 order 排序保证序稳定' },

  { table: db.worldGroupLinks, name: 'worldGroupLinks', owner: 'project', exportable: true, communityShare: 'world', releaseSection: 'foundation',
    domainOwner: LEGACY_WORLD_OWNER,
    worldDomains: ['structure'],
    exportRemap: [
      { field: 'fromGroupId', remapVia: 'worldGroups', exportAs: '_fromGroupExportId', onUnmapped: 'require' },
      { field: 'toGroupId', remapVia: 'worldGroups', exportAs: '_toGroupExportId', onUnmapped: 'require' },
    ] },

  // ───────────────────── 参考书 / 作品分析 ─────────────────────
  { table: db.references, name: 'references', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'referenceAnalysisRuns[referenceId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'referenceChunkAnalysis[referenceId]', onDelete: 'cascade' },
    ] },

  { table: db.referenceAnalysisRuns, name: 'referenceAnalysisRuns', owner: 'project',
    domainOwner: LEGACY_WORK_OWNER,
    exportable: true, exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'referenceChunkAnalysis[analysisRunId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'referenceAnalysisSources[analysisRunId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'referenceId', remapVia: 'references', exportAs: '_referenceExportId', onUnmapped: 'require' },
    ],
    defaults: {
      sourceKind: 'unknown',
      usageScope: 'analysis-only',
      rightsNote: '',
      rightsConfirmed: false,
      expectedChunks: 0,
      completedChunks: 0,
      progress: 0,
    },
    note: 'IDEA-1 版本化分析；仅 active run 可进入 AI 上下文，来源声明绑定文件哈希' },

  { table: db.referenceChunkAnalysis, name: 'referenceChunkAnalysis', owner: 'direct-child',
    domainOwner: LEGACY_WORK_OWNER,
    exportable: true,
    projectResolver: async (projectId) =>
      (await db.references.where('projectId').equals(projectId).primaryKeys()) as number[],
    refs: [{ kind: 'indirect', via: { table: 'references', field: 'referenceId', resolveProject: 'projectId' }, onDelete: 'cascade' }],
    exportRemap: [
      { field: 'referenceId', remapVia: 'references', exportAs: '_referenceExportId', onUnmapped: 'require' },
      { field: 'analysisRunId', remapVia: 'referenceAnalysisRuns', exportAs: '_analysisRunExportId' },
    ] },

  { table: db.referenceAnalysisSources, name: 'referenceAnalysisSources', owner: 'indirect',
    domainOwner: LEGACY_WORK_OWNER,
    exportable: false,
    projectResolver: async (projectId) =>
      (await db.referenceAnalysisRuns.where('projectId').equals(projectId).primaryKeys()) as number[],
    refs: [{
      kind: 'indirect',
      via: { table: 'referenceAnalysisRuns', field: 'analysisRunId', resolveProject: 'projectId' },
      onDelete: 'cascade',
    }],
    note: 'IDEA-1 本地断点续跑原文；不进 JSON 备份，报告与来源哈希仍可便携往返' },

  // ───────────────────── 临时态 / blob ─────────────────────
  { table: db.importSessions, name: 'importSessions', owner: 'transient', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER },

  { table: db.importJobs, name: 'importJobs', owner: 'transient', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    note: '直接 projectId' },

  { table: db.importLogs, name: 'importLogs', owner: 'indirect', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    projectResolver: async (projectId) =>
      (await db.importSessions.where('projectId').equals(projectId).primaryKeys()) as number[],
    refs: [{ kind: 'indirect', via: { table: 'importSessions', field: 'sessionId', resolveProject: 'projectId' }, onDelete: 'cascade' }] },

  { table: db.importFiles, name: 'importFiles', owner: 'blob', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    note: '主键=sessionId;导入原文 blob 复用 importSessions.id' },

  // ───────────────────── 全局 / 本地态 ─────────────────────
  { table: db.snapshots, name: 'snapshots', owner: 'project', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    note: '本地版本历史;不导出(避免循环嵌套)' },

  { table: db.promptTemplates, name: 'promptTemplates', owner: 'global', exportable: false,
    note: '全局 scope=system|user' },

  { table: db.promptWorkflows, name: 'promptWorkflows', owner: 'global', exportable: false },

  { table: db.aiUsageLog, name: 'aiUsageLog', owner: 'project', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    note: '消耗统计;projectId 可空;体积大不导出' },
]

/** 按表名快速查找 */
export const REGISTRY_BY_NAME: ReadonlyMap<string, TableSpec> = new Map(
  PROJECT_TABLES.map(s => [s.name, s] as const),
)
