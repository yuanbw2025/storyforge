import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adoptChapterOutlineWorkshopResult } from '../../src/lib/outline/adopt-workshop'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

async function seed() {
  const now = Date.now()
  const projectId = await seedCurrentProject({
    name: '工坊采纳',
    genres: [],
    description: '',
    targetWordCount: 0,
    enableMultiWorld: false,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId,
    parentId: null,
    type: 'chapter',
    title: '第一章',
    summary: '夜探',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const characterId = await db.characters.add({
    projectId,
    name: '林舟',
    roleWeight: 'main',
    moralAxis: 'neutral',
    orderAxis: 'neutral',
    shortDescription: '',
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    abilities: '',
    relationships: '',
    arc: '',
    homeWorldGroupId: null,
    isCrossWorld: false,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  await finalizeCurrentFixtureV1(projectId)
  return { projectId, outlineNodeId, characterId }
}

describe('PIPELINE-2 · 工坊作者确认采纳', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('经 adopt 写入场景与不可写清单，失效角色引用被过滤并回注正文上下文', async () => {
    const seeded = await seed()
    const raw = JSON.stringify({
      openingHook: '承接夜色',
      endingCliffhanger: '门后传来脚步',
      sceneLocation: '密室',
      emotionArc: 'rising',
      appearingCharacterIds: [seeded.characterId, 999],
      foreshadowIds: [999],
      prohibitions: ['不能提前知情', '不能提前知情', '不能重复首次获得钥匙'],
      scenes: [{
        title: '潜入',
        summary: '林舟潜入密室',
        location: '密室',
        conflict: '躲避守卫',
        pace: 'fast',
        characterIds: [seeded.characterId, 999],
        estimatedWords: 1200,
      }],
    })
    const result = await adoptChapterOutlineWorkshopResult({
      raw,
      projectId: seeded.projectId,
      outlineNodeId: seeded.outlineNodeId,
      chapterSummary: '夜探',
      validCharacterIds: new Set([seeded.characterId]),
      validForeshadowIds: new Set(),
    })

    expect(result).toMatchObject({ ok: true, sceneCount: 1, prohibitionCount: 2 })
    const row = await db.detailedOutlines.where('outlineNodeId').equals(seeded.outlineNodeId).first()
    expect(row?.appearingCharacterIds).toEqual([seeded.characterId])
    expect(row?.foreshadowIds).toEqual([])
    expect(row?.scenes[0].characterIds).toEqual([seeded.characterId])
    expect(row?.prohibitions).toEqual(['不能提前知情', '不能重复首次获得钥匙'])

    const context = await assembleContext({
      projectId: seeded.projectId,
      outlineNodeId: seeded.outlineNodeId,
      sourceKeys: ['detailedOutline'],
    })
    expect(context.text).toContain('不可写清单')
    expect(context.text).toContain('不能重复首次获得钥匙')
  })

  it('无场景结果零写入', async () => {
    const seeded = await seed()
    const result = await adoptChapterOutlineWorkshopResult({
      raw: JSON.stringify({ scenes: [], prohibitions: ['无效'] }),
      projectId: seeded.projectId,
      outlineNodeId: seeded.outlineNodeId,
      chapterSummary: '夜探',
      validCharacterIds: new Set(),
      validForeshadowIds: new Set(),
    })
    expect(result.ok).toBe(false)
    expect(await db.detailedOutlines.count()).toBe(0)
  })

  it('作者确认的 JSON 无效时直接拒绝，不在采纳阶段二次调用模型改写', async () => {
    const seeded = await seed()
    const result = await adoptChapterOutlineWorkshopResult({
      raw: '这不是可采纳的 JSON',
      projectId: seeded.projectId,
      outlineNodeId: seeded.outlineNodeId,
      chapterSummary: '夜探',
      validCharacterIds: new Set(),
      validForeshadowIds: new Set(),
    })

    expect(result).toMatchObject({ ok: false, reason: '无法解析场景卡 JSON' })
    expect(await db.detailedOutlines.count()).toBe(0)
  })
})
