import { db } from '../db/schema'
import type { ReferenceAnalysisRun, ReferenceChunkAnalysis } from '../types'
import type { WorkspaceScope } from '../types/world-ownership'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveScopeLike,
  stampNewRecord,
} from '../world-engine/scope'

/**
 * 旧项目只保存 Reference + 无 runId 分块。第一次读取版本能力时创建显式 v1，
 * 不在 schema migration 中猜测，也不改分块主键或分析内容。
 *
 * 此桥接保持为独立小模块：通用 AI 上下文会读它，但不应因此把完整分析生命周期
 * 和写回管线打进首屏入口包。
 */
export async function ensureLegacyActiveReferenceRun(
  referenceId: number,
  suppliedScope?: WorkspaceScope,
): Promise<ReferenceAnalysisRun | undefined> {
  const beforeMigration = await db.references.get(referenceId)
  if (!beforeMigration?.id) return undefined
  const scope = suppliedScope ?? await resolveScopeLike(beforeMigration.projectId)
  const ref = await db.references.get(referenceId)
  if (!ref?.id || !await assertRecordInScope(scope, 'references', ref, { owner: 'work' })) return undefined
  const existingRuns = (await readOwnedRows<ReferenceAnalysisRun>(scope, 'referenceAnalysisRuns', { owner: 'work' }))
    .filter(run => run.referenceId === referenceId)
  const existingActive = existingRuns.find(run => run.status === 'active')
  if (existingActive) return existingActive
  if (existingRuns.length > 0) return undefined

  if (ref.analysisStatus !== 'done') return undefined
  const legacyChunks = (await readOwnedRows<ReferenceChunkAnalysis>(scope, 'referenceChunkAnalysis', { owner: 'work' }))
    .filter(chunk => chunk.referenceId === referenceId)
    .filter(chunk => chunk.analysisRunId == null)
  if (!legacyChunks.length) return undefined

  const now = Date.now()
  return db.transaction(
    'rw',
    db.references,
    db.referenceAnalysisRuns,
    db.referenceChunkAnalysis,
    async () => {
      const recheck = await db.referenceAnalysisRuns
        .where('referenceId').equals(referenceId).toArray()
      if (recheck.length) return recheck.find(run => run.status === 'active')
      const run = stampNewRecord(scope, 'referenceAnalysisRuns', {
        projectId: ref.projectId,
        referenceId,
        version: 1,
        status: 'active',
        depth: ref.analysisDepth ?? 'quick',
        sourceFilename: ref.importedData?.sourceFilename ?? ref.title,
        fileHash: ref.fileHash ?? `legacy-reference-${referenceId}`,
        totalChars: ref.totalChars ?? 0,
        sourceKind: 'unknown',
        usageScope: 'analysis-only',
        rightsNote: '旧版分析兼容桥接：未记录来源声明',
        rightsConfirmed: false,
        rightsDeclaredAt: now,
        expectedChunks: legacyChunks.length,
        completedChunks: legacyChunks.length,
        progress: 100,
        analysisSummary: ref.analysisSummary,
        mergedCharacters: ref.mergedCharacters,
        completedAt: now,
        activatedAt: now,
        createdAt: ref.createdAt,
        updatedAt: now,
      }, { owner: 'work' }) as ReferenceAnalysisRun
      const id = await db.referenceAnalysisRuns.add(run) as number
      await db.referenceChunkAnalysis.bulkPut(
        legacyChunks.map(chunk => stampNewRecord(scope, 'referenceChunkAnalysis', {
          ...chunk,
          analysisRunId: id,
        }, { owner: 'work' }) as ReferenceChunkAnalysis),
      )
      return { ...run, id }
    },
  )
}
