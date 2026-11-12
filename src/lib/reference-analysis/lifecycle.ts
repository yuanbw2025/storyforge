import Dexie, { type Table } from 'dexie'
import { parseLegacyIdArray } from '../utils/legacy-id-array'
import { db } from '../db/schema'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { adopt } from '../registry/adopt'
import type {
  AnalysisDimension,
  Reference,
  ReferenceAnalysisDepth,
  ReferenceAnalysisRun,
  ReferenceAnalysisSource,
  ReferenceChunkAnalysis,
  ReferenceSourceKind,
  ReferenceUsageScope,
} from '../types'
import { ANALYSIS_DIMENSIONS } from '../types/reference'
import type { ChunkPlan } from '../import/chunker'
import type { WorkspaceScope } from '../types/world-ownership'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  scopeTransactionTables,
  stampNewRecord,
} from '../workspace/scope'


export const REFERENCE_ANALYSIS_RUN_POLICY = Object.freeze({
  maxRunsPerReference: 6,
  sourceKinds: ['own-work', 'authorized', 'public-domain', 'research', 'unknown'] as const,
  usageScopes: ['analysis-only', 'creative-reference', 'continuation-authorized'] as const,
})

export interface CreateReferenceAnalysisRunInput {
  referenceId: number
  depth: ReferenceAnalysisDepth
  sourceFilename: string
  fileHash: string
  totalChars: number
  expectedChunks: number
  sourceKind: ReferenceSourceKind
  usageScope: ReferenceUsageScope
  rightsNote?: string
  rightsConfirmed: boolean
  sourceText?: string
  sourceChunks?: ChunkPlan[]
}

function constrainUsageScope(
  sourceKind: ReferenceSourceKind,
  usageScope: ReferenceUsageScope,
): ReferenceUsageScope {
  if (sourceKind === 'research' || sourceKind === 'unknown') return 'analysis-only'
  return usageScope
}

async function requireReference(referenceId: number): Promise<{ ref: Reference; scope: WorkspaceScope }> {
  const existingRecord = await db.references.get(referenceId)
  if (!existingRecord?.id) throw new Error('参考资料不存在')
  const scope = await resolveScopeLike(existingRecord.projectId)
  const ref = await db.references.get(referenceId)
  if (!ref?.id || !await assertRecordInScope(scope, 'references', ref, { owner: 'work' })) {
    throw new Error('参考资料不存在或不属于当前作品')
  }
  return { ref, scope }
}

async function requireRun(runId: number): Promise<{
  run: ReferenceAnalysisRun
  ref: Reference
  scope: WorkspaceScope
}> {
  const existingRecord = await db.referenceAnalysisRuns.get(runId)
  if (!existingRecord?.id) throw new Error('分析版本不存在')
  const scope = await resolveScopeLike(existingRecord.projectId)
  const run = await db.referenceAnalysisRuns.get(runId)
  if (!run?.id || !await assertRecordInScope(scope, 'referenceAnalysisRuns', run, { owner: 'work' })) {
    throw new Error('分析版本不存在或不属于当前作品')
  }
  const ref = await db.references.get(run.referenceId)
  if (!ref?.id || !await assertRecordInScope(scope, 'references', ref, { owner: 'work' })) {
    throw new Error('分析版本引用的参考资料不存在或越过当前作品')
  }
  return { run, ref, scope }
}

async function pruneOneDisposableRun(referenceId: number, scope: WorkspaceScope): Promise<boolean> {
  const runs = (await readOwnedRows<ReferenceAnalysisRun>(scope, 'referenceAnalysisRuns', { owner: 'work' }))
    .filter(run => run.referenceId === referenceId)
  if (runs.length < REFERENCE_ANALYSIS_RUN_POLICY.maxRunsPerReference) return true
  const disposable = runs
    .filter(run => run.status === 'failed' || run.status === 'cancelled' || run.status === 'superseded')
    .sort((a, b) => a.updatedAt - b.updatedAt)
  for (const row of disposable) {
    if (!row.id) continue
    // A prepared or observed Harness attempt is never disposable by age.
    if ((await localSourceTable().get(row.id))?.durableChunkRunsV1?.length) continue
    await discardReferenceAnalysisRun(row.id)
    return true
  }
  return false
}

export interface ReferenceAnalysisFirstStartGuardV1 {
  /** Tables needed to validate and record the original author's first-start claim. */
  transactionTables: readonly Table[]
  claimInTransaction: () => Promise<void>
}

export async function createReferenceAnalysisRun(
  input: CreateReferenceAnalysisRunInput,
  firstStart?: ReferenceAnalysisFirstStartGuardV1,
): Promise<ReferenceAnalysisRun> {
  const { ref, scope } = await requireReference(input.referenceId)
  if (!input.sourceFilename.trim()) throw new Error('来源文件名不能为空')
  if (!input.fileHash.trim()) throw new Error('来源文件哈希不能为空')
  if (input.totalChars <= 0 || input.expectedChunks <= 0) throw new Error('来源文本或分块计划为空')
  if (!firstStart && !await pruneOneDisposableRun(ref.id!, scope)) {
    throw new Error(`每份参考最多保留 ${REFERENCE_ANALYSIS_RUN_POLICY.maxRunsPerReference} 个版本，请先删除未使用版本`)
  }

  const existing = firstStart ? [] : (await readOwnedRows<ReferenceAnalysisRun>(scope, 'referenceAnalysisRuns', { owner: 'work' }))
    .filter(run => run.referenceId === ref.id)
  const version = Math.max(0, ...existing.map(run => run.version)) + 1
  const now = Date.now()
  const row = stampNewRecord(scope, 'referenceAnalysisRuns', {
    projectId: ref.projectId,
    referenceId: ref.id,
    version,
    status: 'analyzing',
    depth: input.depth,
    sourceFilename: input.sourceFilename.trim(),
    fileHash: input.fileHash.trim(),
    totalChars: input.totalChars,
    sourceKind: input.sourceKind,
    usageScope: constrainUsageScope(input.sourceKind, input.usageScope),
    rightsNote: (input.rightsNote ?? '').trim().slice(0, 1000),
    rightsConfirmed: input.rightsConfirmed,
    rightsDeclaredAt: now,
    expectedChunks: input.expectedChunks,
    completedChunks: 0,
    progress: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as ReferenceAnalysisRun

  const runId = await db.transaction(
    'rw',
    [...new Set([db.referenceAnalysisRuns, db.referenceAnalysisSources, ...(firstStart?.transactionTables ?? [])])],
    async () => {
      const transaction = Dexie.currentTransaction!
      let claimedImport = false
      if (firstStart) {
        if (await db.referenceAnalysisRuns.where('referenceId').equals(ref.id!).count() !== 0)
          throw new Error('原参考已有分析版本，请在项目参考查看。')
        const sessionId = ref.importSessionId
        const checksImport = sessionId != null && transaction.storeNames.includes(db.importSessions.name)
        const original = checksImport ? await db.importSessions.get(sessionId) : undefined
        await Dexie.Promise.resolve(firstStart.claimInTransaction())
        if (original && original.publishedReferenceId === ref.id && original.referenceAnalysisStartedAt == null) {
          const claimed = await db.importSessions.get(original.id!)
          claimedImport = claimed?.publishedReferenceId === ref.id && claimed?.referenceAnalysisStartedAt != null
        }
      }
      const runs = firstStart ? transaction.table<ReferenceAnalysisRun, number>(db.referenceAnalysisRuns.name) : db.referenceAnalysisRuns
      const id = await runs.add(row) as number
      if (input.sourceText != null || input.sourceChunks?.length) {
        const chunks = input.sourceChunks?.length
          ? input.sourceChunks
          : [{
              index: 0,
              startChar: 0,
              endChar: input.sourceText!.length,
              charCount: input.sourceText!.length,
              label: '全书',
              text: input.sourceText!,
            }]
        const source = stampNewRecord(scope, 'referenceAnalysisSources', {
          analysisRunId: id,
          filename: row.sourceFilename,
          fileHash: row.fileHash,
          chunks,
          ...(input.rightsConfirmed || (input.depth === 'deep' && claimedImport) ? {
            referencePrivateExecutionV1: input.rightsConfirmed ? 'rights-confirmed' as const : 'import-analysis-only' as const,
          } : {}),
          createdAt: now,
        }, { owner: 'work' }) as ReferenceAnalysisSource
        const sources = firstStart ? transaction.table<ReferenceAnalysisSource, number>(db.referenceAnalysisSources.name) : db.referenceAnalysisSources
        await sources.put(source)
      }
      return id
    },
  )
  return { ...row, id: runId }
}

export async function listReferenceAnalysisRuns(referenceId: number): Promise<ReferenceAnalysisRun[]> {
  const { scope } = await requireReference(referenceId)
  const runs = (await readOwnedRows<ReferenceAnalysisRun>(scope, 'referenceAnalysisRuns', { owner: 'work' }))
    .filter(run => run.referenceId === referenceId)
  return runs.sort((a, b) => b.version - a.version)
}

export async function getActiveReferenceAnalysisRun(
  referenceId: number,
): Promise<ReferenceAnalysisRun | undefined> {
  const { scope } = await requireReference(referenceId)
  return (await readOwnedRows<ReferenceAnalysisRun>(scope, 'referenceAnalysisRuns', { owner: 'work' }))
    .filter(run => run.referenceId === referenceId)
    .find(run => run.status === 'active')
}

export async function getReferenceAnalysisRunChunks(
  referenceId: number,
  analysisRunId?: number,
): Promise<ReferenceChunkAnalysis[]> {
  const { scope } = await requireReference(referenceId)
  const run = analysisRunId
    ? (await requireRun(analysisRunId)).run
    : await getActiveReferenceAnalysisRun(referenceId)
  if (run && run.referenceId !== referenceId) return []
  const chunks = await readOwnedRows<ReferenceChunkAnalysis>(scope, 'referenceChunkAnalysis', { owner: 'work' })
  return chunks
    .filter(chunk => run?.id != null && chunk.analysisRunId === run.id)
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
}

export async function readReferenceAnalysisSource(runId: number): Promise<string | undefined> {
  const run = await db.referenceAnalysisRuns.get(runId)
  if (!run) return undefined
  const scope = await resolveReadScopeLike(run.projectId)
  if (!await assertRecordInScope(scope, 'referenceAnalysisRuns', run, { owner: 'work' })) return undefined
  const source = await db.referenceAnalysisSources.get(runId)
  return source && await assertRecordInScope(scope, 'referenceAnalysisSources', source, { owner: 'work' })
    ? source.chunks.map(chunk => chunk.text).join('\n\n')
    : undefined
}

export async function readReferenceAnalysisChunks(runId: number): Promise<ChunkPlan[] | undefined> {
  const run = await db.referenceAnalysisRuns.get(runId)
  if (!run) return undefined
  const scope = await resolveReadScopeLike(run.projectId)
  if (!await assertRecordInScope(scope, 'referenceAnalysisRuns', run, { owner: 'work' })) return undefined
  const source = await db.referenceAnalysisSources.get(runId)
  return source && await assertRecordInScope(scope, 'referenceAnalysisSources', source, { owner: 'work' })
    ? source.chunks
    : undefined
}

export interface ReferenceChunkRunLinkV1 {
  chunkIndex: number
  ordinal: number
  claimKey: string
  agentRunId: number | null
}

type LocalReferenceSource = ReferenceAnalysisSource & {
  referencePrivateExecutionV1?: 'rights-confirmed' | 'import-analysis-only'
  durableChunkRunsV1?: ReferenceChunkRunLinkV1[]
}

function localSourceTable() {
  return db.table<LocalReferenceSource, number>(db.referenceAnalysisSources.name)
}

async function hasConfirmedImportChunk(scope: WorkspaceScope, ref: Reference, run: ReferenceAnalysisRun, chunk: ChunkPlan) {
  if (ref.importSessionId == null || run.sourceKind !== 'unknown' || run.usageScope !== 'analysis-only') return false
  const session = await db.importSessions.get(ref.importSessionId)
  if (!session || session.importTarget !== 'reference' || session.analysisDepth !== 'deep' || session.status !== 'done' ||
    session.referenceAnalysisStartedAt == null || session.publishedReferenceId !== ref.id || session.fileHash !== run.fileHash ||
    session.projectId !== scope.projectId || session.targetScope?.projectId !== scope.projectId ||
    session.targetScope.worldId !== scope.worldId || session.targetScope.workId !== scope.workId ||
    session.totalChunks !== run.expectedChunks || session.chunks.length !== session.totalChunks) return false
  const original = session.chunks[chunk.index]
  const link = original?.durableParse
  const receipt = link?.confirmation?.receipt
  if (!original || original.status !== 'done' || original.index !== chunk.index ||
    original.startChar !== chunk.startChar || original.endChar !== chunk.endChar || original.charCount !== chunk.charCount ||
    link?.runId == null || !receipt || receipt.runId !== link.runId || receipt.verifierSetVersion !== 'document-import-terminal-v1') return false
  const parser = await db.agentRuns.get(link.runId)
  if (!parser || parser.projectId !== scope.projectId || parser.workId !== scope.workId ||
    parser.terminalReceiptHash !== receipt.receiptHash || parser.contractHash !== receipt.contractHash) return false
  const [sourceHash, validReceipt] = await Dexie.waitFor(Promise.all([
    sha256Text(chunk.text),
    import('../agent/run/verification-receipt').then(module => module.verifyVerificationReceiptIntegrityV1(receipt)),
  ]))
  return validReceipt && original.sourceTextHash === sourceHash
}

/** Only the physical Harness link lives on the existing private source.
 * Attempt state, exact response and usage remain in the Harness event ledger. */
export async function readReferenceChunkAuthorityV1(scope: WorkspaceScope, runId: number, chunkIndex: number) {
  const { run, ref, scope: actual } = await requireRun(runId)
  if (scope.projectId !== actual.projectId || scope.worldId !== actual.worldId || scope.workId !== actual.workId)
    throw new Error('参考分析不属于当前作品。')
  const source = await localSourceTable().get(runId)
  const chunk = source?.chunks.find(row => row.index === chunkIndex)
  if (!source || source.fileHash !== run.fileHash || !chunk
    || !await assertRecordInScope(actual, 'referenceAnalysisSources', source, { owner: 'work' }))
    throw new Error('参考分析原文已变化、丢失或切换作品。')
  const confirmed = source.referencePrivateExecutionV1 === 'rights-confirmed' && run.rightsConfirmed
  const importedAnalysisOnly = source.referencePrivateExecutionV1 === 'import-analysis-only' &&
    await hasConfirmedImportChunk(actual, ref, run, chunk)
  if (!confirmed && !importedAnalysisOnly)
    throw new Error('旧版本没有可核实的请求授权，不能续发。请核对后新建分析版本。')
  const latest = [...(source.durableChunkRunsV1 ?? [])].reverse().find(row => row.chunkIndex === chunkIndex)
  return { run, ref, scope: actual, source, chunk, latest }
}

export async function writeReferenceChunkRunLinkV1(
  scope: WorkspaceScope, runId: number, chunk: ChunkPlan,
  expected: ReferenceChunkRunLinkV1 | undefined, next: ReferenceChunkRunLinkV1,
): Promise<void> {
  const sources = localSourceTable()
  await db.transaction('rw', scopeTransactionTables(db.referenceAnalysisRuns, db.references, db.importSessions, db.agentRuns, sources), async () => {
    const current = await readReferenceChunkAuthorityV1(scope, runId, chunk.index)
    const latest = current.latest
    if (current.chunk.text !== chunk.text || current.chunk.startChar !== chunk.startChar ||
      current.chunk.endChar !== chunk.endChar || current.run.status !== 'analyzing' ||
      latest?.claimKey !== expected?.claimKey || latest?.agentRunId !== expected?.agentRunId || next.chunkIndex !== chunk.index)
      throw new Error('参考分析来源或请求状态已变化，未重复发送。')
    const links = [...(current.source.durableChunkRunsV1 ?? [])]
    if (next.agentRunId === null) {
      if (next.ordinal !== (latest?.ordinal ?? 0) + 1) throw new Error('参考分析尝试顺序不符。')
      links.push(next)
    } else {
      if (!latest || latest.agentRunId !== null || latest.claimKey !== next.claimKey || latest.ordinal !== next.ordinal)
        throw new Error('参考分析 Harness 与原请求凭据不匹配。')
      links[links.findIndex(row => row.claimKey === latest.claimKey)] = next
    }
    if (await sources.update(runId, { durableChunkRunsV1: links }) !== 1) throw new Error('参考分析原文已删除。')
  })
}

export async function patchReferenceAnalysisRun(
  runId: number,
  changes: Partial<ReferenceAnalysisRun>,
): Promise<void> {
  const { run, scope } = await requireRun(runId)
  const result = await adopt({
    projectId: run.projectId,
    scope,
    target: 'referenceAnalysisRuns',
    recordId: runId,
    mode: 'replace',
    data: changes as Record<string, unknown>,
  })
  if (!result.written.length) {
    throw new Error(`分析版本写回被拒绝：${result.skipped[0]?.reason ?? result.typeErrors[0]?.field ?? 'unknown'}`)
  }
}

export async function completeReferenceAnalysisRun(
  runId: number,
  _reportedCompletedChunks: number,
  error?: string,
): Promise<'active' | 'ready' | 'failed'> {
  const { run, scope } = await requireRun(runId)
  const completedChunks = (await readOwnedRows<ReferenceChunkAnalysis>(scope, 'referenceChunkAnalysis', { owner: 'work' }))
    .filter(chunk => chunk.analysisRunId === runId).length
  const hasResults = completedChunks > 0
  if (!hasResults) {
    await patchReferenceAnalysisRun(runId, {
      status: 'failed',
      completedChunks: 0,
      progress: 0,
      error: error || '没有可用分析结果',
      completedAt: Date.now(),
    })
    const active = await getActiveReferenceAnalysisRun(run.referenceId)
    if (!active) await patchReferenceActiveProjection(run.referenceId, {
      analysisStatus: 'failed',
      analysisError: error || '没有可用分析结果',
      analysisProgress: 0,
    })
    return 'failed'
  }

  const active = await getActiveReferenceAnalysisRun(run.referenceId)
  // The original free import projects already-reviewed techniques. Uploaded model results await activation.
  if (!active && run.depth === 'quick' && !(await localSourceTable().get(runId))?.referencePrivateExecutionV1) {
    await patchReferenceAnalysisRun(runId, {
      status: 'ready',
      completedChunks,
      progress: Math.min(100, Math.round((completedChunks / run.expectedChunks) * 100)),
      error: error ?? null,
      completedAt: Date.now(),
    })
    await activateReferenceAnalysisRun(runId)
    return 'active'
  }
  await patchReferenceAnalysisRun(runId, {
    status: 'ready',
    completedChunks,
    progress: Math.min(100, Math.round((completedChunks / run.expectedChunks) * 100)),
    error: error ?? null,
    completedAt: Date.now(),
  })
  return 'ready'
}

export async function activateReferenceAnalysisRun(runId: number): Promise<void> {
  const { run: target, ref, scope } = await requireRun(runId)
  if (!['ready', 'active', 'superseded'].includes(target.status)) {
    throw new Error('只有已完成版本可以激活')
  }
  const now = Date.now()
  await db.transaction('rw', db.references, db.referenceAnalysisRuns, async () => {
    const runs = (await readOwnedRows<ReferenceAnalysisRun>(scope, 'referenceAnalysisRuns', { owner: 'work' }))
      .filter(run => run.referenceId === target.referenceId)
    for (const run of runs) {
      if (!run.id || run.id === runId || run.status !== 'active') continue
      await db.referenceAnalysisRuns.update(run.id, { status: 'superseded', updatedAt: now })
    }
    await db.referenceAnalysisRuns.update(runId, {
      status: 'active',
      activatedAt: now,
      updatedAt: now,
    })
    await db.references.update(ref.id!, {
      totalChars: target.totalChars,
      fileHash: target.fileHash,
      analysisDepth: target.depth,
      analysisStatus: 'done',
      analysisProgress: target.progress,
      analysisError: target.error,
      analysisSummary: target.analysisSummary,
      mergedCharacters: target.mergedCharacters,
      updatedAt: now,
    })
  })
}

export async function updateReferenceAnalysisDerived(
  runId: number,
  changes: Pick<ReferenceAnalysisRun, 'analysisSummary'> | Pick<ReferenceAnalysisRun, 'mergedCharacters'>,
): Promise<void> {
  await patchReferenceAnalysisRun(runId, changes)
  const run = await db.referenceAnalysisRuns.get(runId)
  if (!run || run.status !== 'active') return
  await patchReferenceActiveProjection(run.referenceId, changes as Partial<Reference>)
}

export async function discardReferenceAnalysisRun(runId: number): Promise<void> {
  const existingRecord = await db.referenceAnalysisRuns.get(runId)
  if (!existingRecord) return
  const { run } = await requireRun(runId)
  if (run.status === 'active') throw new Error('不能删除当前激活版本，请先激活另一版本')
  await db.transaction(
    'rw',
    db.referenceAnalysisRuns,
    db.referenceAnalysisSources,
    db.referenceChunkAnalysis,
    async () => {
      await db.referenceChunkAnalysis.where('analysisRunId').equals(runId).delete()
      await db.referenceAnalysisSources.delete(runId)
      await db.referenceAnalysisRuns.delete(runId)
    },
  )
}

export async function deleteReferenceWithAnalysis(referenceId: number): Promise<number | undefined> {
  const existingRecord = await db.references.get(referenceId)
  if (!existingRecord?.id) return undefined
  const { ref, scope } = await requireReference(referenceId)
  const runs = (await readOwnedRows<ReferenceAnalysisRun>(scope, 'referenceAnalysisRuns', { owner: 'work' }))
    .filter(run => run.referenceId === referenceId)
  const runIds = runs.map(run => run.id).filter((id): id is number => id != null)
  await db.transaction(
    'rw',
    [
      db.references,
      db.referenceAnalysisRuns,
      db.referenceAnalysisSources,
      db.referenceChunkAnalysis,
      db.creativeRules,
    ],
    async () => {
      const rules = await readOwnedRows<any>(scope, 'creativeRules', { owner: 'work' })
      for (const rule of rules) {
        if (!rule.id) continue
        const ids = parseLegacyIdArray(rule.citedReferenceIds)
        if (!ids.includes(referenceId)) continue
        await db.creativeRules.update(rule.id, {
          citedReferenceIds: JSON.stringify(ids.filter(id => id !== referenceId)),
          updatedAt: Date.now(),
        })
      }
      await db.referenceChunkAnalysis.where('referenceId').equals(referenceId).delete()
      if (runIds.length) await db.referenceAnalysisSources.bulkDelete(runIds)
      await db.referenceAnalysisRuns.where('referenceId').equals(referenceId).delete()
      await db.references.delete(referenceId)
    },
  )
  return ref.projectId
}

async function patchReferenceActiveProjection(referenceId: number, changes: Partial<Reference>): Promise<void> {
  const existing = await db.references.get(referenceId)
  if (!existing) return
  const { ref, scope } = await requireReference(referenceId)
  const result = await adopt({
    projectId: ref.projectId,
    scope,
    target: 'references',
    recordId: referenceId,
    mode: 'replace',
    data: changes as Record<string, unknown>,
  })
  if (!result.written.length) throw new Error('参考资料激活投影写回失败')
}

export interface ReferenceAnalysisDiff {
  added: AnalysisDimension[]
  changed: AnalysisDimension[]
  removed: AnalysisDimension[]
  unchanged: AnalysisDimension[]
}

export function diffReferenceAnalysisChunks(
  active: ReferenceChunkAnalysis[],
  candidate: ReferenceChunkAnalysis[],
): ReferenceAnalysisDiff {
  const result: ReferenceAnalysisDiff = { added: [], changed: [], removed: [], unchanged: [] }
  for (const dimension of ANALYSIS_DIMENSIONS) {
    const before = normalizedDimension(active, dimension)
    const after = normalizedDimension(candidate, dimension)
    if (!before && after) result.added.push(dimension)
    else if (before && !after) result.removed.push(dimension)
    else if (before === after) result.unchanged.push(dimension)
    else result.changed.push(dimension)
  }
  return result
}

function normalizedDimension(
  chunks: ReferenceChunkAnalysis[],
  dimension: AnalysisDimension,
): string {
  return chunks
    .map(chunk => chunk[dimension])
    .filter((value): value is string => typeof value === 'string' && value !== '本块未涉及')
    .map(value => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}
