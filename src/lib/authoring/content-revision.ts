import { PROJECT_TABLES } from '../registry/project-tables'
import type { TableSpec } from '../registry/types'
import type { AgentEvent, AgentRunRecord, OutlineNode, WorkspaceScope } from '../types'
import { parseAgentEventPayload } from '../types/agent-session'
import { assertRecordInScope, readOwnedRows } from '../workspace/scope'
import { hashCanonicalValue } from '../agent/run/hash'
import { readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { db } from '../db/schema'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import type { OutlineGenerationAdoptionIntentV1, OutlineGenerationBatchRefV1 } from '../outline/candidate-lifecycle'
import Dexie from 'dexie'

export interface WorkspaceContentRevisionEntryV1 {
  table: string
  rowCount: number
  contentHash: string
}

export interface WorkspaceContentRevisionVectorV1 {
  version: 1
  entries: WorkspaceContentRevisionEntryV1[]
  vectorHash: string
}

/** Local execution evidence, never an import/remapping authorization. Only the
 * domain producer may record this as the existing run's adoption evidence. */
export interface OutlineBatchAppendEvidenceV1 {
  version: 1
  type: 'outline-batch-append-v1'
  portable: false
  runId: number
  candidateHash: string
  originalVectorHash: string
  batch: OutlineGenerationBatchRefV1
  intent: Extract<OutlineGenerationAdoptionIntentV1, { kind: 'chapters' }>
  additions: Array<{ id: number; resourceUid: string; contentHash: string }>
  adoptionEvidence: unknown
}

export const OUTLINE_BATCH_APPEND_PAYLOAD_TYPE_V1 = 'outline-batch-append-evidence-v1'

function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

/**
 * Derive the conservative Canon set from PROJECT_TABLES metadata. Agent logs,
 * caches, usage and transient tables are excluded without introducing another
 * table-name registry.
 */
export function contentRevisionTableSpecsV1(): TableSpec[] {
  return PROJECT_TABLES
    .filter(spec => spec.workspaceProjection != null || spec.worldSemantic != null)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function parseWorkspaceContentRevisionV1(value: unknown): WorkspaceContentRevisionVectorV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('内容修订向量必须是对象')
  }
  const record = value as Partial<WorkspaceContentRevisionVectorV1>
  if (record.version !== 1 || !Array.isArray(record.entries) || !hash(record.vectorHash)) {
    throw new Error('内容修订向量身份或哈希无效')
  }
  const allowed = new Set(contentRevisionTableSpecsV1().map(spec => spec.name))
  const entries = record.entries.map(entry => {
    if (!entry || typeof entry.table !== 'string' || !allowed.has(entry.table)
      || !Number.isInteger(entry.rowCount) || entry.rowCount < 0 || !hash(entry.contentHash)) {
      throw new Error('内容修订向量表项无效')
    }
    return { table: entry.table, rowCount: entry.rowCount, contentHash: entry.contentHash }
  })
  if (new Set(entries.map(entry => entry.table)).size !== entries.length) {
    throw new Error('内容修订向量包含重复表项')
  }
  const parsed: WorkspaceContentRevisionVectorV1 = {
    version: 1,
    entries: entries.sort((left, right) => left.table.localeCompare(right.table)),
    vectorHash: record.vectorHash,
  }
  return parsed
}

function inWorldGroup(
  spec: TableSpec,
  row: Record<string, unknown>,
  worldGroupId: number | null,
): boolean {
  if (spec.worldScoped) {
    const field = spec.worldGroupField ?? 'worldGroupId'
    return (row[field] ?? null) === worldGroupId
  }
  if (spec.homeWorldScoped) {
    if (worldGroupId == null) return true
    return row.isCrossWorld === true || (row.homeWorldGroupId ?? null) === worldGroupId
  }
  return true
}

function vectorBody(input: Omit<WorkspaceContentRevisionVectorV1, 'vectorHash'>): unknown {
  return input
}

async function readRevisionRows(
  spec: TableSpec,
  scope: WorkspaceScope,
): Promise<Record<string, unknown>[]> {
  if (spec.owner === 'global' || spec.table.schema.idxByName.projectId) {
    return readOwnedRows<Record<string, unknown>>(scope, spec.name)
  }
  const owned: Record<string, unknown>[] = []
  for (const row of await spec.table.toArray() as Record<string, unknown>[]) {
    if (await assertRecordInScope(scope, spec.name, row)) owned.push(row)
  }
  return owned
}

async function captureRevision(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
}, additions: readonly OutlineBatchAppendEvidenceV1['additions'][number][] = []): Promise<WorkspaceContentRevisionVectorV1> {
  const entries: WorkspaceContentRevisionEntryV1[] = []
  for (const spec of contentRevisionTableSpecsV1()) {
    let rows = (await readRevisionRows(spec, input.scope))
      .filter(row => inWorldGroup(spec, row, input.worldGroupId))
      .sort((left, right) => Number(left.id ?? 0) - Number(right.id ?? 0))
    if (spec.name === 'outlineNodes' && additions.length) {
      const ids = new Map<number, true>()
      const uids = new Map<string, true>()
      for (const addition of additions) {
        const row = rows.find(item => item.id === addition.id)
        if (ids.has(addition.id) || uids.has(addition.resourceUid) || !row
          || !isPortableResourceUidV1(addition.resourceUid, 'outline-node')
          || row.ragDocumentId !== addition.resourceUid
          || await Dexie.waitFor(hashCanonicalValue(row)) !== addition.contentHash) {
          throw new Error('本批已采纳行的身份或完整来源证据已变化')
        }
        ids.set(addition.id, true); uids.set(addition.resourceUid, true)
      }
      rows = rows.filter(row => !ids.has(Number(row.id)))
    }
    entries.push({
      table: spec.name,
      rowCount: rows.length,
      contentHash: await Dexie.waitFor(hashCanonicalValue(rows)),
    })
  }
  const body = {
    version: 1 as const,
    entries,
  }
  return { ...body, vectorHash: await Dexie.waitFor(hashCanonicalValue(vectorBody(body))) }
}

export async function captureWorkspaceContentRevisionV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
}): Promise<WorkspaceContentRevisionVectorV1> {
  return captureRevision(input)
}

async function verifyRevision(
  frozen: WorkspaceContentRevisionVectorV1,
  input: { scope: WorkspaceScope; worldGroupId: number | null },
  additions: readonly OutlineBatchAppendEvidenceV1['additions'][number][] = [],
): Promise<{ fresh: boolean; current: WorkspaceContentRevisionVectorV1; changedTables: string[] }> {
  const parsed = parseWorkspaceContentRevisionV1(frozen)
  const expectedFrozenHash = await Dexie.waitFor(hashCanonicalValue(vectorBody({
    version: parsed.version,
    entries: parsed.entries,
  })))
  if (expectedFrozenHash !== parsed.vectorHash) throw new Error('内容修订向量完整性校验失败')
  const current = await captureRevision({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
  }, additions)
  const before = new Map(parsed.entries.map(entry => [entry.table, entry]))
  const changedTables = current.entries
    .filter(entry => {
      const prior = before.get(entry.table)
      return !prior || prior.rowCount !== entry.rowCount || prior.contentHash !== entry.contentHash
    })
    .map(entry => entry.table)
  return {
    fresh: current.vectorHash === parsed.vectorHash && changedTables.length === 0,
    current,
    changedTables,
  }
}

export async function verifyWorkspaceContentRevisionV1(
  frozen: WorkspaceContentRevisionVectorV1,
  input: { scope: WorkspaceScope; worldGroupId: number | null },
): Promise<{ fresh: boolean; current: WorkspaceContentRevisionVectorV1; changedTables: string[] }> {
  return verifyRevision(frozen, input)
}

interface OutlineBatchRevisionContextV1 {
  snapshot: AgentRunSnapshotV1
  candidateHash: string
  stepId: string
  batch: OutlineGenerationBatchRefV1
  revision: WorkspaceContentRevisionVectorV1
  events: AgentEvent[]
}

function revisionEvidenceHash(value: unknown): Promise<string> {
  return Dexie.waitFor(hashCanonicalValue(value))
}

async function outlineBatchRevisionContext(input: {
  scope: WorkspaceScope; worldGroupId: number | null; runId: number
}): Promise<OutlineBatchRevisionContextV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (snapshot.run.productRuntimeSessionId != null || snapshot.run.conversationId == null
    || (snapshot.run.worldGroupId ?? null) !== input.worldGroupId) throw new Error('批次内容证据越出作品或世界作用域')
  const events = (await readOwnedRows<AgentEvent>(input.scope, 'agentEvents', { owner: 'work' }))
    .filter(event => event.conversationId === snapshot.run.conversationId)
  for (const event of [...events].reverse()) {
    const payload = parseAgentEventPayload<{
      type?: string; runId?: number; stepId?: string; candidateHash?: string;
      batch?: OutlineGenerationBatchRefV1; contentRevision?: unknown
    }>(event, {})
    if (event.kind !== 'candidate' || payload.type !== 'outline-generation-candidate' || payload.runId !== input.runId) continue
    const batch = payload.batch
    if (!payload.stepId || !/^outline\.chapter:batch:\d+$/.test(payload.stepId)
      || !payload.candidateHash || snapshot.projection.steps[payload.stepId]?.candidateHash !== payload.candidateHash
      || await revisionEvidenceHash(event.content) !== payload.candidateHash
      || !batch || typeof batch.batchGroupId !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(batch.batchGroupId)
      || !Number.isInteger(batch.batchIndex) || !Number.isInteger(batch.batchTotal)
      || batch.batchIndex < 0 || batch.batchIndex >= batch.batchTotal) throw new Error('批次候选原始来源证据无效')
    return { snapshot, candidateHash: payload.candidateHash, stepId: payload.stepId, batch,
      revision: parseWorkspaceContentRevisionV1(payload.contentRevision), events }
  }
  throw new Error('批次运行缺少原始候选内容证据')
}

function expectedOutlineAppend(intent: OutlineBatchAppendEvidenceV1['intent']) {
  if (!intent || intent.version !== 1 || intent.kind !== 'chapters' || !Number.isInteger(intent.destinationVolumeId)
    || !Array.isArray(intent.items) || !Array.isArray(intent.baseExistingTitles)
    || !intent.baseExistingTitles.every(title => typeof title === 'string')
    || !Number.isInteger(intent.startingOrder) || intent.startingOrder < 0) throw new Error('批次采纳意图不合法')
  const normalize = (title: string) => title.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
  const titles = new Map(intent.baseExistingTitles.map(title => [normalize(title), true]))
  return intent.items.map((item, index) => {
    if (typeof item?.title !== 'string' || typeof item.summary !== 'string') throw new Error('批次采纳条目不合法')
    return { ...item, order: intent.startingOrder + index }
  }).filter(item => {
    const key = normalize(item.title)
    if (titles.has(key)) return false
    titles.set(key, true)
    return true
  })
}

async function assertOutlineAppendIntent(context: OutlineBatchRevisionContextV1, intent: OutlineBatchAppendEvidenceV1['intent']) {
  const expected = expectedOutlineAppend(intent)
  const started = context.snapshot.events.find(event => event.type === 'adoption.started'
    && event.payload.stepId === context.stepId && event.payload.candidateHash === context.candidateHash)
  if (!expected.length || context.stepId !== `outline.chapter:batch:${intent.destinationVolumeId}`
    || started?.type !== 'adoption.started' || started.payload.intentHash !== await revisionEvidenceHash(intent)) {
    throw new Error('批次追加缺少同一候选的作者确认意图')
  }
  return expected
}

async function completedOutlineBatchAdditions(input: {
  scope: WorkspaceScope; worldGroupId: number | null; runId: number
}, context: OutlineBatchRevisionContextV1): Promise<OutlineBatchAppendEvidenceV1['additions']> {
  const additions: OutlineBatchAppendEvidenceV1['additions'] = []
  const currentAdopted = context.snapshot.projection.steps[context.stepId]?.status === 'succeeded'
    && !!context.snapshot.projection.steps[context.stepId]?.adoptionHash
  const runs = (await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(run => run.id != null && (run.status === 'completed' || (run.id === input.runId && currentAdopted))
      && run.conversationId === context.snapshot.run.conversationId && (run.worldGroupId ?? null) === input.worldGroupId)
  const indices = new Map<number, number>()
  for (const run of runs) {
    const event = context.events.find(item => {
      const payload = parseAgentEventPayload<{ runId?: number; batch?: OutlineGenerationBatchRefV1 }>(item, {})
      return item.kind === 'candidate' && payload.runId === run.id && payload.batch?.batchGroupId === context.batch.batchGroupId
    })
    if (!event) continue
    const prior = await outlineBatchRevisionContext({ ...input, runId: run.id! })
    if (prior.batch.batchTotal !== context.batch.batchTotal || prior.revision.vectorHash !== context.revision.vectorHash
      || (run.id !== input.runId && !prior.snapshot.projection.terminalReceiptHash)
      || indices.has(prior.batch.batchIndex)) throw new Error('本批已采纳来源与原冻结批次不匹配')
    indices.set(prior.batch.batchIndex, run.id!)
    const records = prior.events.map(item => ({ item, payload: parseAgentEventPayload<{ type?: string; evidence?: OutlineBatchAppendEvidenceV1 }>(item, {}) }))
      .filter(({ item, payload }) => item.kind === 'plan' && item.durableRunId === run.id
        && payload.type === OUTLINE_BATCH_APPEND_PAYLOAD_TYPE_V1)
    if (records.length !== 1) throw new Error('本批已采纳运行缺少唯一追加证明')
    const proof = records[0].payload.evidence
    const committed = prior.snapshot.events.filter(item => item.type === 'adoption.committed' && item.payload.stepId === prior.stepId)
    if (!proof || proof.version !== 1 || proof.type !== 'outline-batch-append-v1' || proof.portable !== false
      || proof.runId !== run.id || proof.candidateHash !== prior.candidateHash
      || proof.originalVectorHash !== prior.revision.vectorHash
      || await revisionEvidenceHash(proof.batch) !== await revisionEvidenceHash(prior.batch)
      || !Array.isArray(proof.additions) || committed.length !== 1
      || committed[0].type !== 'adoption.committed'
      || committed[0].payload.adoptionHash !== await revisionEvidenceHash({ candidateHash: prior.candidateHash, evidence: proof })) {
      throw new Error('本批追加证明与真实采纳回执不匹配')
    }
    const expected = await assertOutlineAppendIntent(prior, proof.intent)
    if (proof.additions.length !== expected.length) throw new Error('本批追加证明未覆盖全部写入行')
    for (let index = 0; index < proof.additions.length; index++) {
      const addition = proof.additions[index]
      const row = Number.isSafeInteger(addition?.id) ? await db.outlineNodes.get(addition.id) : undefined
      const item = expected[index]
      if (!row || !await assertRecordInScope(input.scope, 'outlineNodes', row, { owner: 'work' })
        || row.type !== 'chapter' || row.parentId !== proof.intent.destinationVolumeId
        || row.title.normalize('NFKC').trim().toLocaleLowerCase('zh-CN') !== item.title.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
        || row.summary !== item.summary || row.order !== item.order || (row.worldGroupId ?? null) !== input.worldGroupId
        || !hash(addition.contentHash) || !isPortableResourceUidV1(addition.resourceUid, 'outline-node')) {
        throw new Error('本批已采纳行不再符合冻结的作者意图')
      }
    }
    additions.push(...proof.additions)
  }
  return additions
}

/** A dedicated run-id boundary, not a caller-provided ignore-row list. The
 * original candidate, owner, author intent, terminal run and adoption hash are
 * read from durable evidence before exact added rows can be subtracted. */
export async function assertOutlineBatchContentRevisionFreshV1(
  frozen: WorkspaceContentRevisionVectorV1,
  input: { scope: WorkspaceScope; worldGroupId: number | null; runId: number },
): Promise<void> {
  const context = await outlineBatchRevisionContext(input)
  if (await revisionEvidenceHash(parseWorkspaceContentRevisionV1(frozen)) !== await revisionEvidenceHash(context.revision)) {
    throw new Error('批次候选不能替换原始冻结内容向量')
  }
  const result = await verifyRevision(frozen, input, await completedOutlineBatchAdditions(input, context))
  if (!result.fresh) throw new Error(`候选生成后项目内容已变化，必须重新生成。变化表：${result.changedTables.join('、') || '未知'}`)
}

/** Prove only the actual confirmed append in this run. A concurrent or unknown
 * write makes reconstruction of the original full Canon vector fail. */
export async function proveOutlineBatchAppendV1(input: {
  scope: WorkspaceScope; worldGroupId: number | null; runId: number
  intent: OutlineBatchAppendEvidenceV1['intent']; targetIds: number[]; adoptionEvidence: unknown
}): Promise<OutlineBatchAppendEvidenceV1> {
  const context = await outlineBatchRevisionContext(input)
  const expected = await assertOutlineAppendIntent(context, input.intent)
  if (input.targetIds.length !== expected.length || new Set(input.targetIds).size !== input.targetIds.length) throw new Error('本批追加缺少准确的完整写入ID')
  const additions: OutlineBatchAppendEvidenceV1['additions'] = []
  for (let index = 0; index < input.targetIds.length; index++) {
    const row: OutlineNode | undefined = await db.outlineNodes.get(input.targetIds[index])
    const item = expected[index]
    if (!row || !await assertRecordInScope(input.scope, 'outlineNodes', row, { owner: 'work' })
      || row.type !== 'chapter' || row.parentId !== input.intent.destinationVolumeId
      || row.title.normalize('NFKC').trim().toLocaleLowerCase('zh-CN') !== item.title.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
      || row.summary !== item.summary || row.order !== item.order || (row.worldGroupId ?? null) !== input.worldGroupId
      || !isPortableResourceUidV1(row.ragDocumentId, 'outline-node')) throw new Error('本批追加行与作者意图或资源身份不一致')
    additions.push({ id: input.targetIds[index], resourceUid: row.ragDocumentId, contentHash: await revisionEvidenceHash(row) })
  }
  const prior = await completedOutlineBatchAdditions(input, context)
  const result = await verifyRevision(context.revision, input, [...prior, ...additions])
  if (!result.fresh) throw new Error(`本批采纳期间其它内容已变化：${result.changedTables.join('、')}`)
  return { version: 1, type: 'outline-batch-append-v1', portable: false,
    runId: input.runId, candidateHash: context.candidateHash, originalVectorHash: context.revision.vectorHash,
    batch: context.batch, intent: input.intent, additions, adoptionEvidence: input.adoptionEvidence }
}

export async function assertWorkspaceContentRevisionFreshV1(
  frozen: WorkspaceContentRevisionVectorV1,
  input: { scope: WorkspaceScope; worldGroupId: number | null },
): Promise<void> {
  const result = await verifyWorkspaceContentRevisionV1(frozen, input)
  if (!result.fresh) {
    throw new Error(`候选生成后项目内容已变化，必须重新生成。变化表：${result.changedTables.join('、') || '未知'}`)
  }
}
