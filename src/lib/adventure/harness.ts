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
  assertAdventureRuntimeHarnessFreshV1,
  captureAdventureRuntimeHarnessBoundaryV1,
} from '../agent/run/runtime-scope'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { db } from '../db/schema'
import { assembleContext } from '../registry/assemble-context'
import {
  commitAdventureAction,
  readSimulationState,
  readSimulationStateVersion,
} from '../simulation/runtime'
import type {
  AdventureActionCandidateV1,
  AIConfig,
  ChatMessage,
  SimulationEvent,
  WorkspaceScope,
} from '../types'
import { assertGameReleaseUnchanged, parseAdventureGameReleaseManifest } from '../text-game/releases'
import { availableAdventureActions } from './runtime'

export const ADVENTURE_RUNTIME_STEP_ID_V1 = 'adventure:runtime-candidate' as const
export const ADVENTURE_RUNTIME_VERIFIER_SET_V1 = 'adventure-runtime-terminal-v1' as const

type AdventureRuntimeSkillIdV1 = Extract<AgentSkillId,
  'prose.adventure-intent-parser' | 'prose.adventure-result-narrator'
>

interface AdventureRuntimeCandidateBaseV1 {
  version: 1
  portable: false
  runId: number
  simulationSessionId: number
  baseSequence: number
  stateHash: string
  visibilityHash: string
  releaseHash: string
  contextManifestHash: string
  commandId: string | null
  candidateHash: string
}

export interface AdventureIntentCandidateV1 extends AdventureRuntimeCandidateBaseV1,
  AdventureActionCandidateV1 {
  kind: 'adventure-intent-candidate'
}

export interface AdventureNarrationCandidateV1 extends AdventureRuntimeCandidateBaseV1 {
  kind: 'adventure-narration-candidate'
  narrative: string
  evidenceEventSequences: number[]
}

export type AdventureRuntimeCandidateV1 = AdventureIntentCandidateV1 | AdventureNarrationCandidateV1

type RunAI = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>

function fail(message: string): never { throw new Error(`[adventure-harness] ${message}`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    fail(`${label}字段不在允许闭集`)
  }
}
function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) fail(`${label}无效`)
  return value.trim()
}
function stableKey(value: unknown, label: string): string {
  const result = text(value, label, 160)
  if (!/^[a-zA-Z0-9._:-]+$/.test(result)) fail(`${label}不是稳定 key`)
  return result
}
function parseJson(output: string): Record<string, unknown> {
  let source = output.trim()
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenced) source = fenced[1]
  try { return record(JSON.parse(source), '模型输出') }
  catch (error) { if (error instanceof SyntaxError) fail('模型输出不是有效 JSON'); throw error }
}

function messages(skillId: AdventureRuntimeSkillIdV1, objective: string, context: string): ChatMessage[] {
  const schema = skillId === 'prose.adventure-intent-parser'
    ? '{"kind":"adventure-intent","actionKey":"...","rationale":"...","requiresConfirmation":true}'
    : '{"kind":"adventure-result","narrative":"...","evidenceEventSequences":[1]}'
  return [{
    role: 'system',
    content: [
      '你是 StoryForge 受治理的文字冒险运行时候选生成器。',
      skillId === 'prose.adventure-intent-parser'
        ? '只能把玩家文字映射到上下文中标记为可执行的一个 action key；不得创造行动或结果。'
        : '只能润色最近已发生行动的结果；不得改变判定、物品、资源、任务、地点或 Narrative 状态。',
      `只输出严格 JSON，不要 Markdown、解释或额外字段：${schema}`,
    ].join('\n'),
  }, { role: 'user', content: `【目标】${objective}\n\n${context}` }]
}

function parseDraft(skillId: AdventureRuntimeSkillIdV1, output: string):
  | Omit<AdventureIntentCandidateV1, keyof AdventureRuntimeCandidateBaseV1>
  | Omit<AdventureNarrationCandidateV1, keyof AdventureRuntimeCandidateBaseV1> {
  const row = parseJson(output)
  if (skillId === 'prose.adventure-intent-parser') {
    exact(row, ['kind', 'actionKey', 'rationale', 'requiresConfirmation'], '行动映射')
    if (row.kind !== 'adventure-intent' || typeof row.requiresConfirmation !== 'boolean') fail('行动映射输出无效')
    return {
      kind: 'adventure-intent-candidate',
      actionKey: stableKey(row.actionKey, 'actionKey'),
      rationale: text(row.rationale, '映射理由', 2_000),
      requiresConfirmation: row.requiresConfirmation,
    }
  }
  exact(row, ['kind', 'narrative', 'evidenceEventSequences'], '结果叙述')
  if (row.kind !== 'adventure-result' || !Array.isArray(row.evidenceEventSequences)
    || !row.evidenceEventSequences.length || row.evidenceEventSequences.length > 64) {
    fail('结果叙述输出无效')
  }
  const evidenceEventSequences = row.evidenceEventSequences.map((value, index) => {
    if (!Number.isInteger(value) || Number(value) < 1) fail(`证据序号 ${index} 无效`)
    return Number(value)
  })
  if (new Set(evidenceEventSequences).size !== evidenceEventSequences.length) fail('证据序号不得重复')
  return {
    kind: 'adventure-narration-candidate',
    narrative: text(row.narrative, '结果叙述', 20_000),
    evidenceEventSequences,
  }
}

function contract(input: {
  objective: string
  boundary: Awaited<ReturnType<typeof captureAdventureRuntimeHarnessBoundaryV1>>
  skillId: AdventureRuntimeSkillIdV1
  runtimeBindingHash: string
}) {
  const skill = getAgentSkillV1(input.skillId)
  return {
    version: 1 as const,
    objective: input.objective,
    workflowKind: 'direct-generation' as const,
    scope: input.boundary.scope,
    permissions: { contextSourceKeys: ['adventureRuntime'], writeTargets: [] },
    runtimeBindingHash: input.runtimeBindingHash,
    executionBindings: [{ stepId: ADVENTURE_RUNTIME_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 16_000, maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1 },
    acceptance: [
      { id: 'runtime.candidate', kind: 'output-present' as const, required: true },
      { id: 'runtime.freshness', kind: 'deterministic-check' as const, required: true },
      { id: 'runtime.adoption', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'runtime.terminal', kind: 'terminal' as const,
      verifier: ADVENTURE_RUNTIME_VERIFIER_SET_V1,
      criterionIds: ['runtime.candidate', 'runtime.freshness', 'runtime.adoption'],
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
    scope, runId: snapshot.run.id,
    simulationSessionId: snapshot.run.simulationSessionId ?? fail('运行时事件缺少 Instance owner'),
    type, payload, expectedLastSequence: snapshot.projection.lastSequence,
  } as Parameters<typeof appendAgentRunEventV1>[0])
}

export async function generateAdventureRuntimeCandidateV1(input: {
  scope: WorkspaceScope
  simulationSessionId: number
  skillId: AdventureRuntimeSkillIdV1
  objective: string
  aiConfig?: AIConfig
  runAI?: RunAI
  signal?: AbortSignal
  onRunCreated?: (runId: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: AdventureRuntimeCandidateV1 }> {
  const objective = text(input.objective, 'objective', 4_000)
  const skill = getAgentSkillV1(input.skillId)
  const boundary = await captureAdventureRuntimeHarnessBoundaryV1({
    scope: input.scope, simulationSessionId: input.simulationSessionId,
  })
  if (!input.runAI && !input.aiConfig) fail('缺少 AI 配置')
  const runtimeBindingHash = await hashCanonicalValue({
    executionBinding: createAgentSkillExecutionBindingV1(skill),
    modelIdentity: input.runAI
      ? { provider: 'test-adapter', model: 'injected', transport: 'chat-v1' }
      : { provider: input.aiConfig?.provider, model: input.aiConfig?.model, transport: 'chat-v1' },
  })
  let snapshot = await createAgentRunV1({
    scope: input.scope, simulationSessionId: input.simulationSessionId,
    worldGroupId: boundary.scope.worldGroupId,
    contract: contract({ objective, boundary, skillId: input.skillId, runtimeBindingHash }),
  })
  await input.onRunCreated?.(snapshot.run.id)
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: ADVENTURE_RUNTIME_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: ADVENTURE_RUNTIME_STEP_ID_V1, attempt: 1 })
  try {
    const assembled = await assembleContext({
      projectId: input.scope.projectId, scope: input.scope,
      worldGroupId: boundary.scope.worldGroupId,
      simulationSessionId: input.simulationSessionId,
      sourceKeys: ['adventureRuntime'],
      provider: input.aiConfig?.provider, model: input.aiConfig?.model,
      inputBudgetMaxTokens: 16_000,
    })
    if (!assembled.included.includes('adventureRuntime')) fail('文字冒险运行时上下文为空')
    await assertAdventureRuntimeHarnessFreshV1({ scope: input.scope, contractScope: snapshot.contract.scope })
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id, stepId: ADVENTURE_RUNTIME_STEP_ID_V1, attempt: 1,
      projectId: input.scope.projectId, worldGroupId: boundary.scope.worldGroupId,
      declaredSourceKeys: ['adventureRuntime'], assembled, readerVersion: 'adventure-runtime-view-v1',
    })
    snapshot = await append(input.scope, snapshot, 'context.assembled', {
      stepId: ADVENTURE_RUNTIME_STEP_ID_V1, attempt: 1, manifestHash: manifest.manifestHash,
    })
    const prompt = messages(input.skillId, objective, assembled.text)
    snapshot = await append(input.scope, snapshot, 'model.requested', {
      stepId: ADVENTURE_RUNTIME_STEP_ID_V1, attempt: 1,
      bindingHash: await hashCanonicalValue({ runtimeBindingHash, manifestHash: manifest.manifestHash, messages: prompt }),
    })
    const output = input.runAI
      ? await input.runAI(prompt, input.signal)
      : await chat(prompt, input.aiConfig!, {
          category: `runtime.${input.skillId}`, projectId: input.scope.projectId,
          contextOverflowPolicy: 'reject',
        }, input.signal)
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: ADVENTURE_RUNTIME_STEP_ID_V1, attempt: 1, outputHash: await hashCanonicalValue(output),
    })
    const draft = parseDraft(input.skillId, output)
    const state = await readSimulationState(input.simulationSessionId)
    const release = await db.simulationSessions.get(input.simulationSessionId)
      .then(session => session?.gameReleaseId == null ? null : assertGameReleaseUnchanged(session.gameReleaseId))
    if (!state.adventure || !release) fail('模型返回时文字冒险实例已失效')
    if (draft.kind === 'adventure-intent-candidate') {
      const manifest = parseAdventureGameReleaseManifest(release.manifestJson)
      const available = availableAdventureActions(
        manifest.adventure,
        state.adventure,
        state.narrative?.variables,
      ).some(item => item.action.key === draft.actionKey && item.available)
      if (!available) fail('模型映射了未登记行动')
    } else {
      const events = await db.simulationEvents.where('sessionId').equals(input.simulationSessionId).toArray()
      const evidence = new Map(events.map(event => [event.sequence, event]))
      if (draft.evidenceEventSequences.some(sequence => !evidence.get(sequence)?.type.startsWith('adventure.'))) {
        fail('结果叙述引用了非冒险或不存在事件')
      }
      if (!draft.evidenceEventSequences.some(sequence => evidence.get(sequence)?.type === 'adventure.action.committed')) {
        fail('结果叙述必须引用正式行动提交事件')
      }
    }
    const common = {
      version: 1 as const, portable: false as const, runId: snapshot.run.id,
      ...boundary.scope.runtime, contextManifestHash: manifest.manifestHash,
      commandId: draft.kind === 'adventure-intent-candidate' ? `harness:${snapshot.run.id}:adventure-action` : null,
    }
    const body = { ...common, ...draft }
    const candidate = { ...body, candidateHash: await hashCanonicalValue(body) } as AdventureRuntimeCandidateV1
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
      stepId: ADVENTURE_RUNTIME_STEP_ID_V1, attempt: 1,
      candidateHash: candidate.candidateHash,
      requiresConfirmation: candidate.kind === 'adventure-intent-candidate' && candidate.requiresConfirmation,
    })
    const saved = await createAgentRunCheckpointV1({
      scope: input.scope, runId: snapshot.run.id,
      simulationSessionId: input.simulationSessionId,
      resumePayload: candidate, expectedLastSequence: snapshot.projection.lastSequence,
    })
    return { snapshot: saved.snapshot, candidate }
  } catch (error) {
    const current = await readInstanceAgentRunV1(input.scope, snapshot.run.id)
    if (current.projection.steps[ADVENTURE_RUNTIME_STEP_ID_V1]?.status === 'running') {
      snapshot = await append(input.scope, current, 'step.failed', {
        stepId: ADVENTURE_RUNTIME_STEP_ID_V1, attempt: 1,
        code: input.signal?.aborted ? 'runtime-generation-cancelled' : 'runtime-generation-failed',
        retryable: false, category: input.signal?.aborted ? 'cancelled' : 'protocol', action: 'fail',
      })
    }
    if (snapshot.projection.state !== 'failed' && snapshot.projection.state !== 'cancelled') {
      await append(input.scope, snapshot, input.signal?.aborted ? 'run.cancelled' : 'run.failed',
        input.signal?.aborted ? { reason: 'runtime-generation-cancelled' } : { code: 'runtime-generation-failed', retryable: false })
    }
    throw error
  }
}

function candidateBody(candidate: AdventureRuntimeCandidateV1) {
  const { candidateHash: _candidateHash, ...body } = candidate
  return body
}

function isCandidate(value: unknown): value is AdventureRuntimeCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<AdventureRuntimeCandidateV1>
  return row.version === 1 && row.portable === false && typeof row.runId === 'number'
    && typeof row.simulationSessionId === 'number' && typeof row.baseSequence === 'number'
    && typeof row.stateHash === 'string' && typeof row.visibilityHash === 'string'
    && typeof row.releaseHash === 'string' && typeof row.contextManifestHash === 'string'
    && typeof row.candidateHash === 'string'
    && (row.kind === 'adventure-intent-candidate' || row.kind === 'adventure-narration-candidate')
}

async function readCandidate(scope: WorkspaceScope, runId: number) {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(scope, runId, { owner: 'instance' })
  if (!saved || !isCandidate(saved.resumePayload)) fail('运行缺少可恢复候选')
  const candidate = saved.resumePayload
  if (candidate.runId !== runId || await hashCanonicalValue(candidateBody(candidate)) !== candidate.candidateHash) {
    fail('候选哈希或运行绑定不匹配')
  }
  return { snapshot: saved.snapshot, candidate }
}

export async function adoptAdventureRuntimeCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  onDurableBoundary?: (eventType: string, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; event: SimulationEvent | null; receiptHash: string; candidate: AdventureRuntimeCandidateV1 }> {
  const loaded = await readCandidate(input.scope, input.runId)
  let { snapshot } = loaded
  const { candidate } = loaded
  let adopted = snapshot.events.find(event => event.type === 'runtime.candidate.adopted')
  if (adopted?.type === 'runtime.candidate.adopted' && snapshot.projection.state === 'completed') {
    const event = candidate.commandId == null ? null
      : (await db.simulationEvents.where('sessionId').equals(candidate.simulationSessionId).toArray())
          .find(item => item.commandId === candidate.commandId) ?? null
    return { snapshot, event, candidate, receiptHash: snapshot.projection.terminalReceiptHash ?? fail('已采用运行缺少终验回执') }
  }
  const prior = candidate.commandId == null ? null
    : (await db.simulationEvents.where('sessionId').equals(candidate.simulationSessionId).toArray())
        .find(item => item.commandId === candidate.commandId) ?? null
  if (!adopted && !prior) {
    try {
      await assertAdventureRuntimeHarnessFreshV1({ scope: input.scope, contractScope: snapshot.contract.scope })
    } catch (error) {
      snapshot = await append(input.scope, snapshot, 'candidate.staled', {
        stepId: ADVENTURE_RUNTIME_STEP_ID_V1, candidateHash: candidate.candidateHash,
        reason: error instanceof Error ? error.message.slice(0, 1_000) : 'runtime-input-stale',
      })
      throw Object.assign(error instanceof Error ? error : new Error('运行时候选已过期'), { snapshot })
    }
  }
  const event = prior ?? (candidate.kind === 'adventure-intent-candidate'
    ? await commitAdventureAction({
        sessionId: candidate.simulationSessionId, commandId: candidate.commandId!,
        baseSequence: candidate.baseSequence, baseStateHash: candidate.stateHash,
        actionKey: candidate.actionKey,
      })
    : null)
  let version = await readSimulationStateVersion(candidate.simulationSessionId)
  if (!adopted) {
    const adoptionHash = await hashCanonicalValue({
      candidateHash: candidate.candidateHash, commandId: candidate.commandId,
      eventId: event?.id ?? null, resultingSequence: version.sequence,
      resultingStateHash: version.stateHash,
    })
    snapshot = await appendRuntimeCandidateAdoptedV1({
      scope: input.scope, runId: snapshot.run.id,
      expectedLastSequence: snapshot.projection.lastSequence,
      payload: {
        stepId: ADVENTURE_RUNTIME_STEP_ID_V1, candidateHash: candidate.candidateHash,
        adoptionHash, commandIds: candidate.commandId == null ? [] : [candidate.commandId],
        baseSequence: candidate.baseSequence, resultingSequence: version.sequence,
      },
    })
    const persistedAdoption = snapshot.events[snapshot.events.length - 1]
    if (persistedAdoption?.type !== 'runtime.candidate.adopted') fail('采用事件持久化失败')
    adopted = persistedAdoption
    await input.onDurableBoundary?.('runtime.candidate.adopted', snapshot)
  }
  if (adopted?.type !== 'runtime.candidate.adopted') fail('采用事件缺失')
  if (!snapshot.events.some(item => item.type === 'step.succeeded' && item.payload.stepId === ADVENTURE_RUNTIME_STEP_ID_V1)) {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: ADVENTURE_RUNTIME_STEP_ID_V1, attempt: 1, outputHash: adopted.payload.adoptionHash,
    })
  }
  if (!snapshot.events.some(item => item.type === 'verification.started')) {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: ADVENTURE_RUNTIME_VERIFIER_SET_V1,
    })
  }
  version = await readSimulationStateVersion(candidate.simulationSessionId)
  if (version.sequence !== adopted.payload.resultingSequence) fail('采用后 SIM 状态已继续推进，拒绝签发过期回执')
  const receipt = await createVerificationReceiptV1({
    version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash,
    contextManifestHashes: [candidate.contextManifestHash], candidateHashes: [candidate.candidateHash],
    adoptionEventIds: event?.id == null ? [] : [event.id], postStateHash: version.stateHash,
    verifierSetVersion: ADVENTURE_RUNTIME_VERIFIER_SET_V1,
    criteria: [
      { id: 'runtime.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'runtime.freshness', status: 'passed', evidenceRefs: [`base:${candidate.baseSequence}:${candidate.stateHash}`] },
      { id: 'runtime.adoption', status: 'passed', evidenceRefs: [`post-state:${version.stateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, event, receiptHash: receipt.receiptHash, candidate }
}

export async function cancelAdventureRuntimeRunV1(input: {
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
