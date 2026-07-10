import type { ProjectLocator } from './project-locator'
import type { StorageRecord, StorageTable } from './storage-table'

export interface StorageCapabilities {
  transactions: boolean
  atomicWrite: boolean
  watch: boolean
  localPaths: boolean
  stdioMcp: boolean
}

export interface StorageChange {
  table: string
  ids: number[]
  revision: string
}

export type StorageChangeListener = (change: StorageChange) => void

export interface StorageTransaction {
  table<T extends StorageRecord>(name: string): StorageTable<T>
}

export interface ProjectStoragePort extends StorageTransaction {
  readonly locator: ProjectLocator
  readonly capabilities: StorageCapabilities
  transaction<T>(
    mode: 'readonly' | 'readwrite',
    tables: string[],
    work: (transaction: StorageTransaction) => Promise<T>,
  ): Promise<T>
  getRevision(): Promise<string>
  flush(): Promise<void>
  close(): Promise<void>
  watch?(listener: StorageChangeListener): () => void
}
