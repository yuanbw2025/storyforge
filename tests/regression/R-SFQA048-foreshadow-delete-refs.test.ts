import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { useForeshadowStore } from '../../src/stores/foreshadow'
import { useDetailedOutlineStore } from '../../src/stores/detailed-outline'
import { useCharacterStore } from '../../src/stores/character'
import { useReferenceStore } from '../../src/stores/reference'
import { adopt } from '../../src/lib/registry/adopt'
import { transactionTablesForReferences, transactionTablesForReferenceCascade } from '../../src/lib/registry/lifecycle'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { cascadeRegisteredReferences } from '../../src/lib/workspace/lifecycle'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import type { Chapter, WorkspaceScope } from '../../src/lib/types'

async function fixture(name: string) {
  const f = await createWorkspace({ name, description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 1000 },
    { purpose: 'world-engine', kind: 'novel', novelProfile: 'long', importedNovelText: '完整作者正文，不因引用清理而修改。' })
  const chapter = (await readOwnedRows<Chapter>(f.scope, 'chapters', { owner: 'work' }))[0]!
  const detail = await useDetailedOutlineStore.getState().getOrCreate(f.scope, chapter.outlineNodeId)
  const add = async (label: string, scope = f.scope) => {
    const result = await adopt({ projectId: scope.projectId, scope, target: 'foreshadows', mode: 'add',
      data: { name: label, type: 'chekhov', status: 'planned', description: '保留伏笔原文' } })
    expect(result.written).toHaveLength(1)
    return result.written[0].id
  }
  const removed = await add('删除的伏笔'), kept = await add('保留的伏笔')
  await useDetailedOutlineStore.getState().save(detail.id!, {
    foreshadowIds: [kept, removed, kept, removed], openingHook: '保留开篇原文', endingCliffhanger: '保留结尾原文',
  }, f.scope)
  return { ...f, chapter, detail, removed, kept, add }
}

const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))

beforeEach(async () => {
  await db.delete(); await db.open()
  useForeshadowStore.setState({ foreshadows: [], loading: false })
  useDetailedOutlineStore.setState({ detailedOutlines: [], loadedScope: null, loading: false, loadError: null })
  useCharacterStore.setState({ characters: [], loadedScope: null, loading: false, loadError: null })
  useReferenceStore.setState({ references: [], loading: false })
})
afterEach(async () => { await db.delete() })

describe('SFQA048 registered incoming-array deletion', () => {
  it('includes the declared holder in both direct and recursive native transaction closures', () => {
    expect(transactionTablesForReferences('foreshadows').map(table => table.name)).toContain('detailedOutlines')
    expect(transactionTablesForReferenceCascade('foreshadows').map(table => table.name)).toContain('detailedOutlines')
  })

  it('deletes a real foreshadow, preserves all other members and prose, and permits the next unrelated author edit', async () => {
    const f = await fixture('删除伏笔后继续编辑'), other = await fixture('另一个工作区')
    const before = (await db.detailedOutlines.get(f.detail.id!))!, otherBefore = await snapshot()
    const revision = await createWorldRevision({ scope: f.scope, label: '删除前世界版本' })
    const release = await publishWorldRevision(revision.id!)
    await useForeshadowStore.getState().loadAll(f.scope)
    await useForeshadowStore.getState().deleteForeshadow(f.removed)
    expect(await db.foreshadows.get(f.removed)).toBeUndefined()
    expect(await db.detailedOutlines.get(f.detail.id!)).toEqual({ ...before, foreshadowIds: [f.kept, f.kept], updatedAt: expect.any(Number) })
    expect(await db.detailedOutlines.get(other.detail.id!)).toEqual((otherBefore.detailedOutlines as unknown[]).find(row => (row as { id: number }).id === other.detail.id))
    expect(await db.chapters.get(f.chapter.id!)).toEqual(f.chapter)
    expect(await db.worldRevisions.get(revision.id!)).toEqual(revision)
    expect(await db.worldReleases.get(release.id!)).toEqual(release)
    await useDetailedOutlineStore.getState().save(f.detail.id!, { openingHook: '删除后正常保存的新开篇' }, f.scope)
    expect((await db.detailedOutlines.get(f.detail.id!))?.openingHook).toBe('删除后正常保存的新开篇')
    expect((await db.detailedOutlines.get(f.detail.id!))?.foreshadowIds).toEqual([f.kept, f.kept])
  })

  it('rolls back the native array update and local store when the actual source deletion fails', async () => {
    const f = await fixture('删除失败回滚')
    await useForeshadowStore.getState().loadAll(f.scope)
    const before = await snapshot(), local = structuredClone(useForeshadowStore.getState().foreshadows)
    const reject = (key: unknown) => { if (key === f.removed) throw new Error('synthetic native foreshadow delete failure') }
    db.foreshadows.hook('deleting', reject)
    try { await expect(useForeshadowStore.getState().deleteForeshadow(f.removed)).rejects.toThrow('synthetic native foreshadow delete failure') }
    finally { db.foreshadows.hook('deleting').unsubscribe(reject) }
    expect(await snapshot()).toEqual(before)
    expect(useForeshadowStore.getState().foreshadows).toEqual(local)
  })

  it('preserves a foreign Work association even when an already-invalid numeric pointer matches the deleted id', async () => {
    const f = await fixture('原作品'), otherWork = await addCurrentWorkFixtureV1({
      projectId: f.scope.projectId, worldId: f.scope.worldId, create: { kind: 'novel', title: '同世界另一个作品', novelProfile: 'long' },
    })
    const foreignScope: WorkspaceScope = { ...f.scope, workId: otherWork.id! }
    const foreign = { ...(await db.detailedOutlines.get(f.detail.id!))!, id: undefined, workId: foreignScope.workId,
      openingHook: '故意损坏的外作品引用，保留以供作者确认', foreshadowIds: [f.removed] }
    const id = await db.detailedOutlines.add(foreign) as number
    const before = await db.detailedOutlines.get(id)
    await useForeshadowStore.getState().loadAll(f.scope)
    await useForeshadowStore.getState().deleteForeshadow(f.removed)
    expect(await db.detailedOutlines.get(id)).toEqual(before)
    expect((await db.detailedOutlines.get(f.detail.id!))?.foreshadowIds).toEqual([f.kept, f.kept])
  })

  it('keeps absent, null and empty fields unchanged and makes a repeated deletion a no-op', async () => {
    const f = await fixture('空关联不重写')
    const original = (await db.detailedOutlines.get(f.detail.id!))!
    const otherIds: number[] = []
    for (const patch of [{ foreshadowIds: undefined }, { foreshadowIds: null }, { foreshadowIds: [] }]) {
      const raw: Record<string, unknown> = { ...original, ...patch }
      delete raw.id
      if (patch.foreshadowIds === undefined) delete raw.foreshadowIds
      otherIds.push(await db.table<Record<string, unknown>, number>('detailedOutlines').add(raw))
    }
    const before = await Promise.all(otherIds.map(id => db.detailedOutlines.get(id)))
    await useForeshadowStore.getState().loadAll(f.scope)
    await useForeshadowStore.getState().deleteForeshadow(f.removed)
    expect(await Promise.all(otherIds.map(id => db.detailedOutlines.get(id)))).toEqual(before)
    const once = await snapshot()
    await useForeshadowStore.getState().deleteForeshadow(f.removed)
    expect(await snapshot()).toEqual(once)
  })

  it('rechecks a cached foreshadow owner in the actual write transaction before any cleanup', async () => {
    const f = await fixture('旧缓存归属已改变'), other = await addCurrentWorkFixtureV1({
      projectId: f.scope.projectId, worldId: f.scope.worldId, create: { kind: 'novel', title: '新归属作品', novelProfile: 'long' },
    })
    await useForeshadowStore.getState().loadAll(f.scope)
    // Isolated damaged-data injection, representing a changed persisted owner
    // while the old editor still holds its previous, legitimate row.
    await db.table<Record<string, unknown>, number>('foreshadows').update(f.removed, { workId: other.id! })
    const before = await snapshot(), local = structuredClone(useForeshadowStore.getState().foreshadows)
    await expect(useForeshadowStore.getState().deleteForeshadow(f.removed)).rejects.toThrow('伏笔归属已变化')
    expect(await snapshot()).toEqual(before)
    expect(useForeshadowStore.getState().foreshadows).toEqual(local)
  })

  it('applies the same declared removeItem policy to actual JSON storage without deduplicating retained members', async () => {
    const f = await fixture('JSON 引用注册策略')
    const refs = await Promise.all(['删除参考', '保留参考'].map(title => useReferenceStore.getState().addReference({
      projectId: f.scope.projectId, title, author: '', type: 'style', note: '参考原文', url: '',
    })))
    const rules = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'creativeRules', mode: 'replace',
      data: { citedReferenceIds: JSON.stringify([refs[1], refs[0], refs[1]]), writingStyle: '创作规则完整原文' } })
    expect(rules.written).toHaveLength(1)
    const before = (await db.creativeRules.get(rules.written[0].id))!
    // The registered lifecycle is the native boundary under test here. The
    // separate public reference-store positive control remains below.
    await db.transaction('rw', transactionTablesForReferenceCascade('references'), async () => {
      await cascadeRegisteredReferences('references', refs[0])
      await db.references.delete(refs[0])
    })
    expect(await db.creativeRules.get(before.id!)).toEqual({ ...before,
      citedReferenceIds: JSON.stringify([refs[1], refs[1]]), updatedAt: expect.any(Number) })
    expect(await db.references.get(refs[1])).toBeDefined()
  })

  it('refuses malformed registered array storage and rolls back the entire source deletion', async () => {
    const f = await fixture('损坏数组保留')
    const raw = db.table<Record<string, unknown>, number>('detailedOutlines')
    await raw.update(f.detail.id!, { foreshadowIds: '{broken retained reference evidence' })
    await useForeshadowStore.getState().loadAll(f.scope)
    const before = await snapshot(), local = structuredClone(useForeshadowStore.getState().foreshadows)
    await expect(useForeshadowStore.getState().deleteForeshadow(f.removed)).rejects.toThrow('删除已取消，原数据保留')
    expect(await snapshot()).toEqual(before)
    expect(useForeshadowStore.getState().foreshadows).toEqual(local)
  })

  it('retains the existing public character-array and JSON-citation positive controls', async () => {
    const f = await fixture('正常删除对照')
    const characters = await Promise.all(['删除角色', '保留角色'].map(name => adopt({ scope: f.scope,
      projectId: f.scope.projectId, target: 'characters', mode: 'add', data: { name, roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful' } })))
    const [removedCharacter, keptCharacter] = characters.map(result => result.written[0].id)
    await useDetailedOutlineStore.getState().save(f.detail.id!, { appearingCharacterIds: [removedCharacter, keptCharacter] }, f.scope)
    await useCharacterStore.getState().deleteCharacter(removedCharacter)
    expect((await db.detailedOutlines.get(f.detail.id!))?.appearingCharacterIds).toEqual([keptCharacter])
    const refs = await Promise.all(['删除参考', '保留参考'].map(title => useReferenceStore.getState().addReference({
      projectId: f.scope.projectId, title, author: '', type: 'style', note: '', url: '',
    })))
    const rules = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'creativeRules', mode: 'replace',
      data: { citedReferenceIds: JSON.stringify(refs) } })
    expect(rules.written).toHaveLength(1)
    await useReferenceStore.getState().deleteReference(refs[0])
    expect(JSON.parse((await db.creativeRules.get(rules.written[0].id))!.citedReferenceIds!)).toEqual([refs[1]])
  })
})
