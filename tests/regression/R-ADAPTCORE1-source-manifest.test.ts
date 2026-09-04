import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  confirmAdaptationBrief,
  confirmAdaptationPlan,
  createAdaptation,
  inspectAdaptationFreshness,
  listActiveSourceUnits,
  resyncAdaptationSource,
  saveAdaptationBriefDraft,
  saveAdaptationPlanDraft,
} from '../../src/lib/adaptation/source-manifest'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import type {
  AdaptationBriefV1,
  AdaptationPlanV1,
  CreateWorkspaceInput,
  ScreenplayTargetSpecV1,
} from '../../src/lib/types'

const screenplaySpec: ScreenplayTargetSpecV1 = {
  format: 'film',
  language: 'zh-CN',
  episodeCount: null,
  targetMinutesPerEpisode: 100,
  rating: 'PG-13',
  dialogueDensity: 'balanced',
  productionScale: 'standard',
  preserveVoiceOver: false,
  titlePage: {
    creditLine: '改编',
    authorDisplayName: '测试作者',
    contactText: '',
    copyrightNotice: '',
    draftLabel: '第一稿',
  },
  exportDefaults: ['fountain', 'fdx', 'pdf'],
}

const brief: AdaptationBriefV1 = {
  version: 1,
  coreTheme: '选择与代价',
  dominantEmotion: '克制',
  mustKeep: ['主人公最终选择'],
  mayCut: [],
  mayMerge: [],
  mayReorder: [],
  allowedAdditions: [],
  audience: '成年观众',
  rating: 'PG-13',
  targetScale: '100 分钟电影',
  narrativePerspective: '主人公视角',
  timeBudget: '两小时',
  costLimit: '标准制作',
  deviationNotes: '',
  unresolvedQuestions: [],
  assumptions: ['保留原结局'],
}

const plan: AdaptationPlanV1 = {
  version: 1,
  premise: '主人公必须在真相和亲情之间选择。',
  sections: [{ stableKey: 'act-1', title: '第一幕', summary: '建立选择。', order: 0, episodeNumber: 1, sourceUnitKeys: [] }],
  globalAssumptions: [],
}

function input(name: string): CreateWorkspaceInput {
  return {
    name,
    genres: ['other'],
    status: 'drafting',
    description: '一个可以改编的故事',
    targetWordCount: 10_000,
    enableMultiWorld: false,
  }
}

async function sourceWorkspace(name = '来源短篇') {
  const created = await createWorkspace(input(name), { kind: 'novel', novelProfile: 'short' })
  const chapters = await db.chapters.where('projectId').equals(created.scope.projectId).sortBy('order')
  await db.outlineNodes.update(chapters[0].outlineNodeId, { summary: '主人公发现失踪真相。', updatedAt: Date.now() })
  await db.chapters.update(chapters[0].id!, { content: '<p>风雨夜，主人公推开旧门。</p>', summary: '发现线索', updatedAt: Date.now() })
  await db.chapters.update(chapters[1].id!, { content: '<p>她作出无法撤回的选择。</p>', summary: '最终选择', updatedAt: Date.now() + 1 })
  return created
}

describe('ADAPT-CORE-1A · 来源冻结、stale 与生命周期', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('在一个事务中创建目标 Work、改编根和有序 v1 来源清单，并切换活动 Work', async () => {
    const source = await sourceWorkspace()
    const beforeSource = await db.works.get(source.scope.workId)
    const result = await createAdaptation({
      sourceScope: source.scope,
      sourceWorkId: source.scope.workId,
      title: '来源短篇 · 电影剧本',
      sourceSelection: { mode: 'entire-work' },
      medium: 'screenplay',
      targetSpec: screenplaySpec,
    })

    expect(result.targetWork).toMatchObject({ kind: 'screenplay', novelProfile: null, status: 'drafting', targetWordCount: 0 })
    expect(result.adaptation).toMatchObject({ medium: 'screenplay', status: 'source-frozen', activeSourceManifestVersion: 1, sourceCoverage: 'full-text' })
    expect(result.adaptation.activeSourceManifestHash).toMatch(/^[a-f0-9]{64}$/)
    const units = await listActiveSourceUnits(result.adaptation.id!)
    const sourceChapterCount = await db.chapters.where('projectId').equals(source.scope.projectId).count()
    expect(units[0]).toMatchObject({ sourceKind: 'work', order: 0 })
    expect(units.filter(unit => unit.sourceKind === 'chapter')).toHaveLength(sourceChapterCount)
    expect(units.map(unit => unit.order)).toEqual(units.map((_, index) => index))
    expect((await db.projects.get(source.scope.projectId))?.activeWorkId).toBe(result.targetWork.id)
    expect(await db.works.get(source.scope.workId)).toEqual(beforeSource)
  })

  it('重复、乱序、跨 Work 选择全部拒绝且不留下孤儿目标 Work/root/unit', async () => {
    const source = await sourceWorkspace('来源 A')
    const chapters = await db.chapters.where('projectId').equals(source.scope.projectId).sortBy('order')
    const beforeWorks = await db.works.count()
    await expect(createAdaptation({
      sourceScope: source.scope,
      sourceWorkId: source.scope.workId,
      title: '重复来源',
      sourceSelection: { mode: 'chapters', chapterIds: [chapters[0].id!, chapters[0].id!] },
      medium: 'screenplay',
      targetSpec: screenplaySpec,
    })).rejects.toThrow('重复 ID')
    await expect(createAdaptation({
      sourceScope: source.scope,
      sourceWorkId: source.scope.workId,
      title: '反向范围',
      sourceSelection: { mode: 'chapter-range', startChapterId: chapters[1].id!, endChapterId: chapters[0].id! },
      medium: 'screenplay',
      targetSpec: screenplaySpec,
    })).rejects.toThrow('起点不能晚于终点')
    expect(await db.works.count()).toBe(beforeWorks)
    expect(await db.adaptationProjects.count()).toBe(0)
    expect(await db.adaptationSourceUnits.count()).toBe(0)
  })

  it('非连续章节按规范章序重排而不暗中补入中间章节', async () => {
    const source = await sourceWorkspace()
    const chapterOutlines = (await db.outlineNodes.where('projectId').equals(source.scope.projectId).toArray()).filter(row => row.type === 'chapter')
    const thirdOutline = { ...chapterOutlines[1], id: undefined, title: '第三章', order: 2, createdAt: Date.now(), updatedAt: Date.now() }
    const thirdOutlineId = await db.outlineNodes.add(thirdOutline as any) as number
    const thirdId = await db.chapters.add({ ...(await db.chapters.where('projectId').equals(source.scope.projectId).first())!, id: undefined, outlineNodeId: thirdOutlineId, title: '第三章', content: '第三章正文', order: 2, updatedAt: Date.now() } as any) as number
    const chapters = await db.chapters.where('projectId').equals(source.scope.projectId).sortBy('order')
    const result = await createAdaptation({
      sourceScope: source.scope,
      sourceWorkId: source.scope.workId,
      title: '离散选章剧本',
      sourceSelection: { mode: 'chapters', chapterIds: [thirdId, chapters[0].id!] },
      medium: 'screenplay',
      targetSpec: screenplaySpec,
    })
    const unitChapterIds = (await listActiveSourceUnits(result.adaptation.id!)).filter(unit => unit.sourceKind === 'chapter').map(unit => unit.sourceChapterId)
    expect(unitChapterIds).toEqual([chapters[0].id, thirdId])
    expect(unitChapterIds).not.toContain(chapters[1].id)
  })

  it('正文变化现场派生 stale；显式同步只追加 v2，旧 v1 证据零修改', async () => {
    const source = await sourceWorkspace()
    const result = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '同步剧本', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec: screenplaySpec })
    expect((await inspectAdaptationFreshness(result.adaptation.id!)).status).toBe('unchanged')
    const v1 = await listActiveSourceUnits(result.adaptation.id!)
    const chapter = await db.chapters.get(v1.find(unit => unit.sourceKind === 'chapter')!.sourceChapterId!)
    await db.chapters.update(chapter!.id!, { content: `${chapter!.content}<p>新增一句。</p>`, updatedAt: Date.now() + 10 })
    const stale = await inspectAdaptationFreshness(result.adaptation.id!)
    expect(stale.status).toBe('changed')
    expect(stale.changes.some(change => change.kind === 'changed')).toBe(true)

    const synced = await resyncAdaptationSource({ adaptationProjectId: result.adaptation.id!, expectedRevision: result.adaptation.revision })
    expect(synced).toMatchObject({ activeSourceManifestVersion: 2, status: 'brief-review', revision: 2 })
    expect(await db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals([result.adaptation.id!, 1]).toArray()).toEqual(v1)
    expect((await inspectAdaptationFreshness(result.adaptation.id!)).status).toBe('unchanged')
  })

  it('Brief/Plan 必须按当前 manifest 作者确认，来源 stale 时确认被阻断', async () => {
    const source = await sourceWorkspace()
    const result = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '状态机剧本', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec: screenplaySpec })
    const briefDraft = await saveAdaptationBriefDraft({ adaptationProjectId: result.adaptation.id!, brief, expectedRevision: 1 })
    expect(briefDraft).toMatchObject({ status: 'brief-review', briefSourceManifestVersion: null, revision: 2 })
    const briefConfirmed = await confirmAdaptationBrief({ adaptationProjectId: result.adaptation.id!, expectedRevision: 2 })
    expect(briefConfirmed).toMatchObject({ status: 'planning', briefSourceManifestVersion: 1, revision: 3 })
    const planDraft = await saveAdaptationPlanDraft({ adaptationProjectId: result.adaptation.id!, plan, expectedRevision: 3 })
    const chapter = await db.chapters.where('projectId').equals(source.scope.projectId).first()
    await db.chapters.update(chapter!.id!, { content: `${chapter!.content}变化`, updatedAt: Date.now() + 100 })
    await expect(confirmAdaptationPlan({ adaptationProjectId: result.adaptation.id!, expectedRevision: planDraft.revision })).rejects.toThrow('来源已变化')
    expect((await db.adaptationProjects.get(result.adaptation.id!))?.planSourceManifestVersion).toBeNull()
  })

  it('CONTEXT_SOURCES 只按目标 adaptation selector 读取授权 unit，并现场拒绝 stale 正文', async () => {
    const source = await sourceWorkspace()
    const result = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '受控读取剧本', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec: screenplaySpec })
    const units = await listActiveSourceUnits(result.adaptation.id!)
    const chapterUnit = units.find(unit => unit.sourceKind === 'chapter')!
    const assembled = await assembleContext({
      projectId: result.scope.projectId,
      scope: result.scope,
      adaptationProjectId: result.adaptation.id!,
      adaptationSourceManifestVersion: 1,
      adaptationSourceUnitKeys: [chapterUnit.sourceUnitKey],
      sourceKeys: ['adaptation.sourceManifest', 'adaptation.sourceContent'],
      inputBudgetTokens: 30_000,
    })
    expect(assembled.included).toEqual(['adaptation.sourceManifest', 'adaptation.sourceContent'])
    expect(assembled.text).toContain(chapterUnit.sourceUnitKey)
    expect(assembled.text).toContain('正文：')
    await expect(assembleContext({
      projectId: source.scope.projectId,
      scope: source.scope,
      adaptationProjectId: result.adaptation.id!,
      sourceKeys: ['adaptation.sourceManifest'],
    })).rejects.toThrow('不属于当前目标 Work')
    await expect(assembleContext({
      projectId: result.scope.projectId,
      scope: result.scope,
      adaptationProjectId: result.adaptation.id!,
      adaptationSourceManifestVersion: 1,
      adaptationSourceUnitKeys: ['asu_not_in_manifest'],
      sourceKeys: ['adaptation.sourceContent'],
    })).rejects.toThrow('不在指定 manifest')
    await db.chapters.update(chapterUnit.sourceChapterId!, { content: '<p>来源已经变化。</p>', updatedAt: Date.now() + 200 })
    await expect(assembleContext({
      projectId: result.scope.projectId,
      scope: result.scope,
      adaptationProjectId: result.adaptation.id!,
      adaptationSourceManifestVersion: 1,
      adaptationSourceUnitKeys: [chapterUnit.sourceUnitKey],
      sourceKeys: ['adaptation.sourceContent'],
    })).rejects.toThrow('来源单元已变化')
  })

  it('删除来源 Work 只置空来源引用并保留目标成品根；删除目标 Work 完整级联改编', async () => {
    const source = await sourceWorkspace()
    const result = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '独立目标', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec: screenplaySpec })
    await deleteWork(source.scope.workId)
    expect(await db.works.get(result.targetWork.id!)).toBeDefined()
    expect(await db.adaptationProjects.get(result.adaptation.id!)).toMatchObject({ sourceWorkId: null, workId: result.targetWork.id })
    expect((await inspectAdaptationFreshness(result.adaptation.id!)).status).toBe('missing')
    expect((await db.adaptationSourceUnits.where('adaptationProjectId').equals(result.adaptation.id!).toArray()).some(unit => unit.contentHash.length === 64)).toBe(true)

    await deleteWork(result.targetWork.id!)
    expect(await db.adaptationProjects.get(result.adaptation.id!)).toBeUndefined()
    expect(await db.adaptationSourceUnits.where('adaptationProjectId').equals(result.adaptation.id!).count()).toBe(0)
  })

  it('v7 备份往返重映射 target/source/root/unit，非法 medium-kind 在写库前拒绝', async () => {
    const source = await sourceWorkspace()
    const result = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '可移植剧本', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec: screenplaySpec })
    const backup = await exportProjectJSON(source.scope.projectId)
    expect(backup.version).toBe(10)
    expect(backup.adaptationProjects).toHaveLength(1)
    expect(backup.adaptationSourceUnits?.length).toBeGreaterThan(1)
    const importedId = await importProjectJSON(structuredClone(backup))
    const importedRoot = await db.adaptationProjects.where('projectId').equals(importedId).first()
    const importedTarget = await db.works.get(importedRoot!.workId)
    const importedSource = await db.works.get(importedRoot!.sourceWorkId!)
    expect(importedTarget?.kind).toBe('screenplay')
    expect(importedSource?.kind).toBe('novel')
    expect(await db.adaptationSourceUnits.where('adaptationProjectId').equals(importedRoot!.id!).count()).toBeGreaterThan(1)

    const invalid = structuredClone(backup) as any
    const targetExportId = invalid.adaptationProjects[0]._workExportId
    invalid.works.find((work: any) => work._exportId === targetExportId).kind = 'comic'
    const before = await db.projects.count()
    await expect(importProjectJSON(invalid)).rejects.toThrow('medium 与目标 Work kind 不匹配')
    expect(await db.projects.count()).toBe(before)
    expect(await db.adaptationProjects.get(result.adaptation.id!)).toBeDefined()
  })
})
