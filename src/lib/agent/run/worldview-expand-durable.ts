import { chat } from '../../ai/client'
import {
  buildWorldExpandPromptFromRegisteredContextV1,
  parseWorldExpandOutputStrictV1,
  readWorldExpandPromptTemplateSnapshotV1,
  WORLDVIEW_EXPAND_FIELDS_V1,
  type ExpandedWorldview,
} from '../../ai/world-group-ai'
import { db } from '../../db/schema'
import { adopt } from '../../registry/adopt'
import { assembleContext } from '../../registry/assemble-context'
import type { AIConfig, ChatMessage, WorkspaceScope, WorldGroup, Worldview } from '../../types'
import { WORLD_GROUP_TYPE_LABELS } from '../../types/world-group'
import {
  assertRecordInScope,
  readOwnedRows,
  scopeTransactionTables,
} from '../../world-engine/scope'
import { createAgentSkillExecutionBindingV1 } from '../execution-binding'
import { getAgentSkillV1 } from '../skill-registry'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  staleAgentRunVerificationV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { canonicalStringify, hashCanonicalValue } from './hash'
import { createVerificationReceiptV1 } from './verification-receipt'

export const WORLDVIEW_EXPAND_STEP_ID_V1 = 'world-origin:worldview-expand' as const
export const WORLDVIEW_EXPAND_VERIFIER_SET_V1 = 'worldview-expand-terminal-v1' as const
export const WORLDVIEW_EXPAND_CONTEXT_SOURCE_KEYS_V1 = ['manualText', 'worldGroups', 'storyCore', 'worldview'] as const

type RunAI = (messages: ChatMessage[]) => Promise<string>

interface WorldGroupSnapshotV1 {
  id: number
  projectId: number
  name: string
  description: string
  type: WorldGroup['type']
  icon: string | null
  color: string | null
  order: number
  entryCondition: string | null
  exitCondition: string | null
  plannedChapterCount: number | null
  powerRestriction: string | null
  takeawayRules: string | null
}

interface WorldviewSnapshotV1 {
  id: number | null
  fields: Record<string, unknown>
}

const NEW_WORLDVIEW_DEFAULT_FIELDS: Record<string, unknown> = {
  geography: '',
  history: '',
  society: '',
  culture: '',
  economy: '',
  rules: '',
  summary: '',
}

export interface WorldviewExpandCandidateV1 {
  version: 1
  kind: 'worldview-expand-candidate'
  portable: false
  projectId: number
  worldId: number
  workId: number
  worldGroupId: number
  worldGroupSnapshot: WorldGroupSnapshotV1
  worldGroupHash: string
  worldviewRecordId: number | null
  worldviewBaseline: WorldviewSnapshotV1
  worldviewBaselineHash: string
  worldviewNonTargetFields: Record<string, unknown>
  worldviewNonTargetHash: string
  contextManifestHash: string
  contextInputHash: string
  externalContextInputHash: string
  promptTemplateHash: string
  promptHash: string
  modelOutputHash: string
  values: ExpandedWorldview
  valuesHash: string
  candidateHash: string
}

interface WorldviewExpandAdoptionIntentV1 {
  version: 1
  kind: 'worldview-expand-adoption-intent'
  portable: false
  candidate: WorldviewExpandCandidateV1
  intentHash: string
}

export type WorldviewExpandBoundaryV1 =
  | 'model.requested'
  | 'model.responded'
  | 'candidate.checkpoint'
  | 'candidate.persisted'
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function assertExactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(row)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${label}字段不在允许闭集。`)
  }
}

async function append(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: any,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as any)
}

function worldGroupSnapshot(group: WorldGroup & { id: number }): WorldGroupSnapshotV1 {
  return {
    id: group.id,
    projectId: group.projectId,
    name: group.name,
    description: group.description || '',
    type: group.type,
    icon: group.icon ?? null,
    color: group.color ?? null,
    order: group.order,
    entryCondition: group.entryCondition ?? null,
    exitCondition: group.exitCondition ?? null,
    plannedChapterCount: group.plannedChapterCount ?? null,
    powerRestriction: group.powerRestriction ?? null,
    takeawayRules: group.takeawayRules ?? null,
  }
}

const WORLDVIEW_META_FIELDS = new Set([
  'id', 'projectId', 'worldId', 'workId', 'worldGroupId', 'createdAt', 'updatedAt',
  'embedding', 'embeddingModel', 'embeddingUpdatedAt',
])

function worldviewSnapshot(row: Worldview | null): WorldviewSnapshotV1 {
  const fields: Record<string, unknown> = {}
  if (row) {
    for (const key of Object.keys(row).sort()) {
      if (!WORLDVIEW_META_FIELDS.has(key)) fields[key] = (row as unknown as Record<string, unknown>)[key]
    }
  }
  return { id: row?.id ?? null, fields }
}

function nonTargetWorldviewFields(snapshot: WorldviewSnapshotV1): Record<string, unknown> {
  return Object.fromEntries(Object.entries(snapshot.fields).filter(([key]) => (
    !WORLDVIEW_EXPAND_FIELDS_V1.includes(key as typeof WORLDVIEW_EXPAND_FIELDS_V1[number])
  )))
}

function expectedNonTargetWorldviewFields(snapshot: WorldviewSnapshotV1): Record<string, unknown> {
  return snapshot.id == null ? { ...NEW_WORLDVIEW_DEFAULT_FIELDS } : nonTargetWorldviewFields(snapshot)
}

async function readTarget(
  scope: WorkspaceScope,
  worldGroupId: number,
): Promise<{ group: WorldGroup & { id: number }; worldview: Worldview | null }> {
  const group = await db.worldGroups.get(worldGroupId)
  if (!group?.id || !await assertRecordInScope(scope, 'worldGroups', group, { owner: 'world' })) {
    throw new Error('目标世界组不存在或不属于当前 World。')
  }
  const rows = await readOwnedRows<Worldview>(scope, 'worldviews', { owner: 'world' })
  const worldview = rows.find(row => row.worldGroupId === worldGroupId) ?? null
  return { group: group as WorldGroup & { id: number }, worldview }
}

function manualDraft(group: WorldGroup & { id: number }): string {
  return [
    '【目标世界草稿】',
    `世界组：#${group.id}`,
    `名称：${group.name}`,
    `类型：${WORLD_GROUP_TYPE_LABELS[group.type]}`,
    `描述：${group.description?.trim() || group.name}`,
  ].join('\n')
}

async function assembleWorldviewExpandContext(
  scope: WorkspaceScope,
  group: WorldGroup & { id: number },
  sourceKeys: readonly string[] = WORLDVIEW_EXPAND_CONTEXT_SOURCE_KEYS_V1,
) {
  return assembleContext({
    projectId: scope.projectId,
    scope,
    worldGroupId: group.id,
    sourceKeys: [...sourceKeys],
    manualSourceText: manualDraft(group),
    inputBudgetTokens: 32_000,
  })
}

async function assemblyHash(assembled: Awaited<ReturnType<typeof assembleWorldviewExpandContext>>) {
  return hashCanonicalValue({ text: assembled.text, sourceEvidence: assembled.sourceEvidence })
}

async function promptEvidence(contextText: string) {
  const messages = buildWorldExpandPromptFromRegisteredContextV1(contextText)
  return {
    messages,
    promptTemplateHash: await hashCanonicalValue(readWorldExpandPromptTemplateSnapshotV1()),
    promptHash: await hashCanonicalValue(messages),
  }
}

function contract(scope: WorkspaceScope, group: WorldGroup & { id: number }) {
  const skill = getAgentSkillV1('world-origin.worldview-expand', 'world-origin')
  return {
    version: 1 as const,
    objective: `为世界组 #${group.id} “${group.name}”生成可确认七字段世界观扩写`,
    workflowKind: 'plan-execute' as const,
    scope: { projectId: scope.projectId, worldGroupId: group.id },
    permissions: {
      contextSourceKeys: [...WORLDVIEW_EXPAND_CONTEXT_SOURCE_KEYS_V1],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table,
        fields: [...target.fields],
        mode: 'author-confirmed' as const,
      })),
    },
    executionBindings: [{ stepId: WORLDVIEW_EXPAND_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 32_000,
      maxOutputTokens: skill.maxOutputTokens,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'worldview-expand.candidate', kind: 'output-present' as const, required: true },
      { id: 'worldview-expand.author', kind: 'author-confirmed' as const, required: true },
      { id: 'worldview-expand.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'worldview-expand.terminal',
      kind: 'terminal' as const,
      verifier: WORLDVIEW_EXPAND_VERIFIER_SET_V1,
      criterionIds: ['worldview-expand.candidate', 'worldview-expand.author', 'worldview-expand.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function contractTargetsWorldGroup(contractJson: unknown, worldGroupId: number): boolean {
  if (typeof contractJson !== 'string') return false
  try {
    const objective = (JSON.parse(contractJson) as Record<string, unknown>).objective
    return typeof objective === 'string' && objective.startsWith(`为世界组 #${worldGroupId} `)
  } catch {
    return false
  }
}

async function parseCandidate(value: unknown): Promise<WorldviewExpandCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('世界扩写候选检查点无效。')
  const row = value as Record<string, any>
  const keys = [
    'version', 'kind', 'portable', 'projectId', 'worldId', 'workId', 'worldGroupId',
    'worldGroupSnapshot', 'worldGroupHash', 'worldviewRecordId', 'worldviewBaseline',
    'worldviewBaselineHash', 'worldviewNonTargetFields', 'worldviewNonTargetHash',
    'contextManifestHash', 'contextInputHash',
    'externalContextInputHash', 'promptTemplateHash', 'promptHash', 'modelOutputHash',
    'values', 'valuesHash', 'candidateHash',
  ] as const
  assertExactKeys(row, keys, '世界扩写候选')
  if (
    row.version !== 1
    || row.kind !== 'worldview-expand-candidate'
    || row.portable !== false
    || ![row.projectId, row.worldId, row.workId, row.worldGroupId].every(Number.isInteger)
    || (row.worldviewRecordId !== null && !Number.isInteger(row.worldviewRecordId))
    || ![
      row.worldGroupHash, row.worldviewBaselineHash, row.worldviewNonTargetHash,
      row.contextManifestHash, row.contextInputHash, row.externalContextInputHash,
      row.promptTemplateHash, row.promptHash, row.modelOutputHash, row.valuesHash,
      row.candidateHash,
    ].every(isHash)
  ) throw new Error('世界扩写候选检查点不完整。')
  const values = parseWorldExpandOutputStrictV1(JSON.stringify(row.values))
  if (canonicalStringify(values) !== canonicalStringify(row.values)) throw new Error('世界扩写候选字段未规范化。')
  if (await hashCanonicalValue(values) !== row.valuesHash) throw new Error('世界扩写候选值 hash 不匹配。')
  if (await hashCanonicalValue(row.worldGroupSnapshot) !== row.worldGroupHash) throw new Error('世界扩写目标世界组 hash 不匹配。')
  if (await hashCanonicalValue(row.worldviewBaseline) !== row.worldviewBaselineHash) throw new Error('世界扩写正式 baseline hash 不匹配。')
  if (await hashCanonicalValue(row.worldviewNonTargetFields) !== row.worldviewNonTargetHash) throw new Error('世界扩写非目标字段 hash 不匹配。')
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('世界扩写候选 hash 不匹配。')
  return row as WorldviewExpandCandidateV1
}

async function parseState(value: unknown): Promise<{
  candidate: WorldviewExpandCandidateV1
  intent: WorldviewExpandAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'worldview-expand-adoption-intent') {
    const row = value as Record<string, any>
    assertExactKeys(row, ['version', 'kind', 'portable', 'candidate', 'intentHash'], '世界扩写采纳意图')
    if (row.version !== 1 || row.portable !== false || !isHash(row.intentHash)) throw new Error('世界扩写采纳意图无效。')
    const candidate = await parseCandidate(row.candidate)
    const body = { version: 1 as const, kind: 'worldview-expand-adoption-intent' as const, portable: false as const, candidate }
    if (await hashCanonicalValue(body) !== row.intentHash) throw new Error('世界扩写采纳意图 hash 不匹配。')
    return { candidate, intent: row as WorldviewExpandAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('世界扩写运行缺少可验证检查点。')
  return parseState(checkpoint.resumePayload)
}

function assertCandidateTarget(
  scope: WorkspaceScope,
  worldGroupId: number,
  snapshot: AgentRunSnapshotV1,
  candidate: WorldviewExpandCandidateV1,
): void {
  if (
    candidate.projectId !== scope.projectId
    || candidate.worldId !== scope.worldId
    || candidate.workId !== scope.workId
    || candidate.worldGroupId !== worldGroupId
    || snapshot.run.projectId !== scope.projectId
    || snapshot.run.worldGroupId !== worldGroupId
  ) throw new Error('世界扩写候选与当前 World、Work 或世界组不匹配。')
}

async function currentEvidence(scope: WorkspaceScope, candidate: WorldviewExpandCandidateV1) {
  const { group, worldview } = await readTarget(scope, candidate.worldGroupId)
  const groupSnapshot = worldGroupSnapshot(group)
  const viewSnapshot = worldviewSnapshot(worldview)
  const full = await assembleWorldviewExpandContext(scope, group)
  const external = await assembleWorldviewExpandContext(scope, group, ['manualText', 'worldGroups', 'storyCore'])
  const prompt = await promptEvidence(full.text)
  const nonTargetFresh = await hashCanonicalValue(nonTargetWorldviewFields(viewSnapshot)) === candidate.worldviewNonTargetHash
  const recordIdentityFresh = candidate.worldviewRecordId == null
    ? worldview == null
    : worldview?.id === candidate.worldviewRecordId
  const expectedMatches = !!worldview
    && (candidate.worldviewRecordId == null || worldview.id === candidate.worldviewRecordId)
    && WORLDVIEW_EXPAND_FIELDS_V1.every(field => worldview[field] === candidate.values[field])
    && nonTargetFresh
  return {
    groupSnapshot,
    groupFresh: await hashCanonicalValue(groupSnapshot) === candidate.worldGroupHash,
    baselineFresh: recordIdentityFresh
      && await hashCanonicalValue(viewSnapshot) === candidate.worldviewBaselineHash,
    nonTargetFresh,
    sourceFresh: await assemblyHash(full) === candidate.contextInputHash,
    externalFresh: await assemblyHash(external) === candidate.externalContextInputHash,
    promptFresh: prompt.promptHash === candidate.promptHash,
    templateFresh: prompt.promptTemplateHash === candidate.promptTemplateHash,
    expectedMatches,
  }
}

async function pauseUnsafeRun(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, reason: string) {
  if (snapshot.projection.state === 'running' || snapshot.projection.state === 'awaiting_confirmation') {
    return append(scope, snapshot, 'run.paused', { reason, recoverable: false })
  }
  return snapshot
}

async function assertFreshBeforeWrite(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: WorldviewExpandCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const evidence = await currentEvidence(scope, candidate)
  if (
    evidence.groupFresh
    && evidence.baselineFresh
    && evidence.sourceFresh
    && evidence.promptFresh
    && evidence.templateFresh
  ) return snapshot
  const reason = !evidence.groupFresh
    ? 'worldview-expand-world-group-changed'
    : !evidence.baselineFresh
      ? 'worldview-expand-baseline-changed'
      : !evidence.sourceFresh
        ? 'worldview-expand-context-changed'
        : 'worldview-expand-prompt-changed'
  const next = await append(scope, snapshot, 'candidate.staled', {
    stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    reason,
  })
  throw Object.assign(new Error('世界组草稿、正式世界观、Context 或 Prompt 已变化，请重新生成。'), { snapshot: next })
}

export async function generateWorldviewExpandCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: WorldviewExpandBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: WorldviewExpandCandidateV1 }> {
  if (!input.runAI && !input.aiConfig) throw new Error('世界扩写生成缺少 AI 配置。')
  const { group, worldview } = await readTarget(input.scope, input.worldGroupId)
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    contract: contract(input.scope, group),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: WORLDVIEW_EXPAND_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: WORLDVIEW_EXPAND_STEP_ID_V1, attempt: 1 })

  const assembled = await assembleWorldviewExpandContext(input.scope, group)
  const external = await assembleWorldviewExpandContext(input.scope, group, ['manualText', 'worldGroups', 'storyCore'])
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: [...WORLDVIEW_EXPAND_CONTEXT_SOURCE_KEYS_V1],
    assembled,
    readerVersion: 'worldview-expand-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
    attempt: 1,
    manifestHash: manifest.manifestHash,
  })
  const prompt = await promptEvidence(assembled.text)
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
  })
  let raw: string
  try {
    await input.onDurableBoundary?.('model.requested', snapshot)
    raw = await (input.runAI
      ? input.runAI(prompt.messages)
      : chat(prompt.messages, input.aiConfig!, {
          category: 'world-group.expand',
          projectId: input.scope.projectId,
          configOverrides: { maxTokens: getAgentSkillV1('world-origin.worldview-expand').maxOutputTokens },
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'worldview-expand-model-outcome-unknown')
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
    attempt: 1,
    outputHash: await hashCanonicalValue({ raw }),
  })
  try {
    await input.onDurableBoundary?.('model.responded', snapshot)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'worldview-expand-model-result-uncheckpointed')
    throw error
  }

  let values: ExpandedWorldview
  try {
    values = parseWorldExpandOutputStrictV1(raw)
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
      attempt: 1,
      code: 'worldview-expand-protocol-failed',
      retryable: false,
      category: 'protocol',
      action: 'fail',
    })
    await append(input.scope, snapshot, 'run.failed', { code: 'worldview-expand-protocol-failed', retryable: false })
    throw error
  }

  const groupSnapshot = worldGroupSnapshot(group)
  const viewSnapshot = worldviewSnapshot(worldview)
  const body = {
    version: 1 as const,
    kind: 'worldview-expand-candidate' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    worldGroupId: input.worldGroupId,
    worldGroupSnapshot: groupSnapshot,
    worldGroupHash: await hashCanonicalValue(groupSnapshot),
    worldviewRecordId: worldview?.id ?? null,
    worldviewBaseline: viewSnapshot,
    worldviewBaselineHash: await hashCanonicalValue(viewSnapshot),
    worldviewNonTargetFields: expectedNonTargetWorldviewFields(viewSnapshot),
    worldviewNonTargetHash: await hashCanonicalValue(expectedNonTargetWorldviewFields(viewSnapshot)),
    contextManifestHash: manifest.manifestHash,
    contextInputHash: await assemblyHash(assembled),
    externalContextInputHash: await assemblyHash(external),
    promptTemplateHash: prompt.promptTemplateHash,
    promptHash: prompt.promptHash,
    modelOutputHash: await hashCanonicalValue({ raw }),
    values,
    valuesHash: await hashCanonicalValue(values),
  }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
  await input.onDurableBoundary?.('candidate.persisted', snapshot)
  return { snapshot, candidate }
}

async function repairCandidateEventIfNeeded(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: WorldviewExpandCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const step = snapshot.projection.steps[WORLDVIEW_EXPAND_STEP_ID_V1]
  if (step?.candidateHash) return snapshot
  if (step?.status !== 'running') throw new Error('世界扩写候选事件无法安全重建。')
  return append(scope, snapshot, 'candidate.persisted', {
    stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
}

export async function readPendingWorldviewExpandCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: WorldviewExpandCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['awaiting_confirmation', 'running', 'verifying'].includes(row.status)
      && row.worldGroupId === input.worldGroupId
      && row.contractJson?.includes('world-origin.worldview-expand')
      && contractTargetsWorldGroup(row.contractJson, input.worldGroupId)
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const { candidate, intent } = await latestState(input.scope, row.id)
      assertCandidateTarget(input.scope, input.worldGroupId, snapshot, candidate)
      snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
      if (snapshot.projection.state === 'awaiting_confirmation' && !intent) return { snapshot, candidate }
    } catch {
      // Damaged or unrelated local run is not surfaced as a usable candidate.
    }
  }
  return null
}

export async function readRecoverableWorldviewExpandRunV1(input: {
  scope: WorkspaceScope
  worldGroupId: number
}): Promise<{
  snapshot: AgentRunSnapshotV1
  safeToResume: boolean
  candidate?: WorldviewExpandCandidateV1
  adoptionPending?: boolean
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(row.status)
      && row.worldGroupId === input.worldGroupId
      && row.contractJson?.includes('world-origin.worldview-expand')
      && contractTargetsWorldGroup(row.contractJson, input.worldGroupId)
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    try {
      const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, row.id)
      if (checkpoint) {
        const state = await parseState(checkpoint.resumePayload)
        if (state.candidate.worldGroupId === input.worldGroupId) {
          return {
            snapshot,
            safeToResume: true,
            candidate: state.candidate,
            adoptionPending: state.intent != null,
          }
        }
      }
    } catch {
      // Conservative unsafe result below.
    }
    return { snapshot, safeToResume: false }
  }
  return null
}

async function writeFormalValues(
  scope: WorkspaceScope,
  candidate: WorldviewExpandCandidateV1,
): Promise<void> {
  await db.transaction(
    'rw',
    scopeTransactionTables(db.worldGroups, db.worldviews, db.temporalFacts),
    async () => {
      const group = await db.worldGroups.get(candidate.worldGroupId)
      if (!group?.id || canonicalStringify(worldGroupSnapshot(group as WorldGroup & { id: number })) !== canonicalStringify(candidate.worldGroupSnapshot)) {
        throw new Error('世界扩写 CAS 失败：目标世界组已变化。')
      }
      const rows = await db.worldviews.where('projectId').equals(scope.projectId).toArray()
      const worldview = rows.find(row => row.worldGroupId === candidate.worldGroupId) ?? null
      if ((worldview?.id ?? null) !== candidate.worldviewRecordId) {
        throw new Error('世界扩写 CAS 失败：目标世界观记录身份已变化。')
      }
      if (canonicalStringify(worldviewSnapshot(worldview)) !== canonicalStringify(candidate.worldviewBaseline)) {
        throw new Error('世界扩写 CAS 失败：正式世界观已变化。')
      }
      const result = await adopt({
        projectId: scope.projectId,
        scope,
        worldGroupId: candidate.worldGroupId,
        target: 'worldviews',
        mode: 'replace',
        data: { ...candidate.values },
      })
      const written = result.written[0]
      if (
        result.written.length !== 1
        || result.unknown.length
        || result.typeErrors.length
        || result.fkErrors.length
        || result.skipped.length
        || !WORLDVIEW_EXPAND_FIELDS_V1.every(field => written.fields.includes(field))
      ) throw new Error(result.skipped[0]?.reason ?? '世界扩写候选没有完整通过字段注册表校验。')
    },
  )
}

export async function adoptWorldviewExpandCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number
  runId: number
  onDurableBoundary?: (boundary: WorldviewExpandBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: WorldviewExpandCandidateV1; receiptHash: string }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  let intent = state.intent
  assertCandidateTarget(input.scope, input.worldGroupId, snapshot, candidate)

  let evidence = await currentEvidence(input.scope, candidate)
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    if (!evidence.expectedMatches || !evidence.groupFresh || !evidence.externalFresh || !evidence.templateFresh) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: snapshot.run.id,
        reason: 'worldview-expand-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'worldview-expand-terminal-evidence-stale',
      })
      throw new Error('世界扩写完成回执已过期；正式字段或外部来源已变化。')
    }
    return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  }

  if (snapshot.projection.state === 'awaiting_confirmation') {
    snapshot = await assertFreshBeforeWrite(input.scope, snapshot, candidate)
    if (!intent) {
      const body = {
        version: 1 as const,
        kind: 'worldview-expand-adoption-intent' as const,
        portable: false as const,
        candidate,
      }
      intent = { ...body, intentHash: await hashCanonicalValue(body) }
      const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })
      snapshot = saved.snapshot
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (snapshot.projection.steps[WORLDVIEW_EXPAND_STEP_ID_V1]?.confirmation !== 'adopt' || !intent) {
    throw new Error('世界扩写候选不在可恢复采纳状态。')
  }

  let adoptionHash = snapshot.projection.steps[WORLDVIEW_EXPAND_STEP_ID_V1]?.adoptionHash
  if (!adoptionHash) {
    evidence = await currentEvidence(input.scope, candidate)
    if (!evidence.expectedMatches) {
      snapshot = await assertFreshBeforeWrite(input.scope, snapshot, candidate)
      await writeFormalValues(input.scope, candidate)
      evidence = await currentEvidence(input.scope, candidate)
    }
    if (!evidence.expectedMatches) {
      await pauseUnsafeRun(input.scope, snapshot, 'worldview-expand-formal-state-diverged')
      throw new Error('正式世界观与冻结扩写意图不一致。')
    }
    await input.onDurableBoundary?.('formal.written', snapshot)
    adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      worldGroupId: candidate.worldGroupId,
      valuesHash: candidate.valuesHash,
    })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }

  evidence = await currentEvidence(input.scope, candidate)
  if (!evidence.expectedMatches || !evidence.groupFresh || !evidence.externalFresh || !evidence.templateFresh) {
    await pauseUnsafeRun(input.scope, snapshot, 'worldview-expand-terminal-evidence-stale')
    throw new Error('正式写入后七字段、非目标字段或外部来源变化，本次回执不会通过终验。')
  }
  if (snapshot.projection.steps[WORLDVIEW_EXPAND_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
      attempt: 1,
      outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: WORLDVIEW_EXPAND_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const postStateHash = await hashCanonicalValue({
    worldGroupId: candidate.worldGroupId,
    valuesHash: candidate.valuesHash,
    externalContextInputHash: candidate.externalContextInputHash,
    worldviewNonTargetHash: candidate.worldviewNonTargetHash,
  })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [candidate.contextManifestHash],
    candidateHashes: [candidate.candidateHash],
    adoptionEventIds: [],
    postStateHash,
    verifierSetVersion: WORLDVIEW_EXPAND_VERIFIER_SET_V1,
    criteria: [
      { id: 'worldview-expand.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'worldview-expand.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'worldview-expand.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function rejectWorldviewExpandCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate } = await latestState(input.scope, input.runId)
  assertCandidateTarget(input.scope, input.worldGroupId, snapshot, candidate)
  if (snapshot.projection.state !== 'awaiting_confirmation') throw new Error('世界扩写候选不在等待确认状态。')
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: WORLDVIEW_EXPAND_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-worldview-expand' })
}

export async function abandonWorldviewExpandRunV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(snapshot.projection.state)) {
    throw new Error('世界扩写运行不在可放弃状态。')
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-worldview-expand' })
}
