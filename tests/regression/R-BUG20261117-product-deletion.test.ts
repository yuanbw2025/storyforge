import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { createTtrpgDraft } from '../../src/lib/ttrpg/authoring-service'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { deleteTextAdventureDraftV1 } from '../../src/lib/product-production/delete-draft'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import type { WorkspaceScope, ProductProductionRecordV1 } from '../../src/lib/types'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

it('deletes dedicated AVG and TTRPG Works and their drafts while retaining worlds and other Works', async () => {
  for (const create of [createAvgDraftV1, createTtrpgDraft]) {
    const made = await create('待删除的空草稿')
    const other = await create('保留作品')
    await deleteWork(made.work.id!, { expected: made.work })
    expect(await db.works.get(made.work.id!)).toBeUndefined()
    expect(await db.avgAuthoringDrafts.where('workId').equals(made.work.id!).count()).toBe(0)
    expect(await db.ttrpgAuthoringDrafts.where('workId').equals(made.work.id!).count()).toBe(0)
    expect(await db.worlds.get(made.scope.worldId)).toBeDefined()
    expect(await db.works.get(other.work.id!)).toEqual(other.work)
  }
})

it('refuses stale and cross-owner Work confirmations without deleting the draft', async () => {
  const made = await createAvgDraftV1('原作品')
  await expect(deleteWork(made.work.id!, { expected: { ...made.work, worldId: made.scope.worldId + 1 } })).rejects.toThrow('作品已变化')
  await db.works.update(made.work.id!, { updatedAt: made.work.updatedAt + 1 })
  await expect(deleteWork(made.work.id!, { expected: made.work })).rejects.toThrow('作品已变化')
  expect(await db.avgAuthoringDrafts.where('workId').equals(made.work.id!).count()).toBe(1)
})

async function production(scope: WorkspaceScope) {
  const row: ProductProductionRecordV1 = { ...scope, title: '文字冒险草稿', productionKey: `draft.${Math.random()}`,
    productType: 'text-adventure', status: 'consulting', stateRevision: 0, controlEpoch: 0,
    currentBriefRevision: null, currentBuildNumber: null, currentProductReleaseId: null,
    lastErrorJson: '{}', createdAt: 1, updatedAt: 1 }
  row.id = await db.productProductions.add(row) as number
  await db.productProductionCommands.add({ ...scope, productionId: row.id, commandId: `create.${row.id}`,
    type: 'create-intent', payloadHash: 'a'.repeat(64), expectedStateRevision: 0, status: 'succeeded',
    resultJson: '{}', errorCode: null, createdAt: 1, completedAt: 1 })
  return row
}

it('deletes only the unstarted adventure and registered children, preserving its novel and sibling production', async () => {
  const made = await seedCurrentWorkspace('原小说')
  const row = await production(made.scope), sibling = await production(made.scope)
  await deleteTextAdventureDraftV1(made.scope, row)
  expect(await db.productProductions.get(row.id!)).toBeUndefined()
  expect(await db.productProductionCommands.where('productionId').equals(row.id!).count()).toBe(0)
  expect(await db.productProductions.get(sibling.id!)).toEqual(sibling)
  expect(await db.works.get(made.scope.workId)).toEqual(made.work)
  expect(await db.worlds.get(made.scope.worldId)).toEqual(made.world)
})

it('rejects changed, foreign, started and non-adventure records atomically', async () => {
  const made = await seedCurrentWorkspace(), other = await seedCurrentWorkspace()
  const row = await production(made.scope)
  await expect(deleteTextAdventureDraftV1(other.scope, row)).rejects.toThrow('不属于')
  await expect(deleteTextAdventureDraftV1(made.scope, { ...row, stateRevision: 1 })).rejects.toThrow('已变化')
  await db.productProductions.update(row.id!, { status: 'producing', currentBuildNumber: 1 })
  await expect(deleteTextAdventureDraftV1(made.scope, { ...row, status: 'producing', currentBuildNumber: 1 })).rejects.toThrow('已有执行')
  await db.productProductions.update(row.id!, { productType: 'avg', status: 'consulting', currentBuildNumber: null })
  await expect(deleteTextAdventureDraftV1(made.scope, { ...row, productType: 'avg' })).rejects.toThrow('已变化')
  expect(await db.productProductionCommands.where('productionId').equals(row.id!).count()).toBe(1)
})

it('rolls back registered children when deleting the production fails', async () => {
  const made = await seedCurrentWorkspace(), row = await production(made.scope)
  const failure = vi.spyOn(db.productProductions, 'delete').mockRejectedValueOnce(new Error('模拟删除失败'))
  try { await expect(deleteTextAdventureDraftV1(made.scope, row)).rejects.toThrow('模拟删除失败') }
  finally { failure.mockRestore() }
  expect(await db.productProductions.get(row.id!)).toEqual(row)
  expect(await db.productProductionCommands.where('productionId').equals(row.id!).count()).toBe(1)
})
