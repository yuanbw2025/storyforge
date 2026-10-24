import {db} from '../db/schema'
import {resolveScope} from '../workspace/scope'
import type {WorkspaceScope} from '../types'
import {parseChatComposerDraftV1} from './composer-draft-contract'
import {parseProductRuntimeState} from '../product/runtime-core'

/** UI draft access checks ownership; it grants neither a model read nor a runtime action. */
export async function readChatComposerSessionV1(scope: WorkspaceScope, sessionId: number) {
  const resolved = await resolveScope({scope: {...scope}}), session = await db.productRuntimeSessions.get(sessionId)
  if (!session || session.kind !== 'character-interaction' || session.projectId !== resolved.projectId
    || session.worldId !== resolved.worldId || session.workId !== resolved.workId
    || (session.productReleaseId == null) === (session.productBuildId == null)) throw new Error('这份聊天草稿不属于当前作品的存档。')
  return session
}
export async function readChatComposerDraftV1(scope: WorkspaceScope, sessionId: number) {
  const session = await readChatComposerSessionV1(scope, sessionId)
  return session.chatComposerDraft === undefined ? null : parseChatComposerDraftV1(session.chatComposerDraft,
    parseProductRuntimeState(session.initialStateJson).interaction?.profiles.map(p => p.participantKey) ?? [])
}
