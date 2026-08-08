/**
 * 项目 JSON 导出/导入 · 对外门面
 *
 * AUDIT-1 后:导出/导入主体已由注册表派生(registry-export.ts / registry-import.ts),
 * 本文件只保留「导出格式契约类型 ProjectExportData」+「对外 API 门面」+「下载工具」。
 * 加新表 = 在 PROJECT_TABLES 登记一行即自动进出导出,无需再手改本文件。
 *
 * 行为等价/兼容由测试锁死:
 *   R-export-derive-equivalence(派生 ≡ 旧手写,逐字段)
 *   R-export-derive-roundtrip(派生往返 + 新旧交叉)
 *   R-export-fullcoverage(全表多世界往返)
 *   R-export-legacy-fixture(派生导入真实旧格式 fixture)
 */
import { deriveExportProjectJSON } from './registry-export'
import { deriveImportProjectJSON } from './registry-import'
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
  NodeFlow,
  NodeRunRecord,
  SimulationSession,
  SimulationEvent,
  SimulationCheckpoint,
  World,
  Work,
  WorkCharacterBinding,
  NarrativeModule,
  NarrativeNode,
  WorldRevision,
  WorldRelease,
} from '../types'
import type { TemporalFact } from '../types/temporal-fact'

type WorldGroupExportRef = {
  _worldGroupExportId?: number | null
  /** Legacy export compatibility only. New exports should not write this field. */
  worldGroupId?: number | null
}

type HomeWorldGroupExportRef = {
  _homeWorldGroupExportId?: number | null
  /** Legacy export compatibility only. New exports should not write this field. */
  homeWorldGroupId?: number | null
}

/**
 * 完整项目导出数据结构(导出格式契约)
 *
 * version 历史：
 *   1 — 初始版本（14 张表）
 *   2 — 补全全部项目数据（2026-05-27）
 *   3 — 多世界系统（2026-06-02，Phase 25.4）
 *   4 — World/Work owner 便携影子 ID（WORLD-2C C4）
 */
export interface ProjectExportData {
  version: number
  exportedAt: number
  ownership?: {
    contractVersion: number
    worldExportId: number
    workExportId: number
  }
  project: Omit<Project, 'id' | 'activeCharacterDrivenPlanId' | 'activeWorldId' | 'activeWorkId'> & {
    _activeCharacterDrivenPlanExportId?: number | null
    _activeWorldExportId?: number | null
    _activeWorkExportId?: number | null
  }

  /** WORLD-2C C1 roots; absent in v1-v3 legacy fixtures and empty before C2 migration. */
  worlds?: (Omit<World, 'id' | 'projectId'> & { _exportId: number })[]
  works?: (
    Omit<Work, 'id' | 'projectId' | 'worldId' | 'activeCharacterDrivenPlanId' | 'activeNarrativeModuleId'>
    & {
      _exportId: number
      _worldExportId: number
      _activeCharacterDrivenPlanExportId?: number | null
      _activeNarrativeModuleExportId?: number | null
    }
  )[]
  workCharacterBindings?: (
    Omit<WorkCharacterBinding, 'id' | 'projectId' | 'workId' | 'characterId'>
    & { _workExportId: number; _characterExportId: number }
  )[]
  narrativeModules?: (Omit<NarrativeModule, 'id' | 'projectId'> & { _exportId: number })[]
  narrativeNodes?: (
    Omit<NarrativeNode, 'id' | 'projectId' | 'moduleId' | 'sourceOutlineNodeId'>
    & { _exportId: number; _moduleExportId: number; _sourceOutlineExportId?: number | null }
  )[]
  worldRevisions?: (
    Omit<WorldRevision, 'id' | 'projectId' | 'worldId' | 'parentRevisionId'>
    & { _exportId: number; _worldExportId: number; _parentExportId?: number | null }
  )[]
  worldReleases?: (
    Omit<WorldRelease, 'id' | 'projectId' | 'worldId' | 'revisionId'>
    & { _exportId: number; _worldExportId: number; _revisionExportId: number }
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
  detailedOutlines?: (Omit<DetailedOutline, 'id' | 'projectId' | 'outlineNodeId'> & { _outlineExportId: number })[]
  emotionBeatCards?: (Omit<EmotionBeatCard, 'id' | 'projectId' | 'chapterId'> & { _chapterExportId: number })[]
  stateCards?: Omit<StateCard, 'id' | 'projectId'>[]
  /** FB-5 文风画像(每项目单例) */
  userStyleProfiles?: Omit<UserStyleProfile, 'id' | 'projectId'>[]
  /** CM-1 增量灵感碎片与确认版本(每项目单例) */
  inspirationWorkspaces?: Omit<InspirationWorkspace, 'id' | 'projectId'>[]
  /** PLATFORM-2 / AGENT-1 总对话（世界与事件引用由注册表重映射）。 */
  agentConversations?: (
    Omit<AgentConversation, 'id' | 'projectId' | 'worldGroupId'>
    & WorldGroupExportRef
    & { _exportId: number }
  )[]
  agentEvents?: (
    Omit<AgentEvent, 'id' | 'projectId' | 'conversationId' | 'durableRunId'>
    & { _conversationExportId: number; _agentRunExportId?: number | null }
  )[]
  /** HARNESS-1 可恢复运行账本；事件/检查点只通过便携 run ID 关联。 */
  agentRuns?: (
    Omit<AgentRunRecord, 'id' | 'projectId' | 'workId' | 'worldGroupId' | 'conversationId' | 'parentRunId'>
    & WorldGroupExportRef
    & {
      _exportId: number
      _parentExportId?: number | null
      _workOwnerExportId?: number
      _conversationExportId?: number | null
    }
  )[]
  agentRunEvents?: (
    Omit<AgentRunEventRecord, 'id' | 'projectId' | 'worldGroupId' | 'runId'>
    & WorldGroupExportRef
    & { _agentRunExportId: number }
  )[]
  agentRunCheckpoints?: (
    Omit<AgentRunCheckpointRecord, 'id' | 'projectId' | 'worldGroupId' | 'runId'>
    & WorldGroupExportRef
    & { _agentRunExportId: number }
  )[]
  /** FLOW-2 独立自由节点文档与运行记录。 */
  nodeFlows?: (
    Omit<NodeFlow, 'id' | 'projectId' | 'worldGroupId'>
    & WorldGroupExportRef
    & { _exportId: number }
  )[]
  nodeRuns?: (
    Omit<NodeRunRecord, 'id' | 'projectId' | 'flowId'>
    & { _flowExportId: number }
  )[]
  /** SIM-1 共享互动运行时；创作 Canon 与运行存档严格分层。 */
  simulationSessions?: (
    Omit<SimulationSession, 'id' | 'projectId' | 'worldGroupId' | 'parentSessionId'>
    & WorldGroupExportRef
    & { _exportId: number; _parentSessionExportId?: number | null }
  )[]
  simulationEvents?: (
    Omit<SimulationEvent, 'id' | 'projectId' | 'worldGroupId' | 'sessionId'>
    & WorldGroupExportRef
    & { _simulationSessionExportId: number }
  )[]
  simulationCheckpoints?: (
    Omit<SimulationCheckpoint, 'id' | 'projectId' | 'worldGroupId' | 'sessionId'>
    & WorldGroupExportRef
    & { _simulationSessionExportId: number }
  )[]
  /** NS-4 时序事实账本(各 FK 在派生导出里被 remap 成 _xxxExportId) */
  temporalFacts?: (Omit<TemporalFact, 'id' | 'projectId'> & Record<string, unknown>)[]
  /** CONSISTENCY-2 角色认知事件账本（全部 FK 由注册表重映射）。 */
  knowledgeLedger?: (Omit<KnowledgeLedgerEntry, 'id' | 'projectId'> & Record<string, unknown>)[]
  storyArcs?: Omit<StoryArc, 'id' | 'projectId'>[]
  /** Phase 39 作者确认的故事线动态投影（FK 由注册表重映射）。 */
  storylineProgress?: (Omit<StorylineProgress, 'id' | 'projectId'> & Record<string, unknown>)[]
  /** Phase 39 作者确认的故事线交汇（FK 由注册表重映射）。 */
  storylineCrossings?: (Omit<StorylineCrossing, 'id' | 'projectId'> & Record<string, unknown>)[]
  worldNodes?: (Omit<WorldNode, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef & { _exportId: number; _parentExportId: number | null })[]
  notes?: Omit<Note, 'id' | 'projectId'>[]
  references?: (Omit<Reference, 'id' | 'projectId'> & { _exportId: number })[]
  referenceAnalysisRuns?: (
    Omit<ReferenceAnalysisRun, 'id' | 'projectId' | 'referenceId'>
    & { _exportId: number; _referenceExportId: number }
  )[]
  referenceChunkAnalysis?: (
    Omit<ReferenceChunkAnalysis, 'id' | 'referenceId' | 'analysisRunId'>
    & { _referenceExportId: number; _analysisRunExportId?: number | null }
  )[]
  historicalTimelineEvents?: (Omit<HistoricalTimelineEvent, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  historicalKeywords?: (Omit<HistoricalKeyword, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]

  // ── v3: 多世界系统（Phase 25.4）──
  worldGroups?: (Omit<WorldGroup, 'id' | 'projectId'> & { _exportId: number })[]
  worldGroupLinks?: (Omit<WorldGroupLink, 'id' | 'projectId' | 'fromGroupId' | 'toGroupId'> & {
    _fromGroupExportId: number
    _toGroupExportId: number
  })[]

  // ── v3: 物品流水（Phase 25.5.2-b，chapterId 可空）──
  itemLedger?: (Omit<ItemLedgerEntry, 'id' | 'projectId' | 'chapterId'> & { _chapterExportId: number | null })[]
  // ── v3: 故事进程年表（Phase 25.5.2-a，chapterId 可空）──
  storyTimelineEvents?: (Omit<StoryTimelineEvent, 'id' | 'projectId' | 'chapterId'> & { _chapterExportId: number | null })[]

  // ── 此前漏导出（会丢数据），补全 ──
  importantLocations?: (Omit<ImportantLocation, 'id' | 'projectId' | 'parentId'> & { _exportId: number; _parentExportId: number | null })[]
  worldRulesProfiles?: (Omit<WorldRulesProfile, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  codexCategories?: (Omit<CodexCategory, 'id' | 'projectId' | 'parentId' | 'worldGroupId'> & WorldGroupExportRef & { _exportId: number; _parentExportId: number | null })[]
  codexEntries?: (Omit<CodexEntry, 'id' | 'projectId' | 'categoryId' | 'worldGroupId'> & WorldGroupExportRef & { _categoryExportId: number })[]
  /** WORLD-1 / Phase 37 修炼流派与境界 DAG（角色/异兽 FK 由注册表重映射）。 */
  cultivationSystems?: (Omit<CultivationSystem, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef & { _exportId: number })[]
  /** WORLD-1 / Phase 34 作者确认的正文修炼事件（四类 FK 由注册表重映射）。 */
  cultivationProgress?: (Omit<CultivationProgress, 'id' | 'projectId'> & Record<string, unknown>)[]
  /** STORY-1 / CF-9C 角色驱动设计方案（角色、父版本及 active 引用均便携重映射）。 */
  characterDrivenPlans?: (
    Omit<CharacterDrivenPlan, 'id' | 'projectId' | 'parentPlanId'>
    & { _exportId: number; _parentExportId: number | null; _arcCharacterIndexes?: Array<number | null> }
  )[]
}

/** 导出项目为 JSON(注册表派生) */
export async function exportProjectJSON(projectId: number): Promise<ProjectExportData> {
  return deriveExportProjectJSON(projectId, { strict: true })
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

/** 导入项目 JSON — 返回新项目 ID（注册表派生，兼容 v1/v2/v3 旧格式） */
export async function importProjectJSON(data: ProjectExportData): Promise<number> {
  // 预检必须发生在事务外、写库前；失败时保证项目表也不会出现半导入根记录。
  assertTrustedProjectBackup(data)
  return deriveImportProjectJSON(data)
}
