import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adoptComicVisualBibleV1 } from '../../src/lib/comic/production'
import { saveComicVisualSubject } from '../../src/lib/comic/service'
import { confirmComicVisualBible } from '../../src/lib/adaptation/source-manifest'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { adopt } from '../../src/lib/registry/adopt'
import { useCharacterStore } from '../../src/stores/character'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { ComicVisualBibleCandidateV1, Geography, Location, WorkspaceScope } from '../../src/lib/types'
import { addCurrentWorkFixtureV1, addCurrentWorldFixtureV1 } from '../helpers/current-workspace'
import { addSfqa043MediaAndPageV1, createSfqa043ComicFixtureV1 } from '../helpers/sfqa043-comic'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

type Fixture = Awaited<ReturnType<typeof createSfqa043ComicFixtureV1>>
async function state(f: Fixture) {
  return { root: await db.adaptationProjects.get(f.adaptation.id!), subjects: await db.comicVisualSubjects.toArray(),
    assets: await db.comicMediaAssets.toArray(), blobs: await db.mediaBlobObjects.toArray(), panels: await db.comicPanels.toArray(),
    bindings: await db.workCharacterBindings.toArray(), characters: await db.characters.toArray(), geographies: await db.geographies.toArray() }
}
async function update(f: Fixture, candidate = f.candidate, expectedRevision?: number) {
  const root = await db.adaptationProjects.get(f.adaptation.id!)
  if (!root) throw new Error('missing adaptation')
  return adoptComicVisualBibleV1({ scope: f.scope, expectedAdaptationRevision: expectedRevision ?? root.revision,
    sourceManifestVersion: root.activeSourceManifestVersion, candidate, allowReplaceExisting: true })
}
async function addLocation(f: Fixture) {
  const subject = await saveComicVisualSubject({ scope: f.scope, draft: { stableKey: 'station', kind: 'location', characterId: null,
    locationRefKey: f.location.id, label: '旧车站', sourceUnitIds: [f.unit.id!], design: f.subject.design, status: 'reviewed' } })
  const candidate: ComicVisualBibleCandidateV1 = { ...structuredClone(f.candidate), subjects: [...structuredClone(f.candidate.subjects), {
    stableKey: 'station', kind: 'location', label: '旧车站', design: structuredClone(subject.design), sourceUnitKeys: [f.unit.sourceUnitKey],
  }] }
  return { subject, candidate }
}
async function otherWorldScope(f: Fixture): Promise<WorkspaceScope> {
  const world = await addCurrentWorldFixtureV1({ projectId: f.scope.projectId, name: '同项目的另一个世界' })
  const work = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: world.id!, create: { title: '另一个真实测试作品', kind: 'novel', novelProfile: 'short', targetWordCount: 10_000 } })
  return { projectId: f.scope.projectId, worldId: world.id!, workId: work.id! }
}

describe.sequential('SFQA043 · 专业视觉圣经使用实际目标Work实体绑定', () => {
  it('合法绑定的已有主体更新成功并保留stableKey、实际ID和角色绑定', async () => {
    const f = await createSfqa043ComicFixtureV1()
    const root = await db.adaptationProjects.get(f.adaptation.id!)
    if (!root) throw new Error('missing real adaptation root')
    await adoptComicVisualBibleV1({ scope: f.scope, expectedAdaptationRevision: root.revision,
      sourceManifestVersion: root.activeSourceManifestVersion, candidate: f.candidate, allowReplaceExisting: true })
    const after = await db.comicVisualSubjects.get(f.subject.id!)
    expect(after).toMatchObject({ id: f.subject.id, stableKey: 'hero', characterId: f.characterId,
      selectedMediaAssetKey: f.subject.selectedMediaAssetKey, revision: f.subject.revision + 1 })
    expect(after?.design.description).toBe('专业更新后的短发与深色风衣')
    expect(await db.workCharacterBindings.get(f.bindingId)).toBeDefined()
    expect((await db.adaptationProjects.get(root.id!))?.revision).toBe(root.revision + 1)
    expect(await db.agentRuns.count()).toBe(0)
  })

  it('真实已选参考媒资与字节不变，原作者视觉审查按既有路径失效', async () => {
    const f = await createSfqa043ComicFixtureV1()
    const media = await addSfqa043MediaAndPageV1(f)
    const before = await state(f)
    const oldSubject = before.subjects.find(row => row.id === f.subject.id)!
    expect(before.panels[0].visualReviewBasis).toBe('author-visual')
    await update(f)
    const after = await state(f)
    expect(after.subjects[0]).toMatchObject({ id: oldSubject.id, stableKey: oldSubject.stableKey,
      characterId: oldSubject.characterId, selectedMediaAssetKey: media.subjectAsset.stableKey, revision: oldSubject.revision + 1 })
    expect(after.assets).toEqual(before.assets); expect(after.blobs).toEqual(before.blobs)
    expect(after.characters).toEqual(before.characters); expect(after.bindings).toEqual(before.bindings)
    expect(after.geographies).toEqual(before.geographies)
    expect(after.panels[0]).toMatchObject({ selectedMediaAssetKey: media.panelAsset.stableKey,
      visualReviewRevision: null, visualReviewBasis: null, visualReviewedAt: null })
  })

  it.each(['missing', 'cross-work', 'dangling'] as const)('%s角色绑定不能被视为合法，原记录全量保留', async corruption => {
    const f = await createSfqa043ComicFixtureV1()
    if (corruption === 'missing') await db.workCharacterBindings.delete(f.bindingId)
    else if (corruption === 'cross-work') await db.workCharacterBindings.update(f.bindingId, { workId: f.source.scope.workId })
    else {
      // Deliberately corrupt imported references in the isolated fixture.
      await db.workCharacterBindings.update(f.bindingId, { characterId: 1_000_000 })
      await db.comicVisualSubjects.update(f.subject.id!, { characterId: 1_000_000 })
    }
    const before = await state(f)
    await expect(update(f)).rejects.toThrow(/绑定|越过/)
    expect(await state(f)).toEqual(before)
  })

  it('同Project另一World实体即使带有当前Work binding也拒绝', async () => {
    const f = await createSfqa043ComicFixtureV1(), other = await otherWorldScope(f)
    const result = await adopt({ projectId: other.projectId, scope: other, target: 'characters', mode: 'add',
      data: { name: '另一世界角色', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral' } })
    const foreignId = result.written[0]?.id
    if (foreignId == null) throw new Error('missing legitimate other-world character')
    await db.workCharacterBindings.update(f.bindingId, { characterId: foreignId })
    await db.comicVisualSubjects.update(f.subject.id!, { characterId: foreignId })
    const before = await state(f)
    await expect(update(f)).rejects.toThrow(/绑定|World/)
    expect(await state(f)).toEqual(before)
  })

  it('已有视觉主体本身越出Work时不能通过保留ID改归当前作品', async () => {
    const f = await createSfqa043ComicFixtureV1()
    await db.comicVisualSubjects.update(f.subject.id!, { workId: f.source.scope.workId })
    const before = await state(f)
    await expect(update(f)).rejects.toThrow(/越过目标 Work/)
    expect(await state(f)).toEqual(before)
  })

  it('不能以改变kind并清空旧引用绕过失效绑定检查', async () => {
    const f = await createSfqa043ComicFixtureV1()
    await db.workCharacterBindings.delete(f.bindingId)
    const candidate = structuredClone(f.candidate); candidate.subjects[0].kind = 'prop'
    const before = await state(f)
    await expect(update(f, candidate)).rejects.toThrow(/绑定/)
    expect(await state(f)).toEqual(before)
  })

  it('合法地点引用保留原ID/key，不能因允许缺少引用而跳过现有引用验证', async () => {
    const f = await createSfqa043ComicFixtureV1(), location = await addLocation(f)
    await update(f, location.candidate)
    expect(await db.comicVisualSubjects.get(location.subject.id!)).toMatchObject({ id: location.subject.id,
      stableKey: 'station', locationRefKey: f.location.id, characterId: null })
  })

  it.each(['missing', 'invalid-json'] as const)('地点%s时拒绝整个候选且不修写原数据', async corruption => {
    const f = await createSfqa043ComicFixtureV1(), location = await addLocation(f)
    await db.geographies.update(f.geographyId, { locations: corruption === 'missing' ? '[]' : '{broken' })
    const before = await state(f)
    await expect(update(f, location.candidate)).rejects.toThrow(/地点/)
    expect(await state(f)).toEqual(before)
  })

  it('同项目另一World的location key不能替当前World作绑定证明', async () => {
    const f = await createSfqa043ComicFixtureV1(), location = await addLocation(f), other = await otherWorldScope(f)
    const foreignLocation: Location = { ...f.location, id: 'other-world-location' }
    await db.geographies.add(stampNewRecord<Geography>(other, 'geographies', { projectId: other.projectId,
      overview: '另一世界地点', locations: JSON.stringify([foreignLocation]), createdAt: Date.now(), updatedAt: Date.now() }, { owner: 'world' }))
    await db.comicVisualSubjects.update(location.subject.id!, { locationRefKey: foreignLocation.id })
    const before = await state(f)
    await expect(update(f, location.candidate)).rejects.toThrow(/地点绑定|World/)
    expect(await state(f)).toEqual(before)
  })

  it('实体直接消失而引用未清理时拒绝专业更新并保留原图', async () => {
    const f = await createSfqa043ComicFixtureV1(); await addSfqa043MediaAndPageV1(f)
    await db.characters.delete(f.characterId)
    const before = await state(f)
    await expect(update(f)).rejects.toThrow(/角色绑定/)
    expect(await state(f)).toEqual(before)
  })

  it('既有正式删除已清空角色引用后保留设计快照与媒资，不重造binding', async () => {
    const f = await createSfqa043ComicFixtureV1(); await addSfqa043MediaAndPageV1(f)
    await useCharacterStore.getState().deleteCharacter(f.characterId)
    expect(await db.characters.get(f.characterId)).toBeUndefined()
    const before = await state(f)
    expect(before.subjects[0].characterId).toBeNull()
    await update(f)
    const after = await state(f)
    expect(after.subjects[0]).toMatchObject({ id: before.subjects[0].id, characterId: null,
      selectedMediaAssetKey: before.subjects[0].selectedMediaAssetKey })
    expect(after.assets).toEqual(before.assets); expect(after.blobs).toEqual(before.blobs)
    expect(after.bindings).toEqual(before.bindings)
  })

  it.each(['missing', 'cross-work', 'wrong-subject'] as const)('已选媒资%s不能被专业重建复制为合法引用', async corruption => {
    const f = await createSfqa043ComicFixtureV1()
    const { subjectAsset } = await addSfqa043MediaAndPageV1(f)
    if (corruption === 'missing') await db.comicMediaAssets.delete(subjectAsset.id!)
    else if (corruption === 'cross-work') await db.comicMediaAssets.update(subjectAsset.id!, { workId: f.source.scope.workId })
    else await db.comicMediaAssets.update(subjectAsset.id!, { subjectKey: 'other-subject' })
    const before = await state(f)
    await expect(update(f)).rejects.toThrow(/媒资/)
    expect(await state(f)).toEqual(before)
  })

  it('第二个主体写入实际失败时整次事务回滚，已选图和审查证据不变', async () => {
    const f = await createSfqa043ComicFixtureV1(), location = await addLocation(f)
    await addSfqa043MediaAndPageV1(f)
    const before = await state(f)
    const hook = (_key: unknown, row: { stableKey?: string }) => { if (row.stableKey === 'station') throw new Error('synthetic-subject-storage-failure') }
    db.comicVisualSubjects.hook('creating', hook)
    try {
      await expect(update(f, location.candidate)).rejects.toThrow(/synthetic-subject-storage-failure/)
      expect(await state(f)).toEqual(before)
    } finally { db.comicVisualSubjects.hook('creating').unsubscribe(hook) }
  })

  it('当前专业入口无外部绑定的新建/再次更新保留既有nullable政策，不伪造binding', async () => {
    const f = await createSfqa043ComicFixtureV1()
    const candidate = structuredClone(f.candidate); candidate.subjects[0].stableKey = 'unbound-hero'
    await update(f, candidate)
    const row = (await db.comicVisualSubjects.toArray())[0]
    expect(row.characterId).toBeNull()
    await update(f, candidate)
    expect(await db.comicVisualSubjects.get(row.id!)).toMatchObject({ id: row.id, characterId: null, stableKey: 'unbound-hero', revision: 2 })
    expect(await db.workCharacterBindings.count()).toBe(1)
  })

  it('生成后作者更新适配根仍触发原revision/CAS保护', async () => {
    const f = await createSfqa043ComicFixtureV1(), root = await db.adaptationProjects.get(f.adaptation.id!)
    if (!root) throw new Error('missing root')
    await confirmComicVisualBible({ adaptationProjectId: root.id!, expectedRevision: root.revision,
      visualBible: { ...f.candidate.global, artDirection: '作者先行修改' } })
    const before = await state(f)
    await expect(update(f, f.candidate, root.revision)).rejects.toThrow(/已变化|CAS/)
    expect(await state(f)).toEqual(before)
  })

  it('真实备份导入后仍按重映射实体验证，悬空引用拒绝且原图保留', async () => {
    const f = await createSfqa043ComicFixtureV1(); await addSfqa043MediaAndPageV1(f)
    const backup = await exportProjectJSON(f.scope.projectId)
    const imported = await importProjectJSON(backup)
    const root = (await db.adaptationProjects.where('projectId').equals(imported).toArray()).find(row => row.medium === 'comic')
    if (!root?.id) throw new Error('missing imported comic')
    const scope = { projectId: imported, worldId: root.worldId, workId: root.workId }
    const subject = (await db.comicVisualSubjects.where('adaptationProjectId').equals(root.id).toArray()).find(row => row.stableKey === 'hero')
    if (!subject?.id || subject.characterId == null) throw new Error('missing imported real binding')
    const binding = (await db.workCharacterBindings.where('workId').equals(root.workId).toArray()).find(row => row.characterId === subject.characterId)
    expect(binding).toBeDefined()
    await adoptComicVisualBibleV1({ scope, expectedAdaptationRevision: root.revision,
      sourceManifestVersion: root.activeSourceManifestVersion, candidate: f.candidate, allowReplaceExisting: true })
    const after = await db.comicVisualSubjects.get(subject.id)
    expect(after).toMatchObject({ id: subject.id, characterId: subject.characterId, selectedMediaAssetKey: subject.selectedMediaAssetKey })
    if (!binding?.id) throw new Error('missing imported binding')
    await db.workCharacterBindings.delete(binding.id)
    const latest = await db.adaptationProjects.get(root.id)
    await expect(adoptComicVisualBibleV1({ scope, expectedAdaptationRevision: latest!.revision,
      sourceManifestVersion: latest!.activeSourceManifestVersion, candidate: f.candidate, allowReplaceExisting: true })).rejects.toThrow(/绑定/)
    expect(await db.comicVisualSubjects.get(subject.id)).toEqual(after)
  })
})
