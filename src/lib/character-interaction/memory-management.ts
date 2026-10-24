import {assertInstanceBinding} from '../product/runtime-instances'
import type {CharacterInteractionRuntimeState, InteractionRuntimeMemory, WorkspaceScope} from '../types'
import {hasChatMemoryContentReviewV1} from './memory-review-contract'
import {interactionMessageVisibleTo} from './message-visibility'
import {changeChatMemoryUse, correctChatMemory, readProductRuntimeState, readProductRuntimeStateVersion, resolveInteractionMemory} from './runtime-api'

export const CHAT_MEMORY_KIND_LABELS = {'scene-summary': '场景摘要', 'key-memory': '共同经历', commitment: '承诺', secret: '秘密', conflict: '冲突', gift: '礼物'} as const
export const CHAT_MEMORY_STATUS_LABELS = {proposed: '待确认', accepted: '使用中', disabled: '已停用', revoked: '已撤回', rejected: '已拒绝', superseded: '已被修正'} as const

function sharedMessage(state: CharacterInteractionRuntimeState, participantKey: string, sequence: number) {
  return state.messages.find(m => m.eventSequence === sequence && interactionMessageVisibleTo(m, state.playerKey) && interactionMessageVisibleTo(m, participantKey))
}
function sourceView(state: CharacterInteractionRuntimeState, message: CharacterInteractionRuntimeState['messages'][number]) {
  return {messageId: message.messageId, sequence: message.eventSequence, text: message.text,
    speaker: message.speakerKey === state.playerKey ? '你' : state.profiles.find(p => p.participantKey === message.speakerKey)?.name ?? '场景消息',
    replaced: message.supersededBySequence != null}
}

/** Player projection, including history. Neither hidden candidate bodies nor
 * semantic-review reasons/proof snapshots can reach a form through this view. */
export function chatMemoryPlayerViewV1(state: CharacterInteractionRuntimeState, memory: InteractionRuntimeMemory) {
  const sources = memory.sourceEventSequences.map(sequence => sharedMessage(state, memory.participantKey, sequence))
  if (!sources.length || sources.some(s => !s)) return null
  const reviewed = hasChatMemoryContentReviewV1(state, memory)
  return {memoryId: memory.memoryId, participantKey: memory.participantKey,
    participantName: state.profiles.find(p => p.participantKey === memory.participantKey)?.name ?? '角色',
    kind: memory.kind, status: memory.status,
    content: memory.authorship === 'player-correction' || reviewed ? memory.content : null,
    authoredByPlayer: memory.authorship === 'player-correction', reviewed,
    playerPinned: memory.playerPinned === true,
    sources: sources.map(s => sourceView(state, s!)),
    excerpt: sources.some(s => s!.text.includes(memory.evidenceExcerpt)) ? memory.evidenceExcerpt : '',
    replacedBy: memory.supersededByMemoryId,
  }
}
export type ChatMemoryPlayerViewV1 = NonNullable<ReturnType<typeof chatMemoryPlayerViewV1>>
export interface ChatMemoryManagementPlanV1 {
  sessionId: number
  baseSequence: number
  stateHash: string
  memory: ChatMemoryPlayerViewV1
  availableSources: ChatMemoryPlayerViewV1['sources']
}
export type ChatMemoryManagementActionV1 = {kind: 'accept' | 'reject' | 'disable' | 'enable' | 'revoke' | 'pin' | 'unpin'}
  | {kind: 'correct'; content: string; sourceEventSequences: number[]; evidenceExcerpt: string; reason: string}

export async function readChatMemoryManagementPlanV1(scope: WorkspaceScope, sessionId: number, memoryId: string): Promise<ChatMemoryManagementPlanV1> {
  const owner = await assertInstanceBinding(sessionId, scope)
  if (owner.kind !== 'character-interaction') throw new Error('记忆管理只属于当前作品的角色聊天存档。')
  const version = await readProductRuntimeStateVersion(sessionId), runtime = await readProductRuntimeState(sessionId)
  if (runtime.lastSequence !== version.sequence) throw new Error('聊天已变化，请重新查看记忆。')
  const state = runtime.interaction, memory = state?.memories.find(m => m.memoryId === memoryId)
  const view = state && memory && chatMemoryPlayerViewV1(state, memory)
  if (!view) throw new Error('这条记忆或其共同可见来源不可用。')
  return {sessionId, baseSequence: version.sequence, stateHash: version.stateHash, memory: view,
    availableSources: state!.messages.filter(m => m.supersededBySequence == null
      && interactionMessageVisibleTo(m, state!.playerKey) && interactionMessageVisibleTo(m, view.participantKey)).map(m => sourceView(state!, m))}
}

/** Re-read ownership, visibility and the exact runtime head before applying an
 * explicit player decision. The underlying command repeats CAS atomically. */
export async function applyChatMemoryManagementPlanV1(scope: WorkspaceScope, plan: ChatMemoryManagementPlanV1, action: ChatMemoryManagementActionV1) {
  const current = await readChatMemoryManagementPlanV1(scope, plan.sessionId, plan.memory.memoryId)
  if (current.baseSequence !== plan.baseSequence || current.stateHash !== plan.stateHash) throw new Error('聊天或记忆已变化，修正尚未保存。请重新核对来源后提交。')
  const envelope = {sessionId: current.sessionId, commandId: `chat.memory:${crypto.randomUUID()}`, baseSequence: current.baseSequence, baseStateHash: current.stateHash}
  if (action.kind === 'correct') {
    if (action.sourceEventSequences.some(s => !current.availableSources.some(m => m.sequence === s))) throw new Error('修正只能引用角色与你共同可见且未被替换的消息。')
    return correctChatMemory({...envelope, memoryId: current.memory.memoryId, replacementMemoryId: `memory:player:${crypto.randomUUID()}`,
      content: action.content, sourceEventSequences: action.sourceEventSequences, evidenceExcerpt: action.evidenceExcerpt, reason: action.reason})
  }
  if (action.kind === 'accept' || action.kind === 'reject') {
    if (action.kind === 'accept' && !current.memory.reviewed) throw new Error('这条记忆尚未完成正文检查；请依据原消息修正并采用，或拒绝提议。')
    return resolveInteractionMemory({...envelope, memoryId: current.memory.memoryId, resolution: action.kind === 'accept' ? 'accepted' : 'rejected'})
  }
  return changeChatMemoryUse({...envelope, memoryId: current.memory.memoryId, action: action.kind,
    reason: {disable: '玩家明确停用这条记忆', enable: '玩家明确恢复使用这条记忆', revoke: '玩家明确撤回这条记忆并保留历史',
      pin: '玩家明确固定这条记忆的后续检索', unpin: '玩家明确取消固定并恢复按相关性检索'}[action.kind]})
}
