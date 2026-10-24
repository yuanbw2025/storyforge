import {db} from '../db/schema'
import {adopt} from '../registry/adopt'
import {canonicalStringify} from '../agent/run/hash'
import {scopeTransactionTables} from '../workspace/scope'
import type {WorkspaceScope} from '../types'
import {readChatDraftV1, loadChatSourceProjectionV1} from './draft-service'
import {parseChatAuthoringSettings} from './authoring-contract'
import {readChatSourceUnitConfirmationContextV1, type ChatSourceUnitConfirmationRequestV1} from './source-unit-confirmation-context'
import {parseChatSourceUnitSetV1, mergeChatSourceUnitBundleV1, validateChatSourceUnitSetForProjectionV1, type ChatSourceUnitAuthorizationReviewV1} from './source-unit-authorization'

export async function readChatSourceUnitSetV1(scope: WorkspaceScope) {
  const draft = await readChatDraftV1(scope)
  return draft.sourceUnitsJson === undefined ? undefined : parseChatSourceUnitSetV1(JSON.parse(draft.sourceUnitsJson))
}
export async function prepareChatSourceUnitWriteV1(scopeInput: WorkspaceScope, requestInput: ChatSourceUnitConfirmationRequestV1, report: ChatSourceUnitAuthorizationReviewV1) {
  const scope = structuredClone(scopeInput), request = structuredClone(requestInput)
  const context = await readChatSourceUnitConfirmationContextV1(scope, request), expected = await readChatDraftV1(scope)
  const settings = parseChatAuthoringSettings(JSON.parse(expected.settingsJson))
  if (expected.revision !== request.source.draftRevision || settings.version !== 3 || !settings.sourceReview) throw new Error('方案已变化，本次事实没有写入')
  const previous = expected.sourceUnitsJson === undefined ? undefined : parseChatSourceUnitSetV1(JSON.parse(expected.sourceUnitsJson))
  const set = mergeChatSourceUnitBundleV1(previous, {...context, review: structuredClone(report)})
  validateChatSourceUnitSetForProjectionV1(set, await loadChatSourceProjectionV1(scope, expected.revision), settings.sourceReview)
  return {scope, expected, context, set}
}
/** Called only by the explicit, verified confirmation run; no raw model or component writes. */
export async function commitChatSourceUnitWriteV1(input: Awaited<ReturnType<typeof prepareChatSourceUnitWriteV1>>) {
  return db.transaction('rw', scopeTransactionTables(db.chatAuthoringDrafts), async () => {
    const draft = await readChatDraftV1(input.scope)
    if (draft.revision !== input.expected.revision || draft.sourceUnitsJson !== input.expected.sourceUnitsJson || draft.settingsJson !== input.expected.settingsJson || draft.worldReleaseId !== input.expected.worldReleaseId) throw new Error('方案已变化，本次事实没有写入')
    const result = await adopt({projectId: input.scope.projectId, scope: input.scope, target: 'chatAuthoringDrafts', recordId: draft.id!, mode: 'replace', data: {sourceUnitsJson: canonicalStringify(input.set)}})
    if (result.written.length !== 1 || result.skipped.length || result.unknown.length || result.typeErrors.length) throw new Error('事实整理没有完整采纳')
    await db.chatAuthoringDrafts.update(draft.id!, {revision: draft.revision + 1})
    return readChatDraftV1(input.scope)
  })
}

/** Explicit author removal; no silent fallback when confirmed evidence becomes stale. */
export async function removeChatSourceUnitBundleV1(scope: WorkspaceScope, revision: number, fragmentKeys: string[]) {
  const selected = [...fragmentKeys].sort()
  return db.transaction('rw', scopeTransactionTables(db.chatAuthoringDrafts), async () => {
    const draft = await readChatDraftV1(scope)
    if (draft.revision !== revision || draft.sourceUnitsJson === undefined) throw new Error('方案已变化，请刷新后再移除')
    const set = parseChatSourceUnitSetV1(JSON.parse(draft.sourceUnitsJson))
    const bundles = set.bundles.filter(bundle => canonicalStringify(bundle.candidate.fragments.map(row => row.fragmentKey).sort()) !== canonicalStringify(selected))
    if (bundles.length !== set.bundles.length - 1) throw new Error('未找到唯一的已确认事实批次')
    const result = await adopt({projectId: scope.projectId, scope, target: 'chatAuthoringDrafts', recordId: draft.id!, mode: 'replace', data: {sourceUnitsJson: canonicalStringify({...set, bundles})}})
    if (result.written.length !== 1 || result.skipped.length || result.unknown.length || result.typeErrors.length) throw new Error('事实整理没有完整移除')
    await db.chatAuthoringDrafts.update(draft.id!, {revision: draft.revision + 1})
    return readChatDraftV1(scope)
  })
}
