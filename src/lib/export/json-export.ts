/**
 * 项目 JSON 导出/导入 · 对外门面
 *
 * AUDIT-1 后:导出/导入主体已由注册表派生(registry-export.ts / registry-import.ts),
 * 本文件只保留「导出格式契约类型 ProjectExportData」+「对外 API 门面」+「下载工具」。
 * 加新表 = 在 PROJECT_TABLES 登记一行即自动进出导出,无需再手改本文件。
 *
 * 当前格式的完整往返、所有权重映射与全表覆盖由回归测试锁死。
 */
import { deriveExportProjectJSON } from './registry-export'
import { assertTrustedProjectBackup } from './backup-trust'
import type {
  Project, Worldview, StoryCore, PowerSystem,
  Character, OutlineNode, Chapter,
  Foreshadow, Geography, History,
  CreativeRules, CharacterRelation,
  DetailedOutline, EmotionBeatCard, StateCard,
  StoryArc, WorldNode, Note,
  Reference, ReferenceAnalysisRun, ReferenceChunkAnalysis,
  HistoricalTimelineEvent, HistoricalKeyword,
  WorldGroup, WorldGroupLink, ItemLedgerEntry, StoryTimelineEvent,
  ImportantLocation, WorldRulesProfile, CodexCategory, CodexEntry,
  UserStyleProfile,
  KnowledgeLedgerEntry,
  StorylineProgress,
  StorylineCrossing,
  CultivationSystem,
  CultivationProgress,
  CharacterDrivenPlan,
  InspirationWorkspace,
  AgentConversation,
  AgentEvent,
  AgentRunRecord,
  AgentRunEventRecord,
  AgentRunCheckpointRecord,
  AgentRunArtifactRecordV1,
  NodeFlow,
  NodeRunRecord,
  ProductRuntimeSession,
  ProductRuntimeEvent,
  ProductRuntimeCheckpoint,
  World,
  Work,
  WorkCharacterBinding,
  NarrativeModule,
  NarrativeNode,
  WorldRevision,
  WorldRelease,
  WorldDerivationV1,
  ProductRelease,
  NarrativeBeat,
  NarrativeChoice,
  ProductMediaAsset,
  ProductMediaBlob,
  AdaptationProject,
  AdaptationSourceUnit,
  ScreenplayScene,
  ComicPage,
  ComicPanel,
  ComicVisualSubject,
  ComicMediaAsset,
  TtrpgRulePackRecordV1,
  TtrpgSessionParticipantRecordV2,
  TtrpgRuntimeAssetRequestRecordV1,
  ProductProductionRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionCommandRecordV1,
  ProductBuildRecordV1,
  ProductBuildArtifactRecordV1,
  ProductQualityGateReceiptRecordV1,
  MediaBlobObjectRecordV1,
} from '../types'
import type { TemporalFact } from '../types/temporal-fact'

type WorldGroupExportRef = {
  _worldGroupExportId?: number | null
}

type HomeWorldGroupExportRef = {
  _homeWorldGroupExportId?: number | null
}

/**
 * 完整项目导出数据结构(导出格式契约)
 *
 * 只表示当前完整备份协议；旧协议不会进入当前导入器。
 */
export interface ProjectExportData {
  version: number
  exportedAt: number
  ownership: {
    contractVersion: number
    worldExportId: number
    workExportId: number
  }
  project: Omit<Project, 'id' | 'activeWorldId' | 'activeWorkId'> & {
    _activeWorldExportId?: number | null
    _activeWorkExportId?: number | null
  }

  /** 当前工作区的唯一所有权根。 */
  worlds: (Omit<World, 'id' | 'projectId'> & { _exportId: number })[]
  works: (
    Omit<Work, 'id' | 'projectId' | 'worldId' | 'activeCharacterDrivenPlanId' | 'activeNarrativeModuleId'>
    & {
      _exportId: number
      _worldExportId: number
      _activeCharacterDrivenPlanExportId?: number | null
      _activeNarrativeModuleExportId?: number | null
    }
  )[]
  adaptationProjects: (
    Omit<AdaptationProject, 'id' | 'projectId' | 'worldId' | 'workId' | 'sourceWorkId' | 'sourceOutlineRootId' | 'sourceStartChapterId' | 'sourceEndChapterId'>
    & {
      _exportId: number
      _worldExportId: number
      _workExportId: number
      _sourceWorkExportId?: number | null
      _sourceOutlineRootExportId?: number | null
      _sourceStartChapterExportId?: number | null
      _sourceEndChapterExportId?: number | null
    }
  )[]
  adaptationSourceUnits: (
    Omit<AdaptationSourceUnit, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'sourceOutlineNodeId' | 'sourceChapterId'>
    & {
      _exportId: number
      _workExportId: number
      _adaptationProjectExportId: number
      _sourceOutlineExportId?: number | null
      _sourceChapterExportId?: number | null
    }
  )[]
  screenplayScenes: (
    Omit<ScreenplayScene, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'sourceUnitIds'>
    & {
      _exportId: number
      _workExportId: number
      _adaptationProjectExportId: number
      _sourceUnitExportIds?: number[]
      _blockCharacterExportIds?: Array<number | null>
    }
  )[]
  comicPages: (
    Omit<ComicPage, 'id' | 'projectId' | 'workId' | 'adaptationProjectId'>
    & { _exportId: number; _workExportId: number; _adaptationProjectExportId: number }
  )[]
  comicPanels: (
    Omit<ComicPanel, 'id' | 'projectId' | 'workId' | 'pageId' | 'sourceUnitIds'>
    & { _exportId: number; _workExportId: number; _pageExportId: number; _sourceUnitExportIds?: number[] }
  )[]
  comicVisualSubjects: (
    Omit<ComicVisualSubject, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'characterId' | 'sourceUnitIds'>
    & { _exportId: number; _workExportId: number; _adaptationProjectExportId: number; _characterExportId?: number | null; _sourceUnitExportIds?: number[] }
  )[]
  comicMediaAssets: (
    Omit<ComicMediaAsset, 'id' | 'projectId' | 'workId' | 'adaptationProjectId' | 'panelId' | 'blobObjectId'>
    & { _exportId: number; _workExportId: number; _adaptationProjectExportId: number; _panelExportId?: number | null; _blobObjectExportId: number }
  )[]
  mediaBlobObjects: (
    Omit<MediaBlobObjectRecordV1, 'id' | 'projectId' | 'worldId' | 'workId' | 'data'>
    & { _exportId: number; _worldExportId: number; _workExportId: number; data: string }
  )[]
  workCharacterBindings: (
    Omit<WorkCharacterBinding, 'id' | 'projectId' | 'workId' | 'characterId'>
    & { _workExportId: number; _characterExportId: number }
  )[]
  narrativeModules: (Omit<NarrativeModule, 'id' | 'projectId'> & { _exportId: number })[]
  narrativeNodes: (
    Omit<NarrativeNode, 'id' | 'projectId' | 'moduleId' | 'sourceOutlineNodeId'>
    & { _exportId: number; _moduleExportId: number; _sourceOutlineExportId?: number | null }
  )[]
  worldRevisions: (
    Omit<WorldRevision, 'id' | 'projectId' | 'worldId' | 'parentRevisionId'>
    & { _exportId: number; _worldExportId: number; _parentExportId?: number | null }
  )[]
  worldReleases: (
    Omit<WorldRelease, 'id' | 'projectId' | 'worldId' | 'revisionId'>
    & { _exportId: number; _worldExportId: number; _revisionExportId: number }
  )[]
  worldDerivations: (
    Omit<WorldDerivationV1, 'id' | 'projectId' | 'worldId' | 'targetRevisionId' | 'targetReleaseId'>
    & { _exportId: number; _worldExportId: number; _targetRevisionExportId?: number | null; _targetReleaseExportId?: number | null }
  )[]
  productReleases: (Omit<ProductRelease, 'id' | 'projectId' | 'worldId' | 'workId' | 'worldReleaseId'> & {
    _exportId: number
    _worldExportId: number
    _workExportId: number
    _worldReleaseExportId?: number | null
  })[]
  narrativeBeats: (Omit<NarrativeBeat, 'id' | 'projectId' | 'moduleId' | 'speakerCharacterId'> & {
    _exportId: number
    _moduleExportId: number
    _speakerCharacterExportId?: number | null
  })[]
  narrativeChoices: (Omit<NarrativeChoice, 'id' | 'projectId' | 'moduleId'> & {
    _exportId: number
    _moduleExportId: number
  })[]
  productMediaAssets: (
    Omit<ProductMediaAsset, 'id' | 'projectId' | 'worldId' | 'workId' | 'productReleaseId' | 'productRuntimeSessionId'>
    & {
      _exportId: number
      _worldExportId: number
      _workExportId: number
      _productReleaseExportId?: number | null
      _productRuntimeSessionExportId?: number | null
    }
  )[]
  productMediaBlobs: (
    Omit<ProductMediaBlob, 'id' | 'projectId' | 'worldId' | 'workId' | 'mediaAssetId' | 'blobObjectId'>
    & { _exportId: number; _worldExportId: number; _workExportId: number; _mediaAssetExportId: number; _blobObjectExportId: number }
  )[]

  ttrpgRulePacks: (
    Omit<TtrpgRulePackRecordV1, 'id' | 'projectId' | 'worldId' | 'workId'>
    & { _exportId: number; _worldExportId: number; _workExportId: number }
  )[]
  productProductions: (
    Omit<ProductProductionRecordV1, 'id' | 'projectId' | 'worldId' | 'workId' | 'currentProductReleaseId'>
    & {
      _exportId: number
      _worldExportId: number
      _workExportId: number
      _currentProductReleaseExportId?: number | null
    }
  )[]
  productProductionBriefs: (
    Omit<ProductProductionBriefRecordV1, 'id' | 'projectId' | 'worldId' | 'workId' | 'productionId' | 'sourceWorldReleaseId'>
    & {
      _exportId: number
      _worldExportId: number
      _workExportId: number
      _productionExportId: number
      _sourceWorldReleaseExportId: number
    }
  )[]
  productProductionCommands: (
    Omit<ProductProductionCommandRecordV1, 'id' | 'projectId' | 'worldId' | 'workId' | 'productionId'>
    & { _exportId: number; _worldExportId: number; _workExportId: number; _productionExportId: number }
  )[]
  productBuilds: (
    Omit<ProductBuildRecordV1,
      'id' | 'projectId' | 'worldId' | 'workId' | 'productionId' | 'sourceProductReleaseId'
      | 'releasedProductReleaseId'>
    & {
      _exportId: number
      _worldExportId: number
      _workExportId: number
      _productionExportId: number
      _sourceProductReleaseExportId?: number | null
      _releasedProductReleaseExportId?: number | null
    }
  )[]
  productQualityGateReceipts: (
    Omit<ProductQualityGateReceiptRecordV1, 'id' | 'projectId' | 'worldId' | 'workId' | 'buildId'>
    & {
      _exportId: number
      _worldExportId: number
      _workExportId: number
      _buildExportId: number
    }
  )[]
  productBuildArtifacts: (
    Omit<ProductBuildArtifactRecordV1,
      'id' | 'projectId' | 'worldId' | 'workId' | 'buildId' | 'producerRunId' | 'blobObjectId'>
    & {
      _exportId: number
      _worldExportId: number
      _workExportId: number
      _buildExportId: number
      _producerRunExportId?: number | null
      _blobObjectExportId?: number | null
    }
  )[]
  ttrpgSessionParticipants: (
    Omit<TtrpgSessionParticipantRecordV2, 'id' | 'projectId' | 'worldGroupId' | 'worldId' | 'workId' | 'sessionId'>
    & {
      _worldGroupExportId?: number | null
      _worldExportId: number
      _workExportId: number
      _productRuntimeSessionExportId: number
    }
  )[]
  ttrpgRuntimeAssetRequests: (
    Omit<TtrpgRuntimeAssetRequestRecordV1, 'id' | 'projectId' | 'worldGroupId' | 'worldId' | 'workId' | 'sessionId' | 'mediaAssetId'>
    & {
      _worldGroupExportId?: number | null
      _worldExportId: number
      _workExportId: number
      _productRuntimeSessionExportId: number
      _mediaAssetExportId?: number | null
    }
  )[]

  // ── 原有（v1）──
  worldviews: (Omit<Worldview, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  storyCores: Omit<StoryCore, 'id' | 'projectId'>[]
  powerSystems: (Omit<PowerSystem, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  characters: (Omit<Character, 'id' | 'projectId' | 'homeWorldGroupId'> & HomeWorldGroupExportRef)[]
  outlineNodes: (Omit<OutlineNode, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef & { _exportId: number; _parentExportId: number | null })[]
  chapters: (Omit<Chapter, 'id' | 'projectId' | 'outlineNodeId'> & { _outlineExportId: number })[]
  foreshadows: Omit<Foreshadow, 'id' | 'projectId'>[]
  geographies: (Omit<Geography, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  histories: (Omit<History, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  creativeRules: Omit<CreativeRules, 'id' | 'projectId'>[]
  characterRelations: (Omit<CharacterRelation, 'id' | 'projectId' | 'fromCharacterId' | 'toCharacterId'> & {
    _fromCharacterIndex: number
    _toCharacterIndex: number
  })[]

  // ── 新增（v2）──
  detailedOutlines: (Omit<DetailedOutline, 'id' | 'projectId' | 'outlineNodeId'> & { _outlineExportId: number })[]
  emotionBeatCards: (Omit<EmotionBeatCard, 'id' | 'projectId' | 'chapterId'> & { _chapterExportId: number })[]
  stateCards: Omit<StateCard, 'id' | 'projectId'>[]
  /** FB-5 文风画像(每项目单例) */
  userStyleProfiles: Omit<UserStyleProfile, 'id' | 'projectId'>[]
  /** CM-1 增量灵感碎片与确认版本(每项目单例) */
  inspirationWorkspaces: Omit<InspirationWorkspace, 'id' | 'projectId'>[]
  /** PLATFORM-2 / AGENT-1 总对话（世界与事件引用由注册表重映射）。 */
  agentConversations: (
    Omit<AgentConversation, 'id' | 'projectId' | 'worldGroupId'>
    & WorldGroupExportRef
    & { _exportId: number }
  )[]
  agentEvents: (
    Omit<AgentEvent, 'id' | 'projectId' | 'conversationId' | 'durableRunId'>
    & { _conversationExportId: number; _agentRunExportId?: number | null }
  )[]
  /** HARNESS-1 可恢复运行账本；事件/检查点只通过便携 run ID 关联。 */
  agentRuns: (
    Omit<AgentRunRecord, 'id' | 'projectId' | 'workId' | 'productRuntimeSessionId' | 'productBuildId' | 'worldGroupId' | 'conversationId' | 'parentRunId'>
    & WorldGroupExportRef
    & {
      _exportId: number
      _parentExportId?: number | null
      _workOwnerExportId?: number
      _instanceOwnerExportId?: number
      _productRuntimeSessionExportId?: number | null
      _productBuildExportId?: number | null
      _conversationExportId?: number | null
    }
  )[]
  agentRunEvents: (
    Omit<AgentRunEventRecord, 'id' | 'projectId' | 'worldGroupId' | 'runId'>
    & WorldGroupExportRef
    & { _agentRunExportId: number }
  )[]
  agentRunCheckpoints: (
    Omit<AgentRunCheckpointRecord, 'id' | 'projectId' | 'worldGroupId' | 'runId'>
    & WorldGroupExportRef
    & { _agentRunExportId: number }
  )[]
  /** CTXG-2 content-addressed exact evidence bodies and prune tombstones. */
  agentRunArtifacts: Omit<AgentRunArtifactRecordV1, 'id' | 'projectId'>[]
  /** 领域节点模式的可视编排文档与运行记录。 */
  nodeFlows: (
    Omit<NodeFlow, 'id' | 'projectId' | 'worldGroupId'>
    & WorldGroupExportRef
    & { _exportId: number }
  )[]
  nodeRuns: (
    Omit<NodeRunRecord, 'id' | 'projectId' | 'flowId'>
    & { _flowExportId: number }
  )[]
  /** ProductRuntime 上层产品运行态；世界语义与产品私域严格分层。 */
  productRuntimeSessions: (
    Omit<ProductRuntimeSession,
      'id' | 'projectId' | 'worldGroupId' | 'worldId' | 'workId'
      | 'productReleaseId' | 'productBuildId' | 'parentSessionId'>
    & WorldGroupExportRef
    & {
      _exportId: number
      _worldExportId?: number | null
      _workExportId?: number | null
      _productReleaseExportId?: number | null
      _productBuildExportId?: number | null
      _parentSessionExportId?: number | null
    }
  )[]
  productRuntimeEvents: (
    Omit<ProductRuntimeEvent, 'id' | 'projectId' | 'worldGroupId' | 'sessionId'>
    & WorldGroupExportRef
    & { _productRuntimeSessionExportId: number }
  )[]
  productRuntimeCheckpoints: (
    Omit<ProductRuntimeCheckpoint, 'id' | 'projectId' | 'worldGroupId' | 'sessionId'>
    & WorldGroupExportRef
    & { _productRuntimeSessionExportId: number }
  )[]
  /** NS-4 时序事实账本(各 FK 在派生导出里被 remap 成 _xxxExportId) */
  temporalFacts: (Omit<TemporalFact, 'id' | 'projectId'> & Record<string, unknown>)[]
  /** CONSISTENCY-2 角色认知事件账本（全部 FK 由注册表重映射）。 */
  knowledgeLedger: (Omit<KnowledgeLedgerEntry, 'id' | 'projectId'> & Record<string, unknown>)[]
  storyArcs: Omit<StoryArc, 'id' | 'projectId'>[]
  /** Phase 39 作者确认的故事线动态投影（FK 由注册表重映射）。 */
  storylineProgress: (Omit<StorylineProgress, 'id' | 'projectId'> & Record<string, unknown>)[]
  /** Phase 39 作者确认的故事线交汇（FK 由注册表重映射）。 */
  storylineCrossings: (Omit<StorylineCrossing, 'id' | 'projectId'> & Record<string, unknown>)[]
  worldNodes: (Omit<WorldNode, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef & { _exportId: number; _parentExportId: number | null })[]
  notes: Omit<Note, 'id' | 'projectId'>[]
  references: (Omit<Reference, 'id' | 'projectId'> & { _exportId: number })[]
  referenceAnalysisRuns: (
    Omit<ReferenceAnalysisRun, 'id' | 'projectId' | 'referenceId'>
    & { _exportId: number; _referenceExportId: number }
  )[]
  referenceChunkAnalysis: (
    Omit<ReferenceChunkAnalysis, 'id' | 'referenceId' | 'analysisRunId'>
    & { _referenceExportId: number; _analysisRunExportId?: number | null }
  )[]
  historicalTimelineEvents: (Omit<HistoricalTimelineEvent, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  historicalKeywords: (Omit<HistoricalKeyword, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]

  // ── v3: 多世界系统（Phase 25.4）──
  worldGroups: (Omit<WorldGroup, 'id' | 'projectId'> & { _exportId: number })[]
  worldGroupLinks: (Omit<WorldGroupLink, 'id' | 'projectId' | 'fromGroupId' | 'toGroupId'> & {
    _fromGroupExportId: number
    _toGroupExportId: number
  })[]

  // ── v3: 物品流水（Phase 25.5.2-b，chapterId 可空）──
  itemLedger: (Omit<ItemLedgerEntry, 'id' | 'projectId' | 'chapterId'> & { _chapterExportId: number | null })[]
  // ── v3: 故事进程年表（Phase 25.5.2-a，chapterId 可空）──
  storyTimelineEvents: (Omit<StoryTimelineEvent, 'id' | 'projectId' | 'chapterId'> & { _chapterExportId: number | null })[]

  // ── 此前漏导出（会丢数据），补全 ──
  importantLocations: (Omit<ImportantLocation, 'id' | 'projectId' | 'parentId'> & { _exportId: number; _parentExportId: number | null })[]
  worldRulesProfiles: (Omit<WorldRulesProfile, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  codexCategories: (Omit<CodexCategory, 'id' | 'projectId' | 'parentId'> & { _exportId: number; _parentExportId: number | null })[]
  codexEntries: (Omit<CodexEntry, 'id' | 'projectId' | 'categoryId' | 'worldGroupId'> & WorldGroupExportRef & { _categoryExportId: number })[]
  /** WORLD-1 / Phase 37 修炼流派与境界 DAG（角色/异兽 FK 由注册表重映射）。 */
  cultivationSystems: (Omit<CultivationSystem, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef & { _exportId: number })[]
  /** WORLD-1 / Phase 34 作者确认的正文修炼事件（四类 FK 由注册表重映射）。 */
  cultivationProgress: (Omit<CultivationProgress, 'id' | 'projectId'> & Record<string, unknown>)[]
  /** STORY-1 / CF-9C 角色驱动设计方案（角色、父版本及 active 引用均便携重映射）。 */
  characterDrivenPlans: (
    Omit<CharacterDrivenPlan, 'id' | 'projectId' | 'parentPlanId'>
    & { _exportId: number; _parentExportId: number | null; _arcCharacterIndexes?: Array<number | null> }
  )[]
}

/** 导出项目为当前完整 JSON 备份(注册表派生) */
export async function exportProjectJSON(projectId: number): Promise<ProjectExportData> {
  return deriveExportProjectJSON(projectId)
}

/** 下载 JSON 文件 */
export function downloadJSON(data: ProjectExportData, filename: string) {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 导入当前格式项目 JSON，返回新项目 ID。 */
export async function importProjectJSON(data: ProjectExportData): Promise<number> {
  // 预检必须发生在事务外、写库前；失败时保证项目表也不会出现半导入根记录。
  assertTrustedProjectBackup(data)
  // 严格导入、全表拓扑重映射与二进制校验只在作者实际选择导入时需要；按需加载可
  // 避免首页与日常写作静态携带完整恢复引擎，同时仍保留同一个公开 API/事务边界。
  const { deriveImportProjectJSON } = await import('./registry-import')
  return deriveImportProjectJSON(data)
}
