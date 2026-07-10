import type {
  ProjectLocator,
  ProjectStoragePort,
  StorageCapabilities,
  StorageQuery,
  StorageRecord,
  StorageTable,
  StorageTransaction,
} from '../../ports'

const MEMORY_CAPABILITIES = Object.freeze({
  transactions: true,
  atomicWrite: true,
  watch: false,
  localPaths: false,
  stdioMcp: false,
} satisfies StorageCapabilities)

const READONLY_MODIFICATION_ERROR = 'readonly transaction modified data'

type TableRecords = Map<number, StorageRecord>
type TableCollection = Map<string, TableRecords>

interface StorageSnapshot {
  tables: TableCollection
  sequences: Map<string, number>
  revision: number
}

export class MemoryProjectStorage implements ProjectStoragePort {
  readonly locator: ProjectLocator
  readonly capabilities = MEMORY_CAPABILITIES

  private tables: TableCollection = new Map()
  private sequences = new Map<string, number>()
  private revision = 0

  constructor(locator: ProjectLocator) {
    this.locator = structuredClone(locator)
  }

  table<T extends StorageRecord>(name: string): StorageTable<T> {
    return {
      get: id => this.getRecord<T>(name, id),
      list: query => this.listRecords<T>(name, query),
      findOne: query => this.findOneRecord<T>(name, query),
      add: record => this.addRecord(name, record),
      put: record => this.putRecord(name, record),
      update: (id, patch) => this.updateRecord<T>(name, id, patch),
      delete: id => this.deleteRecord(name, id),
      bulkPut: records => this.bulkPutRecords(name, records),
      bulkDelete: ids => this.bulkDeleteRecords(name, ids),
    }
  }

  async transaction<T>(
    mode: 'readonly' | 'readwrite',
    tableNames: string[],
    work: (transaction: StorageTransaction) => Promise<T>,
  ): Promise<T> {
    const snapshot = this.createSnapshot()
    const allowedTables = new Set(tableNames)
    const transaction: StorageTransaction = {
      table: <R extends StorageRecord>(name: string): StorageTable<R> => {
        if (!allowedTables.has(name)) {
          throw new Error(`table is not part of transaction: ${name}`)
        }
        return this.table<R>(name)
      },
    }

    try {
      const result = await work(transaction)
      if (mode === 'readonly' && this.revision !== snapshot.revision) {
        this.restoreSnapshot(snapshot)
        throw new Error(READONLY_MODIFICATION_ERROR)
      }
      return result
    } catch (error: unknown) {
      this.restoreSnapshot(snapshot)
      throw error
    }
  }

  getRevision(): Promise<string> {
    return Promise.resolve(`memory:${this.revision}`)
  }

  flush(): Promise<void> {
    return Promise.resolve()
  }

  close(): Promise<void> {
    return Promise.resolve()
  }

  private getRecord<T extends StorageRecord>(
    tableName: string,
    id: number,
  ): Promise<T | undefined> {
    const record = this.tables.get(tableName)?.get(id)
    return Promise.resolve(record ? structuredClone(record as T) : undefined)
  }

  private listRecords<T extends StorageRecord>(
    tableName: string,
    query?: StorageQuery,
  ): Promise<T[]> {
    const table = this.tables.get(tableName)
    if (!table) {
      return Promise.resolve([])
    }

    let records = Array.from(table.values(), record => record as T)
    const where = query?.where
    if (where) {
      records = records.filter(record => matchesWhere(record, where))
    }
    if (query?.orderBy) {
      const { field, direction = 'asc' } = query.orderBy
      const directionMultiplier = direction === 'desc' ? -1 : 1
      records.sort((left, right) => (
        compareValues(Reflect.get(left, field), Reflect.get(right, field)) * directionMultiplier
      ))
    }

    const offset = normalizeNonNegativeInteger(query?.offset)
    const limit = query?.limit === undefined
      ? records.length
      : normalizeNonNegativeInteger(query.limit)

    return Promise.resolve(
      records.slice(offset, offset + limit).map(record => structuredClone(record)),
    )
  }

  private async findOneRecord<T extends StorageRecord>(
    tableName: string,
    query: StorageQuery,
  ): Promise<T | undefined> {
    const records = await this.listRecords<T>(tableName, query)
    return records[0]
  }

  private addRecord<T extends StorageRecord>(tableName: string, record: T): Promise<number> {
    const table = this.getOrCreateTable(tableName)
    const id = record.id ?? this.allocateId(tableName)

    if (table.has(id)) {
      return Promise.reject(new Error(`record already exists: ${tableName}:${id}`))
    }

    this.observeId(tableName, id)
    table.set(id, cloneWithId(record, id))
    this.incrementRevision()
    return Promise.resolve(id)
  }

  private putRecord<T extends StorageRecord>(tableName: string, record: T): Promise<number> {
    const table = this.getOrCreateTable(tableName)
    const id = record.id ?? this.allocateId(tableName)
    const storedRecord = cloneWithId(record, id)
    const previous = table.get(id)

    this.observeId(tableName, id)
    if (!previous || !deepEqual(previous, storedRecord)) {
      table.set(id, storedRecord)
      this.incrementRevision()
    }

    return Promise.resolve(id)
  }

  private updateRecord<T extends StorageRecord>(
    tableName: string,
    id: number,
    patch: Partial<T>,
  ): Promise<void> {
    const table = this.tables.get(tableName)
    const previous = table?.get(id)
    if (!table || !previous) {
      return Promise.reject(new Error(`record not found: ${tableName}:${id}`))
    }

    const updated = structuredClone(previous as T)
    Object.assign(updated, structuredClone(patch), { id })
    if (!deepEqual(previous, updated)) {
      table.set(id, updated)
      this.incrementRevision()
    }

    return Promise.resolve()
  }

  private deleteRecord(tableName: string, id: number): Promise<void> {
    const deleted = this.tables.get(tableName)?.delete(id) ?? false
    if (deleted) {
      this.incrementRevision()
    }
    return Promise.resolve()
  }

  private bulkPutRecords<T extends StorageRecord>(
    tableName: string,
    records: T[],
  ): Promise<void> {
    const table = this.getOrCreateTable(tableName)
    let changed = false

    for (const record of records) {
      const id = record.id ?? this.allocateId(tableName)
      const storedRecord = cloneWithId(record, id)
      const previous = table.get(id)

      this.observeId(tableName, id)
      if (!previous || !deepEqual(previous, storedRecord)) {
        table.set(id, storedRecord)
        changed = true
      }
    }

    if (changed) {
      this.incrementRevision()
    }
    return Promise.resolve()
  }

  private bulkDeleteRecords(tableName: string, ids: number[]): Promise<void> {
    const table = this.tables.get(tableName)
    if (!table) {
      return Promise.resolve()
    }

    let changed = false
    for (const id of ids) {
      changed = table.delete(id) || changed
    }
    if (changed) {
      this.incrementRevision()
    }
    return Promise.resolve()
  }

  private getOrCreateTable(tableName: string): TableRecords {
    const existing = this.tables.get(tableName)
    if (existing) {
      return existing
    }

    const created: TableRecords = new Map()
    this.tables.set(tableName, created)
    return created
  }

  private allocateId(tableName: string): number {
    const id = (this.sequences.get(tableName) ?? 0) + 1
    this.sequences.set(tableName, id)
    return id
  }

  private observeId(tableName: string, id: number): void {
    const current = this.sequences.get(tableName) ?? 0
    if (id > current) {
      this.sequences.set(tableName, id)
    }
  }

  private incrementRevision(): void {
    this.revision += 1
  }

  private createSnapshot(): StorageSnapshot {
    return {
      tables: cloneTables(this.tables),
      sequences: new Map(this.sequences),
      revision: this.revision,
    }
  }

  private restoreSnapshot(snapshot: StorageSnapshot): void {
    this.tables = cloneTables(snapshot.tables)
    this.sequences = new Map(snapshot.sequences)
    this.revision = snapshot.revision
  }
}

function cloneWithId<T extends StorageRecord>(record: T, id: number): T {
  return Object.assign(structuredClone(record), { id })
}

function cloneTables(tables: TableCollection): TableCollection {
  return new Map(Array.from(tables, ([tableName, records]) => [
    tableName,
    new Map(Array.from(records, ([id, record]) => [id, structuredClone(record)])),
  ]))
}

function matchesWhere(
  record: StorageRecord,
  where: NonNullable<StorageQuery['where']>,
): boolean {
  return Object.entries(where).every(([field, expected]) => {
    const actual: unknown = Reflect.get(record, field)
    const acceptedValues = Array.isArray(expected) ? expected : [expected]
    return acceptedValues.some(value => Object.is(actual, value))
  })
}

function compareValues(left: unknown, right: unknown): number {
  if (Object.is(left, right)) {
    return 0
  }
  if (left === null) {
    return -1
  }
  if (right === null) {
    return 1
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }
  return String(left).localeCompare(String(right))
}

function normalizeNonNegativeInteger(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.trunc(value))
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime()
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((value, index) => deepEqual(value, right[index]))
  }
  if (!isObject(left) || !isObject(right)) {
    return false
  }

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => (
      Object.prototype.hasOwnProperty.call(right, key)
      && deepEqual(Reflect.get(left, key), Reflect.get(right, key))
    ))
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}
