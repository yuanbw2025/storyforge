import { chat } from '../../ai/client'
import {
  buildInventoryExtractPromptFromContext,
  parseInventoryEvents,
  readInventoryExtractPromptTemplateSnapshotV1,
  type ExtractedItemEvent,
} from '../../ai/adapters/inventory-extract-adapter'
import { splitExtractionText, uniqueBy } from '../../ai/structured-extraction'
import type { AIConfig, Chapter, ChatMessage, OutlineNode, WorkspaceScope } from '../../types'
import { assembleContext } from '../../registry/assemble-context'
import { replaceAdoptedCollection } from '../../registry/adopt'
import { readOwnedRows } from '../../workspace/scope'
import { selectInventoryExtractionChapters, type InventoryExtractionMode } from '../../inventory/extraction-range'
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
import { hashCanonicalValue } from './hash'

export const INVENTORY_EXTRACTION_STEP_ID_V1 = 'prose:inventory-extraction' as const
export const INVENTORY_EXTRACTION_VERIFIER_SET_V1 = 'inventory-extraction-terminal-v1' as const
const MAX_MODEL_CALLS = 64
const MAX_CANDIDATES = 500

type RunAI = (messages: ChatMessage[], callIndex: number) => Promise<string>

export interface InventoryExtractionRequestV1 {
  mode: InventoryExtractionMode
  startOrdinal?: number
  endOrdinal?: number
}

interface StableInventoryExtractionRequestV1 {
  mode: InventoryExtractionMode
  startOrdinal: number | null
  endOrdinal: number | null
}

function requestInput(request: StableInventoryExtractionRequestV1): InventoryExtractionRequestV1 {
  return {
    mode: request.mode,
    startOrdinal: request.startOrdinal ?? undefined,
    endOrdinal: request.endOrdinal ?? undefined,
  }
}

interface StableCharacterV1 {
  id: number
  name: string
}

interface StableInventoryRowV1 {
  id: number
  itemName: string
  heldByName: string
  characterId: number | null
  action: 'gain' | 'consume'
  quantity: number
  chapterId: number | null
  chapterTitle: string
  note: string
  createdAt: number
}

interface InventoryExtractionChunkV1 {
  callIndex: number
  chapterId: number
  chapterTitle: string
  chapterOrder: number
  chunkIndex: number
  chunkCount: number
  chunkHash: string
  contextManifestHash: string
}

interface InventoryExtractionPlanV1 {
  version: 1
  kind: 'inventory-extraction-plan'
  portable: false
  projectId: number
  workId: number
  request: StableInventoryExtractionRequestV1
  promptTemplateHash: string
  inventoryContextManifestHash: string
  inventoryContextHash: string
  characterContextManifestHash: string
  characterContextHash: string
  characters: StableCharacterV1[]
  charactersHash: string
  originalInventory: StableInventoryRowV1[]
  originalInventoryHash: string
  chapterSourceHash: string
  targetChapterIds: number[]
  chunks: InventoryExtractionChunkV1[]
  planHash: string
}

interface InventoryExtractionCallEvidenceV1 {
  callIndex: number
  promptInputHash: string
  outputHash: string
  discoveredHash: string
}

export interface InventoryExtractionCandidateItemV1 extends ExtractedItemEvent {
  chapterId: number
  chapterTitle: string
}

interface InventoryExtractionProgressV1 {
  version: 1
  kind: 'inventory-extraction-progress'
  portable: false
  plan: InventoryExtractionPlanV1
  nextCallIndex: number
  found: InventoryExtractionCandidateItemV1[]
  calls: InventoryExtractionCallEvidenceV1[]
  progressHash: string
}

export interface InventoryExtractionCandidateV1 {
  version: 1
  kind: 'inventory-extraction-candidate'
  portable: false
  plan: InventoryExtractionPlanV1
  calls: InventoryExtractionCallEvidenceV1[]
  events: InventoryExtractionCandidateItemV1[]
  candidateHash: string
}

interface InventoryFormalRowV1 {
  itemName: string
  heldByName: string
  characterId: number | null
  action: 'gain' | 'consume'
  quantity: number
  chapterId: number
  chapterTitle: string
  note: string
}

interface InventoryFormalChapterV1 {
  chapterId: number
  rows: InventoryFormalRowV1[]
  rowsHash: string
}

interface InventoryExtractionAdoptionProgressV1 {
  version: 1
  kind: 'inventory-extraction-adoption-progress'
  portable: false
  candidate: InventoryExtractionCandidateV1
  selectedIndexes: number[]
  formalChapters: InventoryFormalChapterV1[]
  nextChapterIndex: number
  appliedChapterHashes: string[]
  intentHash: string
  progressHash: string
}

export type InventoryExtractionBoundaryV1 =
  | 'plan.checkpoint'
  | 'chunk.checkpoint'
  | 'candidate.persisted'
  | 'candidate.checkpoint'

export type InventoryExtractionAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.chapter'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface PreparedInventorySourcesV1 {
  promptTemplateHash: string
  inventoryContext: Awaited<ReturnType<typeof assembleContext>>
  inventoryContextHash: string
  characterContext: Awaited<ReturnType<typeof assembleContext>>
  characterContextHash: string
  characters: StableCharacterV1[]
  charactersHash: string
  originalInventory: StableInventoryRowV1[]
  originalInventoryHash: string
  chapterSourceHash: string
  targetChapterIds: number[]
  chapters: Array<{
    chapter: Chapter & { id: number }
    assembled: Awaited<ReturnType<typeof assembleContext>>
    chunks: string[]
  }>
  callCount: number
}

function normalizeRequest(request: InventoryExtractionRequestV1): StableInventoryExtractionRequestV1 {
  if (request.mode !== 'all' && request.mode !== 'range') throw new Error('物品提取范围无效。')
  const normalized = {
    mode: request.mode,
    startOrdinal: request.startOrdinal ?? null,
    endOrdinal: request.endOrdinal ?? null,
  }
  if (
    request.mode === 'range'
    && (!Number.isInteger(normalized.startOrdinal) || !Number.isInteger(normalized.endOrdinal))
  ) throw new Error('物品提取范围无效。')
  return normalized
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function assertExactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) {
    throw new Error(`${label}字段不在允许闭集。`)
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function stableCharacter(row: Record<string, any>): StableCharacterV1 {
  return { id: row.id, name: String(row.name ?? '').trim() }
}

function stableCharacters(rows: Record<string, any>[]): StableCharacterV1[] {
  return rows.filter(row => Number.isInteger(row.id) && String(row.name ?? '').trim())
    .map(stableCharacter)
    .sort((left, right) => left.id - right.id)
}

function uniqueCharacterIdByName(characters: StableCharacterV1[], name: string): number | null {
  const matches = characters.filter(character => character.name === name)
  return matches.length === 1 ? matches[0].id : null
}

function stableInventoryRow(row: Record<string, any>): StableInventoryRowV1 {
  return {
    id: row.id,
    itemName: String(row.itemName ?? ''),
    heldByName: String(row.heldByName ?? ''),
    characterId: row.characterId ?? null,
    action: row.action,
    quantity: Number(row.quantity),
    chapterId: row.chapterId ?? null,
    chapterTitle: String(row.chapterTitle ?? ''),
    note: String(row.note ?? ''),
    createdAt: Number(row.createdAt ?? 0),
  }
}

function stableInventory(rows: Record<string, any>[]): StableInventoryRowV1[] {
  return rows.map(stableInventoryRow).sort((left, right) => left.id - right.id)
}

function candidateKey(item: InventoryExtractionCandidateItemV1): string {
  return JSON.stringify([
    item.chapterId,
    item.itemName.trim().toLocaleLowerCase(),
    item.heldByName.trim(),
    item.action,
    item.quantity,
    item.note.trim(),
  ])
}

function stableFormalRow(row: Record<string, any>): InventoryFormalRowV1 {
  return {
    itemName: String(row.itemName ?? ''),
    heldByName: String(row.heldByName ?? ''),
    characterId: row.characterId ?? null,
    action: row.action,
    quantity: Number(row.quantity),
    chapterId: Number(row.chapterId),
    chapterTitle: String(row.chapterTitle ?? ''),
    note: String(row.note ?? ''),
  }
}

function sortFormalRows(rows: InventoryFormalRowV1[]): InventoryFormalRowV1[] {
  return [...rows].sort((left, right) => formalRowKey(left).localeCompare(formalRowKey(right)))
}

function formalRowKey(row: InventoryFormalRowV1): string {
  return JSON.stringify([
    row.itemName, row.heldByName, row.characterId, row.action, row.quantity,
    row.chapterId, row.chapterTitle, row.note,
  ])
}

function stableInventoryRowKey(row: StableInventoryRowV1): string {
  return JSON.stringify([
    row.id, row.itemName, row.heldByName, row.characterId, row.action,
    row.quantity, row.chapterId, row.chapterTitle, row.note, row.createdAt,
  ])
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

async function hashAssembly(assembled: Awaited<ReturnType<typeof assembleContext>>): Promise<string> {
  return hashCanonicalValue({
    included: assembled.included,
    omitted: assembled.omitted,
    trimmed: assembled.trimmed,
    segments: assembled.segments.map(segment => ({ label: segment.label, content: segment.content })),
  })
}

async function prepareSources(
  scope: WorkspaceScope,
  request: InventoryExtractionRequestV1,
): Promise<PreparedInventorySourcesV1> {
  const stableRequest = normalizeRequest(request)
  const [chapterRows, outlineRows, characterRows, inventoryRows, inventoryContext, characterContext] = await Promise.all([
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<any>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<any>(scope, 'itemLedger', { owner: 'work' }),
    assembleContext({ projectId: scope.projectId, scope, sourceKeys: ['itemLedger'], inputBudgetMaxTokens: 100_000 }),
    assembleContext({ projectId: scope.projectId, scope, sourceKeys: ['characters'], inputBudgetMaxTokens: 100_000 }),
  ])
  const selected = selectInventoryExtractionChapters({
    chapters: chapterRows,
    outlineNodes: outlineRows,
    mode: stableRequest.mode,
    startOrdinal: stableRequest.startOrdinal ?? undefined,
    endOrdinal: stableRequest.endOrdinal ?? undefined,
  })
  if (selected.error) throw new Error(selected.error)
  const chapters: PreparedInventorySourcesV1['chapters'] = []
  for (const chapter of selected.chapters) {
    if (chapter.id == null) continue
    const assembled = await assembleContext({
      projectId: scope.projectId, scope, chapterId: chapter.id,
      sourceKeys: ['chapterContent'], inputBudgetMaxTokens: 100_000,
    })
    if (!assembled.included.includes('chapterContent')) continue
    const chunks = splitExtractionText(assembled.text)
    if (chunks.length) chapters.push({ chapter: chapter as Chapter & { id: number }, assembled, chunks })
  }
  const callCount = chapters.reduce((sum, entry) => sum + entry.chunks.length, 0)
  if (!callCount) throw new Error('所选章节没有可提取的正文。')
  if (callCount > MAX_MODEL_CALLS) {
    throw new Error(`当前范围需要 ${callCount} 个物品提取分块，超过单次上限 ${MAX_MODEL_CALLS}。`)
  }
  const characters = stableCharacters(characterRows)
  const originalInventory = stableInventory(inventoryRows)
  const targetChapterIds = chapters.map(entry => entry.chapter.id)
  const promptTemplateHash = await hashCanonicalValue(readInventoryExtractPromptTemplateSnapshotV1())
  const chapterSourceHash = await hashCanonicalValue(await Promise.all(chapters.map(async entry => ({
    chapterId: entry.chapter.id,
    title: entry.chapter.title,
    order: entry.chapter.order,
    contentHash: await hashCanonicalValue(entry.assembled.text),
    chunkHashes: await Promise.all(entry.chunks.map(chunk => hashCanonicalValue(chunk))),
  }))))
  return {
    promptTemplateHash,
    inventoryContext,
    inventoryContextHash: await hashAssembly(inventoryContext),
    characterContext,
    characterContextHash: await hashAssembly(characterContext),
    characters,
    charactersHash: await hashCanonicalValue(characters),
    originalInventory,
    originalInventoryHash: await hashCanonicalValue(originalInventory),
    chapterSourceHash,
    targetChapterIds,
    chapters,
    callCount,
  }
}

async function createPlan(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  request: InventoryExtractionRequestV1
  prepared: PreparedInventorySourcesV1
}): Promise<{ snapshot: AgentRunSnapshotV1; plan: InventoryExtractionPlanV1 }> {
  let snapshot = input.snapshot
  const inventoryManifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id, stepId: INVENTORY_EXTRACTION_STEP_ID_V1, attempt: 1,
    projectId: input.scope.projectId, worldGroupId: null,
    declaredSourceKeys: ['itemLedger'], assembled: input.prepared.inventoryContext,
    readerVersion: 'inventory-extraction-ledger-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: INVENTORY_EXTRACTION_STEP_ID_V1, attempt: 1, manifestHash: inventoryManifest.manifestHash,
  })
  const characterManifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id, stepId: INVENTORY_EXTRACTION_STEP_ID_V1, attempt: 1,
    projectId: input.scope.projectId, worldGroupId: null,
    declaredSourceKeys: ['characters'], assembled: input.prepared.characterContext,
    readerVersion: 'inventory-extraction-characters-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: INVENTORY_EXTRACTION_STEP_ID_V1, attempt: 1, manifestHash: characterManifest.manifestHash,
  })
  const chunks: InventoryExtractionChunkV1[] = []
  let callIndex = 0
  for (const entry of input.prepared.chapters) {
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id, stepId: INVENTORY_EXTRACTION_STEP_ID_V1, attempt: 1,
      projectId: input.scope.projectId, worldGroupId: null,
      declaredSourceKeys: ['chapterContent'], assembled: entry.assembled,
      boundary: { chapterId: entry.chapter.id }, readerVersion: 'inventory-extraction-chapter-v1',
    })
    snapshot = await append(input.scope, snapshot, 'context.assembled', {
      stepId: INVENTORY_EXTRACTION_STEP_ID_V1, attempt: 1, manifestHash: manifest.manifestHash,
    })
    for (let chunkIndex = 0; chunkIndex < entry.chunks.length; chunkIndex++) {
      chunks.push({
        callIndex,
        chapterId: entry.chapter.id,
        chapterTitle: entry.chapter.title,
        chapterOrder: entry.chapter.order,
        chunkIndex,
        chunkCount: entry.chunks.length,
        chunkHash: await hashCanonicalValue(entry.chunks[chunkIndex]),
        contextManifestHash: manifest.manifestHash,
      })
      callIndex++
    }
  }
  const body = {
    version: 1 as const,
    kind: 'inventory-extraction-plan' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    workId: input.scope.workId,
    request: normalizeRequest(input.request),
    promptTemplateHash: input.prepared.promptTemplateHash,
    inventoryContextManifestHash: inventoryManifest.manifestHash,
    inventoryContextHash: input.prepared.inventoryContextHash,
    characterContextManifestHash: characterManifest.manifestHash,
    characterContextHash: input.prepared.characterContextHash,
    characters: input.prepared.characters,
    charactersHash: input.prepared.charactersHash,
    originalInventory: input.prepared.originalInventory,
    originalInventoryHash: input.prepared.originalInventoryHash,
    chapterSourceHash: input.prepared.chapterSourceHash,
    targetChapterIds: input.prepared.targetChapterIds,
    chunks,
  }
  return { snapshot, plan: { ...body, planHash: await hashCanonicalValue(body) } }
}

function contract(scope: WorkspaceScope, maxModelCalls: number) {
  const skill = getAgentSkillV1('prose.inventory-extraction', 'prose')
  return {
    version: 1 as const,
    objective: '从作者所选已写章节提取可确认的角色物品流水',
    workflowKind: 'long-running-resumable' as const,
    // Work-level inventory may span chapters from multiple world groups. The
    // exact selected chapter set is frozen and hashed in the durable plan.
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: {
      contextSourceKeys: ['chapterContent', 'itemLedger', 'characters'],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table, fields: [...target.fields], mode: 'author-confirmed' as const,
      })),
    },
    executionBindings: [{ stepId: INVENTORY_EXTRACTION_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls, maxToolCalls: 0,
      maxInputTokens: maxModelCalls * 8_000,
      maxOutputTokens: maxModelCalls * 4_000,
      maxAttemptsPerStep: 1, maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'inventory.candidate', kind: 'output-present' as const, required: true },
      { id: 'inventory.author', kind: 'author-confirmed' as const, required: true },
      { id: 'inventory.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'inventory.terminal', kind: 'terminal' as const,
      verifier: INVENTORY_EXTRACTION_VERIFIER_SET_V1,
      criterionIds: ['inventory.candidate', 'inventory.author', 'inventory.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

async function parsePlan(value: unknown): Promise<InventoryExtractionPlanV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('物品提取计划检查点无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, [
    'version', 'kind', 'portable', 'projectId', 'workId', 'request',
    'promptTemplateHash', 'inventoryContextManifestHash', 'inventoryContextHash',
    'characterContextManifestHash', 'characterContextHash', 'characters', 'charactersHash',
    'originalInventory', 'originalInventoryHash', 'chapterSourceHash',
    'targetChapterIds', 'chunks', 'planHash',
  ], '物品提取计划 ')
  if (
    row.version !== 1 || row.kind !== 'inventory-extraction-plan' || row.portable !== false
    || !Number.isInteger(row.projectId) || row.projectId <= 0
    || !Number.isInteger(row.workId) || row.workId <= 0
    || !isHash(row.promptTemplateHash)
    || !isHash(row.inventoryContextManifestHash) || !isHash(row.inventoryContextHash)
    || !isHash(row.characterContextManifestHash) || !isHash(row.characterContextHash)
    || !isHash(row.charactersHash) || !isHash(row.originalInventoryHash)
    || !isHash(row.chapterSourceHash) || !isHash(row.planHash)
    || !Array.isArray(row.characters) || !Array.isArray(row.originalInventory)
    || !Array.isArray(row.targetChapterIds) || !Array.isArray(row.chunks)
    || row.targetChapterIds.length < 1 || row.chunks.length < 1 || row.chunks.length > MAX_MODEL_CALLS
  ) throw new Error('物品提取计划检查点不完整。')
  if (!row.request || typeof row.request !== 'object' || Array.isArray(row.request)) {
    throw new Error('物品提取范围检查点无效。')
  }
  assertExactKeys(row.request, ['mode', 'startOrdinal', 'endOrdinal'], '物品提取范围 ')
  const request = normalizeRequest({
    mode: row.request.mode,
    startOrdinal: row.request.startOrdinal ?? undefined,
    endOrdinal: row.request.endOrdinal ?? undefined,
  })
  if (request.startOrdinal !== row.request.startOrdinal || request.endOrdinal !== row.request.endOrdinal) {
    throw new Error('物品提取范围检查点不规范。')
  }
  const characters = row.characters.map((value: unknown, index: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`角色基线 ${index + 1} 无效。`)
    const character = value as Record<string, unknown>
    assertExactKeys(character, ['id', 'name'], '角色基线 ')
    if (!Number.isInteger(character.id) || (character.id as number) <= 0 || typeof character.name !== 'string' || !character.name.trim()) {
      throw new Error(`角色基线 ${index + 1} 不完整。`)
    }
    return character as unknown as StableCharacterV1
  })
  if (new Set(characters.map(character => character.id)).size !== characters.length) throw new Error('角色基线 ID 重复。')
  const originalInventory = row.originalInventory.map((value: unknown, index: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`物品基线 ${index + 1} 无效。`)
    const item = value as Record<string, unknown>
    assertExactKeys(item, [
      'id', 'itemName', 'heldByName', 'characterId', 'action', 'quantity',
      'chapterId', 'chapterTitle', 'note', 'createdAt',
    ], '物品基线 ')
    if (
      !Number.isInteger(item.id) || (item.id as number) <= 0
      || typeof item.itemName !== 'string' || !item.itemName.trim()
      || typeof item.heldByName !== 'string' || !item.heldByName.trim()
      || (item.characterId !== null && !Number.isInteger(item.characterId))
      || (item.action !== 'gain' && item.action !== 'consume')
      || !Number.isInteger(item.quantity) || (item.quantity as number) <= 0
      || (item.chapterId !== null && !Number.isInteger(item.chapterId))
      || typeof item.chapterTitle !== 'string' || typeof item.note !== 'string'
      || !Number.isFinite(item.createdAt)
    ) throw new Error(`物品基线 ${index + 1} 不完整。`)
    return item as unknown as StableInventoryRowV1
  })
  if (new Set(originalInventory.map(item => item.id)).size !== originalInventory.length) throw new Error('物品基线 ID 重复。')
  const targetChapterIds = row.targetChapterIds.map((id: unknown) => {
    if (!Number.isInteger(id) || (id as number) <= 0) throw new Error('物品提取目标章节无效。')
    return id as number
  })
  if (new Set(targetChapterIds).size !== targetChapterIds.length) throw new Error('物品提取目标章节重复。')
  const chunks = row.chunks.map((value: unknown, index: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`物品提取分块 ${index + 1} 无效。`)
    const chunk = value as Record<string, unknown>
    assertExactKeys(chunk, [
      'callIndex', 'chapterId', 'chapterTitle', 'chapterOrder',
      'chunkIndex', 'chunkCount', 'chunkHash', 'contextManifestHash',
    ], '物品提取分块 ')
    if (
      chunk.callIndex !== index
      || !Number.isInteger(chunk.chapterId) || (chunk.chapterId as number) <= 0
      || typeof chunk.chapterTitle !== 'string'
      || !Number.isInteger(chunk.chapterOrder)
      || !Number.isInteger(chunk.chunkIndex) || (chunk.chunkIndex as number) < 0
      || !Number.isInteger(chunk.chunkCount) || (chunk.chunkCount as number) < 1
      || (chunk.chunkIndex as number) >= (chunk.chunkCount as number)
      || !isHash(chunk.chunkHash) || !isHash(chunk.contextManifestHash)
    ) throw new Error(`物品提取分块 ${index + 1} 不完整。`)
    return chunk as unknown as InventoryExtractionChunkV1
  })
  for (let cursor = 0; cursor < chunks.length;) {
    const first = chunks[cursor]
    const group = chunks.slice(cursor, cursor + first.chunkCount)
    if (
      group.length !== first.chunkCount
      || group.some((chunk, index) => (
        chunk.chapterId !== first.chapterId
        || chunk.chapterTitle !== first.chapterTitle
        || chunk.chapterOrder !== first.chapterOrder
        || chunk.contextManifestHash !== first.contextManifestHash
        || chunk.chunkCount !== first.chunkCount
        || chunk.chunkIndex !== index
      ))
    ) throw new Error('物品提取章节分块序列无效。')
    cursor += first.chunkCount
  }
  const chunkChapterIds = [...new Set(chunks.map(chunk => chunk.chapterId))]
  if (!sameValue(chunkChapterIds, targetChapterIds)) throw new Error('物品提取目标章节与分块不一致。')
  if (await hashCanonicalValue(characters) !== row.charactersHash) throw new Error('角色基线 hash 不匹配。')
  if (await hashCanonicalValue(originalInventory) !== row.originalInventoryHash) throw new Error('物品基线 hash 不匹配。')
  const { planHash, ...body } = row
  if (await hashCanonicalValue(body) !== planHash) throw new Error('物品提取计划 hash 不匹配。')
  return { ...row, request, characters, originalInventory, targetChapterIds, chunks } as InventoryExtractionPlanV1
}

function parseCandidateItems(value: unknown, plan: InventoryExtractionPlanV1): InventoryExtractionCandidateItemV1[] {
  if (!Array.isArray(value)) throw new Error('物品候选集合无效。')
  const targetChapterIds = new Set(plan.targetChapterIds)
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`物品候选 ${index + 1} 无效。`)
    const row = item as Record<string, unknown>
    assertExactKeys(row, ['itemName', 'heldByName', 'action', 'quantity', 'note', 'chapterId', 'chapterTitle'], '物品候选 ')
    const parsed = parseInventoryEvents(JSON.stringify([{
      itemName: row.itemName,
      heldByName: row.heldByName,
      action: row.action,
      quantity: row.quantity,
      note: row.note,
    }]))[0]
    if (!Number.isInteger(row.chapterId) || !targetChapterIds.has(row.chapterId as number) || typeof row.chapterTitle !== 'string') {
      throw new Error(`物品候选 ${index + 1} 章节绑定无效。`)
    }
    const planned = plan.chunks.find(chunk => chunk.chapterId === row.chapterId)
    if (!planned || planned.chapterTitle !== row.chapterTitle) throw new Error(`物品候选 ${index + 1} 章节标题不匹配。`)
    return { ...parsed, chapterId: row.chapterId as number, chapterTitle: row.chapterTitle }
  })
}

function parseCallEvidence(value: unknown, index: number): InventoryExtractionCallEvidenceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('物品提取调用证据无效。')
  const row = value as Record<string, unknown>
  assertExactKeys(row, ['callIndex', 'promptInputHash', 'outputHash', 'discoveredHash'], '物品提取调用证据 ')
  if (row.callIndex !== index || !isHash(row.promptInputHash) || !isHash(row.outputHash) || !isHash(row.discoveredHash)) {
    throw new Error('物品提取调用证据不完整。')
  }
  return row as unknown as InventoryExtractionCallEvidenceV1
}

async function parseProgress(value: unknown): Promise<InventoryExtractionProgressV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('物品提取进度检查点无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, ['version', 'kind', 'portable', 'plan', 'nextCallIndex', 'found', 'calls', 'progressHash'], '物品提取进度 ')
  const plan = await parsePlan(row.plan)
  if (
    row.version !== 1 || row.kind !== 'inventory-extraction-progress' || row.portable !== false
    || !Number.isInteger(row.nextCallIndex) || row.nextCallIndex < 0 || row.nextCallIndex > plan.chunks.length
    || !Array.isArray(row.calls) || row.calls.length !== row.nextCallIndex || !isHash(row.progressHash)
  ) throw new Error('物品提取进度检查点不完整。')
  const found = parseCandidateItems(row.found, plan)
  if (new Set(found.map(candidateKey)).size !== found.length || found.length > MAX_CANDIDATES) {
    throw new Error('物品提取进度候选重复或超限。')
  }
  const calls = row.calls.map(parseCallEvidence)
  const { progressHash, ...body } = row
  if (await hashCanonicalValue(body) !== progressHash) throw new Error('物品提取进度 hash 不匹配。')
  return { ...row, plan, found, calls } as InventoryExtractionProgressV1
}

async function parseCandidate(value: unknown): Promise<InventoryExtractionCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('物品提取候选检查点无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, ['version', 'kind', 'portable', 'plan', 'calls', 'events', 'candidateHash'], '物品提取候选 ')
  const plan = await parsePlan(row.plan)
  if (
    row.version !== 1 || row.kind !== 'inventory-extraction-candidate' || row.portable !== false
    || !Array.isArray(row.calls) || row.calls.length !== plan.chunks.length || !isHash(row.candidateHash)
  ) throw new Error('物品提取候选检查点不完整。')
  const calls = row.calls.map(parseCallEvidence)
  const events = parseCandidateItems(row.events, plan)
  if (new Set(events.map(candidateKey)).size !== events.length || events.length > MAX_CANDIDATES) {
    throw new Error('物品提取候选重复或超限。')
  }
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('物品提取候选 hash 不匹配。')
  return { ...row, plan, calls, events } as InventoryExtractionCandidateV1
}

async function candidateFromProgress(progress: InventoryExtractionProgressV1): Promise<InventoryExtractionCandidateV1> {
  if (progress.nextCallIndex !== progress.plan.chunks.length || progress.calls.length !== progress.plan.chunks.length) {
    throw new Error('物品提取进度尚未完成，不能重建候选。')
  }
  const body = {
    version: 1 as const,
    kind: 'inventory-extraction-candidate' as const,
    portable: false as const,
    plan: progress.plan,
    calls: progress.calls,
    events: progress.found,
  }
  return { ...body, candidateHash: await hashCanonicalValue(body) }
}

function parseFormalRow(value: unknown, chapterId: number, candidate: InventoryExtractionCandidateV1): InventoryFormalRowV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('物品正式行无效。')
  const row = value as Record<string, unknown>
  assertExactKeys(row, [
    'itemName', 'heldByName', 'characterId', 'action', 'quantity',
    'chapterId', 'chapterTitle', 'note',
  ], '物品正式行 ')
  const parsed = parseInventoryEvents(JSON.stringify([{
    itemName: row.itemName,
    heldByName: row.heldByName,
    action: row.action,
    quantity: row.quantity,
    note: row.note,
  }]))[0]
  const expectedChapter = candidate.plan.chunks.find(chunk => chunk.chapterId === chapterId)
  if (
    row.chapterId !== chapterId || !expectedChapter || row.chapterTitle !== expectedChapter.chapterTitle
    || (row.characterId !== null && !Number.isInteger(row.characterId))
  ) throw new Error('物品正式行章节或角色绑定无效。')
  const expectedCharacterId = uniqueCharacterIdByName(candidate.plan.characters, parsed.heldByName)
  if (expectedCharacterId !== row.characterId) throw new Error('物品正式行角色绑定不匹配。')
  return {
    itemName: parsed.itemName,
    heldByName: parsed.heldByName,
    characterId: row.characterId as number | null,
    action: parsed.action,
    quantity: parsed.quantity,
    chapterId,
    chapterTitle: row.chapterTitle as string,
    note: parsed.note,
  }
}

async function parseAdoptionProgress(value: unknown): Promise<InventoryExtractionAdoptionProgressV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('物品采纳进度无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, [
    'version', 'kind', 'portable', 'candidate', 'selectedIndexes', 'formalChapters',
    'nextChapterIndex', 'appliedChapterHashes', 'intentHash', 'progressHash',
  ], '物品采纳进度 ')
  const candidate = await parseCandidate(row.candidate)
  if (
    row.version !== 1 || row.kind !== 'inventory-extraction-adoption-progress' || row.portable !== false
    || !Array.isArray(row.selectedIndexes) || !Array.isArray(row.formalChapters)
    || !Number.isInteger(row.nextChapterIndex) || row.nextChapterIndex < 0
    || !Array.isArray(row.appliedChapterHashes)
    || !isHash(row.intentHash) || !isHash(row.progressHash)
  ) throw new Error('物品采纳进度不完整。')
  const selectedIndexes = row.selectedIndexes.map((index: unknown, position: number) => {
    if (
      !Number.isInteger(index) || (index as number) < 0 || (index as number) >= candidate.events.length
      || (position > 0 && Number(row.selectedIndexes[position - 1]) >= (index as number))
    ) throw new Error('物品采纳选择无效。')
    return index as number
  })
  const formalChapters = row.formalChapters.map((value: unknown, index: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('物品正式章节无效。')
    const chapter = value as Record<string, any>
    assertExactKeys(chapter, ['chapterId', 'rows', 'rowsHash'], '物品正式章节 ')
    if (chapter.chapterId !== candidate.plan.targetChapterIds[index] || !Array.isArray(chapter.rows) || !isHash(chapter.rowsHash)) {
      throw new Error('物品正式章节不完整。')
    }
    const rows = sortFormalRows(chapter.rows.map((item: unknown) => parseFormalRow(item, chapter.chapterId, candidate)))
    return { chapterId: chapter.chapterId, rows, rowsHash: chapter.rowsHash } as InventoryFormalChapterV1
  })
  if (
    formalChapters.length !== candidate.plan.targetChapterIds.length
    || row.nextChapterIndex > formalChapters.length
    || row.appliedChapterHashes.length !== row.nextChapterIndex
    || row.appliedChapterHashes.some((hash: unknown, index: number) => hash !== formalChapters[index].rowsHash)
  ) throw new Error('物品采纳章节进度无效。')
  for (const chapter of formalChapters) {
    if (await hashCanonicalValue(chapter.rows) !== chapter.rowsHash) throw new Error('物品正式章节 hash 不匹配。')
  }
  const expectedFormal = await buildFormalChapters(candidate, selectedIndexes)
  if (
    expectedFormal.length !== formalChapters.length
    || expectedFormal.some((chapter, index) => (
      chapter.chapterId !== formalChapters[index].chapterId
      || chapter.rowsHash !== formalChapters[index].rowsHash
      || chapter.rows.some((item, itemIndex) => formalRowKey(item) !== formalRowKey(formalChapters[index].rows[itemIndex]))
    ))
  ) throw new Error('物品正式章节与冻结选择不匹配。')
  const intentBody = { candidate, selectedIndexes, formalChapters }
  if (await hashCanonicalValue(intentBody) !== row.intentHash) throw new Error('物品采纳意图 hash 不匹配。')
  const { progressHash, ...progressBody } = row
  if (await hashCanonicalValue(progressBody) !== progressHash) throw new Error('物品采纳进度 hash 不匹配。')
  return {
    ...row, candidate, selectedIndexes, formalChapters,
    appliedChapterHashes: [...row.appliedChapterHashes],
  } as InventoryExtractionAdoptionProgressV1
}

async function buildFormalChapters(
  candidate: InventoryExtractionCandidateV1,
  selectedIndexes: number[],
): Promise<InventoryFormalChapterV1[]> {
  return Promise.all(candidate.plan.targetChapterIds.map(async chapterId => {
    const rows = sortFormalRows(selectedIndexes
      .map(index => candidate.events[index])
      .filter(event => event.chapterId === chapterId)
      .map(event => ({
        itemName: event.itemName,
        heldByName: event.heldByName,
        characterId: uniqueCharacterIdByName(candidate.plan.characters, event.heldByName),
        action: event.action,
        quantity: event.quantity,
        chapterId: event.chapterId,
        chapterTitle: event.chapterTitle,
        note: event.note,
      })))
    return { chapterId, rows, rowsHash: await hashCanonicalValue(rows) }
  }))
}

async function latestState(scope: WorkspaceScope, runId: number): Promise<{
  progress: InventoryExtractionProgressV1 | null
  candidate: InventoryExtractionCandidateV1 | null
  adoption: InventoryExtractionAdoptionProgressV1 | null
}> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('物品提取运行缺少可验证检查点。')
  const value = checkpoint.resumePayload
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('物品提取检查点无效。')
  const kind = (value as Record<string, unknown>).kind
  if (kind === 'inventory-extraction-progress') {
    const progress = await parseProgress(value)
    const snapshot = await readAgentRunV1(scope, runId)
    const candidateHash = snapshot.projection.steps[INVENTORY_EXTRACTION_STEP_ID_V1]?.candidateHash
    if (
      snapshot.projection.state === 'awaiting_confirmation'
      && progress.nextCallIndex === progress.plan.chunks.length
      && candidateHash
    ) {
      const candidate = await candidateFromProgress(progress)
      if (candidate.candidateHash !== candidateHash) throw new Error('物品候选事件与完整进度不匹配。')
      return { progress: null, candidate, adoption: null }
    }
    return { progress, candidate: null, adoption: null }
  }
  if (kind === 'inventory-extraction-candidate') {
    return { progress: null, candidate: await parseCandidate(value), adoption: null }
  }
  if (kind === 'inventory-extraction-adoption-progress') {
    const adoption = await parseAdoptionProgress(value)
    return { progress: null, candidate: adoption.candidate, adoption }
  }
  throw new Error('物品提取检查点类型无效。')
}

async function verifyCurrentPlan(
  scope: WorkspaceScope,
  plan: InventoryExtractionPlanV1,
  options: { requireInventoryBaseline: boolean } = { requireInventoryBaseline: true },
): Promise<PreparedInventorySourcesV1> {
  if (plan.projectId !== scope.projectId || plan.workId !== scope.workId) throw new Error('物品提取计划与当前 Work 不匹配。')
  let current: PreparedInventorySourcesV1
  try {
    current = await prepareSources(scope, requestInput(plan.request))
  } catch {
    throw new Error('正文、角色、物品基线或提示词模板已变化，请重新提取。')
  }
  if (
    current.promptTemplateHash !== plan.promptTemplateHash
    || current.characterContextHash !== plan.characterContextHash
    || current.charactersHash !== plan.charactersHash
    || current.chapterSourceHash !== plan.chapterSourceHash
    || current.callCount !== plan.chunks.length
    || !sameValue(current.targetChapterIds, plan.targetChapterIds)
    || (options.requireInventoryBaseline && (
      current.inventoryContextHash !== plan.inventoryContextHash
      || current.originalInventoryHash !== plan.originalInventoryHash
    ))
  ) throw new Error('正文、角色、物品基线或提示词模板已变化，请重新提取。')
  return current
}

async function pauseUnsafeRun(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, reason: string): Promise<AgentRunSnapshotV1> {
  if (snapshot.projection.state === 'running' || snapshot.projection.state === 'awaiting_confirmation') {
    return append(scope, snapshot, 'run.paused', { reason, recoverable: false })
  }
  return snapshot
}

async function continueExtraction(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  progress: InventoryExtractionProgressV1
  prepared: PreparedInventorySourcesV1
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: InventoryExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: InventoryExtractionCandidateV1 }> {
  let snapshot = input.snapshot
  let progress = input.progress
  const chunkTexts = input.prepared.chapters.flatMap(chapter => chapter.chunks)
  const chapterFound = new Map<number, InventoryExtractionCandidateItemV1[]>()
  for (const item of progress.found) chapterFound.set(item.chapterId, [...(chapterFound.get(item.chapterId) ?? []), item])
  const originalNames = [...new Set(progress.plan.originalInventory.map(item => item.itemName.trim()).filter(Boolean))]
  for (let callIndex = progress.nextCallIndex; callIndex < progress.plan.chunks.length; callIndex++) {
    const chunk = progress.plan.chunks[callIndex]
    const chunkText = chunkTexts[callIndex]
    if (!chunkText || await hashCanonicalValue(chunkText) !== chunk.chunkHash) {
      snapshot = await pauseUnsafeRun(input.scope, snapshot, 'inventory-extraction-chunk-rebind-mismatch')
      throw new Error('物品提取分块无法重绑，Run 已暂停。')
    }
    const previousForChapter = chapterFound.get(chunk.chapterId) ?? []
    const discoveredItemNames = [...new Set(previousForChapter.map(item => item.itemName))]
    const messages = buildInventoryExtractPromptFromContext(
      chunk.chapterTitle,
      chunkText,
      input.prepared.inventoryContext.text,
      input.prepared.characterContext.text,
      [...originalNames, ...discoveredItemNames],
    )
    const promptInputHash = await hashCanonicalValue({
      promptTemplateHash: progress.plan.promptTemplateHash,
      inventoryContextHash: progress.plan.inventoryContextHash,
      characterContextHash: progress.plan.characterContextHash,
      chunkHash: chunk.chunkHash,
      discoveredItemNames,
    })
    snapshot = await append(input.scope, snapshot, 'model.requested', {
      stepId: INVENTORY_EXTRACTION_STEP_ID_V1, attempt: 1,
      bindingHash: await hashCanonicalValue({
        executionBinding: snapshot.contract.executionBindings?.[0], callIndex, promptInputHash,
      }),
    })
    let raw: string
    try {
      raw = await (input.runAI
        ? input.runAI(messages, callIndex)
        : chat(messages, input.aiConfig!, { category: 'inventory.extract', projectId: input.scope.projectId }))
    } catch (error) {
      await pauseUnsafeRun(input.scope, snapshot, 'inventory-extraction-model-outcome-unknown')
      throw error
    }
    const outputHash = await hashCanonicalValue({ raw })
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: INVENTORY_EXTRACTION_STEP_ID_V1, attempt: 1, outputHash,
    })
    let parsed: ExtractedItemEvent[]
    try {
      parsed = parseInventoryEvents(raw)
    } catch (error) {
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: INVENTORY_EXTRACTION_STEP_ID_V1, attempt: 1,
        code: 'inventory-extraction-protocol-failed', retryable: false,
        category: 'protocol', action: 'fail',
      })
      await append(input.scope, snapshot, 'run.failed', { code: 'inventory-extraction-protocol-failed', retryable: false })
      throw error
    }
    const bound = parsed.map(item => ({ ...item, chapterId: chunk.chapterId, chapterTitle: chunk.chapterTitle }))
    const nextForChapter = uniqueBy([...previousForChapter, ...bound], candidateKey)
    chapterFound.set(chunk.chapterId, nextForChapter)
    const found = progress.plan.targetChapterIds.flatMap(chapterId => chapterFound.get(chapterId) ?? [])
    if (found.length > MAX_CANDIDATES) {
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: INVENTORY_EXTRACTION_STEP_ID_V1, attempt: 1,
        code: 'inventory-extraction-candidate-limit', retryable: false,
        category: 'protocol', action: 'fail',
      })
      await append(input.scope, snapshot, 'run.failed', { code: 'inventory-extraction-candidate-limit', retryable: false })
      throw new Error(`物品候选超过上限 ${MAX_CANDIDATES}。`)
    }
    const callEvidence: InventoryExtractionCallEvidenceV1 = {
      callIndex, promptInputHash, outputHash, discoveredHash: await hashCanonicalValue(parsed),
    }
    const body = {
      version: 1 as const,
      kind: 'inventory-extraction-progress' as const,
      portable: false as const,
      plan: progress.plan,
      nextCallIndex: callIndex + 1,
      found,
      calls: [...progress.calls, callEvidence],
    }
    progress = { ...body, progressHash: await hashCanonicalValue(body) }
    const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: progress })
    snapshot = saved.snapshot
    await input.onDurableBoundary?.('chunk.checkpoint', snapshot, callIndex)
  }
  try {
    await verifyCurrentPlan(input.scope, progress.plan)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'inventory-extraction-source-stale-before-candidate')
    throw error
  }
  const candidate = await candidateFromProgress(progress)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: INVENTORY_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
  await input.onDurableBoundary?.('candidate.persisted', snapshot, progress.plan.chunks.length)
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot, progress.plan.chunks.length)
  return { snapshot, candidate }
}

export async function generateInventoryExtractionCandidateV1(input: {
  scope: WorkspaceScope
  request: InventoryExtractionRequestV1
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: InventoryExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: InventoryExtractionCandidateV1 }> {
  const request = normalizeRequest(input.request)
  const prepared = await prepareSources(input.scope, requestInput(request))
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: null,
    contract: contract(input.scope, prepared.callCount),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: INVENTORY_EXTRACTION_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: INVENTORY_EXTRACTION_STEP_ID_V1, attempt: 1 })
  const created = await createPlan({ scope: input.scope, snapshot, request: requestInput(request), prepared })
  snapshot = created.snapshot
  const progressBody = {
    version: 1 as const,
    kind: 'inventory-extraction-progress' as const,
    portable: false as const,
    plan: created.plan,
    nextCallIndex: 0,
    found: [] as InventoryExtractionCandidateItemV1[],
    calls: [] as InventoryExtractionCallEvidenceV1[],
  }
  const progress = { ...progressBody, progressHash: await hashCanonicalValue(progressBody) }
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: progress })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('plan.checkpoint', snapshot, -1)
  return continueExtraction({ ...input, snapshot, progress, prepared })
}

export async function readRecoverableInventoryExtractionV1(input: {
  scope: WorkspaceScope
}): Promise<{
  snapshot: AgentRunSnapshotV1
  nextCallIndex: number
  totalCalls: number
  safeToResume: boolean
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      (row.status === 'running' || row.status === 'paused')
      && row.contractJson?.includes('prose.inventory-extraction')
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    try {
      const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, row.id)
      if (!checkpoint) throw new Error('缺少物品提取检查点。')
      const progress = await parseProgress(checkpoint.resumePayload)
      const safeTail = checkpoint.snapshot.projection.lastSequence === checkpoint.checkpoint.throughSequence + 1
      return {
        snapshot: checkpoint.snapshot,
        nextCallIndex: progress.nextCallIndex,
        totalCalls: progress.plan.chunks.length,
        safeToResume: checkpoint.snapshot.projection.state === 'running' && safeTail,
      }
    } catch {
      return {
        snapshot,
        nextCallIndex: 0,
        totalCalls: snapshot.contract.budget.maxModelCalls,
        safeToResume: false,
      }
    }
  }
  return null
}

export async function resumeInventoryExtractionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: InventoryExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: InventoryExtractionCandidateV1 }> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId)
  if (!checkpoint) throw new Error('物品提取运行缺少可恢复检查点。')
  const progress = await parseProgress(checkpoint.resumePayload)
  if (
    checkpoint.snapshot.projection.state !== 'running'
    || checkpoint.snapshot.projection.lastSequence !== checkpoint.checkpoint.throughSequence + 1
  ) throw new Error('物品提取停在模型结果不可判定窗口，不会自动重试。')
  let prepared: PreparedInventorySourcesV1
  try {
    prepared = await verifyCurrentPlan(input.scope, progress.plan)
  } catch (error) {
    await pauseUnsafeRun(input.scope, checkpoint.snapshot, 'inventory-extraction-source-stale-before-resume')
    throw error
  }
  return continueExtraction({ ...input, snapshot: checkpoint.snapshot, progress, prepared })
}

export async function readPendingInventoryExtractionCandidateV1(input: {
  scope: WorkspaceScope
}): Promise<{
  snapshot: AgentRunSnapshotV1
  candidate: InventoryExtractionCandidateV1
  selectedIndexes: number[] | null
  adoptionStarted: boolean
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['awaiting_confirmation', 'running', 'verifying'].includes(row.status)
      && row.contractJson?.includes('prose.inventory-extraction')
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      const snapshot = await readAgentRunV1(input.scope, row.id)
      const state = await latestState(input.scope, row.id)
      if (state.adoption) return {
        snapshot,
        candidate: state.adoption.candidate,
        selectedIndexes: [...state.adoption.selectedIndexes],
        adoptionStarted: snapshot.projection.steps[INVENTORY_EXTRACTION_STEP_ID_V1]?.confirmation === 'adopt',
      }
      if (state.candidate) return {
        snapshot, candidate: state.candidate, selectedIndexes: null, adoptionStarted: false,
      }
    } catch {
      // Damaged historical candidates remain auditable but are not recoverable.
    }
  }
  return null
}

function exactStableRows(left: StableInventoryRowV1[], right: StableInventoryRowV1[]): boolean {
  return left.length === right.length
    && left.every((row, index) => stableInventoryRowKey(row) === stableInventoryRowKey(right[index]))
}

function formalRowsFromStable(rows: StableInventoryRowV1[], chapterId: number): InventoryFormalRowV1[] {
  return sortFormalRows(rows.filter(row => row.chapterId === chapterId).map(row => stableFormalRow(row)))
}

async function inspectAdoptionState(input: {
  scope: WorkspaceScope
  progress: InventoryExtractionAdoptionProgressV1
}): Promise<{ fresh: boolean; nextAlreadyApplied: boolean; rows: StableInventoryRowV1[]; reason?: string }> {
  const current = stableInventory(await readOwnedRows<any>(input.scope, 'itemLedger', { owner: 'work' }))
  const targetIds = new Set(input.progress.candidate.plan.targetChapterIds)
  const original = input.progress.candidate.plan.originalInventory
  const currentOutside = current.filter(row => !targetIds.has(row.chapterId ?? -1))
  const originalOutside = original.filter(row => !targetIds.has(row.chapterId ?? -1))
  if (!exactStableRows(currentOutside, originalOutside)) {
    return { fresh: false, nextAlreadyApplied: false, rows: current, reason: 'outside-target-changed' }
  }
  let nextAlreadyApplied = false
  for (let index = 0; index < input.progress.formalChapters.length; index++) {
    const formal = input.progress.formalChapters[index]
    const currentFormal = formalRowsFromStable(current, formal.chapterId)
    const originalRows = original.filter(row => row.chapterId === formal.chapterId)
    const currentStable = current.filter(row => row.chapterId === formal.chapterId)
    const matchesFormal = sameValue(currentFormal, formal.rows)
    const matchesOriginal = exactStableRows(currentStable, originalRows)
    if (index < input.progress.nextChapterIndex) {
      if (!matchesFormal) return { fresh: false, nextAlreadyApplied: false, rows: current, reason: `applied-chapter-${index}-changed` }
    } else if (index === input.progress.nextChapterIndex) {
      if (!matchesFormal && !matchesOriginal) {
        return { fresh: false, nextAlreadyApplied: false, rows: current, reason: `current-chapter-${index}-changed` }
      }
      nextAlreadyApplied = matchesFormal
    } else if (!matchesOriginal) {
      return { fresh: false, nextAlreadyApplied: false, rows: current, reason: `pending-chapter-${index}-changed` }
    }
  }
  return { fresh: true, nextAlreadyApplied, rows: current }
}

async function allFormalState(input: {
  scope: WorkspaceScope
  progress: InventoryExtractionAdoptionProgressV1
}): Promise<{ fresh: boolean; rows: StableInventoryRowV1[] }> {
  const current = stableInventory(await readOwnedRows<any>(input.scope, 'itemLedger', { owner: 'work' }))
  const targetIds = new Set(input.progress.candidate.plan.targetChapterIds)
  const original = input.progress.candidate.plan.originalInventory
  const outsideFresh = exactStableRows(
    current.filter(row => !targetIds.has(row.chapterId ?? -1)),
    original.filter(row => !targetIds.has(row.chapterId ?? -1)),
  )
  const chaptersFresh = input.progress.formalChapters.every(formal => (
    sameValue(formalRowsFromStable(current, formal.chapterId), formal.rows)
  ))
  return { fresh: outsideFresh && chaptersFresh, rows: current }
}

async function saveAdoptionProgress(
  scope: WorkspaceScope,
  runId: number,
  input: Omit<InventoryExtractionAdoptionProgressV1, 'progressHash'>,
): Promise<{ snapshot: AgentRunSnapshotV1; progress: InventoryExtractionAdoptionProgressV1 }> {
  const progress = { ...input, progressHash: await hashCanonicalValue(input) }
  const saved = await createAgentRunCheckpointV1({ scope, runId, resumePayload: progress })
  return { snapshot: saved.snapshot, progress }
}

export async function adoptInventoryExtractionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  selectedIndexes: number[]
  onDurableBoundary?: (boundary: InventoryExtractionAdoptionBoundaryV1, snapshot: AgentRunSnapshotV1, chapterIndex?: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; written: number }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  if (!candidate) throw new Error('物品候选不在可采纳状态。')
  const indexes = [...new Set(input.selectedIndexes)].sort((left, right) => left - right)
  if (indexes.some(index => !Number.isInteger(index) || index < 0 || index >= candidate.events.length)) {
    throw new Error('物品候选选择无效。')
  }
  let adoption = state.adoption
  if (adoption && !sameValue(adoption.selectedIndexes, indexes)) throw new Error('物品采纳选择与冻结意图不一致。')
  const step = snapshot.projection.steps[INVENTORY_EXTRACTION_STEP_ID_V1]
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && adoption) {
    let upstreamFresh = true
    try { await verifyCurrentPlan(input.scope, candidate.plan, { requireInventoryBaseline: false }) } catch { upstreamFresh = false }
    const formal = await allFormalState({ scope: input.scope, progress: adoption })
    const adoptionHash = await hashCanonicalValue({ intentHash: adoption.intentHash, formalState: formal.rows })
    if (!upstreamFresh || !formal.fresh || adoptionHash !== step?.adoptionHash) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope, runId: snapshot.run.id, reason: 'inventory-extraction-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: INVENTORY_EXTRACTION_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'inventory-extraction-terminal-evidence-stale',
      })
      throw new Error('物品提取完成回执已过期。')
    }
    return { snapshot, receiptHash: snapshot.projection.terminalReceiptHash, written: indexes.length }
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    try { await verifyCurrentPlan(input.scope, candidate.plan) } catch (error) {
      snapshot = await append(input.scope, snapshot, 'candidate.staled', {
        stepId: INVENTORY_EXTRACTION_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'inventory-extraction-source-or-baseline-changed',
      })
      throw error
    }
    if (!adoption) {
      const formalChapters = await buildFormalChapters(candidate, indexes)
      const intentBody = { candidate, selectedIndexes: indexes, formalChapters }
      const base = {
        version: 1 as const,
        kind: 'inventory-extraction-adoption-progress' as const,
        portable: false as const,
        candidate,
        selectedIndexes: indexes,
        formalChapters,
        nextChapterIndex: 0,
        appliedChapterHashes: [] as string[],
        intentHash: await hashCanonicalValue(intentBody),
      }
      const saved = await saveAdoptionProgress(input.scope, snapshot.run.id, base)
      snapshot = saved.snapshot
      adoption = saved.progress
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: INVENTORY_EXTRACTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: INVENTORY_EXTRACTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      intentHash: adoption.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (step?.confirmation !== 'adopt' || !adoption) {
    throw new Error('物品候选不在可恢复采纳状态。')
  }
  try { await verifyCurrentPlan(input.scope, candidate.plan, { requireInventoryBaseline: false }) } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'inventory-extraction-upstream-stale-during-adoption')
    throw error
  }
  while (adoption.nextChapterIndex < adoption.formalChapters.length) {
    const chapterIndex = adoption.nextChapterIndex
    const formal = adoption.formalChapters[chapterIndex]
    const inspected = await inspectAdoptionState({ scope: input.scope, progress: adoption })
    if (!inspected.fresh) {
      await pauseUnsafeRun(input.scope, snapshot, 'inventory-extraction-formal-state-diverged')
      throw new Error(`物品正式状态与冻结采纳进度不一致：${inspected.reason ?? 'unknown'}。`)
    }
    if (!inspected.nextAlreadyApplied) {
      const result = await replaceAdoptedCollection({
        projectId: input.scope.projectId,
        workspaceScope: input.scope,
        target: 'itemLedger',
        scope: { chapterId: formal.chapterId },
        data: formal.rows.map(row => ({ ...row } as Record<string, unknown>)),
      })
      if (result.written.length !== formal.rows.length) throw new Error('物品章节替换未完整写入。')
    }
    const current = stableInventory(await readOwnedRows<any>(input.scope, 'itemLedger', { owner: 'work' }))
    if (!sameValue(formalRowsFromStable(current, formal.chapterId), formal.rows)) {
      throw new Error('物品章节替换后正式状态与冻结意图不一致。')
    }
    await input.onDurableBoundary?.('formal.chapter', snapshot, chapterIndex)
    const nextBase = {
      version: 1 as const,
      kind: 'inventory-extraction-adoption-progress' as const,
      portable: false as const,
      candidate,
      selectedIndexes: adoption.selectedIndexes,
      formalChapters: adoption.formalChapters,
      nextChapterIndex: chapterIndex + 1,
      appliedChapterHashes: [...adoption.appliedChapterHashes, formal.rowsHash],
      intentHash: adoption.intentHash,
    }
    const saved = await saveAdoptionProgress(input.scope, snapshot.run.id, nextBase)
    snapshot = saved.snapshot
    adoption = saved.progress
  }
  const terminal = await allFormalState({ scope: input.scope, progress: adoption })
  if (!terminal.fresh) {
    await pauseUnsafeRun(input.scope, snapshot, 'inventory-extraction-formal-state-changed-before-terminal')
    throw new Error('物品正式状态在终验前发生变化。')
  }
  let adoptionHash = snapshot.projection.steps[INVENTORY_EXTRACTION_STEP_ID_V1]?.adoptionHash
  if (!adoptionHash) {
    adoptionHash = await hashCanonicalValue({ intentHash: adoption.intentHash, formalState: terminal.rows })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: INVENTORY_EXTRACTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  if (snapshot.projection.steps[INVENTORY_EXTRACTION_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: INVENTORY_EXTRACTION_STEP_ID_V1, attempt: 1, outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: INVENTORY_EXTRACTION_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const postStateHash = await hashCanonicalValue(terminal.rows)
  const contextManifestHashes = [
    candidate.plan.inventoryContextManifestHash,
    candidate.plan.characterContextManifestHash,
    ...new Set(candidate.plan.chunks.map(chunk => chunk.contextManifestHash)),
  ]
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes,
    candidateHashes: [candidate.candidateHash],
    adoptionEventIds: [],
    postStateHash,
    verifierSetVersion: INVENTORY_EXTRACTION_VERIFIER_SET_V1,
    criteria: [
      { id: 'inventory.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'inventory.author', status: 'passed', evidenceRefs: [`intent:${adoption.intentHash}`] },
      { id: 'inventory.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, receiptHash: receipt.receiptHash, written: indexes.length }
}

export async function abandonInventoryExtractionV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  if (['completed', 'cancelled', 'failed'].includes(snapshot.projection.state)) return snapshot
  const state = await latestState(input.scope, input.runId)
  if (state.adoption && snapshot.projection.steps[INVENTORY_EXTRACTION_STEP_ID_V1]?.confirmation === 'adopt') {
    throw new Error('物品替换已经开始；请继续完成冻结采纳，不能放弃为半完成状态。')
  }
  if (snapshot.projection.state === 'awaiting_confirmation' && state.candidate) {
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: INVENTORY_EXTRACTION_STEP_ID_V1,
      candidateHash: state.candidate.candidateHash,
      decision: 'reject',
    })
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-inventory-extraction' })
}
