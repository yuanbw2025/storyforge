import Dexie, { type Table } from 'dexie'
import type {
  AdaptationProject,
  AdaptationSourceUnit,
  AgentConversation,
  AgentEvent,
  AgentRunArtifactRecordV1,
  AgentRunCheckpointRecord,
  AgentRunEventRecord,
  AgentRunRecord,
  Chapter,
  Character,
  CharacterDrivenPlan,
  CharacterRelation,
  CodexCategory,
  CodexEntry,
  ComicMediaAsset,
  ComicPage,
  ComicPanel,
  ComicVisualSubject,
  CreativeRules,
  CultivationProgress,
  CultivationSystem,
  DetailedOutline,
  EmotionBeatCard,
  Foreshadow,
  Geography,
  HistoricalKeyword,
  HistoricalTimelineEvent,
  History,
  ImportantLocation,
  ImportFileBlob,
  ImportJob,
  ImportLog,
  ImportSession,
  InspirationWorkspace,
  ItemLedgerEntry,
  MediaBlobObjectRecordV1,
  NarrativeBeat,
  NarrativeChoice,
  NarrativeModule,
  NarrativeNode,
  NodeFlow,
  NodeRunRecord,
  Note,
  OutlineNode,
  OwnershipScopeChangeRecord,
  PowerSystem,
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductMediaAsset,
  ProductMediaBlob,
  ProductProductionBriefRecordV1,
  ProductProductionCommandRecordV1,
  ProductProductionRecordV1,
  ProductQualityGateReceiptRecordV1,
  ProductRelease,
  ProductRuntimeCheckpoint,
  ProductRuntimeEvent,
  ProductRuntimeSession,
  Project,
  PromptTemplate,
  PromptWorkflow,
  Reference,
  ReferenceAnalysisRun,
  ReferenceAnalysisSource,
  ReferenceChunkAnalysis,
  ScreenplayScene,
  Snapshot,
  StateCard,
  StoryArc,
  StoryCore,
  StorylineCrossing,
  StorylineProgress,
  StoryTimelineEvent,
  TtrpgRulePackRecordV1,
  TtrpgRuntimeAssetRequestRecordV1,
  TtrpgSessionParticipantRecordV2,
  UserStyleProfile,
  Work,
  WorkCharacterBinding,
  WorkspaceDocumentBindingV1,
  World,
  WorldDerivationV1,
  WorldGroup,
  WorldGroupLink,
  WorldNode,
  WorldRelease,
  WorldRevision,
  WorldRulesProfile,
  Worldview,
} from '../types'
import type { AIUsageEntry } from '../ai/usage-log'
import type { KnowledgeLedgerEntry } from '../types/knowledge-ledger'
import type { NarrativeSummaryNode } from '../types/narrative-summary'
import type { RetrievalChunk } from '../types/retrieval-chunk'
import type { TemporalFact } from '../types/temporal-fact'

export const STORYFORGE_DATABASE_NAME = 'storyforge-core'
export const STORYFORGE_SCHEMA_VERSION = 1

/** The only persistent schema understood by the current application. */
export const STORYFORGE_STORES = {
  projects: '++id, &workspaceUid, workspacePurpose, name, createdAt, updatedAt',
  worlds: '++id, projectId, identityKind, code, [projectId+identityKind], [projectId+updatedAt]',
  works: '++id, projectId, worldId, code, &[projectId+code], [projectId+worldId], [worldId+updatedAt], status, activeNarrativeModuleId',
  workCharacterBindings: '++id, projectId, workId, characterId, &[workId+characterId], [projectId+workId]',
  ownershipScopeChanges: '++id, projectId, worldId, workId, tableName, recordId, createdAt',
  worldviews: '++id, projectId',
  storyCores: '++id, projectId',
  powerSystems: '++id, projectId',
  characters: '++id, projectId, name, roleWeight, moralAxis, orderAxis, statusEvidenceChapterId',
  outlineNodes: '++id, projectId, parentId, order, type',
  chapters: '++id, projectId, outlineNodeId, order, status',
  foreshadows: '++id, projectId, status, type',
  geographies: '++id, projectId',
  histories: '++id, projectId',
  creativeRules: '++id, projectId',
  characterRelations: '++id, projectId, fromCharacterId, toCharacterId',
  snapshots: '++id, projectId, type, createdAt',
  references: '++id, projectId, type, createdAt',
  promptTemplates: '++id, scope, moduleKey, isActive, updatedAt',
  detailedOutlines: '++id, projectId, outlineNodeId',
  importJobs: '++id, projectId, type, status, createdAt',
  importSessions: '++id, projectId, status, updatedAt, fileHash, targetWorldGroupId',
  importLogs: '++id, sessionId, chunkIndex, createdAt',
  importFiles: 'sessionId, fileHash, createdAt',
  promptWorkflows: '++id, scope, isDefault, updatedAt',
  referenceChunkAnalysis: '++id, referenceId, analysisRunId, [analysisRunId+chunkIndex], chunkIndex',
  referenceAnalysisRuns: '++id, projectId, referenceId, [referenceId+version], status, updatedAt',
  referenceAnalysisSources: 'analysisRunId, fileHash, createdAt',
  stateCards: '++id, projectId, category, entityName, lastChapterId',
  emotionBeatCards: '++id, projectId, chapterId',
  storyArcs: '++id, projectId, type, sourceStoryCoreId, producerRunId',
  notes: '++id, projectId, chapterId, pinned',
  worldNodes: '++id, projectId, parentId, sortOrder',
  historicalTimelineEvents: '++id, projectId, era, year',
  historicalKeywords: '++id, projectId, category, era',
  importantLocations: '++id, projectId, parentId, sortOrder',
  worldRulesProfiles: '++id, projectId, worldGroupId',
  worldGroups: '++id, projectId, type, order',
  worldGroupLinks: '++id, projectId, fromGroupId, toGroupId',
  itemLedger: '++id, projectId, itemName, chapterId',
  storyTimelineEvents: '++id, projectId, chapterId, order',
  codexCategories: '++id, projectId, domain, parentId, builtInKey, order',
  codexEntries: '++id, projectId, categoryId, worldGroupId, order, producerRunId',
  cultivationSystems: '++id, projectId, worldGroupId, name',
  cultivationProgress: '++id, projectId, worldGroupId, characterId, cultivationSystemId, sourceChapterId, status',
  characterDrivenPlans: '++id, projectId, status, parentPlanId, updatedAt',
  inspirationWorkspaces: '++id, projectId, updatedAt',
  userStyleProfiles: '++id, projectId',
  aiUsageLog: '++id, projectId, timestamp, category, model',
  temporalFacts: '++id, projectId, worldGroupId, characterId, locationId, codexEntryId, predicate, status, sourceChapterId',
  knowledgeLedger: '++id, projectId, worldGroupId, characterId, knowledgeKey, factId, sourceChapterId, status',
  storylineProgress: '++id, &arcId, projectId, status, lastActiveChapterId',
  storylineCrossings: '++id, projectId, arcIdA, arcIdB, chapterId',
  retrievalChunks: '++id, projectId, worldGroupId, sourceChapterId',
  narrativeSummaryNodes: '++id, projectId, worldGroupId, level, sourceChapterId, sourceOutlineNodeId, status',
  agentConversations: '++id, projectId, worldGroupId, status, updatedAt',
  agentEvents: '++id, projectId, conversationId, durableRunId, [conversationId+sequence], kind, createdAt',
  agentRuns: '++id, projectId, workId, productRuntimeSessionId, productBuildId, worldGroupId, conversationId, parentRunId, &[parentRunId+parentRelation], status, updatedAt',
  agentRunEvents: '++id, projectId, worldGroupId, runId, &[runId+sequence], type, createdAt',
  agentRunCheckpoints: '++id, projectId, worldGroupId, runId, &[runId+throughSequence], createdAt',
  agentRunArtifacts: '++id, projectId, &[projectId+artifactKind+contentHash], contentHash, retentionState, createdAt',
  nodeFlows: '++id, projectId, worldGroupId, updatedAt',
  nodeRuns: '++id, projectId, flowId, status, updatedAt',
  narrativeModules: '++id, projectId, worldId, workId, kind, status, updatedAt',
  narrativeNodes: '++id, projectId, moduleId, sourceOutlineNodeId, order',
  narrativeBeats: '++id, projectId, moduleId, nodeKey, &[moduleId+beatKey], [moduleId+nodeKey], speakerCharacterId, order',
  narrativeChoices: '++id, projectId, moduleId, sourceNodeKey, &[moduleId+choiceKey], [moduleId+sourceNodeKey], targetNodeKey, order',
  worldRevisions: '++id, projectId, worldId, parentRevisionId, revision, contentHash, updatedAt',
  worldReleases: '++id, releaseUid, projectId, worldId, revisionId, version, contentHash, createdAt',
  worldDerivations: '++id, projectId, worldId, sourceWorkspaceUid, sourceWorkCode, sourceContentHash, targetRevisionId, targetReleaseId, createdAt',
  workspaceDocuments: '++id, projectId, workspaceUid, documentId, &[projectId+documentId], relativePath, &[projectId+relativePath], tableName, recordId, &[projectId+tableName+recordId], worldCode, workCode, lastSyncRunId, updatedAt',
  adaptationProjects: '++id, projectId, worldId, &workId, sourceWorkId, sourceOutlineRootId, sourceStartChapterId, sourceEndChapterId, medium, status, updatedAt',
  adaptationSourceUnits: '++id, projectId, workId, adaptationProjectId, &[adaptationProjectId+manifestVersion+sourceUnitKey], [adaptationProjectId+manifestVersion], sourceOutlineNodeId, sourceChapterId, order',
  screenplayScenes: '++id, projectId, workId, adaptationProjectId, &[adaptationProjectId+stableKey], &[adaptationProjectId+episodeNumber+sceneNumber], [adaptationProjectId+episodeNumber], order, status, updatedAt',
  comicPages: '++id, projectId, workId, adaptationProjectId, &[adaptationProjectId+stableKey], &[adaptationProjectId+order], chapterNumber, status, updatedAt',
  comicPanels: '++id, projectId, workId, pageId, &[workId+stableKey], &[pageId+order], status, updatedAt',
  comicVisualSubjects: '++id, projectId, workId, adaptationProjectId, &[workId+stableKey], kind, characterId, locationRefKey, status, updatedAt',
  comicMediaAssets: '++id, projectId, workId, adaptationProjectId, &[workId+stableKey], role, origin, panelId, subjectKey, blobObjectId, disposition, requestHash, &[workId+requestHash+candidateIndex], updatedAt',
  mediaBlobObjects: '++id, projectId, worldId, workId, &[workId+contentHash], mimeType, disposition, storageState, leaseExpiresAt, byteSize, updatedAt',
  productProductions: '++id, projectId, worldId, workId, productType, &[workId+productionKey], [workId+productType], status, currentProductReleaseId, updatedAt',
  productProductionBriefs: '++id, projectId, worldId, workId, productionId, &[productionId+revision], &[productionId+briefHash], [productionId+status], sourceWorldReleaseId, sourcePlanHash, confirmedBriefHash, createdAt',
  productProductionCommands: '++id, projectId, worldId, workId, productionId, &[productionId+commandId], [productionId+status], type, createdAt',
  productBuilds: '++id, projectId, worldId, workId, productionId, &[productionId+buildNumber], [productionId+status], sourceProductReleaseId, packageHash, previewHash, releasedProductReleaseId, updatedAt',
  productBuildArtifacts: '++id, projectId, worldId, workId, buildId, &[buildId+artifactKey+version], [buildId+status], [buildId+requirementKey], producerRunId, blobObjectId, contentHash, createdAt',
  productQualityGateReceipts: '++id, projectId, worldId, workId, buildId, &[buildId+gateId+receiptHash], [buildId+gateId], [buildId+status], gateId, status, createdAt',
  productReleases: '++id, projectId, worldId, workId, productType, productionKey, worldReleaseId, &[workId+productionKey+version], [workId+productType], contentHash, createdAt',
  productMediaAssets: '++id, projectId, worldId, workId, ownerKind, productType, productReleaseId, productRuntimeSessionId, &[productReleaseId+assetKey+version], &[productRuntimeSessionId+assetKey+version], [workId+productType], contentHash, updatedAt',
  productMediaBlobs: '++id, projectId, worldId, workId, &mediaAssetId, blobObjectId',
  ttrpgRulePacks: '++id, projectId, worldId, workId, &[workId+ruleSystemId+ruleSystemVersion], [workId+status], contentHash, updatedAt',
  productRuntimeSessions: '++id, projectId, worldGroupId, worldId, workId, productReleaseId, productBuildId, runtimeSourceHash, kind, status, parentSessionId, updatedAt',
  productRuntimeEvents: '++id, projectId, worldGroupId, sessionId, &[sessionId+sequence], &[sessionId+commandId], type, createdAt',
  productRuntimeCheckpoints: '++id, projectId, worldGroupId, sessionId, [sessionId+throughSequence], createdAt',
  ttrpgSessionParticipants: '++id, projectId, worldGroupId, worldId, workId, sessionId, &[sessionId+seatKey], &[sessionId+viewerKey], [sessionId+actorKey], role, controller, assignmentState, updatedAt',
  ttrpgRuntimeAssetRequests: '++id, projectId, worldGroupId, worldId, workId, sessionId, &[sessionId+requestKey], [sessionId+slotKey], [sessionId+status], priority, mediaAssetId, processorLeaseExpiresAt, updatedAt',
} as const satisfies Record<string, string>

export class StoryForgeDB extends Dexie {
  projects!: Table<Project>
  worlds!: Table<World, number>
  works!: Table<Work, number>
  workCharacterBindings!: Table<WorkCharacterBinding, number>
  ownershipScopeChanges!: Table<OwnershipScopeChangeRecord, number>
  worldviews!: Table<Worldview>
  storyCores!: Table<StoryCore>
  powerSystems!: Table<PowerSystem>
  characters!: Table<Character>
  outlineNodes!: Table<OutlineNode>
  chapters!: Table<Chapter>
  foreshadows!: Table<Foreshadow>
  geographies!: Table<Geography>
  histories!: Table<History>
  creativeRules!: Table<CreativeRules>
  characterRelations!: Table<CharacterRelation>
  snapshots!: Table<Snapshot>
  references!: Table<Reference>
  promptTemplates!: Table<PromptTemplate>
  detailedOutlines!: Table<DetailedOutline>
  importJobs!: Table<ImportJob>
  importSessions!: Table<ImportSession>
  importLogs!: Table<ImportLog>
  importFiles!: Table<ImportFileBlob, number>
  promptWorkflows!: Table<PromptWorkflow>
  referenceChunkAnalysis!: Table<ReferenceChunkAnalysis, number>
  referenceAnalysisRuns!: Table<ReferenceAnalysisRun, number>
  referenceAnalysisSources!: Table<ReferenceAnalysisSource, number>
  stateCards!: Table<StateCard, number>
  emotionBeatCards!: Table<EmotionBeatCard, number>
  storyArcs!: Table<StoryArc, number>
  notes!: Table<Note, number>
  worldNodes!: Table<WorldNode, number>
  historicalTimelineEvents!: Table<HistoricalTimelineEvent, number>
  historicalKeywords!: Table<HistoricalKeyword, number>
  importantLocations!: Table<ImportantLocation, number>
  worldRulesProfiles!: Table<WorldRulesProfile, number>
  worldGroups!: Table<WorldGroup, number>
  worldGroupLinks!: Table<WorldGroupLink, number>
  itemLedger!: Table<ItemLedgerEntry, number>
  storyTimelineEvents!: Table<StoryTimelineEvent, number>
  codexCategories!: Table<CodexCategory, number>
  codexEntries!: Table<CodexEntry, number>
  cultivationSystems!: Table<CultivationSystem, number>
  cultivationProgress!: Table<CultivationProgress, number>
  characterDrivenPlans!: Table<CharacterDrivenPlan, number>
  inspirationWorkspaces!: Table<InspirationWorkspace, number>
  userStyleProfiles!: Table<UserStyleProfile, number>
  aiUsageLog!: Table<AIUsageEntry, number>
  temporalFacts!: Table<TemporalFact, number>
  knowledgeLedger!: Table<KnowledgeLedgerEntry, number>
  storylineProgress!: Table<StorylineProgress, number>
  storylineCrossings!: Table<StorylineCrossing, number>
  retrievalChunks!: Table<RetrievalChunk, number>
  narrativeSummaryNodes!: Table<NarrativeSummaryNode, number>
  agentConversations!: Table<AgentConversation, number>
  agentEvents!: Table<AgentEvent, number>
  agentRuns!: Table<AgentRunRecord, number>
  agentRunEvents!: Table<AgentRunEventRecord, number>
  agentRunCheckpoints!: Table<AgentRunCheckpointRecord, number>
  agentRunArtifacts!: Table<AgentRunArtifactRecordV1, number>
  nodeFlows!: Table<NodeFlow, number>
  nodeRuns!: Table<NodeRunRecord, number>
  narrativeModules!: Table<NarrativeModule, number>
  narrativeNodes!: Table<NarrativeNode, number>
  narrativeBeats!: Table<NarrativeBeat, number>
  narrativeChoices!: Table<NarrativeChoice, number>
  worldRevisions!: Table<WorldRevision, number>
  worldReleases!: Table<WorldRelease, number>
  worldDerivations!: Table<WorldDerivationV1, number>
  workspaceDocuments!: Table<WorkspaceDocumentBindingV1, number>
  adaptationProjects!: Table<AdaptationProject, number>
  adaptationSourceUnits!: Table<AdaptationSourceUnit, number>
  screenplayScenes!: Table<ScreenplayScene, number>
  comicPages!: Table<ComicPage, number>
  comicPanels!: Table<ComicPanel, number>
  comicVisualSubjects!: Table<ComicVisualSubject, number>
  comicMediaAssets!: Table<ComicMediaAsset, number>
  mediaBlobObjects!: Table<MediaBlobObjectRecordV1, number>
  productProductions!: Table<ProductProductionRecordV1, number>
  productProductionBriefs!: Table<ProductProductionBriefRecordV1, number>
  productProductionCommands!: Table<ProductProductionCommandRecordV1, number>
  productBuilds!: Table<ProductBuildRecordV1, number>
  productBuildArtifacts!: Table<ProductBuildArtifactRecordV1, number>
  productQualityGateReceipts!: Table<ProductQualityGateReceiptRecordV1, number>
  productReleases!: Table<ProductRelease, number>
  productMediaAssets!: Table<ProductMediaAsset, number>
  productMediaBlobs!: Table<ProductMediaBlob, number>
  ttrpgRulePacks!: Table<TtrpgRulePackRecordV1, number>
  productRuntimeSessions!: Table<ProductRuntimeSession, number>
  productRuntimeEvents!: Table<ProductRuntimeEvent, number>
  productRuntimeCheckpoints!: Table<ProductRuntimeCheckpoint, number>
  ttrpgSessionParticipants!: Table<TtrpgSessionParticipantRecordV2, number>
  ttrpgRuntimeAssetRequests!: Table<TtrpgRuntimeAssetRequestRecordV1, number>

  constructor(databaseName = STORYFORGE_DATABASE_NAME) {
    super(databaseName)
    this.version(STORYFORGE_SCHEMA_VERSION).stores(STORYFORGE_STORES)
  }
}

export const db = new StoryForgeDB()
