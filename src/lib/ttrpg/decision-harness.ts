/** Shared durable protocol for TTRPG decisions. Product commands remain the only state writers. */
import { chat, resolveRequestConfig, type ChatResult } from '../ai/client'
import { estimateTokens } from '../ai/context-budget'
import { computeKnownCostUsd } from '../ai/usage-log'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import { appendAgentRunEventV1, appendRuntimeCandidateAdoptedV1, createAgentRunV1, readInstanceAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { hashCanonicalValue } from '../agent/run/hash'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { db } from '../db/schema'
import { assembleContext } from '../registry/assemble-context'
import type { AIConfig, ChatMessage, ProductRuntimeEvent, TtrpgRuntimeModelEvidenceV1, WorkspaceScope } from '../types'
import { readProductRuntimeStateVersion } from './runtime-api'
import { assertTtrpgCompleteContextV1 } from './prompt-context'

export interface TtrpgDecisionCandidateV1<T> {
  schema: 'storyforge.ttrpg-runtime-decision'
  version: 1
  portable: false
  kind: string
  runId: number
  productRuntimeSessionId: number
  baseSequence: number
  stateHash: string
  releaseHash: string
  visibilityHash: string
  contextManifestHash: string
  requiresHumanConfirmation: boolean
  payload: T
  modelCalls: TtrpgRuntimeModelEvidenceV1[]
  candidateHash: string
}
export interface TtrpgDecisionBoundaryV1<V> {
  view: V
  worldGroupId: number | null
  releaseHash: string
  visibilityHash: string
  requiresHumanConfirmation: boolean
}
export interface TtrpgDecisionProtocolV1<T, V> {
  kind: string
  skillId: string
  sourceKey: string
  systemPrompt: string
  capture(input: { scope: WorkspaceScope; productRuntimeSessionId: number; actorKey?: string }): Promise<TtrpgDecisionBoundaryV1<V>>
  parse(output: string, view: V): T
  commit(input: { scope: WorkspaceScope; candidate: TtrpgDecisionCandidateV1<T> }): Promise<ProductRuntimeEvent>
}
export interface TtrpgDecisionInputV1 {
  scope: WorkspaceScope
  productRuntimeSessionId: number
  actorKey?: string
  objective: string
  aiConfig?: AIConfig
  runAI?: (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>
  signal?: AbortSignal
  onRunCreated?: (runId: number) => void | Promise<void>
}
function fail(message: string): never { throw new Error(`[ttrpg-decision] ${message}`) }
async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, productRuntimeSessionId: snapshot.run.productRuntimeSessionId!,
    expectedLastSequence: snapshot.projection.lastSequence, type, payload } as Parameters<typeof appendAgentRunEventV1>[0])
}
function stepId(kind: string) { return `ttrpg:${kind}` }
function verifier(kind: string) { return `ttrpg-${kind}-terminal-v1` }
export function ttrpgDecisionCommandIdV1(candidate: TtrpgDecisionCandidateV1<unknown>) {
  return `ttrpg-${candidate.kind}:${candidate.runId}:${candidate.candidateHash.slice(0, 24)}`
}
export async function generateTtrpgDecisionV1<T, V>(protocol: TtrpgDecisionProtocolV1<T, V>, input: TtrpgDecisionInputV1) {
  if (!input.objective.trim() || input.objective.length > 8000) fail('请求文本无效')
  if (!input.aiConfig && !input.runAI) fail('请先配置 API')
  if (input.signal?.aborted) throw new DOMException('已取消', 'AbortError')
  const boundary = await protocol.capture(input)
  const version = await readProductRuntimeStateVersion(input.productRuntimeSessionId)
  const runtime = { productRuntimeSessionId: input.productRuntimeSessionId, baseSequence: version.sequence,
    stateHash: version.stateHash, releaseHash: boundary.releaseHash, visibilityHash: boundary.visibilityHash }
  const skill = getAgentSkillV1(protocol.skillId)
  if (!skill.contextSourceKeys.includes(protocol.sourceKey)) fail('Skill 未登记上下文源')
  const meta = { category: 'runtime.ttrpg-gm', projectId: input.scope.projectId, contextOverflowPolicy: 'reject' as const }
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, meta) : null
  const identity = input.runAI ? { provider: 'test-adapter', model: 'injected' }
    : { provider: resolved!.config.provider, model: resolved!.config.model }
  const runtimeBindingHash = await hashCanonicalValue({ skill: createAgentSkillExecutionBindingV1(skill), identity })
  const authority = boundary.requiresHumanConfirmation ? 'decision.author-confirmed' : 'decision.authorized'
  let snapshot = await createAgentRunV1({ scope: input.scope, productRuntimeSessionId: input.productRuntimeSessionId,
    worldGroupId: boundary.worldGroupId, contract: {
      version: 1, objective: input.objective.trim(), workflowKind: 'direct-generation',
      scope: { projectId: input.scope.projectId, worldGroupId: boundary.worldGroupId, runtime },
      permissions: { contextSourceKeys: [protocol.sourceKey], writeTargets: [] }, runtimeBindingHash,
      executionBindings: [{ stepId: stepId(protocol.kind), ...createAgentSkillExecutionBindingV1(skill) }],
      budget: { maxModelCalls: 2, maxToolCalls: 0, maxInputTokens: 36000, maxOutputTokens: skill.maxOutputTokens * 2, maxAttemptsPerStep: 2 },
      acceptance: [
        { id: 'decision.candidate', kind: 'output-present', required: true },
        { id: 'decision.freshness', kind: 'deterministic-check', required: true },
        { id: authority, kind: boundary.requiresHumanConfirmation ? 'author-confirmed' : 'deterministic-check', required: true },
        { id: 'decision.commit', kind: 'post-state-matches', required: true },
      ],
      verificationPlan: [{ id: 'decision.terminal', kind: 'terminal', verifier: verifier(protocol.kind),
        criterionIds: ['decision.candidate', 'decision.freshness', authority, 'decision.commit'] }],
      failurePolicy: { onProtocolError: 'retry', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
    } })
  await input.onRunCreated?.(snapshot.run.id)
  let attempt = 1
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: stepId(protocol.kind) })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: stepId(protocol.kind), attempt })
  const fresh = async () => {
    const [now, current] = await Promise.all([readProductRuntimeStateVersion(input.productRuntimeSessionId), protocol.capture(input)])
    if (now.sequence !== runtime.baseSequence || now.stateHash !== runtime.stateHash || current.visibilityHash !== runtime.visibilityHash
      || current.releaseHash !== runtime.releaseHash || current.requiresHumanConfirmation !== boundary.requiresHumanConfirmation) fail('输入或席位授权已变化，请重新主持')
  }
  try {
    const assembled = await assembleContext({ projectId: input.scope.projectId, scope: input.scope, worldGroupId: boundary.worldGroupId,
      productRuntimeSessionId: input.productRuntimeSessionId, ttrpgPlayerActorKey: input.actorKey,
      sourceKeys: [protocol.sourceKey], provider: input.aiConfig?.provider, model: input.aiConfig?.model, inputBudgetMaxTokens: 18000 })
    if (!assembled.included.includes(protocol.sourceKey)) fail('上下文装配为空')
    assertTtrpgCompleteContextV1(assembled, protocol.sourceKey)
    await fresh()
    const manifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: stepId(protocol.kind), attempt,
      projectId: input.scope.projectId, worldGroupId: boundary.worldGroupId, declaredSourceKeys: [protocol.sourceKey], assembled,
      readerVersion: `${protocol.kind}-v1` })
    snapshot = await append(input.scope, snapshot, 'context.assembled', { stepId: stepId(protocol.kind), attempt, manifestHash: manifest.manifestHash })
    let messages: ChatMessage[] = [{ role: 'system', content: protocol.systemPrompt },
      { role: 'user', content: `请求：${input.objective}\n\n已冻结上下文：\n${assembled.text}` }]
    const modelCalls: TtrpgRuntimeModelEvidenceV1[] = []
    let payload: T | undefined
    for (attempt = 1; attempt <= 2; attempt++) {
      await fresh()
      snapshot = await append(input.scope, snapshot, 'model.requested', { stepId: stepId(protocol.kind), attempt,
        bindingHash: await hashCanonicalValue({ runtimeBindingHash, manifestHash: manifest.manifestHash, messages }) })
      const result: ChatResult = {}, started = Date.now()
      const output = input.runAI ? await input.runAI(messages, input.signal)
        : await chat(messages, input.aiConfig!, { category: 'runtime.ttrpg-gm', projectId: input.scope.projectId, contextOverflowPolicy: 'reject' }, input.signal, result, undefined, resolved!)
      const inputTokens = result.usage?.inputTokens ?? messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
      const outputTokens = result.usage?.outputTokens ?? estimateTokens(output)
      modelCalls.push({ ...identity, usageSource: result.usage ? 'provider' : 'estimated', inputTokens, outputTokens,
        totalTokens: inputTokens + outputTokens, latencyMs: Date.now() - started,
        estimatedCostUsd: computeKnownCostUsd(identity.model, inputTokens, outputTokens) })
      snapshot = await append(input.scope, snapshot, 'model.responded', { stepId: stepId(protocol.kind), attempt, outputHash: await hashCanonicalValue(output) })
      try { payload = protocol.parse(output, boundary.view); break } catch (error) {
        // Only malformed JSON may be repaired. Semantic/authority errors never trigger another provider request.
        if (!(error instanceof SyntaxError) || attempt === 2) throw error
        snapshot = await append(input.scope, snapshot, 'step.failed', { stepId: stepId(protocol.kind), attempt,
          code: 'decision-json-repair', retryable: true, category: 'protocol', action: 'retry' })
        snapshot = await append(input.scope, snapshot, 'step.started', { stepId: stepId(protocol.kind), attempt: 2 })
        messages = [...messages, { role: 'assistant', content: output.slice(0, 16000) },
          { role: 'user', content: '输出不是合法 JSON。只修复 JSON 语法，保持允许字段与选择闭集，不要添加事实或权限。' }]
      }
    }
    if (payload === undefined) fail('没有有效决策')
    await fresh()
    const body = { schema: 'storyforge.ttrpg-runtime-decision' as const, version: 1 as const, portable: false as const,
      kind: protocol.kind, runId: snapshot.run.id, ...runtime, contextManifestHash: manifest.manifestHash,
      requiresHumanConfirmation: boundary.requiresHumanConfirmation, payload, modelCalls }
    const candidate: TtrpgDecisionCandidateV1<T> = { ...body, candidateHash: await hashCanonicalValue(body) }
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', { stepId: stepId(protocol.kind), attempt,
      candidateHash: candidate.candidateHash, requiresConfirmation: candidate.requiresHumanConfirmation })
    const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, productRuntimeSessionId: input.productRuntimeSessionId,
      expectedLastSequence: snapshot.projection.lastSequence, resumePayload: candidate })
    return { snapshot: saved.snapshot, candidate }
  } catch (error) {
    snapshot = await readInstanceAgentRunV1(input.scope, snapshot.run.id)
    if (snapshot.projection.steps[stepId(protocol.kind)]?.status === 'running') snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: stepId(protocol.kind), attempt: Math.min(attempt, 2), code: 'decision-stopped', retryable: false,
      category: input.signal?.aborted ? 'cancelled' : 'protocol', action: 'fail' })
    if (!['failed', 'cancelled', 'completed'].includes(snapshot.projection.state)) await append(input.scope, snapshot,
      input.signal?.aborted ? 'run.cancelled' : 'run.failed', input.signal?.aborted ? { reason: 'user-cancelled' } : { code: 'decision-stopped', retryable: false })
    throw error
  }
}

export async function adoptTtrpgDecisionV1<T, V>(protocol: TtrpgDecisionProtocolV1<T, V>, input: { scope: WorkspaceScope; runId: number; actorKey?: string }) {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId, { owner: 'instance' })
  if (!saved) fail('没有可恢复的主持决策')
  const candidate = saved.resumePayload as TtrpgDecisionCandidateV1<T>
  const { candidateHash, ...body } = candidate
  if (candidate.schema !== 'storyforge.ttrpg-runtime-decision' || candidate.kind !== protocol.kind || candidate.runId !== input.runId
    || await hashCanonicalValue(body) !== candidateHash) fail('主持候选身份或哈希无效')
  let snapshot = saved.snapshot
  const commandId = ttrpgDecisionCommandIdV1(candidate)
  let event = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([candidate.productRuntimeSessionId, commandId]).first()
  if (!event) {
    const [current, version] = await Promise.all([
      protocol.capture({ scope: input.scope, productRuntimeSessionId: candidate.productRuntimeSessionId, actorKey: input.actorKey }),
      readProductRuntimeStateVersion(candidate.productRuntimeSessionId),
    ])
    if (version.sequence !== candidate.baseSequence || version.stateHash !== candidate.stateHash || current.releaseHash !== candidate.releaseHash
      || current.visibilityHash !== candidate.visibilityHash || current.requiresHumanConfirmation !== candidate.requiresHumanConfirmation) fail('主持候选已过期')
    protocol.parse(JSON.stringify(candidate.payload), current.view)
    const step = snapshot.projection.steps[stepId(protocol.kind)]
    if (candidate.requiresHumanConfirmation) {
      if (step?.status === 'awaiting_confirmation') snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
        stepId: stepId(protocol.kind), candidateHash, decision: 'adopt' })
      else if (step?.confirmation !== 'adopt') fail('候选当前不等待确认')
    } else if (step?.status !== 'running') fail('自动主持候选状态无效')
    event = await protocol.commit({ scope: input.scope, candidate })
  }
  const payload = JSON.parse(event.payloadJson) as { candidateHash?: string; runId?: number }
  if (payload.candidateHash !== candidateHash || payload.runId !== candidate.runId) fail('已提交事件与主持候选不符')
  const version = await readProductRuntimeStateVersion(candidate.productRuntimeSessionId)
  if (snapshot.projection.state === 'completed') return { candidate, event, snapshot }
  const adoptionHash = await hashCanonicalValue({ candidateHash, event: event.id, postStateHash: version.stateHash })
  if (!snapshot.events.some(row => row.type === 'runtime.candidate.adopted')) snapshot = await appendRuntimeCandidateAdoptedV1({
    scope: input.scope, runId: input.runId, expectedLastSequence: snapshot.projection.lastSequence,
    payload: { stepId: stepId(protocol.kind), candidateHash, adoptionHash, commandIds: [commandId],
      baseSequence: candidate.baseSequence, resultingSequence: version.sequence } })
  if (snapshot.projection.steps[stepId(protocol.kind)]?.status !== 'succeeded') snapshot = await append(input.scope, snapshot, 'step.succeeded', {
    stepId: stepId(protocol.kind), attempt: snapshot.projection.steps[stepId(protocol.kind)]?.attempt ?? 1, outputHash: adoptionHash })
  if (snapshot.projection.state !== 'verifying') snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: verifier(protocol.kind) })
  const authority = candidate.requiresHumanConfirmation ? 'decision.author-confirmed' : 'decision.authorized'
  const receipt = await createVerificationReceiptV1({ version: 1, runId: input.runId, generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash, contextManifestHashes: [candidate.contextManifestHash], candidateHashes: [candidateHash], adoptionEventIds: [],
    postStateHash: version.stateHash, verifierSetVersion: verifier(protocol.kind), acceptedAt: Date.now(),
    criteria: ['decision.candidate', 'decision.freshness', authority, 'decision.commit'].map(id => ({ id, status: 'passed' as const,
      evidenceRefs: [`candidate:${candidateHash}`, `event:${event.id ?? event.sequence}`] })) })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { candidate, event, snapshot }
}

/** Deterministic command-side verification shared by all decision adapters. */
export async function readAuthorizedTtrpgDecisionV1<T>(input: { scope: WorkspaceScope; runId: number; candidateHash: string; kind: string; sourceKey: string; skillId: string }) {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId, { owner: 'instance' })
  if (!saved) fail('缺少已校验的决策 checkpoint')
  const candidate = saved.resumePayload as TtrpgDecisionCandidateV1<T>
  const { candidateHash, ...body } = candidate
  const { snapshot } = saved
  if (candidate.schema !== 'storyforge.ttrpg-runtime-decision' || candidate.version !== 1 || candidate.portable !== false
    || candidate.kind !== input.kind || candidate.runId !== input.runId || candidateHash !== input.candidateHash
    || await hashCanonicalValue(body) !== candidateHash || snapshot.run.productRuntimeSessionId !== candidate.productRuntimeSessionId
    || snapshot.contract.scope.runtime?.baseSequence !== candidate.baseSequence || snapshot.contract.scope.runtime.stateHash !== candidate.stateHash
    || !snapshot.contract.permissions.contextSourceKeys.includes(input.sourceKey)
    || !snapshot.contract.executionBindings?.some(binding => binding.skillId === input.skillId && binding.stepId === stepId(input.kind))
    || !snapshot.events.some(event => event.type === 'context.assembled' && event.payload.manifestHash === candidate.contextManifestHash)
    || !snapshot.events.some(event => event.type === 'candidate.persisted' && event.payload.candidateHash === candidateHash
      && event.payload.requiresConfirmation === candidate.requiresHumanConfirmation)
    || (candidate.requiresHumanConfirmation && !snapshot.events.some(event => event.type === 'confirmation.recorded'
      && event.payload.candidateHash === candidateHash && event.payload.decision === 'adopt')))
    fail('决策缺少有效的来源、候选或 RunContract 授权')
  return { candidate, snapshot }
}
