import { chat } from '../ai/client'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
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
  assertAiTownDirectorRuntimeHarnessFreshV1,
  captureAiTownDirectorRuntimeHarnessBoundaryV1,
} from '../agent/run/runtime-scope'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { db } from '../db/schema'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { assembleContext } from '../registry/assemble-context'
import type {
  AIConfig,
  AiTownMajorChangeKindV1,
  ChatMessage,
  ProductRuntimeEvent,
  WorkspaceScope,
} from '../types'
import { readProductRuntimeState, readProductRuntimeStateVersion } from './runtime-api'
import { proposeAiTownMajorChangeV1, resolveAiTownEventSeedV1 } from './runtime-commands'
import { aiTownMajorChangeEligibilityV1, availableAiTownEventSeedsV1 } from './runtime'

export const AI_TOWN_DIRECTOR_STEP_ID_V1 = 'ai-town:director-candidate' as const
export const AI_TOWN_DIRECTOR_VERIFIER_SET_V1 = 'ai-town-director-terminal-v1' as const

interface AiTownDirectorCandidateBaseV1 {
  version: 1
  portable: false
  runId: number
  productRuntimeSessionId: number
  baseSequence: number
  stateHash: string
  visibilityHash: string
  releaseHash: string
  contextManifestHash: string
  commandId: string
  candidateHash: string
  rationale: string
  summary: string
}

export interface AiTownDirectorEventCandidateV1 extends AiTownDirectorCandidateBaseV1 {
  kind: 'ai-town-director-event-candidate'
  seedKey: string
}

export interface AiTownDirectorMajorChangeCandidateV1 extends AiTownDirectorCandidateBaseV1 {
  kind: 'ai-town-director-major-change-candidate'
  majorChange: {
    kind: AiTownMajorChangeKindV1
    title: string
    residentKeys: string[]
  }
}

export type AiTownDirectorCandidateV1 = AiTownDirectorEventCandidateV1 | AiTownDirectorMajorChangeCandidateV1

type RunAI = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>

function fail(message: string): never { throw new Error(`[ai-town-director] ${message}`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const keys = Object.keys(value)
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) fail(`${label}字段不在允许闭集`)
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
function stableKeys(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 8) fail(`${label}必须是有界数组`)
  const result = value.map((item, index) => stableKey(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) fail(`${label}不得重复`)
  return result
}
function parseJson(output: string): Record<string, unknown> {
  let source = output.trim()
  // Some otherwise schema-compliant OpenAI-compatible providers wrap their
  // single JSON root in a json code fence. Treat that wrapper as transport
  // noise only when it encloses the entire response; explanatory prose,
  // multiple roots and partially fenced output still fail closed below.
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenced) source = fenced[1]
  try { return record(JSON.parse(source), '模型输出') }
  catch (error) { if (error instanceof SyntaxError) fail('模型输出不是有效 JSON'); throw error }
}

type DirectorDraft =
  | { kind: 'ai-town-director-event-candidate'; seedKey: string; summary: string; rationale: string }
  | { kind: 'ai-town-director-major-change-candidate'; majorChange: AiTownDirectorMajorChangeCandidateV1['majorChange']; summary: string; rationale: string }

function parseDraft(output: string): DirectorDraft {
  const row = parseJson(output)
  exact(row, ['kind', 'decision', 'seedKey', 'majorChange', 'summary', 'rationale'], '小镇导演输出')
  if (row.kind !== 'ai-town-director') fail('kind 无效')
  const summary = text(row.summary, 'summary', 4_000)
  const rationale = text(row.rationale, 'rationale', 2_000)
  if (row.decision === 'event') {
    if (row.majorChange !== null) fail('事件决策不得携带重大变化')
    return { kind: 'ai-town-director-event-candidate', seedKey: stableKey(row.seedKey, 'seedKey'), summary, rationale }
  }
  if (row.decision !== 'major-change' || row.seedKey !== null) fail('decision 无效')
  const major = record(row.majorChange, 'majorChange')
  exact(major, ['kind', 'title', 'residentKeys'], 'majorChange')
  return {
    kind: 'ai-town-director-major-change-candidate',
    majorChange: {
      kind: stableKey(major.kind, 'majorChange.kind') as AiTownMajorChangeKindV1,
      title: text(major.title, 'majorChange.title', 200),
      residentKeys: stableKeys(major.residentKeys, 'majorChange.residentKeys'),
    },
    summary,
    rationale,
  }
}

function modelMessages(objective: string, context: string): ChatMessage[] {
  return [{
    role: 'system',
    content: [
      '你是 StoryForge 受治理的后日谈 AI 小镇导演。',
      '优先从上下文中标记为“可触发”的事件 seed 选择一个，让居民的日常、关系和生活线自然生长。',
      '只有当前事件闭集无法表达且确有长期结构性必要时，才能提出重大变化候选；候选不会自动生效。',
      '不得创造新地点、新角色、新世界事实或未授权的剧烈转折，不得泄露任何私密信息。',
      '只输出严格 JSON，不要 Markdown、解释或额外字段。',
      '事件格式：{"kind":"ai-town-director","decision":"event","seedKey":"...","majorChange":null,"summary":"...","rationale":"..."}',
      '重大变化格式：{"kind":"ai-town-director","decision":"major-change","seedKey":null,"majorChange":{"kind":"...","title":"...","residentKeys":["..."]},"summary":"...","rationale":"..."}',
    ].join('\n'),
  }, { role: 'user', content: `【目标】${objective}\n\n${context}` }]
}

function contract(input: {
  objective: string
  boundary: Awaited<ReturnType<typeof captureAiTownDirectorRuntimeHarnessBoundaryV1>>
  runtimeBindingHash: string
}) {
  const skill = getAgentSkillV1('prose.ai-town-director')
  return {
    version: 1 as const,
    objective: input.objective,
    workflowKind: 'direct-generation' as const,
    scope: input.boundary.scope,
    permissions: { contextSourceKeys: ['aiTownDirectorRuntime'], writeTargets: [] },
    runtimeBindingHash: input.runtimeBindingHash,
    executionBindings: [{ stepId: AI_TOWN_DIRECTOR_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 20_000, maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1 },
    acceptance: [
      { id: 'runtime.candidate', kind: 'output-present' as const, required: true },
      { id: 'runtime.freshness', kind: 'deterministic-check' as const, required: true },
      { id: 'runtime.adoption', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'runtime.terminal', kind: 'terminal' as const,
      verifier: AI_TOWN_DIRECTOR_VERIFIER_SET_V1,
      criterionIds: ['runtime.candidate', 'runtime.freshness', 'runtime.adoption'],
    }],
    failurePolicy: { onProtocolError: 'fail' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const },
  }
}

async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    productRuntimeSessionId: snapshot.run.productRuntimeSessionId ?? fail('导演运行缺少 Instance owner'),
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as Parameters<typeof appendAgentRunEventV1>[0])
}

async function verifiedTown(input: { scope: WorkspaceScope; productRuntimeSessionId: number }) {
  const session = await db.productRuntimeSessions.get(input.productRuntimeSessionId)
  if (!session || session.kind !== 'ai-town' || session.worldId == null || session.workId == null) fail('AI 小镇实例已失效')
  const verified = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session })
  if (verified.runtimePackage.productType !== 'ai-town' || !verified.runtimePackage.town
    || verified.runtimeSourceHash !== session.runtimeSourceHash) fail('AI 小镇冻结运行源已失效')
  const state = await readProductRuntimeState(input.productRuntimeSessionId)
  if (!state.town) fail('AI 小镇状态已失效')
  return { session, state, town: state.town }
}

export async function generateAiTownDirectorCandidateV1(input: {
  scope: WorkspaceScope
  productRuntimeSessionId: number
  objective?: string
  aiConfig?: AIConfig
  runAI?: RunAI
  signal?: AbortSignal
  onRunCreated?: (runId: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: AiTownDirectorCandidateV1 }> {
  const objective = text(input.objective?.trim() || '在不破坏日常节奏的前提下，让当前小镇自然向前发展一步。', 'objective', 4_000)
  const skill = getAgentSkillV1('prose.ai-town-director')
  const boundary = await captureAiTownDirectorRuntimeHarnessBoundaryV1(input)
  const initial = await verifiedTown(input)
  const hasAvailableEvent = availableAiTownEventSeedsV1(initial.town.content, initial.town)
    .some(item => item.available)
  if (!hasAvailableEvent && !aiTownMajorChangeEligibilityV1(initial.town).eligible) {
    fail('当前没有可触发事件，重大变化提案门槛也尚未满足')
  }
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
    contract: contract({ objective, boundary, runtimeBindingHash }),
  })
  await input.onRunCreated?.(snapshot.run.id)
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: AI_TOWN_DIRECTOR_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: AI_TOWN_DIRECTOR_STEP_ID_V1, attempt: 1 })
  try {
    const assembled = await assembleContext({
      projectId: input.scope.projectId,
      scope: input.scope,
      worldGroupId: boundary.scope.worldGroupId,
      productRuntimeSessionId: input.productRuntimeSessionId,
      sourceKeys: ['aiTownDirectorRuntime'],
      provider: input.aiConfig?.provider,
      model: input.aiConfig?.model,
      inputBudgetMaxTokens: 20_000,
    })
    if (!assembled.included.includes('aiTownDirectorRuntime')) fail('AI 小镇导演上下文为空')
    await assertAiTownDirectorRuntimeHarnessFreshV1({ scope: input.scope, contractScope: snapshot.contract.scope })
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId: AI_TOWN_DIRECTOR_STEP_ID_V1,
      attempt: 1,
      projectId: input.scope.projectId,
      worldGroupId: boundary.scope.worldGroupId,
      declaredSourceKeys: ['aiTownDirectorRuntime'],
      assembled,
      readerVersion: 'ai-town-director-runtime-view-v1',
    })
    snapshot = await append(input.scope, snapshot, 'context.assembled', {
      stepId: AI_TOWN_DIRECTOR_STEP_ID_V1,
      attempt: 1,
      manifestHash: manifest.manifestHash,
    })
    const prompt = modelMessages(objective, assembled.text)
    snapshot = await append(input.scope, snapshot, 'model.requested', {
      stepId: AI_TOWN_DIRECTOR_STEP_ID_V1,
      attempt: 1,
      bindingHash: await hashCanonicalValue({ runtimeBindingHash, manifestHash: manifest.manifestHash, messages: prompt }),
    })
    const output = input.runAI
      ? await input.runAI(prompt, input.signal)
      : await chat(prompt, input.aiConfig!, {
          category: 'runtime.prose.ai-town-director',
          projectId: input.scope.projectId,
          contextOverflowPolicy: 'reject',
        }, input.signal)
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: AI_TOWN_DIRECTOR_STEP_ID_V1,
      attempt: 1,
      outputHash: await hashCanonicalValue(output),
    })
    const draft = parseDraft(output)
    const verified = await verifiedTown(input)
    if (draft.kind === 'ai-town-director-event-candidate') {
      const available = availableAiTownEventSeedsV1(verified.town.content, verified.town)
        .some(item => item.seed.key === draft.seedKey && item.available)
      if (!available) fail('模型选择了不存在或当前不可触发的事件')
    } else {
      const eligibility = aiTownMajorChangeEligibilityV1(verified.town)
      if (!eligibility.eligible) fail(eligibility.reason ?? '重大变化尚未达到提案门槛')
      if (!verified.town.content.safety.majorChangeKinds.includes(draft.majorChange.kind)) fail('重大变化类型未获 Brief 授权')
      if (draft.majorChange.residentKeys.some(key => !verified.town.residents[key]
        || verified.town.residents[key].residencyStatus !== 'resident')) fail('重大变化居民范围无效')
    }
    const common = {
      version: 1 as const,
      portable: false as const,
      runId: snapshot.run.id,
      ...boundary.scope.runtime,
      contextManifestHash: manifest.manifestHash,
      commandId: `harness:${snapshot.run.id}:ai-town-director`,
    }
    const body = { ...common, ...draft }
    const candidate = { ...body, candidateHash: await hashCanonicalValue(body) } as AiTownDirectorCandidateV1
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
      stepId: AI_TOWN_DIRECTOR_STEP_ID_V1,
      attempt: 1,
      candidateHash: candidate.candidateHash,
      requiresConfirmation: candidate.kind === 'ai-town-director-major-change-candidate',
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
    if (current.projection.steps[AI_TOWN_DIRECTOR_STEP_ID_V1]?.status === 'running') {
      snapshot = await append(input.scope, current, 'step.failed', {
        stepId: AI_TOWN_DIRECTOR_STEP_ID_V1,
        attempt: 1,
        code: input.signal?.aborted ? 'ai-town-director-cancelled' : 'ai-town-director-failed',
        retryable: false,
        category: input.signal?.aborted ? 'cancelled' : 'protocol',
        action: 'fail',
      })
    }
    if (snapshot.projection.state !== 'failed' && snapshot.projection.state !== 'cancelled') {
      await append(input.scope, snapshot, input.signal?.aborted ? 'run.cancelled' : 'run.failed', input.signal?.aborted
        ? { reason: 'ai-town-director-cancelled' }
        : { code: 'ai-town-director-failed', retryable: false })
    }
    throw error
  }
}

function candidateBody(candidate: AiTownDirectorCandidateV1) {
  const { candidateHash: _candidateHash, ...body } = candidate
  return body
}

function isCandidate(value: unknown): value is AiTownDirectorCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<AiTownDirectorCandidateV1>
  return row.version === 1 && row.portable === false && typeof row.runId === 'number'
    && typeof row.productRuntimeSessionId === 'number' && typeof row.baseSequence === 'number'
    && typeof row.stateHash === 'string' && typeof row.visibilityHash === 'string'
    && typeof row.releaseHash === 'string' && typeof row.contextManifestHash === 'string'
    && typeof row.commandId === 'string' && typeof row.candidateHash === 'string'
    && (row.kind === 'ai-town-director-event-candidate' || row.kind === 'ai-town-director-major-change-candidate')
}

async function readCandidate(scope: WorkspaceScope, runId: number) {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(scope, runId, { owner: 'instance' })
  if (!saved || !isCandidate(saved.resumePayload)) fail('运行缺少可恢复小镇导演候选')
  const candidate = saved.resumePayload
  if (candidate.runId !== runId || await hashCanonicalValue(candidateBody(candidate)) !== candidate.candidateHash) fail('候选哈希或运行绑定不匹配')
  return { snapshot: saved.snapshot, candidate }
}

export async function adoptAiTownDirectorCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  onDurableBoundary?: (eventType: string, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; event: ProductRuntimeEvent; receiptHash: string; candidate: AiTownDirectorCandidateV1 }> {
  const loaded = await readCandidate(input.scope, input.runId)
  let { snapshot } = loaded
  const { candidate } = loaded
  let adopted = snapshot.events.find(event => event.type === 'runtime.candidate.adopted')
  if (adopted?.type === 'runtime.candidate.adopted' && snapshot.projection.state === 'completed') {
    const event = (await db.productRuntimeEvents.where('sessionId').equals(candidate.productRuntimeSessionId).toArray())
      .find(item => item.commandId === candidate.commandId) ?? fail('已采用导演候选缺少运行事件')
    return { snapshot, event, candidate, receiptHash: snapshot.projection.terminalReceiptHash ?? fail('已采用运行缺少终验回执') }
  }
  const prior = (await db.productRuntimeEvents.where('sessionId').equals(candidate.productRuntimeSessionId).toArray())
    .find(item => item.commandId === candidate.commandId) ?? null
  if (!adopted && !prior) {
    try { await assertAiTownDirectorRuntimeHarnessFreshV1({ scope: input.scope, contractScope: snapshot.contract.scope }) }
    catch (error) {
      snapshot = await append(input.scope, snapshot, 'candidate.staled', {
        stepId: AI_TOWN_DIRECTOR_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: error instanceof Error ? error.message.slice(0, 1_000) : 'runtime-input-stale',
      })
      throw Object.assign(error instanceof Error ? error : new Error('小镇导演候选已过期'), { snapshot })
    }
  }
  const event = prior ?? (candidate.kind === 'ai-town-director-event-candidate'
    ? await resolveAiTownEventSeedV1({
        sessionId: candidate.productRuntimeSessionId,
        commandId: candidate.commandId,
        baseSequence: candidate.baseSequence,
        baseStateHash: candidate.stateHash,
        seedKey: candidate.seedKey,
      })
    : await proposeAiTownMajorChangeV1({
        sessionId: candidate.productRuntimeSessionId,
        commandId: candidate.commandId,
        baseSequence: candidate.baseSequence,
        baseStateHash: candidate.stateHash,
        candidateKey: `town.major.harness.${candidate.runId}`,
        kind: candidate.majorChange.kind,
        title: candidate.majorChange.title,
        summary: candidate.summary,
        residentKeys: candidate.majorChange.residentKeys,
      }))
  let version = await readProductRuntimeStateVersion(candidate.productRuntimeSessionId)
  if (adopted?.type === 'runtime.candidate.adopted') {
    if (adopted.payload.candidateHash !== candidate.candidateHash
      || adopted.payload.baseSequence !== candidate.baseSequence
      || adopted.payload.resultingSequence !== version.sequence
      || adopted.payload.commandIds.join('\u0000') !== candidate.commandId) {
      fail('已采用导演候选的 SIM 终态或运行绑定已变化')
    }
    const expectedAdoptionHash = await hashCanonicalValue({
      candidateHash: candidate.candidateHash,
      commandId: candidate.commandId,
      eventId: event.id ?? null,
      resultingSequence: version.sequence,
      resultingStateHash: version.stateHash,
    })
    if (expectedAdoptionHash !== adopted.payload.adoptionHash) fail('已采用导演候选的采用证据不匹配')
  } else {
    if (event.sequence !== candidate.baseSequence + 1 || version.sequence !== event.sequence) {
      fail('导演运行事件提交后 SIM 已继续推进，拒绝把后续状态并入本次采用回执')
    }
    const adoptionHash = await hashCanonicalValue({
      candidateHash: candidate.candidateHash,
      commandId: candidate.commandId,
      eventId: event.id ?? null,
      resultingSequence: version.sequence,
      resultingStateHash: version.stateHash,
    })
    snapshot = await appendRuntimeCandidateAdoptedV1({
      scope: input.scope,
      runId: snapshot.run.id,
      expectedLastSequence: snapshot.projection.lastSequence,
      payload: {
        stepId: AI_TOWN_DIRECTOR_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        adoptionHash,
        commandIds: [candidate.commandId],
        baseSequence: candidate.baseSequence,
        resultingSequence: version.sequence,
      },
    })
    const persisted = snapshot.events[snapshot.events.length - 1]
    if (persisted?.type !== 'runtime.candidate.adopted') fail('小镇导演采用事件持久化失败')
    adopted = persisted
    await input.onDurableBoundary?.('runtime.candidate.adopted', snapshot)
  }
  if (adopted?.type !== 'runtime.candidate.adopted') fail('小镇导演采用事件缺失')
  if (!snapshot.events.some(item => item.type === 'step.succeeded' && item.payload.stepId === AI_TOWN_DIRECTOR_STEP_ID_V1)) {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: AI_TOWN_DIRECTOR_STEP_ID_V1,
      attempt: 1,
      outputHash: adopted.payload.adoptionHash,
    })
  }
  if (!snapshot.events.some(item => item.type === 'verification.started')) {
    snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: AI_TOWN_DIRECTOR_VERIFIER_SET_V1 })
  }
  version = await readProductRuntimeStateVersion(candidate.productRuntimeSessionId)
  if (version.sequence !== adopted.payload.resultingSequence) fail('导演候选采用后 SIM 已继续推进，拒绝签发过期回执')
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash,
    contextManifestHashes: [candidate.contextManifestHash],
    candidateHashes: [candidate.candidateHash],
    adoptionEventIds: event.id == null ? [] : [event.id],
    postStateHash: version.stateHash,
    verifierSetVersion: AI_TOWN_DIRECTOR_VERIFIER_SET_V1,
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
