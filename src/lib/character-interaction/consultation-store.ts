import {db} from '../db/schema'
import {adopt} from '../registry/adopt'
import {canonicalStringify} from '../agent/run/hash'
import {scopeTransactionTables} from '../workspace/scope'
import type {WorkspaceScope} from '../types'
import {readChatDraftV1} from './draft-service'
import {parseChatAuthoringSettings} from './authoring-contract'
import {readChatConsultationContextV2, type ChatConsultationRequestV2} from './consultation-context'
import {parseChatPlanCandidateV2} from './consultation-candidate'
import {applyChatPlanChangesV1, type ChatPlanCandidateV1, type ChatPlanFieldV1} from './consultation-plan'

export async function prepareChatPlanWriteV2(scopeInput: WorkspaceScope, request: ChatConsultationRequestV2, candidate: ChatPlanCandidateV1, selected: readonly ChatPlanFieldV1[]) {
  const scope = structuredClone(scopeInput), fields = [...selected]
  const context = await readChatConsultationContextV2(scope, request)
  const parsed = parseChatPlanCandidateV2(candidate, context), draft = await readChatDraftV1(scope)
  if (!fields.length || new Set(fields).size !== fields.length || fields.some(field => !parsed.changes.some(change => change.field === field))) throw new Error('请明确选择本次候选中要采用的修改')
  if (draft.revision !== request.draftRevision) throw new Error('方案已变化，本次没有写入')
  const settings = applyChatPlanChangesV1(parseChatAuthoringSettings(JSON.parse(draft.settingsJson)), parsed.changes.filter(change => fields.includes(change.field)))
  return {scope, expected: draft, settings, fields, context}
}
export async function commitChatPlanWriteV2(input: Awaited<ReturnType<typeof prepareChatPlanWriteV2>>) {
  return db.transaction('rw', scopeTransactionTables(db.chatAuthoringDrafts), async () => {
    const draft = await readChatDraftV1(input.scope)
    if (draft.revision !== input.expected.revision || draft.settingsJson !== input.expected.settingsJson || draft.worldReleaseId !== input.expected.worldReleaseId) throw new Error('方案已变化，本次没有写入')
    const result = await adopt({projectId: input.scope.projectId, scope: input.scope, target: 'chatAuthoringDrafts', recordId: draft.id!, mode: 'replace', data: {settingsJson: canonicalStringify(input.settings)}})
    if (result.written.length !== 1 || result.skipped.length || result.unknown.length || result.typeErrors.length) throw new Error('方案采纳未完整完成')
    await db.chatAuthoringDrafts.update(draft.id!, {revision: draft.revision + 1})
    return readChatDraftV1(input.scope)
  })
}
