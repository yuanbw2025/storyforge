import Dexie, { type Table } from 'dexie'
import { migrateLegacyTablesToCodex } from '../migrations/legacy-to-codex-upgrade'
import { migrateCharactersToAxes } from '../migrations/character-axes-upgrade'
import { migrateStateCardsToTemporalFactCandidates } from '../migrations/state-cards-to-temporal-facts'
import { migrateItemLedgerToCharacterOwnership } from '../migrations/item-ledger-character-ownership'
import { migrateWorldHistoryConsolidation } from '../migrations/world-history-consolidation'
import { migrateWorkspacePortableIdentities } from '../migrations/workspace-identity-upgrade'
import type {
  Project,
  Worldview,
  StoryCore,
  PowerSystem,
  Character,
  OutlineNode,
  Chapter,
  Foreshadow,
  Geography,
  History,
  CreativeRules,
  CharacterRelation,
  Snapshot,
  Reference,
  ReferenceAnalysisRun,
  ReferenceAnalysisSource,
  ReferenceChunkAnalysis,
  PromptTemplate,
  DetailedOutline,
  ImportJob,
  ImportSession,
  ImportLog,
  ImportFileBlob,
  PromptWorkflow,
  Note,
  StateCard,
  EmotionBeatCard,
  WorldNode,
  StoryArc,
  HistoricalTimelineEvent,
  HistoricalKeyword,
  ImportantLocation,
  WorldRulesProfile,
  UserStyleProfile,
  WorldGroup,
  WorldGroupLink,
  ItemLedgerEntry,
  StoryTimelineEvent,
  CodexCategory,
  CodexEntry,
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
  OwnershipMigrationReceipt,
  NarrativeModule,
  NarrativeNode,
  WorldRevision,
  WorldRelease,
  WorkspaceDocumentBindingV1,
  GameDefinition,
  GameRelease,
  NarrativeBeat,
  NarrativeChoice,
  InteractionCharacterProfile,
  InteractionSceneTemplate,
  AdventureModule,
  AvgMediaAsset,
  AvgMediaBlob,
  AvgPresentationModule,
  NarrativeSimulationModule,
  OpenWorldModule,
} from '../types'
import type { AIUsageEntry } from '../ai/usage-log'
import type { TemporalFact } from '../types/temporal-fact'
import type { KnowledgeLedgerEntry } from '../types/knowledge-ledger'
import type { RetrievalChunk } from '../types/retrieval-chunk'
import type { NarrativeSummaryNode } from '../types/narrative-summary'

class StoryForgeDB extends Dexie {
  projects!: Table<Project>
  worlds!: Table<World, number>
  works!: Table<Work, number>
  workCharacterBindings!: Table<WorkCharacterBinding, number>
  ownershipMigrations!: Table<OwnershipMigrationReceipt, number>
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

  // Phase 20 —— 参考作品深度分析（八维分块分析）
  referenceChunkAnalysis!: Table<ReferenceChunkAnalysis, number>
  referenceAnalysisRuns!: Table<ReferenceAnalysisRun, number>
  referenceAnalysisSources!: Table<ReferenceAnalysisSource, number>

  // A1 —— 状态表（角色/地点/物品/势力状态追踪）
  stateCards!: Table<StateCard, number>

  // A3 —— 情感节拍卡
  emotionBeatCards!: Table<EmotionBeatCard, number>

  // Phase B — 全局故事线
  storyArcs!: Table<StoryArc, number>

  // Phase H3 — 便签/笔记
  notes!: Table<Note, number>

  // 多世界 / 世界树
  worldNodes!: Table<WorldNode, number>

  // PHASE-H1 —— 历史时间线事件
  historicalTimelineEvents!: Table<HistoricalTimelineEvent, number>

  // PHASE-H2 —— 历史关键词与细节
  historicalKeywords!: Table<HistoricalKeyword, number>

  // Phase 25.3 —— 重要地点
  importantLocations!: Table<ImportantLocation, number>

  // Phase 32 —— 世界规则（真实与幻想）
  worldRulesProfiles!: Table<WorldRulesProfile, number>

  // Phase 25.4 —— 多世界系统
  worldGroups!: Table<WorldGroup, number>
  worldGroupLinks!: Table<WorldGroupLink, number>

  // Phase 25.5.2-b —— 物品流水（游戏包裹式物品栏）
  itemLedger!: Table<ItemLedgerEntry, number>

  // Phase 25.5.2-a —— 故事进程年表
  storyTimelineEvents!: Table<StoryTimelineEvent, number>

  // Phase 35-a —— 词条系统（Codex）
  codexCategories!: Table<CodexCategory, number>
  codexEntries!: Table<CodexEntry, number>

  // WORLD-1 / Phase 37 —— 世界级修炼流派与境界 DAG
  cultivationSystems!: Table<CultivationSystem, number>

  // WORLD-1 / Phase 34 —— 作者确认的逐章修炼进度事件
  cultivationProgress!: Table<CultivationProgress, number>

  // STORY-1 / CF-9C —— 持久化角色驱动设计方案
  characterDrivenPlans!: Table<CharacterDrivenPlan, number>

  // IDEA-1 / CM-1 —— 增量灵感碎片与确认版本
  inspirationWorkspaces!: Table<InspirationWorkspace, number>

  // FB-5 —— 自适应文风学习（每项目一份 AI 文风画像）
  userStyleProfiles!: Table<UserStyleProfile, number>

  // AI 消耗统计
  aiUsageLog!: Table<AIUsageEntry, number>

  // NS-4 —— 时序事实账本（双层事实记忆：status candidate=Evidence Observation / confirmed=Canon Assertion）
  temporalFacts!: Table<TemporalFact, number>

  // CONSISTENCY-2 —— 角色认知事件账本（知道 / 误认 / 遗忘 / 纠正）
  knowledgeLedger!: Table<KnowledgeLedgerEntry, number>

  // Phase 39 —— 动态故事线进度与交汇（均须作者确认）
  storylineProgress!: Table<StorylineProgress, number>
  storylineCrossings!: Table<StorylineCrossing, number>

  // NS-5 —— 叙事感知混合检索块（可重建派生缓存，不导出）
  retrievalChunks!: Table<RetrievalChunk, number>

  // NS-5 —— 章→卷→全书层级摘要树（可重建派生缓存，不导出）
  narrativeSummaryNodes!: Table<NarrativeSummaryNode, number>

  // PLATFORM-2 / AGENT-1 —— 可持久、可审计的总 Agent 对话事件流
  agentConversations!: Table<AgentConversation, number>
  agentEvents!: Table<AgentEvent, number>

  // HARNESS-1 —— 分步骤创作 Agent 的可恢复运行账本
  agentRuns!: Table<AgentRunRecord, number>
  agentRunEvents!: Table<AgentRunEventRecord, number>
  agentRunCheckpoints!: Table<AgentRunCheckpointRecord, number>

  // FLOW-2 —— 独立自由节点文档与逐节点可见运行记录
  nodeFlows!: Table<NodeFlow, number>
  nodeRuns!: Table<NodeRunRecord, number>

  // SIM-1 —— NPC/跑团/角色聊天共用的独立互动运行时
  simulationSessions!: Table<SimulationSession, number>
  simulationEvents!: Table<SimulationEvent, number>
  simulationCheckpoints!: Table<SimulationCheckpoint, number>
  narrativeModules!: Table<NarrativeModule, number>
  narrativeNodes!: Table<NarrativeNode, number>
  worldRevisions!: Table<WorldRevision, number>
  worldReleases!: Table<WorldRelease, number>

  // MEMORY-1 —— 文件文档身份与三方同步基线；正文仍只存在原领域表。
  workspaceDocuments!: Table<WorkspaceDocumentBindingV1, number>

  // STORYGAME / CHATGAME / TEXTADV / AVG / TEXTSIM / TEXTWORLD
  gameDefinitions!: Table<GameDefinition, number>
  gameReleases!: Table<GameRelease, number>
  narrativeBeats!: Table<NarrativeBeat, number>
  narrativeChoices!: Table<NarrativeChoice, number>
  interactionCharacterProfiles!: Table<InteractionCharacterProfile, number>
  interactionSceneTemplates!: Table<InteractionSceneTemplate, number>
  adventureModules!: Table<AdventureModule, number>
  avgMediaAssets!: Table<AvgMediaAsset, number>
  avgMediaBlobs!: Table<AvgMediaBlob, number>
  avgPresentationModules!: Table<AvgPresentationModule, number>
  narrativeSimulationModules!: Table<NarrativeSimulationModule, number>
  openWorldModules!: Table<OpenWorldModule, number>

  constructor() {
    super('storyforge')

    this.version(1).stores({
      projects: '++id, name, createdAt, updatedAt',
      worldviews: '++id, projectId',
      storyCores: '++id, projectId',
      powerSystems: '++id, projectId',
      characters: '++id, projectId, name, role',
      factions: '++id, projectId, name',
      outlineNodes: '++id, projectId, parentId, order, type',
      chapters: '++id, projectId, outlineNodeId, order, status',
      foreshadows: '++id, projectId, status, type',
    })

    this.version(2).stores({
      geographies: '++id, projectId',
      histories: '++id, projectId',
      itemSystems: '++id, projectId',
      creativeRules: '++id, projectId',
    })

    this.version(3).stores({
      characterRelations: '++id, projectId, fromCharacterId, toCharacterId',
    })

    this.version(4).stores({
      snapshots: '++id, projectId, type, createdAt',
    })

    // v5: 新增参考书目表，projects 表支持 genres[] / status / coverImage
    this.version(5).stores({
      references: '++id, projectId, type, createdAt',
    })

    // v6: 提示词模板表（Phase 1 — 提示词基础设施）
    this.version(6).stores({
      promptTemplates: '++id, scope, moduleKey, isActive, updatedAt',
    })

    // v7: 细纲 + AI 导入任务（Phase 3 — 数据模型增量扩展）
    this.version(7).stores({
      detailedOutlines: '++id, projectId, outlineNodeId',
      importJobs: '++id, projectId, type, status, createdAt',
    })

    // v8: 提示词工作流（Phase 16）
    this.version(8).stores({
      promptWorkflows: '++id, scope, isDefault, updatedAt',
    })

    // v9: 大文档分块导入流水线（Phase 18）
    this.version(9).stores({
      importSessions: '++id, projectId, status, updatedAt, fileHash',
      importLogs: '++id, sessionId, chunkIndex, createdAt',
    })

    // v10: 导入原文 Blob 持久化（Phase 18 方案 A — 2026-05-12）
    //      key = sessionId（与 importSessions 主键一致）。
    //      没用 ++ 是因为要手动用 session.id 做主键。
    this.version(10).stores({
      importFiles: 'sessionId, fileHash, createdAt',
    })

    // v11: 作品学习系统（Phase 19 — 2026-05-12）
    //      5 张独立表，不掺进创作 19 张表的 schema；
    //      genre 索引留着跨作品归纳（Layer 3）时按流派筛用。
    this.version(11).stores({
      masterWorks: '++id, projectId, genre, status, updatedAt',
      masterChunkAnalysis: '++id, workId, chunkIndex',
      masterChapterBeats: '++id, workId, chapterIndex, type',
      masterStyleMetrics: '++id, workId',
      masterInsights: '++id, genre, updatedAt',
    })

    // v12: 状态表 — 角色/地点/物品/势力状态追踪（A1）
    this.version(12).stores({
      stateCards: '++id, projectId, category, entityName, lastChapterId',
    })

    // v13: 情感节拍卡（A3）
    this.version(13).stores({
      emotionBeatCards: '++id, projectId, chapterId',
    })

    // v14: 参考作品八维深度分析（Phase 20 — 整合作品学习到项目参考）
    this.version(14).stores({
      referenceChunkAnalysis: '++id, referenceId, chunkIndex',
    })

    // v15: 多世界/世界树 — 每个世界节点独立地图配置
    this.version(15).stores({
      worldNodes: '++id, projectId, parentId, sortOrder',
    })

    // v16: Phase B — 全局故事线
    this.version(16).stores({
      storyArcs: '++id, projectId, type',
    })

    // Phase H3: 便签/笔记
    this.version(17).stores({
      notes: '++id, projectId, chapterId, pinned',
    })

    // PHASE-H1: 历史时间线事件
    this.version(18).stores({
      historicalTimelineEvents: '++id, projectId, era, year',
    })

    // PHASE-H2: 历史关键词与细节
    this.version(19).stores({
      historicalKeywords: '++id, projectId, category, era',
    })

    // Phase 25.3: 重要地点
    this.version(20).stores({
      importantLocations: '++id, projectId, parentId, sortOrder',
    })

    // Phase 32: 世界规则（真实与幻想）—— singleton per project
    this.version(21).stores({
      worldRulesProfiles: '++id, &projectId',
    })

    // Phase 25.4: 多世界系统
    this.version(22).stores({
      worldGroups: '++id, projectId, type, order',
      worldGroupLinks: '++id, projectId, fromGroupId, toGroupId',
    })

    // Phase 25.5.2-b: 物品流水（物品栏）
    this.version(23).stores({
      itemLedger: '++id, projectId, itemName, chapterId',
    })

    // Phase 25.5.2-a: 故事进程年表
    this.version(24).stores({
      storyTimelineEvents: '++id, projectId, chapterId, order',
    })

    // Phase 35-a: 词条系统（Codex）
    this.version(25).stores({
      codexCategories: '++id, projectId, domain, parentId, builtInKey, worldGroupId, order',
      codexEntries: '++id, projectId, categoryId, worldGroupId, order',
    })

    // AI 消耗统计
    this.version(26).stores({
      aiUsageLog: '++id, projectId, timestamp, category, model',
    })

    // v27: 真实与幻想从项目级单例升级为每世界一套
    this.version(27).stores({
      worldRulesProfiles: '++id, projectId, worldGroupId',
    })

    // v28: 导入会话记录多世界目标世界
    this.version(28).stores({
      importSessions: '++id, projectId, status, updatedAt, fileHash, targetWorldGroupId',
    })

    // v29: 词条化收尾 —— 旧 itemSystems / factions 表彻底并入词条后删除。
    // 升级事务内"先迁移后删":先把数据搬进「人工器物」/「势力」词条(含体系总述并入
    // worldview.itemDesign、势力 mapRegion/color),再把这两张表置 null 删除。零丢失。
    this.version(29).stores({
      itemSystems: null,
      factions: null,
    }).upgrade(async (tx) => {
      await migrateLegacyTablesToCodex(tx)
    })

    // v30: 自适应文风学习（FB-5）—— 纯新增空表,无存量数据,无需迁移函数。
    this.version(30).stores({
      userStyleProfiles: '++id, projectId',
    })

    // v31: 作品分析统一为 13 维（旧 8 维字段名不同 → 弃旧重跑）。
    //   字段非索引,stores() 不变。升级钩子只清 referenceChunkAnalysis 的旧分析行 +
    //   把受影响 reference 的 analysisStatus 复位为 none,让用户重新跑统一分析。
    //   **绝不碰 importSessions / importFiles**（解析缓存跨更新存活）。
    this.version(31).stores({
      referenceChunkAnalysis: '++id, referenceId, chunkIndex',
    }).upgrade(async (tx) => {
      await tx.table('referenceChunkAnalysis').clear()
      await tx.table('references').toCollection().modify((r: { analysisStatus?: string; analysisProgress?: number }) => {
        if (r.analysisStatus && r.analysisStatus !== 'none') {
          r.analysisStatus = 'none'
          r.analysisProgress = 0
        }
      })
    })

    // v32: 下线「作品学习」旧子系统（已被「项目参考·作品分析」取代）。
    //   删除 5 张 master 表(masterWorks/masterChunkAnalysis/masterChapterBeats/
    //   masterStyleMetrics/masterInsights)。仅作品分析数据,非手稿,直接置 null 删除。
    this.version(32).stores({
      masterWorks: null,
      masterChunkAnalysis: null,
      masterChapterBeats: null,
      masterStyleMetrics: null,
      masterInsights: null,
    })

    // v33: R1 角色模型拆成戏份权重 + DnD 九宫格双轴。
    // 旧 role 保留为派生兼容字段；升级前先在 snapshots 写入受影响角色原始行。
    this.version(33).stores({
      characters: '++id, projectId, name, role, roleWeight, moralAxis, orderAxis',
    }).upgrade(async (tx) => {
      await migrateCharactersToAxes(tx)
    })

    // v34: 治存量脏数据。历史上 outlineNodes.summary 是非可选字段，但老数据/跨版本导入
    // 的项目可能整体缺该键（卷通常无章纲摘要），落库即 undefined → 大纲渲染 `summary.trim()`
    // 崩溃（社区「chrome 导入后必现」）。统一兜成 ''，恢复 summary 恒为 string 的不变量。
    // 无 schema/索引变化，仅数据修复。新写入/导入由 PROJECT_TABLES.defaults 在边界兜底。
    this.version(34).stores({}).upgrade(async (tx) => {
      await tx.table('outlineNodes').toCollection().modify((node: any) => {
        if (node.summary == null) node.summary = ''
      })
    })

    // v35: NS-4 时序事实账本。新增 temporalFacts 后，把旧 stateCards 无损桥接为
    // Evidence Observation 候选：旧状态卡原样保留，不自动升 Canon，不删除不覆盖。
    this.version(35).stores({
      temporalFacts: '++id, projectId, worldGroupId, characterId, locationId, codexEntryId, predicate, status, sourceChapterId',
    }).upgrade(async (tx) => {
      await migrateStateCardsToTemporalFactCandidates(tx)
    })

    // v36: NS-5 检索块（可重建派生缓存，从章节正文切块）。新增空表，不转换存量数据。
    this.version(36).stores({
      retrievalChunks: '++id, projectId, worldGroupId, sourceChapterId',
    })

    // v37: NS-5 层级叙事摘要树（章→卷→全书）。派生缓存，不导出；
    // 老项目通过设置页“建立检索索引”或生成上下文前按需重建。
    this.version(37).stores({
      narrativeSummaryNodes: '++id, projectId, worldGroupId, level, sourceChapterId, sourceOutlineNodeId, status',
    })

    // v38: itemLedger 加 heldByName + characterId（INV-1 按角色归属）
    this.version(38).stores({
    }).upgrade(async (tx) => {
      // 迁移必须 fail-closed：任何异常都让 Dexie 回滚版本升级，
      // 不能把缺失归属字段的半迁移数据库标记成 v38。
      await migrateItemLedgerToCharacterOwnership(tx)
    })

    // v39: CONSISTENCY-2 角色认知事件账本。新增空表，不从 temporalFacts 猜测角色认知；
    // 旧项目事实原样保留，作者后续明确确认的认知事件才进入本表。
    this.version(39).stores({
      knowledgeLedger: '++id, projectId, worldGroupId, characterId, knowledgeKey, factId, sourceChapterId, status',
    })

    // v40: Phase 39 动态故事线进度与交汇。新增空表，不从既有章节或 StoryArc
    // 猜测历史进度；只有作者明确采纳的候选才会进入这两张表。
    this.version(40).stores({
      storylineProgress: '++id, &arcId, projectId, status, lastActiveChapterId',
      storylineCrossings: '++id, projectId, arcIdA, arcIdB, chapterId',
    })

    // v41: Phase 37-a 修炼体系。纯新增表；角色/词条上的关联字段均非索引，
    // 旧项目保持 null/undefined，不从自由文本 powerLevel 猜测结构化归属。
    this.version(41).stores({
      cultivationSystems: '++id, projectId, worldGroupId, name',
    })

    // v42: Phase 34 修炼进度。新增空事件表，不从角色卡设定境界或旧自由文本猜正文历史。
    this.version(42).stores({
      cultivationProgress: '++id, projectId, worldGroupId, characterId, cultivationSystemId, sourceChapterId, status',
    })

    // v43: Phase 35-b 历史归并。只把旧 Worldview 历史文本桥接到同世界的空 History 总述；
    // 已有正式历史绝不覆盖，旧字段不删除，迁移异常由 Dexie 整体回滚。
    this.version(43).stores({
    }).upgrade(async (tx) => {
      await migrateWorldHistoryConsolidation(tx)
    })

    // v44: CF-9C 角色驱动设计工作区。只新增空表；projects 上的 active 引用为可选
    // 非索引字段，旧项目保持 undefined，不从既有临时面板或大纲反推方案。
    this.version(44).stores({
      characterDrivenPlans: '++id, projectId, status, parentPlanId, updatedAt',
    })

    // v45: CM-1 增量灵感工作区。只新增每项目一份空表；不从 localStorage
    // 猜测或自动搬运旧草稿，旧草稿仍由面板兼容读取，作者首次融合时显式落库。
    this.version(45).stores({
      inspirationWorkspaces: '++id, projectId, updatedAt',
    })

    // v46: IDEA-1 参考资料版本化分析。只新增 run + 本地原文表，并为分块增加
    // analysisRunId 索引；旧 references / chunk 行原样保留，由显式运行时桥接建 v1。
    this.version(46).stores({
      referenceAnalysisRuns: '++id, projectId, referenceId, [referenceId+version], status, updatedAt',
      referenceAnalysisSources: 'analysisRunId, fileHash, createdAt',
      referenceChunkAnalysis: '++id, referenceId, analysisRunId, [analysisRunId+chunkIndex], chunkIndex',
    })

    // v47: PLATFORM-2 / AGENT-1 / FLOW-2 创作过程层。四张表均为纯新增空表，
    // 不从旧 PromptWorkflow.graph 或组件内存猜测迁移，避免把错误产品模型固化成正式数据。
    this.version(47).stores({
      agentConversations: '++id, projectId, worldGroupId, status, updatedAt',
      agentEvents: '++id, projectId, conversationId, [conversationId+sequence], kind, createdAt',
      nodeFlows: '++id, projectId, worldGroupId, updatedAt',
      nodeRuns: '++id, projectId, flowId, status, updatedAt',
    })

    // v48: SIM-1A 共享互动运行时。三张表均为纯新增空表，不从创作角色、正文、物品栏
    // 或 Agent 会话猜测存档；只有作者明确建立互动会话后才冻结 Canon 来源快照。
    this.version(48).stores({
      simulationSessions: '++id, projectId, worldGroupId, kind, status, parentSessionId, updatedAt',
      simulationEvents: '++id, projectId, worldGroupId, sessionId, &[sessionId+sequence], type, createdAt',
      simulationCheckpoints: '++id, projectId, worldGroupId, sessionId, [sessionId+throughSequence], createdAt',
    })

    // v49 / WORLD-2C C1: ownership roots and migration evidence only. This is
    // deliberately an empty schema upgrade; legacy rows are not scanned or changed.
    this.version(49).stores({
      worlds: '++id, projectId, code, [projectId+updatedAt]',
      works: '++id, projectId, worldId, [projectId+worldId], [worldId+updatedAt], status',
      workCharacterBindings: '++id, projectId, workId, characterId, &[workId+characterId], [projectId+workId]',
      ownershipMigrations: '++id, projectId, &[projectId+contractVersion], status, updatedAt',
    })

    // v50 / WORLD-2D..2F: executable narrative blueprints, immutable world
    // revisions/releases, and explicit release/module indexes for instances.
    // Existing SIM rows are intentionally untouched; legacy sessions remain
    // readable until a user creates a new bound instance.
    this.version(50).stores({
      narrativeModules: '++id, projectId, worldId, workId, kind, status, updatedAt',
      narrativeNodes: '++id, projectId, moduleId, sourceOutlineNodeId, order',
      worldRevisions: '++id, projectId, worldId, parentRevisionId, revision, contentHash, updatedAt',
      worldReleases: '++id, projectId, worldId, revisionId, version, contentHash, createdAt',
      simulationSessions: '++id, projectId, worldGroupId, worldId, workId, worldReleaseId, narrativeModuleId, kind, status, parentSessionId, updatedAt',
    })

    // v51 / HARNESS-1: durable Agent run ledger. The upgrade only creates empty
    // stores; historical conversations and model outputs are not guessed into
    // resumable runs or retroactively marked completed.
    this.version(51).stores({
      agentRuns: '++id, projectId, workId, worldGroupId, conversationId, status, updatedAt',
      agentRunEvents: '++id, projectId, worldGroupId, runId, &[runId+sequence], type, createdAt',
      agentRunCheckpoints: '++id, projectId, worldGroupId, runId, &[runId+throughSequence], createdAt',
    })

    // v52 / HARNESS-21: materialize durable parent-run lineage. Existing root
    // runs stay roots; no historical run is guessed into a parent/child chain.
    this.version(52).stores({
      agentRuns: '++id, projectId, workId, worldGroupId, conversationId, parentRunId, &[parentRunId+parentRelation], status, updatedAt',
    })

    // v53 / HARNESS-25: bind durable candidate events to their current Run
    // through an indexed lifecycle reference. Existing events are preserved;
    // rows without a durable owner remain unbound and are not inferred.
    this.version(53).stores({
      agentEvents: '++id, projectId, conversationId, durableRunId, [conversationId+sequence], kind, createdAt',
    })

    // v54 / MEMORY-1: portable workspace/work identity and the document binding
    // baseline. Existing titles and local numeric ids are deliberately not used
    // as identity. The new binding table starts empty and stores no manuscript body.
    this.version(54).stores({
      projects: '++id, &workspaceUid, name, createdAt, updatedAt',
      works: '++id, projectId, worldId, code, &[projectId+code], [projectId+worldId], [worldId+updatedAt], status',
      workspaceDocuments: '++id, projectId, workspaceUid, documentId, &[projectId+documentId], relativePath, &[projectId+relativePath], tableName, recordId, &[projectId+tableName+recordId], worldCode, workCode, lastSyncRunId, updatedAt',
    }).upgrade(async tx => {
      await migrateWorkspacePortableIdentities(tx)
    })

    // v62 / MAIN + TEXTGAME integration: v54 was independently allocated on
    // main and the text-game branch. Declare the union at a strictly newer
    // version so both existing v54 main databases and v61 text-game databases
    // migrate forward without replaying or renumbering either historical path.
    this.version(62).stores({
      projects: '++id, &workspaceUid, name, createdAt, updatedAt',
      works: '++id, projectId, worldId, code, &[projectId+code], [projectId+worldId], [worldId+updatedAt], status, activeNarrativeModuleId',
      workspaceDocuments: '++id, projectId, workspaceUid, documentId, &[projectId+documentId], relativePath, &[projectId+relativePath], tableName, recordId, &[projectId+tableName+recordId], worldCode, workCode, lastSyncRunId, updatedAt',
      gameDefinitions: '++id, projectId, worldId, workId, &[workId+gameKey], productType, status, narrativeModuleId, updatedAt',
      gameReleases: '++id, projectId, worldId, workId, gameDefinitionId, worldReleaseId, &[gameDefinitionId+version], contentHash, createdAt',
      narrativeBeats: '++id, projectId, moduleId, nodeKey, &[moduleId+beatKey], [moduleId+nodeKey], speakerCharacterId, order',
      narrativeChoices: '++id, projectId, moduleId, sourceNodeKey, &[moduleId+choiceKey], [moduleId+sourceNodeKey], targetNodeKey, order',
      interactionCharacterProfiles: '++id, projectId, worldId, workId, gameDefinitionId, characterId, &[gameDefinitionId+participantKey], [workId+gameDefinitionId], updatedAt',
      interactionSceneTemplates: '++id, projectId, worldId, workId, gameDefinitionId, &[gameDefinitionId+sceneKey], [workId+gameDefinitionId], order, updatedAt',
      adventureModules: '++id, projectId, worldId, workId, &gameDefinitionId, [workId+gameDefinitionId], updatedAt',
      avgMediaAssets: '++id, projectId, worldId, workId, &[workId+assetKey+version], [workId+kind], contentHash, updatedAt',
      avgMediaBlobs: '++id, projectId, worldId, workId, &mediaAssetId',
      avgPresentationModules: '++id, projectId, worldId, workId, &gameDefinitionId, [workId+gameDefinitionId], updatedAt',
      narrativeSimulationModules: '++id, projectId, worldId, workId, &gameDefinitionId, [workId+gameDefinitionId], updatedAt',
      openWorldModules: '++id, projectId, worldId, workId, &gameDefinitionId, [workId+gameDefinitionId], updatedAt',
      simulationSessions: '++id, projectId, worldGroupId, worldId, workId, worldReleaseId, gameReleaseId, narrativeModuleId, kind, status, parentSessionId, updatedAt',
      simulationEvents: '++id, projectId, worldGroupId, sessionId, &[sessionId+sequence], &[sessionId+commandId], type, createdAt',
      agentRuns: '++id, projectId, workId, simulationSessionId, worldGroupId, conversationId, parentRunId, &[parentRunId+parentRelation], status, updatedAt',
    }).upgrade(async tx => {
      await migrateWorkspacePortableIdentities(tx)
      await tx.table('agentRuns').toCollection().modify(run => {
        if (!Object.prototype.hasOwnProperty.call(run, 'simulationSessionId')) {
          run.simulationSessionId = null
        }
      })
    })
  }
}

export const db = new StoryForgeDB()
