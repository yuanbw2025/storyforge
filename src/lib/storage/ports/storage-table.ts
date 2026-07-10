import type { StorageQuery } from './storage-query'

export interface StorageRecord {
  id?: number
}

export interface StorageTable<T extends StorageRecord> {
  get(id: number): Promise<T | undefined>
  list(query?: StorageQuery): Promise<T[]>
  findOne(query: StorageQuery): Promise<T | undefined>
  add(record: T): Promise<number>
  put(record: T): Promise<number>
  update(id: number, patch: Partial<T>): Promise<void>
  delete(id: number): Promise<void>
  bulkPut(records: T[]): Promise<void>
  bulkDelete(ids: number[]): Promise<void>
}
