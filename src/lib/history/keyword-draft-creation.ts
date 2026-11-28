import { db } from '../db/schema'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { scopeTransactionTables } from '../workspace/scope'
import { useHistoricalStore } from '../../stores/historical'
import { copyHistoryKeywordDraftSetV1, readHistoryKeywordDraftsV1, saveHistoryKeywordDraftsV1, type HistoryKeywordDraftScopeV1, type HistoryKeywordDraftV1 } from './keyword-drafts'

const fields = ['keyword', 'category', 'era', 'customTimeRange', 'location', 'description', 'conceptNote'] as const
const normalizedName = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
/** Explicit author creation from saved drafts. This is the original manual
 * keyword writer, not an AI grant or adoption of an unreviewed model result. */
export async function createHistoryKeywordsFromDraftsV1(input: HistoryKeywordDraftScopeV1 & { expectedRevision: number; allowSameNames?: boolean }) {
  input = { ...input, scope: { ...input.scope } }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.allowSameNames !== undefined && typeof input.allowSameNames !== 'boolean') throw new Error('新建词条须确认当前草稿版本。')
  return db.transaction('rw', scopeTransactionTables(db.worldGroups, db.historicalKeywords, db.agentConversations, db.agentEvents), async () => {
    const current = await readHistoryKeywordDraftsV1(input)
    if (current.revision !== input.expectedRevision) throw new Error('草稿已变化，请重新对照后新建；未覆盖当前文字。')
    const value = copyHistoryKeywordDraftSetV1(current.value), selected = value.drafts.filter(row => row.selected && !row.deleted)
    if (!selected.length || selected.some(row => !row.keyword.trim())) throw new Error('请选择并填好要新建的关键词名称。')
    const all = await db.historicalKeywords.where('projectId').equals(input.scope.projectId).toArray()
    const identity = REGISTRY_BY_NAME.get('historicalKeywords')!.resourceIdentity!.field
    const inPartition = (row: typeof all[number]) => Reflect.get(row, 'worldId') === input.scope.worldId && Reflect.get(row, 'workId') == null && (row.worldGroupId ?? null) === input.worldGroupId
    const native = new Map<string, typeof all[number]>()
    for (const draft of selected) {
      const matches = all.filter(row => Reflect.get(row, identity) === draft.draftId)
      if (matches.length > 1 || matches.some(row => !inPartition(row))) throw new Error('草稿身份对应的正式词条不属于本历史分区，未新建。')
      if (matches[0]) {
        if (fields.some(field => (matches[0][field] ?? '') !== draft[field])) throw new Error('该草稿已加入正式词条；修改草稿不会覆盖已保存内容，请在正式词条中编辑。')
        native.set(draft.draftId, matches[0])
      }
    }
    const names = new Set(all.filter(inPartition).map(row => normalizedName(row.keyword)))
    for (const draft of selected.filter(row => !native.has(row.draftId))) {
      const name = normalizedName(draft.keyword)
      if (names.has(name) && !input.allowSameNames) throw new Error('存在同名词条或草稿；请明确选择保留独立条目，系统不会自动合并。')
      names.add(name)
    }
    const created: number[] = []
    for (const draft of selected) {
      const existing = native.get(draft.draftId)
      if (existing?.id) { created.push(existing.id); continue }
      const data = { ...Object.fromEntries(fields.map(field => [field, draft[field]])) as Pick<HistoryKeywordDraftV1, typeof fields[number]>,
        [identity]: draft.draftId, projectId: input.scope.projectId, worldGroupId: input.worldGroupId }
      created.push(await useHistoricalStore.getState().addKeyword(data, { projectId: input.scope.projectId, worldId: input.scope.worldId }))
    }
    for (const draft of selected) draft.selected = false
    const saved = await saveHistoryKeywordDraftsV1({ ...input, expectedRevision: current.revision, value })
    return { ...saved, created }
  })
}
