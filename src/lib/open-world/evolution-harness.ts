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
import {
  assertOpenWorldEvolutionRuntimeHarnessFreshV1,
  captureOpenWorldEvolutionRuntimeHarnessBoundaryV1,
} from '../agent/run/runtime-scope'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { db } from '../db/schema'
import { assembleContext } from '../registry/assemble-context'
import { readProductRuntimeState, readProductRuntimeStateVersion } from './runtime-api'
import type {
  AIConfig,
  ChatMessage,
  OpenWorldEvolutionPresentationCandidateV1,
  WorkspaceScope,
} from '../types'
import { validateOpenWorldEvolutionPresentationCandidate } from './evolution-runtime'

export const OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1 = 'text-open-world:evolution-runtime-candidate' as const
export const OPEN_WORLD_EVOLUTION_RUNTIME_VERIFIER_SET_V1 = 'text-open-world-evolution-runtime-terminal-v1' as const

export type OpenWorldEvolutionRuntimeSkillIdV1 = Extract<AgentSkillId,
  | 'prose.open-world-turn-briefing'
  | 'prose.open-world-advisor-performance'
  | 'prose.open-world-outcome-narrator'
  | 'prose.open-world-actor-action-suggestion'
>

interface CandidateBaseV1 {
  version: 1
  portable: false
  runId: number
  productRuntimeSessionId: number
  baseSequence: number
  stateHash: string
  visibilityHash: string
  releaseHash: string
  contextManifestHash: string
  candidateHash: string
}

export type OpenWorldEvolutionRuntimeCandidateV1 = CandidateBaseV1
  & OpenWorldEvolutionPresentationCandidateV1

type RunAI = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>

function fail(message: string): never { throw new Error(`[text-open-world-evolution-harness] ${message}`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    fail(`${label}字段不在允许闭集`)
  }
}
function parseJson(output: string): Record<string, unknown> {
  let source = output.trim()
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenced) source = fenced[1]
  try { return record(JSON.parse(source), '模型输出') }
  catch (error) { if (error instanceof SyntaxError) fail('模型输出不是有效 JSON'); throw error }
}

const KIND_BY_SKILL: Record<OpenWorldEvolutionRuntimeSkillIdV1, OpenWorldEvolutionPresentationCandidateV1['kind']> = {
  'prose.open-world-turn-briefing': 'turn-briefing',
  'prose.open-world-advisor-performance': 'advisor-performance',
  'prose.open-world-outcome-narrator': 'outcome-narration',
  'prose.open-world-actor-action-suggestion': 'actor-action-suggestion',
}

function messages(skillId: OpenWorldEvolutionRuntimeSkillIdV1, objective: string, context: string): ChatMessage[] {
  return [{
    role: 'system',
    content: [
      '你是 StoryForge 文字开放世界产品内部的开放世界状态演化表现候选生成器。该模拟能力不是独立产品。',
      '只能依据玩家可见状态和正式产品运行事件证据写报告、建议或表演；不得改变确定性结算，不得声称看到私有或调试报告。',
      `kind 必须为 ${KIND_BY_SKILL[skillId]}。`,
      '只输出严格 JSON，不要 Markdown、解释或额外字段：{"kind":"...","text":"...","evidenceEventSequences":[1],"assertedFacts":[{"source":"resource","key":"funds","value":120}]}',
    ].join('\n'),
  }, { role: 'user', content: `【目标】${objective.trim()}\n\n${context}` }]
}

function parseDraft(
  skillId: OpenWorldEvolutionRuntimeSkillIdV1,
  output: string,
): OpenWorldEvolutionPresentationCandidateV1 {
  const source = parseJson(output)
  exact(source, ['kind', 'text', 'evidenceEventSequences', 'assertedFacts'], '表现候选')
  if (source.kind !== KIND_BY_SKILL[skillId] || typeof source.text !== 'string'
    || !source.text.trim() || source.text.trim().length > 20_000
    || !Array.isArray(source.evidenceEventSequences) || !source.evidenceEventSequences.length
    || source.evidenceEventSequences.length > 128 || !Array.isArray(source.assertedFacts)
    || source.assertedFacts.length > 128) fail('表现候选结构无效')
  const evidenceEventSequences = source.evidenceEventSequences.map((value, index) => {
    if (!Number.isInteger(value) || Number(value) < 1) fail(`证据序号 ${index} 无效`)
    return Number(value)
  })
  if (new Set(evidenceEventSequences).size !== evidenceEventSequences.length) fail('证据序号不得重复')
  const assertedFacts = source.assertedFacts.map((value, index) => {
    const fact = record(value, `事实 ${index}`)
    exact(fact, ['source', 'key', 'value'], `事实 ${index}`)
    if (!['resource', 'metric', 'issue-stage', 'ending'].includes(String(fact.source))
      || typeof fact.key !== 'string' || !fact.key.trim()
      || (fact.value !== null && !['string', 'number'].includes(typeof fact.value))) fail(`事实 ${index} 无效`)
    return {
      source: fact.source as OpenWorldEvolutionPresentationCandidateV1['assertedFacts'][number]['source'],
      key: fact.key.trim(),
      value: fact.value as string | number | null,
    }
  })
  return {
    kind: source.kind,
    text: source.text.trim(),
    evidenceEventSequences,
    assertedFacts,
  } as OpenWorldEvolutionPresentationCandidateV1
}

function contract(input: {
  objective: string
  boundary: Awaited<ReturnType<typeof captureOpenWorldEvolutionRuntimeHarnessBoundaryV1>>
  skillId: OpenWorldEvolutionRuntimeSkillIdV1
  runtimeBindingHash: string
}) {
  const skill = getAgentSkillV1(input.skillId)
  return {
    version: 1 as const,
    objective: input.objective,
    workflowKind: 'direct-generation' as const,
    scope: input.boundary.scope,
    permissions: { contextSourceKeys: ['textOpenWorldEvolutionRuntime'], writeTargets: [] },
    runtimeBindingHash: input.runtimeBindingHash,
    executionBindings: [{ stepId: OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 16_000, maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1 },
    acceptance: [
      { id: 'runtime.candidate', kind: 'output-present' as const, required: true },
      { id: 'runtime.freshness', kind: 'deterministic-check' as const, required: true },
      { id: 'runtime.read-only', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'runtime.terminal', kind: 'terminal' as const,
      verifier: OPEN_WORLD_EVOLUTION_RUNTIME_VERIFIER_SET_V1,
      criterionIds: ['runtime.candidate', 'runtime.freshness', 'runtime.read-only'],
    }],
    failurePolicy: { onProtocolError: 'fail' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const },
  }
}

async function append(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: unknown,
) {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    productRuntimeSessionId: snapshot.run.productRuntimeSessionId ?? fail('运行时事件缺少 Instance owner'),
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as Parameters<typeof appendAgentRunEventV1>[0])
}

export async function generateOpenWorldEvolutionRuntimeCandidateV1(input: {
  scope: WorkspaceScope
  productRuntimeSessionId: number
  skillId: OpenWorldEvolutionRuntimeSkillIdV1
  objective: string
  aiConfig?: AIConfig
  runAI?: RunAI
  signal?: AbortSignal
  onRunCreated?: (runId: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: OpenWorldEvolutionRuntimeCandidateV1 }> {
  const objective = input.objective.trim()
  if (!objective || objective.length > 4_000) fail('objective 无效')
  const skill = getAgentSkillV1(input.skillId)
  const boundary = await captureOpenWorldEvolutionRuntimeHarnessBoundaryV1({
    scope: input.scope,
    productRuntimeSessionId: input.productRuntimeSessionId,
  })
  if (!input.runAI && !input.aiConfig) fail('缺少 AI 配置')
  const runtimeBindingHash = await hashCanonicalValue({
    executionBinding: createAgentSkillExecutionBindingV1(skill),
    modelIdentity: input.runAI
      ? { provider: 'test-adapter', model: 'injected', transport: 'chat-v1' }
      : { provider: input.aiConfig?.provider, model: input.aiConfig?.model, transport: 'chat-v1' },
  })
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    productRuntimeSessionId: input.productRuntimeSessionId,
    worldGroupId: boundary.scope.worldGroupId,
    contract: contract({ objective, boundary, skillId: input.skillId, runtimeBindingHash }),
  })
  await input.onRunCreated?.(snapshot.run.id)
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1, attempt: 1 })
  try {
    const assembled = await assembleContext({
      projectId: input.scope.projectId,
      scope: input.scope,
      worldGroupId: boundary.scope.worldGroupId,
      productRuntimeSessionId: input.productRuntimeSessionId,
      sourceKeys: ['textOpenWorldEvolutionRuntime'],
      provider: input.aiConfig?.provider,
      model: input.aiConfig?.model,
      inputBudgetMaxTokens: 16_000,
    })
    if (!assembled.included.includes('textOpenWorldEvolutionRuntime')) fail('文字开放世界内部状态演化运行时上下文为空')
    await assertOpenWorldEvolutionRuntimeHarnessFreshV1({ scope: input.scope, contractScope: snapshot.contract.scope })
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId: OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1,
      attempt: 1,
      projectId: input.scope.projectId,
      worldGroupId: boundary.scope.worldGroupId,
      declaredSourceKeys: ['textOpenWorldEvolutionRuntime'],
      assembled,
      readerVersion: 'text-open-world-evolution-context-v1',
    })
    snapshot = await append(input.scope, snapshot, 'context.assembled', {
      stepId: OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1,
      attempt: 1,
      manifestHash: manifest.manifestHash,
    })
    const prompt = messages(input.skillId, objective, assembled.text)
    snapshot = await append(input.scope, snapshot, 'model.requested', {
      stepId: OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1,
      attempt: 1,
      bindingHash: await hashCanonicalValue({ runtimeBindingHash, manifestHash: manifest.manifestHash, messages: prompt }),
    })
    const output = input.runAI
      ? await input.runAI(prompt, input.signal)
      : await chat(prompt, input.aiConfig!, {
          category: `runtime.${input.skillId}`,
          projectId: input.scope.projectId,
          contextOverflowPolicy: 'reject',
        }, input.signal)
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1,
      attempt: 1,
      outputHash: await hashCanonicalValue(output),
    })
    const draft = parseDraft(input.skillId, output)
    const [state, events] = await Promise.all([
      readProductRuntimeState(input.productRuntimeSessionId),
      db.productRuntimeEvents.where('sessionId').equals(input.productRuntimeSessionId).toArray(),
    ])
    if (!state.openWorldEvolution) fail('模型返回时开放世界状态演化实例已失效')
    validateOpenWorldEvolutionPresentationCandidate({ candidate: draft, state: state.openWorldEvolution, events })
    const body = {
      version: 1 as const,
      portable: false as const,
      runId: snapshot.run.id,
      ...boundary.scope.runtime,
      contextManifestHash: manifest.manifestHash,
      ...draft,
    }
    const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
      stepId: OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1,
      attempt: 1,
      candidateHash: candidate.candidateHash,
      requiresConfirmation: false,
    })
    const saved = await createAgentRunCheckpointV1({
      scope: input.scope,
      runId: snapshot.run.id,
      productRuntimeSessionId: input.productRuntimeSessionId,
      resumePayload: candidate,
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    return { snapshot: saved.snapshot, candidate }
  } catch (error) {
    const current = await readInstanceAgentRunV1(input.scope, snapshot.run.id)
    if (current.projection.steps[OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1]?.status === 'running') {
      snapshot = await append(input.scope, current, 'step.failed', {
        stepId: OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1,
        attempt: 1,
        code: input.signal?.aborted ? 'runtime-generation-cancelled' : 'runtime-generation-failed',
        retryable: false,
        category: input.signal?.aborted ? 'cancelled' : 'protocol',
        action: 'fail',
      })
    }
    if (snapshot.projection.state !== 'failed' && snapshot.projection.state !== 'cancelled') {
      await append(input.scope, snapshot, input.signal?.aborted ? 'run.cancelled' : 'run.failed',
        input.signal?.aborted ? { reason: 'runtime-generation-cancelled' } : { code: 'runtime-generation-failed', retryable: false })
    }
    throw error
  }
}

function candidateBody(candidate: OpenWorldEvolutionRuntimeCandidateV1) {
  const { candidateHash: _candidateHash, ...body } = candidate
  return body
}

function isCandidate(value: unknown): value is OpenWorldEvolutionRuntimeCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<OpenWorldEvolutionRuntimeCandidateV1>
  return row.version === 1 && row.portable === false && typeof row.runId === 'number'
    && typeof row.productRuntimeSessionId === 'number' && typeof row.baseSequence === 'number'
    && typeof row.stateHash === 'string' && typeof row.visibilityHash === 'string'
    && typeof row.releaseHash === 'string' && typeof row.contextManifestHash === 'string'
    && typeof row.candidateHash === 'string'
    && ['turn-briefing', 'advisor-performance', 'outcome-narration', 'actor-action-suggestion'].includes(String(row.kind))
}

export async function adoptOpenWorldEvolutionRuntimeCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<{
  snapshot: AgentRunSnapshotV1
  receiptHash: string
  candidate: OpenWorldEvolutionRuntimeCandidateV1
}> {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId, { owner: 'instance' })
  if (!saved || !isCandidate(saved.resumePayload)) fail('运行缺少可恢复候选')
  let { snapshot } = saved
  const candidate = saved.resumePayload
  if (candidate.runId !== input.runId || await hashCanonicalValue(candidateBody(candidate)) !== candidate.candidateHash) {
    fail('候选哈希或运行绑定不匹配')
  }
  const adopted = snapshot.events.find(event => event.type === 'runtime.candidate.adopted')
  if (adopted?.type === 'runtime.candidate.adopted' && snapshot.projection.state === 'completed') {
    return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash ?? fail('已采用运行缺少终验回执') }
  }
  try {
    await assertOpenWorldEvolutionRuntimeHarnessFreshV1({ scope: input.scope, contractScope: snapshot.contract.scope })
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'candidate.staled', {
      stepId: OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      reason: error instanceof Error ? error.message.slice(0, 1_000) : 'runtime-input-stale',
    })
    throw Object.assign(error instanceof Error ? error : new Error('运行时候选已过期'), { snapshot })
  }
  const [state, events, version] = await Promise.all([
    readProductRuntimeState(candidate.productRuntimeSessionId),
    db.productRuntimeEvents.where('sessionId').equals(candidate.productRuntimeSessionId).toArray(),
    readProductRuntimeStateVersion(candidate.productRuntimeSessionId),
  ])
  if (!state.openWorldEvolution) fail('开放世界状态演化实例已失效')
  validateOpenWorldEvolutionPresentationCandidate({ candidate, state: state.openWorldEvolution, events })
  const adoptionHash = await hashCanonicalValue({
    candidateHash: candidate.candidateHash,
    resultingSequence: version.sequence,
    resultingStateHash: version.stateHash,
    writeTargets: [],
  })
  snapshot = await appendRuntimeCandidateAdoptedV1({
    scope: input.scope,
    runId: snapshot.run.id,
    expectedLastSequence: snapshot.projection.lastSequence,
    payload: {
      stepId: OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash,
      commandIds: [],
      baseSequence: candidate.baseSequence,
      resultingSequence: version.sequence,
    },
  })
  snapshot = await append(input.scope, snapshot, 'step.succeeded', {
    stepId: OPEN_WORLD_EVOLUTION_RUNTIME_STEP_ID_V1,
    attempt: 1,
    outputHash: adoptionHash,
  })
  snapshot = await append(input.scope, snapshot, 'verification.started', {
    verifierSetVersion: OPEN_WORLD_EVOLUTION_RUNTIME_VERIFIER_SET_V1,
  })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash,
    contextManifestHashes: [candidate.contextManifestHash],
    candidateHashes: [candidate.candidateHash],
    adoptionEventIds: [],
    postStateHash: version.stateHash,
    verifierSetVersion: OPEN_WORLD_EVOLUTION_RUNTIME_VERIFIER_SET_V1,
    criteria: [
      { id: 'runtime.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'runtime.freshness', status: 'passed', evidenceRefs: [`base:${candidate.baseSequence}:${candidate.stateHash}`] },
      { id: 'runtime.read-only', status: 'passed', evidenceRefs: [`post-state:${version.stateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, receiptHash: receipt.receiptHash, candidate }
}

export async function cancelOpenWorldEvolutionRuntimeRunV1(input: {
  scope: WorkspaceScope
  runId: number
  reason?: string
}) {
  const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  if (['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) return snapshot
  return append(input.scope, snapshot, 'run.cancelled', {
    reason: input.reason?.trim().slice(0, 1_000) || 'runtime-generation-cancelled',
  })
}
