/**
 * PROJECT_TABLES 注册表(Phase 1.1a)· 单一事实源
 *
 * 全部项目 Dexie 表的元信息登记在此。
 * 导出/导入/删项目/删世界组/迁移多世界 全部从这里派生(见 lifecycle.ts)。
 *
 * ⚠️ 加新表 = 在此加一行 + schema.ts 加版本 + types 加类型。其它生命周期自动覆盖。
 *
 * 当前事实来源:本注册表 + schema.ts + ensure-schema.ts，三者由 CI 双向校验。
 * 历史手写表清单已归档，禁止恢复为第二事实源。
 * 治理依据:docs/DATA-GOVERNANCE.md。
 */
import { db } from '../db/schema'
import type { DomainOwnershipSpec, TableSpec, WorkspaceMemoryClassificationV1 } from './types'

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

const RESOURCE_IDENTITY = (
  resourceKind: string,
  contextKind: NonNullable<TableSpec['resourceIdentity']>['contextKind'],
  label: string,
  descriptorMode: NonNullable<TableSpec['resourceIdentity']>['descriptorMode'] = 'semantic-fields',
) => ({
  version: 1 as const,
  field: 'ragDocumentId' as const,
  resourceKind,
  contextKind,
  label,
  descriptorMode,
})

type ProjectTableRegistration = Omit<TableSpec, 'memoryClassification'> & {
  memoryClassification?: WorkspaceMemoryClassificationV1
}

const PROJECT_TABLE_REGISTRATIONS: ProjectTableRegistration[] = [
  // ───────────────────────── 项目根表 ─────────────────────────
  { table: db.projects, name: 'projects', owner: 'project', exportable: true,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    workspaceProjection: {
      version: 1, classification: 'editable', documentKind: 'workspace', mapper: 'workspace-root-v1',
      codec: 'json', editPolicy: 'author-editable', scopeOwner: 'workspace',
      dependencyEmitter: 'workspace-root-impact-v1', schemaVersion: 1,
    },
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
    workspaceProjection: {
      version: 1, classification: 'editable', documentKind: 'world', mapper: 'world-root-v1',
      codec: 'yaml', editPolicy: 'author-editable', scopeOwner: 'world',
      dependencyEmitter: 'world-root-impact-v1', schemaVersion: 1,
    },
    refs: [
      { kind: 'simple', field: 'id', target: 'works[worldId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'worldRevisions[worldId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'worldReleases[worldId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'worldDerivations[worldId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'worldReleaseMigrations[worldId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'gameDefinitions[worldId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'gameReleases[worldId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'simulationSessions[worldId]', onDelete: 'cascade' },
    ],
    note: 'WORLD-2C 显式世界根；公开身份和世界版本的未来权威' },

  { table: db.works, name: 'works', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world'], legacyDefault: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    workspaceProjection: {
      version: 1, classification: 'editable', documentKind: 'work', mapper: 'work-root-v1',
      codec: 'yaml', editPolicy: 'author-editable', scopeOwner: 'work',
      dependencyEmitter: 'work-root-impact-v1', schemaVersion: 1,
    },
    refs: [
      { kind: 'simple', field: 'id', target: 'workCharacterBindings[workId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'gameDefinitions[workId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'gameReleases[workId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'simulationSessions[workId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentRuns[workId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'adaptationProjects[workId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'adaptationProjects[sourceWorkId]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'activeCharacterDrivenPlanId', remapVia: 'characterDrivenPlans',
        exportAs: '_activeCharacterDrivenPlanExportId' },
      { field: 'activeNarrativeModuleId', remapVia: 'narrativeModules',
        exportAs: '_activeNarrativeModuleExportId' },
    ],
    note: 'WORLD-2C 显式作品根；同一 World 可包含多部隔离作品' },

  { table: db.adaptationProjects, name: 'adaptationProjects', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    refs: [
      { kind: 'simple', field: 'id', target: 'adaptationSourceUnits[adaptationProjectId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'screenplayScenes[adaptationProjectId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'comicPages[adaptationProjectId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'comicVisualSubjects[adaptationProjectId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'comicMediaAssets[adaptationProjectId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'sourceWorkId', remapVia: 'works', exportAs: '_sourceWorkExportId' },
      { field: 'sourceOutlineRootId', remapVia: 'outlineNodes', exportAs: '_sourceOutlineRootExportId' },
      { field: 'sourceStartChapterId', remapVia: 'chapters', exportAs: '_sourceStartChapterExportId' },
      { field: 'sourceEndChapterId', remapVia: 'chapters', exportAs: '_sourceEndChapterExportId' },
    ],
    defaults: {
      lineageMode: 'linked', status: 'source-frozen', sourceCoverage: 'outline-only',
      brief: null, plan: null, activeSourceManifestVersion: 1,
      briefSourceManifestVersion: null, planSourceManifestVersion: null,
      visualBibleSourceManifestVersion: null, revision: 1,
    },
    note: 'ADAPT-CORE-1 改编公共根；唯一目标 Work 授权跨 Work 来源读取，Brief/Plan 为原生结构化对象' },

  { table: db.adaptationSourceUnits, name: 'adaptationSourceUnits', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'parent', owner: 'work', table: 'adaptationProjects', field: 'adaptationProjectId' } },
    exportRemap: [
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'adaptationProjectId', remapVia: 'adaptationProjects', exportAs: '_adaptationProjectExportId', onUnmapped: 'require' },
      { field: 'sourceOutlineNodeId', remapVia: 'outlineNodes', exportAs: '_sourceOutlineExportId' },
      { field: 'sourceChapterId', remapVia: 'chapters', exportAs: '_sourceChapterExportId' },
    ],
    defaults: { summary: '', wordCount: 0, sourceUpdatedAt: null },
    note: 'ADAPT-CORE-1 追加式不可变来源清单；不复制全文，稳定 key 和 hash 跨备份保留' },

  { table: db.screenplayScenes, name: 'screenplayScenes', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    refs: [
      { kind: 'array', field: 'sourceUnitIds', itemTarget: 'adaptationSourceUnits', onDelete: 'removeItem' },
      { kind: 'json', field: 'blocks', jsonPath: '$[].characterId', target: 'characters[id]', onDelete: 'remap' },
    ],
    exportRemap: [
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'adaptationProjectId', remapVia: 'adaptationProjects', exportAs: '_adaptationProjectExportId', onUnmapped: 'require' },
    ],
    exportRefRemap: [
      { field: 'sourceUnitIds', remapVia: 'adaptationSourceUnits', kind: 'id-array', exportAs: '_sourceUnitExportIds' },
      { field: 'blocks', remapVia: 'characters', kind: 'object-array-id', exportAs: '_blockCharacterExportIds', itemField: 'characterId' },
    ],
    defaults: { summary: '', sourceUnitIds: [], blocks: [], status: 'card', revision: 1 },
    note: 'SCREEN-1 结构化正规剧本场景；块级角色和不可变来源证据统一重映射' },

  { table: db.comicPages, name: 'comicPages', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    refs: [{ kind: 'simple', field: 'id', target: 'comicPanels[pageId]', onDelete: 'cascade' }],
    exportRemap: [
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'adaptationProjectId', remapVia: 'adaptationProjects', exportAs: '_adaptationProjectExportId', onUnmapped: 'require' },
    ],
    defaults: { allowPanelOverlap: false, summary: '', status: 'planned', revision: 1 },
    note: 'COMIC-1 页级节奏与布局根；页面尺寸只取 AdaptationProject targetSpec' },

  { table: db.comicPanels, name: 'comicPanels', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    refs: [
      { kind: 'array', field: 'sourceUnitIds', itemTarget: 'adaptationSourceUnits', onDelete: 'removeItem' },
      { kind: 'simple', field: 'id', target: 'comicMediaAssets[panelId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'pageId', remapVia: 'comicPages', exportAs: '_pageExportId', onUnmapped: 'require' },
    ],
    exportRefRemap: [{ field: 'sourceUnitIds', remapVia: 'adaptationSourceUnits', kind: 'id-array', exportAs: '_sourceUnitExportIds' }],
    defaults: { sourceUnitIds: [], continuityRefs: [], lettering: [], selectedMediaAssetKey: null, status: 'draft', revision: 1 },
    note: 'COMIC-1 可编辑格、镜头、排字与来源证据；媒体选择使用稳定字符串 key' },

  { table: db.comicVisualSubjects, name: 'comicVisualSubjects', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    refs: [
      { kind: 'array', field: 'sourceUnitIds', itemTarget: 'adaptationSourceUnits', onDelete: 'removeItem' },
    ],
    exportRemap: [
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'adaptationProjectId', remapVia: 'adaptationProjects', exportAs: '_adaptationProjectExportId', onUnmapped: 'require' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId' },
    ],
    exportRefRemap: [{ field: 'sourceUnitIds', remapVia: 'adaptationSourceUnits', kind: 'id-array', exportAs: '_sourceUnitExportIds' }],
    defaults: { characterId: null, locationRefKey: null, sourceUnitIds: [], selectedMediaAssetKey: null, status: 'draft', revision: 1 },
    note: 'COMIC-1 角色/地点/道具/风格视觉条目唯一真相；外部实体删除后保留设计快照' },

  { table: db.comicMediaAssets, name: 'comicMediaAssets', owner: 'project', exportable: true, exportIdField: true,
    mediaRef: { blobTable: 'mediaBlobObjects', field: 'blobObjectId' },
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    exportRemap: [
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'adaptationProjectId', remapVia: 'adaptationProjects', exportAs: '_adaptationProjectExportId', onUnmapped: 'require' },
      { field: 'panelId', remapVia: 'comicPanels', exportAs: '_panelExportId' },
      { field: 'blobObjectId', remapVia: 'mediaBlobObjects', exportAs: '_blobObjectExportId', onUnmapped: 'require' },
    ],
    defaults: { panelId: null, subjectKey: null, requestHash: null, promptHash: null, referenceAssetKeys: [], providerReceipt: null, disposition: 'available' },
    note: 'COMIC-2 媒体候选元数据、rights 与 provider receipt；选择状态只存在于 Panel/VisualSubject' },

  { table: db.mediaBlobObjects, name: 'mediaBlobObjects', owner: 'project', exportable: true, exportIdField: true,
    portableData: {
      kind: 'shared-media-object',
      dataField: 'data', hashField: 'contentHash', sizeField: 'byteSize', mimeField: 'mimeType',
      backendField: 'backend', stateField: 'storageState', pathField: 'opfsPath',
      leaseOwnerField: 'leaseOwner', leaseExpiresAtField: 'leaseExpiresAt', lastVerifiedAtField: 'lastVerifiedAt',
    },
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    refs: [
      { kind: 'simple', field: 'id', target: 'comicMediaAssets[blobObjectId]', onDelete: 'keep' },
      { kind: 'simple', field: 'id', target: 'gameBuildArtifacts[blobObjectId]', onDelete: 'keep' },
      { kind: 'simple', field: 'id', target: 'avgMediaBlobs[blobObjectId]', onDelete: 'keep' },
      { kind: 'simple', field: 'id', target: 'ttrpgProductionMediaAssets[blobObjectId]', onDelete: 'keep' },
      { kind: 'simple', field: 'id', target: 'characterInteractionMediaAssets[blobObjectId]', onDelete: 'keep' },
    ],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
    ],
    memoryClassification: {
      version: 1, classification: 'derived-none', mirrorPolicy: 'rebuild-or-local-only',
      reason: '共享二进制随 recovery capsule 便携，但不镜像成可编辑工作区文档。',
    },
    defaults: {
      backend: 'indexeddb', storageState: 'pending-write', data: null, opfsPath: null,
      leaseOwner: null, leaseExpiresAt: null, lastVerifiedAt: null,
      disposition: 'available', deleteRequestedAt: null, deleteReceiptHash: null,
    },
    note: 'MEDIA-CORE/GAMEPROD 产品中立、Work-owned 内容寻址媒资；物理删除只允许引用感知 GC' },

  { table: db.workCharacterBindings, name: 'workCharacterBindings', owner: 'project', exportable: true,
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'characters',
    resourceIdentity: RESOURCE_IDENTITY('work-character-binding', 'character', '作品角色身份与弧光'),
    worldSemantic: { version: 1, area: 'characters', resourceKind: 'work-character-binding', canonPolicy: 'authoritative-table' },
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    exportRemap: [
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId', onUnmapped: 'require' },
    ],
    note: '角色身份保持世界级；本表只保存作品内角色作用投影' },

  { table: db.ownershipMigrations, name: 'ownershipMigrations', owner: 'transient', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    note: 'WORLD-2C ownership 来源、惰性迁移 before-image 与作用域变更审计，不保存手稿正文' },

  { table: db.workspaceDocuments, name: 'workspaceDocuments', owner: 'project', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    refs: [
      { kind: 'simple', field: 'lastSyncRunId', target: 'agentRuns[id]', onDelete: 'setNull' },
    ],
    note: 'MEMORY-1 文件文档绑定与三方基线；不复制领域正文，可从正式表与磁盘 manifest 重建' },

  { table: db.worldRevisions, name: 'worldRevisions', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world'], legacyDefault: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    tree: { parentField: 'parentRevisionId' },
    refs: [{ kind: 'simple', field: 'id', target: 'worldReleases[revisionId]', onDelete: 'keep' }],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'parentRevisionId', remapVia: 'worldRevisions', selfTree: true, exportAs: '_parentExportId' },
    ],
    note: 'WORLD-2E 可比较的世界草稿修订；manifest 为冻结快照' },

  { table: db.worldReleases, name: 'worldReleases', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world'], legacyDefault: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    refs: [{ kind: 'simple', field: 'id', target: 'gameReleases[worldReleaseId]', onDelete: 'cascade' }],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'revisionId', remapVia: 'worldRevisions', exportAs: '_revisionExportId', onUnmapped: 'require' },
    ],
    note: 'WORLD-2E 不可变发布版本；运行实例只绑定该记录或显式草稿快照' },

  { table: db.worldDerivations, name: 'worldDerivations', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world'], legacyDefault: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'targetRevisionId', remapVia: 'worldRevisions', exportAs: '_targetRevisionExportId' },
      { field: 'targetReleaseId', remapVia: 'worldReleases', exportAs: '_targetReleaseExportId' },
    ],
    defaults: { targetRevisionId: null, targetReleaseId: null },
    note: 'ARCH-01 长篇/短篇显式派生世界的不可变来源、范围与 hash；源作品只以便携身份引用' },

  { table: db.worldReleaseMigrations, name: 'worldReleaseMigrations', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world'], legacyDefault: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'semanticReleaseId', remapVia: 'worldReleases', exportAs: '_semanticReleaseExportId', onUnmapped: 'require' },
    ],
    defaults: { productRecoveryWorkspaceUid: null, productRecoveryContentHash: null },
    note: 'ARCH-02 旧混合世界包拆分后的语义发布与独立产品恢复工作区凭证；跨 owner 只保存便携身份' },

  // ───────────────────── 世界观/设定(world-scoped 多)─────────────────────
  { table: db.worldviews, name: 'worldviews', owner: 'project', worldScoped: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    resourceIdentity: RESOURCE_IDENTITY('worldview', 'worldview-field', '世界观', 'registered-fields'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'worldview', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },

  { table: db.storyCores, name: 'storyCores', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('story-core', 'story-core-field', '故事核心', 'registered-fields'),
    worldSemantic: { version: 1, area: 'story', resourceKind: 'story-core', canonPolicy: 'authoritative-table' },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    domainOwner: LEGACY_WORK_OWNER,
    workspaceProjection: {
      version: 1, classification: 'editable', documentKind: 'story-core', mapper: 'work-semantic-v1',
      codec: 'yaml', editPolicy: 'author-editable', scopeOwner: 'work',
      dependencyEmitter: 'work-semantic-impact-v1', schemaVersion: 1,
    },
    refs: [
      { kind: 'simple', field: 'id', target: 'storyArcs[sourceStoryCoreId]', onDelete: 'setNull' },
    ],
    note: '每个 Work 一份故事核心；旧 project/world 兼容行在所有权迁移时归入明确 Work' },

  { table: db.powerSystems, name: 'powerSystems', owner: 'project', worldScoped: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    resourceIdentity: RESOURCE_IDENTITY('power-system', 'worldview-field', '力量体系'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'power-system', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true,
    refs: [{ kind: 'simple', field: 'id', target: 'characters[powerSystemId]', onDelete: 'setNull' }],
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },

  { table: db.cultivationSystems, name: 'cultivationSystems', owner: 'project', worldScoped: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    resourceIdentity: RESOURCE_IDENTITY('cultivation-system', 'worldview-field', '修炼体系'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'cultivation-system', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
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
    resourceIdentity: RESOURCE_IDENTITY('cultivation-progress', 'fact', '修炼进度'),
    worldSemantic: { version: 1, area: 'story', resourceKind: 'cultivation-progress', canonPolicy: 'confirmed-rows-only', statusField: 'status', confirmedStatusValues: ['confirmed'] },
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

  { table: db.geographies, name: 'geographies', owner: 'project', worldScoped: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    resourceIdentity: RESOURCE_IDENTITY('geography', 'worldview-field', '地理环境'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'geography', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },

  { table: db.histories, name: 'histories', owner: 'project', worldScoped: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    resourceIdentity: RESOURCE_IDENTITY('history', 'worldview-field', '历史'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'history', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },

  { table: db.worldNodes, name: 'worldNodes', owner: 'project', worldScoped: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    resourceIdentity: RESOURCE_IDENTITY('world-node', 'location', '世界节点'),
    worldSemantic: { version: 1, area: 'entities', resourceKind: 'world-node', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
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
    resourceIdentity: RESOURCE_IDENTITY('historical-event', 'fact', '历史事件'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'historical-event', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    worldScoped: true, exportable: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },

  { table: db.historicalKeywords, name: 'historicalKeywords', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('historical-keyword', 'fact', '历史关键词'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'historical-keyword', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    worldScoped: true, exportable: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },

  { table: db.importantLocations, name: 'importantLocations', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('location', 'location', '重要地点'),
    worldSemantic: { version: 1, area: 'entities', resourceKind: 'location', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation', tree: { parentField: 'parentId' }, exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'codexEntries[importantLocationId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'characters[importantLocationId]', onDelete: 'setNull' },
    ],
    exportRemap: [{ field: 'parentId', remapVia: 'importantLocations', selfTree: true, exportAs: '_parentExportId' }],
    note: '⚠️ 无 worldGroupId,当前全局注入写作上下文；城池词条可通过 importantLocationId 建立软引用' },

  { table: db.worldRulesProfiles, name: 'worldRulesProfiles', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('world-rules', 'worldview-field', '世界规则'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'world-rules', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    worldScoped: true, exportable: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }],
    note: '真实与幻想规则每世界一套;null 为单世界/默认主世界' },

  // ───────────────────── 角色 ─────────────────────
  { table: db.characters, name: 'characters', owner: 'project', homeWorldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('character', 'character', '角色', 'registered-fields'),
    worldSemantic: { version: 1, area: 'characters', resourceKind: 'character', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'characters',
    defaults: { narrativeStatus: 'active' },
    refs: [
      // 删角色 → 关系级联删 + 细纲数组引用清理
      { kind: 'simple', field: 'id', target: 'characterRelations[fromCharacterId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'characterRelations[toCharacterId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'chapters[perspectiveCharacterId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'narrativeBeats[speakerCharacterId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'interactionCharacterProfiles[characterId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'comicVisualSubjects[characterId]', onDelete: 'setNull' },
      { kind: 'array', field: 'appearingCharacterIds', itemTarget: 'detailedOutlines', onDelete: 'removeItem' },
    ],
    exportRemap: [
      { field: 'homeWorldGroupId', remapVia: 'worldGroups', exportAs: '_homeWorldGroupExportId' },
      { field: 'raceEntryId', remapVia: 'codexEntries', exportAs: '_raceEntryExportId' },
      { field: 'cultivationSystemId', remapVia: 'cultivationSystems', exportAs: '_cultivationSystemExportId' },
      { field: 'powerSystemId', remapVia: 'powerSystems', exportAs: '_powerSystemExportId' },
      { field: 'importantLocationId', remapVia: 'importantLocations', exportAs: '_importantLocationExportId' },
      { field: 'statusEvidenceChapterId', remapVia: 'chapters', exportAs: '_statusEvidenceChapterExportId', deferred: true },
      { field: 'statusEvidenceStoryArcId', remapVia: 'storyArcs', exportAs: '_statusEvidenceStoryArcExportId', deferred: true },
    ] },

  { table: db.characterRelations, name: 'characterRelations', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('character-relation', 'character-relation', '角色关系'),
    worldSemantic: { version: 1, area: 'relations', resourceKind: 'character-relation', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'characters',
    exportRemap: [
      { field: 'fromCharacterId', remapVia: 'characters', exportAs: '_fromCharacterIndex', onUnmapped: 'drop' },
      { field: 'toCharacterId', remapVia: 'characters', exportAs: '_toCharacterIndex', onUnmapped: 'drop' },
    ] },

  // (factions 表已于 DB v29 并入 codex.faction 词条并删除)

  // ───────────────────── 大纲 / 章节 / 细纲 ─────────────────────
  { table: db.outlineNodes, name: 'outlineNodes', owner: 'project', worldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('outline-node', 'outline-node', '大纲节点'),
    worldSemantic: { version: 1, area: 'outline', resourceKind: 'outline-node', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OR_WORK_OWNER,
    exportable: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'outline', tree: { parentField: 'parentId' }, exportIdField: true,
    // summary 是非可选字段,但老数据/跨版本导入的 JSON 可能整体缺该键 → 导入兜成 ''，
    // 保证 OutlineNode.summary 不变量(恒为 string),读取处无需散补 `?.`。
    defaults: { summary: '' },
    refs: [
      { kind: 'simple', field: 'id', target: 'chapters[outlineNodeId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'detailedOutlines[outlineNodeId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'adaptationProjects[sourceOutlineRootId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'adaptationSourceUnits[sourceOutlineNodeId]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'parentId', remapVia: 'outlineNodes', selfTree: true, exportAs: '_parentExportId' },
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ] },

  { table: db.chapters, name: 'chapters', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('chapter', 'chapter', '章节'),
    worldSemantic: { version: 1, area: 'manuscript', resourceKind: 'chapter', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORK_OWNER,
    workspaceProjection: {
      version: 1, classification: 'editable', documentKind: 'chapter', mapper: 'chapter-markdown-v1',
      codec: 'markdown-frontmatter', editPolicy: 'author-editable', scopeOwner: 'work',
      dependencyEmitter: 'chapter-impact-v1', schemaVersion: 1,
    },
    selfIdPaths: ['continuityHandoff.chapterId', 'planReconciliation.chapterId'],
    refs: [
      { kind: 'simple', field: 'id', target: 'emotionBeatCards[chapterId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'characters[statusEvidenceChapterId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'adaptationProjects[sourceStartChapterId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'adaptationProjects[sourceEndChapterId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'adaptationSourceUnits[sourceChapterId]', onDelete: 'setNull' },
      // 软引用:itemLedger/storyTimelineEvents 的 chapterId 保留(独立产物,见 chapter store 注释)
    ],
    exportRemap: [
      { field: 'outlineNodeId', remapVia: 'outlineNodes', exportAs: '_outlineExportId', onUnmapped: 'require' },
      { field: 'perspectiveCharacterId', remapVia: 'characters', exportAs: '_perspectiveCharacterExportId' },
    ] },

  { table: db.detailedOutlines, name: 'detailedOutlines', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('detailed-outline', 'detailed-outline', '细纲'),
    worldSemantic: { version: 1, area: 'detailed-outline', resourceKind: 'detailed-outline', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OR_WORK_OWNER,
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'outline',
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
    resourceIdentity: RESOURCE_IDENTITY('emotion-beat', 'fact', '情感节拍'),
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [{ field: 'chapterId', remapVia: 'chapters', exportAs: '_chapterExportId', onUnmapped: 'require' }] },

  // ───────────────────── 下游产物 / 工具 ─────────────────────
  { table: db.foreshadows, name: 'foreshadows', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('foreshadow', 'foreshadow', '伏笔'),
    worldSemantic: { version: 1, area: 'story', resourceKind: 'foreshadow', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OR_WORK_OWNER,
    note: '可跨世界;plant/resolveChapterId 为软引用(删章不强删)' },

  { table: db.storyArcs, name: 'storyArcs', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('story-arc', 'story-arc', '故事线'),
    worldSemantic: { version: 1, area: 'storylines', resourceKind: 'story-arc', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OR_WORK_OWNER,
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'storylineProgress[arcId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'storylineCrossings[arcIdA]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'storylineCrossings[arcIdB]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'characters[statusEvidenceStoryArcId]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'sourceStoryCoreId', remapVia: 'storyCores', exportAs: '_sourceStoryCoreExportId' },
      { field: 'producerRunId', remapVia: 'agentRuns', exportAs: '_producerRunExportId' },
    ],
    defaults: { origin: 'manual', status: 'active' } },

  { table: db.narrativeModules, name: 'narrativeModules', owner: 'project', exportable: true, exportIdField: true,
    resourceIdentity: RESOURCE_IDENTITY('narrative-module', 'narrative-blueprint', '叙事蓝图'),
    domainOwner: LEGACY_WORLD_OR_WORK_OWNER,
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    refs: [
      { kind: 'simple', field: 'id', target: 'narrativeNodes[moduleId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'narrativeBeats[moduleId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'narrativeChoices[moduleId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'gameDefinitions[narrativeModuleId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'works[activeNarrativeModuleId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'simulationSessions[narrativeModuleId]', onDelete: 'setNull' },
    ],
    defaults: { description: '', status: 'draft', sourceProjection: 'custom', entryNodeKey: null },
    note: 'WORLD-2D 主线/支线/任务/开局的单一可执行叙事来源' },

  { table: db.narrativeNodes, name: 'narrativeNodes', owner: 'project', exportable: true, exportIdField: true,
    resourceIdentity: RESOURCE_IDENTITY('narrative-node', 'narrative-blueprint', '叙事节点'),
    domainOwner: { allowed: ['world', 'work'], legacyDefault: 'work', locator: { kind: 'parent', owner: 'work', table: 'narrativeModules', field: 'moduleId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    exportRemap: [
      { field: 'moduleId', remapVia: 'narrativeModules', exportAs: '_moduleExportId', onUnmapped: 'require' },
      { field: 'sourceOutlineNodeId', remapVia: 'outlineNodes', exportAs: '_sourceOutlineExportId' },
    ],
    defaults: { summary: '', conditionJson: '{}', effectsJson: '[]', successorKeysJson: '[]', order: 0 },
    note: 'WORLD-2D 条件、选择、效果、后继和结局节点' },

  { table: db.narrativeBeats, name: 'narrativeBeats', owner: 'project', exportable: true, exportIdField: true,
    resourceIdentity: RESOURCE_IDENTITY('narrative-beat', 'narrative-blueprint', '叙事节拍'),
    domainOwner: { allowed: ['world', 'work'], legacyDefault: 'work', locator: { kind: 'parent', owner: 'work', table: 'narrativeModules', field: 'moduleId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    exportRemap: [
      { field: 'moduleId', remapVia: 'narrativeModules', exportAs: '_moduleExportId', onUnmapped: 'require' },
      { field: 'speakerCharacterId', remapVia: 'characters', exportAs: '_speakerCharacterExportId' },
    ],
    defaults: { speakerCharacterId: null, order: 0 },
    note: 'STORYGAME-1A 节点内有序旁白、对话、动作和系统提示；不保存玩家进度' },

  { table: db.narrativeChoices, name: 'narrativeChoices', owner: 'project', exportable: true, exportIdField: true,
    resourceIdentity: RESOURCE_IDENTITY('narrative-choice', 'narrative-blueprint', '叙事选择'),
    domainOwner: { allowed: ['world', 'work'], legacyDefault: 'work', locator: { kind: 'parent', owner: 'work', table: 'narrativeModules', field: 'moduleId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    exportRemap: [
      { field: 'moduleId', remapVia: 'narrativeModules', exportAs: '_moduleExportId', onUnmapped: 'require' },
    ],
    defaults: {
      description: '', unavailableReason: '', displayConditionJson: '{}',
      availableConditionJson: '{}', effectsJson: '[]', tagsJson: '[]', order: 0,
    },
    note: 'STORYGAME-1A 正式内容选择；目标使用节点稳定 key，运行选择由 SIM 事件记录' },

  { table: db.gameDefinitions, name: 'gameDefinitions', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    refs: [
      { kind: 'simple', field: 'id', target: 'gameReleases[gameDefinitionId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'interactionCharacterProfiles[gameDefinitionId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'interactionSceneTemplates[gameDefinitionId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'adventureModules[gameDefinitionId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'avgPresentationModules[gameDefinitionId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'narrativeSimulationModules[gameDefinitionId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'openWorldModules[gameDefinitionId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'narrativeModuleId', remapVia: 'narrativeModules', exportAs: '_narrativeModuleExportId', onUnmapped: 'require' },
    ],
    defaults: {
      productType: 'storygame', description: '', status: 'draft',
      enabledCapabilitiesJson: '["narrative"]', initialVariablesJson: '{}', rulesetVersion: 1,
      sourceWorldContentHash: '', sourceSelectionJson: '', sourceMappingVersion: 0,
    },
    note: '文字游戏产品族统一可编辑定义；产品能力由各专项发布器校验' },

  { table: db.interactionCharacterProfiles, name: 'interactionCharacterProfiles', owner: 'project',
    exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'gameDefinitionId', remapVia: 'gameDefinitions', exportAs: '_gameDefinitionExportId', onUnmapped: 'require' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId', onUnmapped: 'require' },
    ],
    defaults: {
      roleLabel: '', voiceRules: '', initialKnowledgeJson: '[]',
      relationshipDimensionsJson: '[]', maxMemoryEntries: 24, sourceSnapshotJson: '{}',
    },
    note: 'CHATGAME-2 作者配置：发布角色引用、角色视角知识、口吻和关系维度；不保存玩家记忆' },

  { table: db.interactionSceneTemplates, name: 'interactionSceneTemplates', owner: 'project',
    exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'gameDefinitionId', remapVia: 'gameDefinitions', exportAs: '_gameDefinitionExportId', onUnmapped: 'require' },
    ],
    defaults: {
      purpose: '', location: '', timeLabel: '', participantKeysJson: '[]',
      publicKnowledgeKeysJson: '[]', goalsJson: '[]', endingConditionsJson: '[]',
      safetyBoundariesJson: '[]', relationshipRulesJson: '[]', openingNodeKey: null,
      endingNodeKey: null, maxTurns: 20, directorBudget: 1, order: 0,
    },
    note: 'CHATGAME-2 作者场景模板、目标、边界、可回放关系规则和导演预算；固定剧情复用 NarrativeChoice，运行场景由 SIM 事件拥有' },

  { table: db.adventureModules, name: 'adventureModules', owner: 'project',
    exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'gameDefinitionId', remapVia: 'gameDefinitions', exportAs: '_gameDefinitionExportId', onUnmapped: 'require' },
    ],
    defaults: { contentJson: '{"version":1,"initialLocationKey":"","playerKey":"player","locations":[],"objects":[],"items":[],"abilities":[],"conditions":[],"resources":[],"quests":[],"actions":[],"initialInventory":[]}' },
    note: 'TEXTADV-1 作者内容模块；内部引用仅用稳定 key，运行进度由 SIM 事件拥有' },

  { table: db.avgMediaAssets, name: 'avgMediaAssets', owner: 'project',
    exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    refs: [{ kind: 'simple', field: 'id', target: 'avgMediaBlobs[mediaAssetId]', onDelete: 'cascade' }],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
    ],
    defaults: {
      width: null, height: null, durationMs: null, source: '', license: '', altText: '',
      characterTag: '', sceneTag: '',
    },
    note: 'AVG-1 稳定 key + 版本媒资元数据；旧发布冻结实际版本，不跟随草稿替换' },

  { table: db.avgMediaBlobs, name: 'avgMediaBlobs', owner: 'project',
    exportable: true, exportIdField: true,
    portableData: {
      kind: 'binary-blob', field: 'data',
      allowMissingWhen: { exportField: '_blobObjectExportId', importField: 'blobObjectId' },
      integrity: { metadataTable: 'avgMediaAssets', referenceField: 'mediaAssetId', hashField: 'contentHash', sizeField: 'byteSize' },
    },
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'mediaAssetId', remapVia: 'avgMediaAssets', exportAs: '_mediaAssetExportId', onUnmapped: 'require' },
      { field: 'blobObjectId', remapVia: 'mediaBlobObjects', exportAs: '_blobObjectExportId' },
    ],
    defaults: { blobObjectId: null },
    note: 'AVG-1 项目备份携带的本地二进制；库内用 structured-clone-safe ArrayBuffer，导出层编码为便携 data URL' },

  { table: db.avgPresentationModules, name: 'avgPresentationModules', owner: 'project',
    exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'gameDefinitionId', remapVia: 'gameDefinitions', exportAs: '_gameDefinitionExportId', onUnmapped: 'require' },
    ],
    defaults: { contentJson: '{"version":1,"cues":[]}' },
    note: 'AVG-1 声明式演出模块；只控制显示和播放，不拥有剧情规则状态' },

  { table: db.narrativeSimulationModules, name: 'narrativeSimulationModules', owner: 'project',
    exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'gameDefinitionId', remapVia: 'gameDefinitions', exportAs: '_gameDefinitionExportId', onUnmapped: 'require' },
    ],
    defaults: { contentJson: '{"version":1,"turnLimit":30,"actionBudget":1,"resources":[],"metrics":[],"actors":[],"actions":[],"modifiers":[],"issues":[],"endings":[],"themes":[]}' },
    note: 'TEXTSIM-1 作者规则模块；运行投影与长期后果只由共享 SIM 事件拥有' },

  { table: db.openWorldModules, name: 'openWorldModules', owner: 'project',
    exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'narrative',
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'gameDefinitionId', remapVia: 'gameDefinitions', exportAs: '_gameDefinitionExportId', onUnmapped: 'require' },
    ],
    defaults: { contentJson: '{"version":1,"initialRegionKey":"","tickLimit":200,"simulationCadenceTicks":5,"maxPropagationEdgesPerTick":4,"regions":[],"travelEdges":[],"discoveryChannels":[],"fixedTaskCards":[],"taskTemplates":[],"decks":[],"actorSchedules":[],"regionalIssueRules":[],"mainline":{"questKeys":[],"protectedParticipantKeys":[],"protectedEdgeKeys":[],"latestRevealTick":1,"endingNodeKey":""},"director":{"globalMaxRevealed":3,"globalMaxActive":5,"maxQuestInstances":100,"randomJitter":5,"criticalGuaranteeBonus":100,"backlogPenalty":10,"freshnessPenalty":20}}' },
    note: 'TEXTWORLD-1 作者区域、交通、传播与任务导演规则；任务实例和世界演化只由共享 SIM 事件拥有' },

  { table: db.gameReleases, name: 'gameReleases', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    refs: [{ kind: 'simple', field: 'id', target: 'simulationSessions[gameReleaseId]', onDelete: 'setNull' }],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'gameDefinitionId', remapVia: 'gameDefinitions', exportAs: '_gameDefinitionExportId' },
      { field: 'worldReleaseId', remapVia: 'worldReleases', exportAs: '_worldReleaseExportId', onUnmapped: 'require' },
    ],
    note: '文字游戏产品族统一不可变发布；冻结 WorldRelease、叙事及产品模块与内容哈希' },

  { table: db.characterDrivenPlans, name: 'characterDrivenPlans', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('character-driven-plan', 'narrative-blueprint', '角色驱动方案'),
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
      kind: 'object-array-id',
      exportAs: '_arcCharacterIndexes',
      itemField: 'characterId',
      storage: 'json-string',
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
    resourceIdentity: RESOURCE_IDENTITY('storyline-progress', 'storyline-progress', '故事线进度'),
    worldSemantic: { version: 1, area: 'storylines', resourceKind: 'storyline-progress', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORK_OWNER,
    exportable: true,
    defaults: { status: 'dormant', involvedEntities: '[]' },
    exportRemap: [
      { field: 'arcId', remapVia: 'storyArcs', exportAs: '_arcExportId', onUnmapped: 'require' },
      { field: 'lastActiveChapterId', remapVia: 'chapters', exportAs: '_lastChapterExportId' },
    ],
    note: 'Phase 39 已确认的故事线动态投影；每条 StoryArc 至多一行，删章保留标题并 NULL 化引用' },

  { table: db.storylineCrossings, name: 'storylineCrossings', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('storyline-crossing', 'storyline-progress', '故事线交汇'),
    worldSemantic: { version: 1, area: 'storylines', resourceKind: 'storyline-crossing', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORK_OWNER,
    exportable: true,
    exportRemap: [
      { field: 'arcIdA', remapVia: 'storyArcs', exportAs: '_arcAExportId', onUnmapped: 'require' },
      { field: 'arcIdB', remapVia: 'storyArcs', exportAs: '_arcBExportId', onUnmapped: 'require' },
      { field: 'chapterId', remapVia: 'chapters', exportAs: '_chapterExportId' },
    ],
    note: 'Phase 39 已确认的两条登记故事线交汇；删章保留证据与章节标题并 NULL 化引用' },

  { table: db.stateCards, name: 'stateCards', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('state-card', 'fact', '状态卡'),
    worldSemantic: { version: 1, area: 'entities', resourceKind: 'state-card', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORK_OWNER },

  { table: db.itemLedger, name: 'itemLedger', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('item-ledger', 'fact', '物品流水'),
    worldSemantic: { version: 1, area: 'entities', resourceKind: 'item-event', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORK_OWNER,
    defaults: { heldByName: '' },
    refs: [
      { kind: 'simple', field: 'characterId', target: 'characters[id]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'chapterId', remapVia: 'chapters', exportAs: '_chapterExportId' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId' },
    ],
    note: 'chapterId 与 characterId 均为软引用；角色删除时 NULL 化 characterId、保留 heldByName' },

  { table: db.storyTimelineEvents, name: 'storyTimelineEvents', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('story-timeline-event', 'fact', '故事年表'),
    worldSemantic: { version: 1, area: 'story', resourceKind: 'story-timeline-event', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [{ field: 'chapterId', remapVia: 'chapters', exportAs: '_chapterExportId' }] },

  { table: db.notes, name: 'notes', owner: 'project', exportable: true,
    domainOwner: LEGACY_WORK_OWNER },

  { table: db.creativeRules, name: 'creativeRules', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('creative-rules', 'reference', '创作规则'),
    domainOwner: LEGACY_WORK_OWNER,
    workspaceProjection: {
      version: 1, classification: 'editable', documentKind: 'creative-rules', mapper: 'work-semantic-v1',
      codec: 'yaml', editPolicy: 'author-editable', scopeOwner: 'work',
      dependencyEmitter: 'work-semantic-impact-v1', schemaVersion: 1,
    },
    refs: [
      { kind: 'array', field: 'citedReferenceIds', itemTarget: 'references', onDelete: 'removeItem' },
    ],
    exportRefRemap: [
      { field: 'citedReferenceIds', remapVia: 'references', kind: 'id-array', exportAs: '_citedReferenceIndexes', storage: 'json-string' },
    ] },

  // (itemSystems 表已于 DB v29 并入 codex.artifact 词条并删除)

  // ───────────────────── 词条系统 ─────────────────────
  { table: db.codexCategories, name: 'codexCategories', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('codex-category', 'codex-entry', '词条分类'),
    worldSemantic: { version: 1, area: 'entities', resourceKind: 'codex-category', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation', tree: { parentField: 'parentId' }, exportIdField: true,
    refs: [{ kind: 'simple', field: 'id', target: 'codexEntries[categoryId]', onDelete: 'cascade' }],
    exportRemap: [
      { field: 'parentId', remapVia: 'codexCategories', selfTree: true, exportAs: '_parentExportId' },
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ],
    note: '分类 schema 项目级共享；worldGroupId 仅为旧备份兼容字段，不参与世界生命周期' },

  { table: db.codexEntries, name: 'codexEntries', owner: 'project', worldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('codex-entry', 'codex-entry', '设定词条'),
    worldSemantic: { version: 1, area: 'entities', resourceKind: 'codex-entry', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    exportable: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    refs: [
      { kind: 'json', field: 'refs', jsonPath: '$.*', target: 'codexEntries[id]', onDelete: 'remap' },
      { kind: 'simple', field: 'id', target: 'characters[raceEntryId]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'categoryId', remapVia: 'codexCategories', exportAs: '_categoryExportId', onUnmapped: 'require' },
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'cultivationSystemId', remapVia: 'cultivationSystems', exportAs: '_cultivationSystemExportId' },
      { field: 'importantLocationId', remapVia: 'importantLocations', exportAs: '_importantLocationExportId' },
      { field: 'producerRunId', remapVia: 'agentRuns', exportAs: '_producerRunExportId', deferred: true },
    ],
    defaults: {
      origin: 'manual', sourceEvidenceQuotes: '[]', sourceContentHash: '',
      producerRunId: null, producerCandidateHash: null,
    } },

  // ───────────────────── 文风学习（FB-5） ─────────────────────
  { table: db.userStyleProfiles, name: 'userStyleProfiles', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('user-style', 'reference', '作者文风'),
    domainOwner: LEGACY_WORK_OWNER,
    note: '每个 Work 一份作者文风画像；物理 projectId 兼容旧库，逻辑归属由 Work scope 隔离' },

  // ───────────────────── 增量灵感工作区（CM-1） ─────────────────────
  { table: db.inspirationWorkspaces, name: 'inspirationWorkspaces', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('inspiration-workspace', 'reference', '灵感工作区'),
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
      { field: 'durableRunId', remapVia: 'agentRuns', exportAs: '_agentRunExportId' },
    ],
    defaults: { payload: '{}', durableRunId: null },
    note: 'Agent 追加事件流：消息/计划/任务/候选/确认/错误；durableRunId 由 PROJECT_TABLES 统一重映射，未确认候选不属于 Canon' },

  { table: db.agentRuns, name: 'agentRuns', owner: 'project',
    domainOwner: {
      allowed: ['work', 'instance'], legacyDefault: 'work',
      locator: { kind: 'exclusive-work-instance', workField: 'workId', instanceField: 'simulationSessionId' },
    },
    worldScoped: true, exportable: true, exportIdField: true,
    tree: { parentField: 'parentRunId' },
    refs: [
      { kind: 'simple', field: 'id', target: 'agentRuns[parentRunId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentRunEvents[runId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentRunCheckpoints[runId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentEvents[durableRunId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'storyArcs[producerRunId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'codexEntries[producerRunId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'gameBuildId', target: 'gameBuilds[id]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'parentRunId', remapVia: 'agentRuns', selfTree: true, exportAs: '_parentExportId' },
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'conversationId', remapVia: 'agentConversations', exportAs: '_conversationExportId' },
      { field: 'simulationSessionId', remapVia: 'simulationSessions',
        exportAs: '_simulationSessionExportId' },
      { field: 'gameBuildId', remapVia: 'gameBuilds', exportAs: '_gameBuildExportId' },
    ],
    portableData: {
      kind: 'agent-run-root',
      contractField: 'contractJson',
      contractHashField: 'contractHash',
      dependencies: ['worldGroups', 'chapters', 'outlineNodes', 'simulationSessions', 'gameBuilds'],
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
      simulationSessionId: null,
      gameBuildId: null,
    },
    note: 'HARNESS-1/21/RUNTIME-1 durable run 根；Work/Instance owner 恰好二选一，复用严格事件投影与恢复，不保存隐藏推理' },

  { table: db.agentRunEvents, name: 'agentRunEvents', owner: 'project',
    domainOwner: { allowed: ['work', 'instance'], legacyDefault: 'work', locator: { kind: 'parent', owner: 'inherit', table: 'agentRuns', field: 'runId' } },
    worldScoped: true, exportable: true,
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'runId', remapVia: 'agentRuns', exportAs: '_agentRunExportId', onUnmapped: 'require' },
    ],
    portableData: { kind: 'agent-run-child', parentField: 'runId', contractHashField: 'contractHash' },
    defaults: { generation: 1, payloadJson: '{}' },
    note: 'HARNESS-1 严格追加事件；(runId,sequence) 唯一，非法版本/断序/scope 污染 fail-closed' },

  { table: db.agentRunCheckpoints, name: 'agentRunCheckpoints', owner: 'project',
    domainOwner: { allowed: ['work', 'instance'], legacyDefault: 'work', locator: { kind: 'parent', owner: 'inherit', table: 'agentRuns', field: 'runId' } },
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

  { table: db.agentRunArtifacts, name: 'agentRunArtifacts', owner: 'project', exportable: true,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    portableData: { kind: 'exact-run-artifact' },
    defaults: {
      encoding: 'utf-8',
      retentionState: 'available',
      pruneReceiptJson: null,
      pruneReceiptHash: null,
    },
    note: 'CTXG-2 内容寻址 exact Run evidence；Run 引用只存在追加事件中，正文按 project/kind/hash 去重并可留下 prune tombstone' },

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
    tree: { parentField: 'parentSessionId' },
    refs: [
      { kind: 'simple', field: 'id', target: 'simulationSessions[parentSessionId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'simulationEvents[sessionId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'simulationCheckpoints[sessionId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'ttrpgSessionParticipants[sessionId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'ttrpgRuntimeAssetRequests[sessionId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentRuns[simulationSessionId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'parentSessionId', remapVia: 'simulationSessions', selfTree: true,
        exportAs: '_parentSessionExportId' },
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId' },
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId' },
      { field: 'worldReleaseId', remapVia: 'worldReleases', exportAs: '_worldReleaseExportId' },
      { field: 'gameReleaseId', remapVia: 'gameReleases', exportAs: '_gameReleaseExportId' },
      { field: 'gameBuildId', remapVia: 'gameBuilds', exportAs: '_gameBuildExportId' },
      { field: 'ttrpgBuildId', remapVia: 'ttrpgProductionBuilds', exportAs: '_ttrpgBuildExportId' },
      { field: 'narrativeModuleId', remapVia: 'narrativeModules', exportAs: '_narrativeModuleExportId' },
    ],
    defaults: {
      kind: 'sandbox',
      status: 'active',
      rulesetVersion: 1,
      canonSnapshotJson: '{"version":1,"sources":[]}',
      initialStateJson: '{"version":1,"clock":0,"entities":{},"memories":[],"narratives":[],"ttrpg":null,"lastSequence":0}',
      gameReleaseId: null,
      gameBuildId: null,
      ttrpgBuildId: null,
      runtimeSourceHash: null,
    },
    note: 'SIM-1 独立互动世界实例；冻结创作来源，不反写 Canon；分支拥有独立事件流' },

  { table: db.simulationEvents, name: 'simulationEvents', owner: 'project',
    domainOwner: { allowed: ['instance'], legacyDefault: 'instance', locator: { kind: 'parent', owner: 'instance', table: 'simulationSessions', field: 'sessionId' } },
    worldScoped: true, exportable: true,
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'sessionId', remapVia: 'simulationSessions',
        exportAs: '_simulationSessionExportId', onUnmapped: 'require' },
    ],
    defaults: {
      actorKey: null, targetKey: null, commandId: null,
      baseSequence: null, baseStateHash: null, payloadJson: '{}',
    },
    note: 'SIM-1 严格追加事件；(sessionId,sequence) 唯一，状态、骰子、记忆和叙事均从事件回放' },

  { table: db.simulationCheckpoints, name: 'simulationCheckpoints', owner: 'project',
    domainOwner: { allowed: ['instance'], legacyDefault: 'instance', locator: { kind: 'parent', owner: 'instance', table: 'simulationSessions', field: 'sessionId' } },
    worldScoped: true, exportable: true,
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
    resourceIdentity: RESOURCE_IDENTITY('temporal-fact', 'fact', '时序事实'),
    worldSemantic: { version: 1, area: 'story', resourceKind: 'temporal-fact', canonPolicy: 'confirmed-rows-only', statusField: 'status', confirmedStatusValues: ['confirmed'] },
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
    resourceIdentity: RESOURCE_IDENTITY('knowledge-event', 'fact', '角色认知'),
    worldSemantic: { version: 1, area: 'relations', resourceKind: 'knowledge-event', canonPolicy: 'confirmed-rows-only', statusField: 'status', confirmedStatusValues: ['confirmed'] },
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
  { table: db.worldGroups, name: 'worldGroups', owner: 'project', exportable: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    resourceIdentity: RESOURCE_IDENTITY('world-group', 'world', '世界'),
    worldSemantic: { version: 1, area: 'multi-world', resourceKind: 'world-group', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    exportIdField: true, exportOrderBy: 'order',
    note: '导出用 _exportId(导出序)重映射;按 order 排序保证序稳定' },

  { table: db.worldGroupLinks, name: 'worldGroupLinks', owner: 'project', exportable: true, legacyWorldPackageV1: 'world', legacyWorldReleaseSection: 'foundation',
    resourceIdentity: RESOURCE_IDENTITY('world-group-link', 'world-link', '世界通道'),
    worldSemantic: { version: 1, area: 'multi-world', resourceKind: 'world-link', canonPolicy: 'authoritative-table' },
    domainOwner: LEGACY_WORLD_OWNER,
    exportRemap: [
      { field: 'fromGroupId', remapVia: 'worldGroups', exportAs: '_fromGroupExportId', onUnmapped: 'require' },
      { field: 'toGroupId', remapVia: 'worldGroups', exportAs: '_toGroupExportId', onUnmapped: 'require' },
    ],
    defaults: { bidirectional: false },
    note: '方向/双向性由 from/to + bidirectional 表达；进入/离开/力量/带出规则来自两端世界并由 Gateway 聚合。' },

  // ───────────────────── 参考书 / 作品分析 ─────────────────────
  { table: db.references, name: 'references', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('reference', 'reference', '项目参考'),
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

  {
    table: db.gameProductions,
    name: "gameProductions",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    refs: [
      {
        kind: "simple",
        field: "id",
        target: "gameProductionBriefs[productionId]",
        onDelete: "cascade",
      },
      {
        kind: "simple",
        field: "id",
        target: "gameProductionCommands[productionId]",
        onDelete: "cascade",
      },
      {
        kind: "simple",
        field: "id",
        target: "gameBuilds[productionId]",
        onDelete: "cascade",
      },
    ],
    exportRemap: [
      {
        field: "worldId",
        remapVia: "worlds",
        exportAs: "_worldExportId",
        onUnmapped: "require",
      },
      {
        field: "workId",
        remapVia: "works",
        exportAs: "_workExportId",
        onUnmapped: "require",
      },
      {
        field: "currentGameDefinitionId",
        remapVia: "gameDefinitions",
        exportAs: "_currentGameDefinitionExportId",
      },
      {
        field: "currentGameReleaseId",
        remapVia: "gameReleases",
        exportAs: "_currentGameReleaseExportId",
      },
    ],
    memoryClassification: {
      version: 1,
      classification: "editable",
      mirrorPolicy: "editable-document",
      reason: "用户拥有并控制的生产目标与当前指针；只通过命令 CAS 修改。",
    },
    defaults: {
      status: "consulting",
      stateRevision: 0,
      controlEpoch: 0,
      currentBriefRevision: null,
      currentBuildNumber: null,
      currentGameDefinitionId: null,
      currentGameReleaseId: null,
      lastErrorJson: "{}",
    },
    note: "GAMEPROD-1 多轮演化生产根；用户命令是唯一状态转换入口",
  },

  {
    table: db.gameProductionBriefs,
    name: "gameProductionBriefs",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      {
        field: "worldId",
        remapVia: "worlds",
        exportAs: "_worldExportId",
        onUnmapped: "require",
      },
      {
        field: "workId",
        remapVia: "works",
        exportAs: "_workExportId",
        onUnmapped: "require",
      },
      {
        field: "productionId",
        remapVia: "gameProductions",
        exportAs: "_productionExportId",
        onUnmapped: "require",
      },
      {
        field: "sourceWorldReleaseId",
        remapVia: "worldReleases",
        exportAs: "_sourceWorldReleaseExportId",
        onUnmapped: "require",
      },
    ],
    memoryClassification: {
      version: 1,
      classification: "editable",
      mirrorPolicy: "editable-document",
      reason:
        "用户会谈形成的不可变 Brief revision；授权是显式且可审计的用户动作。",
    },
    defaults: {
      parentRevision: null,
      status: "draft",
      unresolvedJson: "[]",
      estimateJson: "{}",
      authorizedAt: null,
    },
    note: "GAMEPROD-1 不可变 Brief 修订与一次性授权边界",
  },

  {
    table: db.gameProductionCommands,
    name: "gameProductionCommands",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      {
        field: "worldId",
        remapVia: "worlds",
        exportAs: "_worldExportId",
        onUnmapped: "require",
      },
      {
        field: "workId",
        remapVia: "works",
        exportAs: "_workExportId",
        onUnmapped: "require",
      },
      {
        field: "productionId",
        remapVia: "gameProductions",
        exportAs: "_productionExportId",
        onUnmapped: "require",
      },
    ],
    defaults: {
      expectedStateRevision: null,
      status: "claimed",
      resultJson: "{}",
      errorCode: null,
      completedAt: null,
    },
    note: "GAMEPROD-1 幂等命令 claim/CAS receipt；不保存密钥或外部原始响应",
  },

  {
    table: db.gameBuilds,
    name: "gameBuilds",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    refs: [
      {
        kind: "simple",
        field: "id",
        target: "gameBuildArtifacts[buildId]",
        onDelete: "cascade",
      },
      {
        kind: "simple",
        field: "id",
        target: "gameQualityGateReceipts[buildId]",
        onDelete: "cascade",
      },
      {
        kind: "simple",
        field: "id",
        target: "agentRuns[gameBuildId]",
        onDelete: "cascade",
      },
      {
        kind: "simple",
        field: "id",
        target: "simulationSessions[gameBuildId]",
        onDelete: "cascade",
      },
    ],
    exportRemap: [
      {
        field: "worldId",
        remapVia: "worlds",
        exportAs: "_worldExportId",
        onUnmapped: "require",
      },
      {
        field: "workId",
        remapVia: "works",
        exportAs: "_workExportId",
        onUnmapped: "require",
      },
      {
        field: "productionId",
        remapVia: "gameProductions",
        exportAs: "_productionExportId",
        onUnmapped: "require",
      },
      {
        field: "sourceGameReleaseId",
        remapVia: "gameReleases",
        exportAs: "_sourceGameReleaseExportId",
      },
      {
        field: "adoptedGameDefinitionId",
        remapVia: "gameDefinitions",
        exportAs: "_adoptedGameDefinitionExportId",
      },
      {
        field: "releasedGameReleaseId",
        remapVia: "gameReleases",
        exportAs: "_releasedGameReleaseExportId",
      },
    ],
    defaults: {
      parentBuildNumber: null,
      sourceGameReleaseId: null,
      status: "draft",
      resumeState: null,
      stateRevision: 0,
      controlEpoch: 0,
      planRevision: 0,
      planJson: "{}",
      planHash: "",
      budgetLedgerJson: "{}",
      manifestJson: "{}",
      manifestHash: "",
      packageHash: "",
      previewManifestJson: "{}",
      previewHash: "",
      qualityReportJson: "{}",
      qualityReportHash: "",
      compatibilityJson: "{}",
      rootTerminalReceiptHash: null,
      adoptionIntentHash: null,
      adoptedGameDefinitionId: null,
      releasedGameReleaseId: null,
      failureJson: "{}",
      startedAt: null,
      completedAt: null,
    },
    note: "GAMEPROD-1 单轮可恢复 Build、计划、预算、集成、QA 与发布证据",
  },

  {
    table: db.gameQualityGateReceipts,
    name: "gameQualityGateReceipts",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      {
        field: "worldId",
        remapVia: "worlds",
        exportAs: "_worldExportId",
        onUnmapped: "require",
      },
      {
        field: "workId",
        remapVia: "works",
        exportAs: "_workExportId",
        onUnmapped: "require",
      },
      {
        field: "buildId",
        remapVia: "gameBuilds",
        exportAs: "_buildExportId",
        onUnmapped: "require",
      },
    ],
    memoryClassification: {
      version: 1,
      classification: "evidence",
      mirrorPolicy: "recovery-evidence",
      reason:
        "Build 质量门的测量环境、阈值、输入 hash 与结果回执；阈值升级追加新证据，不改写旧 Build。",
    },
    note: "GAMEPROD-1I 浏览器性能及后续 verifier 的不可变 Build 质量回执",
  },

  {
    table: db.gameBuildArtifacts,
    name: "gameBuildArtifacts",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      {
        field: "worldId",
        remapVia: "worlds",
        exportAs: "_worldExportId",
        onUnmapped: "require",
      },
      {
        field: "workId",
        remapVia: "works",
        exportAs: "_workExportId",
        onUnmapped: "require",
      },
      {
        field: "buildId",
        remapVia: "gameBuilds",
        exportAs: "_buildExportId",
        onUnmapped: "require",
      },
      {
        field: "producerRunId",
        remapVia: "agentRuns",
        exportAs: "_producerRunExportId",
      },
      {
        field: "blobObjectId",
        remapVia: "mediaBlobObjects",
        exportAs: "_blobObjectExportId",
      },
    ],
    defaults: {
      requirementKey: null,
      status: "pending",
      producerRunId: null,
      producerReceiptHash: null,
      payloadJson: "{}",
      metadataJson: "{}",
      qualityJson: "{}",
      rightsJson: "{}",
      blobObjectId: null,
      mimeType: null,
      byteSize: 0,
      parentArtifactHash: null,
      carriedFrom: null,
    },
    note: "GAMEPROD-1 结构化与二进制候选、验收、继承和来源证据",
  },
  {
    table: db.gameRulePacks,
    name: "gameRulePacks",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    refs: [
      {
        kind: "simple",
        field: "id",
        target: "ttrpgCampaignModules[rulePackId]",
        onDelete: "cascade",
      },
    ],
    exportRemap: [
      {
        field: "worldId",
        remapVia: "worlds",
        exportAs: "_worldExportId",
        onUnmapped: "require",
      },
      {
        field: "workId",
        remapVia: "works",
        exportAs: "_workExportId",
        onUnmapped: "require",
      },
    ],
    memoryClassification: {
      version: 1,
      classification: "editable",
      mirrorPolicy: "recovery-evidence",
      reason:
        "作者可编辑的无脚本 RulePack DSL；完整正文由项目备份恢复，正式 Release 冻结不可变快照。",
    },
    defaults: { status: "draft", rulePackJson: "{}", contentHash: "" },
    note: "TTRPG-2A Work-owned 声明式规则包、许可、版本、夹具和验证 hash；禁止任意脚本",
  },

  {
    table: db.ttrpgCampaignModules,
    name: "ttrpgCampaignModules",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      {
        field: "worldId",
        remapVia: "worlds",
        exportAs: "_worldExportId",
        onUnmapped: "require",
      },
      {
        field: "workId",
        remapVia: "works",
        exportAs: "_workExportId",
        onUnmapped: "require",
      },
      {
        field: "sourceWorldReleaseId",
        remapVia: "worldReleases",
        exportAs: "_sourceWorldReleaseExportId",
        onUnmapped: "require",
      },
      {
        field: "rulePackId",
        remapVia: "gameRulePacks",
        exportAs: "_rulePackExportId",
        onUnmapped: "require",
      },
    ],
    memoryClassification: {
      version: 1,
      classification: "editable",
      mirrorPolicy: "recovery-evidence",
      reason:
        "作者可补全和确认的 CampaignPack；来源与规则 hash 在正式 Release 冻结，运行状态仍归 SIM 事件。",
    },
    defaults: { status: "draft", contentJson: "{}", contentHash: "" },
    note: "TTRPG-2A Work-owned 战役内容模块；角色、场景、线索与讲义首期保持严格整包",
  },

  {
    table: db.ttrpgSessionParticipants,
    name: "ttrpgSessionParticipants",
    owner: "project",
    domainOwner: {
      allowed: ["instance"],
      legacyDefault: "instance",
      locator: {
        kind: "parent",
        owner: "instance",
        table: "simulationSessions",
        field: "sessionId",
      },
    },
    worldScoped: true,
    exportable: true,
    exportRemap: [
      {
        field: "worldGroupId",
        remapVia: "worldGroups",
        exportAs: "_worldGroupExportId",
      },
      {
        field: "worldId",
        remapVia: "worlds",
        exportAs: "_worldExportId",
        onUnmapped: "require",
      },
      {
        field: "workId",
        remapVia: "works",
        exportAs: "_workExportId",
        onUnmapped: "require",
      },
      {
        field: "sessionId",
        remapVia: "simulationSessions",
        exportAs: "_simulationSessionExportId",
        onUnmapped: "require",
      },
    ],
    defaults: {
      assignmentState: "vacant",
      humanAssignmentPolicy: null,
      activation: "manual",
      substitutionPolicy: "never",
      aiProfile: null,
      sessionZeroAcceptedAtSequence: null,
      revision: 1,
      lastCommandId: "imported-v2",
      lastCommandFingerprint: "imported-v2",
    },
    note: "TTRPG-3A 会话席位、controller、viewer、actor 与最小同意策略；不保存账号凭据或联系人 PII",
  },

  {
    table: db.ttrpgRuntimeAssetRequests,
    name: "ttrpgRuntimeAssetRequests",
    owner: "project",
    domainOwner: {
      allowed: ["instance"],
      legacyDefault: "instance",
      locator: {
        kind: "parent",
        owner: "instance",
        table: "simulationSessions",
        field: "sessionId",
      },
    },
    worldScoped: true,
    exportable: true,
    exportRemap: [
      {
        field: "worldGroupId",
        remapVia: "worldGroups",
        exportAs: "_worldGroupExportId",
      },
      {
        field: "worldId",
        remapVia: "worlds",
        exportAs: "_worldExportId",
        onUnmapped: "require",
      },
      {
        field: "workId",
        remapVia: "works",
        exportAs: "_workExportId",
        onUnmapped: "require",
      },
      {
        field: "sessionId",
        remapVia: "simulationSessions",
        exportAs: "_simulationSessionExportId",
        onUnmapped: "require",
      },
      {
        field: "mediaAssetId",
        remapVia: "avgMediaAssets",
        exportAs: "_mediaAssetExportId",
      },
    ],
    defaults: {
      status: "cancelled",
      attemptCount: 0,
      maximumAttempts: 1,
      maximumSessionCostUsd: 0,
      estimatedCostUsd: null,
      costReservationUsd: 0,
      actualCostUsd: null,
      estimatedStorageBytes: null,
      mediaAssetId: null,
      mediaAssetVersion: null,
      mediaContentHash: null,
      processorLeaseId: null,
      processorLeaseExpiresAt: null,
      lastErrorCode: "imported-without-active-provider",
      lastErrorDetail: null,
      terminalEventSequence: null,
      revision: 1,
    },
    note: "TTRPG-3B 可恢复媒资队列与预算/事件证据；不保存 provider 凭据或二进制，实际字节复用统一媒资表",
  },
  {
    table: db.ttrpgProductions,
    name: "ttrpgProductions",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    refs: [
      ...[
        "ttrpgSourceSelections",
        "ttrpgProductionBriefs",
        "ttrpgProductionSteps",
        "ttrpgProductionBuilds",
        "ttrpgProductReleases",
      ].map(target => ({
        kind: "simple" as const,
        field: "id",
        target: `${target}[productionId]`,
        onDelete: "cascade" as const,
      })),
    ],
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "activeSourceSelectionId", remapVia: "ttrpgSourceSelections", exportAs: "_activeSourceSelectionExportId", deferImport: true },
      { field: "activeBriefId", remapVia: "ttrpgProductionBriefs", exportAs: "_activeBriefExportId", deferImport: true },
      { field: "currentBuildId", remapVia: "ttrpgProductionBuilds", exportAs: "_currentBuildExportId", deferImport: true },
      { field: "currentProductReleaseId", remapVia: "ttrpgProductReleases", exportAs: "_currentProductReleaseExportId", deferImport: true },
    ],
    memoryClassification: {
      version: 1, classification: "editable", mirrorPolicy: "recovery-evidence",
      reason: "作者拥有的跑团生产根、标题与当前阶段；正式内容由不可变子记录恢复。",
    },
    defaults: {
      status: "draft", activeSourceSelectionId: null, activeBriefId: null,
      currentBuildId: null, currentProductReleaseId: null,
    },
    note: "TTRPG-4B 产品专属生产根；不复用其它游戏的 Brief、DAG 或发布状态机",
  },

  {
    table: db.ttrpgSourceSelections,
    name: "ttrpgSourceSelections",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "productionId", remapVia: "ttrpgProductions", exportAs: "_productionExportId", onUnmapped: "require" },
      { field: "sourceWorldReleaseId", remapVia: "worldReleases", exportAs: "_sourceWorldReleaseExportId" },
    ],
    exportRefRemap: [
      {
        field: "worldReferenceJson", remapVia: "worldReleases", kind: "json-id-paths",
        paths: ["localReleaseRecordId"], exportAs: "_portableWorldReferenceJson", onUnmapped: "null",
      },
      {
        field: "sourcePlanJson", remapVia: "worldReleases", kind: "json-id-paths",
        paths: ["worldReference.localReleaseRecordId"], exportAs: "_portableSourcePlanJson", onUnmapped: "null",
      },
    ],
    memoryClassification: {
      version: 1, classification: "evidence", mirrorPolicy: "recovery-evidence",
      reason: "不可变跑团来源目录与选择证据；开发 fixture 明确不可发布，正式来源保留 Release 绑定。",
    },
    defaults: {
      sourceWorldReleaseId: null, status: "frozen",
      worldReferenceJson: null, worldReferenceHash: null, sourcePlanJson: null, sourcePlanHash: null,
    },
    note: "TTRPG-4B 跑团专属冻结 SourceSelection；不保存来源 Dexie 自增身份",
  },

  {
    table: db.ttrpgProductionBriefs,
    name: "ttrpgProductionBriefs",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "productionId", remapVia: "ttrpgProductions", exportAs: "_productionExportId", onUnmapped: "require" },
      { field: "sourceSelectionId", remapVia: "ttrpgSourceSelections", exportAs: "_sourceSelectionExportId", onUnmapped: "require" },
    ],
    memoryClassification: {
      version: 1, classification: "editable", mirrorPolicy: "recovery-evidence",
      reason: "作者逐版本确认的跑团 Brief；每次修改追加新版本而不覆盖历史决定。",
    },
    defaults: {
      status: "confirmed", briefJson: "{}", briefHash: "",
      confirmedContractJson: null, confirmedContractHash: null, authorStartRevision: null,
    },
    note: "TTRPG-4B 产品专属不可变 Brief revision",
  },

  {
    table: db.ttrpgProductionSteps,
    name: "ttrpgProductionSteps",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "productionId", remapVia: "ttrpgProductions", exportAs: "_productionExportId", onUnmapped: "require" },
      { field: "buildId", remapVia: "ttrpgProductionBuilds", exportAs: "_buildExportId", deferImport: true },
    ],
    memoryClassification: {
      version: 1, classification: "evidence", mirrorPolicy: "recovery-evidence",
      reason: "跑团生产每一步的 attempt、输入输出 hash、检查点与失败证据，用于恢复和审计。",
    },
    defaults: { buildId: null, status: "pending", outputHash: null, checkpointJson: "{}", errorJson: null, startedAt: null, completedAt: null },
    note: "TTRPG-4B 产品专属生产步骤；重试显式追加 attempt，不隐藏循环",
  },

  {
    table: db.ttrpgProductionBuilds,
    name: "ttrpgProductionBuilds",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    refs: [
      {
        kind: "simple",
        field: "id",
        target: "ttrpgProductionMediaAssets[buildId]",
        onDelete: "cascade",
      },
      {
        kind: "simple",
        field: "id",
        target: "simulationSessions[ttrpgBuildId]",
        onDelete: "setNull",
      },
    ],
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "productionId", remapVia: "ttrpgProductions", exportAs: "_productionExportId", onUnmapped: "require" },
      { field: "sourceSelectionId", remapVia: "ttrpgSourceSelections", exportAs: "_sourceSelectionExportId", onUnmapped: "require" },
      { field: "briefId", remapVia: "ttrpgProductionBriefs", exportAs: "_briefExportId", onUnmapped: "require" },
    ],
    memoryClassification: {
      version: 1, classification: "evidence", mirrorPolicy: "recovery-evidence",
      reason: "可重放的 RulePack、CampaignPack、验证报告和 Build hash；开发 Build 只允许试玩。",
    },
    defaults: { status: "building", developmentOnly: true, validationJson: "{}", errorJson: null },
    note: "TTRPG-4B 完整产品 Build；区别于其它游戏的通用 GameBuild",
  },

  {
    table: db.ttrpgProductionMediaAssets,
    name: "ttrpgProductionMediaAssets",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "buildId", remapVia: "ttrpgProductionBuilds", exportAs: "_buildExportId", onUnmapped: "require" },
      { field: "blobObjectId", remapVia: "mediaBlobObjects", exportAs: "_blobObjectExportId", deferImport: true },
      { field: "producerRunId", remapVia: "agentRuns", exportAs: "_producerRunExportId" },
    ],
    memoryClassification: {
      version: 1, classification: "evidence", mirrorPolicy: "recovery-evidence",
      reason: "跑团 Build 的媒资槽、版本、内容哈希、生成回执与版权策略；二进制由共享对象表承载。",
    },
    defaults: {
      status: "planned", blobObjectId: null, mimeType: null, byteSize: 0,
      contentHash: null, producerRunId: null, providerAdapterId: null,
      providerRequestId: null, providerModelId: null, providerReceiptHash: null,
      rightsJson: "{}", failureJson: null,
    },
    note: "TTRPG-4F 产品专属媒资版本账本；不复用其它游戏的 gameBuildArtifacts",
  },

  {
    table: db.ttrpgProductReleases,
    name: "ttrpgProductReleases",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "productionId", remapVia: "ttrpgProductions", exportAs: "_productionExportId", onUnmapped: "require" },
      { field: "sourceSelectionId", remapVia: "ttrpgSourceSelections", exportAs: "_sourceSelectionExportId", onUnmapped: "require" },
      { field: "sourceWorldReleaseId", remapVia: "worldReleases", exportAs: "_sourceWorldReleaseExportId", onUnmapped: "require" },
      { field: "briefId", remapVia: "ttrpgProductionBriefs", exportAs: "_briefExportId", onUnmapped: "require" },
      { field: "buildId", remapVia: "ttrpgProductionBuilds", exportAs: "_buildExportId", onUnmapped: "require" },
    ],
    exportRefRemap: [{
      field: "manifestJson", remapVia: "worldReleases", kind: "json-id-paths",
      paths: ["source.worldReleaseId", "source.selection.worldReleaseId"],
      exportAs: "_portableManifestJson", onUnmapped: "require",
    }],
    memoryClassification: {
      version: 1, classification: "evidence", mirrorPolicy: "recovery-evidence",
      reason: "不可变跑团产品发布清单；只能由正式世界来源和通过全部门槛的 Build 创建。",
    },
    defaults: {
      manifestJson: "{}", contentHash: "", releaseUid: null,
      sourceManifestJson: null, sourceManifestHash: null,
      lineageJson: null, lineageHash: null,
    },
    note: "TTRPG-4B 产品专属不可变 Release；开发来源服务层硬拒绝写入",
  },
  {
    table: db.characterInteractionProductions,
    name: "characterInteractionProductions",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    refs: [
      {
        kind: "simple",
        field: "id",
        target: "characterInteractionSourceSelections[productionId]",
        onDelete: "cascade",
      },
      {
        kind: "simple",
        field: "id",
        target: "characterInteractionBriefs[productionId]",
        onDelete: "cascade",
      },
      { kind: "simple", field: "id", target: "characterInteractionProductionSteps[productionId]", onDelete: "cascade" },
      { kind: "simple", field: "id", target: "characterInteractionArtifacts[productionId]", onDelete: "cascade" },
      { kind: "simple", field: "id", target: "characterInteractionMediaAssets[productionId]", onDelete: "cascade" },
      { kind: "simple", field: "id", target: "characterInteractionProductReleases[productionId]", onDelete: "cascade" },
    ],
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "activeSourceSelectionId", remapVia: "characterInteractionSourceSelections", exportAs: "_activeSourceSelectionExportId", deferImport: true },
      { field: "activeBriefId", remapVia: "characterInteractionBriefs", exportAs: "_activeBriefExportId", deferImport: true },
      { field: "currentProductReleaseId", remapVia: "characterInteractionProductReleases", exportAs: "_currentProductReleaseExportId", deferImport: true },
    ],
    memoryClassification: {
      version: 1,
      classification: "editable",
      mirrorPolicy: "recovery-evidence",
      reason: "作者拥有的角色互动生产根；来源和 Brief 通过不可变子记录恢复。",
    },
    defaults: {
      status: "brief-draft",
      activeSourceSelectionId: null,
      activeBriefId: null,
      currentProductReleaseId: null,
    },
    note: "CHATGAME-CI-1 角色互动专属生产根；不依赖通用游戏或其它产品生产状态机",
  },

  {
    table: db.characterInteractionSourceSelections,
    name: "characterInteractionSourceSelections",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    refs: [
      {
        kind: "simple",
        field: "id",
        target: "characterInteractionProductions[activeSourceSelectionId]",
        onDelete: "cascade",
      },
      {
        kind: "simple",
        field: "id",
        target: "characterInteractionBriefs[sourceSelectionId]",
        onDelete: "cascade",
      },
    ],
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "productionId", remapVia: "characterInteractionProductions", exportAs: "_productionExportId", onUnmapped: "require" },
      { field: "sourceWorldReleaseId", remapVia: "worldReleases", exportAs: "_sourceWorldReleaseExportId", onUnmapped: "require" },
    ],
    exportRefRemap: [
      {
        field: "selectionJson",
        remapVia: "worldReleases",
        kind: "json-id-paths",
        paths: ["worldReleaseId"],
        exportAs: "_portableSelectionJson",
        onUnmapped: "require",
      },
      {
        field: "worldReferenceJson", remapVia: "worldReleases", kind: "json-id-paths",
        paths: ["localReleaseRecordId"], exportAs: "_portableWorldReferenceJson", onUnmapped: "require",
      },
      {
        field: "sourcePlanJson", remapVia: "worldReleases", kind: "json-id-paths",
        paths: ["worldReference.localReleaseRecordId"], exportAs: "_portableSourcePlanJson", onUnmapped: "require",
      },
    ],
    memoryClassification: {
      version: 1,
      classification: "evidence",
      mirrorPolicy: "recovery-evidence",
      reason: "冻结 WorldRelease 目录、便携选择、闭包和哈希的角色互动专属来源证据。",
    },
    defaults: {
      status: "frozen",
      selectionJson: "{}",
      selectionHash: "",
      worldContentHash: "",
      worldReferenceJson: null,
      worldReferenceHash: null,
      sourcePlanJson: null,
      sourcePlanHash: null,
    },
    note: "CHATGAME-CI-1 不可变 SourceSelection revision；长期身份只使用冻结包便携 ID",
  },

  {
    table: db.characterInteractionBriefs,
    name: "characterInteractionBriefs",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    refs: [
      {
        kind: "simple",
        field: "id",
        target: "characterInteractionProductions[activeBriefId]",
        onDelete: "setNull",
      },
    ],
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "productionId", remapVia: "characterInteractionProductions", exportAs: "_productionExportId", onUnmapped: "require" },
      { field: "sourceSelectionId", remapVia: "characterInteractionSourceSelections", exportAs: "_sourceSelectionExportId", onUnmapped: "require" },
    ],
    exportRefRemap: [
      {
        field: "briefJson",
        remapVia: "worldReleases",
        kind: "json-id-paths",
        paths: ["source.worldReleaseId"],
        exportAs: "_portableBriefJson",
        onUnmapped: "require",
      },
      {
        field: "runContractJson",
        remapVia: "worldReleases",
        kind: "json-id-paths",
        paths: ["sourceWorldReleaseId"],
        exportAs: "_portableRunContractJson",
        onUnmapped: "require",
      },
    ],
    memoryClassification: {
      version: 1,
      classification: "editable",
      mirrorPolicy: "recovery-evidence",
      reason: "作者逐版本确认的角色互动 Brief；确认版同时冻结候选只写 Run Contract。",
    },
    defaults: {
      status: "draft",
      briefJson: "{}",
      briefHash: "",
      runContractJson: null,
      runContractHash: null,
      confirmedAt: null,
      confirmedContractJson: null,
      confirmedContractHash: null,
      authorStartRevision: null,
    },
    note: "CHATGAME-CI-2 产品专属 Brief revision 和正式模型权限合同",
  },

  {
    table: db.characterInteractionProductionSteps,
    name: "characterInteractionProductionSteps",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "productionId", remapVia: "characterInteractionProductions", exportAs: "_productionExportId", onUnmapped: "require" },
      { field: "candidateArtifactId", remapVia: "characterInteractionArtifacts", exportAs: "_candidateArtifactExportId", deferImport: true },
      { field: "confirmedArtifactId", remapVia: "characterInteractionArtifacts", exportAs: "_confirmedArtifactExportId", deferImport: true },
      { field: "producerRunId", remapVia: "agentRuns", exportAs: "_producerRunExportId", onUnmapped: "null" },
    ],
    memoryClassification: { version: 1, classification: "evidence", mirrorPolicy: "recovery-evidence", reason: "角色互动产品步骤尝试、恢复点和人工确认状态。" },
    defaults: { status: "pending", candidateArtifactId: null, confirmedArtifactId: null, producerRunId: null, checkpointJson: "{}", errorJson: null, startedAt: null, completedAt: null },
    note: "CHATGAME-CI-3 产品专属 durable 生产步骤；不复用其它产品状态机",
  },

  {
    table: db.characterInteractionArtifacts,
    name: "characterInteractionArtifacts",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "productionId", remapVia: "characterInteractionProductions", exportAs: "_productionExportId", onUnmapped: "require" },
      { field: "producerRunId", remapVia: "agentRuns", exportAs: "_producerRunExportId", onUnmapped: "null" },
      { field: "sourceSessionId", remapVia: "simulationSessions", exportAs: "_sourceSessionExportId", onUnmapped: "null" },
    ],
    exportRefRemap: [{
      field: "payloadJson", remapVia: "worldReleases", kind: "json-id-paths",
      paths: ["from.worldReleaseId", "to.worldReleaseId"],
      exportAs: "_portablePayloadJson", onUnmapped: "null",
    }],
    memoryClassification: { version: 1, classification: "evidence", mirrorPolicy: "recovery-evidence", reason: "冻结来源派生的候选与作者确认产物，不是世界 Canon。" },
    defaults: { status: "candidate", producerRunId: null, sourceSessionId: null, confirmationJson: null, confirmedAt: null },
    note: "CHATGAME-CI-3/5 候选、确认产物、升级方案和运行反馈候选",
  },

  {
    table: db.characterInteractionMediaAssets,
    name: "characterInteractionMediaAssets",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    refs: [{ kind: "simple", field: "blobObjectId", target: "mediaBlobObjects[id]", onDelete: "setNull" }],
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "productionId", remapVia: "characterInteractionProductions", exportAs: "_productionExportId", onUnmapped: "require" },
      { field: "blobObjectId", remapVia: "mediaBlobObjects", exportAs: "_blobObjectExportId", onUnmapped: "null" },
      { field: "producerRunId", remapVia: "agentRuns", exportAs: "_producerRunExportId", onUnmapped: "null" },
    ],
    memoryClassification: { version: 1, classification: "evidence", mirrorPolicy: "recovery-evidence", reason: "角色互动产品媒资规格、权利、降级与内容寻址绑定。" },
    defaults: { status: "planned", blobObjectId: null, mimeType: null, byteSize: 0, contentHash: null, producerRunId: null, rightsJson: "{}", failureJson: null },
    note: "CHATGAME-CI-4 产品专属媒资元数据；物理字节复用 mediaBlobObjects",
  },

  {
    table: db.characterInteractionProductReleases,
    name: "characterInteractionProductReleases",
    owner: "project",
    exportable: true,
    exportIdField: true,
    domainOwner: LEGACY_WORK_OWNER,
    refs: [{ kind: "simple", field: "id", target: "characterInteractionProductions[currentProductReleaseId]", onDelete: "setNull" }],
    exportRemap: [
      { field: "worldId", remapVia: "worlds", exportAs: "_worldExportId", onUnmapped: "require" },
      { field: "workId", remapVia: "works", exportAs: "_workExportId", onUnmapped: "require" },
      { field: "productionId", remapVia: "characterInteractionProductions", exportAs: "_productionExportId", onUnmapped: "require" },
      { field: "sourceSelectionId", remapVia: "characterInteractionSourceSelections", exportAs: "_sourceSelectionExportId", onUnmapped: "require" },
      { field: "sourceWorldReleaseId", remapVia: "worldReleases", exportAs: "_sourceWorldReleaseExportId", onUnmapped: "require" },
      { field: "briefId", remapVia: "characterInteractionBriefs", exportAs: "_briefExportId", onUnmapped: "require" },
      { field: "gameReleaseId", remapVia: "gameReleases", exportAs: "_gameReleaseExportId", onUnmapped: "require" },
    ],
    exportRefRemap: [{
      field: "manifestJson", remapVia: "worldReleases", kind: "json-id-paths",
      paths: ["source.worldReleaseId", "source.selection.worldReleaseId", "brief.content.source.worldReleaseId"],
      exportAs: "_portableManifestJson", onUnmapped: "require",
    }],
    memoryClassification: { version: 1, classification: "evidence", mirrorPolicy: "recovery-evidence", reason: "不可变角色互动产品发行物及完整来源和媒资证明。" },
    defaults: {
      manifestJson: "{}", contentHash: "", releaseUid: null,
      sourceManifestJson: null, sourceManifestHash: null,
      lineageJson: null, lineageHash: null,
    },
    note: "CHATGAME-CI-5 不可变 CharacterInteraction Product Release",
  },
]

function classifyWorkspaceMemory(spec: ProjectTableRegistration): WorkspaceMemoryClassificationV1 {
  if (spec.memoryClassification) return spec.memoryClassification
  if (spec.workspaceProjection) {
    return {
      version: 1,
      classification: 'editable',
      mirrorPolicy: 'editable-document',
      reason: '已登记严格 codec、稳定 identity、CAS 采纳与依赖影响发射器。',
    }
  }
  if (spec.owner === 'global') {
    return {
      version: 1,
      classification: 'not-applicable',
      mirrorPolicy: 'excluded-global',
      reason: '全局本地配置不属于任何项目工作区。',
    }
  }
  if (spec.exportable) {
    return {
      version: 1,
      classification: 'evidence',
      mirrorPolicy: 'recovery-evidence',
      reason: '确定内容进入注册表派生 recovery capsule；磁盘副本只读并可完整恢复。',
    }
  }
  return {
    version: 1,
    classification: 'derived-none',
    mirrorPolicy: 'rebuild-or-local-only',
    reason: '缓存、统计、临时事务或本地句柄不构成可移植项目记忆；由正式来源重建或留在本机。',
  }
}

/**
 * MEMORY-10 keeps classification in PROJECT_TABLES without a parallel table
 * name list. New registrations cannot reach consumers without receiving one
 * of the four explicit policies here.
 */
export const PROJECT_TABLES: TableSpec[] = PROJECT_TABLE_REGISTRATIONS.map(spec => ({
  ...spec,
  memoryClassification: classifyWorkspaceMemory(spec),
}))

/** 按表名快速查找 */
export const REGISTRY_BY_NAME: ReadonlyMap<string, TableSpec> = new Map(
  PROJECT_TABLES.map(s => [s.name, s] as const),
)
