import type {
  HistoricalEra,
  HistoricalKeyword,
  HistoricalKeywordCategory,
  HistoricalTimelineEvent,
  History,
  WorkspaceScope,
} from '../types'
import { HISTORICAL_ERA_LABELS, KEYWORD_CATEGORY_LABELS } from '../types/history'
import { readOwnedRows } from '../workspace/scope'
import { formatHistoricalYear } from './year'

export type HistoryAgentModeV1 = 'consult' | 'storm'
export type HistoryAgentTargetKindV1 = 'event' | 'keyword'

export interface HistoryAgentOverviewSnapshotV1 {
  id: number
  overview: string
  eraSystem: string
  events: string
  worldGroupId: number | null
  worldId: number
  createdAt: number
  updatedAt: number
}

export interface HistoryAgentEventSnapshotV1 {
  id: number
  projectId: number
  era: string
  year: number
  date: string
  title: string
  description: string
  conceptNote: string
  impact: string
  isHistorical: boolean
  source: string
  aiBrainstorm: string | null
  aiBrainstormPresent: boolean
  aiConsult: string | null
  aiConsultPresent: boolean
  consultPrompt: string
  stormPrompt: string
  relatedChapterIds: number[]
  customTimeRange: string
  location: string
  worldGroupId: number | null
  worldId: number
  createdAt: number
  updatedAt: number
}

export interface HistoryAgentKeywordSnapshotV1 {
  id: number
  projectId: number
  keyword: string
  category: string
  era: string
  description: string
  conceptNote: string
  aiBrainstorm: string | null
  aiBrainstormPresent: boolean
  aiConsult: string | null
  aiConsultPresent: boolean
  consultPrompt: string
  stormPrompt: string
  relatedChapterIds: number[]
  customTimeRange: string
  location: string
  worldGroupId: number | null
  worldId: number
  createdAt: number
  updatedAt: number
}

export type HistoryAgentTargetSnapshotV1 =
  | { kind: 'event'; item: HistoryAgentEventSnapshotV1 }
  | { kind: 'keyword'; item: HistoryAgentKeywordSnapshotV1 }

export interface HistoryAgentBaselineV1 {
  version: 1
  mode: HistoryAgentModeV1
  worldGroupId: number | null
  history: HistoryAgentOverviewSnapshotV1 | null
  target: HistoryAgentTargetSnapshotV1
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function ownerWorldId(row: Record<string, unknown>): number {
  const worldId = Number(row.worldId)
  if (!Number.isInteger(worldId) || worldId <= 0) throw new Error('历史 Agent 目标缺少有效 World owner。')
  return worldId
}

function sameWorldGroup(row: { worldGroupId?: number | null }, worldGroupId: number | null): boolean {
  return (row.worldGroupId ?? null) === worldGroupId
}

function historySnapshot(row: History & { id: number }): HistoryAgentOverviewSnapshotV1 {
  return {
    id: row.id,
    overview: row.overview,
    eraSystem: row.eraSystem,
    events: row.events,
    worldGroupId: row.worldGroupId ?? null,
    worldId: ownerWorldId(row as unknown as Record<string, unknown>),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function eventSnapshot(row: HistoricalTimelineEvent & { id: number }): HistoryAgentEventSnapshotV1 {
  return {
    id: row.id,
    projectId: row.projectId,
    era: String(row.era),
    year: row.year,
    date: row.date,
    title: row.title,
    description: row.description,
    conceptNote: text(row.conceptNote),
    impact: text(row.impact),
    isHistorical: row.isHistorical,
    source: text(row.source),
    aiBrainstorm: nullableString(row.aiBrainstorm),
    aiBrainstormPresent: Object.prototype.hasOwnProperty.call(row, 'aiBrainstorm'),
    aiConsult: nullableString(row.aiConsult),
    aiConsultPresent: Object.prototype.hasOwnProperty.call(row, 'aiConsult'),
    consultPrompt: text(row.consultPrompt),
    stormPrompt: text(row.stormPrompt),
    relatedChapterIds: Array.isArray(row.relatedChapterIds) ? [...row.relatedChapterIds] : [],
    customTimeRange: text(row.customTimeRange),
    location: text(row.location),
    worldGroupId: row.worldGroupId ?? null,
    worldId: ownerWorldId(row as unknown as Record<string, unknown>),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function keywordSnapshot(row: HistoricalKeyword & { id: number }): HistoryAgentKeywordSnapshotV1 {
  return {
    id: row.id,
    projectId: row.projectId,
    keyword: row.keyword,
    category: String(row.category),
    era: String(row.era),
    description: row.description,
    conceptNote: text(row.conceptNote),
    aiBrainstorm: nullableString(row.aiBrainstorm),
    aiBrainstormPresent: Object.prototype.hasOwnProperty.call(row, 'aiBrainstorm'),
    aiConsult: nullableString(row.aiConsult),
    aiConsultPresent: Object.prototype.hasOwnProperty.call(row, 'aiConsult'),
    consultPrompt: text(row.consultPrompt),
    stormPrompt: text(row.stormPrompt),
    relatedChapterIds: Array.isArray(row.relatedChapterIds) ? [...row.relatedChapterIds] : [],
    customTimeRange: text(row.customTimeRange),
    location: text(row.location),
    worldGroupId: row.worldGroupId ?? null,
    worldId: ownerWorldId(row as unknown as Record<string, unknown>),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function readHistoryAgentBaselineV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  mode: HistoryAgentModeV1
  targetKind: HistoryAgentTargetKindV1
  targetId: number
}): Promise<HistoryAgentBaselineV1> {
  if (!Number.isInteger(input.targetId) || input.targetId <= 0) throw new Error('历史 Agent 目标 ID 无效。')
  const [histories, targets] = await Promise.all([
    readOwnedRows<History>(input.scope, 'histories', { owner: 'world' }),
    input.targetKind === 'event'
      ? readOwnedRows<HistoricalTimelineEvent>(input.scope, 'historicalTimelineEvents', { owner: 'world' })
      : readOwnedRows<HistoricalKeyword>(input.scope, 'historicalKeywords', { owner: 'world' }),
  ])
  const history = histories.find(row => row.id != null && sameWorldGroup(row, input.worldGroupId)) ?? null
  const target = targets.find(row => row.id === input.targetId && sameWorldGroup(row, input.worldGroupId))
  if (!target?.id) throw new Error('历史 Agent 目标不存在、不属于当前 World 或世界组不匹配。')
  return {
    version: 1,
    mode: input.mode,
    worldGroupId: input.worldGroupId,
    history: history ? historySnapshot(history as History & { id: number }) : null,
    target: input.targetKind === 'event'
      ? { kind: 'event', item: eventSnapshot(target as HistoricalTimelineEvent & { id: number }) }
      : { kind: 'keyword', item: keywordSnapshot(target as HistoricalKeyword & { id: number }) },
  }
}

function eventMeta(item: HistoryAgentEventSnapshotV1, mode: HistoryAgentModeV1): string[] {
  const era = HISTORICAL_ERA_LABELS[item.era as HistoricalEra] || item.era
  return [
    `标题：${item.title}`,
    `历史时期：${era}`,
    `数字化年份：${item.year} (${formatHistoricalYear(item.year)})`,
    `时间描述：${item.date || '未填写'}`,
    `具体时间范围：${item.customTimeRange || '未填写'}`,
    `地理位置：${item.location || '未填写'}`,
    `作者标记：${item.isHistorical ? '真实史实' : '虚构 / 架空'}`,
    ...(mode === 'consult' ? [`现有史料来源：${item.source || '无'}`] : []),
  ]
}

function keywordMeta(item: HistoryAgentKeywordSnapshotV1): string[] {
  const era = HISTORICAL_ERA_LABELS[item.era as HistoricalEra] || item.era
  const category = KEYWORD_CATEGORY_LABELS[item.category as HistoricalKeywordCategory] || item.category
  return [
    `关键词：${item.keyword}`,
    `分类：${category}`,
    `适用历史时期：${era}`,
    `具体时间范围：${item.customTimeRange || '未填写'}`,
    `地理位置：${item.location || '未填写'}`,
  ]
}

/** This is the exact registered text delivered to the model. Saved AI outputs are deliberately excluded. */
export function formatHistoryAgentBaselineV1(baseline: HistoryAgentBaselineV1): string {
  const item = baseline.target.item
  const instruction = baseline.mode === 'consult'
    ? item.consultPrompt
    : item.stormPrompt
  return [
    '【历史 Agent 正式输入基线】',
    `任务：${baseline.mode === 'consult' ? '历史考据' : '历史向头脑风暴'}`,
    `目标类型：${baseline.target.kind === 'event' ? '历史事件' : '历史关键词'}`,
    '',
    '【历史总述】',
    baseline.history?.overview || '未填写',
    '【纪年体系】',
    baseline.history?.eraSystem || '未填写',
    '',
    '【目标条目元信息】',
    ...(baseline.target.kind === 'event' ? eventMeta(baseline.target.item, baseline.mode) : keywordMeta(baseline.target.item)),
    '',
    '【条目定稿】',
    item.description || '未填写',
    '【概念与创作思路】',
    item.conceptNote || '未填写',
    `【作者给${baseline.mode === 'consult' ? '考据' : '头脑风暴'} Agent 的补充说明】`,
    instruction || '未填写',
  ].join('\n')
}

export async function readHistoryAgentBaselineContextV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  mode: HistoryAgentModeV1
  targetKind: HistoryAgentTargetKindV1
  targetId: number
}): Promise<string> {
  return formatHistoryAgentBaselineV1(await readHistoryAgentBaselineV1(input))
}
