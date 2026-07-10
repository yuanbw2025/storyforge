import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  ProjectStoragePort,
  StorageTable,
} from '../../src/lib/storage/ports'

interface ExampleRecord {
  id?: number
  projectId: number
  worldGroupId?: number | null
  name: string
  order: number
}

const TABLE_NAME = 'examples'

export function runStorageContract(
  adapterName: string,
  createStorage: () => ProjectStoragePort,
): void {
  describe(`${adapterName} ProjectStoragePort contract`, () => {
    let storage: ProjectStoragePort
    let table: StorageTable<ExampleRecord>

    beforeEach(() => {
      storage = createStorage()
      table = storage.table<ExampleRecord>(TABLE_NAME)
    })

    afterEach(async () => {
      await storage.close()
    })

    it('supports add/get/update/list/delete CRUD', async () => {
      const id = await table.add({
        projectId: 1,
        worldGroupId: null,
        name: 'First',
        order: 1,
      })

      expect(id).toBe(1)
      expect(await table.get(id)).toEqual({
        id,
        projectId: 1,
        worldGroupId: null,
        name: 'First',
        order: 1,
      })

      await table.update(id, { name: 'Updated', order: 2 })
      expect(await table.list()).toEqual([{
        id,
        projectId: 1,
        worldGroupId: null,
        name: 'Updated',
        order: 2,
      }])

      await table.delete(id)
      expect(await table.get(id)).toBeUndefined()
      expect(await table.list()).toEqual([])
    })

    it('supports put upserts and rejects duplicate adds or missing updates', async () => {
      await table.put({ id: 7, projectId: 1, name: 'Created by put', order: 1 })
      await table.put({ id: 7, projectId: 1, name: 'Updated by put', order: 2 })

      expect(await table.get(7)).toMatchObject({
        id: 7,
        name: 'Updated by put',
        order: 2,
      })
      await expect(table.add({
        id: 7,
        projectId: 1,
        name: 'Duplicate',
        order: 3,
      })).rejects.toThrow('record already exists')
      await expect(table.update(999, { name: 'Missing' })).rejects.toThrow('record not found')
    })

    it('supports bulkPut, filters, ordering, pagination, and findOne', async () => {
      await table.bulkPut([
        { id: 10, projectId: 1, worldGroupId: null, name: 'Gamma', order: 1 },
        { id: 11, projectId: 1, worldGroupId: 2, name: 'Alpha', order: 3 },
        { id: 12, projectId: 2, worldGroupId: 2, name: 'Beta', order: 2 },
        { projectId: 1, worldGroupId: 3, name: 'Delta', order: 4 },
      ])

      expect((await table.list({ where: { projectId: 1 } })).map(record => record.name))
        .toEqual(['Gamma', 'Alpha', 'Delta'])
      expect((await table.list({ where: { worldGroupId: [null, 2] } })).map(record => record.name))
        .toEqual(['Gamma', 'Alpha', 'Beta'])
      expect((await table.list({
        orderBy: { field: 'order', direction: 'desc' },
        offset: 1,
        limit: 2,
      })).map(record => record.name)).toEqual(['Alpha', 'Beta'])
      expect(await table.findOne({ where: { name: 'Alpha' } })).toMatchObject({
        id: 11,
        projectId: 1,
      })
    })

    it('orders nulls, numbers, and other scalar values consistently', async () => {
      await table.bulkPut([
        { id: 1, projectId: 1, worldGroupId: 10, name: 'Beta', order: 20 },
        { id: 2, projectId: 1, worldGroupId: null, name: 'Alpha', order: 3 },
        { id: 3, projectId: 1, worldGroupId: 2, name: 'Gamma', order: 100 },
      ])

      expect((await table.list({ orderBy: { field: 'worldGroupId' } })).map(record => record.id))
        .toEqual([2, 3, 1])
      expect((await table.list({ orderBy: { field: 'order' } })).map(record => record.id))
        .toEqual([2, 1, 3])
      expect((await table.list({ orderBy: { field: 'name', direction: 'desc' } })).map(record => record.id))
        .toEqual([3, 1, 2])
    })

    it('keeps generated ids above every id observed by bulkPut', async () => {
      await table.bulkPut([
        { id: 40, projectId: 1, name: 'Explicit', order: 1 },
        { projectId: 1, name: 'Generated in bulk', order: 2 },
      ])

      const id = await table.add({ projectId: 1, name: 'Generated after bulk', order: 3 })

      expect(id).toBe(42)
    })

    it('rolls back data and revision when a readwrite transaction fails', async () => {
      await table.add({ projectId: 1, name: 'Before', order: 1 })
      const revisionBefore = await storage.getRevision()

      await expect(storage.transaction('readwrite', [TABLE_NAME], async transaction => {
        await transaction.table<ExampleRecord>(TABLE_NAME).add({
          projectId: 1,
          name: 'Rolled back',
          order: 2,
        })
        throw new Error('force rollback')
      })).rejects.toThrow('force rollback')

      expect(await table.list()).toEqual([{
        id: 1,
        projectId: 1,
        name: 'Before',
        order: 1,
      }])
      expect(await storage.getRevision()).toBe(revisionBefore)
    })

    it('rejects and rolls back writes performed inside a readonly transaction', async () => {
      const revisionBefore = await storage.getRevision()

      await expect(storage.transaction('readonly', [TABLE_NAME], async transaction => {
        await transaction.table<ExampleRecord>(TABLE_NAME).add({
          projectId: 1,
          name: 'Forbidden',
          order: 1,
        })
      })).rejects.toThrow('readonly transaction modified data')

      expect(await table.list()).toEqual([])
      expect(await storage.getRevision()).toBe(revisionBefore)
    })

    it('changes revision after a successful write and not after no-op deletes', async () => {
      const initialRevision = await storage.getRevision()
      const id = await table.add({ projectId: 1, name: 'Written', order: 1 })
      const writtenRevision = await storage.getRevision()

      expect(writtenRevision).not.toBe(initialRevision)

      await table.delete(id + 100)
      await table.bulkDelete([id + 200])
      expect(await storage.getRevision()).toBe(writtenRevision)
    })

    it('keeps watch capability and method availability consistent', () => {
      if (storage.capabilities.watch) {
        expect(storage.watch).toBeTypeOf('function')
      } else {
        expect(storage.watch).toBeUndefined()
      }
    })

    it('does not leak mutable references through inputs or outputs', async () => {
      const input: ExampleRecord = {
        projectId: 1,
        worldGroupId: null,
        name: 'Original',
        order: 1,
      }
      const id = await table.add(input)
      input.name = 'Mutated input'

      const fetched = await table.get(id)
      expect(fetched?.name).toBe('Original')
      if (fetched) {
        fetched.name = 'Mutated get result'
      }

      const listed = await table.list()
      listed[0].name = 'Mutated list result'

      expect((await table.get(id))?.name).toBe('Original')
    })
  })
}
