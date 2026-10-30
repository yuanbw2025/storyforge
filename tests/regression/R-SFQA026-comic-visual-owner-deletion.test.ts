import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { confirmAdaptationBrief, confirmAdaptationPlan, confirmComicVisualBible, createAdaptation, listActiveSourceUnits,
  saveAdaptationBriefDraft, saveAdaptationPlanDraft, startAdaptationProduction } from '../../src/lib/adaptation/source-manifest'
import { defaultComicTargetSpec } from '../../src/lib/comic/authoring'
import { createComicPage, deleteComicVisualSubject, saveComicVisualSubject, updateComicPage, updateComicPanel } from '../../src/lib/comic/service'
import { commitUploadedComicAssetV1, removeComicMediaAssetV1, selectComicMediaAssetV1 } from '../../src/lib/comic/media-service'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import * as blobStore from '../../src/lib/media/blob-store'

// Complete CRC-checked RGBA PNGs, not undecodable header-only image fixtures.
const PIXELS = ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQMar4DwAC2gG+nphhRgAAAABJRU5ErkJggg==', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPYYlTxHwAFWgJeNUWBEgAAAABJRU5ErkJggg==']
const DESIGN = { description: '合成车票道具', silhouette: '矩形', facialFeatures: '', hairAndCostume: '', palette: [] as string[], materials: [] as string[], distinguishingMarks: [] as string[], prohibitedChanges: [] as string[] }
const SUBJECT_KEY = 'prop.local-ticket'
async function fixture(label: string, originalScope?: WorkspaceScope, withAsset = true) {
  const sourceScope = originalScope ?? (await createWorkspace({ name: 'Q026 原作 ' + label, description: '', genres: [], targetWordCount: 10_000, status: 'drafting' }, {
    kind: 'novel', novelProfile: 'long', importedNovelText: '清晨，林岚收好车票，走入旧车站。' + label,
  })).scope
  const comic = await createAdaptation({ sourceScope, sourceWorkId: sourceScope.workId, title: 'Q026 漫画 ' + label,
    sourceSelection: { mode: 'entire-work' }, medium: 'comic', targetSpec: defaultComicTargetSpec() })
  const unit = (await listActiveSourceUnits(comic.adaptation.id!)).find(row => row.sourceKind === 'chapter')!
  const subject = await saveComicVisualSubject({ scope: comic.scope, draft: { stableKey: SUBJECT_KEY, kind: 'prop', characterId: null,
    locationRefKey: null, label: '车票 ' + label, sourceUnitIds: [unit.id!], design: DESIGN } })
  const bytes = Uint8Array.from(Buffer.from(PIXELS[label === 'A' ? 0 : 1]!, 'base64')).buffer
  const rights = { version: 1 as const, source: 'author-upload' as const, commercialUse: 'allowed' as const, redistribution: 'allowed' as const,
    attribution: '', declaration: '合成测试图，不含作者数据。', declaredAt: Date.now() }
  const asset = withAsset ? await commitUploadedComicAssetV1({ scope: comic.scope, subjectId: subject.id!, data: bytes, rights }) : undefined
  return { ...comic, sourceScope, unit, subject, asset, bytes, rights }
}
function binaryJson(_key: string, value: unknown) {
  return value instanceof ArrayBuffer ? { binary: [...new Uint8Array(value)] } : value
}
async function allBytes() {
  return JSON.stringify(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])), binaryJson)
}
async function protectedWorkBytes(scope: WorkspaceScope) {
  return JSON.stringify(await Promise.all(db.tables.map(async table => [table.name, (await table.toArray()).filter(row =>
    row.workId === scope.workId || (table.name === 'projects' && row.id === scope.projectId)
    || (table.name === 'worlds' && row.id === scope.worldId) || (table.name === 'works' && row.id === scope.workId),
  )])), binaryJson)
}
async function referencedPage(item: Awaited<ReturnType<typeof fixture>>, continuity = true, states = true) {
  let root = await saveAdaptationBriefDraft({ adaptationProjectId: item.adaptation.id!, expectedRevision: item.adaptation.revision,
    brief: { version: 1, coreTheme: '选择与代价', dominantEmotion: '克制', mustKeep: ['车票'], mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: [],
      audience: '大众', rating: 'PG-13', targetScale: '一页', narrativePerspective: '林岚', timeBudget: '', costLimit: '', deviationNotes: '', unresolvedQuestions: [], assumptions: [] } })
  root = await confirmAdaptationBrief({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  root = await saveAdaptationPlanDraft({ adaptationProjectId: root.id!, expectedRevision: root.revision,
    plan: { version: 1, premise: '林岚凭车票进入旧站。', sections: [{ stableKey: 'chapter-1', title: '旧站', summary: '选择', order: 0, episodeNumber: 1, sourceUnitKeys: [item.unit.sourceUnitKey] }], globalAssumptions: [] } })
  root = await confirmAdaptationPlan({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  root = await confirmComicVisualBible({ adaptationProjectId: root.id!, expectedRevision: root.revision,
    visualBible: { version: 1, artDirection: '原创漫画', linework: '清晰墨线', palette: ['蓝'], lighting: '清晨', periodAndMaterials: '当代车站', cameraLanguage: ['近景'], prohibitedDepictions: ['图片不含文字'] } })
  await startAdaptationProduction({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  const created = await createComicPage(item.scope, { stableKey: 'page-1', chapterNumber: 1, summary: '车票', panels: [{
    stableKey: 'panel-1', frame: { x: 0, y: 0, width: 1, height: 1 }, shot: { size: 'wide', angle: 'eye-level', movement: 'static', composition: '手持车票' },
    action: '林岚拿起车票。', visualPrompt: 'ticket, no text', negativePrompt: 'watermark', sourceUnitIds: [item.unit.id!], lettering: [],
    continuityRefs: continuity ? [{ subjectKey: SUBJECT_KEY, note: '同一车票' }] : [],
  }] })
  const panel = states ? await updateComicPanel({ scope: item.scope, panelId: created.panels[0]!.id!, expectedRevision: 1,
    patch: { subjectStates: [{ subjectKey: SUBJECT_KEY, costume: '不适用', condition: '完整', props: [], position: '手中' }] } }) : created.panels[0]!
  return { page: created.page, panel }
}
beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network or model in comic deletion regression') }))
})
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete() })

describe('SFQA-026 comic visual deletion ownership', () => {
  it.each(['different-project', 'same-project'] as const)('same local subject key preserves every other comic row and Blob: %s', async placement => {
    const a = await fixture('A'); const b = await fixture('B', placement === 'same-project' ? a.sourceScope : undefined)
    await selectComicMediaAssetV1({ scope: b.scope, subjectId: b.subject.id!, assetKey: b.asset!.stableKey, expectedRevision: b.subject.revision })
    expect(a.scope.workId).not.toBe(b.scope.workId)
    expect(a.subject.stableKey).toBe(b.subject.stableKey)
    expect(a.scope.projectId === b.scope.projectId).toBe(placement === 'same-project')
    const beforeB = await protectedWorkBytes(b.scope)
    let error: unknown
    try { await deleteComicVisualSubject({ scope: a.scope, subjectId: a.subject.id!, clearReferences: true }) } catch (caught) { error = caught }
    // Compare the complete retained native Blob bytes before checking the return,
    // so a late GC error cannot hide a metadata delete already committed.
    expect(await protectedWorkBytes(b.scope)).toBe(beforeB)
    expect(error).toBeUndefined()
    expect(await db.comicVisualSubjects.get(a.subject.id!)).toBeUndefined()
    expect(await db.comicMediaAssets.get(a.asset!.id!)).toBeUndefined()
    expect(await db.mediaBlobObjects.get(a.asset!.blobObjectId)).toBeUndefined()
  })
  it('rejects a foreign subject ID before any write', async () => {
    const a = await fixture('A'); const b = await fixture('B'); const before = await allBytes()
    await expect(deleteComicVisualSubject({ scope: a.scope, subjectId: b.subject.id!, clearReferences: true })).rejects.toThrow('越界')
    expect(await allBytes()).toBe(before)
  })
  it('requires an explicit reference-cleanup choice for owned media', async () => {
    const a = await fixture('A'); const before = await allBytes()
    await expect(deleteComicVisualSubject({ scope: a.scope, subjectId: a.subject.id! })).rejects.toThrow('显式清理')
    expect(await allBytes()).toBe(before)
  })
  it('can remove an unreferenced visual entry without a cleanup choice', async () => {
    const a = await fixture('A', undefined, false)
    await deleteComicVisualSubject({ scope: a.scope, subjectId: a.subject.id! })
    expect(await db.comicVisualSubjects.get(a.subject.id!)).toBeUndefined()
  })
  it('retains a locked visual entry and every original byte', async () => {
    const a = await fixture('A')
    await saveComicVisualSubject({ scope: a.scope, subjectId: a.subject.id!, expectedRevision: a.subject.revision,
      draft: { ...a.subject, status: 'locked' } })
    const before = await allBytes()
    await expect(deleteComicVisualSubject({ scope: a.scope, subjectId: a.subject.id!, clearReferences: true })).rejects.toThrow('锁定')
    expect(await allBytes()).toBe(before)
  })
  it('rolls back all metadata when the final subject deletion fails; GC never removes its bytes', async () => {
    const a = await fixture('A'); const before = await allBytes()
    vi.spyOn(db.comicVisualSubjects, 'delete').mockImplementationOnce(() => { throw new Error('synthetic final transaction failure') })
    await expect(deleteComicVisualSubject({ scope: a.scope, subjectId: a.subject.id!, clearReferences: true })).rejects.toThrow('synthetic final transaction failure')
    expect(await allBytes()).toBe(before)
  })
  it.each([true, false])('clears real page-linked continuity and subject states; continuity=%s', async continuity => {
    const a = await fixture('A'); const { panel } = await referencedPage(a, continuity)
    await deleteComicVisualSubject({ scope: a.scope, subjectId: a.subject.id!, clearReferences: true })
    const saved = await db.comicPanels.get(panel.id!)
    expect(saved?.continuityRefs).toEqual([]); expect(saved?.subjectStates).toEqual([])
    expect(saved?.revision).toBeGreaterThan(panel.revision)
    expect(saved?.visualReviewRevision).toBeNull(); expect(saved?.narrativeReviewRevision).toBeNull()
  })
  it.each(['panel', 'page'] as const)('refuses to change a locked %s through visual deletion', async locked => {
    const a = await fixture('A'); const { page, panel } = await referencedPage(a)
    if (locked === 'panel') await updateComicPanel({ scope: a.scope, panelId: panel.id!, expectedRevision: panel.revision, patch: { status: 'locked' } })
    else await updateComicPage({ scope: a.scope, pageId: page.id!, expectedRevision: page.revision, patch: { status: 'locked' } })
    const before = await allBytes()
    await expect(deleteComicVisualSubject({ scope: a.scope, subjectId: a.subject.id!, clearReferences: true })).rejects.toThrow('锁定')
    expect(await allBytes()).toBe(before)
  })
  it('clears selected panel media through its actual Page owner and honors a locked parent page', async () => {
    const a = await fixture('A'); const { page, panel } = await referencedPage(a)
    const asset = await commitUploadedComicAssetV1({ scope: a.scope, panelId: panel.id!, data: a.bytes, rights: a.rights })
    const selected = await selectComicMediaAssetV1({ scope: a.scope, assetKey: asset.stableKey, panelId: panel.id!, expectedRevision: panel.revision })
    const locked = await updateComicPage({ scope: a.scope, pageId: page.id!, expectedRevision: page.revision, patch: { status: 'locked' } })
    const before = await allBytes()
    await expect(removeComicMediaAssetV1({ scope: a.scope, assetKey: asset.stableKey, clearReferences: true })).rejects.toThrow('锁定')
    expect(await allBytes()).toBe(before)
    await updateComicPage({ scope: a.scope, pageId: page.id!, expectedRevision: locked.revision, patch: { status: 'reviewed' } })
    await removeComicMediaAssetV1({ scope: a.scope, assetKey: asset.stableKey, clearReferences: true })
    expect((await db.comicPanels.get(panel.id!))?.selectedMediaAssetKey).toBeNull()
    expect((await db.comicPanels.get(panel.id!))?.revision).toBeGreaterThan(selected.revision)
  })
  it('clears dependent draft asset links and remains a valid complete backup', async () => {
    const a = await fixture('A'); const { panel } = await referencedPage(a)
    const dependent = await commitUploadedComicAssetV1({ scope: a.scope, panelId: panel.id!, data: a.bytes, rights: a.rights })
    // Controlled, legal persisted reference metadata; no image-generation claim.
    await db.comicMediaAssets.update(dependent.id!, { referenceAssetKeys: [a.asset!.stableKey] })
    await selectComicMediaAssetV1({ scope: a.scope, assetKey: dependent.stableKey, panelId: panel.id!, expectedRevision: panel.revision })
    await deleteComicVisualSubject({ scope: a.scope, subjectId: a.subject.id!, clearReferences: true })
    expect((await db.comicMediaAssets.get(dependent.id!))?.referenceAssetKeys).toEqual([])
    expect((await db.comicPanels.get(panel.id!))?.selectedMediaAssetKey).toBe(dependent.stableKey)
    expect(await db.mediaBlobObjects.get(dependent.blobObjectId)).toBeTruthy()
    await expect(importProjectJSON(await exportProjectJSON(a.scope.projectId))).resolves.toBeTypeOf('number')
  })
  it('imported copies keep identical local keys without becoming deletion targets', async () => {
    const a = await fixture('A'); const imported = await importProjectJSON(await exportProjectJSON(a.scope.projectId))
    const work = (await db.works.where('projectId').equals(imported).toArray()).find(row => row.kind === 'comic')!
    const scope = { projectId: imported, worldId: work.worldId, workId: work.id! }; const before = await protectedWorkBytes(scope)
    expect((await db.comicVisualSubjects.where('workId').equals(work.id!).first())?.stableKey).toBe(SUBJECT_KEY)
    await deleteComicVisualSubject({ scope: a.scope, subjectId: a.subject.id!, clearReferences: true })
    expect(await protectedWorkBytes(scope)).toBe(before)
  })
  it('shared bytes remain while another local visual asset refers to them', async () => {
    const a = await fixture('A')
    const other = await saveComicVisualSubject({ scope: a.scope, draft: { ...a.subject, stableKey: 'prop.other-ticket' } })
    const asset = await commitUploadedComicAssetV1({ scope: a.scope, subjectId: other.id!, data: a.bytes, rights: a.rights })
    expect(asset.blobObjectId).toBe(a.asset!.blobObjectId)
    await deleteComicVisualSubject({ scope: a.scope, subjectId: a.subject.id!, clearReferences: true })
    expect(await db.comicVisualSubjects.get(other.id!)).toEqual(other)
    expect(await db.comicMediaAssets.get(asset.id!)).toEqual(asset)
    expect((await db.mediaBlobObjects.get(asset.blobObjectId))?.data).toEqual(a.bytes)
  })
  it.each([{ initial: false, later: true }, { initial: true, later: false }])('captures cleanup permission before await: $initial → $later', async ({ initial, later }) => {
    const a = await fixture('A'); const before = await allBytes()
    const command = { scope: a.scope, subjectId: a.subject.id!, clearReferences: initial }
    const operation = deleteComicVisualSubject(command); command.clearReferences = later
    if (initial) { await operation; expect(await db.comicVisualSubjects.get(a.subject.id!)).toBeUndefined() }
    else { await expect(operation).rejects.toThrow('显式清理'); expect(await allBytes()).toBe(before) }
  })
  it('captures the selected owner and subject before caller objects are changed', async () => {
    const a = await fixture('A'); const b = await fixture('B', a.sourceScope); const protectedB = await protectedWorkBytes(b.scope)
    const command = { scope: { ...a.scope }, subjectId: a.subject.id!, clearReferences: true }
    const operation = deleteComicVisualSubject(command); Object.assign(command.scope, b.scope); command.subjectId = b.subject.id!
    await operation
    expect(await db.comicVisualSubjects.get(a.subject.id!)).toBeUndefined()
    expect(await protectedWorkBytes(b.scope)).toBe(protectedB)
  })
  it('GC failure after the owned transaction cannot touch another comic', async () => {
    const a = await fixture('A'); const b = await fixture('B'); const beforeB = await protectedWorkBytes(b.scope)
    vi.spyOn(blobStore, 'markUnreferencedMediaBlobForDeletionV1').mockRejectedValueOnce(new Error('synthetic GC failure'))
    await expect(deleteComicVisualSubject({ scope: a.scope, subjectId: a.subject.id!, clearReferences: true })).rejects.toThrow('synthetic GC failure')
    expect(await protectedWorkBytes(b.scope)).toBe(beforeB)
    expect(await db.comicVisualSubjects.get(a.subject.id!)).toBeUndefined()
    expect((await db.mediaBlobObjects.get(a.asset!.blobObjectId))?.data).toEqual(a.bytes)
  })
})
