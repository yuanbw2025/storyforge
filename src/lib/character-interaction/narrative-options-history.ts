import {db} from '../db/schema'
import {readLatestVerifiedAgentRunCheckpointV1} from '../agent/run/checkpoint'
import {readInstanceAgentRunV1} from '../agent/run/event-store'
import {canonicalStringify, hashCanonicalValue} from '../agent/run/hash'
import {assertInstanceBinding} from '../product/runtime-instances'
import type {ProductRuntimeSession, ProductRuntimeState, WorkspaceScope} from '../types'
import type {ChatHistoricalOptionBranchIntentV1} from '../types/chat-narrative'
import type {ChatNarrativeActionCandidateV1, ChatNarrativeOptionsCandidateV1} from './harness'
import {previewChatNarrativeActionV1} from './narrative-actions'
import {readChatMessageEditPlanV1, type ChatMessageEditPlanV1} from './narrative-edit'
import {prepareChatMessageEditBranchV1, validateChatMessageEditDraftV1} from './narrative-edit-contract'
import {assertChatNarrativeOptionsPreviewableV1, CHAT_NARRATIVE_OPTION_KEYS_V1, selectedChatNarrativeOptionV1, type ChatNarrativeOptionKeyV1} from './narrative-options'
import {isImportedCompletedInteractionRunV1} from './runtime-run-recovery'
import {branchProductRuntimeSession, readProductRuntimeState} from './runtime-api'

export interface ChatHistoricalOptionsPlanV1 {
  edit: ChatMessageEditPlanV1
  runId: number
  candidateHash: string
  selectedOptionKey: ChatNarrativeOptionKeyV1
  options: Array<{key: ChatNarrativeOptionKeyV1; text: string; audienceKeys: string[]}>
}

function fail(message = '这条回复没有可核验的其他候选。'): never {throw new Error(message)}
const optionRun = (contractJson: string) => JSON.parse(contractJson).executionBindings?.some((binding: {skillId?: string}) => binding.skillId === 'character.chat-narrative-options')
const actionRun = (contractJson: string) => JSON.parse(contractJson).executionBindings?.some((binding: {skillId?: string}) => binding.skillId === 'character.chat-narrative-action')
interface HistoricalChoice {
  candidate: ChatNarrativeOptionsCandidateV1
  runId: number
  selectedOptionKey: ChatNarrativeOptionKeyV1
  before: ProductRuntimeState
}

/** Match the immutable candidate, recorded choice and actual committed message.
 * Imported IDs remain historical inside the hashed payload; only a verified
 * completed import prefix plus the same local command permits reading it. */
async function readHistoricalChoice(scope: WorkspaceScope, sourceSessionId: number, sourceSequence: number, messageId: string, visited = new Set<string>()): Promise<HistoricalChoice> {
  const identity = `${sourceSessionId}:${sourceSequence}`
  if (visited.has(identity)) fail('历史候选来源形成循环。')
  visited.add(identity)
  const owner = await assertInstanceBinding(sourceSessionId, scope)
  if (owner.kind !== 'character-interaction') fail()
  const [events, rows, before] = await Promise.all([
    db.productRuntimeEvents.where('sessionId').equals(sourceSessionId).toArray(),
    db.agentRuns.where('productRuntimeSessionId').equals(sourceSessionId).toArray(),
    readProductRuntimeState(sourceSessionId, sourceSequence - 1),
  ])
  const event = events.find(row => row.sequence === sourceSequence && row.type === 'interaction.narrative.action-reviewed.committed')
  if (!event || !before.interaction?.chatNarrative) fail()
  const payload = JSON.parse(event.payloadJson)
  if (payload.messageId !== messageId) fail('原始消息与候选来源不一致。')
  for (const row of rows.filter(row => (optionRun(row.contractJson) || actionRun(row.contractJson)) && JSON.parse(row.contractJson).scope?.runtime?.baseSequence === sourceSequence - 1)) {
    const saved = await readLatestVerifiedAgentRunCheckpointV1(scope, row.id!, {owner: 'instance'})
    if (!saved?.resumePayload || typeof saved.resumePayload !== 'object') fail()
    const candidate = saved.resumePayload as ChatNarrativeOptionsCandidateV1 | ChatNarrativeActionCandidateV1, snapshot = saved.snapshot
    if (!['chat-narrative-options-candidate', 'chat-narrative-action-candidate'].includes(candidate.kind) || candidate.version !== 1 || candidate.portable !== false) fail()
    const {candidateHash, ...body} = candidate
    if (await hashCanonicalValue(body) !== candidateHash) fail('历史候选内容已损坏。')
    const imported = isImportedCompletedInteractionRunV1(snapshot, events)
    if (!imported && (snapshot.projection.state !== 'completed' || candidate.runId !== row.id || candidate.productRuntimeSessionId !== sourceSessionId)) fail('原候选尚未完成或来源不一致，请先恢复原运行。')
    if (candidate.baseSequence !== sourceSequence - 1 || candidate.stateHash !== event.baseStateHash
      || candidate.participantKey !== payload.actorKey || candidate.sceneId !== before.interaction.activeScene?.sceneId
      || candidate.triggerSequence !== payload.triggerSequence || messageId !== `message:harness:${candidate.runId}`) fail('候选与原消息边界不一致。')
    const adopted = snapshot.events.find(row => row.type === 'runtime.candidate.adopted')
    if (adopted?.type !== 'runtime.candidate.adopted' || adopted.payload.candidateHash !== candidateHash
      || adopted.payload.baseSequence !== candidate.baseSequence || adopted.payload.resultingSequence !== sourceSequence) fail('原候选缺少对应的选择及采用记录。')
    if (candidate.kind === 'chat-narrative-action-candidate') {
      const draft = before.interaction.chatNarrative.pendingEdit
      if (draft?.mode !== 'option' || !draft.sourceOption || owner.parentSessionId == null) fail()
      if (event.commandId !== candidate.commandId || adopted.payload.commandIds.length !== 1 || adopted.payload.commandIds[0] !== event.commandId
        || canonicalStringify(candidate.action) !== canonicalStringify(payload.action) || canonicalStringify(candidate.review) !== canonicalStringify(payload.review)) fail('改选后的表达与采用记录不一致。')
      const parent = await assertInstanceBinding(owner.parentSessionId, scope)
      if (parent.runtimeSourceHash !== owner.runtimeSourceHash) fail('历史候选的冻结版本不一致。')
      const origin = await readChatMessageEditPlanV1(scope, parent.id!, draft.sourceMessageId)
      const previous = await readHistoricalChoice(scope, origin.sourceSessionId, origin.sourceSequence, draft.sourceMessageId, visited)
      const choice = selectedChatNarrativeOptionV1(previous.candidate.options, previous.candidate.review, draft.sourceOption.optionKey)
      if (draft.sourceOption.candidateHash !== previous.candidate.candidateHash || candidate.action.text !== choice.action.text
        || canonicalStringify(candidate.action.audienceKeys) !== canonicalStringify(choice.action.audienceKeys)
        || candidate.participantKey !== previous.candidate.participantKey) fail('改选后的回复与原候选来源不一致。')
      return {...previous, selectedOptionKey: draft.sourceOption.optionKey, before}
    }
    const confirmation = snapshot.events.find(row => row.type === 'confirmation.recorded' && row.payload.decision === 'adopt')
    if (confirmation?.type !== 'confirmation.recorded' || confirmation.payload.candidateHash !== candidateHash) fail('原候选缺少对应的选择记录。')
    const selectedOptionKey = confirmation.payload.reviewItemId as ChatNarrativeOptionKeyV1
    const chosen = selectedChatNarrativeOptionV1(candidate.options, candidate.review, selectedOptionKey)
    if (event.commandId !== `${candidate.commandId}:${selectedOptionKey}` || adopted.payload.commandIds.length !== 1 || adopted.payload.commandIds[0] !== event.commandId
      || canonicalStringify(chosen.action) !== canonicalStringify(payload.action) || canonicalStringify(chosen.review) !== canonicalStringify(payload.review)) fail('原候选与实际发生的表达或后果不一致。')
    assertChatNarrativeOptionsPreviewableV1(before.interaction, candidate.options)
    for (const key of CHAT_NARRATIVE_OPTION_KEYS_V1) {
      const option = selectedChatNarrativeOptionV1(candidate.options, candidate.review, key)
      previewChatNarrativeActionV1(before.interaction, {sequence: sourceSequence, triggerSequence: candidate.triggerSequence,
        actorKey: candidate.participantKey, messageId, action: option.action})
    }
    return {candidate, runId: row.id!, selectedOptionKey, before}
  }
  fail()
}

/** Discovery exposes only message IDs; opening a choice performs full payload
 * validation. Broken/deleted history must not prevent reading today's chat. */
export async function readChatHistoricalOptionMessageIdsV1(scope: WorkspaceScope, sessionId: number): Promise<string[]> {
  let owner = await assertInstanceBinding(sessionId, scope)
  const sourceHash = owner.runtimeSourceHash, state = (await readProductRuntimeState(sessionId)).interaction
  if (owner.kind !== 'character-interaction' || !state?.chatNarrative) return []
  const visible = new Set(state.messages.filter(m => m.role === 'character' && m.supersededBySequence == null && (m.audienceKeys == null || m.audienceKeys.includes(state.playerKey))).map(m => m.messageId))
  const result = new Set<string>(), visited = new Set<number>()
  let through = Infinity
  while (!visited.has(owner.id!)) {
    visited.add(owner.id!)
    const derivedChoice = JSON.parse(owner.initialStateJson).interaction?.chatNarrative?.pendingEdit?.mode === 'option'
    const [events, rows] = await Promise.all([db.productRuntimeEvents.where('sessionId').equals(owner.id!).toArray(), db.agentRuns.where('productRuntimeSessionId').equals(owner.id!).toArray()])
    for (const row of rows) {
      try {
        if (!optionRun(row.contractJson) && !(derivedChoice && actionRun(row.contractJson))) continue
        const snapshot = await readInstanceAgentRunV1(scope, row.id!)
        if (snapshot.projection.state !== 'completed' && !isImportedCompletedInteractionRunV1(snapshot, events)) continue
        const adopted = snapshot.events.find(event => event.type === 'runtime.candidate.adopted')
        if (adopted?.type !== 'runtime.candidate.adopted') continue
        for (const event of events.filter(event => event.sequence <= through && event.type === 'interaction.narrative.action-reviewed.committed' && adopted.payload.commandIds.includes(event.commandId ?? ''))) {
          const id = JSON.parse(event.payloadJson).messageId
          if (visible.has(id)) {
            await readHistoricalChoice(scope, owner.id!, event.sequence, id)
            result.add(id)
          }
        }
      } catch { /* Opening unavailable history cannot replace current dialogue. */ }
    }
    if (owner.parentSessionId == null || owner.parentThroughSequence == null) break
    through = owner.parentThroughSequence
    try {
      owner = await assertInstanceBinding(owner.parentSessionId, scope)
      if (owner.kind !== 'character-interaction' || owner.runtimeSourceHash !== sourceHash) break
    } catch {break}
  }
  return [...result]
}

export async function readChatHistoricalOptionsPlanV1(scope: WorkspaceScope, sessionId: number, messageId: string): Promise<ChatHistoricalOptionsPlanV1> {
  const edit = await readChatMessageEditPlanV1(scope, sessionId, messageId)
  if (edit.role !== 'character') fail('只有角色回复可以查看行动候选。')
  const source = await readHistoricalChoice(scope, edit.sourceSessionId, edit.sourceSequence, messageId)
  return {edit, runId: source.runId, candidateHash: source.candidate.candidateHash, selectedOptionKey: source.selectedOptionKey,
    options: CHAT_NARRATIVE_OPTION_KEYS_V1.map(key => {const {action} = selectedChatNarrativeOptionV1(source.candidate.options, source.candidate.review, key); return {key, text: action.text, audienceKeys: [...action.audienceKeys]}})}
}

export async function forkChatHistoricalOptionV1(input: {scope: WorkspaceScope; plan: ChatHistoricalOptionsPlanV1; optionKey: ChatNarrativeOptionKeyV1; title?: string}) {
  const plan = await readChatHistoricalOptionsPlanV1(input.scope, input.plan.edit.sessionId, input.plan.edit.messageId)
  if (canonicalStringify(plan) !== canonicalStringify(input.plan)) fail('当前时间线或候选已经变化，请重新查看影响。')
  if (input.optionKey === plan.selectedOptionKey || !CHAT_NARRATIVE_OPTION_KEYS_V1.includes(input.optionKey)) fail('请选择另一条候选；原选择保持在原时间线。')
  return branchProductRuntimeSession({parentSessionId: plan.edit.sourceSessionId, throughSequence: plan.edit.sourceSequence - 1,
    title: input.title?.trim() || '历史候选改选分支', intent: {kind: 'character-chat-option-switch', sourceMessageId: plan.edit.messageId,
      runId: plan.runId, candidateHash: plan.candidateHash, optionKey: input.optionKey}})
}

/** The product adapter re-verifies the ledger before any child is written;
 * callers cannot smuggle arbitrary text, audiences or initial state into it. */
export async function prepareChatHistoricalOptionBranchV1(parent: ProductRuntimeSession, before: ProductRuntimeState, after: ProductRuntimeState, intent: ChatHistoricalOptionBranchIntentV1) {
  if (Object.keys(intent).sort().join(',') !== 'candidateHash,kind,optionKey,runId,sourceMessageId') fail('历史候选分支请求字段无效。')
  const source = await readHistoricalChoice({projectId: parent.projectId, worldId: parent.worldId, workId: parent.workId}, parent.id!, before.lastSequence + 1, intent.sourceMessageId)
  if (source.runId !== intent.runId || source.candidate.candidateHash !== intent.candidateHash || source.selectedOptionKey === intent.optionKey
    || canonicalStringify(source.before) !== canonicalStringify(before)) fail('历史候选或分支起点已变化。')
  const {action} = selectedChatNarrativeOptionV1(source.candidate.options, source.candidate.review, intent.optionKey)
  prepareChatMessageEditBranchV1(before, after, {kind: 'character-chat-message-edit', sourceMessageId: intent.sourceMessageId, text: action.text})
  const story = before.interaction!.chatNarrative!, draft = story.pendingEdit!
  draft.mode = 'option'; draft.audienceKeys = [...action.audienceKeys]
  draft.sourceOption = {candidateHash: source.candidate.candidateHash, optionKey: intent.optionKey}
  validateChatMessageEditDraftV1(draft, before.interaction!, story.permissions.maxActionCharacters)
}
