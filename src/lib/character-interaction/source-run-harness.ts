import {resolveRequestConfig, type ChatResult} from '../ai/client'
import {CodexTerminalFailureV1Schema, type CodexTerminalFailureV1} from '../ai/codex-terminal-failure'
import {estimateTokens} from '../ai/context-budget'
import {computeKnownCostUsd} from '../ai/usage-log'
import {createAgentSkillExecutionBindingV1} from '../agent/execution-binding'
import {freezeFormalAIEntryBindingV1} from '../agent/formal-ai-entry'
import {createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1} from '../agent/run/checkpoint'
import {createContextManifestFromAssemblyV1, verifyContextManifestIntegrityV1} from '../agent/run/context-manifest'
import {sha256Text} from '../ai/chapter-memory/text-normalization'
import type {ContextManifestV1} from '../types/agent-run'
import {appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, type AgentRunSnapshotV1} from '../agent/run/event-store'
import {hashCanonicalValue} from '../agent/run/hash'
import {createVerificationReceiptV1} from '../agent/run/verification-receipt'
import {getAgentSkillV1} from '../agent/skill-registry'
import type {CreativeArtifactV1, CreativeCallEvidenceV1} from '../agent/creative-reliability'
import {assembleContext} from '../registry/assemble-context'
import type {AssembleContextInput} from '../registry/types'
import {db} from '../db/schema'
import {readOwnedRows} from '../workspace/scope'
import type {AgentRunRecord, AgentRunWriteTargetV1, AIConfig, ChatMessage, WorkspaceScope} from '../types'
import {readChatSourceReviewContextV1, type ChatSourceReviewContextV1, type ChatSourceReviewRequestV1} from './source-review-context'

const terminal = new Set(['completed', 'failed', 'cancelled'])
export interface ChatSourceRunPayloadV1<R, Q = ChatSourceReviewRequestV1, C = ChatSourceReviewContextV1> {
  kind: string
  version: 1
  request: Q
  context: C
  model: {provider: string; model: string}
  messages: ChatMessage[]
  manifestHash: string
  /** Old runs retain their original hash-only history; never fabricate a manifest for them. */
  manifest?: {value: ContextManifestV1; sourceText: string}
  response: {raw: string; call: CreativeCallEvidenceV1} | null
  result: R | null
  /** Absent on historical runs; never reconstructed from an error string. */
  failure?: CodexTerminalFailureV1
}
export interface ChatSourceRunViewV1<R, C = ChatSourceReviewContextV1> {
  runId: number
  status: 'ready' | 'blocked' | 'pending' | 'unknown' | 'cancelled' | 'stale' | 'adopted'
  context: C | null
  result: R | null
  failure?: CodexTerminalFailureV1
}
export type ChatSourceRunBoundaryV1 = 'prepared' | 'model.requested' | 'response.saved' | 'model.responded' | 'candidate.persisted' | 'failure.saved' | 'failure.recorded'
export interface ChatSourceRunProtocolV1<R, Q = ChatSourceReviewRequestV1, C = ChatSourceReviewContextV1> {
  step: string; skill: string; entry: string; category: string; kind: string; verifier: string; lockKey: string
  prompt: string | ((promptVersion: string) => string); objective: string; criterion: string; writeTargets: AgentRunWriteTargetV1[]
  source?: {key: string; options: (request: Q) => Partial<AssembleContextInput>; read: (scope: WorkspaceScope, request: Q) => Promise<C>; validateRequest: (request: Q) => void}
  confirmationCriteria?: readonly [string, string, string]
  createArtifact: (raw: string, context: C, call: CreativeCallEvidenceV1) => R
  hasCandidate: (result: R) => boolean
  validateContext?: (context: C) => void
  runModel: (input: {formalEntry: Awaited<ReturnType<typeof freezeFormalAIEntryBindingV1>>; skill: ReturnType<typeof getAgentSkillV1>;
    messages: ChatMessage[]; resolved: ReturnType<typeof resolveRequestConfig>; scope: WorkspaceScope; signal?: AbortSignal; result: ChatResult}) => Promise<string>
}

/** Shared selected-source request ledger. Each use has a separately registered execution and write contract. */
export function createChatSourceRunHarnessV1<R extends {artifact: CreativeArtifactV1}, Q = ChatSourceReviewRequestV1, C = ChatSourceReviewContextV1>(protocol: ChatSourceRunProtocolV1<R, Q, C>) {
const {step: STEP, skill: SKILL, entry: ENTRY, category: CATEGORY, kind: KIND, verifier: VERIFIER} = protocol
const SOURCE = protocol.source?.key ?? 'chat.source-review'
const confirmationCriteria = protocol.confirmationCriteria ?? ['profile.confirmed', 'profile.adopted', 'profile.post-state']
const readContext = (scope: WorkspaceScope, request: Q): Promise<C> => protocol.source ? protocol.source.read(scope, request) : readChatSourceReviewContextV1(scope, request as ChatSourceReviewRequestV1) as Promise<C>
const writable = protocol.writeTargets.length > 0
const locks = new Set<number>()
async function withLock<T>(scope: WorkspaceScope, injected: boolean, action: () => Promise<T>): Promise<T> {
  if (locks.has(scope.workId)) throw new Error('资料整理仍在处理中')
  locks.add(scope.workId)
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request(`storyforge:${protocol.lockKey}:${db.name}:${scope.workId}`, {ifAvailable: true}, lock => {
      if (!lock) throw new Error('另一页面正在整理资料，请稍后查看结果')
      return action()
    })
    if (typeof window !== 'undefined' && !injected) throw new Error('当前浏览器无法锁定资料整理，请使用支持 Web Locks 的浏览器')
    return await action()
  } finally {locks.delete(scope.workId)}
}
async function reviewRuns(scope: WorkspaceScope) {
  return (await readOwnedRows<AgentRunRecord>(scope, 'agentRuns', {owner: 'work'}))
    .filter(row => row.contractJson.includes(`"skillId":"${SKILL}"`)).sort((a, b) => b.id! - a.id!)
}
async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) {
  return appendAgentRunEventV1({scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence} as Parameters<typeof appendAgentRunEventV1>[0])
}
async function checkpoint(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, payload: ChatSourceRunPayloadV1<R, Q, C>) {
  return (await createAgentRunCheckpointV1({scope, runId: snapshot.run.id, resumePayload: payload, expectedLastSequence: snapshot.projection.lastSequence})).snapshot
}
async function bindingHash(payload: ChatSourceRunPayloadV1<R, Q, C>) {
  return hashCanonicalValue({request: payload.request, context: payload.context, model: payload.model, messages: payload.messages})
}
async function load(scope: WorkspaceScope, runId: number) {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!saved) throw new Error('资料整理的准备记录未保存，请结束该任务后重新开始')
  const payload = saved.resumePayload as ChatSourceRunPayloadV1<R, Q, C>
  const snapshot = saved.snapshot
  if (payload?.kind !== KIND || payload.version !== 1
    || snapshot.contract.executionBindings?.[0]?.skillId !== SKILL
    || snapshot.contract.executionBindings?.[0]?.stepId !== STEP
    || snapshot.contract.runtimeBindingHash !== await bindingHash(payload)) throw new Error('资料整理的来源或运行绑定不一致')
  if (payload.manifest) {
    const {value, sourceText} = payload.manifest, source = value.sources[0]
    if (!await verifyContextManifestIntegrityV1(value) || value.manifestHash !== payload.manifestHash
      || value.stepId !== STEP || value.attempt !== 1 || value.sources.length !== 1 || source?.key !== SOURCE
      || source.status !== 'included' || source.delivery !== 'full' || source.contentHash !== await sha256Text(sourceText)
      || await hashCanonicalValue(JSON.parse(sourceText)) !== await hashCanonicalValue(payload.context)
      || !payload.messages.some(message => message.role === 'user' && message.content.includes(sourceText))) throw new Error('资料整理的完整读取清单与实际模型输入不一致')
  }
  const requested = snapshot.events.filter(event => event.type === 'model.requested')
  const responded = snapshot.events.filter(event => event.type === 'model.responded')
  const promptHash = await hashCanonicalValue(payload.messages)
  const outputHash = payload.response ? await hashCanonicalValue(payload.response.raw) : null
  if (requested.length > 1 || responded.length > 1
    || requested.some(event => event.type === 'model.requested' && (event.payload.bindingHash !== promptHash || event.payload.stepId !== STEP || event.payload.attempt !== 1))
    || responded.some(event => event.type === 'model.responded' && (event.payload.outputHash !== outputHash || event.payload.stepId !== STEP || event.payload.attempt !== 1))
    || !!payload.response && (requested.length !== 1 || payload.response.call.outputHash !== outputHash
      || payload.response.call.provider !== payload.model.provider || payload.response.call.model !== payload.model.model)
    || !snapshot.events.some(event => event.type === 'context.assembled' && event.payload.manifestHash === payload.manifestHash))
    throw new Error('资料整理的请求、原始回复或上下文证据不一致')
  if (payload.response) {
    const candidateHash = await hashCanonicalValue(protocol.createArtifact(payload.response.raw, payload.context, payload.response.call))
    if (payload.result && await hashCanonicalValue(payload.result) !== candidateHash
      || snapshot.events.some(event => event.type === 'candidate.persisted' && (!payload.result || event.payload.candidateHash !== candidateHash))) throw new Error('资料整理候选与原始回复不一致')
  }
  if (payload.failure !== undefined) {
    const failure = CodexTerminalFailureV1Schema.parse(payload.failure)
    const code = `codex-turn-${failure.providerTurn.status}`
    if (payload.model.provider !== failure.provider || payload.model.model !== failure.model || requested.length !== 1
      || payload.response !== null || payload.result !== null
      || snapshot.events.some(event => event.type === 'candidate.persisted' || event.type === 'verification.accepted'
        || event.type === 'step.failed' && (event.payload.stepId !== STEP || event.payload.attempt !== 1 || event.payload.code !== code || event.payload.retryable)
        || event.type === 'run.failed' && (event.payload.code !== code || event.payload.retryable))) throw new Error('资料整理的失败回执与请求不一致')
  }
  return {snapshot, payload}
}

async function finishFailure(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, failure: CodexTerminalFailureV1,
  onBoundary?: (boundary: ChatSourceRunBoundaryV1, runId: number) => void | Promise<void>) {
  if (terminal.has(snapshot.projection.state)) return
  const code = `codex-turn-${failure.providerTurn.status}`
  if (snapshot.projection.steps[STEP]?.status !== 'failed')
    snapshot = await append(scope, snapshot, 'step.failed', {stepId: STEP, attempt: 1, code, retryable: false, category: 'deterministic', action: 'fail'})
  await onBoundary?.('failure.recorded', snapshot.run.id)
  await append(scope, snapshot, 'run.failed', {code, retryable: false})
}

/** Finish a retained response without any provider/config access or new call. */
async function finish(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, payload: ChatSourceRunPayloadV1<R, Q, C>,
  onBoundary?: (boundary: ChatSourceRunBoundaryV1, runId: number) => void | Promise<void>) {
  if (payload.failure) return finishFailure(scope, snapshot, payload.failure, onBoundary)
  if (!payload.response) throw new Error('请求结果尚未留存，不能自动重发')
  const responseHash = await hashCanonicalValue(payload.response.raw)
  if (!snapshot.events.some(event => event.type === 'model.responded'))
    snapshot = await append(scope, snapshot, 'model.responded', {stepId: STEP, attempt: 1, outputHash: responseHash})
  const result = protocol.createArtifact(payload.response.raw, payload.context, payload.response.call)
  payload.result = result
  const candidateHash = await hashCanonicalValue(result)
  if (!snapshot.events.some(event => event.type === 'candidate.persisted')) {
    snapshot = await checkpoint(scope, snapshot, payload)
    snapshot = await append(scope, snapshot, 'candidate.persisted', {stepId: STEP, attempt: 1, candidateHash, requiresConfirmation: writable && protocol.hasCandidate(result)})
    await onBoundary?.('candidate.persisted', snapshot.run.id)
  }
  if (terminal.has(snapshot.projection.state)) return
  if (!protocol.hasCandidate(result)) {
    snapshot = await append(scope, snapshot, 'step.failed', {stepId: STEP, attempt: 1, code: 'source-suggestion-invalid', retryable: false, category: 'protocol', action: 'fail'})
    await append(scope, snapshot, 'run.failed', {code: 'source-suggestion-invalid', retryable: false})
    return
  }
  if (writable) return
  if (snapshot.projection.steps[STEP]?.status !== 'succeeded')
    snapshot = await append(scope, snapshot, 'step.succeeded', {stepId: STEP, attempt: 1, outputHash: candidateHash})
  if (snapshot.projection.state !== 'verifying')
    snapshot = await append(scope, snapshot, 'verification.started', {verifierSetVersion: VERIFIER})
  const receipt = await createVerificationReceiptV1({version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash, contextManifestHashes: [payload.manifestHash], candidateHashes: [candidateHash], adoptionEventIds: [],
    postStateHash: candidateHash, verifierSetVersion: VERIFIER, criteria: [{id: protocol.criterion, status: 'passed', evidenceRefs: [`candidate:${candidateHash}`]}], acceptedAt: Date.now()})
  await append(scope, snapshot, 'verification.accepted', {receiptHash: receipt.receiptHash})
}

async function read(scope: WorkspaceScope, runId: number): Promise<ChatSourceRunViewV1<R, C>> {
  if (!await readLatestVerifiedAgentRunCheckpointV1(scope, runId)) {
    const snapshot = await readAgentRunV1(scope, runId)
    if (snapshot.contract.executionBindings?.[0]?.skillId !== SKILL) throw new Error('当前任务不属于资料整理')
    return {runId, status: snapshot.projection.state === 'cancelled' ? 'cancelled' : 'pending', context: null, result: null}
  }
  const {snapshot, payload} = await load(scope, runId)
  const result = payload.result ?? (payload.response ? protocol.createArtifact(payload.response.raw, payload.context, payload.response.call) : null)
  let status: ChatSourceRunViewV1<R, C>['status'] = snapshot.projection.state === 'cancelled' ? 'cancelled'
    : snapshot.projection.state === 'failed' ? 'blocked'
    : !payload.response ? payload.failure ? 'pending' : snapshot.events.some(event => event.type === 'model.requested') ? 'unknown' : 'pending'
    : snapshot.projection.state === 'completed' ? writable ? 'adopted' : 'ready'
    : writable && snapshot.projection.state === 'awaiting_confirmation' ? 'ready' : 'pending'
  if (status === 'ready' || status === 'blocked' && result) {
    try {
      if (await hashCanonicalValue(await readContext(scope, payload.request)) !== await hashCanonicalValue(payload.context)) status = 'stale'
    } catch {status = 'stale'}
  }
  return {runId, status, context: payload.context, result, ...(payload.failure ? {failure: payload.failure} : {})}
}
async function latest(scope: WorkspaceScope) {
  const row = (await reviewRuns(scope))[0]
  return row ? read(scope, row.id!) : null
}
async function recover(scope: WorkspaceScope, runId: number) {
  return withLock(scope, true, async () => {
    const {snapshot, payload} = await load(scope, runId)
    if (!terminal.has(snapshot.projection.state)) await finish(scope, snapshot, payload)
    return read(scope, runId)
  })
}
/** Explicit author dismissal only; a later generation is a separate request. */
async function cancel(scope: WorkspaceScope, runId: number) {
  return withLock(scope, true, async () => {
    const snapshot = await readAgentRunV1(scope, runId)
    if (snapshot.contract.executionBindings?.[0]?.skillId !== SKILL) throw new Error('当前任务不属于资料整理')
    if (!terminal.has(snapshot.projection.state)) await append(scope, snapshot, 'run.cancelled', {reason: '作者结束此次资料整理；不自动重发'})
  })
}

async function generate(input: {
  scope: WorkspaceScope; request: Q; config?: AIConfig; signal?: AbortSignal
  runAI?: (messages: ChatMessage[]) => Promise<string>
  onBoundary?: (boundary: ChatSourceRunBoundaryV1, runId: number) => void | Promise<void>
}) {
  const scope = structuredClone(input.scope), request = structuredClone(input.request)
  return withLock(scope, !!input.runAI, async () => {
    if (protocol.source) protocol.source.validateRequest(request)
    else {const legacy = request as ChatSourceReviewRequestV1; if (!legacy.fragmentKeys.length || legacy.fragmentKeys.length > 12) throw new Error('请一次选择1至12项资料')}
    for (const row of (await reviewRuns(scope)).filter(row => !terminal.has(row.status))) {
      const previous = await readAgentRunV1(scope, row.id!)
      // Import invalidates old receipts. Historical finished reports are not
      // in-flight requests and must not trap a Work behind invisible old runs.
      if (!previous.events.some(event => event.type === 'verification.accepted'))
        throw new Error('有尚未结束的资料整理，请先恢复已保存结果或结束该任务')
    }
    const skill = getAgentSkillV1(SKILL), binding = createAgentSkillExecutionBindingV1(skill), formalEntry = await freezeFormalAIEntryBindingV1(ENTRY)
    const resolved = input.config ? resolveRequestConfig({...structuredClone(input.config), maxTokens: 6000}, {category: CATEGORY, projectId: scope.projectId, contextOverflowPolicy: 'reject'}) : null
    if (!input.runAI && !resolved) throw new Error('请先配置全局 AI')
    const assembled = await assembleContext({...(protocol.source ? protocol.source.options(request) : {chatSourceReviewRequest: request as ChatSourceReviewRequestV1}), projectId: scope.projectId, scope, sourceKeys: [SOURCE],
      provider: resolved?.config.provider, model: resolved?.config.model, inputBudgetMaxTokens: 20_000})
    if (assembled.included.join(',') !== SOURCE || assembled.trimmed.length || assembled.overBudgetAfterTrim
      || assembled.sourceEvidence?.some(row => row.delivery !== 'full')) throw new Error('本次原文不能完整交付，请减少选中资料')
    const context = JSON.parse(assembled.segments[0].content) as C
    protocol.validateContext?.(context)
    const model = {provider: resolved?.config.provider ?? 'test', model: resolved?.config.model ?? 'test'}
    const prompt = typeof protocol.prompt === 'string' ? protocol.prompt : protocol.prompt(binding.promptVersion)
    const messages: ChatMessage[] = [{role: 'system', content: prompt}, {role: 'user', content: assembled.text}]
    const inputTokens = messages.reduce((sum, row) => sum + estimateTokens(row.content), 0)
    if (inputTokens > 24_000) throw new Error('本次资料超过整理容量，请减少选中资料')
    const payload: ChatSourceRunPayloadV1<R, Q, C> = {kind: KIND, version: 1, request, context, model, messages, manifestHash: '', response: null, result: null}
    let snapshot = await createAgentRunV1({scope, worldGroupId: null, contract: {
      version: 1, objective: protocol.objective, workflowKind: 'direct-generation',
      scope: {projectId: scope.projectId, worldGroupId: null}, permissions: {contextSourceKeys: [SOURCE], writeTargets: protocol.writeTargets},
      runtimeBindingHash: await bindingHash(payload), executionBindings: [{stepId: STEP, ...binding, formalEntry}],
      budget: {maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 24_000, maxOutputTokens: 6000, maxAttemptsPerStep: 1},
      acceptance: [{id: protocol.criterion, kind: 'deterministic-check', required: true}, ...(writable ? [{id: confirmationCriteria[0], kind: 'author-confirmed' as const, required: true}, {id: confirmationCriteria[1], kind: 'adoption-committed' as const, required: true}, {id: confirmationCriteria[2], kind: 'post-state-matches' as const, required: true}] : [])],
      verificationPlan: [{id: 'source-review.terminal', kind: 'terminal', verifier: VERIFIER, criterionIds: [protocol.criterion, ...(writable ? confirmationCriteria : [])]}],
      failurePolicy: {onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author'},
    }})
    snapshot = await append(scope, snapshot, 'step.scheduled', {stepId: STEP})
    snapshot = await append(scope, snapshot, 'step.started', {stepId: STEP, attempt: 1})
    const manifest = await createContextManifestFromAssemblyV1({runId: snapshot.run.id, stepId: STEP, attempt: 1, projectId: scope.projectId, worldGroupId: null,
      declaredSourceKeys: [SOURCE], assembled, readerVersion: VERIFIER})
    payload.manifestHash = manifest.manifestHash
    payload.manifest = {value: manifest, sourceText: assembled.segments[0].content}
    snapshot = await append(scope, snapshot, 'context.assembled', {stepId: STEP, attempt: 1, manifestHash: manifest.manifestHash})
    snapshot = await checkpoint(scope, snapshot, payload)
    await input.onBoundary?.('prepared', snapshot.run.id)
    if (input.signal?.aborted) throw new Error('已取消资料整理，未发送模型请求')
    if (await hashCanonicalValue(await readContext(scope, request)) !== await hashCanonicalValue(context)) throw new Error('资料已变化，未发送模型请求')
    snapshot = await append(scope, snapshot, 'model.requested', {stepId: STEP, attempt: 1, bindingHash: await hashCanonicalValue(messages)})
    await input.onBoundary?.('model.requested', snapshot.run.id)
    const result: ChatResult = {}, start = Date.now()
    let raw: string
    try {
      raw = input.runAI ? await input.runAI(messages) : await protocol.runModel({formalEntry, skill, messages, resolved: resolved!, scope, signal: input.signal, result})
    } catch (cause) {
      if (result.terminalFailure && model.provider === 'codex' && result.terminalFailure.model === model.model) {
        payload.failure = CodexTerminalFailureV1Schema.parse(result.terminalFailure)
        snapshot = await checkpoint(scope, snapshot, payload)
        await input.onBoundary?.('failure.saved', snapshot.run.id)
        await finishFailure(scope, snapshot, payload.failure, input.onBoundary)
        throw cause
      }
      const status = result.requestLifecycle?.responseStatus
      if (result.requestLifecycle?.phase === 'response-observed' && status != null && status >= 400 && status < 500) {
        snapshot = await append(scope, snapshot, 'step.failed', {stepId: STEP, attempt: 1, code: `provider-rejected-${status}`, retryable: false, category: 'deterministic', action: 'fail'})
        await append(scope, snapshot, 'run.failed', {code: `provider-rejected-${status}`, retryable: false})
      }
      throw cause
    }
    const measuredInput = result.usage?.inputTokens ?? inputTokens, outputTokens = result.usage?.outputTokens ?? estimateTokens(raw)
    payload.response = {raw, call: {version: 1, callIndex: 1, purpose: 'generate', status: 'succeeded', ...model,
      usageSource: result.usage ? 'provider' : 'estimated', inputTokens: measuredInput, outputTokens, totalTokens: result.usage?.totalTokens ?? measuredInput + outputTokens,
      latencyMs: Date.now() - start, estimatedCostUsd: computeKnownCostUsd(model.model, measuredInput, outputTokens), outputHash: await hashCanonicalValue(raw)}}
    snapshot = await checkpoint(scope, snapshot, payload)
    await input.onBoundary?.('response.saved', snapshot.run.id)
    snapshot = await append(scope, snapshot, 'model.responded', {stepId: STEP, attempt: 1, outputHash: payload.response.call.outputHash!})
    await input.onBoundary?.('model.responded', snapshot.run.id)
    await finish(scope, snapshot, payload, input.onBoundary)
    return read(scope, snapshot.run.id)
  })
}

return {generate, read, latest, recover, cancel, load, withLock, append, checkpoint, finish, runs: reviewRuns}
}
