import { historyAuthorRecordV1 } from '../types/history'
import { createPortableResourceUidV1, isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { REGISTRY_BY_NAME } from '../registry/project-tables'

/** Stable host allocations are frozen in the original task, never chosen by a model. */
export interface HistoryEventCreationRequestV1 {
  mode: 'from-empty' | 'supplement'
  draftIds: string[]
}
export interface HistoryEventDraftV1 {
  draftId: string
  title: string
  era: string
  date: string
  description: string
  impact: string
}
export interface HistoryEventCandidatesV1 {
  version: 1
  events: HistoryEventDraftV1[]
  /** Author selection only. Model responses cannot select their own adoption. */
  selectedIds?: string[]
}
const resourceKind = () => REGISTRY_BY_NAME.get('historicalTimelineEvents')!.resourceIdentity!.resourceKind
// Host allocation guard for one proposal, not a limit on the saved timeline.
export const MAX_HISTORY_EVENT_CANDIDATES_V1 = 1000
export function allocateHistoryEventDraftIdsV1(count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_HISTORY_EVENT_CANDIDATES_V1) throw new Error('每批事件数量须为1至1000的整数；已保存的时间轴不受此批次上限影响。')
  return Array.from({ length: count }, () => createPortableResourceUidV1(resourceKind()))
}
export function parseHistoryEventCreationRequestV1(value: unknown): HistoryEventCreationRequestV1 {
  const input = historyAuthorRecordV1(value, ['mode', 'draftIds'], '事件生成请求')
  if ((input.mode !== 'from-empty' && input.mode !== 'supplement') || !Array.isArray(input.draftIds) || !input.draftIds.length || input.draftIds.length > MAX_HISTORY_EVENT_CANDIDATES_V1
    || input.draftIds.some(id => !isPortableResourceUidV1(id, resourceKind()) || id !== id.trim()) || new Set(input.draftIds).size !== input.draftIds.length) throw new Error('历史事件请求缺少有效的固定草稿身份。')
  return { mode: input.mode, draftIds: [...input.draftIds] }
}
export function parseHistoryEventCandidatesV1(raw: string, frozenRequest: HistoryEventCreationRequestV1, authorEdit = true): HistoryEventCandidatesV1 {
  const request = parseHistoryEventCreationRequestV1(frozenRequest)
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('事件候选需要完整 JSON；原响应保留，可修改后再确认。') }
  return copyHistoryEventCandidatesV1(value, request, authorEdit)
}

export function copyHistoryEventCandidatesV1(value: unknown, frozenRequest: HistoryEventCreationRequestV1, authorEdit = true): HistoryEventCandidatesV1 {
  const request = parseHistoryEventCreationRequestV1(frozenRequest)
  const input = historyAuthorRecordV1(value, ['version', 'events', ...(authorEdit ? ['selectedIds'] : [])], '事件候选')
  if (input.version !== 1 || !Array.isArray(input.events) || !input.events.length || input.events.length > request.draftIds.length) throw new Error('事件候选数量或版本无效。')
  const allowed = new Set(request.draftIds), seen = new Set<string>()
  const events = input.events.map(value => {
    const row = historyAuthorRecordV1(value, ['draftId', 'title', 'era', 'date', 'description', 'impact'], '单项事件')
    if (typeof row.draftId !== 'string' || !allowed.has(row.draftId) || seen.has(row.draftId)) throw new Error('事件候选不能更换或重复原草稿身份。')
    for (const field of ['title', 'era', 'date', 'description', 'impact']) {
      if (typeof row[field] !== 'string' || !authorEdit && field !== 'impact' && !(row[field] as string).trim()) throw new Error('事件候选须完整填写名称、时期、时间表达和过程。')
    }
    seen.add(row.draftId)
    return { draftId: row.draftId, title: row.title as string, era: row.era as string, date: row.date as string, description: row.description as string, impact: row.impact as string }
  })
  if (input.selectedIds !== undefined && (!Array.isArray(input.selectedIds) || input.selectedIds.some(id => typeof id !== 'string' || !seen.has(id))
    || new Set(input.selectedIds).size !== input.selectedIds.length)) throw new Error('只能选择本次已有事件候选。')
  return { version: 1, events, ...(input.selectedIds !== undefined ? { selectedIds: [...input.selectedIds as string[]] } : {}) }
}

export function assertSelectedHistoryEventsCompleteV1(candidate: HistoryEventCandidatesV1): void {
  if (!candidate.selectedIds?.length) throw new Error('请先选择要加入时间轴的事件。')
  for (const row of candidate.events.filter(event => candidate.selectedIds!.includes(event.draftId))) {
    if (['title', 'era', 'date', 'description'].some(field => !row[field as keyof HistoryEventDraftV1].trim())) throw new Error('请补全已选事件的名称、时期、时间表达和过程；未选草稿可以继续保留。')
  }
}
