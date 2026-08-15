import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareContinuityContext } from '../../src/lib/ai/chapter-memory/continuity-context'
import {
  CHAPTER_TEXT_NORMALIZATION_VERSION,
  hashChapterText,
} from '../../src/lib/ai/chapter-memory/text-normalization'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import type { WorkspaceScope } from '../../src/lib/types'

const GENRES = ['fantasy', 'mystery', 'romance'] as const

async function seedLongWork(genre: typeof GENRES[number]) {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: `CREL11-${genre}`,
    genre,
    genres: [genre],
    description: '12 章连续性边界夹具',
    targetWordCount: 120_000,
    enableMultiWorld: false,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: `crel11-${genre}`,
    name: `${genre}-world`,
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: `${genre}-work`,
    description: '',
    genres: [genre],
    status: 'drafting',
    targetWordCount: 120_000,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const scope = { projectId, worldId, workId } satisfies WorkspaceScope
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })

  const characterId = await db.characters.add({
    projectId,
    worldId,
    homeWorldGroupId: null,
    name: `${genre}-主角`,
    role: 'protagonist',
    roleWeight: 'main',
    moralAxis: 'neutral',
    orderAxis: 'neutral',
    shortDescription: '连续章节主角',
    appearance: '',
    personality: '谨慎',
    background: '',
    motivation: `${genre}-旧目标-只存在于前六章`,
    abilities: '',
    relationships: '[]',
    arc: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number

  const chapterIds: number[] = []
  const outlineNodeIds: number[] = []
  for (let ordinal = 1; ordinal <= 12; ordinal++) {
    const outlineNodeId = await db.outlineNodes.add({
      projectId,
      workId,
      parentId: null,
      type: 'chapter',
      title: `${genre}-第${ordinal}章`,
      summary: ordinal === 12
        ? `${genre}-新目标-进入终局前必须完成的当前章任务`
        : `${genre}-第${ordinal}章推进`,
      order: ordinal,
      worldGroupId: null,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    outlineNodeIds.push(outlineNodeId)
    const content = [
      `${genre}-CH${ordinal}-BEGIN`,
      `${genre}-第${ordinal}章事件。`.repeat(240),
      `${genre}-CH${ordinal}-END`,
    ].join('\n')
    const chapterId = await db.chapters.add({
      projectId,
      workId,
      outlineNodeId,
      title: `${genre}-第${ordinal}章`,
      content,
      wordCount: content.length,
      status: 'revised',
      order: ordinal,
      notes: '',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    chapterIds.push(chapterId)
    const sourceTextHash = await hashChapterText(content)
    await db.chapters.update(chapterId, {
      summary: ordinal === 6
        ? `${genre}-旧目标-只存在于前六章`
        : `${genre}-SUMMARY-${ordinal}`,
      summarySourceTextHash: sourceTextHash,
      summaryTextNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      continuityHandoff: {
        chapterId,
        sourceTextHash,
        schemaVersion: 1,
        extractorVersion: 'crel11-fixture-v1',
        textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
        finalScene: {
          location: `${genre}-LOCATION-${ordinal}`,
          activeCharacters: [`${genre}-主角`],
          lastAction: `${genre}-ACTION-${ordinal}`,
        },
        stateChanges: [`${genre}-STATE-${ordinal}`],
        knowledgeChanges: [],
        commitments: [],
        openLoops: [`${genre}-LOOP-${ordinal}`],
        generatedAt: now,
        evidenceQuotes: [],
      },
    } as any)
  }

  // 模拟第六章后作者正式修改角色目标；下一章读取当前正式角色数据，
  // 而不是让旧章节摘要或模型临时假设继续占据高权重。
  await db.characters.update(characterId, {
    motivation: `${genre}-新目标-作者已正式确认`,
    updatedAt: now + 1,
  })

  return { scope, projectId, chapterIds, outlineNodeIds }
}

describe.sequential('CREL-11 · 8–12 章有界连续性与中途改设定', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it.each(GENRES)('%s 连续 12 章只注入直接前驱、最近 5 条记忆和当前正式修改', async genre => {
    const fixture = await seedLongWork(genre)
    const currentChapterId = fixture.chapterIds[11]
    const continuity = await prepareContinuityContext({
      projectId: fixture.projectId,
      chapterId: currentChapterId,
      scope: fixture.scope,
    })

    expect(continuity.previousTailText).toContain(`${genre}-CH11-END`)
    expect(continuity.previousTailText).not.toContain(`${genre}-CH11-BEGIN`)
    expect(continuity.previousTailText).not.toContain(`${genre}-CH10-END`)
    expect(continuity.handoffText).toContain(`${genre}-ACTION-11`)
    expect(continuity.handoffText).not.toContain(`${genre}-ACTION-10`)
    expect(continuity.recentSummariesText).toContain(`${genre}-SUMMARY-7`)
    expect(continuity.recentSummariesText).toContain(`${genre}-SUMMARY-11`)
    expect(continuity.recentSummariesText).not.toContain(`${genre}-SUMMARY-6`)
    expect(continuity.memoryRebuildCandidateIds).toEqual([])

    const assembled = await assembleContext({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: null,
      outlineNodeId: fixture.outlineNodeIds[11],
      chapterId: currentChapterId,
      sourceKeys: [
        'chapterOutline',
        'chapterContinuityHandoff',
        'previousChapterEnding',
        'recentChapterSummaries',
        'characters',
      ],
    })
    expect(assembled.text).toContain(`${genre}-新目标-进入终局前必须完成的当前章任务`)
    expect(assembled.text).toContain(`${genre}-新目标-作者已正式确认`)
    expect(assembled.text).not.toContain(`${genre}-旧目标-只存在于前六章`)
    expect(assembled.text).not.toContain(`${genre}-CH1-BEGIN`)
    expect(assembled.included).toEqual(expect.arrayContaining([
      'chapterOutline',
      'chapterContinuityHandoff',
      'previousChapterEnding',
      'recentChapterSummaries',
      'characters',
    ]))
  })
})
