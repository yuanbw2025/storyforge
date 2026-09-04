import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useLocationStore } from '../../src/stores/location'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

describe('WORLD-1 · 城池与重要地点生命周期', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('删除地点子树时原子置空相关城池引用，不删除词条或无关地点', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: '地点生命周期', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const categoryId = await db.codexCategories.add({
      projectId, domain: 'humanity', parentId: null, name: '城池重镇',
      builtInKey: 'city', fieldSchema: '[]', hidden: false, order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const parentId = await db.importantLocations.add({
      projectId, name: '北境', tags: '[]', description: '', significance: '',
      parentId: null, sortOrder: 0, createdAt: now, updatedAt: now,
    })
    const childId = await db.importantLocations.add({
      projectId, name: '雁门城', tags: '[]', description: '', significance: '',
      parentId, sortOrder: 0, createdAt: now, updatedAt: now,
    })
    const retainedId = await db.importantLocations.add({
      projectId, name: '南港', tags: '[]', description: '', significance: '',
      parentId: null, sortOrder: 1, createdAt: now, updatedAt: now,
    })
    const childCityId = await db.codexEntries.add({
      projectId, categoryId, name: '雁门', summary: '', description: '', fields: '{}',
      refs: '{}', tags: '[]', order: 0, importantLocationId: childId,
      worldGroupId: null, origin: 'manual', sourceEvidenceQuotes: '[]', sourceContentHash: '',
      producerRunId: null, producerCandidateHash: null, createdAt: now, updatedAt: now,
    } as any) as number
    const retainedCityId = await db.codexEntries.add({
      projectId, categoryId, name: '南港城', summary: '', description: '', fields: '{}',
      refs: '{}', tags: '[]', order: 1, importantLocationId: retainedId,
      worldGroupId: null, origin: 'manual', sourceEvidenceQuotes: '[]', sourceContentHash: '',
      producerRunId: null, producerCandidateHash: null, createdAt: now, updatedAt: now,
    } as any) as number
    await finalizeCurrentFixtureV1(projectId)

    await useLocationStore.getState().loadAll(projectId)
    await useLocationStore.getState().deleteLocation(parentId)

    expect(await db.importantLocations.get(parentId)).toBeUndefined()
    expect(await db.importantLocations.get(childId)).toBeUndefined()
    expect(await db.importantLocations.get(retainedId)).toBeTruthy()
    expect((await db.codexEntries.get(childCityId))?.importantLocationId).toBeNull()
    expect((await db.codexEntries.get(retainedCityId))?.importantLocationId).toBe(retainedId)
  })
})
