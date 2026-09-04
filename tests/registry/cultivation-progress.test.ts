import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  acceptCultivationProgressCandidate,
  buildCultivationProgressPrompt,
  parseCultivationProgressResult,
  readCultivationProgressContext,
} from '../../src/lib/cultivation/progress'
import { stringifyCultivationStages, type CultivationStage } from '../../src/lib/types'
import { useChapterStore } from '../../src/stores/chapter'
import { useCultivationStore } from '../../src/stores/cultivation'
import { applyCharacterReferenceRemap } from '../../src/lib/registry/character-references'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const now = 1_800_000_000_000
const stages: CultivationStage[] = [
  { id: 'body', name: '炼体', parentStageIds: [] },
  { id: 'sword', name: '剑胎', parentStageIds: ['body'], branchLabel: '剑修' },
  { id: 'gold', name: '金身', parentStageIds: ['body'], branchLabel: '体修' },
  { id: 'unity', name: '归一', parentStageIds: ['sword', 'gold'] },
]

async function seed() {
  const projectId = await seedCurrentProject({
    name: '修炼进度测试',
    genres: [],
    status: 'drafting',
    description: '',
    targetWordCount: 0,
    includeCultivationProgressInAI: false,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const volumeId = await db.outlineNodes.add({
    projectId, parentId: null, type: 'volume', title: '第一卷', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const firstNode = await db.outlineNodes.add({
    projectId, parentId: volumeId, type: 'chapter', title: '炼体', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const secondNode = await db.outlineNodes.add({
    projectId, parentId: volumeId, type: 'chapter', title: '剑胎', summary: '',
    order: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const firstChapter = await db.chapters.add({
    projectId, outlineNodeId: firstNode, title: '炼体',
    content: '<p>林舟在雷雨中淬体，正式踏入炼体境。</p>',
    wordCount: 18, status: 'draft', order: 99, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  const secondChapter = await db.chapters.add({
    projectId, outlineNodeId: secondNode, title: '剑胎',
    content: '<p>林舟悟透剑意，丹田中凝成剑胎。</p>',
    wordCount: 18, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  const systemId = await db.cultivationSystems.add({
    projectId, worldGroupId: null, name: '剑修', description: '',
    stages: stringifyCultivationStages(stages), createdAt: now, updatedAt: now,
  }) as number
  const characterId = await db.characters.add({
    projectId, name: '林舟', roleWeight: 'main',
    moralAxis: 'good', orderAxis: 'lawful', homeWorldGroupId: null, isCrossWorld: false,
    cultivationSystemId: systemId, cultivationStageId: 'unity',
    createdAt: now, updatedAt: now,
  } as any) as number
  await finalizeCurrentFixtureV1(projectId)
  const characters = await db.characters.where('projectId').equals(projectId).toArray()
  const systems = await db.cultivationSystems.where('projectId').equals(projectId).toArray()
  const workId = (await db.projects.get(projectId))?.activeWorkId
  if (workId == null) throw new Error('当前 Work 缺失')
  return {
    projectId, workId, firstChapter, secondChapter, characterId, systemId, characters, systems,
  }
}

describe('WORLD-1 / Phase 34 · 修炼进度', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('提示词明确区分临时压制，解析器只接受闭集 ID 与唯一逐字证据', async () => {
    const seeded = await seed()
    const content = '林舟悟透剑意，丹田中凝成剑胎。重复证据。重复证据。'
    const prompt = buildCultivationProgressPrompt({
      chapterTitle: '剑胎',
      chapterContent: content,
      characters: seeded.characters,
      systems: seeded.systems,
    })
    expect(prompt[0].content).toContain('临时压制')

    const parsed = parseCultivationProgressResult({
      chapterContent: content,
      characters: seeded.characters,
      systems: seeded.systems,
      raw: JSON.stringify({
        events: [
          {
            characterId: seeded.characterId,
            cultivationSystemId: seeded.systemId,
            stageId: 'sword',
            transition: 'enter',
            trigger: '悟透剑意',
            quote: '丹田中凝成剑胎',
          },
          {
            characterId: seeded.characterId,
            cultivationSystemId: seeded.systemId,
            stageId: 'fake',
            transition: 'advance',
            quote: '丹田中凝成剑胎',
          },
          {
            characterId: seeded.characterId,
            cultivationSystemId: seeded.systemId,
            stageId: 'sword',
            transition: 'advance',
            quote: '重复证据',
          },
        ],
      }),
    })
    expect(parsed).toEqual([
      expect.objectContaining({
        characterId: seeded.characterId,
        cultivationSystemId: seeded.systemId,
        stageId: 'sword',
        sourceOffset: content.indexOf('丹田中凝成剑胎'),
      }),
    ])
  })

  it('采纳前重读正文并按 DAG 校验，逆序补录会重算后章 transition', async () => {
    const seeded = await seed()
    await acceptCultivationProgressCandidate({
      projectId: seeded.projectId,
      chapterId: seeded.secondChapter,
      candidate: {
        characterId: seeded.characterId,
        cultivationSystemId: seeded.systemId,
        stageId: 'sword',
        transition: 'enter',
        trigger: '悟透剑意',
        evidenceQuote: '丹田中凝成剑胎',
        sourceOffset: 0,
      },
    })
    await acceptCultivationProgressCandidate({
      projectId: seeded.projectId,
      chapterId: seeded.firstChapter,
      candidate: {
        characterId: seeded.characterId,
        cultivationSystemId: seeded.systemId,
        stageId: 'body',
        transition: 'enter',
        trigger: '雷雨淬体',
        evidenceQuote: '正式踏入炼体境',
        sourceOffset: 0,
      },
    })
    const rows = await db.cultivationProgress.where('projectId').equals(seeded.projectId).toArray()
    const earlier = rows.find(row => row.sourceChapterId === seeded.firstChapter)
    const later = rows.find(row => row.sourceChapterId === seeded.secondChapter)
    expect(earlier?.transition).toBe('enter')
    expect(later?.transition).toBe('advance')

    await expect(acceptCultivationProgressCandidate({
      projectId: seeded.projectId,
      chapterId: seeded.secondChapter,
      candidate: {
        characterId: seeded.characterId,
        cultivationSystemId: seeded.systemId,
        stageId: 'gold',
        transition: 'advance',
        trigger: '',
        evidenceQuote: '正文不存在',
        sourceOffset: 0,
      },
    })).rejects.toThrow('正文证据已变化')
  })

  it('上下文默认关闭，开启后只注入目标章之前的 confirmed 事件', async () => {
    const seeded = await seed()
    await acceptCultivationProgressCandidate({
      projectId: seeded.projectId,
      chapterId: seeded.firstChapter,
      candidate: {
        characterId: seeded.characterId,
        cultivationSystemId: seeded.systemId,
        stageId: 'body',
        transition: 'enter',
        trigger: '',
        evidenceQuote: '正式踏入炼体境',
        sourceOffset: 0,
      },
    })
    expect(await readCultivationProgressContext(
      seeded.projectId, null, seeded.secondChapter,
    )).toBe('')
    await db.works.update(seeded.workId, { includeCultivationProgressInAI: true })
    expect(await readCultivationProgressContext(
      seeded.projectId, null, seeded.firstChapter,
    )).toBe('')
    const context = await readCultivationProgressContext(
      seeded.projectId, null, seeded.secondChapter,
    )
    expect(context).toContain('林舟 / 剑修：当前 炼体')
    expect(context).toContain('已确认路径 炼体')
  })

  it('删章、删角色和改阶段定义均保留证据并正确降级', async () => {
    const seeded = await seed()
    const eventId = await acceptCultivationProgressCandidate({
      projectId: seeded.projectId,
      chapterId: seeded.firstChapter,
      candidate: {
        characterId: seeded.characterId,
        cultivationSystemId: seeded.systemId,
        stageId: 'body',
        transition: 'enter',
        trigger: '',
        evidenceQuote: '正式踏入炼体境',
        sourceOffset: 0,
      },
    })
    await useCultivationStore.getState().loadAll(seeded.projectId)
    await useCultivationStore.getState().updateSystem(seeded.systemId, {
      stages: stringifyCultivationStages([
        { ...stages[0], name: '锻体' },
        ...stages.slice(1),
      ]),
    })
    expect((await db.cultivationProgress.get(eventId))?.status).toBe('stale')

    await db.cultivationProgress.update(eventId, { status: 'confirmed' })
    await useChapterStore.getState().loadAll(seeded.projectId)
    await useChapterStore.getState().deleteChapter(seeded.firstChapter)
    expect(await db.cultivationProgress.get(eventId)).toEqual(expect.objectContaining({
      sourceChapterId: null,
      sourceChapterTitle: '炼体',
      status: 'source-missing',
    }))

    await db.cultivationProgress.update(eventId, {
      sourceChapterId: seeded.secondChapter,
      status: 'confirmed',
    })
    await applyCharacterReferenceRemap({
      projectId: seeded.projectId,
      fromCharacterId: seeded.characterId,
      fromName: '林舟',
    })
    expect(await db.cultivationProgress.get(eventId)).toEqual(expect.objectContaining({
      characterId: null,
      characterName: '林舟',
      status: 'source-missing',
    }))
  })

  it('体系或阶段删除保留历史名称并断开结构化引用', async () => {
    const seeded = await seed()
    const eventId = await acceptCultivationProgressCandidate({
      projectId: seeded.projectId,
      chapterId: seeded.firstChapter,
      candidate: {
        characterId: seeded.characterId,
        cultivationSystemId: seeded.systemId,
        stageId: 'body',
        transition: 'enter',
        trigger: '',
        evidenceQuote: '正式踏入炼体境',
        sourceOffset: 0,
      },
    })
    await useCultivationStore.getState().loadAll(seeded.projectId)
    await useCultivationStore.getState().updateSystem(seeded.systemId, {
      stages: stringifyCultivationStages(stages.filter(stage => stage.id !== 'body')
        .map(stage => ({ ...stage, parentStageIds: stage.parentStageIds.filter(id => id !== 'body') }))),
    })
    expect(await db.cultivationProgress.get(eventId)).toEqual(expect.objectContaining({
      stageId: null,
      stageName: '炼体',
      status: 'source-missing',
    }))

    await useCultivationStore.getState().deleteSystem(seeded.systemId)
    expect(await db.cultivationProgress.get(eventId)).toEqual(expect.objectContaining({
      cultivationSystemId: null,
      cultivationSystemName: '剑修',
      status: 'source-missing',
    }))
  })

  it('完整导出导入重映射世界、角色、体系与章节 FK', async () => {
    const seeded = await seed()
    await acceptCultivationProgressCandidate({
      projectId: seeded.projectId,
      chapterId: seeded.firstChapter,
      candidate: {
        characterId: seeded.characterId,
        cultivationSystemId: seeded.systemId,
        stageId: 'body',
        transition: 'enter',
        trigger: '',
        evidenceQuote: '正式踏入炼体境',
        sourceOffset: 0,
      },
    })
    const importedId = await importProjectJSON(await exportProjectJSON(seeded.projectId))
    const [event, character, system, chapter] = await Promise.all([
      db.cultivationProgress.where('projectId').equals(importedId).first(),
      db.characters.where('projectId').equals(importedId).first(),
      db.cultivationSystems.where('projectId').equals(importedId).first(),
      db.chapters.where('projectId').equals(importedId).first(),
    ])
    expect(event).toEqual(expect.objectContaining({
      characterId: character?.id,
      cultivationSystemId: system?.id,
      sourceChapterId: chapter?.id,
      status: 'confirmed',
    }))
    expect(event?.characterId).not.toBe(seeded.characterId)
    expect(event?.cultivationSystemId).not.toBe(seeded.systemId)
  })
})
