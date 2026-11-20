import type { NarrativeDomainMetadataV1, NarrativeDomainFieldsV1 } from './narrative-domain'
import type { RagDocumentMetadata } from './rag-library'
import type { WorkspaceScope, WorldOwnerScope } from './world-ownership'

/** Explicit author entry; a World target does not erase a Work author's scope. */
export type HistoryAuthorOriginV1 =
  | { version: 1; kind: 'world'; scope: WorldOwnerScope }
  | { version: 1; kind: 'work'; scope: WorkspaceScope }

export type HistoryAuthorPartitionV1 = { kind: 'partition'; worldGroupId: number | null }
export type HistoryAuthorSelectionV1 = HistoryAuthorPartitionV1 | { kind: 'all' }
export type HistoryTextPatchV1 =
  | { overview: string; eraSystem?: never }
  | { eraSystem: string; overview?: never }
  | { overview: string; eraSystem: string }

export const HISTORY_TEXT_DEFAULTS_V1 = Object.freeze({ overview: '', eraSystem: '', events: '[]' })

/** These parsers copy trusted action inputs before the first asynchronous boundary. */
export function historyAuthorRecordV1(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor))) {
    throw new Error(`历史作者${label}包含无效字段`)
  }
  return value as Record<string, unknown>
}

export function copyHistoryAuthorOriginV1(value: unknown): HistoryAuthorOriginV1 {
  const input = historyAuthorRecordV1(value, ['version', 'kind', 'scope'], '入口')
  if (input.version !== 1 || (input.kind !== 'world' && input.kind !== 'work')) throw new Error('历史作者入口无效')
  const scope = historyAuthorRecordV1(input.scope,
    input.kind === 'work' ? ['projectId', 'worldId', 'workId'] : ['projectId', 'worldId'], '作用域')
  for (const field of input.kind === 'work' ? ['projectId', 'worldId', 'workId'] : ['projectId', 'worldId']) {
    if (!Number.isSafeInteger(scope[field]) || (scope[field] as number) < 1) throw new Error('历史作者作用域缺少有效身份')
  }
  const world = { projectId: scope.projectId as number, worldId: scope.worldId as number }
  return input.kind === 'world'
    ? { version: 1, kind: 'world', scope: world }
    : { version: 1, kind: 'work', scope: { ...world, workId: scope.workId as number } }
}

export function copyHistoryAuthorSelectionV1(value: unknown): HistoryAuthorSelectionV1 {
  const input = historyAuthorRecordV1(value, ['kind', 'worldGroupId'], '分区')
  if (input.kind === 'all' && !Object.prototype.hasOwnProperty.call(input, 'worldGroupId')) return { kind: 'all' }
  if (input.kind !== 'partition' || (input.worldGroupId !== null
    && (!Number.isSafeInteger(input.worldGroupId) || (input.worldGroupId as number) < 1))) {
    throw new Error('历史作者分区无效；一览不能作为可写默认分区')
  }
  return { kind: 'partition', worldGroupId: input.worldGroupId as number | null }
}

export function copyHistoryTextPatchV1(value: unknown): HistoryTextPatchV1 {
  const input = historyAuthorRecordV1(value, ['overview', 'eraSystem'], '文字修改')
  const fields = Object.keys(input)
  if (!fields.length || fields.some(field => typeof input[field] !== 'string')) throw new Error('历史修改须明确选择总述或纪年文字字段')
  // Empty strings are explicit author clearing, not an empty patch.
  return Object.fromEntries(fields.map(field => [field, input[field]])) as HistoryTextPatchV1
}

/** 历史事件 */
export interface HistoricalEvent {
  id: string           // 内部唯一标识
  era: string          // 所属纪元/年代
  date: string         // 具体时间
  title: string        // 事件名称
  description: string  // 事件描述
  impact: string       // 对世界的影响
  order: number        // 时间线排序
}

/** 历史年表 */
export interface History extends RagDocumentMetadata {
  id?: number
  projectId: number
  overview: string         // 历史总述
  eraSystem: string        // 纪年体系描述
  events: string           // HistoricalEvent[] JSON string
  /** 所属世界组 ID（Phase 25.4） */
  worldGroupId?: number | null
  createdAt: number
  updatedAt: number
}

/** 历史时期 */
export type HistoricalEra =
  | 'pre-qin'          // 先秦
  | 'qin-han'          // 秦汉三国
  | 'wei-jin'          // 魏晋南北朝
  | 'sui-tang'         // 隋唐五代
  | 'song-yuan'        // 两宋辽金元
  | 'ming-qing'        // 明清时局
  | 'republic'         // 民国时期
  | 'modern'           // 近现代
  // 全球历史/西方历史
  | 'ancient-global'   // 古典时代（古希腊/古罗马/美索不达米亚等）
  | 'medieval-global'  // 中世纪（欧洲/拜占庭/阿拉伯帝国等）
  | 'renaissance-global' // 文艺复兴与大航海时代
  | 'industrial-global' // 工业革命与近代世界
  | 'world-wars-global' // 两次世界大战与现代早期
  | 'cold-war-global'  // 冷战与当代
  | 'custom'           // 自定义/架空

export const HISTORICAL_ERA_LABELS: Record<HistoricalEra, string> = {
  'pre-qin': '先秦',
  'qin-han': '秦汉三国',
  'wei-jin': '魏晋南北朝',
  'sui-tang': '隋唐五代',
  'song-yuan': '两宋辽金元',
  'ming-qing': '明清时局',
  'republic': '民国时期',
  'modern': '近现代',
  'ancient-global': '古典时代（古希腊/罗马/两河等）',
  'medieval-global': '中世纪（欧洲/拜占庭/阿拉伯等）',
  'renaissance-global': '文艺复兴与大航海时代',
  'industrial-global': '工业革命与近代世界',
  'world-wars-global': '两次世界大战与现代早期',
  'cold-war-global': '冷战与当代',
  'custom': '自定义/架空',
}

/** 历史时间线事件（PHASE-H1 独立表存储） */
type HistoricalTimelineEventNarrativeFieldsV1 = NarrativeDomainMetadataV1 & Pick<NarrativeDomainFieldsV1, 'narrativeEventV1'>

export interface HistoricalTimelineEvent extends HistoricalTimelineEventNarrativeFieldsV1 {
  id?: number          // 数据库自增 ID
  projectId: number    // 项目 ID
  era: HistoricalEra | string // 所属历史时期
  year: number         // 数字化年份（例如：-221 表示公元前221年，712 表示公元712年），用于时间线绝对排序
  date: string         // 具体时间描述（例如："开元十三年"、"公元712年"）
  title: string        // 事件名称
  description: string  // 条目定稿（进入写作上下文；历史 agent 会读取作核验/发散，但只写结果字段，不直接覆盖）
  /** 概念与创作思路（作者初步设定 / 想达到的效果，AI agent 会读取，可在迭代后修正） */
  conceptNote?: string
  impact?: string      // 对世界/剧情的影响
  isHistorical: boolean // 是否为真实史实（true=史实，false=虚构/架空）
  source?: string      // 史料来源/考证出处
  aiBrainstorm?: string // AI 头脑风暴 agent 输出结果（虚构/细节风暴）
  /** AI 历史考据 agent 输出结果（与 aiBrainstorm 解耦保存） */
  aiConsult?: string
  /** 用户给「历史考据 agent」的额外指令（与 description 解耦，可声明艺术改造/容许架空范围等） */
  consultPrompt?: string
  /** 用户给「头脑风暴 agent」的额外指令（与 description 解耦，可声明虚构方向、想要的细节维度等） */
  stormPrompt?: string
  relatedChapterIds?: number[] // 关联的章节 ID 列表
  customTimeRange?: string // 具体时间范围/区间（可选，如“公元712年-756年”）
  location?: string    // 地理位置/范围（可选，如“江南地区”、“君士坦丁堡”）
  /** 所属世界组 ID（Phase 25.4，null = 默认主世界） */
  worldGroupId?: number | null
  createdAt: number
  updatedAt: number
}

/** 历史关键词分类 */
export type HistoricalKeywordCategory =
  | 'technology'   // 器物与科技（如：织布机、造纸术、火药）
  | 'institution'  // 制度与官职（如：科举、三省六部、均田制）
  | 'culture'      // 文化与风俗（如：避讳、茶道、寒食节）
  | 'economy'      // 社会与经济（如：飞钱、坊市制、盐铁专卖）
  | 'architecture' // 地理与建筑（如：园林、里坊、驿站）

export const KEYWORD_CATEGORY_LABELS: Record<HistoricalKeywordCategory, string> = {
  technology: '器物与科技',
  institution: '制度与官职',
  culture: '文化与风俗',
  economy: '社会与经济',
  architecture: '地理与建筑',
}

/** 历史关键词（PHASE-H2 独立表存储） */
export interface HistoricalKeyword {
  id?: number          // 数据库自增 ID
  projectId: number    // 项目 ID
  keyword: string      // 关键词名称（如"织布机"）
  category: HistoricalKeywordCategory // 分类
  era: HistoricalEra | string // 适用历史时期
  description: string  // 条目定稿（进入写作上下文；历史 agent 会读取作核验/发散，但只写结果字段，不直接覆盖）
  /** 概念与创作思路（作者初步设定 / 想达到的效果，AI agent 会读取，可在迭代后修正） */
  conceptNote?: string
  aiBrainstorm?: string // AI 细节头脑风暴结果（保存时代质感细节）
  /** AI 历史考据 agent 输出结果（与 aiBrainstorm 解耦保存） */
  aiConsult?: string
  /** 用户给「历史考据 agent」的额外指令（与 description / conceptNote 解耦） */
  consultPrompt?: string
  /** 用户给「头脑风暴 agent」的额外指令（与 description / conceptNote 解耦） */
  stormPrompt?: string
  relatedChapterIds?: number[] // 关联的章节 ID 列表
  customTimeRange?: string // 具体时间范围/区间（可选，如“公元712年-756年”）
  location?: string    // 地理位置/范围（可选，如“江南地区”、“君士坦丁堡”）
  /** 所属世界组 ID（Phase 25.4，null = 默认主世界） */
  worldGroupId?: number | null
  createdAt: number
  updatedAt: number
}
