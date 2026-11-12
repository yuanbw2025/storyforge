import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { saveComicVisualSubject } from '../../src/lib/comic/service'
import { commitUploadedComicAssetV1 } from '../../src/lib/comic/media-service'
import { adoptComicVisualBibleV1 } from '../../src/lib/comic/production'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useCharacterStore } from '../../src/stores/character'
import { addCurrentWorldFixtureV1 } from '../helpers/current-workspace'
import { addSfqa043MediaAndPageV1, createSfqa043ComicFixtureV1 } from '../helpers/sfqa043-comic'
import { installRasterDecoderForVitestV1 } from '../helpers/raster-decoder-vitest'

installRasterDecoderForVitestV1()

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

async function snapshot() {
  return { subjects: await db.comicVisualSubjects.toArray(), roots: await db.adaptationProjects.toArray(),
    pages: await db.comicPages.toArray(), panels: await db.comicPanels.toArray(),
    assets: await db.comicMediaAssets.toArray(), blobs: await db.mediaBlobObjects.toArray() }
}

describe.sequential('SFQA034 · 已建立的视觉主体身份不可改名', () => {
  it.each(['none', 'candidate', 'selected'] as const)('已有主体无论是否选择参考图都拒绝修改稳定key：%s', async media => {
    const f = await createSfqa043ComicFixtureV1()
    if (media === 'selected') await addSfqa043MediaAndPageV1(f)
    if (media === 'candidate') await commitUploadedComicAssetV1({ scope: f.scope, subjectId: f.subject.id!,
      data: Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQMar4DwAC2gG+nphhRgAAAABJRU5ErkJggg==', 'base64')).buffer,
      rights: { version: 1, source: 'author-upload', commercialUse: 'allowed', redistribution: 'allowed', attribution: '',
        declaration: '独立合成测试像素', declaredAt: Date.now() } })
    const subject = (await db.comicVisualSubjects.get(f.subject.id!))!
    const before = await snapshot()
    await expect(saveComicVisualSubject({ scope: f.scope, subjectId: subject.id,
      expectedRevision: subject.revision, draft: { ...subject, stableKey: 'renamed-hero' } })).rejects.toThrow(/稳定|stableKey|身份/)
    expect(await snapshot()).toEqual(before)
  })

  it('仅修改显示名称保留身份、既有媒体和视觉复核，并且不影响其他Work同名key', async () => {
    const f = await createSfqa043ComicFixtureV1()
    const media = await addSfqa043MediaAndPageV1(f)
    const other = await createSfqa043ComicFixtureV1()
    const before = await snapshot()
    const subject = (await db.comicVisualSubjects.get(f.subject.id!))!
    const renamed = await saveComicVisualSubject({ scope: f.scope, subjectId: subject.id,
      expectedRevision: subject.revision, draft: { ...subject, label: '林岚（显示名）' } })
    expect(renamed).toMatchObject({ id: subject.id, stableKey: 'hero', label: '林岚（显示名）',
      characterId: subject.characterId, selectedMediaAssetKey: media.subjectAsset.stableKey })
    const after = await snapshot()
    expect(after.panels).toEqual(before.panels)
    expect(after.assets).toEqual(before.assets)
    expect(after.blobs).toEqual(before.blobs)
    expect(await db.comicVisualSubjects.get(other.subject.id!)).toEqual(before.subjects.find(row => row.id === other.subject.id))
  })

  it('拒绝旧revision及跨Work身份请求，失败不写入任何关联数据', async () => {
    const f = await createSfqa043ComicFixtureV1()
    const other = await createSfqa043ComicFixtureV1()
    const before = await snapshot()
    await expect(saveComicVisualSubject({ scope: f.scope, subjectId: f.subject.id,
      expectedRevision: f.subject.revision - 1, draft: { ...f.subject, label: '旧结果' } })).rejects.toThrow(/变化|刷新/)
    await expect(saveComicVisualSubject({ scope: other.scope, subjectId: f.subject.id,
      expectedRevision: f.subject.revision, draft: { ...f.subject, label: '越界' } })).rejects.toThrow(/越界/)
    expect(await snapshot()).toEqual(before)
  })

  it('手工入口只接受当前World实际地点，不把同项目另一个World的地点当绑定', async () => {
    const f = await createSfqa043ComicFixtureV1()
    const valid = await saveComicVisualSubject({ scope: f.scope, draft: { ...f.subject, stableKey: 'station', kind: 'location',
      characterId: null, locationRefKey: f.location.id, label: '旧站' } })
    expect(valid.locationRefKey).toBe(f.location.id)
    const world = await addCurrentWorldFixtureV1({ projectId: f.scope.projectId, name: '另一个World' })
    await db.geographies.add(stampNewRecord({ ...f.scope, worldId: world.id! }, 'geographies', {
      projectId: f.scope.projectId, overview: '', locations: JSON.stringify([{ ...f.location, id: 'foreign-station' }]),
      createdAt: Date.now(), updatedAt: Date.now(),
    }, { owner: 'world' }))
    const before = await snapshot()
    await expect(saveComicVisualSubject({ scope: f.scope, draft: { ...valid, stableKey: 'foreign',
      locationRefKey: 'foreign-station' } })).rejects.toThrow(/当前 World|不可解析/)
    expect(await snapshot()).toEqual(before)
  })

  it('锁定主体可以先单独解锁，之后再单独编辑显示名称', async () => {
    const f = await createSfqa043ComicFixtureV1()
    let subject = await saveComicVisualSubject({ scope: f.scope, subjectId: f.subject.id,
      expectedRevision: f.subject.revision, draft: { ...f.subject, status: 'locked' } })
    subject = await saveComicVisualSubject({ scope: f.scope, subjectId: subject.id,
      expectedRevision: subject.revision, draft: { ...subject, status: 'reviewed' } })
    expect(subject.status).toBe('reviewed')
    const renamed = await saveComicVisualSubject({ scope: f.scope, subjectId: subject.id,
      expectedRevision: subject.revision, draft: { ...subject, label: '解锁后的显示名' } })
    expect(renamed).toMatchObject({ stableKey: 'hero', label: '解锁后的显示名' })
  })

  it.each(['missing-binding', 'missing-character', 'foreign-character', 'missing-location', 'foreign-location'] as const)(
    '不能改为prop并清空旧引用来洗掉已失效的绑定：%s', async corruption => {
      const f = await createSfqa043ComicFixtureV1()
      if (corruption === 'missing-binding') await db.workCharacterBindings.delete(f.bindingId)
      if (corruption === 'missing-character') await db.characters.delete(f.characterId)
      if (corruption === 'foreign-character') {
        const other = await createSfqa043ComicFixtureV1()
        await db.comicVisualSubjects.update(f.subject.id!, { characterId: other.characterId })
      }
      if (corruption === 'missing-location') {
        await db.comicVisualSubjects.update(f.subject.id!, { kind: 'location', characterId: null, locationRefKey: f.location.id })
        await db.geographies.update(f.geographyId, { locations: '[]' })
      }
      if (corruption === 'foreign-location') {
        const other = await createSfqa043ComicFixtureV1()
        await db.comicVisualSubjects.update(f.subject.id!, { kind: 'location', characterId: null, locationRefKey: other.location.id })
      }
      const subject = (await db.comicVisualSubjects.get(f.subject.id!))!
      expect(subject.selectedMediaAssetKey).toBeNull()
      const before = await snapshot()
      await expect(saveComicVisualSubject({ scope: f.scope, subjectId: subject.id, expectedRevision: subject.revision,
        draft: { ...subject, kind: 'prop', characterId: null, locationRefKey: null } })).rejects.toThrow(/已有|绑定|引用/)
      expect(await snapshot()).toEqual(before)
    })

  it('正规实体删除清成null后仍可编辑原主体，不重造已删除角色的绑定', async () => {
    const f = await createSfqa043ComicFixtureV1()
    await useCharacterStore.getState().deleteCharacter(f.characterId)
    const subject = (await db.comicVisualSubjects.get(f.subject.id!))!
    expect(subject.characterId).toBeNull()
    const bindings = await db.workCharacterBindings.toArray()
    const saved = await saveComicVisualSubject({ scope: f.scope, subjectId: subject.id, expectedRevision: subject.revision,
      draft: { ...subject, design: { ...subject.design, description: '保留原设计快照后人工补充' } } })
    expect(saved).toMatchObject({ id: subject.id, characterId: null, stableKey: subject.stableKey })
    expect(await db.characters.get(f.characterId)).toBeUndefined()
    expect(await db.workCharacterBindings.toArray()).toEqual(bindings)
  })

  it.each(['character', 'location'] as const)('专业入口已有合法无外部引用的%s仍可手工更新，新建仍须显式绑定', async kind => {
    const f = await createSfqa043ComicFixtureV1()
    const candidate = structuredClone(f.candidate)
    candidate.subjects[0] = { ...candidate.subjects[0], stableKey: 'unbound', kind }
    const root = (await db.adaptationProjects.get(f.adaptation.id!))!
    await adoptComicVisualBibleV1({ scope: f.scope, expectedAdaptationRevision: root.revision,
      sourceManifestVersion: 1, candidate, allowReplaceExisting: true })
    const subject = (await db.comicVisualSubjects.where('[workId+stableKey]').equals([f.scope.workId, 'unbound']).first())!
    const saved = await saveComicVisualSubject({ scope: f.scope, subjectId: subject.id, expectedRevision: subject.revision,
      draft: { ...subject, design: { ...subject.design, description: '无外部实体的原创视觉设定' } } })
    expect(saved).toMatchObject({ id: subject.id, stableKey: 'unbound', characterId: null, locationRefKey: null })
    const before = await snapshot()
    await expect(saveComicVisualSubject({ scope: f.scope, draft: { ...saved, stableKey: 'new-unbound' } })).rejects.toThrow(/绑定|引用|地点/)
    expect(await snapshot()).toEqual(before)
  })
})
