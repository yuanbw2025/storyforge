import Dexie from 'dexie'
import { db } from '../db/schema'
import type { AgentConversation, AgentEvent, WorkspaceScope } from '../types'
import { historyAuthorRecordV1, copyHistoryAuthorOriginV1, copyHistoryAuthorSelectionV1, KEYWORD_CATEGORY_LABELS, type HistoricalKeywordCategory } from '../types/history'
import { createPortableResourceUidV1, isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { scopeTransactionTables, readOwnedRows } from '../workspace/scope'
import { appendAgentEvent, getOrCreateAgentConversation, readAgentEvents } from '../agent/conversation-channel'
import { assertLongformHistoryScopeV1 } from './authoring-scope'

const PURPOSE = 'history-keyword-author-drafts-v1'
const resourceKind = () => REGISTRY_BY_NAME.get('historicalKeywords')!.resourceIdentity!.resourceKind
export interface HistoryKeywordDraftV1 {
  draftId: string
  keyword: string
  category: HistoricalKeywordCategory
  era: string
  customTimeRange: string
  location: string
  description: string
  conceptNote: string
  selected: boolean
  deleted: boolean
}
export interface HistoryKeywordDraftSetV1 { version: 1; drafts: HistoryKeywordDraftV1[] }
export interface HistoryKeywordDraftScopeV1 { scope: WorkspaceScope; worldGroupId: number | null }
export interface HistoryKeywordDraftReadV1 { revision: number | null; value: HistoryKeywordDraftSetV1 }

export function createHistoryKeywordDraftV1(keyword = ''): HistoryKeywordDraftV1 {
  return { draftId: createPortableResourceUidV1(resourceKind()), keyword, category: 'technology', era: 'custom', customTimeRange: '', location: '', description: '', conceptNote: '', selected: false, deleted: false }
}
export function copyHistoryKeywordDraftSetV1(value: unknown): HistoryKeywordDraftSetV1 {
  const root = historyAuthorRecordV1(value, ['version', 'drafts'], '关键词草稿集')
  if (root.version !== 1 || !Array.isArray(root.drafts)) throw new Error('关键词草稿集版本无效。')
  const seen = new Set<string>()
  const drafts = root.drafts.map(value => {
    const row = historyAuthorRecordV1(value, ['draftId', 'keyword', 'category', 'era', 'customTimeRange', 'location', 'description', 'conceptNote', 'selected', 'deleted'], '关键词草稿')
    if (!isPortableResourceUidV1(row.draftId, resourceKind()) || seen.has(row.draftId) || row.draftId !== row.draftId.trim()) throw new Error('关键词草稿身份无效或重复。')
    if (typeof row.category !== 'string' || !Object.prototype.hasOwnProperty.call(KEYWORD_CATEGORY_LABELS, row.category)) throw new Error('关键词草稿分类无效。')
    if (['keyword', 'era', 'customTimeRange', 'location', 'description', 'conceptNote'].some(key => typeof row[key] !== 'string')
      || typeof row.selected !== 'boolean' || typeof row.deleted !== 'boolean' || row.deleted && row.selected) throw new Error('关键词草稿文字或选择状态无效。')
    seen.add(row.draftId)
    return { ...row } as unknown as HistoryKeywordDraftV1
  })
  return { version: 1, drafts }
}
/** Cancellation changes membership, never another draft's text or a formal row. */
export function selectHistoryKeywordDraftV1(value: HistoryKeywordDraftSetV1, draftId: string, selected: boolean): HistoryKeywordDraftSetV1 {
  const set = copyHistoryKeywordDraftSetV1(value), draft = set.drafts.find(row => row.draftId === draftId)
  if (!draft || draft.deleted) throw new Error('该关键词草稿不存在或已删除。')
  draft.selected = selected
  return set
}
export function deleteHistoryKeywordDraftV1(value: HistoryKeywordDraftSetV1, draftId: string, deleted: boolean): HistoryKeywordDraftSetV1 {
  const set = copyHistoryKeywordDraftSetV1(value), draft = set.drafts.find(row => row.draftId === draftId)
  if (!draft) throw new Error('该关键词草稿不存在。')
  draft.deleted = deleted; draft.selected = false
  return set
}
function copyOrigin(input: HistoryKeywordDraftScopeV1): HistoryKeywordDraftScopeV1 {
  const origin = copyHistoryAuthorOriginV1({ version: 1, kind: 'work', scope: input.scope })
  const selection = copyHistoryAuthorSelectionV1({ kind: 'partition', worldGroupId: input.worldGroupId })
  if (origin.kind !== 'work' || selection.kind !== 'partition') throw new Error('关键词草稿需要原长篇及明确分区。')
  return { scope: origin.scope, worldGroupId: selection.worldGroupId }
}
async function channel(input: HistoryKeywordDraftScopeV1) {
  await assertLongformHistoryScopeV1(input.scope, input.worldGroupId, Dexie.currentTransaction!)
  if (input.worldGroupId !== null) {
    const group = await db.worldGroups.get(input.worldGroupId)
    if (group?.projectId !== input.scope.projectId || group.worldId !== input.scope.worldId) throw new Error('关键词草稿分区不属于当前世界。')
  }
  const rows = (await readOwnedRows<AgentConversation>(input.scope, 'agentConversations', { owner: 'work' }))
    .filter(row => row.status === 'active' && row.purpose === PURPOSE && (row.worldGroupId ?? null) === input.worldGroupId)
  if (rows.length > 1) throw new Error('该历史分区有多套草稿记录，请先核对；未覆盖任一份内容。')
  return rows[0]
}
function lastState(events: AgentEvent[]): HistoryKeywordDraftReadV1 {
  const last = events[events.length - 1]
  if (!last) return { revision: null, value: { version: 1, drafts: [] } }
  const payload = JSON.parse(last.payload)
  if (last.kind !== 'message' || last.role !== 'user' || last.durableRunId != null || payload.type !== PURPOSE || payload.version !== 1) throw new Error('关键词草稿记录格式异常，未覆盖原输入。')
  return { revision: last.id!, value: copyHistoryKeywordDraftSetV1(JSON.parse(last.content)) }
}
export const historyKeywordDraftTransactionTablesV1 = () => scopeTransactionTables(db.worldGroups, db.agentConversations, db.agentEvents)
/** Author-only messages in the existing registered container. No new table,
 * formal keyword, candidate adoption, model call or automatic Canon source. */
export async function readHistoryKeywordDraftsV1(input: HistoryKeywordDraftScopeV1): Promise<HistoryKeywordDraftReadV1> {
  input = copyOrigin(input)
  return db.transaction('r', historyKeywordDraftTransactionTablesV1(), async () => {
    const conversation = await channel(input)
    return lastState(conversation ? await readAgentEvents(conversation.id!, input.scope) : [])
  })
}
export async function saveHistoryKeywordDraftsV1(input: HistoryKeywordDraftScopeV1 & { expectedRevision: number | null; value: HistoryKeywordDraftSetV1 }): Promise<HistoryKeywordDraftReadV1> {
  const origin = copyOrigin(input), value = copyHistoryKeywordDraftSetV1(input.value), expected = input.expectedRevision
  if (expected !== null && (!Number.isSafeInteger(expected) || expected < 1)) throw new Error('关键词草稿保存版本无效。')
  return db.transaction('rw', historyKeywordDraftTransactionTablesV1(), async () => {
    let conversation = await channel(origin)
    const previous = lastState(conversation ? await readAgentEvents(conversation.id!, origin.scope) : [])
    if (previous.revision !== expected) throw new Error('关键词草稿已在其他窗口更新；当前输入保留，请重新对照。')
    if (JSON.stringify(previous.value) === JSON.stringify(value)) return previous
    conversation ??= await getOrCreateAgentConversation({ projectId: origin.scope.projectId, scope: origin.scope, worldGroupId: origin.worldGroupId, purpose: PURPOSE, title: '历史关键词待处理草稿' })
    const event = await appendAgentEvent({ projectId: origin.scope.projectId, scope: origin.scope, conversationId: conversation.id!, kind: 'message', role: 'user', content: JSON.stringify(value), payload: { type: PURPOSE, version: 1 } })
    return { revision: event.id!, value }
  })
}
