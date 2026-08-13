import { db } from '../../db/schema'
import type { AIConfig, Character, CharacterRelation, ChatMessage, WorkspaceScope } from '../../types'
import { chat } from '../../ai/client'
import { assembleContext } from '../../registry/assemble-context'
import { adopt } from '../../registry/adopt'
import { readOwnedRows } from '../../world-engine/scope'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../../ai/prompt-engine'
import { matchRelations, type ExtractedRelation, type MatchedRelation } from '../../ai/relation-extractor'
import { syncRelationToCharacterFields } from '../../relations/relationship-summary'
import { getAgentSkillV1 } from '../skill-registry'
import { createAgentSkillExecutionBindingV1 } from '../execution-binding'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'

export const CHARACTER_RELATIONSHIP_STEP_ID_V1 = 'character:relationships' as const
export const CHARACTER_RELATIONSHIP_VERIFIER_SET_V1 = 'character-relationships-terminal-v1' as const
const SOURCE_KEYS = ['characters', 'characterRelations', 'outlineSummaries', 'writtenChapters'] as const
const RELATION_TYPES = new Set(['family', 'lover', 'friend', 'rival', 'enemy', 'master', 'student', 'ally', 'subordinate', 'other'])

export interface CharacterRelationshipCandidateV1 {
  version: 1
  kind: 'character-relationship-candidate'
  portable: false
  rosterHash: string
  relationHash: string
  contextManifestHash: string
  relations: MatchedRelation[]
  candidateHash: string
}

export interface CharacterRelationshipCandidateRunV1 {
  snapshot: AgentRunSnapshotV1
  candidate: CharacterRelationshipCandidateV1
}

export type CharacterRelationshipAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface CharacterRelationshipAdoptionIntentV1 {
  version: 1
  kind: 'character-relationship-adoption-intent'
  portable: false
  candidate: CharacterRelationshipCandidateV1
  selectedIndexes: number[]
  intentHash: string
}

type RunAI = (messages: ChatMessage[]) => Promise<string>

export function parseCharacterRelationshipCandidateDraftV1(output: string): ExtractedRelation[] {
  let source = output.trim()
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenced) source = fenced[1]
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('角色关系模型输出不是有效 JSON 数组。')
  }
  if (!Array.isArray(parsed)) throw new Error('角色关系模型输出必须是 JSON 数组。')
  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`角色关系候选 ${index + 1} 不是对象。`)
    const row = value as Record<string, unknown>
    const keys = ['char1', 'char2', 'type', 'label', 'description', 'bidirectional']
    if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) {
      throw new Error(`角色关系候选 ${index + 1} 字段不在允许闭集。`)
    }
    if (
      typeof row.char1 !== 'string' || !row.char1.trim()
      || typeof row.char2 !== 'string' || !row.char2.trim()
      || typeof row.type !== 'string' || !RELATION_TYPES.has(row.type)
      || typeof row.label !== 'string'
      || typeof row.description !== 'string'
      || typeof row.bidirectional !== 'boolean'
    ) throw new Error(`角色关系候选 ${index + 1} 字段类型或枚举无效。`)
    return {
      char1: row.char1.trim(), char2: row.char2.trim(), type: row.type as ExtractedRelation['type'],
      label: row.label.trim(), description: row.description.trim(), bidirectional: row.bidirectional,
    }
  })
}

function matchRelationsStrict(
  extracted: ExtractedRelation[],
  characters: Character[],
  existing: CharacterRelation[],
): MatchedRelation[] {
  const byName = new Map<string, Character[]>()
  for (const character of characters) {
    const key = character.name.trim()
    if (!key) continue
    byName.set(key, [...(byName.get(key) ?? []), character])
  }
  for (const relation of extracted) {
    if ((byName.get(relation.char1)?.length ?? 0) !== 1 || (byName.get(relation.char2)?.length ?? 0) !== 1) {
      throw new Error(`角色关系候选无法唯一精确匹配：${relation.char1} / ${relation.char2}。`)
    }
  }
  return matchRelations(extracted, characters, existing)
}

async function append(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: any,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope, runId: snapshot.run.id, type, payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as any)
}

function stableCharacter(row: Character) {
  return { id: row.id, name: row.name, roleWeight: row.roleWeight, shortDescription: row.shortDescription ?? '' }
}

function stableRelation(row: CharacterRelation) {
  return {
    id: row.id, fromCharacterId: row.fromCharacterId, toCharacterId: row.toCharacterId,
    relationType: row.relationType, label: row.label, description: row.description,
    isBidirectional: row.isBidirectional,
  }
}

async function baseline(scope: WorkspaceScope, worldGroupId: number | null) {
  const [characters, relations] = await Promise.all([
    readOwnedRows<Character>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<CharacterRelation>(scope, 'characterRelations', { owner: 'world' }),
  ])
  const orderedCharacters = characters
    .filter(character => character.isCrossWorld || (character.homeWorldGroupId ?? null) === worldGroupId)
    .sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
  const visibleIds = new Set(orderedCharacters.flatMap(character => character.id == null ? [] : [character.id]))
  const orderedRelations = relations
    .filter(relation => visibleIds.has(relation.fromCharacterId) && visibleIds.has(relation.toCharacterId))
    .sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
  return {
    characters: orderedCharacters,
    relations: orderedRelations,
    rosterHash: await hashCanonicalValue(orderedCharacters.map(stableCharacter)),
    relationHash: await hashCanonicalValue(orderedRelations.map(stableRelation)),
  }
}

async function parseCandidate(value: unknown): Promise<CharacterRelationshipCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('角色关系候选检查点无效。')
  const row = value as Record<string, any>
  if (
    row.version !== 1 || row.kind !== 'character-relationship-candidate' || row.portable !== false
    || !Array.isArray(row.relations) || !/^[a-f0-9]{64}$/.test(row.rosterHash)
    || !/^[a-f0-9]{64}$/.test(row.relationHash) || !/^[a-f0-9]{64}$/.test(row.contextManifestHash)
    || !/^[a-f0-9]{64}$/.test(row.candidateHash)
  ) throw new Error('角色关系候选检查点不完整。')
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('角色关系候选 hash 不匹配。')
  return row as CharacterRelationshipCandidateV1
}

async function parseResumeState(value: unknown): Promise<{
  candidate: CharacterRelationshipCandidateV1
  intent: CharacterRelationshipAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'character-relationship-adoption-intent') {
    const row = value as Record<string, any>
    if (
      row.version !== 1 || row.portable !== false || !Array.isArray(row.selectedIndexes)
      || row.selectedIndexes.length === 0
      || row.selectedIndexes.some((index: unknown) => !Number.isInteger(index) || (index as number) < 0)
      || new Set(row.selectedIndexes).size !== row.selectedIndexes.length
      || row.selectedIndexes.some((index: number, position: number) => position > 0 && row.selectedIndexes[position - 1] >= index)
      || !/^[a-f0-9]{64}$/.test(row.intentHash)
    ) throw new Error('角色关系采纳意图检查点无效。')
    const candidate = await parseCandidate(row.candidate)
    if (row.selectedIndexes.some((index: number) => index >= candidate.relations.length)) {
      throw new Error('角色关系采纳意图选择越界。')
    }
    const body = {
      version: 1 as const, kind: 'character-relationship-adoption-intent' as const, portable: false as const,
      candidate, selectedIndexes: row.selectedIndexes,
    }
    if (await hashCanonicalValue(body) !== row.intentHash) throw new Error('角色关系采纳意图 hash 不匹配。')
    return { candidate, intent: row as CharacterRelationshipAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('角色关系候选缺少可验证检查点。')
  return parseResumeState(checkpoint.resumePayload)
}

function contract(scope: WorkspaceScope, worldGroupId: number | null) {
  const skill = getAgentSkillV1('character.relationships', 'character')
  return {
    version: 1 as const,
    objective: '从当前角色、关系、大纲和已写正文提取角色关系候选',
    workflowKind: 'plan-execute' as const,
    scope: { projectId: scope.projectId, worldGroupId },
    permissions: {
      contextSourceKeys: [...SOURCE_KEYS],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table, fields: [...target.fields], mode: 'author-confirmed' as const,
      })),
    },
    executionBindings: [{ stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 24_000, maxOutputTokens: 4_000,
      maxAttemptsPerStep: 1, maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'character-relationships.candidate', kind: 'output-present' as const, required: true },
      { id: 'character-relationships.author', kind: 'author-confirmed' as const, required: true },
      { id: 'character-relationships.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'character-relationships.terminal', kind: 'terminal' as const,
      verifier: CHARACTER_RELATIONSHIP_VERIFIER_SET_V1,
      criterionIds: ['character-relationships.candidate', 'character-relationships.author', 'character-relationships.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

/** Generate and durably persist a relationship candidate; business data stays untouched. */
export async function generateCharacterRelationshipCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  runAI?: RunAI
  aiConfig?: AIConfig
}): Promise<CharacterRelationshipCandidateRunV1> {
  const before = await baseline(input.scope, input.worldGroupId)
  if (before.characters.length < 2) throw new Error('至少需要两个当前 World 的角色。')
  let snapshot = await createAgentRunV1({
    scope: input.scope, worldGroupId: input.worldGroupId, contract: contract(input.scope, input.worldGroupId),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, attempt: 1 })
  const assembled = await assembleContext({
    projectId: input.scope.projectId, scope: input.scope, worldGroupId: input.worldGroupId,
    sourceKeys: [...SOURCE_KEYS], inputBudgetMaxTokens: 24_000,
  })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id, stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, attempt: 1,
    projectId: input.scope.projectId, worldGroupId: input.worldGroupId,
    declaredSourceKeys: [...SOURCE_KEYS], assembled, readerVersion: 'character-relationships-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, attempt: 1, manifestHash: manifest.manifestHash,
  })
  const tpl = usePromptStore.getState().getActive('relation.extract')
  const { messages } = renderPrompt(tpl, {
    projectName: (await db.projects.get(input.scope.projectId))?.name ?? '未命名项目',
    characterList: assembled.segments.find(segment => segment.label === '角色档案')?.content ?? '',
    outlineSummary: assembled.segments.find(segment => segment.label === '大纲标题与摘要（分析）')?.content ?? '',
    chapterContent: assembled.segments.find(segment => segment.label === '已写章节正文（分析摘录）')?.content ?? '',
  })
  const binding = snapshot.contract.executionBindings?.[0]
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, attempt: 1, bindingHash: await hashCanonicalValue(binding),
  })
  const raw = await (input.runAI
    ? input.runAI(messages)
    : chat(messages, input.aiConfig!, { category: 'relation.extract', projectId: input.scope.projectId }))
  const outputHash = await hashCanonicalValue({ raw })
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, attempt: 1, outputHash,
  })
  const matched = matchRelationsStrict(parseCharacterRelationshipCandidateDraftV1(raw), before.characters, before.relations)
  const body = {
    version: 1 as const, kind: 'character-relationship-candidate' as const, portable: false as const,
    rosterHash: before.rosterHash, relationHash: before.relationHash,
    contextManifestHash: manifest.manifestHash, relations: matched,
  }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, attempt: 1,
    candidateHash: candidate.candidateHash, requiresConfirmation: true,
  })
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate })
  return { snapshot: saved.snapshot, candidate }
}

/** Recover the latest pending candidate for the current Work. */
export async function readPendingCharacterRelationshipCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
}): Promise<CharacterRelationshipCandidateRunV1 | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      (row.status === 'awaiting_confirmation' || row.status === 'running' || row.status === 'verifying')
      && (row.worldGroupId ?? null) === input.worldGroupId
      && row.contractJson?.includes('character.relationships')
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      const snapshot = await readAgentRunV1(input.scope, row.id)
      const { candidate } = await latestState(input.scope, row.id)
      return { snapshot, candidate }
    } catch {
      // Damaged historical candidates remain auditable but are not recoverable.
    }
  }
  return null
}

/** Author-confirm selected relations, adopt through registries, then verify formal post-state. */
export async function adoptCharacterRelationshipCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  selectedIndexes: number[]
  onDurableBoundary?: (
    boundary: CharacterRelationshipAdoptionBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; written: number }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate, intent: persistedIntent } = await latestState(input.scope, input.runId)
  let intent = persistedIntent
  const indexes = [...new Set(input.selectedIndexes)].sort((left, right) => left - right)
  if (!indexes.length || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= candidate.relations.length)) {
    throw new Error('请选择有效的角色关系候选。')
  }
  if (intent && JSON.stringify(intent.selectedIndexes) !== JSON.stringify(indexes)) {
    throw new Error('角色关系采纳选择与冻结意图不一致。')
  }
  const selected = indexes.map(index => candidate.relations[index]).filter(relation => !relation.isDuplicate)
  if (!selected.length) throw new Error('选中项均为已存在关系。')
  const step = snapshot.projection.steps[CHARACTER_RELATIONSHIP_STEP_ID_V1]
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    return {
      snapshot,
      receiptHash: snapshot.projection.terminalReceiptHash,
      written: selected.length,
    }
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    const current = await baseline(input.scope, snapshot.run.worldGroupId ?? null)
    if (current.rosterHash !== candidate.rosterHash || current.relationHash !== candidate.relationHash) {
      snapshot = await append(input.scope, snapshot, 'candidate.staled', {
        stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, candidateHash: candidate.candidateHash,
        reason: 'character-relationship-baseline-changed',
      })
      throw new Error('角色或关系基线已变化，请重新提取。')
    }
    if (!intent) {
      const body = {
        version: 1 as const, kind: 'character-relationship-adoption-intent' as const, portable: false as const,
        candidate, selectedIndexes: indexes,
      }
      intent = { ...body, intentHash: await hashCanonicalValue(body) }
      const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })
      snapshot = saved.snapshot
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, candidateHash: candidate.candidateHash, decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, candidateHash: candidate.candidateHash, intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (step?.confirmation !== 'adopt' || !intent) {
    throw new Error('角色关系候选不在可恢复采纳状态。')
  }
  let adoptionHash = snapshot.projection.steps[CHARACTER_RELATIONSHIP_STEP_ID_V1]?.adoptionHash
  let currentState = await baseline(input.scope, snapshot.run.worldGroupId ?? null)
  let formal = currentState.relations
  const characters = currentState.characters
  if (!adoptionHash) {
    await adopt({
      projectId: input.scope.projectId, scope: input.scope, target: 'characterRelations', mode: 'add-many',
      data: selected.map(relation => ({
        fromCharacterId: relation.fromCharacterId, toCharacterId: relation.toCharacterId,
        relationType: relation.type, label: relation.label, description: relation.description,
        isBidirectional: relation.bidirectional,
      })),
    })
    currentState = await baseline(input.scope, snapshot.run.worldGroupId ?? null)
    formal = currentState.relations
    for (const relation of selected) {
      const row = formal.find(currentRow => (
        currentRow.relationType === relation.type
        && currentRow.fromCharacterId === relation.fromCharacterId
        && currentRow.toCharacterId === relation.toCharacterId
      ))
      if (!row) throw new Error('角色关系正式写入终验失败。')
      await syncRelationToCharacterFields({ projectId: input.scope.projectId, scope: input.scope, relation: row, characters })
    }
    await input.onDurableBoundary?.('formal.written', snapshot)
    adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      selected: selected.map(relation => ({
        fromCharacterId: relation.fromCharacterId, toCharacterId: relation.toCharacterId,
        relationType: relation.type,
      })),
    })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, candidateHash: candidate.candidateHash, adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  if (snapshot.projection.steps[CHARACTER_RELATIONSHIP_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, attempt: 1, outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: CHARACTER_RELATIONSHIP_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  formal.sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
  const postStateHash = await hashCanonicalValue(formal.map(stableRelation))
  const receipt = await createVerificationReceiptV1({
    version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash, contextManifestHashes: [candidate.contextManifestHash],
    candidateHashes: [candidate.candidateHash], adoptionEventIds: [],
    postStateHash, verifierSetVersion: CHARACTER_RELATIONSHIP_VERIFIER_SET_V1,
    criteria: [
      { id: 'character-relationships.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'character-relationships.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'character-relationships.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ], acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, receiptHash: receipt.receiptHash, written: selected.length }
}

export async function rejectCharacterRelationshipCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate } = await latestState(input.scope, input.runId)
  if (snapshot.projection.state !== 'awaiting_confirmation') throw new Error('角色关系候选不在等待确认状态。')
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: CHARACTER_RELATIONSHIP_STEP_ID_V1, candidateHash: candidate.candidateHash, decision: 'reject',
  })
  snapshot = await append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-character-relationships' })
  return snapshot
}
