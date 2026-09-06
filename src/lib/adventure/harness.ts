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
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { assembleContext } from '../registry/assemble-context'
import {
  commitAdventureAction,
  commitAdventureNarrativeChoice,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from './runtime-api'
import type {
  AdventureActionCandidateV1,
  AIConfig,
  ChatMessage,
  ProductRuntimeEvent,
  WorkspaceScope,
} from '../types'
import { adventureNarrativeActionContext, availableAdventureActions } from './runtime'

export const ADVENTURE_RUNTIME_STEP_ID_V1 = 'adventure:runtime-candidate' as const
export const ADVENTURE_RUNTIME_VERIFIER_SET_V1 = 'adventure-runtime-terminal-v1' as const

type AdventureRuntimeSkillIdV1 = Extract<AgentSkillId,
  'prose.adventure-intent-parser' | 'prose.adventure-result-narrator'
>

interface AdventureRuntimeCandidateBaseV1 {
  version: 1
  portable: false
  runId: number
  productRuntimeSessionId: number
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
function escapeRawJsonStringControls(source: string): string {
  let normalized = ''
  let inString = false
  let escaped = false
  for (const character of source) {
    if (!inString) {
      normalized += character
      if (character === '"') inString = true
      continue
    }
    if (escaped) {
      normalized += character
      escaped = false
      continue
    }
    if (character === '\\') {
      normalized += character
      escaped = true
      continue
    }
    if (character === '"') {
      normalized += character
      inString = false
      continue
    }
    if (character === '\n') normalized += '\\n'
    else if (character === '\r') normalized += '\\r'
    else if (character === '\t') normalized += '\\t'
    else if (character.charCodeAt(0) < 0x20) normalized += `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
    else normalized += character
  }
  return normalized
}
function parseJson(output: string): Record<string, unknown> {
  const source = output.trim().replace(/^\uFEFF/, '')
  if (!source || source.length > 100_000) fail('模型输出为空或过长')
  try { return record(JSON.parse(source), '模型输出') } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }

  // Compatible providers sometimes wrap the requested object in a Markdown
  // fence or one short explanatory sentence. Recover only one unambiguous,
  // balanced object; the closed-schema checks below still reject extra fields.
  const spans: Array<{ start: number; end: number }> = []
  let start = -1
  let objectDepth = 0
  let arrayDepth = 0
  let inString = false
  let escaped = false
  let malformed = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if ((objectDepth > 0 || arrayDepth > 0) && character === '"') {
      inString = true
      continue
    }
    if (character === '[') { arrayDepth += 1; continue }
    if (character === ']') {
      if (arrayDepth === 0) malformed = true
      else arrayDepth -= 1
      continue
    }
    if (character === '{') {
      if (objectDepth === 0 && arrayDepth === 0) start = index
      objectDepth += 1
      continue
    }
    if (character !== '}') continue
    if (objectDepth === 0) { malformed = true; continue }
    objectDepth -= 1
    if (objectDepth === 0 && start >= 0) {
      spans.push({ start, end: index + 1 })
      start = -1
    }
  }
  if (inString || objectDepth !== 0 || arrayDepth !== 0 || malformed || spans.length !== 1) {
    fail('模型输出必须只包含一个完整 JSON 对象')
  }
  const candidate = source.slice(spans[0].start, spans[0].end)
  try { return record(JSON.parse(candidate), '模型输出') } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  // A few OpenAI-compatible transports stream literal line breaks inside an
  // otherwise valid JSON string. Escaping JSON control characters preserves
  // the exact prose while keeping structural recovery deliberately narrow.
  const controlsEscaped = escapeRawJsonStringControls(candidate)
  if (controlsEscaped !== candidate) {
    try { return record(JSON.parse(controlsEscaped), '模型输出') } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  fail('模型输出不是有效 JSON')
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
        ? '只能从上下文的【允许输出的 actionKey JSON】数组中逐字复制一个 actionKey；数组外的 Narrative choice、地点、物品或推测 key 均不得输出。不得创造行动或结果。'
        : '只能润色最近已发生行动的结果；evidenceEventSequences 只能从上下文的【允许引用的冒险事件序号 JSON】数组中逐字复制至少一个整数；不得改变判定、物品、资源、任务、地点或 Narrative 状态。',
      `只输出严格 JSON，不要 Markdown、解释或额外字段：${schema}`,
    ].join('\n'),
  }, { role: 'user', content: `【目标】${objective}\n\n${context}` }]
}

async function resolveIntentRuntimeBindingV1(candidate: AdventureIntentCandidateV1): Promise<{
  narrativeChoiceKey: string | null
}> {
  const session = await db.productRuntimeSessions.get(candidate.productRuntimeSessionId)
  if (!session || session.worldId == null || session.workId == null) fail('自由输入候选的运行实例已失效')
  const playable = await verifyProductRuntimeSessionSourceV1({
    scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId },
    session,
  })
  if ((playable.runtimePackage.productType !== 'text-adventure'
      && playable.runtimePackage.productType !== 'text-open-world')
    || !playable.runtimePackage.adventure) fail('自由输入候选的冻结冒险包已失效')
  const action = playable.runtimePackage.adventure.actions.find(item => item.key === candidate.actionKey)
  if (!action) fail('自由输入候选引用了未登记行动')
  const narrativeChoiceKey = action.narrativeChoiceKey
    && playable.runtimePackage.narrative.choices.some(choice => (
      choice.choiceKey === action.narrativeChoiceKey
      && choice.tags.includes(`adventure-action:${action.key}`)
    ))
    ? action.narrativeChoiceKey
    : null
  return { narrativeChoiceKey }
}

function eventCommitsNarrativeChoiceV1(event: ProductRuntimeEvent, choiceKey: string): boolean {
  if (event.type !== 'narrative.choice.committed') return false
  try {
    const payload = JSON.parse(event.payloadJson) as { choiceKey?: unknown }
    return payload.choiceKey === choiceKey
  } catch { return false }
}

async function findPersistedCandidateRuntimeEventV1(
  candidate: AdventureRuntimeCandidateV1,
  intentBinding: { narrativeChoiceKey: string | null } | null,
): Promise<ProductRuntimeEvent | null> {
  if (candidate.commandId == null) return null
  const events = await db.productRuntimeEvents.where('sessionId').equals(candidate.productRuntimeSessionId).toArray()
  if (intentBinding?.narrativeChoiceKey) {
    return events.find(event => eventCommitsNarrativeChoiceV1(event, intentBinding.narrativeChoiceKey!)) ?? null
  }
  return events.find(event => event.commandId === candidate.commandId) ?? null
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
    productRuntimeSessionId: snapshot.run.productRuntimeSessionId ?? fail('运行时事件缺少 Instance owner'),
    type, payload, expectedLastSequence: snapshot.projection.lastSequence,
  } as Parameters<typeof appendAgentRunEventV1>[0])
}

export async function generateAdventureRuntimeCandidateV1(input: {
  scope: WorkspaceScope
  productRuntimeSessionId: number
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
    scope: input.scope, productRuntimeSessionId: input.productRuntimeSessionId,
  })
  if (!input.runAI && !input.aiConfig) fail('缺少 AI 配置')
  const runtimeBindingHash = await hashCanonicalValue({
    executionBinding: createAgentSkillExecutionBindingV1(skill),
    modelIdentity: input.runAI
      ? { provider: 'test-adapter', model: 'injected', transport: 'chat-v1' }
      : { provider: input.aiConfig?.provider, model: input.aiConfig?.model, transport: 'chat-v1' },
  })
  let snapshot = await createAgentRunV1({
    scope: input.scope, productRuntimeSessionId: input.productRuntimeSessionId,
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
      productRuntimeSessionId: input.productRuntimeSessionId,
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
    const [state, session] = await Promise.all([
      readProductRuntimeState(input.productRuntimeSessionId),
      db.productRuntimeSessions.get(input.productRuntimeSessionId),
    ])
    if (!state.adventure || !session || session.worldId == null || session.workId == null) {
      fail('模型返回时文字冒险实例已失效')
    }
    const playable = await verifyProductRuntimeSessionSourceV1({
      scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId },
      session,
    })
    if (playable.runtimeSourceHash !== session.runtimeSourceHash
      || (playable.runtimePackage.productType !== 'text-adventure'
        && playable.runtimePackage.productType !== 'text-open-world')
      || !playable.runtimePackage.adventure) {
      fail('模型返回时文字冒险冻结运行源已失效')
    }
    if (draft.kind === 'adventure-intent-candidate') {
      const available = availableAdventureActions(
        playable.runtimePackage.adventure,
        state.adventure,
        adventureNarrativeActionContext(state.narrative),
      ).some(item => item.action.key === draft.actionKey && item.available)
      if (!available) fail('模型映射了未登记行动')
    } else {
      const events = await db.productRuntimeEvents.where('sessionId').equals(input.productRuntimeSessionId).toArray()
      const evidence = new Map(events.map(event => [event.sequence, event]))
      const allowedEvidence = new Set(state.adventure.actionHistory.slice(-1).map(item => item.eventSequence))
      if (!allowedEvidence.size || draft.evidenceEventSequences.some(sequence => !allowedEvidence.has(sequence))) {
        fail('结果叙述引用了允许闭集外的事件')
      }
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
      productRuntimeSessionId: input.productRuntimeSessionId,
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
    && typeof row.productRuntimeSessionId === 'number' && typeof row.baseSequence === 'number'
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
}): Promise<{ snapshot: AgentRunSnapshotV1; event: ProductRuntimeEvent | null; receiptHash: string; candidate: AdventureRuntimeCandidateV1 }> {
  const loaded = await readCandidate(input.scope, input.runId)
  let { snapshot } = loaded
  const { candidate } = loaded
  const intentBinding = candidate.kind === 'adventure-intent-candidate'
    ? await resolveIntentRuntimeBindingV1(candidate)
    : null
  let adopted = snapshot.events.find(event => event.type === 'runtime.candidate.adopted')
  if (adopted?.type === 'runtime.candidate.adopted' && snapshot.projection.state === 'completed') {
    const event = await findPersistedCandidateRuntimeEventV1(candidate, intentBinding)
    return { snapshot, event, candidate, receiptHash: snapshot.projection.terminalReceiptHash ?? fail('已采用运行缺少终验回执') }
  }
  const prior = await findPersistedCandidateRuntimeEventV1(candidate, intentBinding)
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
    ? intentBinding?.narrativeChoiceKey
      ? await commitAdventureNarrativeChoice({
          sessionId: candidate.productRuntimeSessionId,
          choiceKey: intentBinding.narrativeChoiceKey,
          commandId: candidate.commandId!,
        })
      : await commitAdventureAction({
          sessionId: candidate.productRuntimeSessionId, commandId: candidate.commandId!,
          baseSequence: candidate.baseSequence, baseStateHash: candidate.stateHash,
          actionKey: candidate.actionKey,
        })
    : null)
  let version = await readProductRuntimeStateVersion(candidate.productRuntimeSessionId)
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
        adoptionHash, commandIds: event?.commandId ? [event.commandId] : [],
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
  version = await readProductRuntimeStateVersion(candidate.productRuntimeSessionId)
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
