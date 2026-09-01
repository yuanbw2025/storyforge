import { chat } from '../ai/client'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1, type AgentSkillId } from '../agent/skill-registry'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import {
  appendAgentRunEventV1,
  appendRuntimeCandidateAdoptedV1,
  createAgentRunV1,
  readInstanceAgentRunV1,
  type AgentRunSnapshotV1,
} from '../agent/run/event-store'
import { hashCanonicalValue } from '../agent/run/hash'
import { assertOpenWorldRuntimeHarnessFreshV1, captureOpenWorldRuntimeHarnessBoundaryV1 } from '../agent/run/runtime-scope'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { db } from '../db/schema'
import { verifyPlayableSessionPackageV2 } from '../game-production/preview-source'
import { assembleContext } from '../registry/assemble-context'
import { readSimulationState, readSimulationStateVersion } from '../simulation/runtime'
import type { AIConfig, ChatMessage, OpenWorldExpressionCandidateV1, WorkspaceScope } from '../types'
import { validateOpenWorldExpressionCandidate } from './runtime'

export const OPEN_WORLD_RUNTIME_STEP_ID_V1 = 'open-world:runtime-candidate' as const
export const OPEN_WORLD_RUNTIME_VERIFIER_SET_V1 = 'open-world-runtime-terminal-v1' as const
export type OpenWorldRuntimeSkillIdV1 = Extract<AgentSkillId,
  'prose.open-world-quest-expression' | 'prose.open-world-scene-narration'>

interface CandidateBaseV1 {
  version: 1
  portable: false
  runId: number
  simulationSessionId: number
  baseSequence: number
  stateHash: string
  visibilityHash: string
  releaseHash: string
  contextManifestHash: string
  candidateHash: string
}

export type OpenWorldRuntimeCandidateV1 = CandidateBaseV1 & OpenWorldExpressionCandidateV1
type RunAI = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>

function fail(message: string): never { throw new Error(`[textworld-harness] ${message}`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string) {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail(`${label}字段不在允许闭集`)
}
function parseJson(output: string): Record<string, unknown> {
  let source = output.trim(); const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/); if (fenced) source = fenced[1]
  try { return record(JSON.parse(source), '模型输出') } catch (error) { if (error instanceof SyntaxError) fail('模型输出不是有效 JSON'); throw error }
}

const KIND_BY_SKILL: Record<OpenWorldRuntimeSkillIdV1, OpenWorldExpressionCandidateV1['kind']> = {
  'prose.open-world-quest-expression': 'quest-expression',
  'prose.open-world-scene-narration': 'scene-narration',
}

function messages(skillId: OpenWorldRuntimeSkillIdV1, objective: string, context: string): ChatMessage[] {
  return [{ role: 'system', content: [
    '你是 StoryForge 统一 Harness 下的文字开放世界表现候选生成器。',
    '只能润色已公开任务或叙述正式事件证据；不得改变区域、人物、组织、旅行、任务、资源、问题或结局事实。',
    `kind 必须为 ${KIND_BY_SKILL[skillId]}。quest-expression 必须引用已公开 instanceKey；scene-narration 可以为 null。`,
    '只输出严格 JSON，不要 Markdown 或额外字段：{"kind":"...","instanceKey":null,"title":"...","text":"...","dialogue":"","evidenceEventSequences":[1],"assertedReferences":[{"kind":"region","key":"region.1"}]}',
  ].join('\n') }, { role: 'user', content: `【目标】${objective.trim()}\n\n${context}` }]
}

function parseDraft(skillId: OpenWorldRuntimeSkillIdV1, output: string): OpenWorldExpressionCandidateV1 {
  const source = parseJson(output)
  exact(source, ['kind', 'instanceKey', 'title', 'text', 'dialogue', 'evidenceEventSequences', 'assertedReferences'], '开放世界表现候选')
  if (source.kind !== KIND_BY_SKILL[skillId] || (source.instanceKey !== null && typeof source.instanceKey !== 'string')
    || typeof source.title !== 'string' || typeof source.text !== 'string' || typeof source.dialogue !== 'string'
    || !source.title.trim() || !source.text.trim() || source.title.length > 300 || source.text.length > 20_000 || source.dialogue.length > 20_000
    || !Array.isArray(source.evidenceEventSequences) || !source.evidenceEventSequences.length || source.evidenceEventSequences.length > 128
    || !Array.isArray(source.assertedReferences) || source.assertedReferences.length > 128) fail('候选结构无效')
  if (source.kind === 'quest-expression' && !String(source.instanceKey ?? '').trim()) fail('任务表现候选必须引用任务实例')
  const evidenceEventSequences = source.evidenceEventSequences.map((value, index) => {
    if (!Number.isInteger(value) || Number(value) < 1) fail(`证据序号 ${index} 无效`)
    return Number(value)
  })
  if (new Set(evidenceEventSequences).size !== evidenceEventSequences.length) fail('证据序号不得重复')
  const assertedReferences = source.assertedReferences.map((value, index) => {
    const reference = record(value, `引用 ${index}`); exact(reference, ['kind', 'key'], `引用 ${index}`)
    if (!['region', 'participant', 'organization', 'quest', 'issue', 'channel'].includes(String(reference.kind))
      || typeof reference.key !== 'string' || !reference.key.trim()) fail(`引用 ${index} 无效`)
    return { kind: reference.kind as OpenWorldExpressionCandidateV1['assertedReferences'][number]['kind'], key: reference.key.trim() }
  })
  return { kind: source.kind as OpenWorldExpressionCandidateV1['kind'], instanceKey: source.instanceKey == null ? null : source.instanceKey.trim(), title: source.title.trim(), text: source.text.trim(), dialogue: source.dialogue.trim(), evidenceEventSequences, assertedReferences }
}

function contract(input: { objective: string; boundary: Awaited<ReturnType<typeof captureOpenWorldRuntimeHarnessBoundaryV1>>; skillId: OpenWorldRuntimeSkillIdV1; runtimeBindingHash: string }) {
  const skill = getAgentSkillV1(input.skillId)
  return {
    version: 1 as const, objective: input.objective, workflowKind: 'direct-generation' as const, scope: input.boundary.scope,
    permissions: { contextSourceKeys: ['openWorldRuntime'], writeTargets: [] }, runtimeBindingHash: input.runtimeBindingHash,
    executionBindings: [{ stepId: OPEN_WORLD_RUNTIME_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 16_000, maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'runtime.candidate', kind: 'output-present' as const, required: true }, { id: 'runtime.freshness', kind: 'deterministic-check' as const, required: true }, { id: 'runtime.read-only', kind: 'post-state-matches' as const, required: true }],
    verificationPlan: [{ id: 'runtime.terminal', kind: 'terminal' as const, verifier: OPEN_WORLD_RUNTIME_VERIFIER_SET_V1, criterionIds: ['runtime.candidate', 'runtime.freshness', 'runtime.read-only'] }],
    failurePolicy: { onProtocolError: 'fail' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const },
  }
}

async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, simulationSessionId: snapshot.run.simulationSessionId ?? fail('运行时事件缺少 Instance owner'), type, payload, expectedLastSequence: snapshot.projection.lastSequence } as Parameters<typeof appendAgentRunEventV1>[0])
}

export async function generateOpenWorldRuntimeCandidateV1(input: {
  scope: WorkspaceScope
  simulationSessionId: number
  skillId: OpenWorldRuntimeSkillIdV1
  objective: string
  aiConfig?: AIConfig
  runAI?: RunAI
  signal?: AbortSignal
  onRunCreated?: (runId: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: OpenWorldRuntimeCandidateV1 }> {
  const objective = input.objective.trim()
  if (!objective || objective.length > 4_000) fail('objective 无效')
  const skill = getAgentSkillV1(input.skillId)
  const boundary = await captureOpenWorldRuntimeHarnessBoundaryV1({ scope: input.scope, simulationSessionId: input.simulationSessionId })
  if (!input.runAI && !input.aiConfig) fail('缺少 AI 配置')
  const runtimeBindingHash = await hashCanonicalValue({ executionBinding: createAgentSkillExecutionBindingV1(skill), modelIdentity: input.runAI ? { provider: 'test-adapter', model: 'injected', transport: 'chat-v1' } : { provider: input.aiConfig?.provider, model: input.aiConfig?.model, transport: 'chat-v1' } })
  let snapshot = await createAgentRunV1({ scope: input.scope, simulationSessionId: input.simulationSessionId, worldGroupId: boundary.scope.worldGroupId, contract: contract({ objective, boundary, skillId: input.skillId, runtimeBindingHash }) })
  await input.onRunCreated?.(snapshot.run.id)
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: OPEN_WORLD_RUNTIME_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: OPEN_WORLD_RUNTIME_STEP_ID_V1, attempt: 1 })
  try {
    const assembled = await assembleContext({ projectId: input.scope.projectId, scope: input.scope, worldGroupId: boundary.scope.worldGroupId, simulationSessionId: input.simulationSessionId, sourceKeys: ['openWorldRuntime'], provider: input.aiConfig?.provider, model: input.aiConfig?.model, inputBudgetMaxTokens: 16_000 })
    if (!assembled.included.includes('openWorldRuntime')) fail('开放世界运行时上下文为空')
    await assertOpenWorldRuntimeHarnessFreshV1({ scope: input.scope, contractScope: snapshot.contract.scope })
    const contextManifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: OPEN_WORLD_RUNTIME_STEP_ID_V1, attempt: 1, projectId: input.scope.projectId, worldGroupId: boundary.scope.worldGroupId, declaredSourceKeys: ['openWorldRuntime'], assembled, readerVersion: 'text-open-world-player-view-v1' })
    snapshot = await append(input.scope, snapshot, 'context.assembled', { stepId: OPEN_WORLD_RUNTIME_STEP_ID_V1, attempt: 1, manifestHash: contextManifest.manifestHash })
    const prompt = messages(input.skillId, objective, assembled.text)
    snapshot = await append(input.scope, snapshot, 'model.requested', { stepId: OPEN_WORLD_RUNTIME_STEP_ID_V1, attempt: 1, bindingHash: await hashCanonicalValue({ runtimeBindingHash, manifestHash: contextManifest.manifestHash, messages: prompt }) })
    const output = input.runAI ? await input.runAI(prompt, input.signal) : await chat(prompt, input.aiConfig!, { category: `runtime.${input.skillId}`, projectId: input.scope.projectId, contextOverflowPolicy: 'reject' }, input.signal)
    snapshot = await append(input.scope, snapshot, 'model.responded', { stepId: OPEN_WORLD_RUNTIME_STEP_ID_V1, attempt: 1, outputHash: await hashCanonicalValue(output) })
    const draft = parseDraft(input.skillId, output)
    const [state, events, session] = await Promise.all([readSimulationState(input.simulationSessionId), db.simulationEvents.where('sessionId').equals(input.simulationSessionId).toArray(), db.simulationSessions.get(input.simulationSessionId)])
    if (!state.openWorld || !session || session.worldId == null || session.workId == null) fail('模型返回时开放世界实例已失效')
    const playable = await verifyPlayableSessionPackageV2({
      scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId }, session,
    })
    if (playable.runtimeSourceHash !== session.runtimeSourceHash
      || playable.runtimePackage.productType !== 'text-open-world'
      || !playable.runtimePackage.openWorld) fail('模型返回时开放世界冻结运行源已失效')
    validateOpenWorldExpressionCandidate({ candidate: draft, state: state.openWorld, content: playable.runtimePackage.openWorld, events })
    const body = { version: 1 as const, portable: false as const, runId: snapshot.run.id, ...boundary.scope.runtime, contextManifestHash: contextManifest.manifestHash, ...draft }
    const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', { stepId: OPEN_WORLD_RUNTIME_STEP_ID_V1, attempt: 1, candidateHash: candidate.candidateHash, requiresConfirmation: false })
    const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, simulationSessionId: input.simulationSessionId, resumePayload: candidate, expectedLastSequence: snapshot.projection.lastSequence })
    return { snapshot: saved.snapshot, candidate }
  } catch (error) {
    const current = await readInstanceAgentRunV1(input.scope, snapshot.run.id)
    if (current.projection.steps[OPEN_WORLD_RUNTIME_STEP_ID_V1]?.status === 'running') snapshot = await append(input.scope, current, 'step.failed', { stepId: OPEN_WORLD_RUNTIME_STEP_ID_V1, attempt: 1, code: input.signal?.aborted ? 'runtime-generation-cancelled' : 'runtime-generation-failed', retryable: false, category: input.signal?.aborted ? 'cancelled' : 'protocol', action: 'fail' })
    if (snapshot.projection.state !== 'failed' && snapshot.projection.state !== 'cancelled') await append(input.scope, snapshot, input.signal?.aborted ? 'run.cancelled' : 'run.failed', input.signal?.aborted ? { reason: 'runtime-generation-cancelled' } : { code: 'runtime-generation-failed', retryable: false })
    throw error
  }
}

function candidateBody(candidate: OpenWorldRuntimeCandidateV1) { const { candidateHash: _candidateHash, ...body } = candidate; return body }
function isCandidate(value: unknown): value is OpenWorldRuntimeCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<OpenWorldRuntimeCandidateV1>
  return row.version === 1 && row.portable === false && typeof row.runId === 'number' && typeof row.simulationSessionId === 'number'
    && typeof row.baseSequence === 'number' && typeof row.stateHash === 'string' && typeof row.visibilityHash === 'string'
    && typeof row.releaseHash === 'string' && typeof row.contextManifestHash === 'string' && typeof row.candidateHash === 'string'
    && (row.kind === 'quest-expression' || row.kind === 'scene-narration')
}

export async function adoptOpenWorldRuntimeCandidateV1(input: { scope: WorkspaceScope; runId: number }): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; candidate: OpenWorldRuntimeCandidateV1 }> {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId, { owner: 'instance' })
  if (!saved || !isCandidate(saved.resumePayload)) fail('运行缺少可恢复候选')
  let { snapshot } = saved; const candidate = saved.resumePayload
  if (candidate.runId !== input.runId || await hashCanonicalValue(candidateBody(candidate)) !== candidate.candidateHash) fail('候选哈希或运行绑定不匹配')
  const adopted = snapshot.events.find(event => event.type === 'runtime.candidate.adopted')
  if (adopted?.type === 'runtime.candidate.adopted' && snapshot.projection.state === 'completed') return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash ?? fail('已采用运行缺少终验回执') }
  try { await assertOpenWorldRuntimeHarnessFreshV1({ scope: input.scope, contractScope: snapshot.contract.scope }) }
  catch (error) {
    snapshot = await append(input.scope, snapshot, 'candidate.staled', { stepId: OPEN_WORLD_RUNTIME_STEP_ID_V1, candidateHash: candidate.candidateHash, reason: error instanceof Error ? error.message.slice(0, 1_000) : 'runtime-input-stale' })
    throw Object.assign(error instanceof Error ? error : new Error('运行时候选已过期'), { snapshot })
  }
  const [state, events, version, session] = await Promise.all([readSimulationState(candidate.simulationSessionId), db.simulationEvents.where('sessionId').equals(candidate.simulationSessionId).toArray(), readSimulationStateVersion(candidate.simulationSessionId), db.simulationSessions.get(candidate.simulationSessionId)])
  if (!state.openWorld || !session || session.worldId == null || session.workId == null) fail('开放世界实例已失效')
  const playable = await verifyPlayableSessionPackageV2({
    scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId }, session,
  })
  if (playable.runtimeSourceHash !== session.runtimeSourceHash
    || playable.runtimePackage.productType !== 'text-open-world'
    || !playable.runtimePackage.openWorld) fail('开放世界冻结运行源已失效')
  validateOpenWorldExpressionCandidate({ candidate, state: state.openWorld, content: playable.runtimePackage.openWorld, events })
  const adoptionHash = await hashCanonicalValue({ candidateHash: candidate.candidateHash, resultingSequence: version.sequence, resultingStateHash: version.stateHash, writeTargets: [] })
  snapshot = await appendRuntimeCandidateAdoptedV1({ scope: input.scope, runId: snapshot.run.id, expectedLastSequence: snapshot.projection.lastSequence, payload: { stepId: OPEN_WORLD_RUNTIME_STEP_ID_V1, candidateHash: candidate.candidateHash, adoptionHash, commandIds: [], baseSequence: candidate.baseSequence, resultingSequence: version.sequence } })
  snapshot = await append(input.scope, snapshot, 'step.succeeded', { stepId: OPEN_WORLD_RUNTIME_STEP_ID_V1, attempt: 1, outputHash: adoptionHash })
  snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: OPEN_WORLD_RUNTIME_VERIFIER_SET_V1 })
  const receipt = await createVerificationReceiptV1({ version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation, contractHash: snapshot.run.contractHash, contextManifestHashes: [candidate.contextManifestHash], candidateHashes: [candidate.candidateHash], adoptionEventIds: [], postStateHash: version.stateHash, verifierSetVersion: OPEN_WORLD_RUNTIME_VERIFIER_SET_V1, criteria: [{ id: 'runtime.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] }, { id: 'runtime.freshness', status: 'passed', evidenceRefs: [`base:${candidate.baseSequence}:${candidate.stateHash}`] }, { id: 'runtime.read-only', status: 'passed', evidenceRefs: [`post-state:${version.stateHash}`] }], acceptedAt: Date.now() })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, receiptHash: receipt.receiptHash, candidate }
}

export async function cancelOpenWorldRuntimeRunV1(input: { scope: WorkspaceScope; runId: number; reason?: string }) {
  const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  if (['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) return snapshot
  return append(input.scope, snapshot, 'run.cancelled', { reason: input.reason?.trim().slice(0, 1_000) || 'runtime-generation-cancelled' })
}
