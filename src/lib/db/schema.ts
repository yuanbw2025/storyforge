import Dexie, { type Table } from 'dexie'
import type {
  Project,
  Worldview,
  StoryCore,
  PowerSystem,
  Character,
  Faction,
  OutlineNode,
  Chapter,
  Foreshadow,
  Geography,
  History,
  ItemSystem,
  CreativeRules,
  CharacterRelation,
  Snapshot,
  Reference,
  ReferenceChunkAnalysis,
  PromptTemplate,
  DetailedOutline,
  ImportJob,
  ImportSession,
  ImportLog,
  ImportFileBlob,
  PromptWorkflow,
  MasterWork,
  MasterChunkAnalysis,
  MasterChapterBeat,
  MasterStyleMetrics,
  Note,
  MasterInsight,
  StateCard,
  EmotionBeatCard,
  WorldNode,
  StoryArc,
  HistoricalTimelineEvent,
  HistoricalKeyword,
} from '../types'

class StoryForgeDB extends Dexie {
  projects!: Table<Project>
  worldviews!: Table<Worldview>
  storyCores!: Table<StoryCore>
  powerSystems!: Table<PowerSystem>
  characters!: Table<Character>
  factions!: Table<Faction>
  outlineNodes!: Table<OutlineNode>
  chapters!: Table<Chapter>
  foreshadows!: Table<Foreshadow>
  geographies!: Table<Geography>
  histories!: Table<History>
  itemSystems!: Table<ItemSystem>
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

  // Phase 19 —— 作品学习系统（与创作数据物理隔离）
  masterWorks!: Table<MasterWork, number>
  masterChunkAnalysis!: Table<MasterChunkAnalysis, number>
  masterChapterBeats!: Table<MasterChapterBeat, number>
  masterStyleMetrics!: Table<MasterStyleMetrics, number>
  masterInsights!: Table<MasterInsight, number>

  // Phase 20 —— 参考作品深度分析（八维分块分析）
  referenceChunkAnalysis!: Table<ReferenceChunkAnalysis, number>

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
  }
}

export const db = new StoryForgeDB()
