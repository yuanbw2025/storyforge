import {
  db,
  STORYFORGE_SCHEMA_VERSION,
  STORYFORGE_STORES,
} from './schema'

export const REQUIRED_TABLES = [
  'adaptationProjects',
  'adaptationSourceUnits',
  'agentConversations',
  'agentEvents',
  'agentRunArtifacts',
  'agentRunCheckpoints',
  'agentRunEvents',
  'agentRuns',
  'aiUsageLog',
  'chapters',
  'characterDrivenPlans',
  'characterRelations',
  'characters',
  'codexCategories',
  'codexEntries',
  'comicMediaAssets',
  'comicPages',
  'comicPanels',
  'comicVisualSubjects',
  'creativeRules',
  'cultivationProgress',
  'cultivationSystems',
  'detailedOutlines',
  'emotionBeatCards',
  'foreshadows',
  'geographies',
  'historicalKeywords',
  'historicalTimelineEvents',
  'histories',
  'importFiles',
  'importJobs',
  'importLogs',
  'importSessions',
  'inspirationWorkspaces',
  'importantLocations',
  'itemLedger',
  'knowledgeLedger',
  'mediaBlobObjects',
  'narrativeBeats',
  'narrativeChoices',
  'narrativeModules',
  'narrativeNodes',
  'narrativeSummaryNodes',
  'nodeFlows',
  'nodeRuns',
  'notes',
  'outlineNodes',
  'ownershipScopeChanges',
  'powerSystems',
  'productBuildArtifacts',
  'productBuilds',
  'productMediaAssets',
  'productMediaBlobs',
  'productProductionBriefs',
  'productProductionCommands',
  'productProductions',
  'productQualityGateReceipts',
  'productReleases',
  'productRuntimeCheckpoints',
  'productRuntimeEvents',
  'productRuntimeSessions',
  'projects',
  'promptTemplates',
  'promptWorkflows',
  'referenceAnalysisRuns',
  'referenceAnalysisSources',
  'referenceChunkAnalysis',
  'references',
  'retrievalChunks',
  'screenplayScenes',
  'snapshots',
  'stateCards',
  'storyArcs',
  'storyCores',
  'storylineCrossings',
  'storylineProgress',
  'storyTimelineEvents',
  'temporalFacts',
  'ttrpgRulePacks',
  'ttrpgRuntimeAssetRequests',
  'ttrpgSessionParticipants',
  'userStyleProfiles',
  'workCharacterBindings',
  'works',
  'workspaceDocuments',
  'worldDerivations',
  'worldGroupLinks',
  'worldGroups',
  'worldNodes',
  'worldReleases',
  'worldRevisions',
  'worldRulesProfiles',
  'worlds',
  'worldviews',
] as const

export interface CurrentSchemaState {
  version: number
  tables: string[]
}

export function assertCurrentSchemaDefinition(): void {
  const declared = Object.keys(STORYFORGE_STORES).sort()
  const required = [...REQUIRED_TABLES].sort()
  if (declared.length !== required.length
    || declared.some((name, index) => name !== required[index])) {
    throw new Error('[schema] REQUIRED_TABLES 与唯一当前 schema 不一致')
  }
}

/**
 * Opens and verifies the only supported database schema. There is no upgrade,
 * import or compatibility path from any prior database generation.
 */
export async function openCurrentSchema(): Promise<CurrentSchemaState> {
  assertCurrentSchemaDefinition()
  await db.open()
  if (db.verno !== STORYFORGE_SCHEMA_VERSION) {
    db.close()
    throw new Error('[schema] 只支持当前 schema v' + STORYFORGE_SCHEMA_VERSION)
  }
  const tables = db.tables.map(table => table.name).sort()
  const expected = [...REQUIRED_TABLES].sort()
  if (tables.length !== expected.length
    || tables.some((name, index) => name !== expected[index])) {
    db.close()
    throw new Error('[schema] 当前数据库表集合与代码定义不一致')
  }
  return { version: db.verno, tables }
}

assertCurrentSchemaDefinition()
