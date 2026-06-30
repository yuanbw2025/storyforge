/**
 * R-foreshadow-context · 伏笔章节任务进入正文生成上下文
 *
 * 守卫社区反馈：
 * - 伏笔不只作为粗列表进入 AI，而要按当前章节明确标出 [埋设]/[呼应]/[回收]。
 * - 伏笔章节引用使用 chapter.id，并按规范章节序列处理重复章节映射。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { buildForeshadowTaskContext } from '../../src/lib/foreshadow/context'

const foreshadowsSource = CONTEXT_SOURCE_BY_KEY.get('foreshadows')!

async function seedProject() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '伏笔上下文测试',
    genre: '',
    description: '',
    targetWordCount: 0,
    enableMultiWorld: false,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const volumeId = await db.outlineNodes.add({
    projectId,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const outlineIds: number[] = []
  const chapterIds: number[] = []
  for (let i = 0; i < 3; i++) {
    const outlineId = await db.outlineNodes.add({
      projectId,
      parentId: volumeId,
      type: 'chapter',
      title: `第${i + 1}章`,
      summary: '',
      order: i,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const chapterId = await db.chapters.add({
      projectId,
      outlineNodeId: outlineId,
      title: `正文第${i + 1}章`,
      content: '',
      wordCount: 0,
      status: 'draft',
      order: i,
      notes: '',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    outlineIds.push(outlineId)
    chapterIds.push(chapterId)
  }
  return { projectId, outlineIds, chapterIds, now }
}

describe('R-foreshadow-context · 伏笔任务上下文', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('CONTEXT_SOURCES.foreshadows 按当前 chapter.id 输出埋设/呼应/回收任务', async () => {
    const { projectId, chapterIds, now } = await seedProject()
    await db.foreshadows.bulkAdd([
      {
        projectId,
        name: '玉佩裂纹',
        type: 'symbol',
        status: 'planned',
        description: '主角第一次看到玉佩裂开一线',
        plantChapterId: chapterIds[0],
        echoChapterIds: JSON.stringify([chapterIds[1]]),
        resolveChapterId: chapterIds[2],
        notes: '',
        createdAt: now,
        updatedAt: now,
      },
      {
        projectId,
        name: '铜铃声',
        type: 'callback',
        status: 'planted',
        description: '铜铃每次响起都指向追踪者',
        plantChapterId: chapterIds[0],
        echoChapterIds: JSON.stringify([chapterIds[1]]),
        resolveChapterId: null,
        expectedResolveChapterId: chapterIds[2],
        notes: '',
        createdAt: now,
        updatedAt: now,
      },
    ] as any[])

    const plant = await foreshadowsSource.read({ projectId, chapterId: chapterIds[0] } as any)
    expect(plant).toContain('【当前章节伏笔任务】')
    expect(plant).toContain('[埋设]')
    expect(plant).toContain('玉佩裂纹')

    const echo = await foreshadowsSource.read({ projectId, chapterId: chapterIds[1] } as any)
    expect(echo).toContain('[呼应]')
    expect(echo).toContain('铜铃声')

    const resolve = await foreshadowsSource.read({ projectId, chapterId: chapterIds[2] } as any)
    expect(resolve).toContain('[回收]')
    expect(resolve).toContain('玉佩裂纹')
    expect(resolve).toContain('铜铃声')
  })

  it('重复章节映射时只按规范章节序列识别当前章节,避免裸 chapters 列表造成错位', async () => {
    const { projectId, outlineIds, chapterIds, now } = await seedProject()
    const duplicateChapterId = await db.chapters.add({
      projectId,
      outlineNodeId: outlineIds[0],
      title: '重复的第1章',
      content: '',
      wordCount: 0,
      status: 'draft',
      order: 99,
      notes: '',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const chapters = await db.chapters.where('projectId').equals(projectId).toArray()
    const outlineNodes = await db.outlineNodes.where('projectId').equals(projectId).toArray()

    const out = buildForeshadowTaskContext([
      {
        projectId,
        name: '规范章伏笔',
        type: 'chekhov',
        status: 'planned',
        description: '应该进入规范第1章',
        plantChapterId: chapterIds[0],
        echoChapterIds: '[]',
        resolveChapterId: null,
        notes: '',
        createdAt: now,
        updatedAt: now,
      },
      {
        projectId,
        name: '重复章伏笔',
        type: 'chekhov',
        status: 'planned',
        description: '不应误显示到规范第1章',
        plantChapterId: duplicateChapterId,
        echoChapterIds: '[]',
        resolveChapterId: null,
        notes: '',
        createdAt: now,
        updatedAt: now,
      },
    ] as any[], {
      currentChapterId: chapterIds[0],
      chapters,
      outlineNodes,
    })

    expect(out).toContain('规范章伏笔')
    expect(out).not.toContain('重复章伏笔')
  })
})
