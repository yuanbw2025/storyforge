export type StorageScalar = string | number | boolean | null

export type StorageFilterValue = StorageScalar | StorageScalar[]

export interface StorageOrderBy {
  field: string
  direction?: 'asc' | 'desc'
}

export interface StorageQuery {
  where?: Record<string, StorageFilterValue>
  orderBy?: StorageOrderBy
  offset?: number
  limit?: number
}
