import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildStyleCalibrationPrompt, buildStyleLearnPrompt } from '../../src/lib/ai/adapters/style-adapter'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { adopt } from '../../src/lib/registry/adopt'
import { resolveScopeLike } from '../../src/lib/world-engine/scope'
import {
  createStyleRevisionPair,
  formatStyleFewShotPairs,
  parseStyleCalibrationFeedback,
  parseStyleRevisionPairs,
  selectStyleFewShotPairs,
  upsertStyleRevisionPair,
} from '../../src/lib/style/style-learning'
import type { StyleRevisionPair } from '../../src/lib/types/user-style'
import { useUserStyleStore } from '../../src/stores/user-style'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'FB5 Advanced Test',
    genre: '',
    description: '',
    targetWordCount: 0,
    enableMultiWorld: false,
    createdAt: now,
    updatedAt: now,
  } as never) as number
}

function pair(index: number, authorNote?: string): StyleRevisionPair {
  return {
    id: `pair-${index}`,
    chapterTitle: `样本 ${index}`,
    beforeText: `OLD-${index} 他说这件事非常非常重要。`,
    afterText: `NEW-${index} 他只说：“要紧。”`,
    authorNote,
    capturedAt: index,
  }
}

describe('R-FB5 · 有界改稿样本与互动校准', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useUserStyleStore.setState({ profile: null, loading: false })
  })
  afterEach(async () => { db.close() })

  it('只保存实际差异附近的短片段，相同正文不生成样本', () => {
    expect(createStyleRevisionPair({
      chapterTitle: '相同',
      beforeText: '<p>没有变化。</p>',
      afterText: '<p>没有变化。</p>',
    })).toBeNull()

    const created = createStyleRevisionPair({
      sourceChapterId: 7,
      chapterTitle: '长章',
      beforeText: `<p>${'前文'.repeat(500)}他非常快速地跑过长街。${'后文'.repeat(500)}</p>`,
      afterText: `<p>${'前文'.repeat(500)}他掠过长街。${'后文'.repeat(500)}</p>`,
      capturedAt: 10,
    })
    expect(created).not.toBeNull()
    expect(created!.beforeText.length).toBeLessThanOrEqual(562)
    expect(created!.afterText.length).toBeLessThanOrEqual(562)
    expect(created!.beforeText).toContain('非常快速')
    expect(created!.afterText).toContain('掠过')
  })

  it('样本去重并最多保留 8 组；实际注入最多 3 组且优先作者说明', () => {
    let pairs: StyleRevisionPair[] = []
    for (let index = 1; index <= 10; index++) {
      pairs = upsertStyleRevisionPair(pairs, pair(index, index === 2 ? '删去冗余副词' : undefined))
    }
    expect(pairs).toHaveLength(8)
    expect(pairs.map(item => item.id)).toEqual([
      'pair-10', 'pair-9', 'pair-8', 'pair-7', 'pair-6', 'pair-5', 'pair-4', 'pair-3',
    ])

    const candidates = [pair(1), pair(2, '作者明确偏好'), pair(3), pair(4)]
    expect(selectStyleFewShotPairs(candidates).map(item => item.id)).toEqual([
      'pair-2', 'pair-4', 'pair-3',
    ])
    expect(formatStyleFewShotPairs(candidates)).toContain('作者明确偏好')
    expect(formatStyleFewShotPairs(candidates)).not.toContain('OLD-1')

    const importedOversized = formatStyleFewShotPairs([{
      ...pair(11),
      chapterTitle: '超长标题'.repeat(100),
      beforeText: `${'甲'.repeat(2000)}IMPORT_TAIL`,
      afterText: `${'乙'.repeat(2000)}IMPORT_TAIL`,
      authorNote: '说明'.repeat(300),
    }])
    expect(importedOversized).not.toContain('IMPORT_TAIL')
    expect(importedOversized.length).toBeLessThan(1700)
  })

  it('没有画像时可先沉淀样本，但不会误开启空画像注入', async () => {
    const projectId = await createProject()
    const storedPair = await useUserStyleStore.getState().captureRevisionPair(projectId, {
      sourceChapterId: 3,
      chapterTitle: '雨夜',
      beforeText: '<p>他非常快速地走了过去。</p>',
      afterText: '<p>他快步过去。</p>',
    })
    expect(storedPair).not.toBeNull()

    let row = await db.userStyleProfiles.where('projectId').equals(projectId).first()
    expect(row).toMatchObject({ profile: '', enabled: false, sampleCount: 0, sampleWords: 0 })
    expect(parseStyleRevisionPairs(row?.revisionPairs)).toHaveLength(1)

    await useUserStyleStore.getState().updateRevisionPairNote(storedPair!.id, '减少副词')
    row = await db.userStyleProfiles.where('projectId').equals(projectId).first()
    expect(parseStyleRevisionPairs(row?.revisionPairs)[0].authorNote).toBe('减少副词')

    await useUserStyleStore.getState().addCalibrationFeedback(projectId, {
      verdict: 'needs-adjustment',
      note: '对话仍然太书面',
      sourceText: '原文',
      resultText: '校准稿',
    })
    row = await db.userStyleProfiles.where('projectId').equals(projectId).first()
    expect(parseStyleCalibrationFeedback(row?.calibrationFeedback)[0]).toMatchObject({
      verdict: 'needs-adjustment',
      note: '对话仍然太书面',
    })

    const context = await assembleContext({
      projectId,
      sourceKeys: ['userStyleProfile'],
    } as never)
    expect(context.included).not.toContain('userStyleProfile')

    const scope = await resolveScopeLike(projectId)
    await adopt({
      projectId, scope, target: 'userStyleProfiles', mode: 'replace',
      data: {
        profile: '## 句式与节奏\n- 短句', enabled: true,
        sourceChapterIds: [], sampleCount: 0, sampleWords: 0,
      },
    })
    row = await db.userStyleProfiles.where('projectId').equals(projectId).first()
    expect(row?.enabled).toBe(true)
    expect(parseStyleRevisionPairs(row?.revisionPairs)).toHaveLength(1)

    await useUserStyleStore.getState().removeRevisionPair(storedPair!.id)
    row = await db.userStyleProfiles.where('projectId').equals(projectId).first()
    expect(parseStyleRevisionPairs(row?.revisionPairs)).toEqual([])
  })

  it('上下文只注入 3 组有界样本、反馈和防止复制专名的约束', async () => {
    const projectId = await createProject()
    const revisionPairs = [pair(1), pair(2, '优先'), pair(3), pair(4)]
    await db.userStyleProfiles.add({
      projectId,
      profile: '## 句式与节奏\n- 短句推进',
      enabled: true,
      sourceChapterIds: '[]',
      sampleCount: 0,
      sampleWords: 0,
      revisionPairs: JSON.stringify(revisionPairs),
      calibrationFeedback: JSON.stringify([{
        id: 'feedback-1',
        verdict: 'needs-adjustment',
        note: '减少解释性尾句',
        sourceExcerpt: '原文',
        resultExcerpt: '结果',
        createdAt: 1,
      }]),
      createdAt: 1,
      updatedAt: 1,
    })

    const context = await assembleContext({
      projectId,
      sourceKeys: ['userStyleProfile'],
    } as never)
    expect(context.included).toContain('userStyleProfile')
    expect(context.text).toContain('短句推进')
    expect(context.text).toContain('减少解释性尾句')
    expect(context.text).toContain('不要照搬')
    expect(context.text).toContain('OLD-2')
    expect(context.text).toContain('OLD-4')
    expect(context.text).toContain('OLD-3')
    expect(context.text).not.toContain('OLD-1')
  })

  it('画像学习与互动校准均走可编辑提示词模板，并携带有界反馈', () => {
    const learn = buildStyleLearnPrompt('章节正文', 1, 120, {
      revisionPairs: '改前：很快地跑\n改后：疾奔',
      calibrationFeedback: '- 仍需调整：减少解释',
    })
    expect(learn.at(-1)?.content).toContain('作者改稿对照')
    expect(learn.at(-1)?.content).toContain('疾奔')
    expect(learn.at(-1)?.content).toContain('减少解释')

    const calibration = buildStyleCalibrationPrompt({
      profile: '偏爱短句',
      revisionPairs: '改前：很快地跑\n改后：疾奔',
      calibrationFeedback: '- 接近作者风格：节奏合适',
      sourceText: '他很快地跑过长街。',
    })
    expect(calibration[0].content).toContain('不得复制')
    expect(calibration.at(-1)?.content).toContain('待校准短文')
    expect(calibration.at(-1)?.content).toContain('他很快地跑过长街。')
  })
})
