import type {AgentRunSnapshotV1} from '../agent/run/event-store'
import {parseContextManifestV1, verifyContextManifestIntegrityV1} from '../agent/run/context-manifest'
import {canonicalStringify, hashCanonicalValue} from '../agent/run/hash'
import {assertChatControlHandoffBindingsV1, parseChatNarrativeOutcomeWireV1, supportsChatControlHandoffV1} from './control-handoff-wire'
import {assertChatControlHandoffContextV1, parseChatControlHandoffReviewV1, type ChatControlHandoffV1, type ChatControlHandoffReviewV1} from './control-handoff-contract'
import {readLatestVerifiedAgentRunCheckpointV1} from '../agent/run/checkpoint'
import {sha256Text} from '../ai/chapter-memory/text-normalization'
import {readAgentRunArtifactExactV1} from '../memory/artifact-store'
import type {ChatMessage, WorkspaceScope, ExactRunArtifactKindV1} from '../types'
import type {AgentRunEventTypeV1, AnyAgentRunEventV1} from '../types/agent-run'
import {chatActionChoiceVersionForContractV1} from './action-choice-budget'
import {readChatActionChoiceInputBudgetV1} from './action-choice-input-budget'
import {readChatActionOutputBudgetV1} from './action-choice-output-budget'
import {appendChatActionChoiceProposalV1, buildChatActionChoiceMessagesV1, parseChatActionChoiceV1,
  CHAT_ACTION_CHOICE_STEP_V1, CHAT_ACTION_CHOICE_INPUT_TOKENS_V1, CHAT_ACTION_CHOICE_OUTPUT_TOKENS_V1} from './action-choice-contract'
import {formatInteractionRuntimeContextV1} from './context-format'
import {chatActionContextVersionsV1} from './context-selection'
import {assertChatChoiceExpressionV1} from './action-choice-continuation'
import {buildInteractionContextWindow, interactionRetrievalView} from './runtime'
import {readChatRuntimeStateAtSequenceV1} from './runtime-replay'
import {compileChatActionWireV1, resolveChatActionWireAudienceV1} from './action-wire'
import {bindChatOwnEvidenceV1} from './action-evidence-binding'
import {parseChatNarrativeActionV1} from './narrative-actions'
import type {ChatNarrativeActionV1, ChatNarrativeActionReviewV1} from '../types/chat-narrative'

const expressionStep = 'interaction:runtime-candidate'
function fail(reason: string): never {throw new Error(`[chat-action-choice-evidence] ${reason}`)}
function oneEvent<T extends AgentRunEventTypeV1>(snapshot: AgentRunSnapshotV1, stepId: string, type: T) {
  const events = snapshot.events.filter((event): event is Extract<AnyAgentRunEventV1, {type: T}> => event.type === type
    && 'stepId' in event.payload && event.payload.stepId === stepId)
  if (events.length !== 1 || !('attempt' in events[0].payload) || events[0].payload.attempt !== 1) fail(`${stepId} 缺少唯一的 ${type} 证据`)
  return events[0]
}
async function artifact(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, stepId: string, kind: ExactRunArtifactKindV1) {
  const events = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded' && event.payload.stepId === stepId && event.payload.artifactKind === kind)
  if (events.length !== 1 || events[0].type !== 'evidence.artifact.recorded' || events[0].payload.attempt !== 1) fail(`${stepId} 缺少唯一的 ${kind} 工件`)
  const event = events[0]
  return {event, content: await readAgentRunArtifactExactV1({projectId: scope.projectId, artifactKind: kind, contentHash: event.payload.contentHash})}
}
async function contextPacket(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, stepId: string, participantKey: string) {
  const saved = await artifact(scope, snapshot, stepId, 'context-packet'), packet = JSON.parse(saved.content)
  const manifest = parseContextManifestV1(packet.manifest), assembled = oneEvent(snapshot, stepId, 'context.assembled')
  if (packet.version !== 1 || packet.participantKey !== participantKey || typeof packet.text !== 'string'
    || !await verifyContextManifestIntegrityV1(manifest) || manifest.stepId !== stepId || manifest.attempt !== 1
    || manifest.runId !== snapshot.run.id || manifest.scope.projectId !== scope.projectId
    || manifest.scope.worldGroupId !== (snapshot.run.worldGroupId ?? null) || manifest.manifestHash !== assembled.payload.manifestHash
    || assembled.sequence >= saved.event.sequence || manifest.inputBudget !== CHAT_ACTION_CHOICE_INPUT_TOKENS_V1
    || manifest.totalInputTokens > CHAT_ACTION_CHOICE_INPUT_TOKENS_V1 || manifest.sources.length !== 1
    || manifest.sources[0].key !== 'interactionRuntime' || manifest.sources[0].status !== 'included'
    || manifest.sources[0].readerVersion !== chatActionContextVersionsV1(snapshot.contract.executionBindings?.find(binding => binding.stepId === expressionStep)?.promptVersion).readerVersion
    || manifest.sources[0].contentHash !== await sha256Text(packet.text)) fail('选择或表达来源证据不一致')
  return {...saved, packet, manifest}
}

/** Read-only proof of the actual selection, independent of the current Skill
 * default and current runtime head. It never creates a checkpoint or request. */
export async function readChatActionChoiceEvidenceV1(input: {scope: WorkspaceScope; snapshot: AgentRunSnapshotV1; participantKey: string}) {
  const {scope, snapshot, participantKey} = input, boundary = snapshot.contract.scope.runtime
  if (chatActionChoiceVersionForContractV1(snapshot.contract) !== 1 || !boundary
    || snapshot.run.productRuntimeSessionId !== boundary.productRuntimeSessionId) fail('缺少原选择运行合同')
  const binding = snapshot.contract.executionBindings!.find(item => item.stepId === CHAT_ACTION_CHOICE_STEP_V1)!
  if (binding.version !== 2 || binding.maxOutputTokens !== CHAT_ACTION_CHOICE_OUTPUT_TOKENS_V1
    || binding.contextSourceKeys.join(',') !== 'interactionRuntime' || binding.writeTargets.length) fail('选择权限或冻结额度不一致')
  const original = await readChatRuntimeStateAtSequenceV1(boundary.productRuntimeSessionId, boundary.baseSequence)
  const state = original.interaction, profile = state?.profiles.find(item => item.participantKey === participantKey)
  if (!state || !profile || await sha256Text(JSON.stringify(original)) !== boundary.stateHash
    || await hashCanonicalValue(interactionRetrievalView(state, participantKey)) !== boundary.visibilityHash) fail('选择缺少原角色状态')
  const roleContext = buildInteractionContextWindow(state, participantKey, {retrievalVersion: chatActionContextVersionsV1(binding.promptVersion).retrievalVersion})
  const selected = await contextPacket(scope, snapshot, CHAT_ACTION_CHOICE_STEP_V1, participantKey)
  const expression = await contextPacket(scope, snapshot, expressionStep, participantKey)
  const actorMessages: ChatMessage[] = selected.packet.actorMessages
  if (selected.packet.text !== formatInteractionRuntimeContextV1(profile, roleContext)
    || selected.packet.text !== expression.packet.text
    || await hashCanonicalValue(selected.manifest.sources) !== await hashCanonicalValue(expression.manifest.sources)
    || !Array.isArray(actorMessages) || actorMessages[1]?.content !== `【目标】${snapshot.contract.objective}\n\n${selected.packet.text}`) fail('选择未复用原角色输入')
  const requested = oneEvent(snapshot, CHAT_ACTION_CHOICE_STEP_V1, 'model.requested')
  const responded = oneEvent(snapshot, CHAT_ACTION_CHOICE_STEP_V1, 'model.responded')
  const completed = oneEvent(snapshot, CHAT_ACTION_CHOICE_STEP_V1, 'step.succeeded')
  const request = await artifact(scope, snapshot, CHAT_ACTION_CHOICE_STEP_V1, 'rendered-request'), delivered = JSON.parse(request.content)
  const raw = await artifact(scope, snapshot, CHAT_ACTION_CHOICE_STEP_V1, 'raw-response')
  const messages = buildChatActionChoiceMessagesV1(actorMessages, binding.promptVersion)
  if (delivered.version !== 1 || await hashCanonicalValue(delivered.messages) !== await hashCanonicalValue(messages)
    || requested.payload.bindingHash !== await hashCanonicalValue({runtimeBindingHash: snapshot.contract.runtimeBindingHash,
      manifestHash: selected.manifest.manifestHash, messages, ...(delivered.requestOptions ? {requestOptions: delivered.requestOptions} : {})})
    || responded.payload.outputHash !== await hashCanonicalValue(raw.content)
    || !(selected.event.sequence < request.event.sequence && request.event.sequence < requested.sequence && requested.sequence < responded.sequence
      && responded.sequence < raw.event.sequence && raw.event.sequence < completed.sequence)
    || snapshot.projection.steps[CHAT_ACTION_CHOICE_STEP_V1]?.status !== 'succeeded') fail('选择请求、响应或完成步骤不一致')
  const choice = parseChatActionChoiceV1(JSON.parse(raw.content), roleContext, binding.promptVersion)
  const choiceHash = await hashCanonicalValue({version: 1, choice, contextPacketHash: selected.event.payload.contentHash})
  if (completed.payload.outputHash !== choiceHash) fail('选择草稿与完成步骤不一致')
  return {choice, choiceHash, actorMessages, roleContext, original, expressionManifest: expression.manifest,
    expressionContextSequence: expression.event.sequence, choiceCompletedSequence: completed.sequence,
    messages: appendChatActionChoiceProposalV1(actorMessages, choice, roleContext, binding.promptVersion)}
}

/** The expression must have received the exact unconfirmed proposal. Its raw
 * response is returned for the ordinary action parser, never repaired here. */
export async function readChatActionChoiceExpressionV1(input: {scope: WorkspaceScope; snapshot: AgentRunSnapshotV1;
  proof: Awaited<ReturnType<typeof readChatActionChoiceEvidenceV1>>}) {
  const {scope, snapshot, proof} = input
  const requested = oneEvent(snapshot, expressionStep, 'model.requested'), responded = oneEvent(snapshot, expressionStep, 'model.responded')
  const request = await artifact(scope, snapshot, expressionStep, 'rendered-request'), delivered = JSON.parse(request.content)
  const messages = Array.isArray(delivered) ? delivered : delivered?.version === 1 ? delivered.messages : undefined
  const requestOptions = Array.isArray(delivered) ? undefined : delivered?.requestOptions
  const raw = await artifact(scope, snapshot, expressionStep, 'raw-response')
  if (await hashCanonicalValue(messages) !== await hashCanonicalValue(proof.messages)
    || requested.payload.bindingHash !== await hashCanonicalValue({runtimeBindingHash: snapshot.contract.runtimeBindingHash,
      manifestHash: proof.expressionManifest.manifestHash, messages, ...(requestOptions ? {requestOptions} : {})})
    || responded.payload.outputHash !== await hashCanonicalValue(raw.content)
    || !(proof.choiceCompletedSequence < request.event.sequence && proof.expressionContextSequence < request.event.sequence
      && request.event.sequence < requested.sequence && requested.sequence < responded.sequence && responded.sequence < raw.event.sequence)) fail('表达没有绑定原选择草稿及实际响应')
  assertChatChoiceExpressionV1(raw.content, proof.choice, snapshot.contract.executionBindings?.find(binding => binding.stepId === expressionStep)?.promptVersion)
  return {output: raw.content, rawSequence: raw.event.sequence}
}

/** Public command preflight. The command transaction subsequently compares the
 * same run sequence before writing, so a declaration of three steps alone is
 * never authority to commit an invented response or review. */
export async function assertChatActionChoiceCommitEvidenceV1(input: {
  scope: WorkspaceScope; runId: number; lastSequence: number; sessionId: number; baseSequence: number; baseStateHash: string
  actorKey: string; triggerSequence: number; commandId: string
} & ({outcome?: 'action'; messageId: string; action: ChatNarrativeActionV1; review: ChatNarrativeActionReviewV1}
  | {outcome: 'handoff'; handoff: ChatControlHandoffV1; review: ChatControlHandoffReviewV1})) {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId, {owner: 'instance'})
  if (!saved) fail('选择行动缺少已审查候选')
  const {snapshot} = saved, candidate = saved.resumePayload as Record<string, unknown>, boundary = snapshot.contract.scope.runtime
  const control = input.outcome === 'handoff'
  if (control) assertChatControlHandoffBindingsV1(snapshot.contract, input.handoff)
  if (!candidate || candidate.kind !== (control ? 'chat-control-handoff-candidate' : 'chat-narrative-action-candidate') || candidate.version !== 1 || candidate.portable !== false
    || snapshot.projection.state !== 'running' || snapshot.projection.lastSequence !== input.lastSequence
    || snapshot.run.productRuntimeSessionId !== input.sessionId || candidate.runId !== input.runId
    || candidate.productRuntimeSessionId !== input.sessionId || candidate.participantKey !== input.actorKey
    || candidate.baseSequence !== input.baseSequence || candidate.stateHash !== input.baseStateHash
    || candidate.triggerSequence !== input.triggerSequence || candidate.commandId !== input.commandId
    || !control && input.messageId !== `message:harness:${input.runId}` || !boundary
    || boundary.baseSequence !== input.baseSequence || boundary.stateHash !== input.baseStateHash
    || candidate.visibilityHash !== boundary.visibilityHash || candidate.releaseHash !== boundary.releaseHash
    || await hashCanonicalValue(control ? candidate.handoff : candidate.action) !== await hashCanonicalValue(control ? input.handoff : input.action)
    || await hashCanonicalValue(candidate.review) !== await hashCanonicalValue(input.review)) fail('采用命令与原已审查候选不一致')
  const budget = await readChatActionChoiceInputBudgetV1(input.scope, snapshot)
  if (budget?.calls.length !== 3) fail('采用前缺少完整的三个步骤输入预算证据')
  const {candidateHash, ...body} = candidate
  const persisted = snapshot.events.filter(event => event.type === 'candidate.persisted' && event.payload.stepId === expressionStep).slice(-1)[0]
  if (candidateHash !== await hashCanonicalValue(body) || persisted?.type !== 'candidate.persisted'
    || persisted.payload.candidateHash !== candidateHash) fail('已审查候选缺少原持久化证据')
  const proof = await readChatActionChoiceEvidenceV1({scope: input.scope, snapshot, participantKey: input.actorKey})
  const expressed = await readChatActionChoiceExpressionV1({scope: input.scope, snapshot, proof})
  const binding = snapshot.contract.executionBindings!.find(item => item.stepId === expressionStep)!
  const raw = JSON.parse(expressed.output.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1'))
  const outcome = supportsChatControlHandoffV1(binding.promptVersion) ? parseChatNarrativeOutcomeWireV1(raw, binding.promptVersion) : null
  let actual: ChatNarrativeActionV1 | ChatControlHandoffV1
  if (control) {
    if (outcome?.outcome !== 'handoff') fail('交还控制候选不是原模型结果')
    actual = outcome.handoff
    assertChatControlHandoffContextV1(actual, proof.roleContext)
    const rawReview = await artifact(input.scope, snapshot, 'interaction:action-review', 'raw-response')
    const reviewRow = JSON.parse(rawReview.content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1'))
    if (!reviewRow || Object.keys(reviewRow).join(',') !== 'checks') fail('交还控制原始审查字段无效')
    const review = parseChatControlHandoffReviewV1({...reviewRow, reviewedHandoffJson: canonicalStringify(actual)}, actual)
    if (await hashCanonicalValue(review) !== await hashCanonicalValue(input.review)) fail('交还控制不是原独立审查结果')
  } else {
    if (outcome?.outcome === 'handoff') fail('交还控制不能作为角色行动提交')
    actual = parseChatNarrativeActionV1(bindChatOwnEvidenceV1(compileChatActionWireV1(outcome?.outcome === 'action' ? outcome.action : raw, binding.promptVersion,
      resolveChatActionWireAudienceV1(proof.original.interaction!, input.actorKey)), binding.promptVersion))
  }
  const reviewed = oneEvent(snapshot, 'interaction:action-review', 'step.succeeded')
  if (candidate.contextManifestHash !== proof.expressionManifest.manifestHash || candidate.sceneId !== proof.original.interaction?.activeScene?.sceneId
    || input.triggerSequence !== proof.original.interaction?.chatNarrative?.triggers.slice(-1)[0]?.requestedSequence
    || await hashCanonicalValue(actual) !== await hashCanonicalValue(control ? input.handoff : input.action)
    || reviewed.payload.outputHash !== await hashCanonicalValue(input.review)
    || !(expressed.rawSequence < reviewed.sequence && reviewed.sequence < persisted.sequence)) fail('采用候选不是原选择、表达和审查的结果')
  const outputBudget = await readChatActionOutputBudgetV1(input.scope, snapshot)
  if (outputBudget && outputBudget.calls.length !== 3) fail('采用前缺少完整的三个步骤输出预算证据')
}
