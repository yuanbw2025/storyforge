import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { useLocationStore } from '../../src/stores/location'
import { useCharacterStore } from '../../src/stores/character'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { transactionTablesForReferences } from '../../src/lib/registry/lifecycle'
import { clearImportantLocationReferences } from '../../src/lib/location/lifecycle'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import type { CodexCategory, CodexEntry } from '../../src/lib/types'

async function fixture(name: string) {
  const f = await createWorkspace({ name, description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 0 },
    { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const add = (label: string, parentId: number | null = null) => useLocationStore.getState().addLocation({
    projectId: f.scope.projectId, parentId, name: label, tags: '[]', description: '地点原文', significance: '', sortOrder: 0,
  })
  const root = await add('北境'), child = await add('雁门', root), retained = await add('南港')
  const addCharacter = (label: string, importantLocationId: number) => useCharacterStore.getState().addCharacter({
    projectId: f.scope.projectId, name: label, roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
    shortDescription: '作者简介', appearance: '外貌原文', personality: '性格原文', background: '完整背景原文',
    motivation: '动机原文', abilities: '能力原文', relationships: '[]', arc: '弧光原文',
    location: '保留作者自由文本地点', importantLocationId,
  })
  const linkedCharacter = await addCharacter('北境角色', child), retainedCharacter = await addCharacter('南港角色', retained)
  const now = Date.now()
  const categoryId = await db.codexCategories.add(stampNewRecord(f.scope, 'codexCategories', {
    projectId: f.scope.projectId, domain: 'humanity', parentId: null, name: '城池重镇', builtInKey: 'city',
    fieldSchema: '[]', hidden: false, order: 0, createdAt: now, updatedAt: now,
  } satisfies CodexCategory, { owner: 'world' })) as number
  const city = await db.codexEntries.add(stampNewRecord(f.scope, 'codexEntries', {
    projectId: f.scope.projectId, categoryId, name: '雁门城', summary: '保留简介', description: '城池完整原文', fields: '{}',
    refs: '{}', tags: '[]', order: 0, importantLocationId: child, worldGroupId: null,
    origin: 'manual', sourceEvidenceQuotes: '[]', sourceContentHash: '', producerRunId: null, producerCandidateHash: null,
    createdAt: now, updatedAt: now,
  } satisfies CodexEntry, { owner: 'world' })) as number
  return { ...f, root, child, retained, linkedCharacter, retainedCharacter, city }
}

async function snapshot() {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
}

beforeEach(async () => {
  await db.delete(); await db.open()
  useLocationStore.setState({ locations: [], loading: false })
  useCharacterStore.setState({ characters: [], loadedScope: null, loading: false, loadError: null })
})
afterEach(async () => { await db.delete() })

describe('SFQA048 location deletion registered references (foreshadow scope remains separate)', () => {
  it('clears every subtree location pointer while preserving character prose, unrelated owners and frozen releases', async () => {
    const f = await fixture('删除范围'), other = await fixture('另一个世界')
    const revision = await createWorldRevision({ scope: f.scope, label: '删除前封存' })
    const release = await publishWorldRevision(revision.id!)
    const character = (await db.characters.get(f.linkedCharacter))!, city = (await db.codexEntries.get(f.city))!
    const retainedCharacter = await db.characters.get(f.retainedCharacter)
    const otherRows = await Promise.all([db.characters.get(other.linkedCharacter), db.codexEntries.get(other.city), db.importantLocations.get(other.child)])
    await useLocationStore.getState().loadAll(f.scope)
    await useLocationStore.getState().deleteLocation(f.root)
    expect(await db.importantLocations.get(f.root)).toBeUndefined()
    expect(await db.importantLocations.get(f.child)).toBeUndefined()
    expect(await db.characters.get(f.linkedCharacter)).toEqual({ ...character, importantLocationId: null })
    expect(await db.codexEntries.get(f.city)).toEqual({ ...city, importantLocationId: null, updatedAt: expect.any(Number) })
    expect(await db.characters.get(f.retainedCharacter)).toEqual(retainedCharacter)
    expect(await Promise.all([db.characters.get(other.linkedCharacter), db.codexEntries.get(other.city), db.importantLocations.get(other.child)])).toEqual(otherRows)
    expect(await db.worldRevisions.get(revision.id!)).toEqual(revision)
    expect(await db.worldReleases.get(release.id!)).toEqual(release)
    expect(useLocationStore.getState().locations.map(row => row.id)).toEqual([f.retained])
  })

  it('rolls back all pointer cleanup when actual native subtree deletion fails', async () => {
    const f = await fixture('事务回滚')
    await useLocationStore.getState().loadAll(f.scope)
    const before = await snapshot(), local = structuredClone(useLocationStore.getState().locations)
    const rejectDelete = (key: unknown) => { if (key === f.child) throw new Error('synthetic native delete failure') }
    db.importantLocations.hook('deleting', rejectDelete)
    try {
      await expect(useLocationStore.getState().deleteLocation(f.root)).rejects.toThrow('synthetic native delete failure')
    } finally { db.importantLocations.hook('deleting').unsubscribe(rejectDelete) }
    expect(await snapshot()).toEqual(before)
    expect(useLocationStore.getState().locations).toEqual(local)
  })

  it('preserves the helper city-count contract while applying the registered character policy', async () => {
    const f = await fixture('引用清理计数'), character = (await db.characters.get(f.linkedCharacter))!
    const count = await db.transaction('rw', transactionTablesForReferences('importantLocations'), () =>
      clearImportantLocationReferences(f.scope.projectId, new Set([f.child])))
    expect(count).toBe(1)
    expect(await db.characters.get(f.linkedCharacter)).toEqual({ ...character, importantLocationId: null })
    expect((await db.codexEntries.get(f.city))!.importantLocationId).toBeNull()
    expect(await db.importantLocations.get(f.child)).toBeDefined()
  })
})
