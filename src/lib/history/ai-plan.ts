import { renderPrompt } from '../ai/prompt-engine'
import type {
  HistoricalEra,
  HistoricalKeyword,
  HistoricalKeywordCategory,
  HistoricalTimelineEvent,
  PromptTemplate,
} from '../types'
import { HISTORICAL_ERA_LABELS, KEYWORD_CATEGORY_LABELS } from '../types/history'
import { formatHistoricalYear } from './year'

export type HistoryAIMode = 'consult' | 'storm'
export type HistoryAITarget =
  | { kind: 'event'; item: HistoricalTimelineEvent }
  | { kind: 'keyword'; item: HistoricalKeyword }

export interface HistoryAIOperation {
  kind: HistoryAITarget['kind']
  id: number
}

export function encodeHistoryAIOperation(target: HistoryAITarget): string | null {
  return target.item.id == null ? null : `${target.kind}:${target.item.id}`
}

export function decodeHistoryAIOperation(operation: string | null): HistoryAIOperation | null {
  if (!operation) return null
  const [kind, rawId] = operation.split(':')
  const id = Number(rawId)
  if ((kind !== 'event' && kind !== 'keyword') || !Number.isFinite(id)) return null
  return { kind, id }
}

export function buildHistoryManualContext(overview: string, eraSystem: string): string {
  return [
    overview.trim() ? `【历史总述】${overview.trim()}` : '',
    eraSystem.trim() ? `【纪年体系】${eraSystem.trim()}` : '',
  ].filter(Boolean).join('\n')
}

function eventMeta(event: HistoricalTimelineEvent, mode: HistoryAIMode): string {
  const eraLabel = HISTORICAL_ERA_LABELS[event.era as HistoricalEra] || event.era
  const marker = mode === 'consult'
    ? `- 是否标记为真实史实：${event.isHistorical ? '是' : '否（作者已声明为虚构 / 架空）'}`
    : `- 作者标记：${event.isHistorical ? '基于真实史实' : '虚构 / 架空，发散自由度更高'}`
  return [
    `- 标题：${event.title}`,
    `- 历史时期：${eraLabel}`,
    `- 数字化年份：${event.year} (${formatHistoricalYear(event.year)})`,
    `- 时间描述：${event.date}`,
    event.customTimeRange ? `- 具体时间范围/区间：${event.customTimeRange}` : '',
    event.location ? `- 地理位置/范围：${event.location}` : '',
    marker,
    mode === 'consult' ? `- 现有史料来源：${event.source || '无'}` : '',
  ].filter(Boolean).join('\n')
}

function keywordMeta(keyword: HistoricalKeyword): string {
  const eraLabel = HISTORICAL_ERA_LABELS[keyword.era as HistoricalEra] || keyword.era
  const categoryLabel = KEYWORD_CATEGORY_LABELS[keyword.category as HistoricalKeywordCategory] || keyword.category
  return [
    `- 关键词：${keyword.keyword}`,
    `- 分类：${categoryLabel}`,
    `- 适用历史时期：${eraLabel}`,
    keyword.customTimeRange ? `- 具体时间范围/区间：${keyword.customTimeRange}` : '',
    keyword.location ? `- 地理位置/范围：${keyword.location}` : '',
  ].filter(Boolean).join('\n')
}

export function buildHistoryAIMessages(input: {
  mode: HistoryAIMode
  target: HistoryAITarget
  worldContext: string
  template: PromptTemplate
}) {
  const { mode, target, worldContext, template } = input
  return renderPrompt(template, {
    itemMeta: target.kind === 'event' ? eventMeta(target.item, mode) : keywordMeta(target.item),
    finalText: target.item.description || '（条目定稿暂未填写）',
    conceptNote: (target.item.conceptNote || '').trim(),
    ...(mode === 'consult'
      ? { consultPrompt: (target.item.consultPrompt || '').trim() }
      : { stormPrompt: (target.item.stormPrompt || '').trim() }),
    worldContext,
  }).messages
}
