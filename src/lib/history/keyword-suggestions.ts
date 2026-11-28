import Dexie, { type Transaction } from 'dexie'
import { db } from '../db/schema'
import { createPortableResourceUidV1, isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { ADOPTION_EXTENSIONS } from '../registry/adoption-schema'
import type { AdoptResult } from '../registry/types'
import { hashCanonicalValue } from '../agent/run/hash'
import { copyHistoryAuthorOriginV1, copyHistoryAuthorSelectionV1, historyAuthorRecordV1, KEYWORD_CATEGORY_LABELS, type HistoricalKeywordCategory } from '../types/history'
import { createHistoryKeywordDraftV1, copyHistoryKeywordDraftSetV1, readHistoryKeywordDraftsV1, saveHistoryKeywordDraftsV1, historyKeywordDraftTransactionTablesV1, type HistoryKeywordDraftScopeV1, type HistoryKeywordDraftReadV1 } from './keyword-drafts'

const kind = () => REGISTRY_BY_NAME.get('historicalKeywords')!.resourceIdentity!.resourceKind
export interface HistoryKeywordSuggestionRequestV1 { draftIds: string[] }
export interface HistoryKeywordSuggestionV1 { draftId: string; keyword: string; category: HistoricalKeywordCategory; era: string; reason: string }
export interface HistoryKeywordSuggestionsV1 { version: 1; suggestions: HistoryKeywordSuggestionV1[]; selectedIds?: string[] }
export interface HistoryKeywordSuggestionsSnapshotV1 extends HistoryKeywordDraftScopeV1 {
  version: 1; request: HistoryKeywordSuggestionRequestV1; baseline: HistoryKeywordDraftReadV1; baselineHash: string
}
export interface AdoptHistoryKeywordSuggestionsInputV1 {
  target: 'agentEvents'; mode: 'add-many'; historyKeywordSuggestions: HistoryKeywordSuggestionsSnapshotV1; data: HistoryKeywordSuggestionsV1
}
export function allocateHistoryKeywordSuggestionIdsV1(count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('每批建议数量须为1至1000的整数，不限制已保存的关键词数。')
  return Array.from({ length: count }, () => createPortableResourceUidV1(kind()))
}
export function parseHistoryKeywordSuggestionRequestV1(value: unknown): HistoryKeywordSuggestionRequestV1 {
  const row = historyAuthorRecordV1(value, ['draftIds'], '关键词推荐请求')
  if (!Array.isArray(row.draftIds) || !row.draftIds.length || row.draftIds.length > 1000 || row.draftIds.some(id => !isPortableResourceUidV1(id, kind()) || id !== id.trim()) || new Set(row.draftIds).size !== row.draftIds.length) throw new Error('关键词建议须绑定主机分配的独立草稿身份。')
  return { draftIds: [...row.draftIds] }
}
export function copyHistoryKeywordSuggestionsV1(value: unknown, frozen: HistoryKeywordSuggestionRequestV1, authorEdit = true): HistoryKeywordSuggestionsV1 {
  const request = parseHistoryKeywordSuggestionRequestV1(frozen)
  const row = historyAuthorRecordV1(value, ['version', 'suggestions', ...(authorEdit ? ['selectedIds'] : [])], '关键词建议')
  if (row.version !== 1 || !Array.isArray(row.suggestions) || !row.suggestions.length || row.suggestions.length > request.draftIds.length) throw new Error('关键词建议数量或版本无效。')
  const seen = new Set<string>()
  const suggestions = row.suggestions.map(value => {
    const item = historyAuthorRecordV1(value, ['draftId', 'keyword', 'category', 'era', 'reason'], '单项关键词建议')
    if (typeof item.draftId !== 'string' || !request.draftIds.includes(item.draftId) || seen.has(item.draftId)) throw new Error('关键词建议不能更换或重复原草稿身份。')
    if (typeof item.category !== 'string' || !Object.prototype.hasOwnProperty.call(KEYWORD_CATEGORY_LABELS, item.category)
      || ['keyword', 'era', 'reason'].some(field => typeof item[field] !== 'string' || !authorEdit && !(item[field] as string).trim())) throw new Error('关键词建议需完整名称、分类、时期及理由。')
    seen.add(item.draftId)
    return { draftId: item.draftId, keyword: item.keyword as string, category: item.category as HistoricalKeywordCategory, era: item.era as string, reason: item.reason as string }
  })
  if (row.selectedIds !== undefined && (!Array.isArray(row.selectedIds) || row.selectedIds.some(id => typeof id !== 'string' || !seen.has(id)) || new Set(row.selectedIds).size !== row.selectedIds.length)) throw new Error('只能选择本批已存在的关键词建议。')
  return { version: 1, suggestions, ...(row.selectedIds === undefined ? {} : { selectedIds: [...row.selectedIds as string[]] }) }
}
export function parseHistoryKeywordSuggestionsV1(raw: string, request: HistoryKeywordSuggestionRequestV1, authorEdit = true) {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('关键词建议需要完整 JSON，原响应保留。') }
  return copyHistoryKeywordSuggestionsV1(value, request, authorEdit)
}
export function parseHistoryKeywordSuggestionsSnapshotV1(value: unknown): HistoryKeywordSuggestionsSnapshotV1 {
  const row = historyAuthorRecordV1(value, ['version', 'scope', 'worldGroupId', 'request', 'baseline', 'baselineHash'], '关键词建议快照')
  const origin = copyHistoryAuthorOriginV1({ version: 1, kind: 'work', scope: row.scope })
  const selected = copyHistoryAuthorSelectionV1({ kind: 'partition', worldGroupId: row.worldGroupId })
  const baseline = historyAuthorRecordV1(row.baseline, ['revision', 'value'], '原草稿基线')
  if (row.version !== 1 || origin.kind !== 'work' || selected.kind !== 'partition' || typeof row.baselineHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.baselineHash)
    || baseline.revision !== null && (!Number.isSafeInteger(baseline.revision) || Number(baseline.revision) < 1)) throw new Error('关键词建议作用域或基线无效。')
  const request = parseHistoryKeywordSuggestionRequestV1(row.request), drafts = copyHistoryKeywordDraftSetV1(baseline.value)
  if (drafts.drafts.some(draft => request.draftIds.includes(draft.draftId))) throw new Error('新建议不能复用作者已有草稿身份。')
  return { version: 1, scope: origin.scope, worldGroupId: selected.worldGroupId, request,
    baseline: { revision: baseline.revision as number | null, value: drafts }, baselineHash: row.baselineHash }
}
export async function readHistoryKeywordSuggestionsSnapshotV1(input: HistoryKeywordDraftScopeV1, request: HistoryKeywordSuggestionRequestV1) {
  const baseline = await readHistoryKeywordDraftsV1(input)
  return parseHistoryKeywordSuggestionsSnapshotV1({ version: 1, scope: input.scope, worldGroupId: input.worldGroupId, request, baseline, baselineHash: await hashCanonicalValue(baseline) })
}
export async function assertHistoryKeywordSuggestionsFreshV1(value: HistoryKeywordSuggestionsSnapshotV1): Promise<void> {
  const snapshot = parseHistoryKeywordSuggestionsSnapshotV1(value)
  const current = await readHistoryKeywordDraftsV1(snapshot)
  if (await hashCanonicalValue(snapshot.baseline) !== snapshot.baselineHash || await hashCanonicalValue(current) !== snapshot.baselineHash) throw new Error('[HistoryKeywordSuggestions] 作者草稿已变化，建议仍保留，请重新对照；未覆盖输入。')
}
export function assertHistoryKeywordSuggestionsSelectedV1(value: HistoryKeywordSuggestionsV1): void {
  if (!value.selectedIds?.length) throw new Error('请先选择要加入待处理区的关键词建议。')
  if (value.suggestions.some(row => value.selectedIds!.includes(row.draftId) && !row.keyword.trim())) throw new Error('请补全已选建议的关键词名称。')
}
/** The registered extension may append a new author draft state only. It cannot
 * edit existing messages, create official keywords, or manufacture author intent. */
export async function adoptHistoryKeywordSuggestionsV1(input: AdoptHistoryKeywordSuggestionsInputV1, owner?: { transaction: Transaction }): Promise<AdoptResult> {
  historyAuthorRecordV1(input, ['target', 'mode', 'historyKeywordSuggestions', 'data'], '建议转入草稿')
  if (input.target !== 'agentEvents' || input.mode !== 'add-many') throw new Error('关键词建议只允许转入作者草稿。')
  if (!ADOPTION_EXTENSIONS.some(extension => extension.id === 'history-keyword-suggestions-v1' && extension.target === 'agentEvents')) throw new Error('关键词草稿写入策略尚未登记，未修改任何记录。')
  const snapshot = parseHistoryKeywordSuggestionsSnapshotV1(input.historyKeywordSuggestions), candidate = copyHistoryKeywordSuggestionsV1(input.data, snapshot.request)
  assertHistoryKeywordSuggestionsSelectedV1(candidate)
  const tables = historyKeywordDraftTransactionTablesV1()
  const write = async () => {
    await Dexie.waitFor(assertHistoryKeywordSuggestionsFreshV1(snapshot))
    const value = copyHistoryKeywordDraftSetV1(snapshot.baseline.value)
    for (const suggestion of candidate.suggestions.filter(row => candidate.selectedIds!.includes(row.draftId))) {
      value.drafts.push({ ...createHistoryKeywordDraftV1(suggestion.keyword), draftId: suggestion.draftId, category: suggestion.category, era: suggestion.era, selected: true })
    }
    const saved = await saveHistoryKeywordDraftsV1({ ...snapshot, expectedRevision: snapshot.baseline.revision, value })
    return { written: [{ id: saved.revision!, fields: ['content'] }], unknown: [], typeErrors: [], fkErrors: [], skipped: [] }
  }
  if (owner) {
    if (Dexie.currentTransaction !== owner.transaction || owner.transaction.db !== db || !owner.transaction.active || owner.transaction.mode !== 'readwrite'
      || tables.some(table => !owner.transaction.storeNames.includes(table.name))) throw new Error('关键词建议缺少原作用域写入事务。')
    return write()
  }
  return db.transaction('rw', tables, write)
}
export async function historyKeywordSuggestionsMatchDraftsV1(value: HistoryKeywordSuggestionsSnapshotV1, data: HistoryKeywordSuggestionsV1): Promise<boolean> {
  const snapshot = parseHistoryKeywordSuggestionsSnapshotV1(value), candidate = copyHistoryKeywordSuggestionsV1(data, snapshot.request)
  if (!candidate.selectedIds?.length) return false
  const current = await readHistoryKeywordDraftsV1(snapshot)
  return candidate.suggestions.filter(row => candidate.selectedIds!.includes(row.draftId)).every(suggestion => {
    const draft = current.value.drafts.find(row => row.draftId === suggestion.draftId)
    return draft && !draft.deleted && draft.keyword === suggestion.keyword && draft.category === suggestion.category && draft.era === suggestion.era
  })
}
