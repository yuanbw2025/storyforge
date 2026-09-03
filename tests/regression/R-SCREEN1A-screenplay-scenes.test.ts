import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import {
  confirmAdaptationBrief,
  confirmAdaptationPlan,
  createAdaptation,
  listActiveSourceUnits,
  saveAdaptationBriefDraft,
  saveAdaptationPlanDraft,
  startAdaptationProduction,
} from '../../src/lib/adaptation/source-manifest'
import type { AdaptationBriefV1, AdaptationPlanV1, ScreenplayTargetSpecV1 } from '../../src/lib/types'
import {
  createScreenplayScene,
  deleteScreenplayScene,
  duplicateScreenplayScene,
  listScreenplayScenes,
  setScreenplaySceneLocked,
  updateScreenplayScene,
} from '../../src/lib/screenplay/service'
import { renderScreenplayFdxV1, renderScreenplayFountainV1, renderScreenplayPrintHtmlV1 } from '../../src/lib/screenplay/renderers'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { applyCharacterReferenceRemap } from '../../src/lib/registry/character-references'
import { transactionTablesFor } from '../../src/lib/registry/lifecycle'
import { completeAdaptationProductionV1, reopenAdaptationProductionV1 } from '../../src/lib/adaptation/completion'

const spec: ScreenplayTargetSpecV1 = {
  format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 100,
  rating: 'PG-13', dialogueDensity: 'balanced', productionScale: 'standard', preserveVoiceOver: false,
  titlePage: { creditLine: '改编', authorDisplayName: '作者', contactText: 'author@example.test', copyrightNotice: '版权所有', draftLabel: '第一稿' },
  exportDefaults: ['fountain', 'fdx', 'pdf'],
}
const brief: AdaptationBriefV1 = {
  version: 1, coreTheme: '选择与代价', dominantEmotion: '克制', mustKeep: ['结局'], mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: [],
  audience: '成年观众', rating: 'PG-13', targetScale: '100 分钟电影', narrativePerspective: '主人公', timeBudget: '两小时', costLimit: '标准', deviationNotes: '', unresolvedQuestions: [], assumptions: [],
}

async function setup() {
  const source = await createWorkspace({ name: '剧本来源', genre: 'other', genres: ['other'], status: 'drafting', description: '风雨夜的选择', targetWordCount: 10_000, enableMultiWorld: false }, { kind: 'novel', novelProfile: 'short' })
  const chapters = await db.chapters.where('projectId').equals(source.scope.projectId).sortBy('order')
  await db.chapters.update(chapters[0].id!, { content: '<p>林岚走进旧车站。</p>', summary: '进入车站', updatedAt: Date.now() })
  const created = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '旧车站', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec: spec })
  const units = await listActiveSourceUnits(created.adaptation.id!)
  const chapterUnit = units.find(unit => unit.sourceKind === 'chapter')!
  const plan: AdaptationPlanV1 = { version: 1, premise: '她必须作出选择。', sections: [{ stableKey: 'act-1', title: '第一幕', summary: '进入困局', order: 0, episodeNumber: 1, sourceUnitKeys: [chapterUnit.sourceUnitKey] }], globalAssumptions: [] }
  let root = await saveAdaptationBriefDraft({ adaptationProjectId: created.adaptation.id!, brief, expectedRevision: 1 })
  root = await confirmAdaptationBrief({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  root = await saveAdaptationPlanDraft({ adaptationProjectId: root.id!, plan, expectedRevision: root.revision })
  root = await confirmAdaptationPlan({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  await startAdaptationProduction({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  const now = Date.now()
  const characterId = await db.characters.add({ projectId: source.scope.projectId, worldId: source.scope.worldId, name: '林岚', role: 'protagonist', createdAt: now, updatedAt: now } as any) as number
  await db.workCharacterBindings.add({ projectId: source.scope.projectId, workId: created.scope.workId, characterId, role: 'protagonist', createdAt: now, updatedAt: now })
  return { ...created, source, unitId: chapterUnit.id!, characterId }
}

describe('SCREEN-1A · structured screenplay and deterministic export', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('创建结构化正规场景，拒绝非法块顺序、越界角色和重复场景号', async () => {
    const fixture = await setup()
    const scene = await createScreenplayScene(fixture.scope, {
      planSectionKey: 'act-1', episodeNumber: 1, sceneNumber: 1, intExt: 'INT', location: '旧车站候车室', timeOfDay: '夜', summary: '林岚进入候车室。', estimatedSeconds: 75, sourceUnitIds: [fixture.unitId],
      blocks: [
        { id: 'b_action', type: 'action', text: '雨水沿着玻璃向下流。' },
        { id: 'b_character', type: 'character', characterId: fixture.characterId, name: '林岚', extension: 'V.O.' },
        { id: 'b_parenthetical', type: 'parenthetical', text: '低声' },
        { id: 'b_dialogue', type: 'dialogue', text: '我还是来了。' },
        { id: 'b_transition', type: 'transition', text: '切至：' },
      ],
    })
    expect(scene).toMatchObject({ status: 'draft', revision: 1, sourceReviewManifestVersion: 1 })
    await expect(createScreenplayScene(fixture.scope, { ...scene, stableKey: undefined, blocks: [{ id: 'bad', type: 'dialogue', text: '没有 cue' }] })).rejects.toThrow('对白前必须')
    await expect(createScreenplayScene(fixture.scope, { ...scene, stableKey: undefined, blocks: [{ id: 'cue', type: 'character', characterId: 999999, name: '越界' }, { id: 'line', type: 'dialogue', text: '越界' }] })).rejects.toThrow('尚未绑定')
    await expect(createScreenplayScene(fixture.scope, { ...scene, stableKey: undefined })).rejects.toThrow('场景号重复')
  })

  it('锁定/CAS/复制/删除遵守作者边界，来源 stale 只阻断新增不阻断旧场景手工编辑', async () => {
    const fixture = await setup()
    let scene = await createScreenplayScene(fixture.scope, { planSectionKey: 'act-1', episodeNumber: 1, sceneNumber: 1, intExt: 'EXT', location: '站台', timeOfDay: '夜', summary: '等待', estimatedSeconds: 30, sourceUnitIds: [fixture.unitId], blocks: [{ id: 'a', type: 'action', text: '列车没有进站。' }] })
    scene = await setScreenplaySceneLocked({ scope: fixture.scope, sceneId: scene.id!, expectedRevision: 1, locked: true })
    await expect(updateScreenplayScene({ scope: fixture.scope, sceneId: scene.id!, expectedRevision: scene.revision, patch: { summary: '覆盖锁定场景' } })).rejects.toThrow('先解锁')
    scene = await setScreenplaySceneLocked({ scope: fixture.scope, sceneId: scene.id!, expectedRevision: scene.revision, locked: false })
    await db.chapters.update((await db.adaptationSourceUnits.get(fixture.unitId))!.sourceChapterId!, { content: '来源变化', updatedAt: Date.now() + 100 })
    scene = await updateScreenplayScene({ scope: fixture.scope, sceneId: scene.id!, expectedRevision: scene.revision, patch: { summary: '作者手工修订旧场景' } })
    expect(scene.summary).toContain('手工修订')
    await expect(duplicateScreenplayScene({ scope: fixture.scope, sceneId: scene.id! })).rejects.toThrow('来源已变化')
    await deleteScreenplayScene({ scope: fixture.scope, sceneId: scene.id! })
    expect(await listScreenplayScenes(fixture.scope)).toHaveLength(0)
  })

  it('Fountain/FDX/打印 HTML 使用同一场景与对白顺序并正确转义', async () => {
    const fixture = await setup()
    const scene = await createScreenplayScene(fixture.scope, { planSectionKey: 'act-1', episodeNumber: 1, sceneNumber: 1, intExt: 'INT_EXT', location: '车站 & 月台', timeOfDay: '夜', summary: '', estimatedSeconds: 50, sourceUnitIds: [fixture.unitId], blocks: [{ id: 'a', type: 'action', text: '门 <缓慢> 打开。' }, { id: 'c', type: 'character', name: '广播声', extension: 'O.S.' }, { id: 'd', type: 'dialogue', text: '末班车即将进站。' }, { id: 'n', type: 'note', text: '作者注释' }] })
    const document = { title: '旧车站', targetSpec: spec, scenes: [scene] }
    const fountain = renderScreenplayFountainV1(document)
    const fdx = renderScreenplayFdxV1(document)
    const html = renderScreenplayPrintHtmlV1(document)
    expect(fountain).toContain('.INT./EXT. 车站 & 月台 - 夜')
    expect(fountain.indexOf('广播声')).toBeLessThan(fountain.indexOf('末班车即将进站'))
    expect(fountain).not.toContain('作者注释')
    expect(fdx).toContain('车站 &amp; 月台')
    expect(fdx).toContain('门 &lt;缓慢&gt; 打开。')
    expect(html).toContain('末班车即将进站。')
    expect(html).not.toContain('作者注释')
  })

  it('逐场审定后可正式完稿；完成态只读且必须显式重新打开审校', async () => {
    const fixture = await setup()
    let scene = await createScreenplayScene(fixture.scope, { planSectionKey: 'act-1', episodeNumber: 1, sceneNumber: 1, intExt: 'INT', location: '候车室', timeOfDay: '夜', summary: '选择', estimatedSeconds: 60, sourceUnitIds: [fixture.unitId], blocks: [{ id: 'a', type: 'action', text: '林岚在两扇门之间停下。' }] })
    scene = await updateScreenplayScene({ scope: fixture.scope, sceneId: scene.id!, expectedRevision: scene.revision, patch: { status: 'reviewed' } })
    const root = await db.adaptationProjects.where('workId').equals(fixture.scope.workId).first()
    const completed = await completeAdaptationProductionV1({ scope: fixture.scope, expectedRevision: root!.revision })
    expect(completed.status).toBe('complete'); expect((await db.works.get(fixture.scope.workId))?.status).toBe('completed')
    await expect(updateScreenplayScene({ scope: fixture.scope, sceneId: scene.id!, expectedRevision: scene.revision, patch: { summary: '完稿后静默改写' } })).rejects.toThrow('重新打开审校')
    const reopened = await reopenAdaptationProductionV1({ scope: fixture.scope, expectedRevision: completed.revision })
    expect(reopened.status).toBe('review'); expect((await db.works.get(fixture.scope.workId))?.status).toBe('ongoing')
    scene = await updateScreenplayScene({ scope: fixture.scope, sceneId: scene.id!, expectedRevision: scene.revision, patch: { summary: '作者重新审校' } })
    expect(scene.summary).toBe('作者重新审校')
  })

  it('v7 往返重映射场景 owner、来源证据和块角色；删除角色保留 cue name 并置空 ID', async () => {
    const fixture = await setup()
    await createScreenplayScene(fixture.scope, { planSectionKey: 'act-1', episodeNumber: 1, sceneNumber: 1, intExt: 'INT', location: '候车室', timeOfDay: '夜', summary: '对话', estimatedSeconds: 40, sourceUnitIds: [fixture.unitId], blocks: [{ id: 'c', type: 'character', characterId: fixture.characterId, name: '林岚' }, { id: 'd', type: 'dialogue', text: '回去吧。' }] })
    const backup = await exportProjectJSON(fixture.scope.projectId)
    expect(backup.version).toBe(10)
    expect(backup.screenplayScenes?.[0]._blockCharacterExportIds).toEqual([0, null])
    expect((backup.screenplayScenes?.[0].blocks[0] as any).characterId).toBeNull()
    const importedId = await importProjectJSON(structuredClone(backup))
    const importedScene = await db.screenplayScenes.where('projectId').equals(importedId).first()
    const importedCharacter = await db.characters.where('projectId').equals(importedId).first()
    const importedUnit = await db.adaptationSourceUnits.where('projectId').equals(importedId).filter(unit => unit.sourceKind === 'chapter').first()
    expect((importedScene!.blocks[0] as any).characterId).toBe(importedCharacter!.id)
    expect(importedScene!.sourceUnitIds).toEqual([importedUnit!.id])
    await db.transaction('rw', transactionTablesFor('importProject'), async () => {
      await applyCharacterReferenceRemap({ projectId: importedId, fromCharacterId: importedCharacter!.id!, fromName: importedCharacter!.name })
    })
    const afterDelete = await db.screenplayScenes.get(importedScene!.id!)
    expect(afterDelete!.blocks[0]).toMatchObject({ type: 'character', name: '林岚', characterId: null })
  })
})
