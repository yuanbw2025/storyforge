import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  adoptChapterOrganizationSelection,
  isChapterOrganizationCurrent,
  parseChapterOrganizationOutput,
  persistChapterOrganizationCandidate,
  readLatestChapterOrganizationRun,
  runChapterOrganization,
  selectAllChapterOrganizationCandidates,
} from '../../src/lib/agent/chapter-organization'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import type { Character, Foreshadow, Project } from '../../src/lib/types'
import { replaceAdoptedCollection } from '../../src/lib/registry/adopt'

const now = 1_700_000_000_000
const chapterHtml = [
  '<p>林舟抵达云港。</p>',
  '<p>林舟拾起潮汐钥匙。</p>',
  '<p>林舟与苏砚结为盟友。</p>',
  '<p>塔门上的月纹第一次亮起。</p>',
].join('')
const chapterText = '林舟抵达云港。\n林舟拾起潮汐钥匙。\n林舟与苏砚结为盟友。\n塔门上的月纹第一次亮起。'

function rawOrganizationOutput() {
  return JSON.stringify({
    stateDiffs: [{
      entityName: '林舟',
      category: 'character',
      field: '位置',
      oldValue: null,
      newValue: '云港',
      sourceQuote: '林舟抵达云港。',
    }, {
      entityName: '未登记角色',
      category: 'character',
      field: '位置',
      oldValue: null,
      newValue: '云港',
      sourceQuote: '林舟抵达云港。',
    }],
    facts: [{
      subject: '林舟',
      predicate: 'location',
      value: '云港',
      quote: '林舟抵达云港。',
    }, {
      subject: '林舟',
      predicate: 'location',
      value: '幻觉地点',
      quote: '正文不存在的证据',
    }],
    inventoryEvents: [{
      itemName: '潮汐钥匙',
      heldByName: '林舟',
      action: 'gain',
      quantity: 1,
      note: '在云港拾得',
      sourceQuote: '林舟拾起潮汐钥匙。',
    }, {
      itemName: '伪造物品',
      heldByName: '林舟',
      action: 'gain',
      quantity: 1,
      note: '',
      sourceQuote: '正文不存在的证据',
    }],
    storyEvents: [{
      title: '抵达云港',
      storyTime: '',
      importance: 2,
      description: '林舟进入云港',
      sourceQuote: '林舟抵达云港。',
    }],
    relations: [{
      char1: '林舟',
      char2: '苏砚',
      type: 'ally',
      label: '盟友',
      description: '二人正式结盟',
      bidirectional: true,
      sourceQuote: '林舟与苏砚结为盟友。',
    }, {
      char1: '林舟',
      char2: '未登记角色',
      type: 'friend',
      label: '朋友',
      description: '',
      bidirectional: true,
      sourceQuote: '林舟与苏砚结为盟友。',
    }],
    foreshadowUpdates: [{
      foreshadowId: 1,
      toStatus: 'planted',
      note: '月纹首次显现',
      sourceQuote: '塔门上的月纹第一次亮起。',
    }],
  })
}

async function seedProject() {
  const project: Project = {
    id: 81001,
    name: '整理本章测试',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.projects.put(project)
  const outlineNodeId = await db.outlineNodes.add({
    projectId: project.id!,
    parentId: null,
    type: 'chapter',
    title: '第一章 月纹',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  })
  const chapterId = await db.chapters.add({
    projectId: project.id!,
    outlineNodeId,
    title: '第一章 月纹',
    content: chapterHtml,
    wordCount: chapterText.length,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  })
  const characters: Character[] = [
    {
      id: 11,
      projectId: project.id!,
      name: '林舟',
      role: 'protagonist',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'neutral',
      alignment: 'good',
      shortDescription: '',
      appearance: '',
      personality: '',
      background: '',
      motivation: '',
      abilities: '',
      relationships: '',
      arc: '',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 12,
      projectId: project.id!,
      name: '苏砚',
      role: 'supporting',
      roleWeight: 'secondary',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      alignment: 'good',
      shortDescription: '',
      appearance: '',
      personality: '',
      background: '',
      motivation: '',
      abilities: '',
      relationships: '',
      arc: '',
      createdAt: now,
      updatedAt: now,
    },
  ]
  await db.characters.bulkPut(characters)
  const foreshadow: Foreshadow = {
    id: 1,
    projectId: project.id!,
    name: '塔门月纹',
    type: 'symbol',
    status: 'planned',
    description: '月纹会在钥匙靠近时亮起',
    plantChapterId: null,
    echoChapterIds: '[]',
    resolveChapterId: null,
    notes: '',
    createdAt: now,
    updatedAt: now,
  }
  await db.foreshadows.put(foreshadow)
  return { project, chapterId, characters, foreshadow }
}

describe('AGENT-1 27.2b · 整理本章 Agent', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('一次调用复用既有解析器，伪造证据与未登记实体不能进入候选', async () => {
    const { project, chapterId, characters, foreshadow } = await seedProject()
    const budget = new AgentTeamBudgetTracker('economy')
    let calls = 0
    const candidate = await runChapterOrganization({
      projectId: project.id!,
      chapterId,
      chapterTitle: '第一章 月纹',
      worldGroupId: null,
      chapterContent: chapterHtml,
      stateContext: '',
      characters,
      knownItemNames: [],
      existingRelations: [],
      foreshadows: [foreshadow],
      budget,
      call: async () => {
        calls += 1
        return rawOrganizationOutput()
      },
    })

    expect(calls).toBe(1)
    expect(candidate.budget.calls).toBe(1)
    expect(candidate.stateDiffs).toHaveLength(1)
    expect(candidate.facts).toHaveLength(1)
    expect(candidate.inventoryEvents).toHaveLength(1)
    expect(candidate.storyEvents).toHaveLength(1)
    expect(candidate.relations).toHaveLength(1)
    expect(candidate.foreshadowUpdates).toHaveLength(1)
    expect(candidate.relations[0]).toMatchObject({
      fromCharacterId: 11,
      toCharacterId: 12,
      isDuplicate: false,
    })
  })

  it('候选写入归档 Agent 事件流后可恢复，确认前业务表保持零写入', async () => {
    const { project, chapterId, characters, foreshadow } = await seedProject()
    const sourceTextHash = await hashChapterText(chapterHtml)
    const candidate = parseChapterOrganizationOutput({
      raw: rawOrganizationOutput(),
      projectId: project.id!,
      chapterId,
      chapterTitle: '第一章 月纹',
      worldGroupId: null,
      chapterText,
      sourceTextHash,
      characters,
      existingRelations: [],
      foreshadows: [foreshadow],
      budget: new AgentTeamBudgetTracker('economy').snapshot(),
      createdAt: now,
    })
    expect(candidate).not.toBeNull()

    const run = await persistChapterOrganizationCandidate(candidate!)
    expect(run.conversation.status).toBe('archived')
    const restored = await readLatestChapterOrganizationRun({ projectId: project.id!, chapterId })
    expect(restored?.candidate.sourceTextHash).toBe(sourceTextHash)
    expect(await db.stateCards.count()).toBe(0)
    expect(await db.temporalFacts.count()).toBe(0)
    expect(await db.itemLedger.count()).toBe(0)
    expect(await db.storyTimelineEvents.count()).toBe(0)
    expect(await db.characterRelations.count()).toBe(0)
    expect((await db.foreshadows.get(1))?.status).toBe('planned')
  })

  it('作者确认后只经正式入口写入六域，事实仍保持 candidate', async () => {
    const { project, chapterId, characters, foreshadow } = await seedProject()
    const candidate = parseChapterOrganizationOutput({
      raw: rawOrganizationOutput(),
      projectId: project.id!,
      chapterId,
      chapterTitle: '第一章 月纹',
      worldGroupId: null,
      chapterText,
      sourceTextHash: await hashChapterText(chapterHtml),
      characters,
      existingRelations: [],
      foreshadows: [foreshadow],
      budget: new AgentTeamBudgetTracker('economy').snapshot(),
    })!
    const run = await persistChapterOrganizationCandidate(candidate)
    const result = await adoptChapterOrganizationSelection({
      run,
      selection: selectAllChapterOrganizationCandidates(candidate),
    })

    expect(result.written).toEqual({
      state: 1,
      facts: 1,
      inventory: 1,
      timeline: 1,
      relations: 1,
      foreshadows: 1,
    })
    expect((await db.stateCards.toArray())[0]).toMatchObject({ entityName: '林舟', lastChapterId: chapterId })
    expect((await db.temporalFacts.toArray())[0]).toMatchObject({
      subjectName: '林舟',
      predicate: 'location',
      status: 'candidate',
      sourceChapterId: chapterId,
    })
    expect((await db.itemLedger.toArray())[0]).toMatchObject({ itemName: '潮汐钥匙', characterId: 11 })
    expect((await db.storyTimelineEvents.toArray())[0]).toMatchObject({ title: '抵达云港', chapterId })
    expect((await db.characterRelations.toArray())[0]).toMatchObject({
      fromCharacterId: 11,
      toCharacterId: 12,
      relationType: 'ally',
    })
    expect((await db.characters.get(11))?.relationships).toContain('苏砚')
    expect((await db.foreshadows.get(1))).toMatchObject({ status: 'planted', plantChapterId: chapterId })
    expect(Object.values(result.run.candidate.domainStatus)).toEqual(Array(6).fill('adopted'))
    expect(await db.agentEvents.where('conversationId').equals(run.conversation.id!).count()).toBe(2)

    const retried = await adoptChapterOrganizationSelection({
      run: result.run,
      selection: selectAllChapterOrganizationCandidates(result.run.candidate),
    })
    expect(retried.written).toEqual({
      state: 0,
      facts: 0,
      inventory: 0,
      timeline: 0,
      relations: 0,
      foreshadows: 0,
    })
    expect(await db.stateCards.count()).toBe(1)
    expect(await db.temporalFacts.count()).toBe(1)
    expect(await db.itemLedger.count()).toBe(1)
    expect(await db.storyTimelineEvents.count()).toBe(1)
    expect(await db.characterRelations.count()).toBe(1)
    expect((await db.foreshadows.get(1))?.status).toBe('planted')
  })

  it('正文变化后旧候选仍可查看但不能写回', async () => {
    const { project, chapterId, characters, foreshadow } = await seedProject()
    const candidate = parseChapterOrganizationOutput({
      raw: rawOrganizationOutput(),
      projectId: project.id!,
      chapterId,
      chapterTitle: '第一章 月纹',
      worldGroupId: null,
      chapterText,
      sourceTextHash: await hashChapterText(chapterHtml),
      characters,
      existingRelations: [],
      foreshadows: [foreshadow],
      budget: new AgentTeamBudgetTracker('economy').snapshot(),
    })!
    const run = await persistChapterOrganizationCandidate(candidate)
    await db.chapters.update(chapterId, { content: `${chapterHtml}<p>作者补写。</p>` })

    expect(await isChapterOrganizationCurrent(candidate)).toBe(false)
    await expect(adoptChapterOrganizationSelection({
      run,
      selection: selectAllChapterOrganizationCandidates(candidate),
    })).rejects.toThrow('已过期')
    expect(await db.stateCards.count()).toBe(0)
    expect(await db.temporalFacts.count()).toBe(0)
  })

  it('整批替换的新数据未通过 FK 时回滚，不能先删掉本章旧物品', async () => {
    const { project, chapterId } = await seedProject()
    await db.itemLedger.add({
      projectId: project.id!,
      itemName: '作者已确认的旧钥匙',
      heldByName: '林舟',
      characterId: 11,
      action: 'gain',
      quantity: 1,
      chapterId,
      chapterTitle: '第一章 月纹',
      note: '旧记录',
      createdAt: now,
    })

    await expect(replaceAdoptedCollection({
      projectId: project.id!,
      target: 'itemLedger',
      scope: { chapterId },
      data: [{
        itemName: '非法跨项目物品',
        heldByName: '不存在',
        characterId: 999_999,
        action: 'gain',
        quantity: 1,
        chapterId,
        chapterTitle: '第一章 月纹',
        note: '',
      }],
    })).rejects.toThrow('已回滚')

    const rows = await db.itemLedger.where('projectId').equals(project.id!).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].itemName).toBe('作者已确认的旧钥匙')
  })
})
