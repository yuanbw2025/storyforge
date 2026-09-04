import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { buildRefAnalysisContext } from '../../src/lib/ai/context-builder'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  activateReferenceAnalysisRun,
  completeReferenceAnalysisRun,
  createReferenceAnalysisRun,
  deleteReferenceWithAnalysis,
  diffReferenceAnalysisChunks,
  getActiveReferenceAnalysisRun,
  getReferenceAnalysisRunChunks,
  listReferenceAnalysisRuns,
  readReferenceAnalysisSource,
} from '../../src/lib/reference-analysis/lifecycle'
import { verifiedRawExcerpt } from '../../src/lib/reference-analysis/pipeline'
import type { ReferenceChunkAnalysis } from '../../src/lib/types'
import { resolveScopeLike, stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

async function seedProjectAndReference(title = '演化参考') {
  const now = Date.now()
  const projectId = await seedCurrentProject({
    name: 'IDEA-1', genres: [], description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const referenceId = await db.references.add({
    projectId, title, author: '作者', type: 'story', note: '', url: '',
    analysisDepth: 'quick', analysisStatus: 'done', analysisProgress: 100,
    fileHash: 'reference-hash', totalChars: 100,
    createdAt: now, updatedAt: now,
  } as any) as number
  await finalizeCurrentFixtureV1(projectId)
  return { projectId, referenceId, now }
}

function chunk(
  referenceId: number,
  openingTechnique: string,
  analysisRunId?: number,
): ReferenceChunkAnalysis {
  return {
    referenceId,
    analysisRunId,
    chunkIndex: 0,
    label: '全书',
    openingTechnique,
    createdAt: Date.now(),
  }
}

async function addScopedChunk(projectId: number, row: ReferenceChunkAnalysis): Promise<number> {
  const scope = await resolveScopeLike(projectId)
  return db.referenceChunkAnalysis.add(
    stampNewRecord(scope, 'referenceChunkAnalysis', row, { owner: 'work' }) as ReferenceChunkAnalysis,
  ) as Promise<number>
}

async function createActiveRun(projectId: number, referenceId: number, openingTechnique: string) {
  const run = await createReferenceAnalysisRun({
    referenceId,
    depth: 'quick',
    sourceFilename: 'baseline.txt',
    fileHash: `baseline-${referenceId}`,
    totalChars: 10,
    expectedChunks: 1,
    sourceKind: 'own-work',
    usageScope: 'analysis-only',
    rightsConfirmed: true,
    sourceText: '基准原文',
  })
  await addScopedChunk(projectId, chunk(referenceId, openingTechnique, run.id))
  await completeReferenceAnalysisRun(run.id!, 1)
  await activateReferenceAnalysisRun(run.id!)
  return (await db.referenceAnalysisRuns.get(run.id!))!
}

describe('R-IDEA1 · 参考资料版本化演化', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('新分析先 ready，激活后才进入上下文，并可原子回滚旧版本', async () => {
    const { projectId, referenceId } = await seedProjectAndReference()
    const oldRun = await createActiveRun(projectId, referenceId, '既有版本钩子')

    const candidate = await createReferenceAnalysisRun({
      referenceId,
      depth: 'deep',
      sourceFilename: 'new.md',
      fileHash: 'new-hash',
      totalChars: 9,
      expectedChunks: 1,
      sourceKind: 'unknown',
      usageScope: 'continuation-authorized',
      rightsNote: '待确认来源',
      rightsConfirmed: true,
      sourceText: '新的原文内容',
    })
    await addScopedChunk(projectId, chunk(referenceId, '新版本悬念钩子', candidate.id))
    expect(await completeReferenceAnalysisRun(candidate.id!, 1)).toBe('ready')

    const staged = await db.referenceAnalysisRuns.get(candidate.id!)
    expect(staged?.usageScope, '未知来源必须降级为仅分析').toBe('analysis-only')
    expect(await readReferenceAnalysisSource(candidate.id!)).toBe('新的原文内容')
    expect(await buildRefAnalysisContext([referenceId])).toContain('既有版本钩子')
    expect(await buildRefAnalysisContext([referenceId])).not.toContain('新版本悬念钩子')

    await activateReferenceAnalysisRun(candidate.id!)
    expect(await buildRefAnalysisContext([referenceId])).toContain('新版本悬念钩子')
    expect(await buildRefAnalysisContext([referenceId])).not.toContain('既有版本钩子')
    expect((await db.referenceAnalysisRuns.get(oldRun.id!))?.status).toBe('superseded')

    await activateReferenceAnalysisRun(oldRun.id!)
    expect((await getActiveReferenceAnalysisRun(referenceId))?.id).toBe(oldRun.id)
    expect(await buildRefAnalysisContext([referenceId])).toContain('既有版本钩子')
  })

  it('AI 引文必须能在本块原文中核对，差异按维度公开', () => {
    const source = '风从长街尽头吹来，灯火一盏接一盏熄灭。'
    expect(verifiedRawExcerpt('“风从长街尽头吹来，灯火一盏接一盏熄灭。”', source))
      .toBe('风从长街尽头吹来，灯火一盏接一盏熄灭。')
    expect(verifiedRawExcerpt('城门忽然坍塌', source)).toBeUndefined()

    const before = [{ ...chunk(1, '旧钩子'), worldBuilding: '旧世界' }]
    const after = [{ ...chunk(1, '新钩子'), characterCraft: '新增角色方法' }]
    const diff = diffReferenceAnalysisChunks(before, after)
    expect(diff.changed).toContain('openingTechnique')
    expect(diff.added).toContain('characterCraft')
    expect(diff.removed).toContain('worldBuilding')
  })

  it('部分成功保留为待确认版本且公开缺块，不覆盖 active', async () => {
    const { projectId, referenceId } = await seedProjectAndReference()
    await createActiveRun(projectId, referenceId, '稳定基准版')
    const partial = await createReferenceAnalysisRun({
      referenceId,
      depth: 'deep',
      sourceFilename: 'partial.txt',
      fileHash: 'partial',
      totalChars: 20,
      expectedChunks: 2,
      sourceKind: 'research',
      usageScope: 'analysis-only',
      rightsConfirmed: true,
      sourceText: '第一块\n第二块',
    })
    await addScopedChunk(projectId, chunk(referenceId, '只完成一块', partial.id))

    expect(await completeReferenceAnalysisRun(partial.id!, 2, '共 2 块，成功 1')).toBe('ready')
    expect(await db.referenceAnalysisRuns.get(partial.id!)).toMatchObject({
      status: 'ready',
      completedChunks: 1,
      progress: 50,
      error: '共 2 块，成功 1',
    })
    expect(await buildRefAnalysisContext([referenceId])).toContain('稳定基准版')
    expect(await buildRefAnalysisContext([referenceId])).not.toContain('只完成一块')
  })

  it('版本上限不会静默裁剪 active/ready/analyzing', async () => {
    const { projectId, referenceId } = await seedProjectAndReference()
    await createActiveRun(projectId, referenceId, '稳定基准版')
    for (let index = 0; index < 5; index++) {
      await createReferenceAnalysisRun({
        referenceId,
        depth: 'quick',
        sourceFilename: `${index}.txt`,
        fileHash: `hash-${index}`,
        totalChars: 1,
        expectedChunks: 1,
        sourceKind: 'own-work',
        usageScope: 'analysis-only',
        rightsConfirmed: true,
        sourceText: 'x',
      })
    }
    await expect(createReferenceAnalysisRun({
      referenceId,
      depth: 'quick',
      sourceFilename: 'overflow.txt',
      fileHash: 'overflow',
      totalChars: 1,
      expectedChunks: 1,
      sourceKind: 'own-work',
      usageScope: 'analysis-only',
      rightsConfirmed: true,
      sourceText: 'x',
    })).rejects.toThrow('最多保留 6 个版本')
  })

  it('删除参考原子清理版本、分块、断点原文和创作规则引用', async () => {
    const { projectId, referenceId, now } = await seedProjectAndReference()
    const otherRefId = await db.references.add({
      projectId, title: '保留', author: '', type: 'story', note: '', url: '',
      createdAt: now, updatedAt: now,
    } as any) as number
    await finalizeCurrentFixtureV1(projectId)
    const run = await createReferenceAnalysisRun({
      referenceId,
      depth: 'deep',
      sourceFilename: 'source.txt',
      fileHash: 'hash',
      totalChars: 4,
      expectedChunks: 1,
      sourceKind: 'own-work',
      usageScope: 'creative-reference',
      rightsConfirmed: true,
      sourceText: '原文',
    })
    await addScopedChunk(projectId, chunk(referenceId, '待删', run.id))
    const scope = await resolveScopeLike(projectId)
    await db.creativeRules.add(stampNewRecord(scope, 'creativeRules', {
      projectId,
      writingStyle: '', narrativePOV: 'third-limited', atmosphere: '',
      prohibitions: '[]', consistencyRules: '[]', specialRequirements: '',
      citedReferenceIds: JSON.stringify([referenceId, otherRefId]),
      createdAt: now, updatedAt: now,
    } as any, { owner: 'work' }) as any)

    await deleteReferenceWithAnalysis(referenceId)

    expect(await db.references.get(referenceId)).toBeUndefined()
    expect(await db.referenceAnalysisRuns.where('referenceId').equals(referenceId).count()).toBe(0)
    expect(await db.referenceChunkAnalysis.where('referenceId').equals(referenceId).count()).toBe(0)
    expect(await db.referenceAnalysisSources.get(run.id!)).toBeUndefined()
    const rules = await db.creativeRules.where('projectId').equals(projectId).first()
    expect(JSON.parse(rules?.citedReferenceIds ?? '[]')).toEqual([otherRefId])
    expect(await db.references.get(otherRefId)).toBeDefined()
  })

  it('项目 JSON 往返重映射 run/chunk；本地断点原文明确定义为不导出', async () => {
    const { projectId, referenceId } = await seedProjectAndReference('便携参考')
    const run = await createReferenceAnalysisRun({
      referenceId,
      depth: 'quick',
      sourceFilename: 'portable.txt',
      fileHash: 'portable-hash',
      totalChars: 8,
      expectedChunks: 1,
      sourceKind: 'public-domain',
      usageScope: 'creative-reference',
      rightsNote: '公版',
      rightsConfirmed: true,
      sourceText: '便携原文',
    })
    await addScopedChunk(projectId, chunk(referenceId, '便携钩子', run.id))
    await completeReferenceAnalysisRun(run.id!, 1)

    const exported = await exportProjectJSON(projectId)
    expect(exported.referenceAnalysisRuns).toHaveLength(1)
    expect(exported.referenceChunkAnalysis?.[0]._analysisRunExportId).toBe(0)
    expect((exported as any).referenceAnalysisSources).toBeUndefined()

    const importedProjectId = await importProjectJSON(exported)
    const importedRef = await db.references.where('projectId').equals(importedProjectId).first()
    const importedRuns = await listReferenceAnalysisRuns(importedRef!.id!)
    const importedChunks = await getReferenceAnalysisRunChunks(importedRef!.id!, importedRuns[0].id)
    expect(importedRuns[0]).toMatchObject({
      status: 'active',
      fileHash: 'portable-hash',
      sourceKind: 'public-domain',
    })
    expect(importedChunks[0].openingTechnique).toBe('便携钩子')
    expect(importedChunks[0].analysisRunId).toBe(importedRuns[0].id)
    expect(await db.referenceAnalysisSources.get(importedRuns[0].id!)).toBeUndefined()
  })
})
