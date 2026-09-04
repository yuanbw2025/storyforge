import { db } from '../db/schema'
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
    .sort((a, b) => a.updatedAt - b.updatedAt)[0]
  if (!disposable?.id) return false
  await discardReferenceAnalysisRun(disposable.id)
  return true
}

export async function createReferenceAnalysisRun(
  input: CreateReferenceAnalysisRunInput,
): Promise<ReferenceAnalysisRun> {
  const { ref, scope } = await requireReference(input.referenceId)
  if (!input.sourceFilename.trim()) throw new Error('来源文件名不能为空')
  if (!input.fileHash.trim()) throw new Error('来源文件哈希不能为空')
  if (input.totalChars <= 0 || input.expectedChunks <= 0) throw new Error('来源文本或分块计划为空')
  if (!await pruneOneDisposableRun(ref.id!, scope)) {
    throw new Error(`每份参考最多保留 ${REFERENCE_ANALYSIS_RUN_POLICY.maxRunsPerReference} 个版本，请先删除未使用版本`)
  }

  const existing = (await readOwnedRows<ReferenceAnalysisRun>(scope, 'referenceAnalysisRuns', { owner: 'work' }))
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
    db.referenceAnalysisRuns,
    db.referenceAnalysisSources,
    async () => {
      const id = await db.referenceAnalysisRuns.add(row) as number
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
          createdAt: now,
        }, { owner: 'work' }) as ReferenceAnalysisSource
        await db.referenceAnalysisSources.put(source)
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
  if (!active) {
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
        const ids = parseIdArray(rule.citedReferenceIds)
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

function parseIdArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.filter((id): id is number => typeof id === 'number')
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : []
  } catch {
    return []
  }
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
