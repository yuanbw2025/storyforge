/**
 * R-FB5b · 作品分析统一为 13 维 · 浅/深两档（社区反馈 FSS）
 *
 * 反馈:整本书已"导入项目参考",但要八维度分析还得重新上传一遍。
 * 重构:12 维写作技法 + 八维 → 统一 13 维(+worldBuilding),浅/深两档,接进导入项目参考。
 *
 * 锁定:
 *  ① 维度集:13 个小说维度 + 5 个历史维度;FICTION_DIMENSIONS = 13;两档 quick/deep(无 standard)。
 *  ② 浅层:writeShallowAnalysisFromTechniques 用解析的写作技法免费落成 13 维「全书」分析行,ref 置 done。
 *  ③ AI 上下文:buildRefAnalysisContext 把 13 维分析读进生成上下文。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  FICTION_DIMENSIONS, ANALYSIS_DIMENSIONS, HISTORY_DIMENSIONS,
  type ReferenceAnalysisDepth,
} from '../../src/lib/types/reference'
import type { WritingTechniques } from '../../src/lib/types/import-session-data'
import { writeShallowAnalysisFromTechniques } from '../../src/lib/reference-analysis/pipeline'
import { buildRefAnalysisContext } from '../../src/lib/ai/context-builder'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

async function createProjectAndRef(): Promise<number> {
  const now = Date.now()
  const pid = await seedCurrentProject({
    name: 'FB5b', genres: [], description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const referenceId = await db.references.add({
    projectId: pid, title: '某范本', author: '', type: 'story', note: '', url: '',
    createdAt: now, updatedAt: now,
  } as any) as number
  await finalizeCurrentFixtureV1(pid)
  return referenceId
}

const WT: WritingTechniques = {
  narrativeStyle: '第三人称限知',
  openingTechnique: '天才陨落+退婚打脸',
  worldBuilding: '斗气大陆,设定随剧情释放',
  foreshadowing: '戒指老爷爷埋线',
}

describe('R-FB5b · 13 维统一作品分析 + 浅档', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('① 维度集:13 小说维度 + 5 历史维度,两档无 standard', () => {
    expect(FICTION_DIMENSIONS.length).toBe(13)
    expect(FICTION_DIMENSIONS).toContain('worldBuilding')   // 吸收自八维
    expect(HISTORY_DIMENSIONS.length).toBe(5)
    expect(ANALYSIS_DIMENSIONS.length).toBe(18)             // 13 + 5
    const depths: ReferenceAnalysisDepth[] = ['quick', 'deep']
    expect(depths).not.toContain('standard' as any)
  })

  it('② 浅层:用写作技法免费落成 13 维全书分析行,ref 置 done', async () => {
    const refId = await createProjectAndRef()
    await writeShallowAnalysisFromTechniques(refId, WT)

    const rows = await db.referenceChunkAnalysis.where('referenceId').equals(refId).toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].label).toBe('全书')
    // 13 维 key 落库(挑几个验证)
    expect(rows[0].narrativeStyle).toBe('第三人称限知')
    expect(rows[0].worldBuilding).toContain('斗气大陆')
    expect(rows[0].openingTechnique).toContain('退婚打脸')

    const ref = await db.references.get(refId)
    expect(ref?.analysisStatus).toBe('done')
    expect(ref?.analysisDepth).toBe('quick')
  })

  it('③ AI 上下文:13 维分析进生成上下文', async () => {
    const refId = await createProjectAndRef()
    await writeShallowAnalysisFromTechniques(refId, WT)

    const ctx = await buildRefAnalysisContext([refId])
    expect(ctx).toContain('引用手法')
    expect(ctx).toContain('世界观构建')   // 13 维标签之一(worldBuilding)
    expect(ctx).toContain('斗气大陆')
  })

  it('空写作技法 → 不产行,ref 置 failed(提示重跑)', async () => {
    const refId = await createProjectAndRef()
    await writeShallowAnalysisFromTechniques(refId, {})
    const rows = await db.referenceChunkAnalysis.where('referenceId').equals(refId).toArray()
    expect(rows.length).toBe(0)
    const ref = await db.references.get(refId)
    expect(ref?.analysisStatus).toBe('failed')
  })
})
