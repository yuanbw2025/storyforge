import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { adopt, hashAdoptFieldValueV1, hashAdoptRecordFieldsV1, replaceAdoptedCollection } from '../../src/lib/registry/adopt'
import { CHAPTER_TEXT_NORMALIZATION_VERSION, hashChapterText, sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { scopeTransactionTables, stampNewRecord } from '../../src/lib/workspace/scope'
import { createWorldWork } from '../../src/lib/workspace/works'
import { cascadeDeleteChapterRecords } from '../../src/lib/chapters/lifecycle'
import { createReferenceAnalysisRun } from '../../src/lib/reference-analysis/lifecycle'
import { adoptDetailedOutlineAuthoringV1 } from '../../src/lib/agent/detailed-outline-authoring'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import type { AdoptInput } from '../../src/lib/registry/types'
import { REGISTRY_BY_NAME } from '../../src/lib/registry/project-tables'
import type { WorkspaceScope } from '../../src/lib/types'
import { addCurrentWorldFixtureV1, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { useOutlineStore } from '../../src/stores/outline'

const WRITERS = ['record-replace', 'record-append', 'record-fields-cas', 'chapter-cas'] as const
type Writer = typeof WRITERS[number]

async function workspace(name: string) {
  return createWorkspace({ name, description: '', genres: [], status: 'drafting', targetWordCount: 100_000 }, {
    kind: 'novel', novelProfile: 'long', importedNovelText: `synthetic original ${name}`,
  })
}

async function outline(scope: WorkspaceScope, title = 'another local outline') {
  return db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId: scope.projectId, workId: scope.workId, worldId: null, parentId: null,
    type: 'chapter' as const, title, summary: '', order: 1, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' }))
}

async function fixture() {
  const a = await workspace('scope A')
  const b = await workspace('scope B')
  const chapter = (await db.chapters.where('projectId').equals(a.scope.projectId).first())!
  const foreignChapter = (await db.chapters.where('projectId').equals(b.scope.projectId).first())!
  return { a, b, chapter, foreignChapter, ownOutlineId: await outline(a.scope) }
}

async function writeChapter(
  f: Awaited<ReturnType<typeof fixture>>, writer: Writer, data: Record<string, unknown>,
  options: { recordId?: number; stale?: boolean; staleHtml?: boolean } = {},
) {
  const before = (await db.chapters.get(f.chapter.id!))!
  const compareAndSet: AdoptInput['compareAndSet'] = writer === 'record-fields-cas'
    ? { kind: 'record-fields-value-hash', fields: Object.keys(data), expectedHash: options.stale
      ? '0'.repeat(64) : await hashAdoptRecordFieldsV1(before as unknown as Record<string, unknown>, Object.keys(data)) }
    : writer === 'chapter-cas'
      ? { kind: 'chapter-source-text-hash', textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
        expectedHash: options.stale ? '0'.repeat(64) : await hashChapterText(before.content),
        expectedContentHash: options.staleHtml ? '0'.repeat(64) : await sha256Text(before.content) }
      : undefined
  return adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'chapters',
    recordId: options.recordId ?? f.chapter.id!, mode: writer === 'record-append' ? 'append' : 'replace',
    data, ...(compareAndSet ? { compareAndSet } : {}) })
}

async function arrayFixture() {
  const f = await fixture()
  async function members(scope: WorkspaceScope, label: string) {
    const character = await adopt({ projectId: scope.projectId, scope, target: 'characters', mode: 'add', data: {
      name: `${label} character`, roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
    } })
    const foreshadow = await adopt({ projectId: scope.projectId, scope, target: 'foreshadows', mode: 'add', data: {
      name: `${label} foreshadow`, type: 'chekhov', status: 'planned', description: 'synthetic evidence',
    } })
    expect(character.written).toHaveLength(1)
    expect(foreshadow.written).toHaveLength(1)
    return { characterId: character.written[0].id, foreshadowId: foreshadow.written[0].id }
  }
  const own = await members(f.a.scope, 'own')
  const foreign = await members(f.b.scope, 'foreign')
  const added = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'detailedOutlines', mode: 'add', data: {
    outlineNodeId: f.chapter.outlineNodeId, scenes: [],
    appearingCharacterIds: [own.characterId], foreshadowIds: [own.foreshadowId],
  } })
  expect(added.written).toHaveLength(1)
  const detail = (await db.detailedOutlines.get(added.written[0].id))!
  return { ...f, own, foreign, detail }
}

describe('SFQA-035 · every registered adoption update checks references', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it.each(WRITERS)('%s rejects a foreign FK without writing other fields', async writer => {
    const f = await fixture()
    const before = await db.chapters.get(f.chapter.id!)
    const foreignBefore = await db.chapters.get(f.foreignChapter.id!)
    const result = await writeChapter(f, writer, { outlineNodeId: f.foreignChapter.outlineNodeId, title: 'must not change' })
    expect(result.written).toHaveLength(0)
    expect(result.fkErrors).toContainEqual({ field: 'outlineNodeId', refValue: f.foreignChapter.outlineNodeId })
    expect(await db.chapters.get(f.chapter.id!)).toEqual(before)
    expect(await db.chapters.get(f.foreignChapter.id!)).toEqual(foreignBefore)
  })

  it.each(WRITERS)('%s rejects a missing FK without partial writes', async writer => {
    const f = await fixture()
    const before = await db.chapters.get(f.chapter.id!)
    const result = await writeChapter(f, writer, { outlineNodeId: 999_999, notes: 'must not change' })
    expect(result.written).toHaveLength(0)
    expect(result.fkErrors).toContainEqual({ field: 'outlineNodeId', refValue: 999_999 })
    expect(await db.chapters.get(f.chapter.id!)).toEqual(before)
  })

  it.each(WRITERS)('%s refuses null for a required FK', async writer => {
    const f = await fixture()
    const before = await db.chapters.get(f.chapter.id!)
    const result = await writeChapter(f, writer, { outlineNodeId: null, title: 'must not change' })
    expect(result.written).toHaveLength(0)
    expect(result.skipped.length + result.fkErrors.length).toBeGreaterThan(0)
    expect(await db.chapters.get(f.chapter.id!)).toEqual(before)
  })

  it.each(['replace', 'append'] as const)('a non-point %s cannot bypass registered FK validation', async mode => {
    const f = await fixture()
    const before = await db.chapters.toArray()
    const result = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'chapters', mode,
      data: { outlineNodeId: f.foreignChapter.outlineNodeId, title: 'must not change' } })
    expect(result.written).toHaveLength(0)
    expect(result.fkErrors).toContainEqual({ field: 'outlineNodeId', refValue: f.foreignChapter.outlineNodeId })
    expect(await db.chapters.toArray()).toEqual(before)
  })

  it.each(['replace', 'add'] as const)('does not ignore compareAndSet when %s omits recordId', async mode => {
    const f = await fixture()
    const before = await db.chapters.toArray()
    const result = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'chapters', mode,
      data: { outlineNodeId: f.ownOutlineId, title: 'must not write without a CAS target' },
      compareAndSet: { kind: 'record-fields-value-hash', fields: ['outlineNodeId', 'title'], expectedHash: '0'.repeat(64) } })
    expect(result.written).toHaveLength(0)
    expect(await db.chapters.toArray()).toEqual(before)
  })

  it('keeps initialization and nullable clearing through a registered non-point route', async () => {
    const a = await createWorkspace({ name: 'empty owned Work', description: '', genres: [], status: 'drafting', targetWordCount: 100_000 }, {
      kind: 'novel', novelProfile: 'long',
    })
    const nodeId = await outline(a.scope)
    const created = await adopt({ projectId: a.scope.projectId, scope: a.scope, target: 'chapters', mode: 'replace', data: {
      outlineNodeId: nodeId, title: 'initialized chapter', content: '<p>synthetic author prose</p>', wordCount: 3,
      status: 'draft', order: 0, notes: '', perspectiveCharacterId: null,
    } })
    expect(created.written).toHaveLength(1)
    expect(await db.chapters.get(created.written[0].id)).toMatchObject({ projectId: a.scope.projectId, workId: a.scope.workId,
      outlineNodeId: nodeId, content: '<p>synthetic author prose</p>', perspectiveCharacterId: null })
    const result = await adopt({ projectId: a.scope.projectId, scope: a.scope, target: 'chapters', mode: 'append',
      data: { notes: 'author note', perspectiveCharacterId: null } })
    expect(result.written).toHaveLength(1)
    expect(await db.chapters.get(created.written[0].id)).toMatchObject({ outlineNodeId: nodeId,
      title: 'initialized chapter', content: '<p>synthetic author prose</p>', notes: 'author note', perspectiveCharacterId: null })
  })

  it('does not create an invalid non-point record when a declared required FK is omitted', async () => {
    const a = await createWorkspace({ name: 'empty initialization guard', description: '', genres: [], status: 'drafting', targetWordCount: 100_000 }, {
      kind: 'novel', novelProfile: 'long',
    })
    const result = await adopt({ projectId: a.scope.projectId, scope: a.scope, target: 'chapters', mode: 'replace',
      data: { title: 'missing parent must not initialize', content: '<p>synthetic</p>' } })
    expect(result.written).toHaveLength(0)
    expect(await db.chapters.count()).toBe(0)
  })

  it.each(WRITERS)('%s keeps valid local references, nullable clears and omitted fields', async writer => {
    const f = await fixture()
    const result = await writeChapter(f, writer, { outlineNodeId: f.ownOutlineId, perspectiveCharacterId: null })
    expect(result.written).toHaveLength(1)
    expect(result.fkErrors).toEqual([])
    expect(await db.chapters.get(f.chapter.id!)).toMatchObject({
      title: f.chapter.title, content: f.chapter.content, outlineNodeId: f.ownOutlineId, perspectiveCharacterId: null,
    })
  })

  for (const owner of ['work', 'world'] as const) {
    it.each(WRITERS)(`%s rejects another ${owner} inside the same Project`, async writer => {
      const f = await fixture()
      const otherWorld = owner === 'world'
        ? await addCurrentWorldFixtureV1({ projectId: f.a.scope.projectId, name: 'other semantic World' }) : f.a.world
      const otherWork = owner === 'world'
        ? await addCurrentWorkFixtureV1({ projectId: f.a.scope.projectId, worldId: otherWorld.id!, create: { title: 'other Work' } })
        : await createWorldWork(f.a.scope.projectId, { title: 'same World other Work' })
      const foreignOutline = await outline({ projectId: f.a.scope.projectId, worldId: otherWorld.id!, workId: otherWork.id! })
      const before = await db.chapters.get(f.chapter.id!)
      const result = await writeChapter(f, writer, { outlineNodeId: foreignOutline })
      expect(result.written).toHaveLength(0)
      expect(result.fkErrors).toContainEqual({ field: 'outlineNodeId', refValue: foreignOutline })
      expect(await db.chapters.get(f.chapter.id!)).toEqual(before)
    })
  }

  it.each(WRITERS)('%s still rejects a foreign target record itself', async writer => {
    const f = await fixture()
    const before = await db.chapters.toArray()
    const result = await writeChapter(f, writer, { title: 'must not cross owners' }, { recordId: f.foreignChapter.id! })
    expect(result.written).toHaveLength(0)
    expect(await db.chapters.toArray()).toEqual(before)
  })

  it.each(WRITERS)('%s accepts a shared World-owned character from another Work in that World', async writer => {
    const f = await fixture()
    const anotherWork = await createWorldWork(f.a.scope.projectId, { title: 'same-World collaborator' })
    const character = await adopt({ projectId: f.a.scope.projectId, scope: { ...f.a.scope, workId: anotherWork.id! },
      target: 'characters', mode: 'add', data: { name: 'shared Canon actor', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral' } })
    expect(character.written).toHaveLength(1)
    const result = await writeChapter(f, writer, { perspectiveCharacterId: character.written[0].id })
    expect(result.written).toHaveLength(1)
    expect(result.fkErrors).toEqual([])
    expect((await db.chapters.get(f.chapter.id!))?.perspectiveCharacterId).toBe(character.written[0].id)
  })

  it.each(['record-fields-cas', 'chapter-cas'] as const)('%s still rejects stale hashes with zero writes', async writer => {
    const f = await fixture()
    const before = await db.chapters.get(f.chapter.id!)
    const result = await writeChapter(f, writer, { outlineNodeId: f.ownOutlineId }, { stale: true })
    expect(result.written).toHaveLength(0)
    expect(await db.chapters.get(f.chapter.id!)).toEqual(before)
  })

  it('keeps the exact HTML CAS guard in addition to normalized prose', async () => {
    const f = await fixture()
    const result = await writeChapter(f, 'chapter-cas', { notes: 'must not change' }, { staleHtml: true })
    expect(result.written).toHaveLength(0)
    expect(await db.chapters.get(f.chapter.id!)).toEqual(f.chapter)
  })

  it.each(['replace', 'append', 'record-fields-cas'] as const)('%s filters both registered member arrays and reports fkErrors', async writer => {
    const f = await arrayFixture()
    const data = { appearingCharacterIds: [f.own.characterId, f.foreign.characterId, 999_999],
      foreshadowIds: [f.own.foreshadowId, f.foreign.foreshadowId] }
    const fields = Object.keys(data)
    const result = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'detailedOutlines', recordId: f.detail.id!,
      mode: writer === 'record-fields-cas' ? 'replace' : writer, data,
      ...(writer === 'record-fields-cas' ? { compareAndSet: { kind: 'record-fields-value-hash' as const, fields,
        expectedHash: await hashAdoptRecordFieldsV1(f.detail as unknown as Record<string, unknown>, fields) } } : {}) })
    expect(result.written).toHaveLength(1)
    expect(result.fkErrors).toEqual(expect.arrayContaining([
      { field: 'appearingCharacterIds[]', refValue: f.foreign.characterId },
      { field: 'appearingCharacterIds[]', refValue: 999_999 },
      { field: 'foreshadowIds[]', refValue: f.foreign.foreshadowId },
    ]))
    expect(await db.detailedOutlines.get(f.detail.id!)).toMatchObject({
      outlineNodeId: f.detail.outlineNodeId, scenes: [],
      appearingCharacterIds: [f.own.characterId], foreshadowIds: [f.own.foreshadowId],
    })
  })

  it.each(['replace', 'append', 'record-fields-cas'] as const)('%s filters malformed member keys without throwing or dropping valid members', async writer => {
    const f = await arrayFixture()
    const data = { appearingCharacterIds: [f.own.characterId, null, { invalid: true }, String(f.own.characterId)] }
    const result = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'detailedOutlines', recordId: f.detail.id!,
      mode: writer === 'record-fields-cas' ? 'replace' : writer, data,
      ...(writer === 'record-fields-cas' ? { compareAndSet: { kind: 'record-fields-value-hash' as const, fields: ['appearingCharacterIds'],
        expectedHash: await hashAdoptRecordFieldsV1(f.detail as unknown as Record<string, unknown>, ['appearingCharacterIds']) } } : {}) })
    expect(result.written).toHaveLength(1)
    expect(result.fkErrors).toHaveLength(3)
    expect((await db.detailedOutlines.get(f.detail.id!))?.appearingCharacterIds).toEqual([f.own.characterId])
  })

  it.each(['replace', 'append'] as const)('a non-point %s keeps registered array filtering and error reporting', async mode => {
    const f = await arrayFixture()
    const result = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'detailedOutlines', mode,
      data: { appearingCharacterIds: [f.own.characterId, f.foreign.characterId],
        foreshadowIds: [f.own.foreshadowId, f.foreign.foreshadowId] } })
    expect(result.written).toHaveLength(1)
    expect(result.fkErrors).toHaveLength(2)
    expect(await db.detailedOutlines.get(f.detail.id!)).toMatchObject({
      appearingCharacterIds: [f.own.characterId], foreshadowIds: [f.own.foreshadowId],
    })
  })

  it('keeps nullable FKs and empty member arrays usable in a narrower caller-owned transaction', async () => {
    const f = await arrayFixture()
    const cleared = await db.transaction('rw', scopeTransactionTables(db.chapters), async () => adopt({
      projectId: f.a.scope.projectId, scope: f.a.scope, target: 'chapters', recordId: f.chapter.id!, mode: 'replace',
      data: { perspectiveCharacterId: null },
    }))
    expect(cleared.written).toHaveLength(1)
    expect((await db.chapters.get(f.chapter.id!))?.perspectiveCharacterId).toBeNull()
    const empty = await db.transaction('rw', scopeTransactionTables(db.detailedOutlines), async () => adopt({
      projectId: f.a.scope.projectId, scope: f.a.scope, target: 'detailedOutlines', recordId: f.detail.id!, mode: 'replace',
      data: { appearingCharacterIds: [], foreshadowIds: [] },
    }))
    expect(empty.written).toHaveLength(1)
    expect(empty.fkErrors).toEqual([])
    expect(await db.detailedOutlines.get(f.detail.id!)).toMatchObject({ appearingCharacterIds: [], foreshadowIds: [] })
  })

  it('derives transaction readers from normalized fields when ordinary editing skips an empty reference', async () => {
    const f = await fixture()
    const result = await db.transaction('rw', scopeTransactionTables(db.chapters), async () => adopt({
      projectId: f.a.scope.projectId, scope: f.a.scope, target: 'chapters', recordId: f.chapter.id!, mode: 'replace',
      data: { title: 'normal title edit', perspectiveCharacterId: '' },
    }))
    expect(result.written).toHaveLength(1)
    expect(result.typeErrors).toEqual([])
    expect(await db.chapters.get(f.chapter.id!)).toMatchObject({ title: 'normal title edit', content: f.chapter.content })
    expect((await db.chapters.get(f.chapter.id!))?.perspectiveCharacterId ?? null).toBe(f.chapter.perspectiveCharacterId ?? null)
    await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'chapters', recordId: f.chapter.id!, mode: 'replace',
      data: { summary: 'retained exact author summary' } })
    const authorClear = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'chapters', recordId: f.chapter.id!,
      mode: 'replace', preserveAuthorText: true, data: { summary: '' } })
    expect(authorClear.written).toHaveLength(1)
    expect((await db.chapters.get(f.chapter.id!))?.summary).toBe('')
  })

  it.each(['add', ...WRITERS] as const)('%s serializes a concurrent parent deletion with its reference check and write', async writer => {
    const f = await fixture()
    await useOutlineStore.getState().loadAll(f.a.scope)
    let removal: Promise<void> | undefined
    let started = false
    async function deleteParentAtBoundary() {
      if (started) return
      started = true
      const holdsWriteLock = Dexie.currentTransaction?.mode === 'readwrite'
      removal = Dexie.ignoreTransaction(() => useOutlineStore.getState().deleteNode(f.ownOutlineId))
      // An independent delete can finish before the write only when the
      // adoption has no write transaction locking the referenced parent.
      if (!holdsWriteLock) await removal
    }
    const add = db.chapters.add.bind(db.chapters)
    vi.spyOn(db.chapters, 'add').mockImplementation((row, key) => Dexie.Promise.resolve().then(async () => {
      await deleteParentAtBoundary()
      return add(row, key)
    }))
    const update = db.chapters.update.bind(db.chapters)
    vi.spyOn(db.chapters, 'update').mockImplementation((key, changes) => Dexie.Promise.resolve().then(async () => {
      await deleteParentAtBoundary()
      return update(key, changes)
    }))
    const result = writer === 'add'
      ? await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'chapters', mode: 'add',
        data: { outlineNodeId: f.ownOutlineId, title: 'concurrent child' } })
      : await writeChapter(f, writer, { outlineNodeId: f.ownOutlineId })
    expect(started).toBe(true)
    await removal
    expect(await db.outlineNodes.get(f.ownOutlineId)).toBeUndefined()
    for (const written of result.written) expect(await db.chapters.get(written.id)).toBeUndefined()
    expect(await db.chapters.where('outlineNodeId').equals(f.ownOutlineId).count()).toBe(0)
  })

  it('does not report a write to a target deleted between the read and update', async () => {
    const f = await fixture()
    let removal: Promise<void> | undefined
    let started = false
    const affected: number[] = []
    const update = db.chapters.update.bind(db.chapters)
    vi.spyOn(db.chapters, 'update').mockImplementation((key, changes) => Dexie.Promise.resolve().then(async () => {
      if (key === f.chapter.id && !started) {
        started = true
        const holdsWriteLock = Dexie.currentTransaction?.mode === 'readwrite'
        removal = Dexie.ignoreTransaction(() => cascadeDeleteChapterRecords([f.chapter.id!]))
        if (!holdsWriteLock) await removal
      }
      const count = await update(key, changes)
      affected.push(count)
      return count
    }))
    const result = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'chapters', recordId: f.chapter.id!,
      mode: 'replace', data: { title: 'linearized author edit' } })
    await removal
    expect(started).toBe(true)
    expect(affected.reduce((sum, value) => sum + value, 0)).toBe(result.written.length)
    expect(await db.chapters.get(f.chapter.id!)).toBeUndefined()
  })

  it.each(WRITERS)('%s rolls back prose and derived state if invalidation fails after the write', async writer => {
    const f = await fixture()
    const summaryId = await db.narrativeSummaryNodes.add(stampNewRecord(f.a.scope, 'narrativeSummaryNodes', {
      projectId: f.a.scope.projectId, workId: f.a.scope.workId, level: 'chapter' as const, sourceChapterId: f.chapter.id!,
      title: 'synthetic summary', summary: 'retained original summary', keywords: [], sourceHash: 'synthetic-hash',
      status: 'verified' as const, generatedBy: 'system-rollup' as const, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    const before = { chapter: await db.chapters.get(f.chapter.id!), summary: await db.narrativeSummaryNodes.get(summaryId) }
    vi.spyOn(db.narrativeSummaryNodes, 'update').mockRejectedValueOnce(new Error('synthetic summary write failure'))
    await expect(writeChapter(f, writer, { content: '<p>synthetic changed prose</p>', wordCount: 7,
      outlineNodeId: f.ownOutlineId })).rejects.toThrow('synthetic summary write failure')
    expect({ chapter: await db.chapters.get(f.chapter.id!), summary: await db.narrativeSummaryNodes.get(summaryId) }).toEqual(before)
  })

  it('single-field CAS also validates a currently registered record-only FK', async () => {
    const f = await fixture()
    async function reference(scope: WorkspaceScope, title: string) {
      return db.references.add(stampNewRecord(scope, 'references', { projectId: scope.projectId, workId: scope.workId,
        title, author: '', type: 'story' as const, note: '', url: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
    }
    const ownReference = await reference(f.a.scope, 'own reference')
    const foreignReference = await reference(f.b.scope, 'foreign reference')
    const run = await createReferenceAnalysisRun({ referenceId: ownReference, depth: 'quick', sourceFilename: 'synthetic.txt',
      fileHash: 'synthetic', totalChars: 9, expectedChunks: 1, sourceKind: 'own-work', usageScope: 'analysis-only', rightsConfirmed: true,
      sourceText: 'synthetic' })
    const before = await db.referenceAnalysisRuns.get(run.id!)
    const result = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'referenceAnalysisRuns', recordId: run.id!,
      mode: 'replace', data: { referenceId: foreignReference }, compareAndSet: { kind: 'record-field-value-hash', field: 'referenceId',
        expectedHash: await hashAdoptFieldValueV1(ownReference) } })
    expect(result.written).toHaveLength(0)
    expect(result.fkErrors).toContainEqual({ field: 'referenceId', refValue: foreignReference })
    expect(await db.referenceAnalysisRuns.get(run.id!)).toEqual(before)
    expect(await db.referenceAnalysisSources.get(run.id!)).toMatchObject({ analysisRunId: run.id!, workId: f.a.scope.workId })
    const nextReference = await reference(f.a.scope, 'next owned reference')
    const valid = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'referenceAnalysisRuns', recordId: run.id!,
      mode: 'replace', data: { referenceId: nextReference }, compareAndSet: { kind: 'record-field-value-hash', field: 'referenceId',
        expectedHash: await hashAdoptFieldValueV1(ownReference) } })
    expect(valid.written).toHaveLength(1)
    expect((await db.referenceAnalysisRuns.get(run.id!))?.referenceId).toBe(nextReference)
    const stale = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'referenceAnalysisRuns', recordId: run.id!,
      mode: 'replace', data: { referenceId: ownReference }, compareAndSet: { kind: 'record-field-value-hash', field: 'referenceId',
        expectedHash: await hashAdoptFieldValueV1(ownReference) } })
    expect(stale.written).toHaveLength(0)
    expect((await db.referenceAnalysisRuns.get(run.id!))?.referenceId).toBe(nextReference)
    const nullable = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'referenceAnalysisRuns', recordId: run.id!,
      mode: 'replace', data: { referenceId: null }, compareAndSet: { kind: 'record-field-value-hash', field: 'referenceId',
        expectedHash: await hashAdoptFieldValueV1(nextReference) } })
    expect(nullable.written).toHaveLength(1)
    expect((await db.referenceAnalysisRuns.get(run.id!))?.referenceId).toBeNull()
  })

  it('derives parent-owner reference tables and rejects a foreign inherited owner', async () => {
    const f = await arrayFixture()
    async function run(scope: WorkspaceScope, title: string) {
      const referenceId = await db.references.add(stampNewRecord(scope, 'references', { projectId: scope.projectId, workId: scope.workId,
        title, author: '', type: 'story' as const, note: '', url: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
      return createReferenceAnalysisRun({ referenceId, depth: 'quick', sourceFilename: 'parent-owner.txt', fileHash: title,
        totalChars: 9, expectedChunks: 1, sourceKind: 'own-work', usageScope: 'analysis-only', rightsConfirmed: true })
    }
    const ownRun = await run(f.a.scope, 'own parent')
    const foreignRun = await run(f.b.scope, 'foreign parent')
    const character = (await db.characters.get(f.own.characterId))!
    const ownCharacter = { ...character, analysisRunId: ownRun.id! }
    await db.characters.put(ownCharacter)
    const spec = REGISTRY_BY_NAME.get('characters')!
    const originalOwner = spec.domainOwner
    // An isolated metadata extension exercises the generic parent locator;
    // current characters remain World-owned outside this test.
    spec.domainOwner = { allowed: ['work'], defaultOwner: 'work',
      locator: { kind: 'parent', owner: 'work', table: 'referenceAnalysisRuns', field: 'analysisRunId' } }
    try {
      const own = await writeChapter(f, 'record-replace', { perspectiveCharacterId: character.id! })
      expect(own.written).toHaveLength(1)
      expect(own.fkErrors).toEqual([])
      const foreignCharacter = { ...character, analysisRunId: foreignRun.id! }
      await db.characters.put(foreignCharacter)
      const before = await db.chapters.get(f.chapter.id!)
      const foreign = await writeChapter(f, 'record-replace', { perspectiveCharacterId: character.id!, notes: 'must not change' })
      expect(foreign.written).toHaveLength(0)
      expect(foreign.fkErrors).toContainEqual({ field: 'perspectiveCharacterId', refValue: character.id! })
      expect(await db.chapters.get(f.chapter.id!)).toEqual(before)
    } finally {
      spec.domainOwner = originalOwner
    }
  })

  it('keeps an untouched historical soft reference when editing another field', async () => {
    const f = await fixture()
    const created = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'itemLedger', mode: 'add', data: {
      chapterId: f.chapter.id!, itemName: 'synthetic keepsake', action: 'gain', quantity: 1, heldByName: 'traveler', note: 'historical evidence',
    } })
    expect(created.written).toHaveLength(1)
    await cascadeDeleteChapterRecords([f.chapter.id!])
    const before = (await db.itemLedger.get(created.written[0].id))!
    expect(before.chapterId).toBe(f.chapter.id!)
    expect(await db.chapters.get(f.chapter.id!)).toBeUndefined()
    const result = await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'itemLedger', recordId: before.id!,
      mode: 'replace', data: { note: 'author clarified retained history' } })
    expect(result.written).toHaveLength(1)
    expect(await db.itemLedger.get(before.id!)).toMatchObject({ chapterId: f.chapter.id!, note: 'author clarified retained history' })
  })

  it('rolls back registered collection replacement when a later item has a foreign FK', async () => {
    const f = await fixture()
    await adopt({ projectId: f.a.scope.projectId, scope: f.a.scope, target: 'itemLedger', mode: 'add', data: {
      chapterId: f.chapter.id!, itemName: 'original ledger', action: 'gain', quantity: 1, heldByName: 'traveler', note: 'retained original',
    } })
    const before = await db.itemLedger.toArray()
    await expect(replaceAdoptedCollection({ projectId: f.a.scope.projectId, workspaceScope: f.a.scope, target: 'itemLedger',
      scope: { chapterId: f.chapter.id! }, data: [
        { chapterId: f.chapter.id!, itemName: 'new local item', action: 'gain', quantity: 1, heldByName: 'traveler' },
        { chapterId: f.foreignChapter.id!, itemName: 'foreign item', action: 'gain', quantity: 1, heldByName: 'traveler' },
      ] })).rejects.toThrow('已回滚')
    expect(await db.itemLedger.toArray()).toEqual(before)
  })

  it.each([false, true])('real detail adoption keeps valid nonempty members=%s without a model call', async populated => {
    const f = await arrayFixture()
    const selected = (await db.outlineNodes.get(f.ownOutlineId))!
    const characters = populated ? [f.own.characterId] : []
    const foreshadows = populated ? [f.own.foreshadowId] : []
    const raw = JSON.stringify({ scenePlanMode: 'replace', openingHook: 'synthetic opening', endingCliffhanger: 'synthetic ending',
      sceneLocation: 'synthetic port', emotionArc: 'rising', appearingCharacterIds: characters, foreshadowIds: foreshadows, prohibitions: [],
      scenes: [{ action: 'add', title: 'synthetic choice', summary: 'The courier chooses whether to deliver a letter.', location: 'port',
        conflict: 'A deadline approaches.', pace: 'fast', estimatedWords: 1000, characterIds: characters }] })
    await adoptDetailedOutlineAuthoringV1(f.a.scope, null, {
      outlineNodeId: selected.id!, summary: selected.summary, baseDetailed: null,
      baselineHash: await hashCanonicalValue({ outline: selected, detailed: null }),
      validCharacterIds: [f.own.characterId], validForeshadowIds: [f.own.foreshadowId],
    }, raw)
    const detail = await db.detailedOutlines.where('outlineNodeId').equals(selected.id!).first()
    expect(detail).toMatchObject({ appearingCharacterIds: characters, foreshadowIds: foreshadows })
    expect(detail?.scenes[0].characterIds).toEqual(characters)
  })

  it('real detail adoption rejects a disappeared member and rolls back the entire candidate', async () => {
    const f = await arrayFixture()
    const selected = (await db.outlineNodes.get(f.ownOutlineId))!
    const snapshot = { outlineNodeId: selected.id!, summary: selected.summary, baseDetailed: null,
      baselineHash: await hashCanonicalValue({ outline: selected, detailed: null }),
      validCharacterIds: [f.own.characterId], validForeshadowIds: [f.own.foreshadowId] }
    const raw = JSON.stringify({ scenePlanMode: 'replace', openingHook: 'synthetic opening', endingCliffhanger: 'synthetic ending',
      sceneLocation: 'synthetic port', emotionArc: 'rising', appearingCharacterIds: [f.own.characterId],
      foreshadowIds: [f.own.foreshadowId], prohibitions: [], scenes: [{ action: 'add', title: 'synthetic choice',
        summary: 'The courier must decide whether to deliver a letter.', location: 'port', conflict: 'A deadline approaches.',
        pace: 'fast', estimatedWords: 1000, characterIds: [f.own.characterId] }] })
    // This synthetic storage deletion models a member disappearing after the
    // frozen authoring snapshot; the public authoring writer must still reject.
    await db.foreshadows.delete(f.own.foreshadowId)
    const before = await db.detailedOutlines.toArray()
    await expect(adoptDetailedOutlineAuthoringV1(f.a.scope, null, snapshot, raw)).rejects.toThrow('已回滚')
    expect(await db.detailedOutlines.toArray()).toEqual(before)
    expect(await db.outlineNodes.get(selected.id!)).toEqual(selected)
  })

  it.each(['work', 'world'] as const)('real detail adoption rejects a member from another %s in the same Project', async owner => {
    const f = await arrayFixture()
    const otherWorld = owner === 'world'
      ? await addCurrentWorldFixtureV1({ projectId: f.a.scope.projectId, name: 'foreign member World' }) : f.a.world
    const otherWork = owner === 'world'
      ? await addCurrentWorkFixtureV1({ projectId: f.a.scope.projectId, worldId: otherWorld.id!, create: { title: 'foreign member Work' } })
      : await createWorldWork(f.a.scope.projectId, { title: 'foreign member Work' })
    const memberScope = { projectId: f.a.scope.projectId, worldId: otherWorld.id!, workId: otherWork.id! }
    const added = owner === 'world'
      ? await adopt({ projectId: memberScope.projectId, scope: memberScope, target: 'characters', mode: 'add',
        data: { name: 'foreign member', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral' } })
      : await adopt({ projectId: memberScope.projectId, scope: memberScope, target: 'foreshadows', mode: 'add',
        data: { name: 'foreign member', type: 'chekhov', status: 'planned', description: 'synthetic evidence' } })
    expect(added.written).toHaveLength(1)
    const characters = owner === 'world' ? [added.written[0].id] : [f.own.characterId]
    const foreshadows = owner === 'work' ? [added.written[0].id] : [f.own.foreshadowId]
    const selected = (await db.outlineNodes.get(f.ownOutlineId))!
    const raw = JSON.stringify({ scenePlanMode: 'replace', openingHook: 'synthetic opening', endingCliffhanger: 'synthetic ending',
      sceneLocation: 'synthetic port', emotionArc: 'rising', appearingCharacterIds: characters, foreshadowIds: foreshadows,
      prohibitions: [], scenes: [{ action: 'add', title: 'synthetic choice', summary: 'The courier decides whether to deliver a letter.',
        location: 'port', conflict: 'A deadline approaches.', pace: 'fast', estimatedWords: 1000, characterIds: characters }] })
    // The public writer must check an input snapshot independently. The normal
    // prepare path never authorizes these foreign IDs; this is an API boundary test.
    const snapshot = { outlineNodeId: selected.id!, summary: selected.summary, baseDetailed: null,
      baselineHash: await hashCanonicalValue({ outline: selected, detailed: null }),
      validCharacterIds: characters, validForeshadowIds: foreshadows }
    const before = await db.detailedOutlines.toArray()
    await expect(adoptDetailedOutlineAuthoringV1(f.a.scope, null, snapshot, raw)).rejects.toThrow('已回滚')
    expect(await db.detailedOutlines.toArray()).toEqual(before)
    expect(await db.outlineNodes.get(selected.id!)).toEqual(selected)
  })
})
