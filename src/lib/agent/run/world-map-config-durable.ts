import { chat } from '../../ai/client'
import {
  buildVoronoiMapPromptFromRegisteredContextV1,
  parseVoronoiMapConfigStrictV1,
  readVoronoiMapPromptTemplateSnapshotV1,
} from '../../ai/adapters/voronoi-map-adapter'
import type { AIConfig, ChatMessage, WorkspaceScope, WorldNode } from '../../types'
import type { MapGenConfig } from '../../world-map/engine'
import { assembleContext } from '../../registry/assemble-context'
import { adopt, hashAdoptFieldValueV1 } from '../../registry/adopt'
import { db } from '../../db/schema'
import { assertRecordInScope, readOwnedRows } from '../../world-engine/scope'
import { getAgentSkillV1 } from '../skill-registry'
import { createAgentSkillExecutionBindingV1 } from '../execution-binding'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  staleAgentRunVerificationV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { createVerificationReceiptV1 } from './verification-receipt'
import { canonicalStringify, hashCanonicalValue } from './hash'

export const WORLD_MAP_CONFIG_STEP_ID_V1 = 'world-origin:map-config' as const
export const WORLD_MAP_CONFIG_VERIFIER_SET_V1 = 'world-map-config-terminal-v1' as const
export const WORLD_MAP_CONTEXT_SOURCE_KEYS_V1 = ['worldview', 'geography', 'codex', 'locations'] as const

type RunAI = (messages: ChatMessage[]) => Promise<string>

export interface WorldMapConfigCandidateV1 {
  version: 1
  kind: 'world-map-config-candidate'
  portable: false
  projectId: number
  worldId: number
  workId: number
  worldGroupId: number | null
  worldNodeId: number
  worldNodeName: string
  worldNodeNameHash: string
  originalConfigHash: string
  contextManifestHash: string
  contextInputHash: string
  promptTemplateHash: string
  promptHash: string
  modelOutputHash: string
  mapConfig: MapGenConfig
  mapConfigJSON: string
  mapConfigHash: string
  candidateHash: string
}

interface WorldMapConfigAdoptionIntentV1 {
  version: 1
  kind: 'world-map-config-adoption-intent'
  portable: false
  candidate: WorldMapConfigCandidateV1
  intentHash: string
}

export type WorldMapConfigBoundaryV1 =
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
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) {
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

function sameWorldGroup(left: number | null | undefined, right: number | null | undefined): boolean {
  return (left ?? null) === (right ?? null)
}

function contractTargetsWorldNode(contractJson: unknown, worldNodeId: number): boolean {
  if (typeof contractJson !== 'string') return false
  try {
    const objective = (JSON.parse(contractJson) as Record<string, unknown>).objective
    return typeof objective === 'string' && objective.startsWith(`为世界节点 #${worldNodeId} `)
  } catch {
    return false
  }
}

async function readTargetNode(
  scope: WorkspaceScope,
  worldGroupId: number | null,
  worldNodeId: number,
): Promise<WorldNode & { id: number }> {
  const node = await db.worldNodes.get(worldNodeId)
  if (
    !node?.id
    || !await assertRecordInScope(scope, 'worldNodes', node, { owner: 'world' })
    || !sameWorldGroup(node.worldGroupId, worldGroupId)
  ) throw new Error('目标世界节点不存在或不属于当前 World/世界组。')
  return node as WorldNode & { id: number }
}

function contract(scope: WorkspaceScope, worldGroupId: number | null, node: WorldNode & { id: number }) {
  const skill = getAgentSkillV1('world-origin.map-config', 'world-origin')
  return {
    version: 1 as const,
    objective: `为世界节点 #${node.id} “${node.name}”生成可确认地图配置`,
    workflowKind: 'plan-execute' as const,
    scope: { projectId: scope.projectId, worldGroupId },
    permissions: {
      contextSourceKeys: [...WORLD_MAP_CONTEXT_SOURCE_KEYS_V1],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table,
        fields: [...target.fields],
        mode: 'author-confirmed' as const,
      })),
    },
    executionBindings: [{ stepId: WORLD_MAP_CONFIG_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 30_000,
      maxOutputTokens: skill.maxOutputTokens,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'world-map.candidate', kind: 'output-present' as const, required: true },
      { id: 'world-map.author', kind: 'author-confirmed' as const, required: true },
      { id: 'world-map.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'world-map.terminal',
      kind: 'terminal' as const,
      verifier: WORLD_MAP_CONFIG_VERIFIER_SET_V1,
      criterionIds: ['world-map.candidate', 'world-map.author', 'world-map.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

async function assembleWorldMapContext(scope: WorkspaceScope, worldGroupId: number | null) {
  return assembleContext({
    projectId: scope.projectId,
    scope,
    worldGroupId,
    sourceKeys: [...WORLD_MAP_CONTEXT_SOURCE_KEYS_V1],
    inputBudgetTokens: 30_000,
  })
}

async function promptEvidence(contextText: string, nodeName: string) {
  const messages = buildVoronoiMapPromptFromRegisteredContextV1(contextText, nodeName)
  return {
    messages,
    promptTemplateHash: await hashCanonicalValue(readVoronoiMapPromptTemplateSnapshotV1()),
    promptHash: await hashCanonicalValue(messages),
  }
}

async function contextInputHash(assembled: Awaited<ReturnType<typeof assembleWorldMapContext>>): Promise<string> {
  return hashCanonicalValue({ text: assembled.text, sourceEvidence: assembled.sourceEvidence })
}

async function parseCandidate(value: unknown): Promise<WorldMapConfigCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('世界地图候选检查点无效。')
  const row = value as Record<string, any>
  const keys = [
    'version', 'kind', 'portable', 'projectId', 'worldId', 'workId', 'worldGroupId',
    'worldNodeId', 'worldNodeName', 'worldNodeNameHash', 'originalConfigHash',
    'contextManifestHash', 'contextInputHash', 'promptTemplateHash', 'promptHash',
    'modelOutputHash', 'mapConfig', 'mapConfigJSON', 'mapConfigHash', 'candidateHash',
  ] as const
  assertExactKeys(row, keys, '世界地图候选')
  if (
    row.version !== 1
    || row.kind !== 'world-map-config-candidate'
    || row.portable !== false
    || ![row.projectId, row.worldId, row.workId, row.worldNodeId].every(Number.isInteger)
    || (row.worldGroupId !== null && !Number.isInteger(row.worldGroupId))
    || typeof row.worldNodeName !== 'string'
    || typeof row.mapConfigJSON !== 'string'
    || ![
      row.worldNodeNameHash, row.originalConfigHash, row.contextManifestHash,
      row.contextInputHash, row.promptTemplateHash, row.promptHash, row.modelOutputHash,
      row.mapConfigHash, row.candidateHash,
    ].every(isHash)
  ) throw new Error('世界地图候选检查点不完整。')
  let parsedConfig: unknown
  try { parsedConfig = JSON.parse(row.mapConfigJSON) } catch { throw new Error('世界地图候选配置 JSON 损坏。') }
  if (
    canonicalStringify(row.mapConfig) !== row.mapConfigJSON
    || canonicalStringify(parsedConfig) !== row.mapConfigJSON
    || await hashCanonicalValue(row.mapConfig) !== row.mapConfigHash
    || await hashCanonicalValue({ name: row.worldNodeName }) !== row.worldNodeNameHash
  ) throw new Error('世界地图候选内部证据不一致。')
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('世界地图候选 hash 不匹配。')
  return row as WorldMapConfigCandidateV1
}

async function parseState(value: unknown): Promise<{
  candidate: WorldMapConfigCandidateV1
  intent: WorldMapConfigAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'world-map-config-adoption-intent') {
    const row = value as Record<string, any>
    assertExactKeys(row, ['version', 'kind', 'portable', 'candidate', 'intentHash'], '世界地图采纳意图')
    if (row.version !== 1 || row.portable !== false || !isHash(row.intentHash)) throw new Error('世界地图采纳意图无效。')
    const candidate = await parseCandidate(row.candidate)
    const body = { version: 1 as const, kind: 'world-map-config-adoption-intent' as const, portable: false as const, candidate }
    if (await hashCanonicalValue(body) !== row.intentHash) throw new Error('世界地图采纳意图 hash 不匹配。')
    return { candidate, intent: row as WorldMapConfigAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('世界地图运行缺少可验证检查点。')
  return parseState(checkpoint.resumePayload)
}

function assertCandidateTarget(
  scope: WorkspaceScope,
  worldGroupId: number | null,
  snapshot: AgentRunSnapshotV1,
  candidate: WorldMapConfigCandidateV1,
): void {
  if (
    candidate.projectId !== scope.projectId
    || candidate.worldId !== scope.worldId
    || candidate.workId !== scope.workId
    || snapshot.run.projectId !== scope.projectId
    || !sameWorldGroup(snapshot.run.worldGroupId, worldGroupId)
    || !sameWorldGroup(candidate.worldGroupId, worldGroupId)
  ) throw new Error('世界地图候选与当前 World、Work 或世界组不匹配。')
}

async function currentEvidence(scope: WorkspaceScope, candidate: WorldMapConfigCandidateV1) {
  const node = await readTargetNode(scope, candidate.worldGroupId, candidate.worldNodeId)
  const assembled = await assembleWorldMapContext(scope, candidate.worldGroupId)
  const prompt = await promptEvidence(assembled.text, node.name)
  const currentConfigHash = await hashAdoptFieldValueV1(node.mapConfigJSON)
  return {
    node,
    sourceFresh: await contextInputHash(assembled) === candidate.contextInputHash,
    nodeNameFresh: await hashCanonicalValue({ name: node.name }) === candidate.worldNodeNameHash,
    promptFresh: prompt.promptTemplateHash === candidate.promptTemplateHash && prompt.promptHash === candidate.promptHash,
    baselineFresh: currentConfigHash === candidate.originalConfigHash,
    expectedMatches: node.mapConfigJSON === candidate.mapConfigJSON,
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
  candidate: WorldMapConfigCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const evidence = await currentEvidence(scope, candidate)
  if (evidence.sourceFresh && evidence.nodeNameFresh && evidence.promptFresh && evidence.baselineFresh) return snapshot
  const reason = !evidence.baselineFresh
    ? 'world-map-config-baseline-changed'
    : !evidence.nodeNameFresh
      ? 'world-map-config-node-name-changed'
      : !evidence.sourceFresh
        ? 'world-map-config-context-changed'
        : 'world-map-config-prompt-changed'
  const next = await append(scope, snapshot, 'candidate.staled', {
    stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    reason,
  })
  throw Object.assign(new Error('世界地图来源、节点名称、Prompt 或正式配置已变化，请重新生成。'), { snapshot: next })
}

export async function generateWorldMapConfigCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  worldNodeId: number
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: WorldMapConfigBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: WorldMapConfigCandidateV1 }> {
  if (!input.runAI && !input.aiConfig) throw new Error('世界地图生成缺少 AI 配置。')
  const node = await readTargetNode(input.scope, input.worldGroupId, input.worldNodeId)
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    contract: contract(input.scope, input.worldGroupId, node),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: WORLD_MAP_CONFIG_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: WORLD_MAP_CONFIG_STEP_ID_V1, attempt: 1 })

  const assembled = await assembleWorldMapContext(input.scope, input.worldGroupId)
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: [...WORLD_MAP_CONTEXT_SOURCE_KEYS_V1],
    assembled,
    readerVersion: 'world-map-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
    attempt: 1,
    manifestHash: manifest.manifestHash,
  })
  const prompt = await promptEvidence(assembled.text, node.name)
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
  })
  let raw: string
  try {
    await input.onDurableBoundary?.('model.requested', snapshot)
    raw = await (input.runAI
      ? input.runAI(prompt.messages)
      : chat(prompt.messages, input.aiConfig!, {
          category: 'geography.world-map',
          projectId: input.scope.projectId,
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'world-map-model-outcome-unknown')
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
    attempt: 1,
    outputHash: await hashCanonicalValue({ raw }),
  })
  try {
    await input.onDurableBoundary?.('model.responded', snapshot)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'world-map-model-result-uncheckpointed')
    throw error
  }

  let mapConfig: MapGenConfig
  try {
    mapConfig = parseVoronoiMapConfigStrictV1(raw, assembled.text)
    if (mapConfig.mapName !== node.name) throw new Error('模型返回的 mapName 与冻结目标世界节点名称不一致。')
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
      attempt: 1,
      code: 'world-map-protocol-failed',
      retryable: false,
      category: 'protocol',
      action: 'fail',
    })
    await append(input.scope, snapshot, 'run.failed', { code: 'world-map-protocol-failed', retryable: false })
    throw error
  }

  const mapConfigJSON = canonicalStringify(mapConfig)
  const body = {
    version: 1 as const,
    kind: 'world-map-config-candidate' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    worldGroupId: input.worldGroupId,
    worldNodeId: node.id,
    worldNodeName: node.name,
    worldNodeNameHash: await hashCanonicalValue({ name: node.name }),
    originalConfigHash: await hashAdoptFieldValueV1(node.mapConfigJSON),
    contextManifestHash: manifest.manifestHash,
    contextInputHash: await contextInputHash(assembled),
    promptTemplateHash: prompt.promptTemplateHash,
    promptHash: prompt.promptHash,
    modelOutputHash: await hashCanonicalValue({ raw }),
    mapConfig,
    mapConfigJSON,
    mapConfigHash: await hashCanonicalValue(mapConfig),
  }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
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
  candidate: WorldMapConfigCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const step = snapshot.projection.steps[WORLD_MAP_CONFIG_STEP_ID_V1]
  if (step?.candidateHash) return snapshot
  if (step?.status !== 'running') throw new Error('世界地图候选事件无法安全重建。')
  return append(scope, snapshot, 'candidate.persisted', {
    stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
}

export async function readPendingWorldMapConfigCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  worldNodeId: number
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: WorldMapConfigCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['awaiting_confirmation', 'running', 'verifying'].includes(row.status)
      && sameWorldGroup(row.worldGroupId, input.worldGroupId)
      && row.contractJson?.includes('world-origin.map-config')
      && contractTargetsWorldNode(row.contractJson, input.worldNodeId)
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const state = await latestState(input.scope, row.id)
      assertCandidateTarget(input.scope, input.worldGroupId, snapshot, state.candidate)
      if (state.candidate.worldNodeId !== input.worldNodeId) continue
      snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, state.candidate)
      return { snapshot, candidate: state.candidate }
    } catch {
      // Damaged or out-of-scope historical runs remain auditable, not resumable.
    }
  }
  return null
}

export async function readRecoverableWorldMapConfigRunV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  worldNodeId: number
}): Promise<{ snapshot: AgentRunSnapshotV1; safeToResume: boolean } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['running', 'paused'].includes(row.status)
      && sameWorldGroup(row.worldGroupId, input.worldGroupId)
      && row.contractJson?.includes('world-origin.map-config')
      && contractTargetsWorldNode(row.contractJson, input.worldNodeId)
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    try {
      const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, row.id)
      if (checkpoint) {
        const state = await parseState(checkpoint.resumePayload)
        if (state.candidate.worldNodeId !== input.worldNodeId) continue
        return { snapshot, safeToResume: true }
      }
    } catch {
      // Fall through to conservative unsafe result.
    }
    return { snapshot, safeToResume: false }
  }
  return null
}

export async function adoptWorldMapConfigCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  runId: number
  onDurableBoundary?: (boundary: WorldMapConfigBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: WorldMapConfigCandidateV1; receiptHash: string }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  let intent = state.intent
  assertCandidateTarget(input.scope, input.worldGroupId, snapshot, candidate)

  let evidence = await currentEvidence(input.scope, candidate)
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    if (!evidence.expectedMatches || !evidence.sourceFresh || !evidence.nodeNameFresh || !evidence.promptFresh) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: snapshot.run.id,
        reason: 'world-map-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'world-map-terminal-evidence-stale',
      })
      throw new Error('世界地图完成回执已过期；正式配置、来源、节点名或 Prompt 已变化。')
    }
    return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  }

  if (snapshot.projection.state === 'awaiting_confirmation') {
    snapshot = await assertFreshBeforeWrite(input.scope, snapshot, candidate)
    if (!intent) {
      const body = {
        version: 1 as const,
        kind: 'world-map-config-adoption-intent' as const,
        portable: false as const,
        candidate,
      }
      intent = { ...body, intentHash: await hashCanonicalValue(body) }
      const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })
      snapshot = saved.snapshot
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (snapshot.projection.steps[WORLD_MAP_CONFIG_STEP_ID_V1]?.confirmation !== 'adopt' || !intent) {
    throw new Error('世界地图候选不在可恢复采纳状态。')
  }

  let adoptionHash = snapshot.projection.steps[WORLD_MAP_CONFIG_STEP_ID_V1]?.adoptionHash
  if (!adoptionHash) {
    evidence = await currentEvidence(input.scope, candidate)
    if (!evidence.expectedMatches) {
      snapshot = await assertFreshBeforeWrite(input.scope, snapshot, candidate)
      const result = await adopt({
        projectId: input.scope.projectId,
        scope: input.scope,
        target: 'worldNodes',
        recordId: candidate.worldNodeId,
        mode: 'replace',
        data: { mapConfigJSON: candidate.mapConfigJSON },
        compareAndSet: {
          kind: 'record-field-value-hash',
          field: 'mapConfigJSON',
          expectedHash: candidate.originalConfigHash,
        },
      })
      if (!result.written.some(row => row.id === candidate.worldNodeId && row.fields.includes('mapConfigJSON'))) {
        throw new Error(result.skipped[0]?.reason ?? '世界地图候选未写入目标节点。')
      }
      evidence = await currentEvidence(input.scope, candidate)
    }
    if (!evidence.expectedMatches) {
      await pauseUnsafeRun(input.scope, snapshot, 'world-map-formal-state-diverged')
      throw new Error('正式地图配置与冻结意图不一致。')
    }
    await input.onDurableBoundary?.('formal.written', snapshot)
    adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      worldNodeId: candidate.worldNodeId,
      mapConfigHash: candidate.mapConfigHash,
    })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }

  evidence = await currentEvidence(input.scope, candidate)
  if (!evidence.expectedMatches || !evidence.sourceFresh || !evidence.nodeNameFresh || !evidence.promptFresh) {
    await pauseUnsafeRun(input.scope, snapshot, 'world-map-terminal-evidence-stale')
    throw new Error('正式写入后地图配置、来源、节点名或 Prompt 变化，本次回执不会通过终验。')
  }
  if (snapshot.projection.steps[WORLD_MAP_CONFIG_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
      attempt: 1,
      outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: WORLD_MAP_CONFIG_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const postStateHash = await hashCanonicalValue({
    worldNodeId: candidate.worldNodeId,
    mapConfigHash: candidate.mapConfigHash,
    contextInputHash: candidate.contextInputHash,
    promptHash: candidate.promptHash,
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
    verifierSetVersion: WORLD_MAP_CONFIG_VERIFIER_SET_V1,
    criteria: [
      { id: 'world-map.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'world-map.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'world-map.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function rejectWorldMapConfigCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate } = await latestState(input.scope, input.runId)
  assertCandidateTarget(input.scope, input.worldGroupId, snapshot, candidate)
  if (snapshot.projection.state !== 'awaiting_confirmation') throw new Error('世界地图候选不在等待确认状态。')
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: WORLD_MAP_CONFIG_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-world-map-config' })
}

export async function abandonWorldMapConfigRunV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(snapshot.projection.state)) {
    throw new Error('世界地图运行不在可放弃状态。')
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-world-map-config' })
}
