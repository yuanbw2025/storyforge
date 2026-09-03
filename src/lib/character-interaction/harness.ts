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
  assertRuntimeHarnessFreshV1,
  captureRuntimeHarnessBoundaryV1,
} from '../agent/run/runtime-scope'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { db } from '../db/schema'
import { assembleContext } from '../registry/assemble-context'
import {
  commitInteractionCharacterReply,
  proposeInteractionMemory,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from './runtime-api'
import type {
  AIConfig,
  ChatMessage,
  InteractionMemoryKind,
  ProductRuntimeEvent,
  WorkspaceScope,
} from '../types'

export const INTERACTION_RUNTIME_STEP_ID_V1 = 'interaction:runtime-candidate' as const
export const INTERACTION_RUNTIME_VERIFIER_SET_V1 = 'interaction-runtime-terminal-v1' as const

export type InteractionRuntimeSkillIdV1 = Extract<AgentSkillId,
  | 'character.interaction-reply'
  | 'prose.interaction-scene-director'
  | 'character.interaction-memory-curator'
>

interface RuntimeCandidateBaseV1 {
  version: 1
  portable: false
  runId: number
  productRuntimeSessionId: number
  participantKey: string
  sceneId: string
  baseSequence: number
  stateHash: string
  visibilityHash: string
  releaseHash: string
  contextManifestHash: string
  commandId: string | null
}

export interface InteractionReplyCandidateV1 extends RuntimeCandidateBaseV1 {
  kind: 'character-reply-candidate'
  text: string
  replyToSequence: number
  supersedesSequence: number | null
  audienceKeys: string[] | null
  budgetCost: number
  disclosures: Array<{
    knowledgeKey: string
    toParticipantKeys: string[]
    evidenceExcerpt: string
  }>
  candidateHash: string
}

export interface InteractionDirectorCandidateV1 extends RuntimeCandidateBaseV1 {
  kind: 'scene-director-candidate'
  responders: Array<{ participantKey: string; intent: string }>
  shouldEnd: boolean
  endReason: string | null
  candidateHash: string
}

export interface InteractionMemoryCandidateV1 extends RuntimeCandidateBaseV1 {
  kind: 'memory-curator-candidate'
  memoryId: string
  memoryKind: InteractionMemoryKind
  content: string
  importance: number
  sourceEventSequences: number[]
  evidenceExcerpt: string
  candidateHash: string
}

export type InteractionRuntimeCandidateV1 =
  | InteractionReplyCandidateV1
  | InteractionDirectorCandidateV1
  | InteractionMemoryCandidateV1

type RunAI = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>
type InteractionRuntimeCandidateDraftV1 =
  | Pick<InteractionReplyCandidateV1, 'kind' | 'text' | 'replyToSequence' | 'supersedesSequence' | 'audienceKeys' | 'budgetCost' | 'disclosures'>
  | Pick<InteractionDirectorCandidateV1, 'kind' | 'responders' | 'shouldEnd' | 'endReason'>
  | Pick<InteractionMemoryCandidateV1, 'kind' | 'memoryId' | 'memoryKind' | 'content' | 'importance' | 'sourceEventSequences' | 'evidenceExcerpt'>

function fail(message: string): never {
  throw new Error(`[interaction-harness] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function exact(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) {
    fail(`${label}字段不在允许闭集`)
  }
}

function stringValue(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label}无效`)
  return value.trim()
}

function nullableString(value: unknown, label: string, max: number): string | null {
  return value == null ? null : stringValue(value, label, max)
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) fail(`${label}无效`)
  return Number(value)
}

function stringArray(value: unknown, label: string, maxItems = 32): string[] {
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label}必须是有限数组`)
  const values = value.map(item => stringValue(item, label, 200))
  if (new Set(values).size !== values.length) fail(`${label}不得重复`)
  return values
}

function parseJson(output: string): Record<string, unknown> {
  let source = output.trim()
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenced) source = fenced[1]
  try {
    return record(JSON.parse(source), '模型输出')
  } catch (error) {
    if (error instanceof SyntaxError) fail('模型输出不是有效 JSON')
    throw error
  }
}

function parseDisclosures(value: unknown): InteractionReplyCandidateV1['disclosures'] {
  if (!Array.isArray(value) || value.length > 12) fail('disclosures 必须是有限数组')
  return value.map((item, index) => {
    const row = record(item, `disclosures[${index}]`)
    exact(row, ['knowledgeKey', 'toParticipantKeys', 'evidenceExcerpt'], `disclosures[${index}]`)
    return {
      knowledgeKey: stringValue(row.knowledgeKey, 'knowledgeKey', 160),
      toParticipantKeys: stringArray(row.toParticipantKeys, 'toParticipantKeys'),
      evidenceExcerpt: stringValue(row.evidenceExcerpt, 'evidenceExcerpt', 1_000),
    }
  })
}

function parseModelDraft(input: {
  skillId: InteractionRuntimeSkillIdV1
  output: string
}): InteractionRuntimeCandidateDraftV1 {
  const row = parseJson(input.output)
  if (input.skillId === 'character.interaction-reply') {
    exact(row, ['kind', 'text', 'replyToSequence', 'audienceKeys', 'budgetCost', 'disclosures'], '角色回复')
    if (row.kind !== 'character-reply') fail('角色回复 kind 无效')
    return {
      kind: 'character-reply-candidate',
      text: stringValue(row.text, '角色回复文本', 20_000),
      replyToSequence: integer(row.replyToSequence, 'replyToSequence', 1, Number.MAX_SAFE_INTEGER),
      supersedesSequence: null,
      audienceKeys: row.audienceKeys == null ? null : stringArray(row.audienceKeys, 'audienceKeys'),
      budgetCost: integer(row.budgetCost, 'budgetCost', 0, 1_000_000),
      disclosures: parseDisclosures(row.disclosures),
    }
  }
  if (input.skillId === 'prose.interaction-scene-director') {
    exact(row, ['kind', 'responders', 'shouldEnd', 'endReason'], '场景导演')
    if (row.kind !== 'scene-director' || typeof row.shouldEnd !== 'boolean' || !Array.isArray(row.responders)) {
      fail('场景导演输出无效')
    }
    const responders = row.responders.map((item, index) => {
      const responder = record(item, `responders[${index}]`)
      exact(responder, ['participantKey', 'intent'], `responders[${index}]`)
      return {
        participantKey: stringValue(responder.participantKey, 'participantKey', 160),
        intent: stringValue(responder.intent, 'intent', 2_000),
      }
    })
    if (responders.length > 8 || new Set(responders.map(item => item.participantKey)).size !== responders.length) {
      fail('场景导演 responders 无效')
    }
    const endReason = nullableString(row.endReason, 'endReason', 2_000)
    if (row.shouldEnd !== (endReason != null)) fail('shouldEnd 与 endReason 必须一致')
    return { kind: 'scene-director-candidate', responders, shouldEnd: row.shouldEnd, endReason }
  }
  exact(row, ['kind', 'memoryKind', 'content', 'importance', 'sourceEventSequences', 'evidenceExcerpt'], '记忆整理')
  if (row.kind !== 'memory-curator') fail('记忆整理 kind 无效')
  const memoryKind = stringValue(row.memoryKind, 'memoryKind', 40) as InteractionMemoryKind
  if (!['scene-summary', 'key-memory', 'commitment', 'secret', 'conflict', 'gift'].includes(memoryKind)) {
    fail('memoryKind 无效')
  }
  if (!Array.isArray(row.sourceEventSequences) || row.sourceEventSequences.length === 0 || row.sourceEventSequences.length > 64) {
    fail('sourceEventSequences 无效')
  }
  const sourceEventSequences = row.sourceEventSequences.map((value, index) => (
    integer(value, `sourceEventSequences[${index}]`, 1, Number.MAX_SAFE_INTEGER)
  ))
  if (new Set(sourceEventSequences).size !== sourceEventSequences.length) fail('sourceEventSequences 不得重复')
  return {
    kind: 'memory-curator-candidate',
    memoryId: '',
    memoryKind,
    content: stringValue(row.content, '记忆内容', 8_000),
    importance: integer(row.importance, 'importance', 0, 100),
    sourceEventSequences,
    evidenceExcerpt: stringValue(row.evidenceExcerpt, 'evidenceExcerpt', 1_000),
  }
}

function schemaInstruction(skillId: InteractionRuntimeSkillIdV1): string {
  if (skillId === 'character.interaction-reply') {
    return '{"kind":"character-reply","text":"...","replyToSequence":1,"audienceKeys":null,"budgetCost":0,"disclosures":[]}'
  }
  if (skillId === 'prose.interaction-scene-director') {
    return '{"kind":"scene-director","responders":[{"participantKey":"...","intent":"..."}],"shouldEnd":false,"endReason":null}'
  }
  return '{"kind":"memory-curator","memoryKind":"key-memory","content":"...","importance":50,"sourceEventSequences":[1],"evidenceExcerpt":"..."}'
}

function prompt(input: {
  objective: string
  skillId: InteractionRuntimeSkillIdV1
  context: string
}): ChatMessage[] {
  return [{
    role: 'system',
    content: [
      '你是 StoryForge 受治理的运行时候选生成器。只依据给出的单一角色可见上下文。',
      '不得假装写入状态，不得泄露未出现的秘密，不得输出解释、Markdown 或额外字段。',
      `严格输出 JSON：${schemaInstruction(input.skillId)}`,
    ].join('\n'),
  }, {
    role: 'user',
    content: `【目标】${input.objective}\n\n${input.context}`,
  }]
}

function buildContract(input: {
  objective: string
  boundary: Awaited<ReturnType<typeof captureRuntimeHarnessBoundaryV1>>
  skillId: InteractionRuntimeSkillIdV1
  runtimeBindingHash: string
}) {
  const skill = getAgentSkillV1(input.skillId)
  return {
    version: 1 as const,
    objective: input.objective,
    workflowKind: 'direct-generation' as const,
    scope: input.boundary.scope,
    permissions: { contextSourceKeys: ['interactionRuntime'], writeTargets: [] },
    runtimeBindingHash: input.runtimeBindingHash,
    executionBindings: [{
      stepId: INTERACTION_RUNTIME_STEP_ID_V1,
      ...createAgentSkillExecutionBindingV1(skill),
    }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 16_000,
      maxOutputTokens: skill.maxOutputTokens,
      maxAttemptsPerStep: 1,
    },
    acceptance: [
      { id: 'runtime.candidate', kind: 'output-present' as const, required: true },
      { id: 'runtime.freshness', kind: 'deterministic-check' as const, required: true },
      { id: 'runtime.adoption', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'runtime.terminal',
      kind: 'terminal' as const,
      verifier: INTERACTION_RUNTIME_VERIFIER_SET_V1,
      criterionIds: ['runtime.candidate', 'runtime.freshness', 'runtime.adoption'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

async function append(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: unknown,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    productRuntimeSessionId: snapshot.run.productRuntimeSessionId ?? fail('运行时事件缺少 Instance owner'),
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as Parameters<typeof appendAgentRunEventV1>[0])
}

export async function generateInteractionRuntimeCandidateV1(input: {
  scope: WorkspaceScope
  productRuntimeSessionId: number
  participantKey: string
  skillId: InteractionRuntimeSkillIdV1
  objective: string
  /** Reply generation may target an older visible player message for retry. */
  replyToSequence?: number
  /** The exact active character reply replaced by a retry. */
  supersedesSequence?: number | null
  /** Runtime policy owns reply cost; the model cannot mint or waive budget. */
  replyBudgetCost?: number
  aiConfig?: AIConfig
  runAI?: RunAI
  signal?: AbortSignal
  onRunCreated?: (runId: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: InteractionRuntimeCandidateV1 }> {
  const participantKey = stringValue(input.participantKey, 'participantKey', 160)
  const objective = stringValue(input.objective, 'objective', 4_000)
  const skill = getAgentSkillV1(input.skillId)
  const boundary = await captureRuntimeHarnessBoundaryV1({
    scope: input.scope,
    productRuntimeSessionId: input.productRuntimeSessionId,
    participantKey,
  })
  const executionBinding = createAgentSkillExecutionBindingV1(skill)
  const modelIdentity = input.runAI
    ? { provider: 'test-adapter', model: 'injected', transport: 'chat-v1' }
    : { provider: input.aiConfig?.provider, model: input.aiConfig?.model, transport: 'chat-v1' }
  if (!input.runAI && !input.aiConfig) fail('缺少 AI 配置')
  const runtimeBindingHash = await hashCanonicalValue({ executionBinding, modelIdentity })
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    productRuntimeSessionId: input.productRuntimeSessionId,
    worldGroupId: boundary.scope.worldGroupId,
    contract: buildContract({ objective, boundary, skillId: input.skillId, runtimeBindingHash }),
  })
  await input.onRunCreated?.(snapshot.run.id)
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: INTERACTION_RUNTIME_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: INTERACTION_RUNTIME_STEP_ID_V1, attempt: 1 })
  try {
    const assembled = await assembleContext({
      projectId: input.scope.projectId,
      scope: input.scope,
      worldGroupId: boundary.scope.worldGroupId,
      productRuntimeSessionId: input.productRuntimeSessionId,
      interactionParticipantKey: participantKey,
      sourceKeys: ['interactionRuntime'],
      provider: input.aiConfig?.provider,
      model: input.aiConfig?.model,
      inputBudgetMaxTokens: 16_000,
    })
    if (!assembled.included.includes('interactionRuntime')) fail('角色运行时上下文为空')
    await assertRuntimeHarnessFreshV1({
      scope: input.scope,
      contractScope: snapshot.contract.scope,
      participantKey,
    })
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId: INTERACTION_RUNTIME_STEP_ID_V1,
      attempt: 1,
      projectId: input.scope.projectId,
      worldGroupId: boundary.scope.worldGroupId,
      declaredSourceKeys: ['interactionRuntime'],
      assembled,
      readerVersion: 'interaction-runtime-view-v1',
    })
    snapshot = await append(input.scope, snapshot, 'context.assembled', {
      stepId: INTERACTION_RUNTIME_STEP_ID_V1,
      attempt: 1,
      manifestHash: manifest.manifestHash,
    })
    const messages = prompt({ objective, skillId: input.skillId, context: assembled.text })
    snapshot = await append(input.scope, snapshot, 'model.requested', {
      stepId: INTERACTION_RUNTIME_STEP_ID_V1,
      attempt: 1,
      bindingHash: await hashCanonicalValue({ runtimeBindingHash, manifestHash: manifest.manifestHash, messages }),
    })
    const output = input.runAI
      ? await input.runAI(messages, input.signal)
      : await chat(messages, input.aiConfig!, {
          category: `runtime.${input.skillId}`,
          projectId: input.scope.projectId,
          contextOverflowPolicy: 'reject',
        }, input.signal)
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: INTERACTION_RUNTIME_STEP_ID_V1,
      attempt: 1,
      outputHash: await hashCanonicalValue(output),
    })
    const draft = parseModelDraft({ skillId: input.skillId, output })
    const state = await readProductRuntimeState(input.productRuntimeSessionId)
    const sceneId = state.interaction?.activeScene?.sceneId
    if (!sceneId) fail('模型返回时互动场景已经结束')
    const commandId = draft.kind === 'scene-director-candidate'
      ? null
      : `harness:${snapshot.run.id}:${draft.kind}`
    const common: RuntimeCandidateBaseV1 = {
      version: 1,
      portable: false,
      runId: snapshot.run.id,
      participantKey,
      sceneId,
      ...boundary.scope.runtime,
      contextManifestHash: manifest.manifestHash,
      commandId,
    }
    let body: Record<string, unknown>
    if (draft.kind === 'character-reply-candidate') {
      const replyToSequence = input.replyToSequence ?? draft.replyToSequence
      const source = state.interaction?.messages.find(item => item.eventSequence === replyToSequence)
      if (!source || source.role !== 'player' || source.supersededBySequence != null
        || (source.audienceKeys != null && !source.audienceKeys.includes(participantKey))) {
        fail('角色回复目标不是该角色可见的现行玩家消息')
      }
      const supersedesSequence = input.supersedesSequence ?? null
      if (supersedesSequence != null) {
        const superseded = state.interaction?.messages.find(item => item.eventSequence === supersedesSequence)
        if (!superseded || superseded.role !== 'character' || superseded.speakerKey !== participantKey
          || superseded.replyToSequence !== replyToSequence || superseded.supersededBySequence != null) {
          fail('重试指定的旧回复无效')
        }
      }
      const budgetCost = input.replyBudgetCost == null
        ? draft.budgetCost
        : integer(input.replyBudgetCost, 'replyBudgetCost', 0, 1_000_000)
      body = { ...common, ...draft, replyToSequence, supersedesSequence, budgetCost }
    } else if (draft.kind === 'memory-curator-candidate') {
      body = { ...common, ...draft, memoryId: `memory:harness:${snapshot.run.id}` }
    } else {
      body = { ...common, ...draft }
    }
    const candidate = { ...body, candidateHash: await hashCanonicalValue(body) } as unknown as InteractionRuntimeCandidateV1
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
      stepId: INTERACTION_RUNTIME_STEP_ID_V1,
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
    if (current.projection.state === 'cancelled') throw error
    if (current.projection.steps[INTERACTION_RUNTIME_STEP_ID_V1]?.status === 'running') {
      snapshot = await append(input.scope, current, 'step.failed', {
        stepId: INTERACTION_RUNTIME_STEP_ID_V1,
        attempt: 1,
        code: input.signal?.aborted ? 'runtime-generation-cancelled' : 'runtime-generation-failed',
        retryable: !input.signal?.aborted,
        category: input.signal?.aborted ? 'cancelled' : 'protocol',
        action: 'fail',
      })
    }
    if (snapshot.projection.state !== 'failed' && snapshot.projection.state !== 'cancelled') {
      await append(input.scope, snapshot, input.signal?.aborted ? 'run.cancelled' : 'run.failed', input.signal?.aborted
        ? { reason: 'runtime-generation-cancelled' }
        : { code: 'runtime-generation-failed', retryable: false })
    }
    throw error
  }
}

function candidateBody(candidate: InteractionRuntimeCandidateV1): Omit<InteractionRuntimeCandidateV1, 'candidateHash'> {
  const { candidateHash: _candidateHash, ...body } = candidate
  return body
}

function isCandidate(value: unknown): value is InteractionRuntimeCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<InteractionRuntimeCandidateV1>
  return row.version === 1 && row.portable === false && typeof row.runId === 'number'
    && typeof row.productRuntimeSessionId === 'number' && typeof row.participantKey === 'string'
    && typeof row.sceneId === 'string' && typeof row.baseSequence === 'number'
    && typeof row.stateHash === 'string' && typeof row.visibilityHash === 'string'
    && typeof row.releaseHash === 'string' && typeof row.contextManifestHash === 'string'
    && typeof row.candidateHash === 'string'
    && ['character-reply-candidate', 'scene-director-candidate', 'memory-curator-candidate'].includes(String(row.kind))
}

async function readCandidate(scope: WorkspaceScope, runId: number): Promise<{
  snapshot: AgentRunSnapshotV1
  candidate: InteractionRuntimeCandidateV1
}> {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(scope, runId, { owner: 'instance' })
  if (!saved || !isCandidate(saved.resumePayload)) fail('运行缺少可恢复候选')
  const candidate = saved.resumePayload
  if (candidate.runId !== runId || await hashCanonicalValue(candidateBody(candidate)) !== candidate.candidateHash) {
    fail('候选哈希或运行绑定不匹配')
  }
  return { snapshot: saved.snapshot, candidate }
}

async function applyCandidate(candidate: InteractionRuntimeCandidateV1): Promise<ProductRuntimeEvent | null> {
  if (candidate.kind === 'scene-director-candidate') return null
  const envelope = {
    sessionId: candidate.productRuntimeSessionId,
    commandId: candidate.commandId!,
    baseSequence: candidate.baseSequence,
    baseStateHash: candidate.stateHash,
  }
  if (candidate.kind === 'character-reply-candidate') {
    return commitInteractionCharacterReply({
      ...envelope,
      messageId: `message:harness:${candidate.runId}`,
      speakerKey: candidate.participantKey,
      text: candidate.text,
      replyToSequence: candidate.replyToSequence,
      supersedesSequence: candidate.supersedesSequence,
      audienceKeys: candidate.audienceKeys,
      budgetCost: candidate.budgetCost,
      disclosures: candidate.disclosures,
    })
  }
  return proposeInteractionMemory({
    ...envelope,
    memoryId: candidate.memoryId,
    participantKey: candidate.participantKey,
    kind: candidate.memoryKind,
    content: candidate.content,
    importance: candidate.importance,
    sourceEventSequences: candidate.sourceEventSequences,
    evidenceExcerpt: candidate.evidenceExcerpt,
  })
}

export async function adoptInteractionRuntimeCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  /** Test/host crash-injection boundary; the durable event is already committed. */
  onDurableBoundary?: (eventType: string, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; event: ProductRuntimeEvent | null; receiptHash: string }> {
  const loaded = await readCandidate(input.scope, input.runId)
  let { snapshot } = loaded
  const { candidate } = loaded
  let adopted = snapshot.events.find(event => event.type === 'runtime.candidate.adopted')
  const completedAdoption = adopted?.type === 'runtime.candidate.adopted' ? adopted : null
  if (completedAdoption && snapshot.projection.state === 'completed') {
    const commandEvents = completedAdoption.payload.commandIds.length
      ? await db.productRuntimeEvents.where('sessionId').equals(candidate.productRuntimeSessionId).toArray()
      : []
    return {
      snapshot,
      event: completedAdoption.payload.commandIds.length
        ? commandEvents.find(event => event.commandId === completedAdoption.payload.commandIds[0]) ?? null
        : null,
      receiptHash: snapshot.projection.terminalReceiptHash ?? fail('已采用运行缺少终验回执'),
    }
  }
  const priorCommand = candidate.commandId == null
    ? null
    : (await db.productRuntimeEvents.where('sessionId').equals(candidate.productRuntimeSessionId).toArray())
        .find(event => event.commandId === candidate.commandId) ?? null
  if (!adopted && !priorCommand) {
    try {
      await assertRuntimeHarnessFreshV1({
        scope: input.scope,
        contractScope: snapshot.contract.scope,
        participantKey: candidate.participantKey,
      })
      const state = await readProductRuntimeState(candidate.productRuntimeSessionId)
      if (state.interaction?.activeScene?.sceneId !== candidate.sceneId) fail('互动场景已经变化')
    } catch (error) {
      snapshot = await append(input.scope, snapshot, 'candidate.staled', {
        stepId: INTERACTION_RUNTIME_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: error instanceof Error ? error.message.slice(0, 1_000) : 'runtime-input-stale',
      })
      throw Object.assign(error instanceof Error ? error : new Error('运行时候选已过期'), { snapshot })
    }
  }
  const event = adopted
    ? priorCommand
    : await applyCandidate(candidate)
  let version = await readProductRuntimeStateVersion(candidate.productRuntimeSessionId)
  if (adopted?.type === 'runtime.candidate.adopted') {
    if (
      adopted.payload.candidateHash !== candidate.candidateHash
      || adopted.payload.baseSequence !== candidate.baseSequence
      || adopted.payload.resultingSequence !== version.sequence
      || adopted.payload.commandIds.join('\u0000') !== (candidate.commandId == null ? '' : candidate.commandId)
    ) fail('已采用候选的 SIM 终态已变化，拒绝补签终验回执')
    const expectedAdoptionHash = await hashCanonicalValue({
      candidateHash: candidate.candidateHash,
      commandId: candidate.commandId,
      eventId: event?.id ?? null,
      resultingSequence: version.sequence,
      resultingStateHash: version.stateHash,
    })
    if (expectedAdoptionHash !== adopted.payload.adoptionHash) fail('已采用候选的采用证据不匹配')
  } else {
    const adoptionHash = await hashCanonicalValue({
      candidateHash: candidate.candidateHash,
      commandId: candidate.commandId,
      eventId: event?.id ?? null,
      resultingSequence: version.sequence,
      resultingStateHash: version.stateHash,
    })
    snapshot = await appendRuntimeCandidateAdoptedV1({
      scope: input.scope,
      runId: snapshot.run.id,
      expectedLastSequence: snapshot.projection.lastSequence,
      payload: {
        stepId: INTERACTION_RUNTIME_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        adoptionHash,
        commandIds: candidate.commandId == null ? [] : [candidate.commandId],
        baseSequence: candidate.baseSequence,
        resultingSequence: version.sequence,
      },
    })
    const persistedAdoption = snapshot.events[snapshot.events.length - 1]
    if (persistedAdoption?.type !== 'runtime.candidate.adopted') fail('采用事件持久化失败')
    adopted = persistedAdoption
    await input.onDurableBoundary?.('runtime.candidate.adopted', snapshot)
  }
  if (adopted?.type !== 'runtime.candidate.adopted') fail('采用事件缺失')
  if (!snapshot.events.some(item => item.type === 'step.succeeded' && item.payload.stepId === INTERACTION_RUNTIME_STEP_ID_V1)) {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: INTERACTION_RUNTIME_STEP_ID_V1,
      attempt: 1,
      outputHash: adopted.payload.adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (!snapshot.events.some(item => item.type === 'verification.started')) {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: INTERACTION_RUNTIME_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  version = await readProductRuntimeStateVersion(candidate.productRuntimeSessionId)
  if (version.sequence !== adopted.payload.resultingSequence) {
    fail('采用后 SIM 状态已继续推进，拒绝对过期终态签发回执')
  }
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash,
    contextManifestHashes: [candidate.contextManifestHash],
    candidateHashes: [candidate.candidateHash],
    adoptionEventIds: event?.id == null ? [] : [event.id],
    postStateHash: version.stateHash,
    verifierSetVersion: INTERACTION_RUNTIME_VERIFIER_SET_V1,
    criteria: [
      { id: 'runtime.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'runtime.freshness', status: 'passed', evidenceRefs: [`base:${candidate.baseSequence}:${candidate.stateHash}`] },
      { id: 'runtime.adoption', status: 'passed', evidenceRefs: [`post-state:${version.stateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, event, receiptHash: receipt.receiptHash }
}

export async function cancelInteractionRuntimeRunV1(input: {
  scope: WorkspaceScope
  runId: number
  reason?: string
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  if (['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) return snapshot
  return append(input.scope, snapshot, 'run.cancelled', {
    reason: input.reason?.trim().slice(0, 1_000) || 'runtime-generation-cancelled',
  })
}
