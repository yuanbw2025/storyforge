import { renderPrompt } from '../ai/prompt-engine'
import { usePromptStore } from '../../stores/prompt'
import type {
  ChatMessage,
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

const HISTORY_AGENT_STRICT_PROTOCOL_V1: Record<HistoryAIMode, string> = {
  consult: `

【HARNESS-73 严格输出协议】
只输出 Markdown 正文，不得使用代码围栏、JSON、前后客套或复述输入。输出必须依次包含“前提识别”“可能存在的问题”“修改方案 / 折中方案”“时代质感补充”四个标题；不确定的史实必须标“待考”，不得伪造出处。`,
  storm: `

【HARNESS-73 严格输出协议】
只输出 Markdown 正文，不得使用代码围栏、JSON、前后客套或复述输入。输出必须依次包含“场景画面”“人物与对白触点”“可写进小说的冲突灵感”“可选的史实补强”四个标题；不确定的史实必须标“待考”，不得伪造出处。`,
}

export function readHistoryAgentPromptTemplateV1(mode: HistoryAIMode): PromptTemplate {
  return usePromptStore.getState().getActive(mode === 'consult' ? 'history.consult' : 'history.storm')
}

export function readHistoryAgentPromptTemplateSnapshotV1(
  mode: HistoryAIMode,
  template: PromptTemplate = readHistoryAgentPromptTemplateV1(mode),
) {
  return {
    moduleKey: template.moduleKey,
    systemPrompt: template.systemPrompt,
    userPromptTemplate: template.userPromptTemplate,
    variables: template.variables,
    modelOverride: template.modelOverride ?? null,
    examples: template.examples ?? null,
    parameters: template.parameters ?? null,
    strictProtocol: HISTORY_AGENT_STRICT_PROTOCOL_V1[mode],
  }
}

/**
 * Durable history prompts consume the complete registered Context Gateway text
 * exactly once. Non-context template slots receive explicit pointers to the
 * registered input baseline, so customized templates cannot duplicate Canon.
 */
export function buildHistoryAgentMessagesV1(input: {
  mode: HistoryAIMode
  registeredContext: string
  template?: PromptTemplate
}): ChatMessage[] {
  const template = input.template ?? readHistoryAgentPromptTemplateV1(input.mode)
  const rendered = renderPrompt(template, {
    itemMeta: '目标条目元信息见下方“历史 Agent 正式输入基线”。',
    finalText: '条目定稿见下方“历史 Agent 正式输入基线”。',
    conceptNote: '',
    consultPrompt: '',
    stormPrompt: '',
    worldContext: input.registeredContext,
  }).messages
  const systemIndex = rendered.findIndex(message => message.role === 'system')
  if (systemIndex >= 0) {
    rendered[systemIndex] = {
      ...rendered[systemIndex],
      content: `${rendered[systemIndex].content}${HISTORY_AGENT_STRICT_PROTOCOL_V1[input.mode]}`,
    }
  } else {
    rendered.unshift({ role: 'system', content: HISTORY_AGENT_STRICT_PROTOCOL_V1[input.mode].trim() })
  }
  return rendered
}

export function parseHistoryAgentResultStrictV1(mode: HistoryAIMode, raw: string): string {
  const result = raw.trim()
  if (!result || result.length < 40 || result.length > 20_000 || result.includes('\u0000')) {
    throw new Error('历史 Agent 输出为空、过短、过长或包含非法字符。')
  }
  if (/^```[\s\S]*```$/.test(result)) throw new Error('历史 Agent 输出不得使用代码围栏。')
  const required = mode === 'consult'
    ? ['前提识别', '可能存在的问题', '修改方案 / 折中方案', '时代质感补充']
    : ['场景画面', '人物与对白触点', '可写进小说的冲突灵感', '可选的史实补强']
  let cursor = -1
  for (const heading of required) {
    const next = result.indexOf(heading, cursor + 1)
    if (next < 0 || next < cursor) throw new Error(`历史 Agent 输出缺少或打乱“${heading}”标题。`)
    cursor = next
  }
  return result
}
