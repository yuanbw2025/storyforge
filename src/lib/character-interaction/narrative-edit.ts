import {assertInstanceBinding} from '../product/runtime-instances'
import type {AIConfig, WorkspaceScope} from '../types'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from './harness'
import {readPendingChatNarrativeRunsV1} from './narrative-turn'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, updateChatMessageEditDraft} from './runtime-api'

export interface ChatMessageEditPlanV1 {
  mode?: 'continue'
  sessionId: number
  sourceSessionId: number
  sourceSequence: number
  messageId: string
  role: 'player' | 'character'
  actorKey: string
  text: string
  removedMessageCount: number
  baseSequence: number
  stateHash: string
}

/** Resolve inherited negative sequence numbers through the actual branch
 * ancestry. A deleted ancestor cannot be replaced with an invented past. */
export async function readChatMessageEditPlanV1(scope: WorkspaceScope, sessionId: number, messageId: string): Promise<ChatMessageEditPlanV1> {
  let owner = await assertInstanceBinding(sessionId, scope)
  const initialOwner = owner, version = await readProductRuntimeStateVersion(sessionId)
  const current = (await readProductRuntimeState(sessionId)).interaction
  if (owner.kind !== 'character-interaction' || !current?.chatNarrative) throw new Error('历史改写需要主动叙事角色聊天存档。')
  const target = current.messages.find(m => m.messageId === messageId && m.supersededBySequence == null && (m.role === 'player' || m.audienceKeys == null || m.audienceKeys.includes(current.playerKey)))
  if (!target || !['player', 'character'].includes(target.role)) throw new Error('要改写的可见消息不存在。')
  let sequence = target.eventSequence
  const visited = new Set<number>()
  while (sequence < 0) {
    if (owner.parentSessionId == null || owner.parentThroughSequence == null || visited.has(owner.id!)) throw new Error('原始时间线已删除或来源不完整，无法重建这条历史消息之前的局面。')
    visited.add(owner.id!)
    sequence += owner.parentThroughSequence + 1
    owner = await assertInstanceBinding(owner.parentSessionId, scope)
    if (owner.kind !== 'character-interaction' || owner.runtimeSourceHash !== initialOwner.runtimeSourceHash) throw new Error('历史消息的冻结版本不一致。')
  }
  const atSource = (await readProductRuntimeState(owner.id!, sequence)).interaction
  const source = atSource?.messages.find(m => m.messageId === messageId && m.eventSequence === sequence)
  if (sequence <= 0 || !source || source.text !== target.text || source.role !== target.role || source.speakerKey !== target.speakerKey) throw new Error('历史消息与原始事件不一致。')
  return {sessionId, sourceSessionId: owner.id!, sourceSequence: sequence, messageId, role: target.role as 'player' | 'character', actorKey: target.speakerKey,
    text: target.text, removedMessageCount: current.messages.filter(m => m.supersededBySequence == null && m.eventSequence >= target.eventSequence && (m.role === 'player' || m.audienceKeys == null || m.audienceKeys.includes(current.playerKey))).length,
    baseSequence: version.sequence, stateHash: version.stateHash}
}

/** Current-reply continuation is an explicit historical branch, never a
 * silent append of already-applied consequences in the original session. */
export async function readChatMessageContinuationPlanV1(scope: WorkspaceScope, sessionId: number, messageId: string): Promise<ChatMessageEditPlanV1> {
  const plan = await readChatMessageEditPlanV1(scope, sessionId, messageId)
  if (plan.role !== 'character' || plan.removedMessageCount !== 1) throw new Error('只能续写当前最后一条角色回复；更早消息请使用历史改写分支。')
  const state = (await readProductRuntimeState(sessionId)).interaction!
  if (plan.text.length >= state.chatNarrative!.permissions.maxActionCharacters) throw new Error('这条回复已达到作品长度上限，请推进下一次角色行动。')
  return {...plan, mode: 'continue'}
}

export async function forkChatMessageEditV1(input: {scope: WorkspaceScope; plan: ChatMessageEditPlanV1; text: string; title?: string}) {
  const current = await (input.plan.mode === 'continue' ? readChatMessageContinuationPlanV1 : readChatMessageEditPlanV1)(input.scope, input.plan.sessionId, input.plan.messageId)
  if (current.mode === 'continue' && input.text !== current.text) throw new Error('续写必须保留完整原文，不能改写续写起点。')
  if (current.baseSequence !== input.plan.baseSequence || current.stateHash !== input.plan.stateHash
    || current.sourceSessionId !== input.plan.sourceSessionId || current.sourceSequence !== input.plan.sourceSequence) throw new Error('当前时间线已变化，请重新查看改写影响。')
  return branchProductRuntimeSession({parentSessionId: current.sourceSessionId, throughSequence: current.sourceSequence - 1,
    title: input.title?.trim() || (current.mode === 'continue' ? '回复续写分支' : '历史改写分支'), intent: {kind: 'character-chat-message-edit', ...(current.mode ? {mode: current.mode} : {}), sourceMessageId: current.messageId, text: input.text}})
}

/** Every retry is a fresh, explicit edit request. Unfinished/unknown runs must
 * first be recovered or cancelled through the existing visible recovery path. */
export async function applyChatMessageEditV1(input: {scope: WorkspaceScope; sessionId: number; expectedSequence: number; text: string; aiConfig?: AIConfig; signal?: AbortSignal; onRunCreated?: (id: number) => void}) {
  await assertInstanceBinding(input.sessionId, input.scope)
  const version = await readProductRuntimeStateVersion(input.sessionId), state = (await readProductRuntimeState(input.sessionId)).interaction
  const draft = state?.chatNarrative?.pendingEdit
  if (!draft || version.sequence !== input.expectedSequence) throw new Error('待处理改写已变化，请刷新。')
  if (input.signal?.aborted) throw new Error('改写已取消。')
  if ((await readPendingChatNarrativeRunsV1(input.scope, input.sessionId, state!)).length) throw new Error('请先恢复或取消尚未结束的改写运行。')
  if (draft.role === 'character' && (!input.aiConfig || state!.remainingDirectorBudget < 2)) throw new Error('角色改写需要模型配置及两次调用预算，以重新核对表达和后果。')
  const saved = await updateChatMessageEditDraft({sessionId: input.sessionId, commandId: `chat.edit:${crypto.randomUUID()}`, baseSequence: version.sequence, baseStateHash: version.stateHash, text: input.text})
  if (input.signal?.aborted) return
  if (draft.role === 'player') {
    const fresh = await readProductRuntimeStateVersion(input.sessionId)
    if (fresh.sequence !== saved.sequence) throw new Error('保存改写期间局面已变化，请重新查看草稿。')
    return commitInteractionPlayerMessage({sessionId: input.sessionId, commandId: `chat.edit.player:${saved.sequence}`, baseSequence: fresh.sequence, baseStateHash: fresh.stateHash,
      messageId: `message:edit:${crypto.randomUUID()}`, text: input.text, audienceKeys: draft.audienceKeys})
  }
  const candidate = await generateInteractionRuntimeCandidateV1({scope: input.scope, productRuntimeSessionId: input.sessionId, participantKey: draft.actorKey,
    narrativeEditSequence: saved.sequence,
    skillId: 'character.chat-narrative-action', narrativeTriggerSequence: state!.chatNarrative!.triggers.slice(-1)[0]!.requestedSequence,
    objective: draft.mode === 'continue' ? '将 pendingEdit.text 逐字作为开头，仅向后连贯续写当前这段回复。输出完整合并正文；从当前分支前态核对整段的全部实际后果，不遗漏前文已表达的后果，不重复计入同一事实或关系，不替玩家回应。' : '逐字保留 pendingEdit.text，重新核对这段角色表达的实际后果，不读取原时间线后续结果，不增加台词；不成立或越权的改写必须拒绝。',
    aiConfig: input.aiConfig, signal: input.signal, onRunCreated: input.onRunCreated})
  if (!input.signal?.aborted) await adoptInteractionRuntimeCandidateV1({scope: input.scope, runId: candidate.snapshot.run.id})
}
