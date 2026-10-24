import {db} from '../db/schema'
import {adopt} from '../registry/adopt'
import {canonicalStringify} from '../agent/run/hash'
import {readOwnedRows, scopeTransactionTables} from '../workspace/scope'
import type {WorkspaceScope} from '../types'
import {readChatDraftV1, loadChatSourceProjectionV1} from './draft-service'
import {parseChatAuthoringSettings, type ChatAuthoringDraftV1} from './authoring-contract'
import {readChatSourceReviewContextV1, type ChatSourceReviewRequestV1} from './source-review-context'
import {parseChatRoleProfileSetV1, prepareChatRoleProfileV1, validateChatRoleProfilesForSourceV1, type ChatRoleProfileSetV1} from './role-profile'

export async function readChatRoleProfilesV1(scope: WorkspaceScope): Promise<ChatRoleProfileSetV1 | undefined> {
  const draft = (await readOwnedRows<ChatAuthoringDraftV1>(scope, 'chatAuthoringDrafts', {owner: 'work'}))[0]
  return draft?.roleProfilesJson === undefined ? undefined : parseChatRoleProfileSetV1(JSON.parse(draft.roleProfilesJson))
}

/** Inert evidence preparation shared by manual confirmation and the writable AI run. */
export async function prepareChatRoleProfileWriteV1(scopeInput: WorkspaceScope, requestInput: ChatSourceReviewRequestV1, candidateInput: unknown) {
  const scope = structuredClone(scopeInput), request = structuredClone(requestInput), candidate = structuredClone(candidateInput)
  const context = await readChatSourceReviewContextV1(scope, request)
  const draft = await readChatDraftV1(scope)
  const settings = parseChatAuthoringSettings(JSON.parse(draft.settingsJson))
  if (draft.revision !== request.draftRevision || settings.version === 1 || !settings.sourceReview) throw new Error('方案或资料确认已变化，请重新整理')
  const profile = prepareChatRoleProfileV1({candidate, context, sourceReview: settings.sourceReview})
  const before = draft.roleProfilesJson === undefined ? [] : parseChatRoleProfileSetV1(JSON.parse(draft.roleProfilesJson)).profiles
  const profiles = [...before.filter(row => row.actorKey !== profile.actorKey), profile].sort((a, b) => a.actorKey.localeCompare(b.actorKey))
  const set: ChatRoleProfileSetV1 = {schema: 'storyforge.chat-role-profiles', version: 1, profiles}
  // Re-read original evidence at the same revision before the atomic author write.
  validateChatRoleProfilesForSourceV1({ ...set, profiles: [profile]}, await loadChatSourceProjectionV1(scope, draft.revision), settings.sourceReview)
  return {scope, expected: draft, set}
}

/** Both manual and durable AI confirmation share the same source preparation and atomic write. */
export async function confirmChatRoleProfileV1(scope: WorkspaceScope, request: ChatSourceReviewRequestV1, candidate: unknown) {
  return commitChatRoleProfileWriteV1(await prepareChatRoleProfileWriteV1(scope, request, candidate))
}
export async function commitChatRoleProfileWriteV1(input: Awaited<ReturnType<typeof prepareChatRoleProfileWriteV1>>) {
  return write(input.scope, input.expected, input.set)
}

/** Removing one obsolete interpretation does not discard other authored profiles. */
export async function removeChatRoleProfileV1(scopeInput: WorkspaceScope, revision: number, actorKey: string) {
  const scope = structuredClone(scopeInput), draft = await readChatDraftV1(scope)
  if (draft.revision !== revision) throw new Error('方案已变化，请刷新后再移除人物整理')
  const current = draft.roleProfilesJson === undefined ? undefined : parseChatRoleProfileSetV1(JSON.parse(draft.roleProfilesJson))
  if (!current?.profiles.some(row => row.actorKey === actorKey)) throw new Error('未找到该人物的已保存整理')
  return write(scope, draft, {...current, profiles: current.profiles.filter(row => row.actorKey !== actorKey)})
}

async function write(scope: WorkspaceScope, expected: ChatAuthoringDraftV1, set: ChatRoleProfileSetV1) {
  return db.transaction('rw', scopeTransactionTables(db.chatAuthoringDrafts), async () => {
    const current = await readChatDraftV1(scope)
    if (current.revision !== expected.revision || current.roleProfilesJson !== expected.roleProfilesJson
      || current.settingsJson !== expected.settingsJson || current.worldReleaseId !== expected.worldReleaseId) throw new Error('方案已变化，本次人物整理没有写入')
    const result = await adopt({projectId: scope.projectId, scope, target: 'chatAuthoringDrafts', recordId: current.id!, mode: 'replace', data: {roleProfilesJson: canonicalStringify(set)}})
    if (result.written.length !== 1 || result.skipped.length || result.unknown.length || result.typeErrors.length) throw new Error('人物整理采纳未完整完成')
    // Revision is system lifecycle state, never a model-writable field.
    await db.chatAuthoringDrafts.update(current.id!, {revision: current.revision + 1})
    return readChatDraftV1(scope)
  })
}
