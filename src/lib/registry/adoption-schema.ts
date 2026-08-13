/**
 * ADOPTION_SCHEMAS(Phase 1.2a) · 集合写回策略登记。
 *
 * 单例表走 FIELD_REGISTRY 定位记录;集合表必须在这里登记 identity / 去重 /
 * 自动盖章 / FK 校验策略。
 */
import type { AdoptionExtensionSpec, CollectionAdoptionSpec } from './types'
import { REGISTRY_BY_NAME } from './project-tables'

const ADOPTION_SCHEMAS_RAW: CollectionAdoptionSpec[] = [
  {
    target: 'characters',
    identity: { kind: 'composite', fields: ['homeWorldGroupId', 'name'] },
    duplicatePolicy: 'merge',
    required: ['name', 'roleWeight', 'moralAxis', 'orderAxis'],
    autoStamps: ['projectId', 'homeWorldGroupId', 'createdAt', 'updatedAt'],
  },
  {
    target: 'characterRelations',
    identity: {
      kind: 'composite',
      fields: ['fromCharacterId', 'toCharacterId', 'relationType'],
    },
    duplicatePolicy: 'skip',
    required: ['fromCharacterId', 'toCharacterId', 'relationType', 'label', 'isBidirectional'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [
      { field: 'fromCharacterId', target: 'characters' },
      { field: 'toCharacterId', target: 'characters' },
    ],
  },
  {
    target: 'foreshadows',
    identity: 'name',
    duplicatePolicy: 'merge',
    required: ['name', 'type', 'status', 'description'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [
      { field: 'plantChapterId', target: 'chapters' },
      { field: 'resolveChapterId', target: 'chapters' },
      { field: 'expectedResolveChapterId', target: 'chapters' },
    ],
  },
  {
    target: 'outlineNodes',
    identity: { kind: 'composite', fields: ['parentId', 'type', 'title'] },
    duplicatePolicy: 'skip',
    required: ['type', 'title'],
    autoStamps: ['projectId', 'worldGroupId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'parentId', target: 'outlineNodes' }],
  },
  {
    target: 'chapters',
    identity: { kind: 'composite', fields: ['outlineNodeId', 'title'] },
    duplicatePolicy: 'update',
    required: ['outlineNodeId', 'title'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [
      { field: 'outlineNodeId', target: 'outlineNodes' },
      { field: 'perspectiveCharacterId', target: 'characters' },
    ],
  },
  {
    target: 'detailedOutlines',
    identity: { kind: 'composite', fields: ['outlineNodeId'] },
    duplicatePolicy: 'update',
    required: ['outlineNodeId'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'outlineNodeId', target: 'outlineNodes' }],
    arrayMemberChecks: [
      { field: 'appearingCharacterIds', itemTarget: 'characters' },
      { field: 'foreshadowIds', itemTarget: 'foreshadows' },
    ],
  },
  {
    target: 'emotionBeatCards',
    identity: { kind: 'composite', fields: ['chapterId'] },
    duplicatePolicy: 'update',
    required: ['chapterId', 'chapterTitle', 'overallArc', 'beats', 'source'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    ownerFrom: 'work',
    fkChecks: [{ field: 'chapterId', target: 'chapters' }],
  },
  {
    target: 'storyArcs',
    identity: 'name',
    duplicatePolicy: 'merge',
    required: ['name', 'type'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
  },
  {
    target: 'storylineProgress',
    identity: { kind: 'composite', fields: ['arcId'] },
    duplicatePolicy: 'update',
    required: ['arcId', 'status', 'progressNote', 'involvedEntities'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [
      { field: 'arcId', target: 'storyArcs' },
      { field: 'lastActiveChapterId', target: 'chapters' },
    ],
  },
  {
    target: 'storylineCrossings',
    identity: { kind: 'composite', fields: ['arcIdA', 'arcIdB', 'chapterId'] },
    duplicatePolicy: 'update',
    required: ['arcIdA', 'arcIdB', 'note', 'evidenceQuote'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [
      { field: 'arcIdA', target: 'storyArcs' },
      { field: 'arcIdB', target: 'storyArcs' },
      { field: 'chapterId', target: 'chapters' },
    ],
  },
  {
    target: 'codexCategories',
    identity: { kind: 'composite', fields: ['domain', 'parentId', 'name'] },
    duplicatePolicy: 'skip',
    required: ['domain', 'name'],
    autoStamps: ['projectId', 'worldGroupId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'parentId', target: 'codexCategories' }],
  },
  {
    target: 'codexEntries',
    identity: { kind: 'composite', fields: ['worldGroupId', 'categoryId', 'name'] },
    duplicatePolicy: 'merge',
    required: ['categoryId', 'name'],
    autoStamps: ['projectId', 'worldGroupId', 'createdAt', 'updatedAt'],
    fkChecks: [
      { field: 'categoryId', target: 'codexCategories' },
      { field: 'importantLocationId', target: 'importantLocations' },
    ],
  },
  {
    target: 'cultivationSystems',
    identity: { kind: 'composite', fields: ['worldGroupId', 'name'] },
    duplicatePolicy: 'merge',
    required: ['name', 'description', 'stages'],
    autoStamps: ['projectId', 'worldGroupId', 'createdAt', 'updatedAt'],
  },
  {
    target: 'cultivationProgress',
    identity: {
      kind: 'composite',
      fields: ['characterId', 'sourceChapterId', 'stageId', 'sourceQuote'],
    },
    duplicatePolicy: 'skip',
    required: [
      'characterId', 'characterName', 'cultivationSystemId', 'cultivationSystemName',
      'stageId', 'stageName', 'transition', 'sourceChapterId', 'sourceChapterTitle',
      'sourceQuote', 'sourceOffset', 'status',
    ],
    autoStamps: ['projectId', 'worldGroupId', 'createdAt', 'updatedAt'],
    fkChecks: [
      { field: 'characterId', target: 'characters' },
      { field: 'cultivationSystemId', target: 'cultivationSystems' },
      { field: 'sourceChapterId', target: 'chapters' },
    ],
  },
  {
    target: 'importantLocations',
    identity: 'name',
    duplicatePolicy: 'merge',
    required: ['name'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'parentId', target: 'importantLocations' }],
  },
  {
    target: 'worldNodes',
    identity: 'id',
    recordOnly: true,
    duplicatePolicy: 'update',
    required: [],
    autoStamps: ['projectId', 'worldGroupId', 'createdAt', 'updatedAt'],
    ownerFrom: 'world',
  },
  {
    target: 'itemLedger',
    identity: { kind: 'composite', fields: ['chapterId', 'itemName', 'action', 'heldByName', 'note'] },
    duplicatePolicy: 'skip',
    required: ['itemName', 'action', 'quantity', 'heldByName'],
    autoStamps: ['projectId', 'createdAt'],
    fkChecks: [{ field: 'chapterId', target: 'chapters' }, { field: 'characterId', target: 'characters' }],
    replaceScope: ['chapterId'],
  },
  {
    target: 'knowledgeLedger',
    identity: {
      kind: 'composite',
      fields: ['characterId', 'knowledgeKey', 'action', 'sourceChapterId', 'statement'],
    },
    duplicatePolicy: 'skip',
    required: ['characterName', 'knowledgeKey', 'statement', 'action', 'sourceType', 'status'],
    autoStamps: ['projectId', 'worldGroupId', 'createdAt', 'updatedAt'],
    fkChecks: [
      { field: 'characterId', target: 'characters' },
      { field: 'factId', target: 'temporalFacts' },
      { field: 'sourceChapterId', target: 'chapters' },
    ],
  },
  {
    target: 'storyTimelineEvents',
    identity: { kind: 'composite', fields: ['chapterId', 'title'] },
    duplicatePolicy: 'update',
    required: ['title', 'importance'],
    autoStamps: ['projectId', 'createdAt'],
    fkChecks: [{ field: 'chapterId', target: 'chapters' }],
    replaceScope: ['chapterId'],
  },
  {
    target: 'historicalTimelineEvents',
    identity: 'id',
    recordOnly: true,
    duplicatePolicy: 'update',
    required: [],
    autoStamps: ['projectId', 'worldGroupId', 'createdAt', 'updatedAt'],
  },
  {
    target: 'historicalKeywords',
    identity: 'id',
    recordOnly: true,
    duplicatePolicy: 'update',
    required: [],
    autoStamps: ['projectId', 'worldGroupId', 'createdAt', 'updatedAt'],
  },
  {
    target: 'stateCards',
    identity: { kind: 'composite', fields: ['category', 'entityName'] },
    duplicatePolicy: 'merge',
    required: ['category', 'entityName', 'fields'],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'lastChapterId', target: 'chapters' }],
  },
  {
    target: 'references',
    identity: 'id',
    recordOnly: true,
    duplicatePolicy: 'update',
    required: [],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
  },
  {
    target: 'referenceAnalysisRuns',
    identity: 'id',
    recordOnly: true,
    duplicatePolicy: 'update',
    required: [],
    autoStamps: ['projectId', 'createdAt', 'updatedAt'],
    fkChecks: [{ field: 'referenceId', target: 'references' }],
  },
  {
    target: 'characterDrivenPlans',
    identity: 'id',
    recordOnly: true,
    duplicatePolicy: 'update',
    required: [],
    autoStamps: ['projectId', 'workId', 'createdAt', 'updatedAt'],
    ownerFrom: 'work',
  },
  {
    target: 'referenceChunkAnalysis',
    identity: { kind: 'composite', fields: ['analysisRunId', 'chunkIndex'] },
    duplicatePolicy: 'update',
    required: ['referenceId', 'analysisRunId', 'chunkIndex'],
    autoStamps: ['createdAt'],
    fkChecks: [
      { field: 'referenceId', target: 'references' },
      { field: 'analysisRunId', target: 'referenceAnalysisRuns' },
    ],
    replaceScope: ['analysisRunId'],
  },
]

export const ADOPTION_EXTENSIONS: readonly AdoptionExtensionSpec[] = Object.freeze([
  {
    id: 'reference-analysis-run-lifecycle',
    target: 'referenceAnalysisRuns',
    entrypoints: [
      'src/lib/reference-analysis/lifecycle.ts',
      'src/lib/reference-analysis/legacy-bridge.ts',
    ],
    policyRegistry: 'REFERENCE_ANALYSIS_RUN_POLICY + ADOPTION_SCHEMAS + PROJECT_TABLES',
    reason: '分析版本的创建、激活、回滚与裁剪必须在事务内维持唯一 active、来源声明不可变和旧版本不丢失；AI 派生字段更新仍走 adopt。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'reference-analysis-source-lifecycle',
    target: 'referenceAnalysisSources',
    entrypoints: ['src/lib/reference-analysis/lifecycle.ts'],
    policyRegistry: 'REFERENCE_ANALYSIS_RUN_POLICY + PROJECT_TABLES',
    reason: '本地原文只服务断点续跑，必须与 run 原子绑定和级联删除，且禁止进入项目 JSON 导出。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'reference-analysis-chunk-lifecycle',
    target: 'referenceChunkAnalysis',
    entrypoints: [
      'src/lib/reference-analysis/lifecycle.ts',
      'src/lib/reference-analysis/legacy-bridge.ts',
    ],
    policyRegistry: 'REFERENCE_ANALYSIS_RUN_POLICY + ADOPTION_SCHEMAS + PROJECT_TABLES',
    reason: '旧分块桥接 runId 以及版本/参考删除必须在领域事务内原子重映射或级联；新的 AI 分块写入仍统一走 adopt。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'reference-analysis-reference-lifecycle',
    target: 'references',
    entrypoints: ['src/lib/reference-analysis/lifecycle.ts'],
    policyRegistry: 'REFERENCE_ANALYSIS_RUN_POLICY + PROJECT_TABLES refs',
    reason: '激活版本需原子同步兼容投影；删除参考需同时清理版本、分块、原文与创作规则引用。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'reference-analysis-citation-lifecycle',
    target: 'creativeRules',
    entrypoints: ['src/lib/reference-analysis/lifecycle.ts'],
    policyRegistry: 'PROJECT_TABLES references refs',
    reason: '删除参考时必须在同一事务移除 creativeRules.citedReferenceIds，避免 AI 上下文保留悬空引用。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'fact-ledger',
    target: 'temporalFacts',
    entrypoints: [
      'src/lib/fact-ledger/fact-ledger.ts',
      'src/lib/fact-ledger/human-readable-io.ts',
      'src/lib/fact-ledger/lifecycle.ts',
      'src/lib/fact-ledger/setting-assertions.ts',
      'src/lib/consistency/impact-analysis.ts',
      'src/lib/cultivation/lifecycle.ts',
      'src/lib/editor/entity-rename.ts',
    ],
    policyRegistry: 'FACT_PREDICATE_REGISTRY',
    reason: '事实候选需要谓词、时序、证据、确认与 supersede 领域约束；它是 adopt 的受控领域扩展，不是第二套通用写回层。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'character-merge-lifecycle',
    target: 'characters',
    entrypoints: [
      'src/lib/import/character-merge.ts',
      'src/lib/codex/references.ts',
      'src/lib/cultivation/lifecycle.ts',
      'src/lib/cultivation/progress-lifecycle.ts',
    ],
    policyRegistry: 'PROJECT_TABLES refs + remapCharacterReferences + cultivation DAG validator',
    reason: '角色合并及上游实体删除都需要在事务内重映射或置空跨表引用；普通角色新增和更新仍必须走 adopt。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'knowledge-ledger',
    target: 'knowledgeLedger',
    entrypoints: [
      'src/lib/knowledge-ledger/knowledge-ledger.ts',
      'src/lib/knowledge-ledger/lifecycle.ts',
    ],
    policyRegistry: 'KNOWLEDGE_ACTIONS + ADOPTION_SCHEMAS + PROJECT_TABLES',
    reason: '角色认知候选必须经人工确认，投影必须按规范章序和世界隔离计算；角色与章节删除还需要保留证据并降级复核。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'storyline-progress-lifecycle',
    target: 'storylineProgress',
    entrypoints: ['src/lib/storyline/lifecycle.ts'],
    policyRegistry: 'ADOPTION_SCHEMAS + PROJECT_TABLES refs',
    reason: '章节删除必须保留作者确认的进度与冗余章名并只断开 FK；故事线删除则必须在同一事务级联清理动态投影，无法由普通字段采纳表达。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'storyline-crossing-lifecycle',
    target: 'storylineCrossings',
    entrypoints: ['src/lib/storyline/lifecycle.ts'],
    policyRegistry: 'ADOPTION_SCHEMAS + PROJECT_TABLES refs',
    reason: '章节删除只断开交汇的章节 FK，故事线删除则级联清理所有相关交汇；这是受控删除生命周期，不是 AI 写回旁路。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'story-arc-dynamic-lifecycle',
    target: 'storyArcs',
    entrypoints: ['src/lib/storyline/lifecycle.ts'],
    policyRegistry: 'PROJECT_TABLES refs',
    reason: '删除静态 StoryArc 时必须与动态进度和交汇在同一事务内完成硬级联，避免孤儿投影。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'cultivation-codex-reference-lifecycle',
    target: 'codexEntries',
    entrypoints: [
      'src/lib/codex/references.ts',
      'src/lib/cultivation/lifecycle.ts',
      'src/lib/location/lifecycle.ts',
    ],
    policyRegistry: 'PROJECT_TABLES refs + cultivation DAG validator',
    reason: '删除词条、世界、修炼体系、境界节点或重要地点时，必须原子清理词条 JSON 引用及异兽体系/阶段/城池地点引用。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'cultivation-progress-lifecycle',
    target: 'cultivationProgress',
    entrypoints: [
      'src/lib/cultivation/progress.ts',
      'src/lib/cultivation/progress-lifecycle.ts',
    ],
    policyRegistry: 'ADOPTION_SCHEMAS + PROJECT_TABLES + cultivation DAG validator + canonical chapter sequence',
    reason: '修炼进度候选须经正文逐字证据、闭集 ID、DAG 路径和规范章序校验；角色、章节、体系与阶段删除需保留历史证据并降级软引用。',
    reviewAfter: '2027-01-01',
  },
  {
    id: 'codex-category-scope-lifecycle',
    target: 'codexCategories',
    entrypoints: ['src/lib/registry/lifecycle.ts'],
    policyRegistry: 'PROJECT_TABLES lifecycle',
    reason: '分类 schema 已改为项目级共享；删除世界时需原子清除旧备份残留的 worldGroupId，而不是删除分类。',
    reviewAfter: '2027-01-01',
  },
])

/** C3: owner policy is derived from the same PROJECT_TABLES domainOwner metadata. */
export const ADOPTION_SCHEMAS: CollectionAdoptionSpec[] = ADOPTION_SCHEMAS_RAW.map(schema => ({
  ...schema,
  ownerFrom: schema.ownerFrom ?? (() => {
    const owner = REGISTRY_BY_NAME.get(schema.target)?.domainOwner?.legacyDefault
    return owner === 'world' || owner === 'work' ? owner : undefined
  })(),
}))

export const ADOPTION_BY_TARGET: ReadonlyMap<string, CollectionAdoptionSpec> = new Map(
  ADOPTION_SCHEMAS.map(s => [s.target, s] as const),
)
