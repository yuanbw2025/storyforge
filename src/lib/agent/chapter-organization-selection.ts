import { db } from '../db/schema'
import { assertRecordInScope, resolveScopeLike, scopeTransactionTables } from '../workspace/scope'
import { coordinatePendingEditV1 } from '../authoring/pending-edit-coordinator'
import { selectAllChapterOrganizationCandidates, type ChapterOrganizationCandidate, type ChapterOrganizationRun, type ChapterOrganizationSelection } from './chapter-organization'

function parseSelection(value: unknown, candidate: ChapterOrganizationCandidate): ChapterOrganizationSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('保存的选择必须是对象。')
  const allowed = selectAllChapterOrganizationCandidates(candidate)
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== Object.keys(allowed).length || Object.keys(record).some(key => !(key in allowed))) throw new Error('保存的选择分类不完整或含未知字段。')
  const result = { ...allowed }
  for (const key of Object.keys(allowed) as Array<keyof ChapterOrganizationSelection>) {
    const indexes = record[key]
    if (!Array.isArray(indexes)) throw new Error('保存的选择分类必须是数组。')
    const limit = allowed[key]?.length ?? 0
    for (let position = 0; position < indexes.length; position++) {
      const index = indexes[position]
      if (!Object.prototype.hasOwnProperty.call(indexes, position) || !Number.isSafeInteger(index) || index < 0 || index >= limit) throw new Error('保存的选择包含越界条目。')
    }
    if (new Set(indexes).size !== indexes.length) throw new Error('保存的选择包含重复条目。')
    result[key] = [...indexes].sort((left, right) => left - right)
  }
  return result
}

export function readChapterOrganizationSelectionV1(candidate: ChapterOrganizationCandidate): { selection: ChapterOrganizationSelection; error: string | null } {
  const all = selectAllChapterOrganizationCandidates(candidate)
  if (candidate.authorSelection === undefined) return { selection: all, error: null }
  try { return { selection: parseSelection(candidate.authorSelection, candidate), error: null } }
  catch {
    // A damaged author draft must never silently turn into "select all".
    return { selection: Object.fromEntries(Object.keys(all).map(key => [key, []])) as unknown as ChapterOrganizationSelection, error: '保存的勾选格式异常，原始记录已保留；请清空无效勾选后重新选择。' }
  }
}

/** Updates author metadata on the existing Work-owned candidate event. Exact
 * payload comparison prevents an older window from overwriting newer choices. */
export async function saveChapterOrganizationSelectionV1(input: { run: ChapterOrganizationRun; selection: ChapterOrganizationSelection }): Promise<ChapterOrganizationRun> {
  const eventId = input.run.event.id, conversationId = input.run.conversation.id
  if (eventId == null || conversationId == null) throw new Error('整理候选缺少保存选择所需的记录。')
  const frozen = structuredClone(input)
  return coordinatePendingEditV1({ key: `organization-selection:${eventId}`, persist: async () => {
    const scope = await resolveScopeLike(frozen.run.candidate.projectId)
    return db.transaction('rw', scopeTransactionTables(db.agentEvents, db.agentConversations, db.chapters), async () => {
      const [event, conversation, chapter] = await Promise.all([db.agentEvents.get(eventId), db.agentConversations.get(conversationId), db.chapters.get(frozen.run.candidate.chapterId)])
      if (!await assertRecordInScope(scope, 'agentEvents', event, { owner: 'work' })
        || !await assertRecordInScope(scope, 'agentConversations', conversation, { owner: 'work' })
        || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })
        || event!.conversationId !== conversationId || event!.kind !== 'candidate') throw new Error('整理候选不属于当前作品或已删除，选择没有保存。')
      if (event!.payload !== frozen.run.event.payload) throw new Error('另一页面已修改这批候选或选择；没有覆盖，请重新读取后再操作。')
      const candidate = JSON.parse(event!.payload) as ChapterOrganizationCandidate
      if (candidate.type !== 'chapter-organization' || candidate.projectId !== scope.projectId || candidate.chapterId !== chapter!.id) throw new Error('整理候选的身份不匹配，选择没有保存。')
      const updatedCandidate = { ...candidate, authorSelection: parseSelection(frozen.selection, candidate) }
      const payload = JSON.stringify(updatedCandidate), now = Date.now()
      if (await db.agentEvents.update(eventId, { payload }) !== 1) throw new Error('保存勾选未写入任何记录，选择仍未保存。')
      if (await db.agentConversations.update(conversationId, { updatedAt: now }) !== 1) throw new Error('保存勾选的归档记录已删除，选择仍未保存。')
      return { event: { ...event!, payload }, conversation: { ...conversation!, updatedAt: now }, candidate: updatedCandidate }
    })
  } })
}
