import Dexie, { type Transaction } from 'dexie'
import { db } from '../db/schema'
import { ADOPTION_EXTENSIONS } from '../registry/adoption-schema'
import { historyAuthorRecordV1, copyHistoryAuthorOriginV1, copyHistoryAuthorSelectionV1 } from '../types/history'
import { hashCanonicalValue } from '../agent/run/hash'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import type { AdoptResult } from '../registry/types'
import { copyHistoryKeywordDraftSetV1, readHistoryKeywordDraftsV1, saveHistoryKeywordDraftsV1, historyKeywordDraftTransactionTablesV1, type HistoryKeywordDraftScopeV1, type HistoryKeywordDraftReadV1 } from './keyword-drafts'

export const HISTORY_KEYWORD_CONTENT_FIELDS_V1 = { description: '条目内容', conceptNote: '创作方向建议', customTimeRange: '时间范围', location: '地点', aiBrainstorm: '风暴灵感' } as const
export type HistoryKeywordContentFieldV1 = keyof typeof HISTORY_KEYWORD_CONTENT_FIELDS_V1
export interface HistoryKeywordContentTargetV1 { draftId: string; fields: HistoryKeywordContentFieldV1[] }
export interface HistoryKeywordContentRequestV1 { mode: 'fill-empty' | 'rewrite'; targets: HistoryKeywordContentTargetV1[] }
export interface HistoryKeywordContentPatchV1 { draftId: string; values: Partial<Record<HistoryKeywordContentFieldV1, string>> }
export interface HistoryKeywordContentV1 { version: 1; patches: HistoryKeywordContentPatchV1[]; selectedTargets?: HistoryKeywordContentTargetV1[] }
export interface HistoryKeywordContentSnapshotV1 extends HistoryKeywordDraftScopeV1 { version: 1; request: HistoryKeywordContentRequestV1; baseline: HistoryKeywordDraftReadV1; baselineHash: string }
export interface AdoptHistoryKeywordContentInputV1 { target: 'agentEvents'; mode: 'add-many'; historyKeywordContent: HistoryKeywordContentSnapshotV1; data: HistoryKeywordContentV1 }
const resourceKind = () => REGISTRY_BY_NAME.get('historicalKeywords')!.resourceIdentity!.resourceKind
export const historyKeywordContentTransactionTablesV1 = () => [...historyKeywordDraftTransactionTablesV1(), db.historicalKeywords]
function target(value: unknown): HistoryKeywordContentTargetV1 {
  const row = historyAuthorRecordV1(value, ['draftId', 'fields'], '关键词内容目标')
  if (!isPortableResourceUidV1(row.draftId, resourceKind()) || row.draftId !== row.draftId.trim() || !Array.isArray(row.fields) || !row.fields.length
    || new Set(row.fields).size !== row.fields.length || row.fields.some(field => typeof field !== 'string' || !Object.prototype.hasOwnProperty.call(HISTORY_KEYWORD_CONTENT_FIELDS_V1, field))) throw new Error('关键词内容必须绑定原草稿及明确字段。')
  return { draftId: row.draftId, fields: [...row.fields as HistoryKeywordContentFieldV1[]] }
}
export function parseHistoryKeywordContentRequestV1(value: unknown): HistoryKeywordContentRequestV1 {
  const row = historyAuthorRecordV1(value, ['mode', 'targets'], '关键词内容请求')
  if (!['fill-empty', 'rewrite'].includes(String(row.mode)) || !Array.isArray(row.targets) || !row.targets.length || row.targets.length > 1000) throw new Error('请选择本次关键词和字段范围。')
  const targets = row.targets.map(target)
  if (new Set(targets.map(row => row.draftId)).size !== targets.length) throw new Error('关键词生成目标不能重复。')
  return { mode: row.mode as HistoryKeywordContentRequestV1['mode'], targets }
}
export function copyHistoryKeywordContentV1(value: unknown, request: HistoryKeywordContentRequestV1, authorEdit = true): HistoryKeywordContentV1 {
  request = parseHistoryKeywordContentRequestV1(request)
  const root = historyAuthorRecordV1(value, ['version', 'patches', ...(authorEdit ? ['selectedTargets'] : [])], '关键词内容候选')
  if (root.version !== 1 || !Array.isArray(root.patches) || !root.patches.length || root.patches.length > request.targets.length) throw new Error('关键词内容候选数量或版本无效。')
  const seen = new Set<string>()
  const patches = root.patches.map(value => {
    const row = historyAuthorRecordV1(value, ['draftId', 'values'], '单条关键词候选'), wanted = request.targets.find(item => item.draftId === row.draftId)
    if (!wanted || seen.has(wanted.draftId)) throw new Error('内容候选不能更换或重复草稿身份。')
    const values = historyAuthorRecordV1(row.values, wanted.fields, '本次字段候选'), fields = Object.keys(values)
    if (!fields.length || fields.some(field => typeof values[field] !== 'string' || !authorEdit && !(values[field] as string).trim())) throw new Error('字段候选必须是本次目标内的文字。')
    seen.add(wanted.draftId)
    return { draftId: wanted.draftId, values: { ...values } as HistoryKeywordContentPatchV1['values'] }
  })
  let selectedTargets: HistoryKeywordContentTargetV1[] | undefined
  if (root.selectedTargets !== undefined) {
    if (!Array.isArray(root.selectedTargets)) throw new Error('请明确选择要采纳的字段。')
    selectedTargets = root.selectedTargets.map(target)
    if (new Set(selectedTargets.map(row => row.draftId)).size !== selectedTargets.length || selectedTargets.some(row => { const patch = patches.find(item => item.draftId === row.draftId); return !patch || row.fields.some(field => !Object.prototype.hasOwnProperty.call(patch.values, field)) })) throw new Error('只能采纳当前候选中已返回的字段。')
  }
  return { version: 1, patches, ...(selectedTargets === undefined ? {} : { selectedTargets }) }
}
export function parseHistoryKeywordContentV1(raw: string, request: HistoryKeywordContentRequestV1, authorEdit = true) {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('关键词内容需要完整 JSON；原响应保留，可修改后再采纳。') }
  return copyHistoryKeywordContentV1(value, request, authorEdit)
}
export function parseHistoryKeywordContentSnapshotV1(value: unknown): HistoryKeywordContentSnapshotV1 {
  const row = historyAuthorRecordV1(value, ['version', 'scope', 'worldGroupId', 'request', 'baseline', 'baselineHash'], '关键词内容快照')
  const origin = copyHistoryAuthorOriginV1({ version: 1, kind: 'work', scope: row.scope }), selection = copyHistoryAuthorSelectionV1({ kind: 'partition', worldGroupId: row.worldGroupId })
  const baseline = historyAuthorRecordV1(row.baseline, ['revision', 'value'], '草稿基线')
  if (row.version !== 1 || origin.kind !== 'work' || selection.kind !== 'partition' || typeof row.baselineHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.baselineHash)
    || !Number.isSafeInteger(baseline.revision) || Number(baseline.revision) < 1) throw new Error('关键词内容作用域或基线无效。')
  const request = parseHistoryKeywordContentRequestV1(row.request), drafts = copyHistoryKeywordDraftSetV1(baseline.value)
  for (const item of request.targets) {
    const draft = drafts.drafts.find(row => row.draftId === item.draftId)
    if (!draft || draft.deleted || !draft.keyword.trim() || request.mode === 'fill-empty' && item.fields.some(field => (draft[field] ?? '').trim())) throw new Error('只允许生成有效草稿的已选字段；补全模式不会覆盖已有内容。')
  }
  return { version: 1, scope: origin.scope, worldGroupId: selection.worldGroupId, request, baseline: { revision: Number(baseline.revision), value: drafts }, baselineHash: row.baselineHash }
}
async function assertNotFormal(snapshot: HistoryKeywordContentSnapshotV1) {
  const identity = REGISTRY_BY_NAME.get('historicalKeywords')!.resourceIdentity!.field
  const rows = await db.historicalKeywords.where('projectId').equals(snapshot.scope.projectId).toArray()
  if (rows.some(row => snapshot.request.targets.some(item => Reflect.get(row, identity) === item.draftId))) throw new Error('[HistoryKeywordContent] 草稿已创建正式词条，请在正式词条中编辑；未覆盖内容。')
}
export async function readHistoryKeywordContentSnapshotV1(input: HistoryKeywordDraftScopeV1, request: HistoryKeywordContentRequestV1) {
  const baseline = await readHistoryKeywordDraftsV1(input)
  const snapshot = parseHistoryKeywordContentSnapshotV1({ version: 1, ...input, request, baseline, baselineHash: await hashCanonicalValue(baseline) })
  await assertNotFormal(snapshot)
  return snapshot
}
export async function assertHistoryKeywordContentFreshV1(value: HistoryKeywordContentSnapshotV1) {
  const snapshot = parseHistoryKeywordContentSnapshotV1(value), current = await readHistoryKeywordDraftsV1(snapshot)
  // Finish original IndexedDB reads before native crypto yields the Dexie zone.
  await assertNotFormal(snapshot)
  if (await hashCanonicalValue(snapshot.baseline) !== snapshot.baselineHash || await hashCanonicalValue(current) !== snapshot.baselineHash) throw new Error('[HistoryKeywordContent] 作者草稿已变化，候选保留，请重新对照；未覆盖输入。')
}
export function assertHistoryKeywordContentSelectedV1(value: HistoryKeywordContentV1) {
  if (!value.selectedTargets?.length) throw new Error('请先选择要采纳到草稿的字段。')
}
export async function adoptHistoryKeywordContentV1(input: AdoptHistoryKeywordContentInputV1, owner?: { transaction: Transaction }): Promise<AdoptResult> {
  historyAuthorRecordV1(input, ['target', 'mode', 'historyKeywordContent', 'data'], '内容采纳')
  if (input.target !== 'agentEvents' || input.mode !== 'add-many' || !ADOPTION_EXTENSIONS.some(row => row.id === 'history-keyword-suggestions-v1' && row.target === 'agentEvents')) throw new Error('关键词内容只能通过专用草稿采纳。')
  const snapshot = parseHistoryKeywordContentSnapshotV1(input.historyKeywordContent), candidate = copyHistoryKeywordContentV1(input.data, snapshot.request)
  assertHistoryKeywordContentSelectedV1(candidate)
  const tables = historyKeywordContentTransactionTablesV1()
  const write = async () => {
    await Dexie.waitFor(assertHistoryKeywordContentFreshV1(snapshot))
    const value = copyHistoryKeywordDraftSetV1(snapshot.baseline.value)
    for (const selected of candidate.selectedTargets!) {
      const draft = value.drafts.find(row => row.draftId === selected.draftId)!, patch = candidate.patches.find(row => row.draftId === selected.draftId)!
      for (const field of selected.fields) draft[field] = patch.values[field]!
    }
    const saved = await saveHistoryKeywordDraftsV1({ ...snapshot, expectedRevision: snapshot.baseline.revision, value })
    return { written: [{ id: saved.revision!, fields: ['content'] }], unknown: [], typeErrors: [], fkErrors: [], skipped: [] }
  }
  if (owner) {
    if (Dexie.currentTransaction !== owner.transaction || owner.transaction.db !== db || !owner.transaction.active || owner.transaction.mode !== 'readwrite' || tables.some(table => !owner.transaction.storeNames.includes(table.name))) throw new Error('关键词内容缺少原作用域写入事务。')
    return write()
  }
  return db.transaction('rw', tables, write)
}
export async function historyKeywordContentMatchesDraftsV1(value: HistoryKeywordContentSnapshotV1, data: HistoryKeywordContentV1) {
  const snapshot = parseHistoryKeywordContentSnapshotV1(value), candidate = copyHistoryKeywordContentV1(data, snapshot.request), current = await readHistoryKeywordDraftsV1(snapshot)
  if (!candidate.selectedTargets?.length) return false
  return candidate.selectedTargets.every(selected => { const draft = current.value.drafts.find(row => row.draftId === selected.draftId), patch = candidate.patches.find(row => row.draftId === selected.draftId)!; return draft && !draft.deleted && selected.fields.every(field => draft[field] === patch.values[field]) })
}
