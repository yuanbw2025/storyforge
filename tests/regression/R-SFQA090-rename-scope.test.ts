import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { buildEntityRenamePreview, executeEntityRename, undoEntityRename } from '../../src/lib/editor/entity-rename'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { getTableSpec, stampNewRecord } from '../../src/lib/workspace/scope'
import { createPortableResourceUidV1 } from '../../src/lib/context-gateway/resource-uid'
import { useBackupStore } from '../../src/stores/backup'
import type { Chapter, Character, OutlineNode, WorkspaceScope } from '../../src/lib/types'
import type { TemporalFact } from '../../src/lib/types/temporal-fact'
import { addCurrentWorldFixtureV1, addCurrentWorkFixtureV1, seedCurrentWorkspace } from '../helpers/current-workspace'

async function chapter(scope: WorkspaceScope, body: string) {
  const node: OutlineNode = { projectId: scope.projectId, parentId: null, type: 'chapter', title: body, summary: '', order: 0, createdAt: 1, updatedAt: 1 }
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', node))
  const row: Chapter = { projectId: scope.projectId, outlineNodeId, title: body, content: `<p>${body}</p>`, wordCount: body.length, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1 }
  return await db.chapters.add(stampNewRecord(scope, 'chapters', row))
}

async function character(scope: WorkspaceScope, name = '李明') {
  const row: Character = { projectId: scope.projectId, name, roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral', shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '', createdAt: 1, updatedAt: 1 }
  return await db.characters.add(stampNewRecord(scope, 'characters', row, { owner: 'world' }))
}

async function fact(scope: WorkspaceScope, characterId: number) {
  const row: TemporalFact = { projectId: scope.projectId, characterId, subjectName: '李明', predicate: 'location', factKind: 'state', value: '原事实值：李明在山门', sourceType: 'manual', sourceQuote: '原证据李明', status: 'confirmed', locked: false, createdAt: 1, updatedAt: 1 }
  return await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', row, { owner: 'work' }))
}

async function fixture(bBody = '李明属于作品 B 的正文') {
  const { scope } = await seedCurrentWorkspace('当前 A')
  const b = await createWorldWork(scope.projectId, { title: '独立 B', kind: 'novel', novelProfile: 'long' })
  const bScope = { ...scope, workId: b.id! }
  const characterId = await character(scope)
  const aChapter = await chapter(scope, '李明属于当前 A 的正文')
  const bChapter = await chapter(bScope, bBody)
  const aFact = await fact(scope, characterId)
  const bFact = await fact(bScope, characterId)
  return { scope, bScope, aChapter, bChapter, aFact, bFact, target: { kind: 'character' as const, id: characterId } }
}

const createSnapshot = (projectId: number, label: string, type: 'auto' | 'manual') => useBackupStore.getState().createSnapshot(projectId, label, type)
beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => vi.restoreAllMocks())

describe('SFQA-090 · frozen rename scope', () => {
  it('current Work excludes another Work matching prose and facts from the executable preview', async () => {
    const f = await fixture()
    const beforeB = { chapter: await db.chapters.get(f.bChapter), fact: await db.temporalFacts.get(f.bFact) }
    const preview = await buildEntityRenamePreview({ workId: f.scope.workId, worldId: f.scope.worldId, projectId: f.scope.projectId }, f.target, '林照')
    expect(preview.blockers).toEqual([])
    expect(preview.chapterMatches.map(row => row.chapterId)).toEqual([f.aChapter])
    expect(preview.changes.filter(row => row.target === 'temporalFacts').map(row => row.id)).toEqual([f.aFact])
    await executeEntityRename({ projectId: f.scope.projectId, entity: f.target, newName: '林照', expectedBaseline: preview.baseline, createSnapshot, label: '范围 A' })
    expect((await db.characters.get(f.target.id))?.name).toBe('林照')
    expect((await db.chapters.get(f.aChapter))?.content).toContain('林照')
    expect((await db.temporalFacts.get(f.aFact))?.subjectName).toBe('林照')
    expect(await db.chapters.get(f.bChapter)).toEqual(beforeB.chapter)
    expect(await db.temporalFacts.get(f.bFact)).toEqual(beforeB.fact)
  })

  it('another Work fact alone is never modified and original evidence/value remain', async () => {
    const f = await fixture('作品 B 没有同名正文')
    const b = await db.temporalFacts.get(f.bFact)
    const beforeA = (await db.temporalFacts.get(f.aFact))!
    const preview = await buildEntityRenamePreview(f.scope.projectId, f.target, '林照')
    await executeEntityRename({ projectId: f.scope.projectId, entity: f.target, newName: '林照', expectedBaseline: preview.baseline, createSnapshot, label: '只有 B 事实' })
    expect(await db.temporalFacts.get(f.bFact)).toEqual(b)
    expect(await db.temporalFacts.get(f.aFact)).toMatchObject({ subjectName: '林照', value: beforeA.value, sourceQuote: beforeA.sourceQuote })
  })

  it('switching Work after preview rejects before a snapshot or write', async () => {
    const f = await fixture('B 不匹配')
    const preview = await buildEntityRenamePreview(f.scope.projectId, f.target, '林照')
    await switchActiveWork(f.scope.projectId, f.bScope.workId)
    const snapshot = vi.fn(createSnapshot)
    await expect(executeEntityRename({ projectId: f.scope.projectId, entity: f.target, newName: '林照', expectedBaseline: preview.baseline, createSnapshot: snapshot, label: '旧预览' })).rejects.toThrow(/重新预览|作用域/)
    expect(snapshot).not.toHaveBeenCalled()
    expect((await db.characters.get(f.target.id))?.name).toBe('李明')
  })

  it('a Work switch while creating the real snapshot cancels the entire rename', async () => {
    const f = await fixture('B 不匹配')
    const before = await db.temporalFacts.toArray()
    const preview = await buildEntityRenamePreview(f.scope.projectId, f.target, '林照')
    await expect(executeEntityRename({ projectId: f.scope.projectId, entity: f.target, newName: '林照', expectedBaseline: preview.baseline, label: '快照切换', createSnapshot: async (...args) => {
      const id = await createSnapshot(...args)
      await switchActiveWork(f.scope.projectId, f.bScope.workId)
      return id
    } })).rejects.toThrow(/作用域|重新预览/)
    expect((await db.characters.get(f.target.id))?.name).toBe('李明')
    expect(await db.temporalFacts.toArray()).toEqual(before)
    expect(await db.snapshots.count()).toBe(1)
  })

  it('a zero-row fact update rejects and rolls back the entity and chapter', async () => {
    const f = await fixture('B 不匹配')
    const preview = await buildEntityRenamePreview(f.scope.projectId, f.target, '林照')
    vi.spyOn(db.temporalFacts, 'update').mockResolvedValueOnce(0)
    await expect(executeEntityRename({ projectId: f.scope.projectId, entity: f.target, newName: '林照', expectedBaseline: preview.baseline, createSnapshot, label: '零行故障' })).rejects.toThrow()
    expect((await db.characters.get(f.target.id))?.name).toBe('李明')
    expect((await db.chapters.get(f.aChapter))?.content).toContain('李明')
    expect((await db.temporalFacts.get(f.aFact))?.subjectName).toBe('李明')
  })

  it('a changed resource identity after the snapshot is preserved and rejects rename', async () => {
    const f = await fixture('B 不匹配')
    const preview = await buildEntityRenamePreview(f.scope.projectId, f.target, '林照')
    const identity = getTableSpec('temporalFacts').resourceIdentity!
    const uid = createPortableResourceUidV1(identity.resourceKind)
    await expect(executeEntityRename({ projectId: f.scope.projectId, entity: f.target, newName: '林照', expectedBaseline: preview.baseline, label: '身份变化', createSnapshot: async (...args) => {
      const id = await createSnapshot(...args)
      await db.temporalFacts.update(f.aFact, record => { Reflect.set(record, identity.field, uid) })
      return id
    } })).rejects.toThrow(/变化|重新预览/)
    expect((await db.characters.get(f.target.id))?.name).toBe('李明')
    expect((await db.temporalFacts.get(f.aFact) as unknown as Record<string, unknown>)[identity.field]).toBe(uid)
  })

  it('undo is bound to the original Work and restores only its references', async () => {
    const f = await fixture('B 不匹配')
    const beforeB = await db.temporalFacts.get(f.bFact)
    const preview = await buildEntityRenamePreview(f.scope.projectId, f.target, '林照')
    const result = await executeEntityRename({ projectId: f.scope.projectId, entity: f.target, newName: '林照', expectedBaseline: preview.baseline, createSnapshot, label: '可撤销' })
    await switchActiveWork(f.scope.projectId, f.bScope.workId)
    await expect(undoEntityRename(result.undoPatch)).rejects.toThrow(/作用域|原作品/)
    expect((await db.characters.get(f.target.id))?.name).toBe('林照')
    await switchActiveWork(f.scope.projectId, f.scope.workId)
    await undoEntityRename(result.undoPatch)
    expect((await db.characters.get(f.target.id))?.name).toBe('李明')
    expect((await db.temporalFacts.get(f.aFact))?.subjectName).toBe('李明')
    expect(await db.temporalFacts.get(f.bFact)).toEqual(beforeB)
  })

  it('same names in another World do not block a valid current-World rename', async () => {
    const f = await fixture('B 不匹配')
    const world = await addCurrentWorldFixtureV1({ projectId: f.scope.projectId, name: '另一个 World' })
    const work = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: world.id!, create: { title: '另一个 World 作品', kind: 'novel', novelProfile: 'long' } })
    await character({ projectId: f.scope.projectId, worldId: world.id!, workId: work.id! })
    const preview = await buildEntityRenamePreview(f.scope.projectId, f.target, '林照')
    expect(preview.blockers).toEqual([])
    await executeEntityRename({ projectId: f.scope.projectId, entity: f.target, newName: '林照', expectedBaseline: preview.baseline, createSnapshot, label: '外域同名' })
    expect((await db.characters.get(f.target.id))?.name).toBe('林照')
  })
})
