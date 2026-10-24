import {chat, type ChatResult} from '../ai/client'
import {recordChatActionOutputBudgetV1, readChatActionOutputBudgetV1} from './action-choice-output-budget'
import {appendAgentRunEventV1, readInstanceAgentRunV1, type AgentRunSnapshotV1} from '../agent/run/event-store'
import {createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1} from '../agent/run/checkpoint'
import {createContextManifestFromAssemblyV1, parseContextManifestV1, verifyContextManifestIntegrityV1} from '../agent/run/context-manifest'
import {hashCanonicalValue} from '../agent/run/hash'
import {assertRuntimeHarnessFreshV1} from '../agent/run/runtime-scope'
import {readAgentRunArtifactExactV1, recordAgentRunArtifactV1} from '../memory/artifact-store'
import type {assembleContext} from '../registry/assemble-context'
import type {AIConfig, ChatMessage, WorkspaceScope} from '../types'
import {boundedChatOutputTokensV1} from './action-output-contract'
import {chatActionChoiceVersionForContractV1} from './action-choice-budget'
import {assertChatActionChoiceInputBudgetV1} from './action-choice-input-budget'
import {buildChatActionChoiceMessagesV1, chatActionChoiceRequestOptionsV1, parseChatActionChoiceV1,
  CHAT_ACTION_CHOICE_INPUT_TOKENS_V1, CHAT_ACTION_CHOICE_OUTPUT_TOKENS_V1, CHAT_ACTION_CHOICE_STEP_V1} from './action-choice-contract'
import {formatInteractionRuntimeContextV1} from './context-format'
import {chatActionContextVersionsV1} from './context-selection'
import {buildInteractionContextWindow} from './runtime'
import {readProductRuntimeState} from './runtime-api'

const stepId = CHAT_ACTION_CHOICE_STEP_V1
export const CHAT_ACTION_CHOICE_CHECKPOINT_V1 = 'chat-action-choice-pending-expression' as const
export class ChatActionChoiceHostInterruptionV1 extends Error {}
function fail(message: string): never {throw new Error(`[chat-action-choice] ${message}`)}
async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) {
  return appendAgentRunEventV1({scope, runId: snapshot.run.id, productRuntimeSessionId: snapshot.run.productRuntimeSessionId!,
    expectedLastSequence: snapshot.projection.lastSequence, type, payload} as Parameters<typeof appendAgentRunEventV1>[0])
}

/** The action Harness owns the cross-tab lock. Calling this stage again only
 * consumes retained evidence; a requested-but-missing response is never sent
 * again. Its checkpoint is not an adoptable action or a second story state. */
export async function chooseRuntimeChatActionV1(input: {
  scope: WorkspaceScope; snapshot: AgentRunSnapshotV1; participantKey: string
  assembled: Awaited<ReturnType<typeof assembleContext>>; actorMessages: readonly ChatMessage[]
  aiConfig?: AIConfig; runAI?: (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>; signal?: AbortSignal
  /** Host-only crash injection; the named durable boundary is already saved. */
  onDurableBoundary?: (boundary: 'model.requested' | 'raw-response.saved' | 'choice.saved', snapshot: AgentRunSnapshotV1) => void | Promise<void>
}) {
  let snapshot = await readInstanceAgentRunV1(input.scope, input.snapshot.run.id)
  if (snapshot.projection.lastSequence !== input.snapshot.projection.lastSequence) fail('行动运行已变化')
  if (snapshot.projection.state !== 'running' || chatActionChoiceVersionForContractV1(snapshot.contract) !== 1) fail('缺少当前可执行的选择合同')
  const sessionId = snapshot.run.productRuntimeSessionId ?? fail('选择步骤缺少实例owner')
  const binding = snapshot.contract.executionBindings!.find(item => item.stepId === stepId)!
  if (binding.version !== 2 || binding.maxOutputTokens !== CHAT_ACTION_CHOICE_OUTPUT_TOKENS_V1
    || binding.contextSourceKeys.join(',') !== 'interactionRuntime' || binding.writeTargets.length) fail('选择步骤必须冻结只读来源与输出上限')
  const freshness = {scope: input.scope, contractScope: snapshot.contract.scope, participantKey: input.participantKey}
  await assertRuntimeHarnessFreshV1(freshness)
  const state = (await readProductRuntimeState(sessionId)).interaction ?? fail('角色运行状态缺失')
  const profile = state.profiles.find(item => item.participantKey === input.participantKey) ?? fail('角色不存在')
  const versions = chatActionContextVersionsV1(binding.promptVersion)
  const roleContext = buildInteractionContextWindow(state, input.participantKey, {retrievalVersion: versions.retrievalVersion})
  if (input.assembled.included.join(',') !== 'interactionRuntime' || formatInteractionRuntimeContextV1(profile, roleContext) !== input.assembled.text
    || input.actorMessages[1]?.content !== `【目标】${snapshot.contract.objective}\n\n${input.assembled.text}`) fail('选择输入不是原Gateway交付的角色视角')
  const manifest = await createContextManifestFromAssemblyV1({runId: snapshot.run.id, stepId, attempt: 1,
    projectId: input.scope.projectId, worldGroupId: snapshot.run.worldGroupId ?? null, declaredSourceKeys: ['interactionRuntime'],
    assembled: input.assembled, readerVersion: versions.readerVersion})
  if (manifest.totalInputTokens > CHAT_ACTION_CHOICE_INPUT_TOKENS_V1) fail('选择步骤输入预算不足')
  const messages = buildChatActionChoiceMessagesV1(input.actorMessages, binding.promptVersion)
  const artifactEvents = (kind: string) => snapshot.events.filter(event => event.type === 'evidence.artifact.recorded'
    && event.payload.stepId === stepId && event.payload.attempt === 1 && event.payload.artifactKind === kind)
  const requested = snapshot.events.filter(event => event.type === 'model.requested' && event.payload.stepId === stepId)
  const retained = artifactEvents('raw-response')
  if (requested.length > 1 || retained.length > 1) fail('选择步骤存在重复请求或响应')
  if (requested.length && !retained.length) fail('选择调用结果未知；保留原运行，不会再次调用')
  let hostInterrupted = false
  const boundary = async (name: Parameters<NonNullable<typeof input.onDurableBoundary>>[0]) => {
    try {await input.onDurableBoundary?.(name, snapshot)} catch (error) {hostInterrupted = true; throw new ChatActionChoiceHostInterruptionV1(String(error))}
  }
  const record = async (artifactKind: Parameters<typeof recordAgentRunArtifactV1>[0]['artifactKind'], content: string) => {
    const saved = await recordAgentRunArtifactV1({scope: input.scope, runId: snapshot.run.id, productRuntimeSessionId: sessionId,
      artifactKind, content, stepId, attempt: 1, expectedLastSequence: snapshot.projection.lastSequence})
    snapshot = saved.snapshot
    return saved.artifact.contentHash
  }
  let contextPacketHash: string
  try {
    if (input.signal?.aborted) fail('选择已取消')
    let output: string
    if (retained[0]?.type === 'evidence.artifact.recorded') {
      const packets = artifactEvents('context-packet'), requests = artifactEvents('rendered-request')
      if (packets.length !== 1 || requests.length !== 1 || packets[0].type !== 'evidence.artifact.recorded' || requests[0].type !== 'evidence.artifact.recorded'
        || requested[0]?.type !== 'model.requested') fail('选择恢复证据不完整')
      contextPacketHash = packets[0].payload.contentHash
      const packet = JSON.parse(await readAgentRunArtifactExactV1({projectId: input.scope.projectId, artifactKind: 'context-packet', contentHash: contextPacketHash}))
      const originalManifest = parseContextManifestV1(packet.manifest)
      const assemblies = snapshot.events.filter(event => event.type === 'context.assembled' && event.payload.stepId === stepId)
      if (!await verifyContextManifestIntegrityV1(originalManifest) || originalManifest.manifestHash !== manifest.manifestHash
        || assemblies.length !== 1 || assemblies[0].type !== 'context.assembled' || assemblies[0].payload.manifestHash !== manifest.manifestHash
        || packet.participantKey !== input.participantKey || packet.text !== input.assembled.text
        || await hashCanonicalValue(packet.actorMessages) !== await hashCanonicalValue(input.actorMessages)) fail('选择来源或原表达输入已变化')
      const delivered = JSON.parse(await readAgentRunArtifactExactV1({projectId: input.scope.projectId, artifactKind: 'rendered-request', contentHash: requests[0].payload.contentHash}))
      if (delivered.version !== 1 || await hashCanonicalValue(delivered.messages) !== await hashCanonicalValue(messages)
        || requested[0].payload.bindingHash !== await hashCanonicalValue({runtimeBindingHash: snapshot.contract.runtimeBindingHash, manifestHash: manifest.manifestHash,
          messages, ...(delivered.requestOptions ? {requestOptions: delivered.requestOptions} : {})})) fail('选择请求绑定不一致')
      output = await readAgentRunArtifactExactV1({projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: retained[0].payload.contentHash})
      const responses = snapshot.events.filter(event => event.type === 'model.responded' && event.payload.stepId === stepId)
      if (responses.length !== 1 || responses[0].type !== 'model.responded' || responses[0].payload.outputHash !== await hashCanonicalValue(output)) fail('选择原始响应绑定不一致')
    } else {
      if (!input.runAI && !input.aiConfig) fail('缺少选择模型配置')
      const primary = snapshot.contract.executionBindings!.find(item => item.stepId === 'interaction:runtime-candidate')!
      const {stepId: _stepId, ...executionBinding} = primary
      const modelIdentity = input.runAI ? {provider: 'test-adapter', model: 'injected', transport: 'chat-v1'}
        : {provider: input.aiConfig!.provider, model: input.aiConfig!.model, transport: 'chat-v1'}
      if (snapshot.contract.runtimeBindingHash !== await hashCanonicalValue({executionBinding, modelIdentity})) fail('选择模型配置与原运行不一致')
      const status = snapshot.projection.steps[stepId]?.status
      if (!status) snapshot = await append(input.scope, snapshot, 'step.scheduled', {stepId})
      if (snapshot.projection.steps[stepId]?.status === 'scheduled') snapshot = await append(input.scope, snapshot, 'step.started', {stepId, attempt: 1})
      if (snapshot.projection.steps[stepId]?.status !== 'running') fail('选择步骤不能重试')
      snapshot = await append(input.scope, snapshot, 'context.assembled', {stepId, attempt: 1, manifestHash: manifest.manifestHash})
      contextPacketHash = await record('context-packet', JSON.stringify({version: 1, participantKey: input.participantKey, manifest,
        text: input.assembled.text, actorMessages: input.actorMessages}))
      const requestOptions = input.runAI ? undefined : chatActionChoiceRequestOptionsV1(input.aiConfig!.provider, binding.promptVersion)
      await record('rendered-request', JSON.stringify({version: 1, messages, ...(requestOptions ? {requestOptions} : {})}))
      // The retained inputs belong to this exact instance/run. Mark the
      // in-flight phase nonportable before dispatch, including a crash after
      // raw-response persistence but before the completed-choice checkpoint.
      snapshot = (await createAgentRunCheckpointV1({scope: input.scope, runId: snapshot.run.id, productRuntimeSessionId: sessionId,
        resumePayload: {kind: 'chat-action-choice-awaiting-response', version: 1, portable: false,
          participantKey: input.participantKey, contextPacketHash}, expectedLastSequence: snapshot.projection.lastSequence})).snapshot
      await assertRuntimeHarnessFreshV1(freshness)
      if (input.signal?.aborted) fail('选择已取消')
      await assertChatActionChoiceInputBudgetV1({scope: input.scope, snapshot, stepId, messages, requestOptions})
      snapshot = await append(input.scope, snapshot, 'model.requested', {stepId, attempt: 1,
        bindingHash: await hashCanonicalValue({runtimeBindingHash: snapshot.contract.runtimeBindingHash, manifestHash: manifest.manifestHash,
          messages, ...(requestOptions ? {requestOptions} : {})})})
      await boundary('model.requested')
      const result: ChatResult = {}
      const callConfig = input.aiConfig ? {...input.aiConfig, maxTokens: boundedChatOutputTokensV1(input.aiConfig.maxTokens, binding.maxOutputTokens)} : undefined
      output = input.runAI ? await input.runAI(messages, input.signal)
        : await chat(messages, callConfig!,
          {category: 'runtime.character.chat-narrative-action', projectId: input.scope.projectId, contextOverflowPolicy: 'reject'}, input.signal, result, requestOptions)
      snapshot = await append(input.scope, snapshot, 'model.responded', {stepId, attempt: 1, outputHash: await hashCanonicalValue(output)})
      await record('raw-response', output)
      snapshot = await recordChatActionOutputBudgetV1({scope: input.scope, snapshot, stepId, output, result, aiConfig: callConfig, injected: !!input.runAI})
      await boundary('raw-response.saved')
    }
    await readChatActionOutputBudgetV1(input.scope, snapshot)
    if (input.signal?.aborted) fail('选择已取消')
    await assertRuntimeHarnessFreshV1(freshness)
    const choice = parseChatActionChoiceV1(JSON.parse(output), roleContext, binding.promptVersion)
    const choiceHash = await hashCanonicalValue({version: 1, choice, contextPacketHash})
    const succeeded = snapshot.events.find(event => event.type === 'step.succeeded' && event.payload.stepId === stepId)
    if (succeeded?.type === 'step.succeeded') {
      if (succeeded.payload.outputHash !== choiceHash) fail('选择草稿与步骤终态不一致')
    } else snapshot = await append(input.scope, snapshot, 'step.succeeded', {stepId, attempt: 1, outputHash: choiceHash})
    const phase = {kind: CHAT_ACTION_CHOICE_CHECKPOINT_V1, version: 1, portable: false, participantKey: input.participantKey, contextPacketHash, choiceHash}
    const saved = await readLatestVerifiedAgentRunCheckpointV1(input.scope, snapshot.run.id, {owner: 'instance'})
    if (!snapshot.events.some(event => event.type === 'candidate.persisted' && event.payload.stepId === 'interaction:runtime-candidate')
      && (!saved || await hashCanonicalValue(saved.resumePayload) !== await hashCanonicalValue(phase))) {
      snapshot = (await createAgentRunCheckpointV1({scope: input.scope, runId: snapshot.run.id, productRuntimeSessionId: sessionId,
        resumePayload: phase, expectedLastSequence: snapshot.projection.lastSequence})).snapshot
    }
    await boundary('choice.saved')
    return {snapshot, choice, choiceHash, contextPacketHash}
  } catch (error) {
    if (hostInterrupted) throw error
    snapshot = await readInstanceAgentRunV1(input.scope, snapshot.run.id)
    if (snapshot.projection.steps[stepId]?.status === 'running') snapshot = await append(input.scope, snapshot, 'step.failed', {stepId, attempt: 1,
      code: input.signal?.aborted ? 'action-choice-cancelled' : 'action-choice-failed', retryable: false,
      category: input.signal?.aborted ? 'cancelled' : 'protocol', action: 'fail'})
    if (snapshot.projection.state === 'running') await append(input.scope, snapshot, input.signal?.aborted ? 'run.cancelled' : 'run.failed', input.signal?.aborted
      ? {reason: 'action-choice-cancelled'} : {code: 'action-choice-failed', retryable: false})
    throw error
  }
}
